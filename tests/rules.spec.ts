import { expect, test } from '@playwright/test';
import {
  createSampleParticipants,
  FRENZY_RANK_CHANCE_FACTORS,
  FRENZY_SKILL_ID,
  FRENZY_SPEED_SEGMENT_SPAN_CHANCES,
  getRaceOptionBounds,
  runTournament,
  type RacePlacement,
  type SpeedSegment,
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
      winnerCount: 1
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
    winnerCount: 20
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
  const shotLiveRanks = new Map<number, number>();
  const winnerLanes = new Map<number, number>();
  let topThirdShots = 0;
  let middleThirdShots = 0;
  let bottomThirdShots = 0;
  let liveTopThirdShots = 0;
  let liveMiddleThirdShots = 0;
  let liveBottomThirdShots = 0;

  for (let index = 1; index <= 200; index += 1) {
    const tournament = runTournament(names, {
      seed: `트랙분포-${String(index).padStart(3, '0')}`,
      fieldSize: 20,
      qualifiersPerGroup: 2,
      winnerCount: 1
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
      const liveRank = getLiveRankById(race.placements, hazard.triggerSeconds).get(hazard.targetEntryId);

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

      if (liveRank) {
        shotLiveRanks.set(liveRank, (shotLiveRanks.get(liveRank) ?? 0) + 1);

        if (liveRank <= 6) {
          liveTopThirdShots += 1;
        } else if (liveRank <= 12) {
          liveMiddleThirdShots += 1;
        } else {
          liveBottomThirdShots += 1;
        }
      }
    });
  }

  const shotCounts = [...shotLanes.values()];
  const shotBaseRankCounts = [...shotBaseRanks.values()];
  const shotLiveRankCounts = [...shotLiveRanks.values()];
  const winnerCounts = [...winnerLanes.values()];

  expect(shotLanes.size).toBe(20);
  expect(shotBaseRanks.size).toBe(20);
  expect(shotLiveRanks.size).toBe(20);
  expect(winnerLanes.size).toBeGreaterThanOrEqual(15);
  expect(Math.max(...shotCounts)).toBeLessThanOrEqual(90);
  expect(Math.max(...shotBaseRankCounts)).toBeLessThanOrEqual(95);
  expect(Math.min(...shotBaseRankCounts)).toBeGreaterThanOrEqual(45);
  expect(Math.max(...shotLiveRankCounts)).toBeLessThanOrEqual(95);
  expect(Math.min(...shotLiveRankCounts)).toBeGreaterThanOrEqual(45);
  expect(topThirdShots).toBeGreaterThanOrEqual(300);
  expect(topThirdShots).toBeLessThanOrEqual(500);
  expect(middleThirdShots).toBeGreaterThanOrEqual(300);
  expect(middleThirdShots).toBeLessThanOrEqual(500);
  expect(bottomThirdShots).toBeGreaterThanOrEqual(300);
  expect(bottomThirdShots).toBeLessThanOrEqual(520);
  expect(liveTopThirdShots).toBeGreaterThanOrEqual(300);
  expect(liveTopThirdShots).toBeLessThanOrEqual(500);
  expect(liveMiddleThirdShots).toBeGreaterThanOrEqual(300);
  expect(liveMiddleThirdShots).toBeLessThanOrEqual(500);
  expect(liveBottomThirdShots).toBeGreaterThanOrEqual(390);
  expect(liveBottomThirdShots).toBeLessThanOrEqual(560);
  expect(Math.max(...winnerCounts)).toBeLessThanOrEqual(24);
});

test('applies frenzy mode to dance skill events without replacing the dance skill', () => {
  const names = createSampleParticipants(18);
  const tournament = runTournament(names, {
    seed: '댄스광폭-0113',
    fieldSize: 18,
    qualifiersPerGroup: 2,
    winnerCount: 1
  });
  const dance = tournament.races[0]?.placements.find((placement) =>
    placement.skillEvents.some((skillEvent) => skillEvent.skill.id === 'corner-dance' && !placement.eliminatedByHelicopter)
  );
  const danceSkillEvent = dance?.skillEvents.find((skillEvent) => skillEvent.skill.id === 'corner-dance');

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
    winnerCount: 1
  });
  const placement = tournament.races[0]?.placements.find(
    (candidate) => !candidate.eliminatedByHelicopter && candidate.skillEvents.some((skillEvent) => skillEvent.skill.pose === 'lie-flat')
  );
  const event: SkillEvent | undefined = placement?.skillEvents.find((skillEvent) => skillEvent.skill.pose === 'lie-flat');

  expect(placement).toBeTruthy();
  expect(event?.skill.pose).toBe('lie-flat');
  expect(['flatout-glide', 'sand-sparkle']).toContain(event?.skill.id);
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
    winnerCount: 1
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

