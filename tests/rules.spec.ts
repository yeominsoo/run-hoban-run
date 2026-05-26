import { expect, test } from '@playwright/test';
import {
  createSampleParticipants,
  FRENZY_SKILL_ID,
  FRENZY_SPEED_SEGMENT_SPAN_CHANCES,
  getRaceOptionBounds,
  runTournament
} from '../src/game/rules';

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

test('spreads helicopter shots across randomized lanes and full pre-elimination ranks over 200 runs', () => {
  const names = createSampleParticipants(18);
  const shotLanes = new Map<number, number>();
  const shotBaseRanks = new Map<number, number>();
  const winnerLanes = new Map<number, number>();
  let topThirdShots = 0;
  let middleThirdShots = 0;
  let bottomThirdShots = 0;

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

    const baseRankById = new Map(
      [...race.placements]
        .sort((left, right) => left.baseFinishSeconds - right.baseFinishSeconds)
        .map((placement, placementIndex) => [placement.entry.id, placementIndex + 1])
    );

    race.hazardEvents.forEach((hazard) => {
      const target = race.placements.find((placement) => placement.entry.id === hazard.targetEntryId);
      const baseRank = baseRankById.get(hazard.targetEntryId);

      if (target) {
        shotLanes.set(target.laneIndex, (shotLanes.get(target.laneIndex) ?? 0) + 1);
      }

      if (baseRank) {
        shotBaseRanks.set(baseRank, (shotBaseRanks.get(baseRank) ?? 0) + 1);

        if (baseRank <= 6) {
          topThirdShots += 1;
        } else if (baseRank <= 12) {
          middleThirdShots += 1;
        } else {
          bottomThirdShots += 1;
        }
      }
    });
  }

  const shotCounts = [...shotLanes.values()];
  const shotBaseRankCounts = [...shotBaseRanks.values()];
  const winnerCounts = [...winnerLanes.values()];

  expect(shotLanes.size).toBe(18);
  expect(shotBaseRanks.size).toBe(18);
  expect(winnerLanes.size).toBeGreaterThanOrEqual(15);
  expect(Math.max(...shotCounts)).toBeLessThanOrEqual(90);
  expect(Math.max(...shotBaseRankCounts)).toBeLessThanOrEqual(95);
  expect(Math.min(...shotBaseRankCounts)).toBeGreaterThanOrEqual(45);
  expect(topThirdShots).toBeGreaterThanOrEqual(300);
  expect(topThirdShots).toBeLessThanOrEqual(500);
  expect(middleThirdShots).toBeGreaterThanOrEqual(300);
  expect(middleThirdShots).toBeLessThanOrEqual(500);
  expect(bottomThirdShots).toBeGreaterThanOrEqual(300);
  expect(bottomThirdShots).toBeLessThanOrEqual(500);
  expect(Math.max(...winnerCounts)).toBeLessThanOrEqual(24);
});

test('applies frenzy mode to dance skill events without replacing the dance skill', () => {
  const names = createSampleParticipants(18);
  const tournament = runTournament(names, {
    seed: '댄스광폭-0113',
    fieldSize: 18,
    qualifiersPerGroup: 2,
    winnerCount: 1,
    surface: 'turf',
    distance: 'mile',
    condition: 'firm'
  });
  const dance = tournament.races[0]?.placements.find(
    (placement) => placement.skillEvent?.skill.pose === 'dance' && !placement.eliminatedByHelicopter
  );

  expect(dance).toBeTruthy();
  expect(dance?.skillEvent?.skill.id).toBe('corner-dance');
  expect(dance?.skillEvent?.skill.id).not.toBe(FRENZY_SKILL_ID);
  expect(dance?.skillEvent?.skill.cinematic).toBe('frenzy');
  expect(dance?.skillEvent?.speedMultiplier).toBe(3);
  expect(dance?.skillEvent?.speedSegmentSpan).toBeGreaterThanOrEqual(1);
  expect(dance?.skillEvent?.speedSegmentSpan).toBeLessThanOrEqual(5);
  expect(dance?.skillEvent?.durationSeconds).toBeGreaterThan(0);
  expect(dance?.finishSeconds).toBeLessThan(dance?.baseFinishSeconds ?? 0);
});

test('rolls frenzy as a race-level lagging-runner x3 speed-segment boost', () => {
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
  expect(frenzy?.skillEvent?.speedMultiplier).toBe(3);
  expect(frenzy?.skillEvent?.speedSegmentSpan).toBeGreaterThanOrEqual(1);
  expect(frenzy?.skillEvent?.speedSegmentSpan).toBeLessThanOrEqual(5);
  expect(frenzy?.skillEvent?.speedSegmentEndIndex).toBe(
    (frenzy?.skillEvent?.speedSegmentStartIndex ?? 0) + (frenzy?.skillEvent?.speedSegmentSpan ?? 0)
  );
  expect(frenzy?.skillEvent?.durationSeconds).toBeGreaterThan(0);
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

test('uses two speed segments as the frenzy span odds baseline', () => {
  expect(FRENZY_SPEED_SEGMENT_SPAN_CHANCES).toEqual([
    { span: 1, chance: 0.07 },
    { span: 2, chance: 0.035 },
    { span: 3, chance: 0.0175 },
    { span: 4, chance: 0.00875 },
    { span: 5, chance: 0.004375 }
  ]);
});

test('keeps the two-segment frenzy span close to 3.5 percent over repeated races', () => {
  const names = createSampleParticipants(18);
  const spanCounts = new Map<number, number>();

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
    const span = tournament.races[0]?.placements.find((placement) => placement.skillEvent?.skill.id === FRENZY_SKILL_ID)?.skillEvent
      ?.speedSegmentSpan;

    if (span) {
      spanCounts.set(span, (spanCounts.get(span) ?? 0) + 1);
    }
  }

  expect(spanCounts.get(1)).toBeGreaterThanOrEqual(55);
  expect(spanCounts.get(1)).toBeLessThanOrEqual(85);
  expect(spanCounts.get(2)).toBeGreaterThanOrEqual(25);
  expect(spanCounts.get(2)).toBeLessThanOrEqual(50);
  expect(spanCounts.get(3)).toBeGreaterThanOrEqual(10);
  expect(spanCounts.get(3)).toBeLessThanOrEqual(28);
  expect(spanCounts.get(4)).toBeGreaterThanOrEqual(4);
  expect(spanCounts.get(4)).toBeLessThanOrEqual(16);
  expect(spanCounts.get(5)).toBeGreaterThanOrEqual(1);
  expect(spanCounts.get(5)).toBeLessThanOrEqual(10);
});
