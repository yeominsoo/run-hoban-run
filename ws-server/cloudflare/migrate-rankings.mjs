import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { games, scoreGames } from './games.mjs';

// Usage: MIGRATION_TOKEN=... node cloudflare/migrate-rankings.mjs <backup/data> <https://worker>
// Create the backup with docker cp first. This command never changes the source.
const [source, target] = process.argv.slice(2);
if (!source || !target || !process.env.MIGRATION_TOKEN) throw new Error('Source, target and MIGRATION_TOKEN are required');
if (new URL(target).protocol !== 'https:') throw new Error('The migration target must use HTTPS');
for (const file of (await readdir(source)).sort()) {
  if (!file.endsWith('.json')) continue;
  let path;
  if (file === 'ranking.json') path = '/ranking';
  else if (file.startsWith('score-ranking-')) {
    const game = file.slice('score-ranking-'.length, -5);
    if (!scoreGames.includes(game)) throw new Error(`Unknown score game: ${file}`);
    path = `/ranking/score/${game}`;
  } else if (file.startsWith('ranking-')) {
    const game = file.slice('ranking-'.length, -5);
    if (!Object.hasOwn(games, game)) throw new Error(`Unknown multiplayer game: ${file}`);
    path = `/ranking/${game}`;
  } else throw new Error(`Unexpected ranking file: ${file}`);
  const raw = await readFile(join(source, file), 'utf8');
  JSON.parse(raw);
  const response = await fetch(`${target.replace(/\/$/, '')}/__migration${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${process.env.MIGRATION_TOKEN}`, 'content-type': 'application/json' }, body: raw,
  });
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}; ${await response.text()}`);
  console.log(JSON.stringify({ file, bytes: Buffer.byteLength(raw), sha256: createHash('sha256').update(raw).digest('hex'), imported: true }));
}
