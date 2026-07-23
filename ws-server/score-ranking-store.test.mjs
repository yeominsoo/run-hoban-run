import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createScoreRankingService } from './score-ranking-store.mjs';

async function startService(dataDir) {
  const service = createScoreRankingService(['aim-trainer', 'endless-runner'], { dataDir });
  const server = createServer((req, res) => {
    const pathname = req.url?.split('?')[0] || '';
    if (!service.handle(req, res, pathname)) {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

test('싱글게임 점수를 닉네임별 최고 기록으로 합쳐 전체 랭킹을 반환하고 영속화한다', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'toris-score-ranking-'));
  let running;

  try {
    running = await startService(dataDir);
    const submit = await fetch(`${running.baseUrl}/ranking/score/aim-trainer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entries: [
          { name: '이엘이', score: 1200, at: 200 },
          { name: '이안이', score: 1800, at: 300 },
          { name: '이엘이', score: 900, at: 100 },
        ],
      }),
    });

    assert.equal(submit.status, 200);
    assert.deepEqual((await submit.json()).entries, [
      { name: '이안이', score: 1800, at: 300 },
      { name: '이엘이', score: 1200, at: 200 },
    ]);

    const improve = await fetch(`${running.baseUrl}/ranking/score/aim-trainer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries: [{ name: '이엘이', score: 2200, at: 400 }] }),
    });
    assert.equal(improve.status, 200);
    assert.equal((await improve.json()).entries[0].score, 2200);

    await running.close();
    running = await startService(dataDir);

    const restored = await fetch(`${running.baseUrl}/ranking/score/aim-trainer`);
    assert.equal(restored.status, 200);
    assert.deepEqual((await restored.json()).entries, [
      { name: '이엘이', score: 2200, at: 400 },
      { name: '이안이', score: 1800, at: 300 },
    ]);

    const invalidGame = await fetch(`${running.baseUrl}/ranking/score/not-a-game`);
    assert.equal(invalidGame.status, 404);

    const runnerRanking = await fetch(`${running.baseUrl}/ranking/score/endless-runner`);
    assert.equal(runnerRanking.status, 200);
  } finally {
    if (running) await running.close().catch(() => {});
    await rm(dataDir, { recursive: true, force: true });
  }
});
