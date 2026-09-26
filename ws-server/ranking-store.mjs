import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), 'data');

export { isoWeekKey } from './ranking-data.mjs';
import { createResultRanking } from './ranking-data.mjs';

/**
 * 게임별 승/패 랭킹을 파일로 영속화하는 저장소. RPS의 기존 ranking.json 패턴(주 단위 키,
 * 2초 디바운스 저장)을 그대로 재사용하되, 게임마다 로직을 복붙하지 않도록 팩토리로
 * 일반화했다. 각 게임은 ranking-<gameKey>.json이라는 별도 파일에 저장되므로, RPS의 기존
 * ranking.json(모드별 승수 스키마, 건드리지 않음)과 절대 충돌하지 않는다.
 */
export function createRankingStore(gameKey) {
  const file = join(DATA_DIR, `ranking-${gameKey}.json`);
  let data = {};
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // 첫 실행이거나 파일이 손상됨 — 빈 상태로 시작
  }

  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        writeFileSync(file, JSON.stringify(data));
      } catch (e) {
        console.error(`[ranking:${gameKey}] save failed`, e.message);
      }
    }, 2000);
  }

  return createResultRanking(data, scheduleSave);
}
