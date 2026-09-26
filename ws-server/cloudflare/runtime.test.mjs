import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { games } from './games.mjs';
import { GameTimers } from '../game-timers.mjs';
import { createResultRanking, createRpsRanking, isoWeekKey } from '../ranking-data.mjs';
import { encodeSnapshot, decodeSnapshot } from './snapshot.mjs';
import { partnerOf } from '../strategy-yutnori-rules.mjs';

class Socket extends EventEmitter {
  constructor(id) { super(); this.id = id; this.readyState = this.OPEN = 1; this.messages = []; }
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.emit('close'); }
}

function harness(game, saved) {
  const sockets = new Map();
  const getSocket = id => {
    if (!sockets.has(id)) sockets.set(id, new Socket(id));
    return sockets.get(id);
  };
  const state = saved ? decodeSnapshot(saved, getSocket) : {
    rooms: new Map(), wsIdentity: new Map(), ranking: {}, timers: { nextId: 1, tasks: new Map() },
  };
  const timers = new GameTimers(state.timers);
  const engine = games[game]({
    WebSocketServer: EventEmitter, timers, rooms: state.rooms, wsIdentity: state.wsIdentity,
    createRankingStore: () => createResultRanking(state.ranking),
    createRpsRankingStore: () => createRpsRanking(state.ranking),
  });
  for (const socket of sockets.values()) engine.wss.emit('connection', socket);
  return {
    state, engine, timers, sockets,
    connect(id) { const socket = getSocket(id); engine.wss.emit('connection', socket); return socket; },
    send(socket, message) { socket.emit('message', JSON.stringify(message)); },
    snapshot() { return encodeSnapshot(state, value => value instanceof Socket ? value.id : null); },
    tick() {
      const at = timers.nextAt();
      if (!Number.isFinite(at)) return false;
      const original = Date.now;
      try { Date.now = () => at; timers.runDue(at); } finally { Date.now = original; }
      return true;
    },
  };
}

function joinRoom(h, count, mode = 'tournament') {
  const host = h.connect('player0');
  h.send(host, { type: 'create', name: '테스트0', capacity: count, mode });
  const created = host.messages.find(m => m.type === 'room_created');
  assert.ok(created);
  const players = [host];
  for (let i = 1; i < count; i++) {
    const socket = h.connect(`player${i}`);
    h.send(socket, { type: 'join', name: `테스트${i}`, roomCode: created.roomCode });
    players.push(socket);
  }
  return { code: created.roomCode, players };
}

for (const game of Object.keys(games)) {
  test(`${game}: room, sockets, private state and timers survive a snapshot`, () => {
    let h = harness(game);
    const count = ['gomoku', 'reversi', 'territory-clash', 'tug-of-war-battle'].includes(game) ? 2 : 4;
    const { code, players } = joinRoom(h, count);
    h.send(players[0], { type: 'start' });
    const before = h.snapshot();
    h = harness(game, before);
    assert.equal(h.state.rooms.get(code).players.length, count);
    assert.equal(h.state.wsIdentity.size, count);
    // Exercise every timer chain, including countdowns, reveal closures, auto turns,
    // intervals and disconnect cleanup; reconstruct between callbacks each time.
    for (let i = 0; i < 25; i++) {
      if (!h.tick()) break;
      h = harness(game, h.snapshot());
    }
    assert.doesNotThrow(() => h.snapshot());
    for (const socket of h.sockets.values()) h.send(socket, { type: 'leave' });
    for (let i = 0; i < 4; i++) if (!h.tick()) break;
    assert.equal(h.state.rooms.size, 0);
  });
}

test('liar: rejoin never reveals the word to the liar; completed round keeps rankings', () => {
  let h = harness('liar');
  const { code, players } = joinRoom(h, 4);
  h.send(players[0], { type: 'start' });
  const room = h.state.rooms.get(code), liarToken = room.liarToken;
  const liarSocket = room.players.find(p => p.token === liarToken).ws;
  assert.equal('word' in liarSocket.messages.find(m => m.type === 'role_assigned'), false);
  h = harness('liar', h.snapshot());
  const restored = h.state.rooms.get(code);
  const socket = h.connect('rejoined');
  h.send(socket, { type: 'rejoin', roomCode: code, token: liarToken });
  const reply = socket.messages.find(m => m.type === 'rejoined');
  assert.ok(reply);
  assert.equal(JSON.stringify(reply).includes('"word"'), false);
  for (const token of restored.speakingOrder) h.send(restored.players.find(p => p.token === token).ws, { type: 'submit_description', text: '설명' });
  for (const p of restored.players) h.send(p.ws, { type: 'submit_vote', targetToken: p.token === liarToken ? restored.players.find(x => x.token !== liarToken).token : liarToken });
  h.send(socket, { type: 'submit_guess', guess: '틀린 답변' });
  h = harness('liar', h.snapshot());
  assert.equal(h.engine.getRanking(isoWeekKey()).length, 4);
});

