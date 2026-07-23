import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DATA_DIR = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), 'data');
const MAX_NAME_LENGTH = 12;
const MAX_POST_ENTRIES = 20;
const MAX_RANKING_ENTRIES = 50;
const MAX_BODY_BYTES = 64 * 1024;

function normalizeEntry(value) {
  if (!value || typeof value !== 'object') return null;

  const name = typeof value.name === 'string'
    ? value.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH)
    : '';
  const score = Number(value.score);
  const at = Number(value.at);

  if (!name || !Number.isSafeInteger(score) || score < 0) return null;

  const entry = {
    name,
    score,
    at: Number.isSafeInteger(at) && at > 0 ? at : Date.now(),
  };
  const distance = Number(value.distance);
  const coins = Number(value.coins);
  if (Number.isSafeInteger(distance) && distance >= 0) entry.distance = distance;
  if (Number.isSafeInteger(coins) && coins >= 0) entry.coins = coins;
  return entry;
}

function collapseBestScores(entries) {
  const bestByName = new Map();

  for (const entry of entries) {
    const current = bestByName.get(entry.name);
    const entryDetailCount = Number(entry.distance !== undefined) + Number(entry.coins !== undefined);
    const currentDetailCount = current
      ? Number(current.distance !== undefined) + Number(current.coins !== undefined)
      : -1;
    if (
      !current
      || entry.score > current.score
      || (
        entry.score === current.score
        && (
          entryDetailCount > currentDetailCount
          || (entryDetailCount === currentDetailCount && entry.at < current.at)
        )
      )
    ) {
      bestByName.set(entry.name, entry);
    }
  }

  return [...bestByName.values()]
    .sort((a, b) => b.score - a.score || a.at - b.at || a.name.localeCompare(b.name, 'ko'))
    .slice(0, MAX_RANKING_ENTRIES);
}

/**
 * 싱글게임 점수 랭킹 저장소. 닉네임별 최고 점수 하나만 유지하며, 같은 점수라면 먼저
 * 달성한 기록을 보존한다. 멀티게임 승/패 랭킹과 파일명을 분리해 기존 데이터를 건드리지 않는다.
 */
export function createScoreRankingStore(gameKey, { dataDir = DEFAULT_DATA_DIR } = {}) {
  const file = join(dataDir, `score-ranking-${gameKey}.json`);
  let entries = [];

  try {
    mkdirSync(dataDir, { recursive: true });
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const rawEntries = Array.isArray(parsed) ? parsed : parsed?.entries;
    if (Array.isArray(rawEntries)) {
      entries = collapseBestScores(rawEntries.map(normalizeEntry).filter(Boolean));
    }
  } catch {
    // 첫 실행이거나 파일이 손상됨 — 빈 상태로 시작
  }

  function persist() {
    const tempFile = `${file}.tmp`;
    writeFileSync(tempFile, JSON.stringify({ entries }));
    renameSync(tempFile, file);
  }

  function mergeEntries(rawEntries) {
    const incoming = (Array.isArray(rawEntries) ? rawEntries : [])
      .slice(0, MAX_POST_ENTRIES)
      .map(normalizeEntry)
      .filter(Boolean);

    if (incoming.length === 0) return { accepted: 0, changed: false };

    const merged = collapseBestScores([...entries, ...incoming]);
    const changed = JSON.stringify(merged) !== JSON.stringify(entries);

    if (changed) {
      entries = merged;
      persist();
    }

    return { accepted: incoming.length, changed };
  }

  function getRanking() {
    return entries.map((entry) => ({ ...entry }));
  }

  return { getRanking, mergeEntries };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let bytes = 0;
    let tooLarge = false;

    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (tooLarge) {
        const error = new Error('payload too large');
        error.statusCode = 413;
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        const error = new Error('invalid json');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function respondJson(res, status, payload, corsHeaders) {
  res.writeHead(status, { 'content-type': 'application/json', ...corsHeaders });
  res.end(JSON.stringify(payload));
}

/**
 * GET/POST /ranking/score/<game> 요청을 처리한다. nginx의 기존 /ranking 프록시를
 * 그대로 통과하도록 이 경로 아래에 두었다.
 */
export function createScoreRankingService(
  gameKeys,
  {
    dataDir = DEFAULT_DATA_DIR,
    corsHeaders = { 'access-control-allow-origin': '*' },
  } = {},
) {
  const stores = new Map(
    gameKeys.map((gameKey) => [gameKey, createScoreRankingStore(gameKey, { dataDir })]),
  );
  const prefix = '/ranking/score/';

  function handle(req, res, pathname) {
    if (!pathname.startsWith(prefix)) return false;

    let gameKey;
    try {
      gameKey = decodeURIComponent(pathname.slice(prefix.length));
    } catch {
      respondJson(res, 400, { error: 'invalid game path' }, corsHeaders);
      return true;
    }
    const store = stores.get(gameKey);
    if (!store) {
      respondJson(res, 404, { error: 'unknown game' }, corsHeaders);
      return true;
    }

    if (req.method === 'GET') {
      respondJson(res, 200, { entries: store.getRanking() }, corsHeaders);
      return true;
    }

    if (req.method === 'POST') {
      void readJsonBody(req)
        .then((body) => {
          const result = store.mergeEntries(body?.entries);
          if (result.accepted === 0) {
            respondJson(res, 400, { error: 'no valid entries' }, corsHeaders);
            return;
          }
          respondJson(res, 200, { ...result, entries: store.getRanking() }, corsHeaders);
        })
        .catch((error) => {
          respondJson(res, error?.statusCode || 500, { error: error?.message || 'request failed' }, corsHeaders);
        });
      return true;
    }

    respondJson(res, 405, { error: 'method not allowed' }, {
      ...corsHeaders,
      allow: 'GET, POST',
    });
    return true;
  }

  return { handle };
}
