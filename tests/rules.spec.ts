import { expect, test } from '@playwright/test';
import { runTournament } from '../src/game/rules';

test('does not concentrate six-runner winners on a fixed input order across seeds', () => {
  const names = ['1번주자', '2번주자', '3번주자', '4번주자', '5번주자', '6번주자'];
  const wins = new Map(names.map((name) => [name, 0]));

  for (let index = 1; index <= 20; index += 1) {
    const tournament = runTournament(names, {
      seed: `순서편향-${String(index).padStart(2, '0')}`,
      fieldSize: 6,
      qualifiersPerGroup: 1,
      winnerCount: 1,
      surface: 'turf',
      distance: 'mile',
      condition: 'firm'
    });
    const winner = tournament.winners[0]?.name;

    expect(winner).toBeTruthy();
    wins.set(winner ?? '', (wins.get(winner ?? '') ?? 0) + 1);
  }

  const winCounts = [...wins.values()];

  expect(wins.get('1번주자')).toBe(4);
  expect(Math.max(...winCounts)).toBeLessThanOrEqual(5);
  expect(Math.min(...winCounts)).toBeGreaterThanOrEqual(2);
});
