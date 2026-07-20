import { createHash, randomUUID } from 'node:crypto';
import { getReconnectGraceMs } from './reconnect-policy.mjs';
import { WebSocketServer } from 'ws';
import { createRankingStore } from './ranking-store.mjs';

const ROOM_CODE_LENGTH = 6;
const MAX_CHAT_LEN = 120;

const COUNTDOWN_MS = 3000;
const ROWS = 8;
const COLS = 6;              // 48칸 — 모바일에서 탭하기 좋은 크기로 합이 10 퍼즐(8x10)보다 작게 잡음
const MATCH_MS = 30000;      // 줄다리기 배틀과 동일한 30초
const MIN_PAINT_INTERVAL_MS = 20; // 매크로 연타 방지용 최소 간격(초당 50회 상한 — 여긴 칸 재점령이 핵심이라 여유있게)

/**
 * Room:
 * {
 *   hostToken, players: [{ token, name, ws }],  // 정확히 2명, host=left, guest=right
 *   disconnectTimers: Map<token, timer>,
 *   started: boolean,
 *   phase: 'lobby' | 'countdown' | 'playing' | 'game_over',
 *   cells: (string|null)[][],  // 각 칸의 점령자 token, 미점령은 null
 *   lastPaintAt: Map<token, number>,
 *   matchEndsAt: number,
 *   matchTimer: Timeout | null,
 *   countdownTimer: Timeout | null,
 * }
 */
