import { createHash, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createRankingStore } from './ranking-store.mjs';
import { resolveRps } from './starting-order.mjs';

const ROOM_CODE_LENGTH = 6;
const RECONNECT_GRACE_MS = 45000;
const MAX_CHAT_LEN = 120;

const COUNTDOWN_MS = 3000;
const SIZE = 8;                  // 표준 8x8 리버시(오델로) 보드
const TURN_TIMEOUT_MS = 30000;   // 자기 차례 30초 안에 두지 않으면 서버가 무작위 합법수를 대신 둔다
const DECIDE_TIMEOUT_MS = 8000;  // 선공 결정 가위바위보 응답 제한시간
const DECIDE_REVEAL_MS = 1800;   // 가위바위보 결과를 보여준 뒤 실제 대국 시작까지 대기 시간
const DECIDE_TIE_PAUSE_MS = 900; // 비겼을 때 "다시!" 메시지를 보여주는 시간

const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

function emptyBoard() {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  const mid = SIZE / 2;
  board[mid - 1][mid - 1] = 'white';
  board[mid - 1][mid] = 'black';
  board[mid][mid - 1] = 'black';
  board[mid][mid] = 'white';
  return board;
}

function opponentOf(color) { return color === 'black' ? 'white' : 'black'; }

function inBounds(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

/** (row,col)에 color를 두었을 때 뒤집히는 모든 칸의 좌표 목록(합법수가 아니면 빈 배열). */
function flipsFor(board, row, col, color) {
  if (board[row][col] !== null) return [];
  const opp = opponentOf(color);
  const allFlips = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let r = row + dr, c = col + dc;
    while (inBounds(r, c) && board[r][c] === opp) {
      line.push([r, c]);
      r += dr; c += dc;
    }
    if (line.length > 0 && inBounds(r, c) && board[r][c] === color) {
      allFlips.push(...line);
    }
  }
  return allFlips;
}

function legalMoves(board, color) {
  const moves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] !== null) continue;
      const flips = flipsFor(board, r, c, color);
      if (flips.length > 0) moves.push({ row: r, col: c, flips });
    }
  }
  return moves;
}

function countDiscs(board) {
  let black = 0, white = 0;
  for (const row of board) for (const cell of row) {
    if (cell === 'black') black++;
    else if (cell === 'white') white++;
  }
  return { black, white };
}

/**
 * Room:
 * {
 *   hostToken, players: [{ token, name, ws }],  // 정확히 2명
 *   disconnectTimers: Map<token, timer>,
 *   started: boolean,
 *   phase: 'lobby' | 'countdown' | 'deciding' | 'playing' | 'game_over',
 *   board: (string|null)[][],
 *   turn: 'black' | 'white',
 *   blackToken/whiteToken: string | null,  // 가위바위보로 정해짐(호스트가 항상 흑이 아님)
 *   decidingChoices: Record<token, 'rock'|'paper'|'scissors'>,
 *   turnTimer: Timeout | null,
 *   countdownTimer: Timeout | null,
 *   decideTimer: Timeout | null,
 * }
 */
