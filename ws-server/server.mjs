import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8787;
const MOVES = new Set(['rock', 'paper', 'scissors']);
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const ROOM_CODE_LENGTH = 6;

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

/** roomCode -> { players: [{ws,name}], choices: Map<ws, choice>, scores: Map<ws, number> } */
const rooms = new Map();
/** ws -> roomCode */
const wsRoom = new Map();

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
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

function opponentOf(room, ws) {
  return room.players.find((p) => p.ws !== ws);
}

function resolveOutcome(mine, theirs) {
  if (mine === theirs) return 'draw';
  return BEATS[mine] === theirs ? 'win' : 'lose';
}

function closeRoom(roomCode, leftWs) {
  const room = rooms.get(roomCode);
  if (!room) return;
  rooms.delete(roomCode);
  room.players.forEach((p) => wsRoom.delete(p.ws));
  const remaining = room.players.find((p) => p.ws !== leftWs);
  if (remaining) {
    send(remaining.ws, { type: 'opponent_left' });
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
      rooms.set(roomCode, {
        players: [{ ws, name }],
        choices: new Map(),
        scores: new Map([[ws, 0]]),
      });
      wsRoom.set(ws, roomCode);
      send(ws, { type: 'room_created', roomCode });
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
      room.players.push({ ws, name });
      room.scores.set(ws, 0);
      wsRoom.set(ws, roomCode);

      const [host, guest] = room.players;
      send(host.ws, { type: 'matched', opponentName: guest.name, roomCode });
      send(guest.ws, { type: 'matched', opponentName: host.name, roomCode });
      return;
    }

    if (msg.type === 'choice') {
      if (!MOVES.has(msg.choice)) return;
      const roomCode = wsRoom.get(ws);
      const room = roomCode ? rooms.get(roomCode) : undefined;
      if (!room || room.players.length < 2) return;

      room.choices.set(ws, msg.choice);
      const opponent = opponentOf(room, ws);
      if (room.choices.size < 2) {
        send(opponent.ws, { type: 'opponent_choice_made' });
        return;
      }

      const myChoice = room.choices.get(ws);
      const oppChoice = room.choices.get(opponent.ws);
      const myOutcome = resolveOutcome(myChoice, oppChoice);
      const oppOutcome = resolveOutcome(oppChoice, myChoice);
      if (myOutcome === 'win') room.scores.set(ws, room.scores.get(ws) + 1);
      if (oppOutcome === 'win') room.scores.set(opponent.ws, room.scores.get(opponent.ws) + 1);
      room.choices.clear();

      send(ws, {
        type: 'result',
        you: myChoice,
        opponent: oppChoice,
        outcome: myOutcome,
        score: { you: room.scores.get(ws), opponent: room.scores.get(opponent.ws) },
      });
      send(opponent.ws, {
        type: 'result',
        you: oppChoice,
        opponent: myChoice,
        outcome: oppOutcome,
        score: { you: room.scores.get(opponent.ws), opponent: room.scores.get(ws) },
      });
      return;
    }

    if (msg.type === 'leave') {
      const roomCode = wsRoom.get(ws);
      if (roomCode) closeRoom(roomCode, ws);
      return;
    }
  });

  ws.on('close', () => {
    const roomCode = wsRoom.get(ws);
    if (roomCode) closeRoom(roomCode, ws);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[rps-server] listening on :${PORT} (ws path: /rps)`);
});
