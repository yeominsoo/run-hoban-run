import { createHash, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createRankingStore } from './ranking-store.mjs';

const ROOM_CODE_LENGTH = 6;
const RECONNECT_GRACE_MS = 45000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const MAX_CHAT_LEN = 120;

const TILE_COUNT = 4;
const START_LENGTH = 3;          // 1라운드 시퀀스 길이
const TILE_ON_MS = 550;          // 타일 하나가 밝아져 있는 시간
const TILE_GAP_MS = 220;         // 타일 사이 어두운 간격
const REVEAL_LEAD_MS = 700;      // 라운드 시작 후 첫 타일이 뜨기까지의 준비 시간
const COUNTDOWN_MS = 3000;       // 로비 "게임 시작" 클릭 후 1라운드가 실제로 시작되기까지의 카운트다운(두더지 사냥과 동일)
const INPUT_PER_TILE_MS = 1800;  // 입력 제한시간 계산용(시퀀스 길이당)
const INPUT_BUFFER_MS = 4000;
const ROUND_ADVANCE_DELAY_MS = 2600; // 라운드 결과를 보여준 뒤 다음 라운드까지 대기

/**
 * Room:
 * {
 *   hostToken, capacity,
 *   players: [{ token, name, ws }],
 *   disconnectTimers: Map<token, timer>,
 *   started: boolean,
 *   phase: 'lobby' | 'countdown' | 'reveal' | 'input' | 'round_over' | 'game_over',
 *   alive: Set<token>,
 *   sequence: number[],          // 누적 시퀀스(라운드마다 1개씩 늘어남)
 *   round: number,
 *   progress: Map<token, number>,  // 이번 라운드 입력 진행도
 *   cleared: Set<token>,           // 이번 라운드를 끝까지 맞춘 사람
 *   failed: Map<token, number>,    // 이번 라운드에 틀린 사람 -> 틀렸을 때의 진행도
 *   roundsCleared: Map<token, number>, // 지금까지 살아남은 라운드 수(동시 전멸 타이브레이크용)
 *   revealTimers: Timeout[],
 *   inputTimer: Timeout | null,
 *   nextRoundTimer: Timeout | null,
 *   countdownTimer: Timeout | null,
 * }
 */
