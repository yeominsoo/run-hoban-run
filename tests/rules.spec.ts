import { expect, test } from '@playwright/test';
import {
  createSampleParticipants,
  FRENZY_SKILL_ID,
  FRENZY_SPEED_SEGMENT_SPAN_CHANCES,
  getRaceOptionBounds,
  runTournament,
  type SkillEvent
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

  expect(wins.get('1번주자')).toBeGreaterThanOrEqual(1);
  expect(wins.get('1번주자')).toBeLessThanOrEqual(5);
  expect(winCounts.filter((count) => count > 0)).toHaveLength(6);
  expect(Math.max(...winCounts)).toBeLessThanOrEqual(7);
});

test('caps race option bounds to the participant count', () => {
  const names = createSampleParticipants(6);
  const bounds = getRaceOptionBounds(names.length, 20);
  const tournament = runTournament(names, {
    seed: '참가자-상한',
    fieldSize: 20,
    qualifiersPerGroup: 17,
    winnerCount: 20,
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
  const names = createSampleParticipants(20);
  const shotLanes = new Map<number, number>();
  const shotBaseRanks = new Map<number, number>();
  const winnerLanes = new Map<number, number>();
  let topThirdShots = 0;
  let middleThirdShots = 0;
  let bottomThirdShots = 0;

  for (let index = 1; index <= 200; index += 1) {
    const tournament = runTournament(names, {
      seed: `트랙분포-${String(index).padStart(3, '0')}`,
      fieldSize: 20,
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

    expect(new Set(race.placements.map((placement) => placement.laneIndex)).size).toBe(20);

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

  expect(shotLanes.size).toBe(20);
  expect(shotBaseRanks.size).toBe(20);
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
  const dance = tournament.races[0]?.placements.find((placement) =>
    placement.skillEvents.some((skillEvent) => skillEvent.skill.pose === 'dance' && !placement.eliminatedByHelicopter)
  );
  const danceSkillEvent = dance?.skillEvents.find((skillEvent) => skillEvent.skill.pose === 'dance');

  expect(dance).toBeTruthy();
  expect(danceSkillEvent?.skill.id).toBe('corner-dance');
  expect(danceSkillEvent?.skill.id).not.toBe(FRENZY_SKILL_ID);
  expect(danceSkillEvent?.skill.cinematic).toBe('frenzy');
  expect(danceSkillEvent?.speedMultiplier).toBe(3);
  expect(danceSkillEvent?.speedSegmentSpan).toBe(3);
  expect(danceSkillEvent?.durationSeconds).toBeGreaterThan(0);
  expect(dance?.finishSeconds).toBeLessThan(dance?.baseFinishSeconds ?? 0);
});

test('applies frenzy mode to lie-flat skill events without replacing the motion skill', () => {
  const names = createSampleParticipants(18);
  const tournament = runTournament(names, {
    seed: 'seed-flatout-glide-0001',
    fieldSize: 18,
    qualifiersPerGroup: 2,
    winnerCount: 1,
    surface: 'turf',
    distance: 'mile',
    condition: 'firm'
  });
  const placement = tournament.races[0]?.placements.find(
    (candidate) => !candidate.eliminatedByHelicopter && candidate.skillEvents.some((skillEvent) => skillEvent.skill.pose === 'lie-flat')
  );
  const event: SkillEvent | undefined = placement?.skillEvents.find((skillEvent) => skillEvent.skill.pose === 'lie-flat');

  expect(placement).toBeTruthy();
  expect(event?.skill.pose).toBe('lie-flat');
  expect(['flatout-glide', 'turf-slide']).toContain(event?.skill.id);
  expect(event?.skill.id).not.toBe(FRENZY_SKILL_ID);
  expect(event?.skill.cinematic).toBe('frenzy');
  expect(event?.speedMultiplier).toBe(3);
  expect(event?.speedSegmentSpan).toBe(3);
  expect(event?.durationSeconds).toBeGreaterThan(0);
  expect(placement?.finishSeconds).toBeLessThan(placement?.baseFinishSeconds ?? 0);
});

test('rolls skills and speed changes from segment-arrival checks without a race skill cap', () => {
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
  const race = tournament.races[0];
  const placements = race?.placements ?? [];
  const skillEvents = placements.flatMap((placement) => placement.skillEvents);
  const frenzy = placements.find((placement) => placement.skillEvents.some((skillEvent) => skillEvent.skill.id === FRENZY_SKILL_ID));
  const frenzySkillEvent = frenzy?.skillEvents.find((skillEvent) => skillEvent.skill.id === FRENZY_SKILL_ID);

  expect(skillEvents.length).toBeGreaterThan(10);
  expect(placements.some((placement) => placement.skillEvents.length > 1)).toBe(true);
  expect(placements.every((placement) => placement.speedSegments.every((segment) => segment.rollMode === 'segment-arrival'))).toBe(true);
  expect(placements.every((placement) => placement.speedSegments.every((segment) => segment.rollProgress === segment.startProgress))).toBe(true);
  expect(placements.every((placement) => placement.speedSegments.every((segment) => segment.rollSeed.includes(':speed-arrival:')))).toBe(true);
  expect(skillEvents.every((skillEvent) => skillEvent.rollMode === 'segment-arrival')).toBe(true);
  expect(skillEvents.every((skillEvent) => skillEvent.triggerSeconds !== undefined && skillEvent.baseTriggerSeconds !== undefined)).toBe(true);
  expect(frenzy).toBeTruthy();
  expect(frenzySkillEvent?.speedMultiplier).toBe(3);
  expect(frenzySkillEvent?.speedSegmentSpan).toBe(3);
  expect(frenzySkillEvent?.speedSegmentEndIndex).toBe(
    (frenzySkillEvent?.speedSegmentStartIndex ?? 0) + (frenzySkillEvent?.speedSegmentSpan ?? 0)
  );
  expect(frenzySkillEvent?.durationSeconds).toBeGreaterThan(0);
  expect(frenzySkillEvent?.triggerSeconds).toBeGreaterThan(0);
  expect(frenzy?.finishSeconds).toBeLessThan(frenzy?.baseFinishSeconds ?? 0);
});

test('keeps rotating frenzy mode active for three speed segments', () => {
  expect(FRENZY_SPEED_SEGMENT_SPAN_CHANCES).toEqual([
    { span: 3, chance: 1 }
  ]);
});

test('keeps every rotating frenzy event at three speed segments', () => {
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
    const spans = tournament.races[0]?.placements.flatMap((placement) =>
      placement.skillEvents
        .filter((skillEvent) => skillEvent.skill.cinematic === 'frenzy')
        .map((skillEvent) => skillEvent.speedSegmentSpan)
    );

    spans?.forEach((span) => {
      if (span) {
        spanCounts.set(span, (spanCounts.get(span) ?? 0) + 1);
      }
    });
  }

  const total = [...spanCounts.values()].reduce((sum, count) => sum + count, 0);

  expect(total).toBeGreaterThan(5000);
  expect(spanCounts.size).toBe(1);
  expect(spanCounts.get(3)).toBe(total);
});
