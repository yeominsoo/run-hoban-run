const MAX_NAME_LENGTH = 12;
const MAX_POST_ENTRIES = 20;
const MAX_RANKING_ENTRIES = 50;
const MAX_BODY_BYTES = 64 * 1024;

export function normalizeEntry(value) {
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

export function collapseBestScores(entries) {
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