export function registerMemorySequenceServer() {
  const rooms = new Map();
  /** ws -> { roomCode, token } */
  const wsIdentity = new Map();
  const ranking = createRankingStore('memory-sequence');

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
      const digest = createHash('sha256').update(`memory-sequence-${base}-${attempt}`).digest('hex');
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
    for (const t of room.revealTimers) clearTimeout(t);
    room.revealTimers = [];
    if (room.inputTimer) { clearTimeout(room.inputTimer); room.inputTimer = null; }
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
    room.sequence = [];
    room.round = 0;
    room.roundsCleared = new Map();
    room.started = true;
    startRound(roomCode);
  }

  function startRound(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearRoundTimers(room);
    room.round++;
    const targetLength = room.sequence.length === 0 ? START_LENGTH : room.sequence.length + 1;
    while (room.sequence.length < targetLength) {
      room.sequence.push(Math.floor(Math.random() * TILE_COUNT));
    }
    room.progress = new Map();
    room.cleared = new Set();
    room.failed = new Map();
    room.phase = 'reveal';

    broadcast(room, {
      type: 'round_start',
      round: room.round,
      sequenceLength: room.sequence.length,
      alive: aliveList(room),
    });

    room.sequence.forEach((tile, i) => {
      const delay = REVEAL_LEAD_MS + i * (TILE_ON_MS + TILE_GAP_MS);
      const timer = setTimeout(() => broadcast(room, { type: 'tile_reveal', index: i, tile }), delay);
      room.revealTimers.push(timer);
    });

    const revealTotalMs = REVEAL_LEAD_MS + room.sequence.length * (TILE_ON_MS + TILE_GAP_MS);
    const doneTimer = setTimeout(() => beginInputPhase(roomCode), revealTotalMs);
    room.revealTimers.push(doneTimer);
  }

  function beginInputPhase(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'reveal') return;
    room.phase = 'input';
    const inputTimeoutMs = room.sequence.length * INPUT_PER_TILE_MS + INPUT_BUFFER_MS;
    broadcast(room, { type: 'reveal_done', inputTimeoutMs });
    room.inputTimer = setTimeout(() => resolveRoundTimeout(roomCode), inputTimeoutMs);
  }

  function checkRoundDone(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'input') return;
    if (room.cleared.size + room.failed.size >= room.alive.size) {
      if (room.inputTimer) { clearTimeout(room.inputTimer); room.inputTimer = null; }
      resolveRound(roomCode);
    }
  }

  function resolveRoundTimeout(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'input') return;
    for (const token of room.alive) {
      if (!room.cleared.has(token) && !room.failed.has(token)) {
        room.failed.set(token, room.progress.get(token) || 0);
      }
    }
    resolveRound(roomCode);
  }

  function resolveRound(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    room.phase = 'round_over';

    for (const token of room.cleared) room.roundsCleared.set(token, room.round);
    for (const token of room.failed.keys()) room.alive.delete(token);

    const failedList = [...room.failed.entries()].map(([token, progress]) => ({ token, name: nameOf(room, token), progress }));
    broadcast(room, {
      type: 'round_result',
      round: room.round,
      sequenceLength: room.sequence.length,
      cleared: [...room.cleared].map(t => ({ token: t, name: nameOf(room, t) })),
      failed: failedList,
      alive: aliveList(room),
    });

    if (room.alive.size === 0) {
      // 이번 라운드에 살아있던 전원이 동시에 탈락 — 진행도가 더 깊었던 쪽을 우승으로 판정.
      const maxProgress = Math.max(0, ...failedList.map(f => f.progress));
      const winners = failedList.filter(f => f.progress === maxProgress).map(f => f.token);
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
    room.progress?.delete(leavingToken);
    room.cleared?.delete(leavingToken);
    room.failed?.delete(leavingToken);

    if (room.alive.size <= 1) {
      const winner = room.alive.size === 1 ? [...room.alive] : [];
      endGame(roomCode, winner);
      return;
    }
    if (room.phase === 'input') checkRoundDone(roomCode);
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
          players: [{ token, name, ws }],
          disconnectTimers: new Map(),
          started: false,
          phase: 'lobby',
          alive: new Set(),
          sequence: [],
          round: 0,
          progress: new Map(),
          cleared: new Set(),
          failed: new Map(),
          roundsCleared: new Map(),
          revealTimers: [],
          inputTimer: null,
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
          // 라운드 도중 재접속은 진행 중이던 reveal 애니메이션을 못 따라가므로, 다음 라운드를
          // 기다리는 화면으로 이어붙인다(할리갈리/두더지사냥과 동일한 "최선 노력" 재접속 정책).
          send(ws, {
            ...base,
            game: {
              round: room.round,
              sequenceLength: room.sequence.length,
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

      // ── tap_tile ──────────────────────────────────────────────────
      if (msg.type === 'tap_tile') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room || room.phase !== 'input') return;
        const { token, roomCode } = identity;
        if (!room.alive.has(token) || room.cleared.has(token) || room.failed.has(token)) return;
        const tile = Number(msg.tile);
        if (!Number.isInteger(tile) || tile < 0 || tile >= TILE_COUNT) return;

        const progressSoFar = room.progress.get(token) || 0;
        const expected = room.sequence[progressSoFar];

        if (tile === expected) {
          const next = progressSoFar + 1;
          room.progress.set(token, next);
          if (next >= room.sequence.length) {
            room.cleared.add(token);
            broadcast(room, { type: 'player_progress', token, name: nameOf(room, token), progress: next, status: 'cleared' });
          } else {
            broadcast(room, { type: 'player_progress', token, name: nameOf(room, token), progress: next, status: 'ongoing' });
          }
        } else {
          room.failed.set(token, progressSoFar);
          broadcast(room, { type: 'player_progress', token, name: nameOf(room, token), progress: progressSoFar, status: 'failed' });
        }
        checkRoundDone(roomCode);
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

  console.log('[memory-sequence-server] registered ws path: /memory-sequence');
  return { wss, getRanking: ranking.getRanking };
}