test('biases random frenzy surges away from leaders and toward trailing runners', () => {
  expect(FRENZY_RANK_CHANCE_FACTORS).toEqual([
    { maxRankProgress: 0.26, multiplier: 0.06 },
    { maxRankProgress: 0.45, multiplier: 0.35 },
    { maxRankProgress: 0.65, multiplier: 0.9 },
    { maxRankProgress: 0.82, multiplier: 1.45 },
    { maxRankProgress: 1, multiplier: 2.5 }
  ]);

  const names = createSampleParticipants(20);
  let leaderGroupFrenzies = 0;
  let middleGroupFrenzies = 0;
  let trailingGroupFrenzies = 0;

  for (let index = 1; index <= 800; index += 1) {
    const tournament = runTournament(names, {
      seed: `후미광폭-${String(index).padStart(4, '0')}`,
      fieldSize: 20,
      qualifiersPerGroup: 2,
      winnerCount: 1
    });
    const race = tournament.races[0];

    race?.placements.forEach((placement) => {
      placement.skillEvents
        .filter((skillEvent) => skillEvent.skill.id === FRENZY_SKILL_ID)
        .forEach((skillEvent) => {
          const rankProgress = getSegmentRankProgress(race.placements, skillEvent.speedSegmentStartIndex ?? 0, placement);

          if (rankProgress <= 0.26) {
            leaderGroupFrenzies += 1;
          } else if (rankProgress <= 0.65) {
            middleGroupFrenzies += 1;
          } else {
            trailingGroupFrenzies += 1;
          }
        });
    });
  }

  const total = leaderGroupFrenzies + middleGroupFrenzies + trailingGroupFrenzies;

  expect(total).toBeGreaterThan(900);
  expect(leaderGroupFrenzies).toBeLessThan(total * 0.08);
  expect(middleGroupFrenzies).toBeGreaterThan(leaderGroupFrenzies * 5);
  expect(trailingGroupFrenzies).toBeGreaterThan(middleGroupFrenzies * 2);
});

