const KEY_PREFIX = 'rhh_';
const KEY_SUFFIX = '_best';

function key(gameSlug: string): string {
  return `${KEY_PREFIX}${gameSlug}${KEY_SUFFIX}`;
}

export function loadBestScore(gameSlug: string): number {
  const raw = localStorage.getItem(key(gameSlug));
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** 새 점수가 기존 최고점수보다 높으면 저장하고 true를 반환한다(신기록 여부). */
export function saveBestScore(gameSlug: string, score: number): boolean {
  const current = loadBestScore(gameSlug);
  if (score <= current) return false;
  localStorage.setItem(key(gameSlug), String(score));
  return true;
}
