import { createHash, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createRankingStore } from './ranking-store.mjs';

const ROOM_CODE_LENGTH = 6;
const RECONNECT_GRACE_MS = 45000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const MAX_CHAT_LEN = 120;

const COUNTDOWN_MS = 3000;
const COLORS = ['red', 'blue', 'green', 'yellow']; // 4색 — 순서 기억 챌린지의 4타일과 동일 계열
const PROBLEM_INTERVAL_MS = 2200; // 스트룹 간섭(글자 뜻 vs 실제 색)을 처리할 시간을 감안해 홀짝 암산(2.5초)과 비슷하게
const ROUND_MS = 40000;           // 라운드 길이(약 18문제)

/**
 * Room:
 * {
 *   hostToken, capacity,
 *   players: [{ token, name, ws, correctCount, totalLatencyMs, answeredThisProblem }],
 *   disconnectTimers: Map<token, timer>,
 *   started: boolean,
 *   phase: 'lobby' | 'countdown' | 'playing' | 'game_over',
 *   problemIndex: number,
 *   currentProblem: { word, displayColor, shownAt } | null,
 *   roundEndsAt: number,
 *   problemInterval: Timeout | null,
 *   roundTimer: Timeout | null,
 *   countdownTimer: Timeout | null,
 * }
 */
