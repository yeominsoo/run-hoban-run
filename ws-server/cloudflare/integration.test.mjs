import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const options = {
  name: 'arcade-test', modules: true,
  scriptPath: new URL('../.wrangler/build/worker.js', import.meta.url).pathname,
  compatibilityDate: '2026-09-25', compatibilityFlags: ['nodejs_compat'],
  durableObjects: { GAMES: { className: 'GameService', useSQLite: true } },
  bindings: { MIGRATION_TOKEN: 'local-test-only' },
};

async function client(mf, path) {
  const response = await mf.dispatchFetch(`http://localhost${path}`, { headers: { Upgrade: 'websocket' } });
  assert.equal(response.status, 101);
  const socket = response.webSocket;
  socket.accept();
  const messages = [];
  socket.addEventListener('message', event => messages.push(JSON.parse(event.data)));
  return {
    socket, messages, send: data => socket.send(JSON.stringify(data)),
    async wait(type, from = 0) {
      const end = Date.now() + 5000;
      while (Date.now() < end) {
        const found = messages.slice(from).find(message => message.type === type);
        if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for ${type}: ${JSON.stringify(messages)}`);
    },
  };
}

test('workerd: WebSockets, round results, durable ranking, HTTP scores and import protection', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions(options));
  const clients = [];
  try {
    assert.equal(await (await mf.dispatchFetch('http://localhost/healthz')).text(), 'ok');
    const host = await client(mf, '/rps'); clients.push(host);
    host.send({ type: 'create', name: '호스트', mode: '1v1' });
    const created = await host.wait('room_created');
    const guest = await client(mf, '/rps'); clients.push(guest);
    guest.send({ type: 'join', name: '참가자', roomCode: created.roomCode });
    await guest.wait('matched');
    const reconnected = await client(mf, '/rps'); clients.push(reconnected);
    reconnected.send({ type: 'rejoin', roomCode: created.roomCode, token: created.token });
    await reconnected.wait('rejoined');
    for (let i = 0; i < 2; i++) {
      const from = reconnected.messages.length;
      reconnected.send({ type: 'choice', choice: 'rock' });
      guest.send({ type: 'choice', choice: 'scissors' });
      await reconnected.wait('result', from);
    }
    await reconnected.wait('set_over');
    const ranking = await (await mf.dispatchFetch('http://localhost/ranking')).json();
    assert.equal(ranking.entries[0].name, '호스트');
    assert.equal(ranking.entries[0].byMode['1v1'], 1);
    const denied = await mf.dispatchFetch('http://localhost/__migration/rps', { method: 'POST', body: '{}' });
    assert.equal(denied.status, 401);
    const overwrite = await mf.dispatchFetch('http://localhost/__migration/rps', { method: 'POST', headers: { authorization: 'Bearer local-test-only' }, body: '{}' });
    assert.equal(overwrite.status, 409);
    const score = await mf.dispatchFetch('http://localhost/ranking/score/endless-runner', { method: 'POST', body: JSON.stringify({ entries: [{ name: '테스트', score: 100, at: 1 }, { name: '테스트', score: 50, at: 2 }] }) });
    assert.equal(score.status, 200);
    assert.equal((await score.json()).entries.length, 1);
    assert.equal((await (await mf.dispatchFetch('http://localhost/ranking/score/endless-runner')).json()).entries[0].score, 100);
    reconnected.send({ type: 'leave' }); guest.send({ type: 'leave' });
  } finally {
    for (const c of clients) c.socket.close();
    await mf.dispose();
  }
});

test('workerd: a cold restart restores a private game and permits rejoining', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'arcade-durable-test-'));
  const persistentOptions = convertV4MiniflareOptions({ ...options, resourcePersistencePath: join(dir, 'shared'), isolatedResourcePersistencePath: join(dir, 'isolated') });
  let mf = new Miniflare(persistentOptions);
  let clients = [];
  try {
    const host = await client(mf, '/liar'); clients.push(host);
    host.send({ type: 'create', name: '호스트', capacity: 3 });
    const created = await host.wait('room_created');
    const sessions = [{ client: host, token: created.token }];
    for (let i = 1; i < 3; i++) {
      const c = await client(mf, '/liar'); clients.push(c);
      c.send({ type: 'join', name: `참가자${i}`, roomCode: created.roomCode });
      sessions.push({ client: c, token: (await c.wait('joined_lobby')).token });
    }
    host.send({ type: 'start' });
    for (const session of sessions) session.role = (await session.client.wait('role_assigned')).role;
    const liar = sessions.find(s => s.role === 'liar');
    for (const c of clients) c.socket.close();
    await new Promise(resolve => setTimeout(resolve, 100));
    await mf.dispose();
    mf = new Miniflare(persistentOptions);
    clients = [];
    const restored = await client(mf, '/liar'); clients.push(restored);
    restored.send({ type: 'rejoin', roomCode: created.roomCode, token: liar.token });
    const reply = await restored.wait('rejoined');
    assert.equal(reply.started, true);
    assert.equal(JSON.stringify(reply).includes('"word"'), false);
    restored.send({ type: 'leave' });
  } finally {
    for (const c of clients) c.socket.close();
    await mf.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('workerd: durable countdown runs without any client messages', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions(options));
  const clients = [];
  try {
    const host = await client(mf, '/multiplication-sprint'); clients.push(host);
    host.send({ type: 'create', name: '호스트', capacity: 2 });
    const created = await host.wait('room_created');
    const guest = await client(mf, '/multiplication-sprint'); clients.push(guest);
    guest.send({ type: 'join', name: '참가자', roomCode: created.roomCode });
    await guest.wait('joined_lobby');
    host.send({ type: 'start' });
    await host.wait('round_start');
    host.send({ type: 'leave' }); guest.send({ type: 'leave' });
  } finally {
    for (const c of clients) c.socket.close();
    await mf.dispose();
  }
});
