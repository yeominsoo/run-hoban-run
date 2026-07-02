import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8787;
const MOVES = new Set(['rock', 'paper', 'scissors']);
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const ROOM_CODE_LENGTH = 6;
const RECONNECT_GRACE_MS = 45000;

const httpServer = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer, path: '/rps' });

/**
 * roomCode -> {
 *   players: [{ token, name, ws }],  // ws is null while disconnected
 *   choices: Map<token, choice>,
 *   scores: Map<token, number>,
 *   disconnectTimers: Map<token, TimeoutHandle>,
 * }
 */
const rooms = new Map();
/** ws -> { roomCode, token } */
const wsIdentity = new Map();

function send(ws, payload) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sanitizeName(name) {
  const trimmed = typeof name === 'string' ? name.trim().slice(0, 20) : '';
  return trimmed || '손님';
}

function sanitizeRoomCode(code) {
  return typeof code === 'string' ? code.trim().toUpperCase().slice(0, ROOM_CODE_LENGTH) : '';
}

// 방 코드는 생성 시각(날짜/시/분/초/밀리초)의 해시값에서 뽑는다.
// 같은 밀리초에 방이 여러 개 생성되는 드문 경우를 대비해 재시도 카운터를 해시에 섞는다.
function genRoomCode() {
  const now = new Date();
  const base = [
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds(),
  ].join('-');

  let attempt = 0;
  let code;
  do {
    const digest = createHash('sha256').update(`${base}-${attempt}`).digest('hex');
    code = digest.slice(0, ROOM_CODE_LENGTH).toUpperCase();
    attempt++;
  } while (rooms.has(code));
  return code;
}

function playerByToken(room, token) {
  return room.players.find((p) => p.token === token);
}

function opponentOfToken(room, token) {
  return room.players.find((p) => p.token !== token);
}

function resolveOutcome(mine, theirs) {
  if (mine === theirs) return 'draw';
  return BEATS[mine] === theirs ? 'win' : 'lose';
}

function clearDisconnectTimer(room, token) {
  const timer = room.disconnectTimers.get(token);
  if (timer) {
    clearTimeout(timer);
    room.disconnectTimers.delete(token);
  }
}

// 연결이 끊긴 플레이어를 즉시 방에서 빼지 않고, 유예 시간 동안 자리를 남겨둔다.
// 카톡 공유 등으로 잠깐 탭이 백그라운드로 가면서 소켓이 끊기는 경우를 흡수하기 위함.
function scheduleDisconnectCleanup(roomCode, token) {
  const room = rooms.get(roomCode);
  if (!room) return;
  clearDisconnectTimer(room, token);
  const timer = setTimeout(() => finalizeLeave(roomCode, token), RECONNECT_GRACE_MS);
  room.disconnectTimers.set(token, timer);
}

function finalizeLeave(roomCode, leavingToken) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const opponent = opponentOfToken(room, leavingToken);
  room.players.forEach((p) => clearDisconnectTimer(room, p.token));
  rooms.delete(roomCode);
  if (opponent && opponent.ws) {
    send(opponent.ws, { type: 'opponent_left' });
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'create') {
      const name = sanitizeName(msg.name);
      const roomCode = genRoomCode();
      const token = randomUUID();
      rooms.set(roomCode, {
        players: [{ token, name, ws }],
        choices: new Map(),
        scores: new Map([[token, 0]]),
        disconnectTimers: new Map(),
      });
      wsIdentity.set(ws, { roomCode, token });
      send(ws, { type: 'room_created', roomCode, token });
      return;
    }

    if (msg.type === 'join') {
      const name = sanitizeName(msg.name);
      const roomCode = sanitizeRoomCode(msg.roomCode);
      const room = rooms.get(roomCode);
      if (!room) {
        send(ws, { type: 'error', message: '방을 찾을 수 없습니다. 코드를 다시 확인해주세요.' });
        return;
      }
      if (room.players.length >= 2) {
        send(ws, { type: 'error', message: '이미 인원이 가득 찬 방입니다.' });
        return;
      }
      const token = randomUUID();
      room.players.push({ token, name, ws });
      room.scores.set(token, 0);
      wsIdentity.set(ws, { roomCode, token });

      const [host, guest] = room.players;
      send(host.ws, { type: 'matched', opponentName: guest.name, roomCode, token: host.token });
      send(guest.ws, { type: 'matched', opponentName: host.name, roomCode, token: guest.token });
      return;
    }

    if (msg.type === 'rejoin') {
      const roomCode = sanitizeRoomCode(msg.roomCode);
      const token = typeof msg.token === 'string' ? msg.token : '';
      const room = rooms.get(roomCode);
      const player = room && playerByToken(room, token);
      if (!room || !player) {
        send(ws, { type: 'error', message: '재연결에 실패했습니다. 방이 이미 종료되었을 수 있어요.' });
        return;
      }

      clearDisconnectTimer(room, token);
      player.ws = ws;
      wsIdentity.set(ws, { roomCode, token });

      const opponent = opponentOfToken(room, token);
      send(ws, {
        type: 'rejoined',
        roomCode,
        token,
        opponentName: opponent ? opponent.name : null,
        opponentConnected: !!(opponent && opponent.ws),
        score: {
          you: room.scores.get(token) ?? 0,
          opponent: opponent ? room.scores.get(opponent.token) ?? 0 : 0,
        },
      });
      if (opponent && opponent.ws) {
        send(opponent.ws, { type: 'opponent_reconnected' });
      }
      return;
    }

    if (msg.type === 'choice') {
      if (!MOVES.has(msg.choice)) return;
      const identity = wsIdentity.get(ws);
      const room = identity && rooms.get(identity.roomCode);
      if (!room || room.players.length < 2) return;
      const { token } = identity;

      room.choices.set(token, msg.choice);
      const opponent = opponentOfToken(room, token);
      if (room.choices.size < 2) {
        if (opponent?.ws) send(opponent.ws, { type: 'opponent_choice_made' });
        return;
      }

      const myChoice = room.choices.get(token);
      const oppChoice = room.choices.get(opponent.token);
      const myOutcome = resolveOutcome(myChoice, oppChoice);
      const oppOutcome = resolveOutcome(oppChoice, myChoice);
      if (myOutcome === 'win') room.scores.set(token, room.scores.get(token) + 1);
      if (oppOutcome === 'win') room.scores.set(opponent.token, room.scores.get(opponent.token) + 1);
      room.choices.clear();

      send(ws, {
        type: 'result',
        you: myChoice,
        opponent: oppChoice,
        outcome: myOutcome,
        score: { you: room.scores.get(token), opponent: room.scores.get(opponent.token) },
      });
      send(opponent.ws, {
        type: 'result',
        you: oppChoice,
        opponent: myChoice,
        outcome: oppOutcome,
        score: { you: room.scores.get(opponent.token), opponent: room.scores.get(token) },
      });
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

    const opponent = opponentOfToken(room, identity.token);
    if (opponent && opponent.ws) {
      send(opponent.ws, { type: 'opponent_disconnected' });
    }
    scheduleDisconnectCleanup(identity.roomCode, identity.token);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[rps-server] listening on :${PORT} (ws path: /rps)`);
});
