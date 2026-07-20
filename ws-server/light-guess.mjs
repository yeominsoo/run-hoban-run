import { createHash, randomUUID } from 'node:crypto';
import { getReconnectGraceMs } from './reconnect-policy.mjs';
import { WebSocketServer } from 'ws';
import { createRankingStore } from './ranking-store.mjs';

const ROOM_CODE_LENGTH = 6;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const MAX_CHAT_LEN = 120;

const COUNTDOWN_MS = 3000;
const GREEN_MIN_MS = 2000;   // 초록불(자유롭게 탭) 최소 지속시간
const GREEN_MAX_MS = 4500;   // 최대 지속시간 — 언제 빨간불로 바뀔지 예측 못 하게 무작위
const RED_MS = 1200;         // 빨간불(정지) 지속시간 — 이 사이 탭하면 즉시 탈락
const ROUND_ADVANCE_DELAY_MS = 2000; // 라운드 결과를 보여준 뒤 다음 라운드까지 대기

/**
 * Room:
 * {
 *   hostToken, capacity,
 *   players: [{ token, name, ws }],
 *   disconnectTimers: Map<token, timer>,
 *   started: boolean,
 *   phase: 'lobby' | 'countdown' | 'green' | 'red' | 'round_over' | 'game_over',
 *   alive: Set<token>,
 *   round: number,
 *   hasTappedThisGreen: Map<token, boolean>,
 *   eliminatedAt: Map<token, number>,   // 동시 전멸 타이브레이크용(더 늦게 탈락한 쪽이 우승)
 *   greenTimer: Timeout | null,
 *   redTimer: Timeout | null,
 *   nextRoundTimer: Timeout | null,
 *   countdownTimer: Timeout | null,
 * }
 */
export function registerLightGuessServer() {
  const rooms = new Map();
  /** ws -> { roomCode, token } */
  const wsIdentity = new Map();
  const ranking = createRankingStore('light-guess');

  function recordResult(room, winnerTokens) {
    if (!winnerTokens || winnerTokens.length === 0) return;
    for (const p of room.players) ranking.recordResult(p.name, winnerTokens.includes(p.token));
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
      const digest = createHash('sha256').update(`light-guess-${base}-${attempt}`).digest('hex');
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
    if (room.greenTimer) { clearTimeout(room.greenTimer); room.greenTimer = null; }
    if (room.redTimer) { clearTimeout(room.redTimer); room.redTimer = null; }
    if (room.nextRoundTimer) { clearTimeout(room.nextRoundTimer); room.nextRoundTimer = null; }
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

  function aliveList(room) {
    return [...room.alive].map(t => ({ token: t, name: nameOf(room, t) }));
  }

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

    room.alive = new Set(connected.map(p => p.token));
    room.round = 0;
    room.eliminatedAt = new Map();
    room.started = true;
    startRound(roomCode);
  }

  function startRound(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearRoundTimers(room);
    room.round++;
    room.hasTappedThisGreen = new Map([...room.alive].map(t => [t, false]));
    room.phase = 'green';

    const greenMs = GREEN_MIN_MS + Math.floor(Math.random() * (GREEN_MAX_MS - GREEN_MIN_MS + 1));
    broadcast(room, { type: 'round_start', round: room.round, alive: aliveList(room), greenMs });
    room.greenTimer = setTimeout(() => beginRed(roomCode), greenMs);
  }

  function beginRed(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'green') return;
    room.phase = 'red';

    const stopped = [...room.alive].filter(t => !room.hasTappedThisGreen.get(t));
    const now = Date.now();
    for (const t of stopped) { room.alive.delete(t); room.eliminatedAt.set(t, now); }

    broadcast(room, {
      type: 'light_on',
      redMs: RED_MS,
      eliminatedForStopping: stopped.map(t => ({ token: t, name: nameOf(room, t) })),
      alive: aliveList(room),
    });

    if (room.alive.size <= 1) {
      room.redTimer = null;
      finishOrAdvance(roomCode);
      return;
    }
    room.redTimer = setTimeout(() => endRedPhase(roomCode), RED_MS);
  }

  function endRedPhase(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'red') return;
    finishOrAdvance(roomCode);
  }

  function finishOrAdvance(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    room.phase = 'round_over';
    broadcast(room, { type: 'round_result', round: room.round, alive: aliveList(room) });

    if (room.alive.size === 0) {
      // 이번 라운드에 생존자 전원이 동시에 탈락 — 가장 늦게 탈락한(=오래 버틴) 쪽이 우승.
      const maxAt = Math.max(0, ...room.eliminatedAt.values());
      const winners = [...room.eliminatedAt.entries()].filter(([, at]) => at === maxAt).map(([t]) => t);
      endGame(roomCode, winners);
    } else if (room.alive.size === 1) {
      endGame(roomCode, [...room.alive]);
    } else {
      room.nextRoundTimer = setTimeout(() => startRound(roomCode), ROUND_ADVANCE_DELAY_MS);
    }
  }

  function endGame(roomCode, winnerTokens) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearRoundTimers(room);
    room.phase = 'game_over';
    room.started = false;
    recordResult(room, winnerTokens);
    broadcast(room, {
      type: 'game_over',
      winnerTokens,
      winnerNames: winnerTokens.map(t => nameOf(room, t)),
      finalRound: room.round,
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

    if (!room.started) {
      broadcastLobbyUpdate(room, roomCode);
      return;
    }

    room.alive.delete(leavingToken);
    room.hasTappedThisGreen?.delete(leavingToken);

    if (room.alive.size <= 1 && (room.phase === 'green' || room.phase === 'red')) {
      const winner = room.alive.size === 1 ? [...room.alive] : [];
      endGame(roomCode, winner);
    }
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
        const capacity = Math.min(Math.max(Number(msg.capacity) || 6, MIN_PLAYERS), MAX_PLAYERS);
        const roomCode = genRoomCode();
        const token = randomUUID();
        rooms.set(roomCode, {
          hostToken: token, capacity,
          players: [{ token, name, ws }],
          disconnectTimers: new Map(),
          started: false,
          phase: 'lobby',
          alive: new Set(),
          round: 0,
          hasTappedThisGreen: new Map(),
          eliminatedAt: new Map(),
          greenTimer: null,
          redTimer: null,
          nextRoundTimer: null,
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
        room.players.push({ token, name, ws });
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
              round: room.round,
              phase: room.phase === 'green' || room.phase === 'countdown' ? 'green' : room.phase,
              alive: aliveList(room),
              amAlive: room.alive.has(token),
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

      // ── tap ───────────────────────────────────────────────────────
      if (msg.type === 'tap') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room) return;
        const { token, roomCode } = identity;
        if (!room.alive.has(token)) return;

        if (room.phase === 'green') {
          room.hasTappedThisGreen.set(token, true);
        } else if (room.phase === 'red') {
          room.alive.delete(token);
          room.eliminatedAt.set(token, Date.now());
          broadcast(room, { type: 'caught_moving', token, name: nameOf(room, token), alive: aliveList(room) });
          if (room.alive.size <= 1) {
            if (room.redTimer) { clearTimeout(room.redTimer); room.redTimer = null; }
            finishOrAdvance(roomCode);
          }
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

  console.log('[light-guess-server] registered ws path: /light-guess');
  return { wss, getRanking: ranking.getRanking };
}
