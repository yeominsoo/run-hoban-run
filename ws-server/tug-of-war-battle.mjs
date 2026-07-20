import { createHash, randomUUID } from 'node:crypto';
import { getReconnectGraceMs } from './reconnect-policy.mjs';
import { WebSocketServer } from 'ws';
import { createRankingStore } from './ranking-store.mjs';

const ROOM_CODE_LENGTH = 6;
const MAX_CHAT_LEN = 120;

const COUNTDOWN_MS = 3000;
const WIN_THRESHOLD = 100;   // 이 값에 먼저 도달하는 쪽이 승리
const TAP_PULL = 2;          // 탭 1회당 자기 쪽으로 당기는 양
const MIN_TAP_INTERVAL_MS = 35; // 탭당 최소 간격(초당 약 28회 상한) — 매크로 연타 방지용 간단한 레이트리밋
const MATCH_MS = 30000;      // 30초 안에 승부가 안 나면 더 많이 당긴 쪽이 승리(동점이면 무승부)

/**
 * Room:
 * {
 *   hostToken, players: [{ token, name, ws, lastTapAt }],  // 정확히 2명, host=left(-), guest=right(+)
 *   disconnectTimers: Map<token, timer>,
 *   started: boolean,
 *   phase: 'lobby' | 'countdown' | 'playing' | 'game_over',
 *   position: number,           // -WIN_THRESHOLD(호스트 승) ~ +WIN_THRESHOLD(게스트 승)
 *   matchEndsAt: number,
 *   matchTimer: Timeout | null,
 *   countdownTimer: Timeout | null,
 * }
 */
export function registerTugOfWarBattleServer() {
  const rooms = new Map();
  /** ws -> { roomCode, token } */
  const wsIdentity = new Map();
  const ranking = createRankingStore('tug-of-war-battle');

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
      const digest = createHash('sha256').update(`tug-of-war-battle-${base}-${attempt}`).digest('hex');
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

    room.position = 0;
    for (const p of room.players) p.lastTapAt = 0;
    room.phase = 'playing';
    room.started = true;
    room.matchEndsAt = Date.now() + MATCH_MS;

    broadcast(room, {
      type: 'match_start',
      durationMs: MATCH_MS,
      winThreshold: WIN_THRESHOLD,
      leftName: room.players[0]?.name ?? '?',
      rightName: room.players[1]?.name ?? '?',
    });

    room.matchTimer = setTimeout(() => timeUpEndMatch(roomCode), MATCH_MS);
  }

  function timeUpEndMatch(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'playing') return;
    if (room.position < 0) endMatch(roomCode, room.players[0].token);
    else if (room.position > 0) endMatch(roomCode, room.players[1].token);
    else endMatch(roomCode, null);
  }

  function endMatch(roomCode, winnerToken) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'playing') return;
    clearRoundTimers(room);
    room.phase = 'game_over';
    room.started = false;

    const winner = winnerToken ? playerByToken(room, winnerToken) : null;
    recordResult(room, winnerToken);
    broadcast(room, {
      type: 'game_over',
      winnerToken: winnerToken ?? null,
      winnerName: winner?.name ?? null,
      finalPosition: room.position,
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
      // 호스트가 나가거나 아무도 안 남으면 방 자체를 없앤다(1:1 고정 매칭이라 호스트 교체 개념이 없음).
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
          players: [{ token, name, ws, lastTapAt: 0 }],
          disconnectTimers: new Map(),
          started: false,
          phase: 'lobby',
          position: 0,
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
        room.players.push({ token, name, ws, lastTapAt: 0 });
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
              winThreshold: WIN_THRESHOLD,
              position: room.position,
              remainingMs: Math.max(0, room.matchEndsAt - Date.now()),
              leftName: room.players[0]?.name ?? '?',
              rightName: room.players[1]?.name ?? '?',
            },
          });
        }
        if (opponent?.ws) send(opponent.ws, { type: 'opponent_reconnected' });
        return;
      }

      // ── tap ───────────────────────────────────────────────────────
      if (msg.type === 'tap') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room || room.phase !== 'playing') return;
        const player = playerByToken(room, identity.token);
        if (!player) return;

        const now = Date.now();
        if (now - player.lastTapAt < MIN_TAP_INTERVAL_MS) return;
        player.lastTapAt = now;

        const pull = side(room, identity.token) === 'left' ? -TAP_PULL : TAP_PULL;
        room.position = Math.max(-WIN_THRESHOLD, Math.min(WIN_THRESHOLD, room.position + pull));
        broadcast(room, { type: 'position_update', position: room.position });

        if (room.position <= -WIN_THRESHOLD) endMatch(identity.roomCode, room.players[0].token);
        else if (room.position >= WIN_THRESHOLD) endMatch(identity.roomCode, room.players[1].token);
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

  console.log('[tug-of-war-battle-server] registered ws path: /tug-of-war-battle');
  return { wss, getRanking: ranking.getRanking };
}
