import { createHash, randomUUID } from 'node:crypto';
import { getReconnectGraceMs } from './reconnect-policy.mjs';
import { WebSocketServer } from 'ws';
import { createRankingStore } from './ranking-store.mjs';

const ROOM_CODE_LENGTH = 6;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const MAX_CHAT_LEN = 120;

const HOLE_COUNT = 9;
const COUNTDOWN_MS = 3000;      // "시작!" 전 카운트다운
const ROUND_MS = 30000;         // 라운드 총 길이
const MIN_SPAWN_DELAY_MS = 550; // 두더지가 사라진 뒤 다음 두더지가 나오기까지 최소 대기
const MAX_SPAWN_DELAY_MS = 950;
const VISIBLE_MS = 850;         // 두더지가 맞지 않고 버티는 최대 시간(이후 자동으로 사라짐)

/**
 * Room:
 * {
 *   hostToken, capacity,
 *   players: [{ token, name, ws, score }],
 *   disconnectTimers: Map<token, timer>,
 *   started: boolean,
 *   phase: 'lobby' | 'countdown' | 'playing' | 'game_over',
 *   roundEndsAt: number,           // Date.now() 기준 라운드 종료 예정 시각(스케줄링 판단용)
 *   moleSeq: number,
 *   activeMole: { moleId, hole, hideTimer } | null,
 *   spawnTimer: Timeout | null,
 *   countdownTimer: Timeout | null,
 * }
 */
