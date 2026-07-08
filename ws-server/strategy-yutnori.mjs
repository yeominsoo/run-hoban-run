import { createHash, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import {
  createStrategyYutGame,
  currentMover,
  partnerOf,
  buildBoardSnapshot,
  submitFace,
  submitMove,
  getAutoMoveRequest,
  abandonGame,
  PLAYERS_REQUIRED,
} from './strategy-yutnori-rules.mjs';

const ROOM_CODE_LENGTH = 6;
const RECONNECT_GRACE_MS = 45000;
const FACE_TIMEOUT_MS = 20000; // 라운드마다 20초 안에 앞/뒷면을 제출하지 않으면 자동으로 '앞면' 제출 처리
const MOVE_TIMEOUT_MS = 20000; // 자기 차례에 20초 안에 말을 고르지 않으면 자동 이동 정책으로 말을 이동
const MAX_CHAT_LEN = 120;
const REACTIONS = {
  tease: { id: 'tease', emoji: '😜', label: '놀림' },
  sad: { id: 'sad', emoji: '😭', label: '슬픔' },
  smug: { id: 'smug', emoji: '😎', label: '의기양양' },
  cheer: { id: 'cheer', emoji: '👏', label: '응원' },
  shock: { id: 'shock', emoji: '😱', label: '충격' },
};

/**
 * Room:
 * {
 *   hostToken, players: [{ token, name, ws }],   // 정확히 4명이어야 시작 가능(팀은 join순서 (0,1)/(2,3))
 *   disconnectTimers: Map<token, timer>,
 *   started: boolean,
 *   phase: 'lobby' | 'playing' | 'game_over',
 *   game: GameState | null,
 *   roundTimer, moveTimer: Timeout | null,
 * }
 */
export function registerStrategyYutnoriServer() {
  const rooms = new Map();
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
      const digest = createHash('sha256').update(`strategy-yutnori-${base}-${attempt}`).digest('hex');
      code = digest.slice(0, ROOM_CODE_LENGTH).toUpperCase();
      attempt++;
    } while (rooms.has(code));
    return code;
  }

  function playerByToken(room, token) { return room.players.find(p => p.token === token); }
  function nameOf(room, token) { return playerByToken(room, token)?.name ?? '?'; }
  function sanitizeChatText(text) {
    return typeof text === 'string' ? text.trim().slice(0, MAX_CHAT_LEN) : '';
  }

  function clearDisconnectTimer(room, token) {
    const t = room.disconnectTimers.get(token);
    if (t) { clearTimeout(t); room.disconnectTimers.delete(token); }
  }
  function clearAllDisconnectTimers(room) {
    room.players.forEach(p => clearDisconnectTimer(room, p.token));
  }
  function clearRoundTimer(room) {
    if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
  }
  function clearMoveTimer(room) {
    if (room.moveTimer) { clearTimeout(room.moveTimer); room.moveTimer = null; }
  }
  function clearAllGameTimers(room) { clearRoundTimer(room); clearMoveTimer(room); }

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
          canStart: room.players.filter(x => x.ws).length === PLAYERS_REQUIRED && p.token === room.hostToken,
        });
      }
    }
  }

  function buildGamePayload(room) {
    const game = room.game;
    return {
      board: buildBoardSnapshot(game),
      players: game.tokens.map(token => ({ token, name: nameOf(room, token), connected: !!playerByToken(room, token)?.ws })),
      teams: game.teams,
      moveOrder: game.moveOrder,
      currentMoverToken: currentMover(game),
      phase: game.phase,
      submittedTokens: Object.keys(game.faces),
      lastThrow: game.lastThrow,
      round: game.round,
    };
  }

  function broadcastGameUpdate(room, event) {
    broadcast(room, { type: 'game_update', ...buildGamePayload(room), event: event ?? null });
  }

  function handleSubmitChat(room, token, msg) {
    const player = playerByToken(room, token);
    if (!player) return;
    const text = sanitizeChatText(msg.text);
    if (!text) return;
    broadcast(room, { type: 'chat_message', token, name: player.name, text, sentAt: Date.now() });
  }

  /** 파트너(팀원)에게만 보이는 전용 채널. 배신 가능한 게임이라 상대팀은 절대 못 본다. */
  function handleSubmitTeamChat(room, token, msg) {
    const player = playerByToken(room, token);
    if (!player || !room.game) return;
    const text = sanitizeChatText(msg.text);
    if (!text) return;
    let partnerToken;
    try { partnerToken = partnerOf(room.game, token); } catch { return; }
    const payload = { type: 'team_chat_message', token, name: player.name, text, sentAt: Date.now() };
    if (player.ws) send(player.ws, payload);
    const partner = playerByToken(room, partnerToken);
    if (partner?.ws) send(partner.ws, payload);
  }

  function handleSubmitReaction(room, token, msg) {
    const player = playerByToken(room, token);
    const reaction = REACTIONS[String(msg.reactionId ?? '')];
    if (!player || !reaction) return;
    broadcast(room, { type: 'reaction_message', token, name: player.name, reaction, sentAt: Date.now() });
  }

  function armFaceTimer(roomCode, room) {
    clearRoundTimer(room);
    if (room.game.phase !== 'collecting') return;
    room.roundTimer = setTimeout(() => {
      const game = room.game;
      if (!game || game.phase !== 'collecting') return;
      let autoSubmitted = null;
      const missingTokens = game.tokens.filter(token => !game.faces[token]);
      for (const token of missingTokens) {
        autoSubmitted = submitFace(game, token, 'front');
      }
      armMoveOrRoundTimer(roomCode, room);
      broadcastGameUpdate(room, autoSubmitted ? { kind: 'round_resolved', throw: autoSubmitted, timedOut: true } : null);
    }, FACE_TIMEOUT_MS);
  }

  function armMoveTimer(roomCode, room) {
    clearMoveTimer(room);
    if (room.game.phase !== 'moving') return;
    room.moveTimer = setTimeout(() => {
      const game = room.game;
      if (!game || game.phase !== 'moving') return;
      const token = currentMover(game);
      if (!token) return;
      const req = getAutoMoveRequest(game, token);
      if (!req) {
        armMoveOrRoundTimer(roomCode, room);
        broadcastGameUpdate(room, { kind: 'auto_no_move', token, name: nameOf(room, token), timedOut: true });
        return;
      }
      let outcome;
      try { outcome = submitMove(game, token, req); } catch { return; }
      if (outcome.status !== 'applied') return;
      handleMoveApplied(room, roomCode, { ...outcome, name: nameOf(room, token), timedOut: true });
    }, MOVE_TIMEOUT_MS);
  }

  function armMoveOrRoundTimer(roomCode, room) {
    if (room.game.phase === 'collecting') armFaceTimer(roomCode, room);
    else armMoveTimer(roomCode, room);
  }

  function startGame(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    const connected = room.players.filter(p => p.ws);
    if (connected.length !== PLAYERS_REQUIRED) return;

    room.game = createStrategyYutGame(connected.map(p => p.token));
    room.started = true;
    room.phase = 'playing';

    armFaceTimer(roomCode, room);
    broadcastGameUpdate(room, null);
  }

  function handleSubmitFace(room, roomCode, token, face) {
    if (room.phase !== 'playing') return;
    if (face !== 'front' && face !== 'back') return;
    let result;
    try {
      result = submitFace(room.game, token, face);
    } catch { return; }

    if (!result) {
      // 아직 4명 다 안 모임 — "누가 제출했는지"만 알려주고 값은 숨긴다.
      broadcastGameUpdate(room, { kind: 'face_submitted', token, name: nameOf(room, token) });
      return;
    }
    armMoveOrRoundTimer(roomCode, room);
    broadcastGameUpdate(room, { kind: 'round_resolved', throw: result });
  }

  function handleSubmitSignal(room, token, msg) {
    if (room.phase !== 'playing') return;
    const suggestion = msg.suggestion;
    if (suggestion !== 'front' && suggestion !== 'back' && suggestion !== 'free') return;
    let partnerToken;
    try { partnerToken = partnerOf(room.game, token); } catch { return; }
    const partner = playerByToken(room, partnerToken);
    if (partner?.ws) {
      send(partner.ws, { type: 'signal_received', fromToken: token, fromName: nameOf(room, token), suggestion });
    }
  }

  function handleMoveApplied(room, roomCode, outcome) {
    armMoveOrRoundTimer(roomCode, room);
    const event = {
      kind: outcome.capturedPieceIds.length ? 'capture' : 'move',
      token: outcome.token,
      name: outcome.name ?? nameOf(room, outcome.token),
      pieceId: outcome.pieceId,
      path: outcome.path,
      capturedPieceIds: outcome.capturedPieceIds,
      joinedPieceIds: outcome.joinedPieceIds,
      bonusThrow: !!outcome.bonusThrow,
      roundOver: outcome.roundOver,
      timedOut: !!outcome.timedOut,
    };
    broadcastGameUpdate(room, event);

    if (outcome.gameOver) {
      clearAllGameTimers(room);
      room.phase = 'game_over';
      room.started = false;
      let partnerToken = null;
      try { partnerToken = partnerOf(room.game, outcome.token); } catch { /* no-op */ }
      broadcast(room, {
        type: 'game_over',
        winnerToken: outcome.token,
        winnerName: nameOf(room, outcome.token),
        partnerToken,
        partnerName: partnerToken ? nameOf(room, partnerToken) : null,
        board: buildBoardSnapshot(room.game),
      });
    }
  }

  function handleSubmitMove(room, roomCode, token, msg) {
    if (room.phase !== 'playing') return;
    if (currentMover(room.game) !== token) return;
    const req = {
      pieceId: String(msg.pieceId ?? ''),
      splitOff: !!msg.splitOff,
    };
    let outcome;
    try {
      outcome = submitMove(room.game, token, req);
    } catch { return; }

    handleMoveApplied(room, roomCode, { ...outcome, name: nameOf(room, token) });
  }

  function finalizeLeave(roomCode, leavingToken) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearAllDisconnectTimers(room);

    const leavingIsHost = room.hostToken === leavingToken;
    const remaining = room.players.filter(p => p.token !== leavingToken);
    room.players = remaining;
    if (remaining.length === 0) { clearAllGameTimers(room); rooms.delete(roomCode); return; }
    if (leavingIsHost) {
      const newHost = remaining.find(p => p.ws) || remaining[0];
      room.hostToken = newHost.token;
    }
    wsIdentity.forEach((id, ws) => { if (id.token === leavingToken) wsIdentity.delete(ws); });

    if (!room.started) {
      broadcastLobbyUpdate(room, roomCode);
      return;
    }

    // 4인 고정 게임이라 한 명이라도 이탈하면 계속 진행이 불가능 — 즉시 종료.
    clearAllGameTimers(room);
    abandonGame(room.game, leavingToken);
    room.phase = 'game_over';
    room.started = false;
    const winnerToken = room.game.winner;
    broadcast(room, {
      type: 'game_over',
      winnerToken,
      winnerName: winnerToken ? nameOf(room, winnerToken) : null,
      partnerToken: null,
      partnerName: null,
      board: buildBoardSnapshot(room.game),
      opponentLeft: true,
    });
  }

  function scheduleDisconnectCleanup(roomCode, token) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearDisconnectTimer(room, token);
    const timer = setTimeout(() => finalizeLeave(roomCode, token), RECONNECT_GRACE_MS);
    room.disconnectTimers.set(token, timer);
  }

  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'create') {
        const name = sanitizeName(msg.name);
        const roomCode = genRoomCode();
        const token = randomUUID();
        rooms.set(roomCode, {
          hostToken: token, capacity: PLAYERS_REQUIRED,
          players: [{ token, name, ws }],
          disconnectTimers: new Map(),
          started: false,
          phase: 'lobby',
          game: null,
          roundTimer: null, moveTimer: null,
        });
        wsIdentity.set(ws, { roomCode, token });
        send(ws, { type: 'room_created', roomCode, token, capacity: PLAYERS_REQUIRED });
        return;
      }

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

        if (room.players.length >= PLAYERS_REQUIRED) { send(ws, { type: 'error', message: '인원이 가득 찬 방입니다(정확히 4명).' }); return; }

        const token = randomUUID();
        room.players.push({ token, name, ws });
        wsIdentity.set(ws, { roomCode, token });
        if (inheritsHost) room.hostToken = token;

        send(ws, { type: 'joined_lobby', roomCode, token });
        broadcastLobbyUpdate(room, roomCode);
        return;
      }

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

      if (msg.type === 'start') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room) return;
        if (identity.token !== room.hostToken) return;
        if (room.started) return;
        if (room.players.filter(p => p.ws).length !== PLAYERS_REQUIRED) return;

        broadcast(room, { type: 'game_starting' });
        startGame(identity.roomCode);
        return;
      }

      if (msg.type === 'submit_face') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room) return;
        handleSubmitFace(room, identity.roomCode, identity.token, msg.face);
        return;
      }

      if (msg.type === 'submit_signal') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room) return;
        handleSubmitSignal(room, identity.token, msg);
        return;
      }

      if (msg.type === 'submit_move') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room) return;
        handleSubmitMove(room, identity.roomCode, identity.token, msg);
        return;
      }

      if (msg.type === 'submit_chat') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room) return;
        handleSubmitChat(room, identity.token, msg);
        return;
      }

      if (msg.type === 'submit_team_chat') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room) return;
        handleSubmitTeamChat(room, identity.token, msg);
        return;
      }

      if (msg.type === 'submit_reaction') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room) return;
        handleSubmitReaction(room, identity.token, msg);
        return;
      }

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

  console.log('[strategy-yutnori-server] registered ws path: /strategy-yutnori');
  return wss;
}