test('mafia: restored citizen snapshot contains no teammate list or other roles', () => {
  let h = harness('mafia');
  const { code, players } = joinRoom(h, 4);
  h.send(players[0], { type: 'start' });
  h = harness('mafia', h.snapshot());
  const room = h.state.rooms.get(code);
  const citizen = room.players.find(p => room.roles.get(p.token) === 'citizen');
  const socket = h.connect('rejoin-citizen');
  h.send(socket, { type: 'rejoin', roomCode: code, token: citizen.token });
  const reply = socket.messages.find(m => m.type === 'rejoined');
  assert.ok(reply);
  assert.equal(JSON.stringify(reply).includes('"teammates"'), false);
  assert.equal(JSON.stringify(reply).includes('"roles"'), false);
});

test('RPS wins and socket identity survive restart; rooms cannot see another room', () => {
  let h = harness('rps');
  const a = joinRoom(h, 2, '1v1');
  for (let i = 0; i < 2; i++) {
    h.send(a.players[0], { type: 'choice', choice: 'rock' });
    h.send(a.players[1], { type: 'choice', choice: 'scissors' });
  }
  h = harness('rps', h.snapshot());
  assert.equal(h.engine.getRanking(isoWeekKey())[0].byMode['1v1'], 1);
  const other = h.connect('other-room');
  h.send(other, { type: 'create', name: '다른방', mode: '1v1' });
  const first = h.state.rooms.get(a.code).players[0].ws;
  const before = other.messages.length;
  h.send(first, { type: 'submit_chat', text: '비공개 방 채팅' });
  assert.equal(other.messages.length, before);
});

test('snapshot retains reference identity and treats player-controlled keys as plain data', () => {
  const room = { players: [], rng: Math.random };
  const root = { rooms: new Map([['ROOM', room]]), taskArgs: [room], data: JSON.parse('{"__proto__":{"polluted":true}}') };
  const copy = decodeSnapshot(encodeSnapshot(root));
  assert.equal(copy.rooms.get('ROOM'), copy.taskArgs[0]);
  assert.equal(copy.rooms.get('ROOM').rng, Math.random);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.hasOwn(copy.data, '__proto__'), true);
});

test('strategy yut: partial choices stay private and partner signals remain isolated after restore', () => {
  let h = harness('strategy-yutnori');
  const { code, players } = joinRoom(h, 4);
  h.send(players[0], { type: 'start' });
  for (let i = 0; i < 100 && !h.state.rooms.get(code).game; i++) assert.equal(h.tick(), true);
  h = harness('strategy-yutnori', h.snapshot());
  const room = h.state.rooms.get(code);
  assert.ok(room.game);
  const sender = room.players[0], partner = partnerOf(room.game, sender.token);
  h.send(sender.ws, { type: 'submit_signal', suggestion: 'back' });
  for (const player of room.players) {
    assert.equal(player.ws.messages.some(m => m.type === 'signal_received'), player.token === partner);
    player.ws.messages = [];
  }
  h.send(sender.ws, { type: 'submit_face', face: 'back' });
  for (const player of room.players) {
    const updates = player.ws.messages.filter(m => m.type === 'game_update');
    assert.ok(updates.length);
    assert.equal(JSON.stringify(updates).includes('"face"'), false);
    assert.equal(JSON.stringify(updates).includes('"faces"'), false);
  }
});

test('Halli Galli: ring resolution lock survives restart and cards remain conserved', () => {
  let h = harness('halligalli');
  const { code, players } = joinRoom(h, 4);
  h.send(players[0], { type: 'start' });
  const room = h.state.rooms.get(code);
  const pile = [...room.piles.values()].find(p => p.draw.some(card => card.count === 5));
  const index = pile.draw.findIndex(card => card.count === 5);
  pile.faceUp.push(pile.draw.splice(index, 1)[0]);
  h.send(players[0], { type: 'submit_ring' });
  assert.equal(room.resolvingRing, true);
  h = harness('halligalli', h.snapshot());
  const restored = h.state.rooms.get(code);
  const before = [...restored.piles.values()].map(p => p.draw.length);
  h.send(restored.players[1].ws, { type: 'submit_ring' });
  assert.deepEqual([...restored.piles.values()].map(p => p.draw.length), before);
  assert.equal([...restored.piles.values()].reduce((sum, p) => sum + p.draw.length + p.faceUp.length, 0), 56);
  h.tick();
  assert.equal(restored.resolvingRing, false);
});