export function registerMoleHuntServer() {
  const rooms = new Map();
  /** ws -> { roomCode, token } */
  const wsIdentity = new Map();
  const ranking = createRankingStore('mole-hunt');

  /** 라운드 종료 시점 최고점수를 기록한 전원을 승, 나머지를 패로 반영한다(전원 0점이면 기록하지 않음). */
  function recordResult(room) {
    const maxScore = Math.max(0, ...room.players.map(p => p.score));
    if (maxScore <= 0) return;
    for (const p of room.players) ranking.recordResult(p.name, p.score === maxScore);
  }

  /** 게임 도중 인원 미달로 조기 종료될 때는 점수와 무관하게 남은 한 명을 승자로 기록한다. */
  function recordForcedWinner(room, winnerToken) {
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
      const digest = createHash('sha256').update(`mole-hunt-${base}-${attempt}`).digest('hex');
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
    if (room.activeMole?.hideTimer) clearTimeout(room.activeMole.hideTimer);
    room.activeMole = null;
    if (room.spawnTimer) { clearTimeout(room.spawnTimer); room.spawnTimer = null; }
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

  function scoreboard(room) {
    return room.players
      .map(p => ({ token: p.token, name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);
  }

  // ── 게임 진행 ────────────────────────────────────────────────────
  function startCountdown(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    room.phase = 'countdown';
    for (const p of room.players) p.score = 0;
    broadcast(room, { type: 'game_starting', countdownMs: COUNTDOWN_MS });
    room.countdownTimer = setTimeout(() => startRound(roomCode), COUNTDOWN_MS);
  }

  function startRound(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    room.phase = 'playing';
    room.started = true;
    room.roundEndsAt = Date.now() + ROUND_MS;
    broadcast(room, { type: 'round_start', durationMs: ROUND_MS, scores: scoreboard(room) });
    scheduleNextSpawn(roomCode, 0);
  }

  function scheduleNextSpawn(roomCode, minDelay) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'playing') return;
    const delay = Math.max(minDelay, MIN_SPAWN_DELAY_MS + Math.random() * (MAX_SPAWN_DELAY_MS - MIN_SPAWN_DELAY_MS));
    if (Date.now() + delay >= room.roundEndsAt) {
      room.spawnTimer = setTimeout(() => endRound(roomCode), Math.max(0, room.roundEndsAt - Date.now()));
      return;
    }
    room.spawnTimer = setTimeout(() => spawnMole(roomCode), delay);
  }

  function spawnMole(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'playing') return;
    const moleId = ++room.moleSeq;
    const prevHole = room.lastHole;
    let hole = Math.floor(Math.random() * HOLE_COUNT);
    if (HOLE_COUNT > 1 && hole === prevHole) hole = (hole + 1 + Math.floor(Math.random() * (HOLE_COUNT - 1))) % HOLE_COUNT;
    room.lastHole = hole;

    const hideTimer = setTimeout(() => resolveMole(roomCode, moleId, null), VISIBLE_MS);
    room.activeMole = { moleId, hole, hideTimer, resolved: false };
    broadcast(room, { type: 'mole_spawn', moleId, hole, visibleMs: VISIBLE_MS });
  }

  function resolveMole(roomCode, moleId, hitToken) {
    const room = rooms.get(roomCode);
    if (!room || !room.activeMole || room.activeMole.moleId !== moleId || room.activeMole.resolved) return;
    const hole = room.activeMole.hole;
    room.activeMole.resolved = true;
    clearTimeout(room.activeMole.hideTimer);
    room.activeMole = null;

    if (hitToken) {
      const player = playerByToken(room, hitToken);
      if (player) player.score += 1;
    }

    broadcast(room, {
      type: 'mole_result',
      moleId,
      hole,
      hitToken: hitToken ?? null,
      hitName: hitToken ? nameOf(room, hitToken) : null,
      scores: scoreboard(room),
    });

    scheduleNextSpawn(roomCode, 0);
  }

  function endRound(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearRoundTimers(room);
    room.phase = 'game_over';
    room.started = false;
    recordResult(room);
    const scores = scoreboard(room);
    const topScore = scores[0]?.score ?? 0;
    const winnerTokens = topScore > 0 ? scores.filter(s => s.score === topScore).map(s => s.token) : [];
    broadcast(room, { type: 'game_over', scores, winnerTokens });
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

    // 게임 도중 이탈: 최소 인원(2명) 미만이면 남은 한 명의 승리로 즉시 종료.
    if (remaining.length < MIN_PLAYERS) {
      clearRoundTimers(room);
      room.phase = 'game_over';
      room.started = false;
      const winner = remaining[0] ?? null;
      recordForcedWinner(room, winner?.token ?? null);
      broadcast(room, {
        type: 'game_over',
        scores: scoreboard(room),
        winnerTokens: winner ? [winner.token] : [],
        opponentLeft: true,
      });
      return;
    }

    broadcast(room, { type: 'player_left', name: nameOf(room, leavingToken), scores: scoreboard(room) });
  }

  function scheduleDisconnectCleanup(roomCode, token) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearDisconnectTimer(room, token);
    const timer = setTimeout(() => finalizeLeave(roomCode, token), getReconnectGraceMs(room));
    room.disconnectTimers.set(token, timer);
  }

  // ── WebSocket 연결 처리 ──────────────────────────────────────────
  // server.mjs가 noServer 모드로 생성해 httpServer의 'upgrade' 이벤트에서 경로를 보고
  // 수동으로 이 인스턴스의 handleUpgrade를 호출해준다.
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
          players: [{ token, name, ws, score: 0 }],
          disconnectTimers: new Map(),
          started: false,
          phase: 'lobby',
          roundEndsAt: 0,
          moleSeq: 0,
          lastHole: -1,
          activeMole: null,
          spawnTimer: null,
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
        room.players.push({ token, name, ws, score: 0 });
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
              scores: scoreboard(room),
              activeMole: room.activeMole ? { moleId: room.activeMole.moleId, hole: room.activeMole.hole } : null,
              remainingMs: Math.max(0, room.roundEndsAt - Date.now()),
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

      // ── hit_mole ──────────────────────────────────────────────────
      if (msg.type === 'hit_mole') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room || room.phase !== 'playing') return;
        const moleId = Number(msg.moleId);
        if (!Number.isFinite(moleId)) return;
        resolveMole(identity.roomCode, moleId, identity.token);
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

  console.log('[mole-hunt-server] registered ws path: /mole-hunt');
  return { wss, getRanking: ranking.getRanking };
}
