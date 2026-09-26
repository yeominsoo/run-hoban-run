import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRankingStore } from './ranking-store.mjs';
import { createRpsRanking } from './ranking-data.mjs';
import { GameTimers } from './game-timers.mjs';

export function createNodePlatform() {
  let nativeTimer;
  const timers = new GameTimers(undefined, () => {
    clearTimeout(nativeTimer);
    const next = timers.nextAt();
    if (Number.isFinite(next)) nativeTimer = setTimeout(() => timers.runDue(), Math.max(0, next - Date.now()));
  });
  return {
    WebSocketServer, createRankingStore, timers,
    createRpsRankingStore() {
      const dir = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), 'data');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'ranking.json');
      let data = {};
      try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { /* first run */ }
      let saveTimer;
      return createRpsRanking(data, () => {
        if (saveTimer) return;
        saveTimer = setTimeout(() => {
          saveTimer = null;
          writeFileSync(file, JSON.stringify(data));
        }, 2000);
      });
    },
  };
}
