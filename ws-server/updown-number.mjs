import { createHash, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createRankingStore } from './ranking-store.mjs';

const ROOM_CODE_LENGTH = 6;
const RECONNECT_GRACE_MS = 45000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const MAX_CHAT_LEN = 120;

const COUNTDOWN_MS = 3000;      // "게임 시작" 클릭 후 실제 라운드 시작까지의 카운트다운(두더지 사냥과 동일)
const NUMBER_MIN = 1;
const NUMBER_MAX = 100;         // 1~100 — 이진탐색으로 최대 7번이면 맞힐 수 있는 익숙한 범위
const ROUND_MS = 60000;         // 라운드 길이. 반응속도 게임(두더지 사냥 30초)과 달리 매 시도마다
                                 // 힌트를 읽고 다음 수를 생각할 시간이 필요해 더 길게 잡았다.

/**
 * Room:
 * {
 *   hostToken, capacity,
 *   players: [{ token, name, ws, guessCount, solved, finishOrder, lastGuess }],
 *   disconnectTimers: Map<token, timer>,
 *   started: boolean,
 *   phase: 'lobby' | 'countdown' | 'playing' | 'game_over',
 *   secret: number | null,
 *   roundEndsAt: number,
 *   finishCounter: number,      // 몇 번째로 맞혔는지 순번 발급용
 *   roundTimer: Timeout | null,
 *   countdownTimer: Timeout | null,
 * }
 */
export function registerUpdownNumberServer() {
  const rooms = new Map();
  /** ws -> { roomCode, token } */
  const wsIdentity = new Map();
  const ranking = createRankingStore('updown-number');

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
      const digest = createHash('sha256').update(`updown-number-${base}-${attempt}`).digest('hex');
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

  // 진행 현황판 — 맞힌 사람은 순번, 아직 못 맞힌 사람은 시도 횟수만 공개하고 실제로 어떤
  // 숫자를 불렀는지·힌트가 뭐였는지는 절대 포함하지 않는다(서버 권위 원칙: 정답 유추에
  // 쓰일 수 있는 정보는 필드 자체를 만들지 않는다).
  function progressBoard(room) {
    return room.players.map(p => ({
      token: p.token, name: p.name, guessCount: p.guessCount, solved: p.solved,
      finishOrder: p.solved ? p.finishOrder : null,
    }));
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

    for (const p of room.players) {
      p.guessCount = 0;
      p.solved = false;
      p.finishOrder = null;
      p.lastGuess = null;
    }
    room.secret = NUMBER_MIN + Math.floor(Math.random() * (NUMBER_MAX - NUMBER_MIN + 1));
    room.finishCounter = 0;
    room.phase = 'playing';
    room.started = true;
    room.roundEndsAt = Date.now() + ROUND_MS;

    broadcast(room, {
      type: 'round_start',
      durationMs: ROUND_MS,
      min: NUMBER_MIN,
      max: NUMBER_MAX,
      board: progressBoard(room),
    });

    room.roundTimer = setTimeout(() => endRound(roomCode), ROUND_MS);
  }

  function checkAllSolved(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'playing') return;
    const connected = room.players.filter(p => p.ws);
    if (connected.length > 0 && connected.every(p => p.solved)) endRound(roomCode);
  }

  function endRound(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'playing') return;
    clearRoundTimers(room);
    room.phase = 'game_over';
    room.started = false;

    const finishers = room.players
      .filter(p => p.solved)
      .sort((a, b) => a.finishOrder - b.finishOrder);
    const others = room.players
      .filter(p => !p.solved)
      .sort((a, b) => {
        const da = a.lastGuess === null ? Infinity : Math.abs(a.lastGuess - room.secret);
        const db = b.lastGuess === null ? Infinity : Math.abs(b.lastGuess - room.secret);
        return da - db;
      });

    const ranked = [...finishers, ...others];
    const results = ranked.map((p, i) => ({
      token: p.token, name: p.name, rank: i + 1, guessCount: p.guessCount, solved: p.solved,
    }));
    const winner = finishers[0] ?? null;

    recordResult(room, winner?.token ?? null);
    broadcast(room, {
      type: 'game_over',
      secret: room.secret,
      results,
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

    if (!room.started) {
      broadcastLobbyUpdate(room, roomCode);
      return;
    }
    if (room.phase === 'playing') checkAllSolved(roomCode);
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
          players: [{ token, name, ws, guessCount: 0, solved: false, finishOrder: null, lastGuess: null }],
          disconnectTimers: new Map(),
          started: false,
          phase: 'lobby',
          secret: null,
          roundEndsAt: 0,
          finishCounter: 0,
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
        room.players.push({ token, name, ws, guessCount: 0, solved: false, finishOrder: null, lastGuess: null });
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
              min: NUMBER_MIN,
              max: NUMBER_MAX,
              remainingMs: Math.max(0, room.roundEndsAt - Date.now()),
              myGuessCount: player.guessCount,
              mySolved: player.solved,
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

      // ── guess ─────────────────────────────────────────────────────
      if (msg.type === 'guess') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room || room.phase !== 'playing') return;
        const player = playerByToken(room, identity.token);
        if (!player || player.solved) return;

        const guess = Number(msg.number);
        if (!Number.isInteger(guess) || guess < NUMBER_MIN || guess > NUMBER_MAX) return;

        player.guessCount++;
        player.lastGuess = guess;

        if (guess === room.secret) {
          player.solved = true;
          player.finishOrder = ++room.finishCounter;
          send(ws, { type: 'guess_result', number: guess, hint: 'correct', guessCount: player.guessCount });
          broadcast(room, { type: 'solved_announce', name: player.name, guessCount: player.guessCount, finishOrder: player.finishOrder });
        } else {
          const hint = guess < room.secret ? 'up' : 'down';
          send(ws, { type: 'guess_result', number: guess, hint, guessCount: player.guessCount });
        }

        broadcast(room, { type: 'progress_update', board: progressBoard(room) });
        if (player.solved) checkAllSolved(identity.roomCode);
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
        if (room.phase === 'playing') checkAllSolved(identity.roomCode);
      }
      scheduleDisconnectCleanup(identity.roomCode, identity.token);
    });
  });

  console.log('[updown-number-server] registered ws path: /updown-number');
  return { wss, getRanking: ranking.getRanking };
}
