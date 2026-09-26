import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { games } from './games.mjs';

// Leaves before any round completes, so ranking records are not created.
const base = process.argv[2];
if (!base) throw new Error('Usage: node cloudflare/smoke.mjs <https://worker>');
assert.equal(await (await fetch(`${base}/healthz`)).text(), 'ok');

async function connect(game) {
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/${game}`);
  const messages = [];
  socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
  await once(socket, 'open');
  return {
    socket, send: message => socket.send(JSON.stringify(message)),
    async wait(...types) {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const error = messages.find(message => message.type === 'error');
        if (error) throw new Error(`${game}: ${JSON.stringify(error)}`);
        const found = messages.find(message => types.includes(message.type));
        if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error(`${game}: timed out waiting for ${types.join('/')}`);
    },
  };
}

for (const game of Object.keys(games)) {
  const clients = [];
  try {
    const host = await connect(game); clients.push(host);
    host.send({ type: 'create', name: '연결점검호스트', capacity: 4, mode: 'tournament' });
    const created = await host.wait('room_created');
    const guest = await connect(game); clients.push(guest);
    guest.send({ type: 'join', name: '연결점검참가자', roomCode: created.roomCode });
    await guest.wait('joined_lobby', 'joined');
    const restored = await connect(game); clients.push(restored);
    restored.send({ type: 'rejoin', roomCode: created.roomCode, token: created.token });
    assert.equal((await restored.wait('rejoined')).roomCode, created.roomCode);
    restored.send({ type: 'leave' });
    guest.send({ type: 'leave' });
    await new Promise(resolve => setTimeout(resolve, 200));
    console.log(`${game}: create, join, rejoin and leave passed`);
  } finally {
    for (const client of clients) client.socket.close();
  }
}