test('keeps every rotating frenzy event at three speed segments', () => {
  const names = createSampleParticipants(18);
  const spanCounts = new Map<number, number>();

  for (let index = 1; index <= 1000; index += 1) {
    const tournament = runTournament(names, {
      seed: `광폭확률-${String(index).padStart(4, '0')}`,
      fieldSize: 18,
      qualifiersPerGroup: 2,
      winnerCount: 1
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

function getSegmentRankProgress(placements: RacePlacement[], segmentIndex: number, target: RacePlacement) {
  const rankedPlacements = [...placements].sort((left, right) => {
    const leftSeconds = getPlacementBaseRaceClockAtSegmentEnd(left, segmentIndex);
    const rightSeconds = getPlacementBaseRaceClockAtSegmentEnd(right, segmentIndex);
    return leftSeconds - rightSeconds || left.entry.id.localeCompare(right.entry.id);
  });
  const rank = rankedPlacements.findIndex((placement) => placement.entry.id === target.entry.id) + 1;

  return rankedPlacements.length <= 1 ? 1 : (rank - 1) / (rankedPlacements.length - 1);
}

function getLiveRankById(placements: RacePlacement[], elapsedSeconds: number) {
  return new Map(
    [...placements]
      .sort((left, right) => {
        const rightProgress = getRaceProgressAtElapsed(right, elapsedSeconds);
        const leftProgress = getRaceProgressAtElapsed(left, elapsedSeconds);
        return rightProgress - leftProgress || left.entry.id.localeCompare(right.entry.id);
      })
      .map((placement, index) => [placement.entry.id, index + 1])
  );
}

function getRaceProgressAtElapsed(placement: RacePlacement, elapsedSeconds: number) {
  const baseElapsedSeconds = getProgressElapsedSeconds(placement, elapsedSeconds);

  if (placement.speedSegments.length === 0) {
    return Math.max(0, Math.min(1, baseElapsedSeconds / Math.max(0.001, placement.baseFinishSeconds)));
  }

  const segmentWeights = placement.speedSegments.map((segment) => 1 / Math.max(0.1, segment.multiplier));
  const totalWeight = segmentWeights.reduce((sum, value) => sum + value, 0);
  let elapsedCursor = 0;

  for (let index = 0; index < placement.speedSegments.length; index += 1) {
    const segmentSeconds = placement.baseFinishSeconds * ((segmentWeights[index] ?? 1) / totalWeight);

    if (baseElapsedSeconds <= elapsedCursor + segmentSeconds || index === placement.speedSegments.length - 1) {
      const localProgress = Math.max(0, Math.min(1, (baseElapsedSeconds - elapsedCursor) / Math.max(0.001, segmentSeconds)));
      return Math.max(0, Math.min(1, (index + localProgress) / placement.speedSegments.length));
    }

    elapsedCursor += segmentSeconds;
  }

  return 1;
}

function getProgressElapsedSeconds(placement: RacePlacement, elapsedSeconds: number) {
  const speedEvents = getSpeedEvents(placement);

  if (speedEvents.length === 0) {
    return Math.min(elapsedSeconds, placement.baseFinishSeconds);
  }

  const boundaries = new Set<number>([0, placement.baseFinishSeconds]);

  speedEvents.forEach((skillEvent) => {
    const baseStart = skillEvent.baseTriggerSeconds ?? skillEvent.triggerSeconds;
    const baseEnd = baseStart + skillEvent.durationSeconds * skillEvent.speedMultiplier;
    boundaries.add(Math.max(0, Math.min(placement.baseFinishSeconds, baseStart)));
    boundaries.add(Math.max(0, Math.min(placement.baseFinishSeconds, baseEnd)));
  });

  const points = [...boundaries].sort((left, right) => left - right);
  let raceClockCursor = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index] ?? 0;
    const end = points[index + 1] ?? start;
    const midpoint = (start + end) / 2;
    const multiplier = getSpeedMultiplierAtBaseElapsed(midpoint, speedEvents);
    const duration = (end - start) / multiplier;

    if (elapsedSeconds <= raceClockCursor + duration) {
      return start + (elapsedSeconds - raceClockCursor) * multiplier;
    }

    raceClockCursor += duration;
  }

  return placement.baseFinishSeconds + Math.max(0, elapsedSeconds - raceClockCursor);
}

function getSpeedEvents(placement: RacePlacement) {
  return placement.skillEvents
    .filter(hasSpeedSkill)
    .sort((left, right) => (left.baseTriggerSeconds ?? left.triggerSeconds) - (right.baseTriggerSeconds ?? right.triggerSeconds));
}

function hasSpeedSkill(skillEvent: SkillEvent | null | undefined): skillEvent is SkillEvent & { speedMultiplier: number } {
  return Boolean(skillEvent?.triggerSeconds !== undefined && skillEvent.speedMultiplier !== undefined && skillEvent.speedMultiplier > 1);
}

function getSpeedMultiplierAtBaseElapsed(baseElapsedSeconds: number, speedEvents: Array<SkillEvent & { speedMultiplier: number }>) {
  return speedEvents.reduce((multiplier, skillEvent) => {
    const baseStart = skillEvent.baseTriggerSeconds ?? skillEvent.triggerSeconds;
    const baseEnd = baseStart + skillEvent.durationSeconds * skillEvent.speedMultiplier;
    return baseElapsedSeconds >= baseStart && baseElapsedSeconds < baseEnd ? Math.max(multiplier, skillEvent.speedMultiplier) : multiplier;
  }, 1);
}

function getPlacementBaseRaceClockAtSegmentEnd(placement: RacePlacement, segmentIndex: number) {
  const fallbackProgress = (segmentIndex + 1) / Math.max(1, placement.speedSegments.length);
  const segment = placement.speedSegments[Math.max(0, Math.min(placement.speedSegments.length - 1, segmentIndex))];
  return getSegmentedTimeAtProgress(placement.baseFinishSeconds, placement.speedSegments, segment?.endProgress ?? fallbackProgress);
}

function getSegmentedTimeAtProgress(finishSeconds: number, speedSegments: SpeedSegment[], progress: number) {
  if (speedSegments.length === 0) {
    return finishSeconds * progress;
  }

  const clampedProgress = Math.max(0, Math.min(1, progress));
  const segmentWeights = speedSegments.map((segment) => 1 / Math.max(0.1, segment.multiplier));
  const totalWeight = segmentWeights.reduce((sum, value) => sum + value, 0);
  const targetSegmentFloat = clampedProgress * speedSegments.length;
  const targetSegmentIndex = Math.min(speedSegments.length - 1, Math.floor(targetSegmentFloat));
  const localProgress = targetSegmentFloat - targetSegmentIndex;
  let elapsedSeconds = 0;

  for (let index = 0; index < targetSegmentIndex; index += 1) {
    elapsedSeconds += finishSeconds * ((segmentWeights[index] ?? 1) / totalWeight);
  }

  elapsedSeconds += finishSeconds * ((segmentWeights[targetSegmentIndex] ?? 1) / totalWeight) * localProgress;

  return elapsedSeconds;
}