export function registerReversiServer() {
  const rooms = new Map();
  /** ws -> { roomCode, token } */
  const wsIdentity = new Map();
  const ranking = createRankingStore('reversi');

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
      const digest = createHash('sha256').update(`reversi-${base}-${attempt}`).digest('hex');
      code = digest.slice(0, ROOM_CODE_LENGTH).toUpperCase();
      attempt++;
    } while (rooms.has(code));
    return code;
  }

  function playerByToken(room, token) { return room.players.find(p => p.token === token); }
  function otherPlayer(room, token) { return room.players.find(p => p.token !== token); }
  function colorOf(room, token) { return room.blackToken === token ? 'black' : 'white'; }
  function tokenOfColor(room, color) { return color === 'black' ? room.blackToken : room.whiteToken; }

  function clearDisconnectTimer(room, token) {
    const t = room.disconnectTimers.get(token);
    if (t) { clearTimeout(t); room.disconnectTimers.delete(token); }
  }
  function clearAllDisconnectTimers(room) {
    room.players.forEach(p => clearDisconnectTimer(room, p.token));
  }
  function clearRoundTimers(room) {
    if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
    if (room.countdownTimer) { clearTimeout(room.countdownTimer); room.countdownTimer = null; }
    if (room.decideTimer) { clearTimeout(room.decideTimer); room.decideTimer = null; }
  }

  // ── 게임 진행 ────────────────────────────────────────────────────
  function startCountdown(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    room.phase = 'countdown';
    broadcast(room, { type: 'game_starting', countdownMs: COUNTDOWN_MS });
    room.countdownTimer = setTimeout(() => startDeciding(roomCode), COUNTDOWN_MS);
  }

  // ── 선공(흑) 결정전: 가위바위보 단판, 비기면 즉시 재도전 ──────────
  function startDeciding(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    room.phase = 'deciding';
    room.decidingChoices = {};
    const [p1, p2] = room.players;
    broadcast(room, {
      type: 'decide_start',
      playerAToken: p1?.token, playerAName: p1?.name ?? '?',
      playerBToken: p2?.token, playerBName: p2?.name ?? '?',
    });
    armDecideTimer(roomCode);
  }

  function armDecideTimer(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.decideTimer) clearTimeout(room.decideTimer);
    room.decideTimer = setTimeout(() => decideAutoTimeout(roomCode), DECIDE_TIMEOUT_MS);
  }

  function decideAutoTimeout(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'deciding') return;
    const choices = ['rock', 'paper', 'scissors'];
    for (const p of room.players) {
      if (!room.decidingChoices[p.token]) {
        room.decidingChoices[p.token] = choices[Math.floor(Math.random() * choices.length)];
      }
    }
    resolveDeciding(roomCode);
  }

  function handleDecideChoice(roomCode, token, choice) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'deciding') return;
    if (!['rock', 'paper', 'scissors'].includes(choice)) return;
    if (!playerByToken(room, token)) return;
    room.decidingChoices[token] = choice;
    if (room.players.every(p => room.decidingChoices[p.token])) resolveDeciding(roomCode);
  }

  function resolveDeciding(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'deciding') return;
    if (room.decideTimer) { clearTimeout(room.decideTimer); room.decideTimer = null; }

    const [p1, p2] = room.players;
    const choiceA = room.decidingChoices[p1.token];
    const choiceB = room.decidingChoices[p2.token];
    const result = resolveRps(choiceA, choiceB);

    if (result === null) {
      broadcast(room, { type: 'decide_tie', choiceA, choiceB });
      room.decidingChoices = {};
      setTimeout(() => {
        if (rooms.get(roomCode)?.phase === 'deciding') armDecideTimer(roomCode);
      }, DECIDE_TIE_PAUSE_MS);
      return;
    }

    const winner = result === 'a' ? p1 : p2;
    room.blackToken = winner.token;
    room.whiteToken = winner.token === p1.token ? p2.token : p1.token;
    broadcast(room, {
      type: 'decide_result',
      choiceA, choiceB,
      winnerToken: winner.token,
      winnerName: winner.name,
    });
    setTimeout(() => startMatch(roomCode), DECIDE_REVEAL_MS);
  }

  function startMatch(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.players.filter(p => p.ws).length < 2) return;

    room.board = emptyBoard();
    room.turn = 'black';
    room.phase = 'playing';
    room.started = true;

    const { black, white } = countDiscs(room.board);
    broadcast(room, {
      type: 'match_start',
      board: room.board,
      turn: room.turn,
      blackName: playerByToken(room, room.blackToken)?.name ?? '?',
      whiteName: playerByToken(room, room.whiteToken)?.name ?? '?',
      blackCount: black,
      whiteCount: white,
      turnTimeoutMs: TURN_TIMEOUT_MS,
    });
    armTurnTimer(roomCode);
  }

  function armTurnTimer(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnTimer = setTimeout(() => autoPlay(roomCode), TURN_TIMEOUT_MS);
  }

  function autoPlay(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'playing') return;
    const moves = legalMoves(room.board, room.turn);
    if (moves.length === 0) return; // advanceTurn이 이미 처리했어야 하는 상태 — 안전망
    const pick = moves[Math.floor(Math.random() * moves.length)];
    applyMove(roomCode, tokenOfColor(room, room.turn), pick.row, pick.col, true);
  }

  function applyMove(roomCode, token, row, col, isAuto = false) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'playing') return;
    const color = colorOf(room, token);
    if (color !== room.turn) return;

    const flips = flipsFor(room.board, row, col, color);
    if (flips.length === 0) return;

    room.board[row][col] = color;
    for (const [r, c] of flips) room.board[r][c] = color;

    const { black, white } = countDiscs(room.board);
    broadcast(room, {
      type: 'move_made',
      row, col, color, flips, isAuto,
      board: room.board,
      blackCount: black,
      whiteCount: white,
    });

    advanceTurn(roomCode);
  }

  function advanceTurn(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }

    const next = opponentOf(room.turn);
    const nextMoves = legalMoves(room.board, next);
    if (nextMoves.length > 0) {
      room.turn = next;
      broadcast(room, { type: 'turn_change', turn: room.turn, turnTimeoutMs: TURN_TIMEOUT_MS });
      armTurnTimer(roomCode);
      return;
    }

    // 상대가 둘 곳이 없음 — 패스
    const sameMoves = legalMoves(room.board, room.turn);
    if (sameMoves.length > 0) {
      broadcast(room, { type: 'pass', passedColor: next });
      armTurnTimer(roomCode); // 같은 사람 차례 유지, 타이머만 재시작
      return;
    }

    // 양쪽 다 둘 곳이 없음 — 게임 종료
    endGame(roomCode);
  }

  function endGame(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearRoundTimers(room);
    room.phase = 'game_over';
    room.started = false;

    const { black, white } = countDiscs(room.board);
    const winnerToken = black === white ? null : (black > white ? room.blackToken : room.whiteToken);
    const winner = winnerToken ? playerByToken(room, winnerToken) : null;

    recordResult(room, winnerToken);
    broadcast(room, {
      type: 'game_over',
      winnerToken: winnerToken ?? null,
      winnerName: winner?.name ?? null,
      blackCount: black,
      whiteCount: white,
    });
  }

  // ── 이탈/재접속 처리 ─────────────────────────────────────────────
  function finalizeLeave(roomCode, leavingToken) {
    const room = rooms.get(roomCode);
    if (!room) return;
    clearAllDisconnectTimers(room);

    if (room.phase === 'playing' || room.phase === 'countdown' || room.phase === 'deciding') {
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
        const roomCode = genRoomCode();
        const token = randomUUID();
        rooms.set(roomCode, {
          hostToken: token,
          players: [{ token, name, ws }],
          disconnectTimers: new Map(),
          started: false,
          phase: 'lobby',
          board: emptyBoard(),
          turn: 'black',
          blackToken: null,
          whiteToken: null,
          decidingChoices: {},
          turnTimer: null,
          countdownTimer: null,
          decideTimer: null,
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
          const { black, white } = countDiscs(room.board);
          send(ws, {
            type: 'rejoined', roomCode, token, started: true,
            game: {
              myColor: colorOf(room, token),
              board: room.board,
              turn: room.turn,
              blackName: playerByToken(room, room.blackToken)?.name ?? '?',
              whiteName: playerByToken(room, room.whiteToken)?.name ?? '?',
              blackCount: black,
              whiteCount: white,
            },
          });
        }
        if (opponent?.ws) send(opponent.ws, { type: 'opponent_reconnected' });
        return;
      }

      // ── decide_choice (선공 결정 가위바위보) ─────────────────────────
      if (msg.type === 'decide_choice') {
        const identity = wsIdentity.get(ws);
        if (identity) handleDecideChoice(identity.roomCode, identity.token, msg.choice);
        return;
      }

      // ── place (돌 놓기) ─────────────────────────────────────────────
      if (msg.type === 'place') {
        const identity = wsIdentity.get(ws);
        const room = identity && rooms.get(identity.roomCode);
        if (!room || room.phase !== 'playing') return;
        const row = Number(msg.row);
        const col = Number(msg.col);
        if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= SIZE || col < 0 || col >= SIZE) return;
        applyMove(identity.roomCode, identity.token, row, col);
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

  console.log('[reversi-server] registered ws path: /reversi');
  return { wss, getRanking: ranking.getRanking };
}
