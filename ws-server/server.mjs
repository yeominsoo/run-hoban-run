import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8787;
const MOVES = new Set(['rock', 'paper', 'scissors']);
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

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

/** @type {{ ws: import('ws').WebSocket, name: string } | null} */
let waiting = null;

/** ws -> { id, players: [{ws,name}, {ws,name}], choices: Map<ws, choice>, scores: Map<ws, number> } */
const rooms = new Map();

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sanitizeName(name) {
  const trimmed = typeof name === 'string' ? name.trim().slice(0, 20) : '';
  return trimmed || '손님';
}

function opponentOf(room, ws) {
  return room.players.find((p) => p.ws !== ws);
}

function resolveOutcome(mine, theirs) {
  if (mine === theirs) return 'draw';
  return BEATS[mine] === theirs ? 'win' : 'lose';
}

function makeRoom(a, b) {
  const room = {
    id: randomUUID(),
    players: [a, b],
    choices: new Map(),
    scores: new Map([
      [a.ws, 0],
      [b.ws, 0],
    ]),
  };
  rooms.set(a.ws, room);
  rooms.set(b.ws, room);
  send(a.ws, { type: 'matched', opponentName: b.name, roomId: room.id });
  send(b.ws, { type: 'matched', opponentName: a.name, roomId: room.id });
}

function endRoom(room, leftWs) {
  rooms.delete(room.players[0].ws);
  rooms.delete(room.players[1].ws);
  const remaining = room.players.find((p) => p.ws !== leftWs);
  if (remaining) {
    send(remaining.ws, { type: 'opponent_left' });
  }
}

wss.on('connection', (ws) => {
  const player = { ws, name: '손님' };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'join') {
      player.name = sanitizeName(msg.name);
      if (waiting && waiting.ws !== ws && waiting.ws.readyState === waiting.ws.OPEN) {
        const opponent = waiting;
        waiting = null;
        makeRoom(opponent, player);
      } else {
        waiting = player;
        send(ws, { type: 'waiting' });
      }
      return;
    }

    if (msg.type === 'choice') {
      if (!MOVES.has(msg.choice)) return;
      const room = rooms.get(ws);
      if (!room) return;

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
      const room = rooms.get(ws);
      if (room) endRoom(room, ws);
      if (waiting && waiting.ws === ws) waiting = null;
      return;
    }
  });

  ws.on('close', () => {
    if (waiting && waiting.ws === ws) waiting = null;
    const room = rooms.get(ws);
    if (room) endRoom(room, ws);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[rps-server] listening on :${PORT} (ws path: /rps)`);
});