export function registerTerritoryClashServer() {
  const rooms = new Map();
  /** ws -> { roomCode, token } */
  const wsIdentity = new Map();
  const ranking = createRankingStore('territory-clash');

  function recordResult(room, winnerToken) {
    if (!winnerToken) return;
    for (const p of room.players) ranking.recordResult(p.name, p.token === winnerToken);
  }

  function send(ws, payload) {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  }
  function broadcast(room, payload) {
    for (const p of room.players) if (p.ws) send(p.ws, payload);
  }

  function sanitizeName(name) {
    const s = typeof name === 'string' ? name.trim().slice(0, 20) : '';
    return s || '손님';
  }
  function sanitizeRoomCode(code) {
    return typeof code === 'string' ? code.trim().toUpperCase().slice(0, ROOM_CODE_LENGTH) : '';
  }
  function genRoomCode() {
    const now = new Date();
    const base = [now.getFullYear(), now.getMonth() + 1, now.getDate(),
      now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()].join('-');
    let attempt = 0, code;
    do {
      const digest = createHash('sha256').update(`territory-clash-${base}-${attempt}`).digest('hex');
      code = digest.slice(0, ROOM_CODE_LENGTH).toUpperCase();
      attempt++;
    } while (rooms.has(code));
    return code;
  }

  function playerByToken(room, token) { return room.players.find(p => p.token === token); }
  function otherPlayer(room, token) { return room.players.find(p => p.token !== token); }
  function side(room, token) { return room.players[0]?.token === token ? 'left' : 'right'; }

  function clearDisconnectTimer(room, token) {
    const t = room.disconnectTimers.get(token);
    if (t) { clearTimeout(t); room.disconnectTimers.delete(token); }
  }
  function clearAllDisconnectTimers(room) {
    room.players.forEach(p => clearDisconnectTimer(room, p.token));
  }
  function clearRoundTimers(room) {
    if (room.matchTimer) { clearTimeout(room.matchTimer); room.matchTimer = null; }
    if (room.countdownTimer) { clearTimeout(room.countdownTimer); room.countdownTimer = null; }
  }

  function scoreOf(room, token) {
    let count = 0;
    for (const row of room.cells) for (const owner of row) if (owner === token) count++;
    return count;
  }

  function snapshotCells(room) {
    // 클라이언트에는 토큰 대신 'left'/'right'/null로 변환해 보낸다 — 재접속 시 상대 토큰을
    // 그대로 노출할 필요가 없다(다른 게임들의 {token,name} 원칙과 달리 여긴 색상 구분만
    // 필요해서 부담 없이 side로 단순화).
    return room.cells.map(row => row.map(owner => {
      if (owner === null) return null;
      return owner === room.players[0]?.token ? 'left' : 'right';
    }));
  }

  // ── 게임 진행 ────────────────────────────────────────────────────
  function startCountdown(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    room.phase = 'countdown';
    broadcast(room, { type: 'game_starting', countdownMs: COUNTDOWN_MS });
    room.countdownTimer = setTimeout(() => startMatch(roomCode), COUNTDOWN_MS);
  }

  function startMatch(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.players.filter(p => p.ws).length < 2) return;

    room.cells = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null));
    room.lastPaintAt = new Map();
    room.phase = 'playing';
    room.started = true;
    room.matchEndsAt = Date.now() + MATCH_MS;

    broadcast(room, {
      type: 'match_start',
      durationMs: MATCH_MS,
      rows: ROWS,
      cols: COLS,
      leftName: room.players[0]?.name ?? '?',
      rightName: room.players[1]?.name ?? '?',
    });

    room.matchTimer = setTimeout(() => endMatch(roomCode), MATCH_MS);
  }

  function endMatch(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'playing') return;
    clearRoundTimers(room);
    room.phase = 'game_over';
    room.started = false;

    const leftToken = room.players[0]?.token;
    const rightToken = room.players[1]?.token;
    const leftCount = scoreOf(room, leftToken);
    const rightCount = scoreOf(room, rightToken);
    const winnerToken = leftCount === rightCount ? null : (leftCount > rightCount ? leftToken : rightToken);
    const winner = winnerToken ? playerByToken(room, winnerToken) : null;

    recordResult(room, winnerToken);
    broadcast(room, {
      type: 'game_over',
      winnerToken: winnerToken ?? null,
      winnerName: winner?.name ?? null,
      leftCount,
      rightCount,
    });
  }

  // ── 이탈/재접속 처리 ─────────────────────────────────────────────
  function finalizeLeave(roomCode, leavingToken) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearAllDisconnectTimers(room);

    if (room.phase === 'playing') {
      const opponent = otherPlayer(room, leavingToken);
      if (opponent?.ws) send(opponent.ws, { type: 'opponent_left' });
      clearRoundTimers(room);
      rooms.delete(roomCode);
      return;
    }

    const remaining = room.players.filter(p => p.token !== leavingToken);
    if (remaining.length === 0 || leavingToken === room.hostToken) {
      for (const p of remaining) if (p.ws) send(p.ws, { type: 'host_left' });
      rooms.delete(roomCode);
      return;
    }
    room.players = remaining;
    wsIdentity.forEach((id, ws) => { if (id.token === leavingToken) wsIdentity.delete(ws); });
    const host = remaining[0];
    if (host?.ws) send(host.ws, { type: 'guest_left', roomCode });
  }

  function scheduleDisconnectCleanup(roomCode, token) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearDisconnectTimer(room, token);
    const timer = setTimeout(() => finalizeLeave(roomCode, token), getReconnectGraceMs(room));
    room.disconnectTimers.set(token, timer);
  }

  // ── WebSocket 연결 처리 ──────────────────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      // ── create ────────────────────────────────────────────────
      if (msg.type === 'create') {
        const name = sanitizeName(msg.name);
        const roomCode = genRoomCode();
        const token = randomUUID();
        rooms.set(roomCode, {
          hostToken: token,
          players: [{ token, name, ws }],
          disconnectTimers: new Map(),
          started: false,
          phase: 'lobby',
          cells: [],
          lastPaintAt: new Map(),
          matchEndsAt: 0,
          matchTimer: null,
          countdownTimer: null,
        });
        wsIdentity.set(ws, { roomCode, token });
        send(ws, { type: 'room_created', roomCode, token });
        return;
      }

      // ── join ──────────────────────────────────────────────────
      if (msg.type === 'join') {
        const name = sanitizeName(msg.name);
        const roomCode = sanitizeRoomCode(msg.roomCode);
        const room = rooms.get(roomCode);
        if (!room) { send(ws, { type: 'error', message: '방을 찾을 수 없습니다.' }); return; }
        if (room.started) { send(ws, { type: 'error', message: '이미 시작된 게임입니다.' }); return; }
        if (room.players.length >= 2) { send(ws, { type: 'error', message: '인원이 가득 찬 방입니다.' }); return; }

        const token = randomUUID();
        room.players.push({ token, name, ws });
        wsIdentity.set(ws, { roomCode, token });

        send(ws, { type: 'joined', roomCode, token, opponentName: room.players[0].name });
        if (room.players[0].ws) send(room.players[0].ws, { type: 'opponent_joined', opponentName: name });
        startCountdown(roomCode);
        return;
      }

      // ── rejoin ────────────────────────────────────────────────
      if (msg.type === 'rejoin') {
        const roomCode = sanitizeRoomCode(msg.roomCode);
        const token = typeof msg.token === 'string' ? msg.token : '';
        const room = rooms.get(roomCode);
        const player = room && playerByToken(room, token);
        if (!room || !player) { send(ws, { type: 'error', message: '재연결 실패. 방이 종료됐을 수 있어요.' }); return; }

        clearDisconnectTimer(room, token);
        player.ws = ws;
        wsIdentity.set(ws, { roomCode, token });
        const opponent = otherPlayer(room, token);

        if (!room.started) {
          send(ws, { type: 'rejoined', roomCode, token, started: false, opponentName: opponent?.name ?? null });
        } else {
          send(ws, {
            type: 'rejoined', roomCode, token, started: true,
            game: {
              mySide: side(room, token),
              rows: ROWS,
              cols: COLS,
              cells: snapshotCells(room),
              remainingMs: Math.max(0, room.matchEndsAt - Date.now()),
              leftName: room.players[0]?.name ?? '?',
              rightName: room.players[1]?.name ?? '?',
              leftCount: scoreOf(room, room.players[0]?.token),
              rightCount: scoreOf(room, room.players[1]?.token),
            },
          });
        }
        if (opponent?.ws) send(opponent.ws, { type: 'opponent_reconnected' });
        return;
      }

      // ── paint ─────────────────────────────────────────────────────
      if (msg.type === 'paint') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room || room.phase !== 'playing') return;
        const player = playerByToken(room, identity.token);
        if (!player) return;

        const now = Date.now();
        const last = room.lastPaintAt.get(identity.token) || 0;
        if (now - last < MIN_PAINT_INTERVAL_MS) return;

        const r = Number(msg.row);
        const c = Number(msg.col);
        if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
        if (room.cells[r][c] === identity.token) return; // 이미 내 칸이면 무시(no-op)

        room.lastPaintAt.set(identity.token, now);
        room.cells[r][c] = identity.token;
        const mySide = side(room, identity.token);
        broadcast(room, {
          type: 'cell_claimed', row: r, col: c, side: mySide,
          leftCount: scoreOf(room, room.players[0]?.token),
          rightCount: scoreOf(room, room.players[1]?.token),
        });
        return;
      }

      // ── submit_chat ───────────────────────────────────────────────
      if (msg.type === 'submit_chat') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room) return;
        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, MAX_CHAT_LEN) : '';
        if (!text) return;
        const name = playerByToken(room, identity.token)?.name ?? '?';
        broadcast(room, { type: 'chat_message', token: identity.token, name, text });
        return;
      }

      // ── leave ─────────────────────────────────────────────────────
      if (msg.type === 'leave') {
        const identity = wsIdentity.get(ws);
        if (identity) finalizeLeave(identity.roomCode, identity.token);
        return;
      }
    });

    ws.on('close', () => {
      const identity = wsIdentity.get(ws);
      if (!identity) return;
      wsIdentity.delete(ws);

      const room = rooms.get(identity.roomCode);
      if (!room) return;
      const player = playerByToken(room, identity.token);
      if (player) player.ws = null;

      const opponent = otherPlayer(room, identity.token);
      if (opponent?.ws) send(opponent.ws, { type: 'opponent_disconnected' });
      scheduleDisconnectCleanup(identity.roomCode, identity.token);
    });
  });

  console.log('[territory-clash-server] registered ws path: /territory-clash');
  return { wss, getRanking: ranking.getRanking };
}