export function registerColorInstructionServer() {
  const rooms = new Map();
  /** ws -> { roomCode, token } */
  const wsIdentity = new Map();
  const ranking = createRankingStore('color-instruction');

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
      const digest = createHash('sha256').update(`color-instruction-${base}-${attempt}`).digest('hex');
      code = digest.slice(0, ROOM_CODE_LENGTH).toUpperCase();
      attempt++;
    } while (rooms.has(code));
    return code;
  }

  function playerByToken(room, token) { return room.players.find(p => p.token === token); }
  function nameOf(room, token) { return playerByToken(room, token)?.name ?? '?'; }

  function clearDisconnectTimer(room, token) {
    const t = room.disconnectTimers.get(token);
    if (t) { clearTimeout(t); room.disconnectTimers.delete(token); }
  }
  function clearAllDisconnectTimers(room) {
    room.players.forEach(p => clearDisconnectTimer(room, p.token));
  }
  function clearRoundTimers(room) {
    if (room.problemInterval) { clearInterval(room.problemInterval); room.problemInterval = null; }
    if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
    if (room.countdownTimer) { clearTimeout(room.countdownTimer); room.countdownTimer = null; }
  }

  // ── 로비 브로드캐스트 ────────────────────────────────────────────
  function broadcastLobbyUpdate(room, roomCode) {
    const playerList = room.players.map(p => ({
      name: p.name,
      isHost: p.token === room.hostToken,
      connected: !!p.ws,
    }));
    for (const p of room.players) {
      if (p.ws) {
        send(p.ws, {
          type: 'lobby_update',
          players: playerList,
          roomCode,
          isHost: p.token === room.hostToken,
          canStart: room.players.filter(x => x.ws).length >= MIN_PLAYERS && p.token === room.hostToken,
        });
      }
    }
  }

  function progressBoard(room) {
    return room.players.map(p => ({ token: p.token, name: p.name, correctCount: p.correctCount }));
  }

  function randColor() { return COLORS[Math.floor(Math.random() * COLORS.length)]; }

  // ── 게임 진행 ────────────────────────────────────────────────────
  function startCountdown(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    room.phase = 'countdown';
    broadcast(room, { type: 'game_starting', countdownMs: COUNTDOWN_MS });
    room.countdownTimer = setTimeout(() => startGame(roomCode), COUNTDOWN_MS);
  }

  function startGame(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    const connected = room.players.filter(p => p.ws);
    if (connected.length < MIN_PLAYERS) return;

    for (const p of room.players) {
      p.correctCount = 0;
      p.totalLatencyMs = 0;
      p.answeredThisProblem = false;
    }
    room.problemIndex = 0;
    room.phase = 'playing';
    room.started = true;
    room.roundEndsAt = Date.now() + ROUND_MS;

    broadcast(room, { type: 'round_start', durationMs: ROUND_MS, colors: COLORS, board: progressBoard(room) });

    nextProblem(roomCode);
    room.problemInterval = setInterval(() => nextProblem(roomCode), PROBLEM_INTERVAL_MS);
    room.roundTimer = setTimeout(() => endRound(roomCode), ROUND_MS);
  }

  function nextProblem(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'playing') return;
    room.problemIndex++;
    const word = randColor();
    const displayColor = randColor();
    room.currentProblem = { word, displayColor, shownAt: Date.now() };
    for (const p of room.players) p.answeredThisProblem = false;
    broadcast(room, { type: 'problem', index: room.problemIndex, word, displayColor });
  }

  function endRound(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'playing') return;
    clearRoundTimers(room);
    room.phase = 'game_over';
    room.started = false;

    const ranked = [...room.players].sort((a, b) => {
      if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
      const avgA = a.correctCount > 0 ? a.totalLatencyMs / a.correctCount : Infinity;
      const avgB = b.correctCount > 0 ? b.totalLatencyMs / b.correctCount : Infinity;
      return avgA - avgB;
    });
    const results = ranked.map((p, i) => ({
      token: p.token, name: p.name, rank: i + 1, correctCount: p.correctCount,
      avgMs: p.correctCount > 0 ? Math.round(p.totalLatencyMs / p.correctCount) : null,
    }));
    const winner = ranked[0]?.correctCount > 0 ? ranked[0] : null;

    recordResult(room, winner?.token ?? null);
    broadcast(room, {
      type: 'game_over',
      results,
      totalProblems: room.problemIndex,
      winnerToken: winner?.token ?? null,
      winnerName: winner?.name ?? null,
    });
  }

  // ── 이탈/재접속 처리 ─────────────────────────────────────────────
  function finalizeLeave(roomCode, leavingToken) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearAllDisconnectTimers(room);

    const leavingIsHost = room.hostToken === leavingToken;
    const remaining = room.players.filter(p => p.token !== leavingToken);
    room.players = remaining;
    if (remaining.length === 0) { clearRoundTimers(room); rooms.delete(roomCode); return; }
    if (leavingIsHost) {
      const newHost = remaining.find(p => p.ws) || remaining[0];
      room.hostToken = newHost.token;
    }
    wsIdentity.forEach((id, ws) => { if (id.token === leavingToken) wsIdentity.delete(ws); });

    if (!room.started) broadcastLobbyUpdate(room, roomCode);
  }

  function scheduleDisconnectCleanup(roomCode, token) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearDisconnectTimer(room, token);
    const timer = setTimeout(() => finalizeLeave(roomCode, token), RECONNECT_GRACE_MS);
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
        const capacity = Math.min(Math.max(Number(msg.capacity) || 6, MIN_PLAYERS), MAX_PLAYERS);
        const roomCode = genRoomCode();
        const token = randomUUID();
        rooms.set(roomCode, {
          hostToken: token, capacity,
          players: [{ token, name, ws, correctCount: 0, totalLatencyMs: 0, answeredThisProblem: false }],
          disconnectTimers: new Map(),
          started: false,
          phase: 'lobby',
          problemIndex: 0,
          currentProblem: null,
          roundEndsAt: 0,
          problemInterval: null,
          roundTimer: null,
          countdownTimer: null,
        });
        wsIdentity.set(ws, { roomCode, token });
        send(ws, { type: 'room_created', roomCode, token, capacity });
        return;
      }

      // ── join ──────────────────────────────────────────────────
      if (msg.type === 'join') {
        const name = sanitizeName(msg.name);
        const roomCode = sanitizeRoomCode(msg.roomCode);
        const room = rooms.get(roomCode);
        if (!room) { send(ws, { type: 'error', message: '방을 찾을 수 없습니다.' }); return; }
        if (room.started) { send(ws, { type: 'error', message: '이미 시작된 게임입니다.' }); return; }

        const staleIndex = room.players.findIndex(p => !p.ws && p.name === name);
        let inheritsHost = false;
        if (staleIndex !== -1) {
          const stale = room.players[staleIndex];
          clearDisconnectTimer(room, stale.token);
          room.players.splice(staleIndex, 1);
          inheritsHost = room.hostToken === stale.token;
        }

        if (room.players.length >= room.capacity) { send(ws, { type: 'error', message: '인원이 가득 찬 방입니다.' }); return; }

        const token = randomUUID();
        room.players.push({ token, name, ws, correctCount: 0, totalLatencyMs: 0, answeredThisProblem: false });
        wsIdentity.set(ws, { roomCode, token });
        if (inheritsHost) room.hostToken = token;

        send(ws, { type: 'joined_lobby', roomCode, token });
        broadcastLobbyUpdate(room, roomCode);
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

        const playersList = room.players.map(p => ({ name: p.name, isHost: p.token === room.hostToken, connected: !!p.ws }));
        const base = { type: 'rejoined', roomCode, token, started: room.started, phase: room.phase, players: playersList };

        if (!room.started || room.phase === 'lobby') {
          send(ws, base);
        } else {
          send(ws, {
            ...base,
            game: {
              colors: COLORS,
              remainingMs: Math.max(0, room.roundEndsAt - Date.now()),
              problem: room.currentProblem ? { index: room.problemIndex, word: room.currentProblem.word, displayColor: room.currentProblem.displayColor } : null,
              myCorrectCount: player.correctCount,
              board: progressBoard(room),
            },
          });
        }

        const others = room.players.filter(p => p.token !== token);
        for (const p of others) {
          if (p.ws) send(p.ws, { type: 'player_reconnected', token, name: player.name });
        }
        if (!room.started) broadcastLobbyUpdate(room, roomCode);
        return;
      }

      // ── start (host only) ───────────────────────────────────────
      if (msg.type === 'start') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room) return;
        if (identity.token !== room.hostToken) return;
        if (room.started) return;
        if (room.players.filter(p => p.ws).length < MIN_PLAYERS) return;

        startCountdown(identity.roomCode);
        return;
      }

      // ── answer ─────────────────────────────────────────────────────
      if (msg.type === 'answer') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room || room.phase !== 'playing' || !room.currentProblem) return;
        const player = playerByToken(room, identity.token);
        if (!player || player.answeredThisProblem) return;

        const value = typeof msg.value === 'string' && COLORS.includes(msg.value) ? msg.value : null;
        if (value && value === room.currentProblem.displayColor) {
          player.answeredThisProblem = true;
          player.correctCount++;
          player.totalLatencyMs += Date.now() - room.currentProblem.shownAt;
          send(ws, { type: 'answer_result', correct: true, correctCount: player.correctCount });
          broadcast(room, { type: 'progress_update', board: progressBoard(room) });
        } else {
          send(ws, { type: 'answer_result', correct: false });
        }
        return;
      }

      // ── submit_chat ───────────────────────────────────────────────
      if (msg.type === 'submit_chat') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room) return;
        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, MAX_CHAT_LEN) : '';
        if (!text) return;
        const name = nameOf(room, identity.token);
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

      if (!room.started) {
        broadcastLobbyUpdate(room, identity.roomCode);
      } else {
        const others = room.players.filter(p => p.token !== identity.token);
        for (const p of others) {
          if (p.ws) send(p.ws, { type: 'player_disconnected', token: identity.token, name: player?.name ?? '?' });
        }
      }
      scheduleDisconnectCleanup(identity.roomCode, identity.token);
    });
  });

  console.log('[color-instruction-server] registered ws path: /color-instruction');
  return { wss, getRanking: ranking.getRanking };
}
