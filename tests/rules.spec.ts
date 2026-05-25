import { expect, test } from '@playwright/test';
import { createSampleParticipants, FRENZY_SKILL_ID, getRaceOptionBounds, runTournament } from '../src/game/rules';

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

test('caps race option bounds to the participant count', () => {
  const names = createSampleParticipants(6);
  const bounds = getRaceOptionBounds(names.length, 18);
  const tournament = runTournament(names, {
    seed: '참가자-상한',
    fieldSize: 18,
    qualifiersPerGroup: 17,
    winnerCount: 18,
    surface: 'turf',
    distance: 'mile',
    condition: 'firm'
  });

  expect(bounds.fieldSize.max).toBe(6);
  expect(bounds.qualifiersPerGroup.max).toBe(5);
  expect(bounds.winnerCount.max).toBe(6);
  expect(tournament.options.fieldSize).toBe(6);
  expect(tournament.options.qualifiersPerGroup).toBe(5);
  expect(tournament.options.winnerCount).toBe(6);
  expect(tournament.races[0]?.placements).toHaveLength(6);
});

test('spreads helicopter shots and winners across randomized lanes over 200 runs', () => {
  const names = createSampleParticipants(18);
  const shotLanes = new Map<number, number>();
  const winnerLanes = new Map<number, number>();

  for (let index = 1; index <= 200; index += 1) {
    const tournament = runTournament(names, {
      seed: `트랙분포-${String(index).padStart(3, '0')}`,
      fieldSize: 18,
      qualifiersPerGroup: 2,
      winnerCount: 1,
      surface: 'turf',
      distance: 'mile',
      condition: 'firm'
    });
    const race = tournament.races[0];

    expect(race).toBeTruthy();

    if (!race) {
      continue;
    }

    expect(new Set(race.placements.map((placement) => placement.laneIndex)).size).toBe(18);

    const winner = race.placements.find((placement) => placement.rank === 1);

    if (winner) {
      winnerLanes.set(winner.laneIndex, (winnerLanes.get(winner.laneIndex) ?? 0) + 1);
    }

    race.hazardEvents.forEach((hazard) => {
      const target = race.placements.find((placement) => placement.entry.id === hazard.targetEntryId);

      if (target) {
        shotLanes.set(target.laneIndex, (shotLanes.get(target.laneIndex) ?? 0) + 1);
      }
    });
  }

  const shotCounts = [...shotLanes.values()];
  const winnerCounts = [...winnerLanes.values()];

  expect(shotLanes.size).toBe(18);
  expect(winnerLanes.size).toBeGreaterThanOrEqual(15);
  expect(Math.max(...shotCounts)).toBeLessThanOrEqual(90);
  expect(Math.max(...winnerCounts)).toBeLessThanOrEqual(24);
});

test('rolls frenzy as a race-level lagging-runner x3 boost', () => {
  const names = createSampleParticipants(18);
  const tournament = runTournament(names, {
    seed: '광폭확률-0086',
    fieldSize: 18,
    qualifiersPerGroup: 2,
    winnerCount: 1,
    surface: 'turf',
    distance: 'mile',
    condition: 'firm'
  });
  const race = tournament.races[0];
  const frenzy = race?.placements.find((placement) => placement.skillEvent?.skill.id === FRENZY_SKILL_ID);

  expect(frenzy).toBeTruthy();
  expect(frenzy?.skillEvent?.durationSeconds).toBe(4);
  expect(frenzy?.skillEvent?.speedMultiplier).toBe(3);
  expect(frenzy?.skillEvent?.triggerSeconds).toBeGreaterThan(0);
  expect(frenzy?.finishSeconds).toBeLessThan(frenzy?.baseFinishSeconds ?? 0);

  const laggingIds = new Set(
    [...(race?.placements ?? [])]
      .sort((left, right) => right.baseFinishSeconds - left.baseFinishSeconds)
      .slice(0, Math.ceil((race?.placements.length ?? 0) / 2))
      .map((placement) => placement.entry.id)
  );

  expect(laggingIds.has(frenzy?.entry.id ?? '')).toBe(true);
});

test('keeps frenzy frequency close to 3.5 percent over repeated races', () => {
  const names = createSampleParticipants(18);
  let frenzyCount = 0;

  for (let index = 1; index <= 1000; index += 1) {
    const tournament = runTournament(names, {
      seed: `광폭확률-${String(index).padStart(4, '0')}`,
      fieldSize: 18,
      qualifiersPerGroup: 2,
      winnerCount: 1,
      surface: 'turf',
      distance: 'mile',
      condition: 'firm'
    });

    if (tournament.races[0]?.placements.some((placement) => placement.skillEvent?.skill.id === FRENZY_SKILL_ID)) {
      frenzyCount += 1;
    }
  }

  expect(frenzyCount).toBeGreaterThanOrEqual(25);
  expect(frenzyCount).toBeLessThanOrEqual(50);
});
