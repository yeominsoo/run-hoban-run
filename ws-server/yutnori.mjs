import { createHash, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import {
  createYutGame,
  currentToken,
  buildBoardSnapshot,
  getAutoMoveRequest,
  submitThrow,
  submitMove,
  removePlayer,
  MAX_PLAYERS,
} from './yutnori-rules.mjs';

const ROOM_CODE_LENGTH = 6;
const RECONNECT_GRACE_MS = 45000; // rps/liar/mafia/halligalli와 동일한 재접속 유예 시간
const MIN_PLAYERS = 2;
const TURN_TIMEOUT_MS = 20000; // 차례인 사람이 20초간 아무 것도 안 하면 서버가 자동 던지기/이동을 수행한다

/**
 * Room:
 * {
 *   hostToken, capacity,
 *   players: [{ token, name, ws }],
 *   disconnectTimers: Map<token, timer>,
 *   started: boolean,
 *   phase: 'lobby' | 'playing' | 'game_over',
 *   game: GameState | null,   // yutnori-rules.mjs의 createYutGame() 결과 (mutate됨)
 *   turnTimer: Timeout | null,
 * }
 */
export function registerYutnoriServer() {
  const rooms = new Map();
  /** ws -> { roomCode, token } */
  const wsIdentity = new Map();

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
      const digest = createHash('sha256').update(`yutnori-${base}-${attempt}`).digest('hex');
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
  function clearTurnTimer(room) {
    if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
  }
  function armTurnTimer(roomCode, room) {
    clearTurnTimer(room);
    room.turnTimer = setTimeout(() => {
      if (room.phase !== 'playing') return;
      const token = currentToken(room.game);
      if (room.game.phase === 'throw') {
        handleSubmitThrow(room, roomCode, token, true);
      } else {
        handleAutoMove(room, roomCode, token);
      }
    }, TURN_TIMEOUT_MS);
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

  function buildGamePayload(room) {
    const game = room.game;
    return {
      board: buildBoardSnapshot(game),
      players: game.tokens.map(token => ({ token, name: nameOf(room, token), connected: !!playerByToken(room, token)?.ws })),
      currentTurnToken: game.turnOrder[game.turnIndex] ?? null,
      phase: game.phase,
      pendingThrows: game.pendingThrows.map(pt => ({ id: pt.id, result: pt.result })),
      awaitingBranch: game.awaitingBranch,
    };
  }

  function broadcastGameUpdate(room, event) {
    broadcast(room, { type: 'game_update', ...buildGamePayload(room), event: event ?? null });
  }

  // ── 게임 진행 ────────────────────────────────────────────────────
  function startGame(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    const connected = room.players.filter(p => p.ws);
    if (connected.length < MIN_PLAYERS || connected.length > MAX_PLAYERS) return;

    room.game = createYutGame(connected.map(p => p.token), Math.random);
    room.started = true;
    room.phase = 'playing';

    armTurnTimer(roomCode, room);
    broadcastGameUpdate(room, null);
  }

  function handleSubmitThrow(room, roomCode, token, timedOut = false) {
    if (room.phase !== 'playing') return;
    if (currentToken(room.game) !== token) return;
    let result;
    try {
      result = submitThrow(room.game);
    } catch { return; }
    armTurnTimer(roomCode, room);
    broadcastGameUpdate(room, { kind: 'throw', token, name: nameOf(room, token), result, timedOut });
  }

  function applyMoveOutcome(room, roomCode, token, outcome, timedOut = false) {
    armTurnTimer(roomCode, room);
    const event = {
      kind: outcome.event.capturedPieceIds.length ? 'capture' : 'move',
      token,
      name: nameOf(room, token),
      pieceId: outcome.event.pieceId,
      path: outcome.event.path,
      capturedPieceIds: outcome.event.capturedPieceIds,
      joinedPieceIds: outcome.event.joinedPieceIds,
      bonusThrow: outcome.bonusThrow,
      timedOut,
    };
    broadcastGameUpdate(room, event);

    if (outcome.gameOver) {
      clearTurnTimer(room);
      room.phase = 'game_over';
      room.started = false;
      broadcast(room, {
        type: 'game_over',
        winnerToken: room.game.winner,
        winnerName: nameOf(room, room.game.winner),
        board: buildBoardSnapshot(room.game),
      });
    }
  }

  function handleAutoMove(room, roomCode, token) {
    if (room.phase !== 'playing') return;
    if (currentToken(room.game) !== token) return;
    const req = getAutoMoveRequest(room.game);
    if (!req) {
      armTurnTimer(roomCode, room);
      broadcastGameUpdate(room, { kind: 'auto_no_move', token, name: nameOf(room, token), timedOut: true });
      return;
    }

    let outcome;
    try {
      outcome = submitMove(room.game, req);
      if (outcome.status === 'awaiting-branch') {
        outcome = submitMove(room.game, {
          pieceId: outcome.branch.pieceId,
          pendingThrowId: outcome.branch.pendingThrowId,
          branch: 'straight',
        });
      }
    } catch { return; }
    if (outcome.status !== 'applied') return;
    applyMoveOutcome(room, roomCode, token, outcome, true);
  }

  function handleSubmitMove(room, roomCode, token, msg) {
    if (room.phase !== 'playing') return;
    if (currentToken(room.game) !== token) return;
    const req = {
      pieceId: String(msg.pieceId ?? ''),
      pendingThrowId: String(msg.pendingThrowId ?? ''),
      splitOff: !!msg.splitOff,
      branch: msg.branch === 'straight' || msg.branch === 'shortcut' ? msg.branch : undefined,
    };
    let outcome;
    try {
      outcome = submitMove(room.game, req);
    } catch { return; }

    if (outcome.status === 'awaiting-branch') {
      const player = playerByToken(room, token);
      if (player?.ws) send(player.ws, { type: 'await_branch', ...outcome.branch });
      armTurnTimer(roomCode, room);
      return;
    }

    applyMoveOutcome(room, roomCode, token, outcome);
  }

  // ── 이탈/재접속 처리 ─────────────────────────────────────────────
  function finalizeLeave(roomCode, leavingToken) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearAllDisconnectTimers(room);

    const leavingName = playerByToken(room, leavingToken)?.name ?? '?';
    const leavingIsHost = room.hostToken === leavingToken;
    const remaining = room.players.filter(p => p.token !== leavingToken);
    room.players = remaining;
    if (remaining.length === 0) { clearTurnTimer(room); rooms.delete(roomCode); return; }
    if (leavingIsHost) {
      const newHost = remaining.find(p => p.ws) || remaining[0];
      room.hostToken = newHost.token;
    }
    wsIdentity.forEach((id, ws) => { if (id.token === leavingToken) wsIdentity.delete(ws); });

    if (!room.started) {
      broadcastLobbyUpdate(room, roomCode);
      return;
    }

    removePlayer(room.game, leavingToken);

    if (room.game.turnOrder.length < MIN_PLAYERS) {
      clearTurnTimer(room);
      room.phase = 'game_over';
      room.started = false;
      const winnerToken = room.game.turnOrder[0] ?? null;
      broadcast(room, {
        type: 'game_over',
        winnerToken,
        winnerName: winnerToken ? nameOf(room, winnerToken) : null,
        board: buildBoardSnapshot(room.game),
        opponentLeft: true,
      });
      return;
    }

    armTurnTimer(roomCode, room);
    broadcastGameUpdate(room, { kind: 'player_left', name: leavingName });
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
        const capacity = Math.min(Math.max(Number(msg.capacity) || MAX_PLAYERS, MIN_PLAYERS), MAX_PLAYERS);
        const roomCode = genRoomCode();
        const token = randomUUID();
        rooms.set(roomCode, {
          hostToken: token, capacity,
          players: [{ token, name, ws }],
          disconnectTimers: new Map(),
          started: false,
          phase: 'lobby',
          game: null,
          turnTimer: null,
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
          send(ws, { ...base, game: buildGamePayload(room) });
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
        const connectedCount = room.players.filter(p => p.ws).length;
        if (connectedCount < MIN_PLAYERS || connectedCount > MAX_PLAYERS) return;

        broadcast(room, { type: 'game_starting' });
        startGame(identity.roomCode);
        return;
      }

      // ── submit_throw ─────────────────────────────────────────────
      if (msg.type === 'submit_throw') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room) return;
        handleSubmitThrow(room, identity.roomCode, identity.token);
        return;
      }

      // ── submit_move ───────────────────────────────────────────────
      if (msg.type === 'submit_move') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room) return;
        handleSubmitMove(room, identity.roomCode, identity.token, msg);
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

  console.log('[yutnori-server] registered ws path: /yutnori');
  return wss;
}
