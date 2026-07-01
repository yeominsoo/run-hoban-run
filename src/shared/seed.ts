function mulberry32(seed: number): () => number {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function distributeTeams(participants: string[], teamCount: number, seed: number): string[][] {
  const teams: string[][] = Array.from({ length: teamCount }, () => []);
  const shuffled = seededShuffle(participants, seed);
  shuffled.forEach((p, i) => teams[i % teamCount].push(p));
  return teams;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export function rollValues(count: number, max: number, seed: number): number[] {
  const rng = mulberry32(seed);
  return Array.from({ length: count }, () => 1 + Math.floor(rng() * max));
}
