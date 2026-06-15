export type Pattern = 'solid' | 'spots' | 'stripes' | 'socks';
export type SkillPose = 'handstand' | 'dance' | 'lie-flat' | 'cheer' | 'headspin';
export type FrenzySpeedSegmentSpan = 1 | 2 | 3 | 4 | 5;

export type SkillDefinition = {
  id: string;
  name: string;
  phase: 'start' | 'corner' | 'middle' | 'last';
  pose: SkillPose;
  effectColor: number;
  callout: string;
  cinematic?: 'frenzy';
};

export type HorseProfile = {
  id: string;
  participantName: string;
  color: number;
  secondaryColor: number;
  pattern: Pattern;
};

export type RaceOptions = {
  seed: string;
  fieldSize: number;
  qualifiersPerGroup: number;
  winnerCount: number;
};

export type RaceEntry = {
  id: string;
  name: string;
  profile: HorseProfile;
};

export type SkillEvent = {
  skill: SkillDefinition;
  triggerProgress: number;
  triggerSeconds?: number;
  baseTriggerSeconds?: number;
  durationSeconds: number;
  speedMultiplier?: number;
  speedSegmentSpan?: FrenzySpeedSegmentSpan;
  speedSegmentStartIndex?: number;
  speedSegmentEndIndex?: number;
  triggerSegmentIndex?: number;
  rollMode?: 'segment-arrival';
};

export type HazardEvent = {
  type: 'helicopter-snipe';
  targetEntryId: string;
  triggerProgress: number;
  triggerSeconds: number;
  approachSeconds: number;
};

export type SpeedSegment = {
  index: number;
  startProgress: number;
  endProgress: number;
  multiplier: number;
  label: string;
  rollMode: 'segment-arrival';
  rollProgress: number;
  rollSeed: string;
};

export type RacePlacement = {
  entry: RaceEntry;
  rank: number;
  laneIndex: number;
  baseFinishSeconds: number;
  finishSeconds: number;
  qualified: boolean;
  skillEvent: SkillEvent | null;
  skillEvents: SkillEvent[];
  eliminatedByHelicopter: boolean;
  speedSegments: SpeedSegment[];
};

export type RaceResult = {
  id: string;
  round: number;
  group: number;
  isFinal: boolean;
  options: RaceOptions;
  entries: RaceEntry[];
  placements: RacePlacement[];
  qualifiers: RaceEntry[];
  hazardEvents: HazardEvent[];
  speedSegmentCount: number;
};

export type TournamentResult = {
  options: RaceOptions;
  participantCount: number;
  races: RaceResult[];
  winners: RaceEntry[];
};

const PATTERNS: Pattern[] = ['solid', 'spots', 'stripes', 'socks'];
const BASE_FINISH_SECONDS = 92;
const HELICOPTER_ENTRANCE_SECONDS = 3;
const BULLET_FLIGHT_SECONDS = 0.9;
const MAX_FIELD_SIZE = 20;
export const FRENZY_SKILL_ID = 'frenzy-surge';
const FRENZY_SPEED_MULTIPLIER = 3;
const MOTION_EVENT_CHANCE_PER_SEGMENT = 0.04;
const FRENZY_EVENT_CHANCE_PER_SEGMENT = 0.006;

export const FRENZY_SPEED_SEGMENT_SPAN_CHANCES: ReadonlyArray<{
  span: FrenzySpeedSegmentSpan;
  chance: number;
}> = [
  { span: 3, chance: 1 }
];

export const SKILLS: SkillDefinition[] = [
  {
    id: 'rocket-start',
    name: '로켓 출발',
    phase: 'start',
    pose: 'handstand',
    effectColor: 0xff6b35,
    callout: '출발대에서 폭발적으로 치고 나간다'
  },
  {
    id: 'corner-dance',
    name: '코너 댄스',
    phase: 'corner',
    pose: 'dance',
    effectColor: 0xf2c94c,
    callout: '코너를 무대처럼 휘감아 돈다'
  },
  {
    id: 'flatout-glide',
    name: '납작 활주',
    phase: 'middle',
    pose: 'lie-flat',
    effectColor: 0x56ccf2,
    callout: '낮게 엎드려 속도를 끌어올린다'
  },
  {
    id: 'finish-frenzy',
    name: '결승 광란',
    phase: 'last',
    pose: 'cheer',
    effectColor: 0xff4d8d,
    callout: '결승 직선에서 거칠게 몰아친다'
  },
  {
    id: 'mud-splash',
    name: '모래바람 질주',
    phase: 'middle',
    pose: 'dance',
    effectColor: 0x8b5e34,
    callout: '뒤쪽으로 흙먼지를 크게 뿌린다'
  },
  {
    id: 'sand-sparkle',
    name: '반짝 모래길',
    phase: 'corner',
    pose: 'lie-flat',
    effectColor: 0xf2c94c,
    callout: '모래길을 반짝이며 치고 나간다'
  }
];

export const FRENZY_SKILL: SkillDefinition = {
  id: FRENZY_SKILL_ID,
  name: '광폭 질주',
  phase: 'middle',
  pose: 'headspin',
  effectColor: 0xff3030,
  callout: '콧김을 뿜고 물구나무 헤드스핀으로 폭주한다',
  cinematic: 'frenzy'
};

const SAMPLE_FIRST = [
  '혜성',
  '민트',
  '번개',
  '남색',
  '장미',
  '재빛',
  '구리',
  '라임',
  '질주',
  '보라',
  '대리석',
  '청록',
  '햇살',
  '후추',
  '루비',
  '폭풍',
  '개암',
  '픽셀',
  '궤도',
  '잿불'
];

const SAMPLE_LAST = [
  '주자',
  '발굽',
  '로켓',
  '표류',
  '섬광',
  '전력',
  '큰걸음',
  '회오리',
  '꽃길',
  '불꽃'
];

export function createSampleParticipants(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const first = SAMPLE_FIRST[index % SAMPLE_FIRST.length];
    const last = SAMPLE_LAST[Math.floor(index / SAMPLE_FIRST.length) % SAMPLE_LAST.length];
    return `${first} ${last} ${index + 1}`;
  });
}

export function getRaceOptionBounds(participantCount: number, fieldSize?: number) {
  const normalizedParticipantCount = clampInteger(participantCount, 1, 500);
  const minFieldSize = normalizedParticipantCount > 1 ? 2 : 1;
  const maxFieldSize = Math.max(minFieldSize, Math.min(MAX_FIELD_SIZE, normalizedParticipantCount));
  const effectiveFieldSize = clampInteger(fieldSize ?? maxFieldSize, minFieldSize, maxFieldSize);

  return {
    fieldSize: {
      min: minFieldSize,
      max: maxFieldSize
    },
    qualifiersPerGroup: {
      min: 1,
      max: Math.max(1, effectiveFieldSize - 1)
    },
    winnerCount: {
      min: 1,
      max: Math.max(1, Math.min(effectiveFieldSize, normalizedParticipantCount))
    }
  };
}

export function sanitizeOptions(options: Partial<RaceOptions>, participantCount = MAX_FIELD_SIZE): RaceOptions {
  const fieldBounds = getRaceOptionBounds(participantCount);
  const fieldSize = clampInteger(options.fieldSize ?? fieldBounds.fieldSize.max, fieldBounds.fieldSize.min, fieldBounds.fieldSize.max);
  const bounds = getRaceOptionBounds(participantCount, fieldSize);
  const qualifiersPerGroup = clampInteger(
    options.qualifiersPerGroup ?? Math.min(2, bounds.qualifiersPerGroup.max),
    bounds.qualifiersPerGroup.min,
    bounds.qualifiersPerGroup.max
  );
  const winnerCount = clampInteger(options.winnerCount ?? 1, bounds.winnerCount.min, bounds.winnerCount.max);

  return {
    seed: String(options.seed?.trim() || '호반-2026'),
    fieldSize,
    qualifiersPerGroup,
    winnerCount
  };
}

export function normalizeParticipants(input: string[]) {
  const seen = new Map<string, number>();
  const names = input
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 500)
    .map((name) => {
      const count = seen.get(name) ?? 0;
      seen.set(name, count + 1);
      return count === 0 ? name : `${name} ${count + 1}`;
    });

  if (names.length === 0) {
    return createSampleParticipants(20);
  }

  return names;
}

export function runTournament(rawParticipants: string[], rawOptions: Partial<RaceOptions>) {
  const names = normalizeParticipants(rawParticipants);
  const options = sanitizeOptions(rawOptions, names.length);
  const profiles = names.map((name, index) => createHorseProfile(name, index, options.seed));
  let contenders = profiles.map((profile) => toEntry(profile));
  const races: RaceResult[] = [];
  let round = 1;

  while (contenders.length > 0) {
    const isFinal = contenders.length <= options.fieldSize;
    const groups = makeBalancedGroups(contenders, options.fieldSize);
    const nextRound: RaceEntry[] = [];

    groups.forEach((group, groupIndex) => {
      const race = simulateRace(group, {
        options,
        round,
        group: groupIndex + 1,
        isFinal
      });

      races.push(race);
      nextRound.push(...race.qualifiers);
    });

    if (isFinal) {
      return {
        options,
        participantCount: names.length,
        races,
        winners: nextRound.slice(0, options.winnerCount)
      };
    }

    contenders = nextRound;
    round += 1;

    if (round > 20) {
      throw new Error('토너먼트가 끝나지 않습니다. 조별 진출 수를 줄여 주세요.');
    }
  }

  return {
    options,
    participantCount: names.length,
    races,
    winners: []
  };
}

function toEntry(profile: HorseProfile): RaceEntry {
  return {
    id: profile.id,
    name: profile.participantName,
    profile
  };
}

function createHorseProfile(participantName: string, index: number, seed: string): HorseProfile {
  const rng = createRng(`${seed}:profile:${participantName}:${index}`);
  const color = hslToNumber(rng(), 0.62 + rng() * 0.22, 0.48 + rng() * 0.16);
  const secondaryColor = hslToNumber((rng() + 0.42) % 1, 0.5 + rng() * 0.22, 0.58 + rng() * 0.18);

  return {
    id: `runner-${index + 1}-${hashString(participantName).toString(16)}`,
    participantName,
    color,
    secondaryColor,
    pattern: pick(PATTERNS, rng)
  };
}

function simulateRace(
  entries: RaceEntry[],
  context: { options: RaceOptions; round: number; group: number; isFinal: boolean }
): RaceResult {
  const { options, round, group, isFinal } = context;
  const laneIndexes = assignRaceLaneIndexes(entries, options, round, group);
  const placements = entries.map((entry) => {
    const speedSegments = rollHorseSpeedSegments(entry, options, round, group);
    const segmentScale =
      speedSegments.reduce((sum, segment) => sum + 1 / Math.max(0.1, segment.multiplier), 0) / speedSegments.length;
    const finishSeconds = clampNumber(BASE_FINISH_SECONDS * segmentScale, 62, 118);
    const skillEvents = rollSkillEvents(entry, options, round, group, speedSegments, finishSeconds);

    return {
      entry,
      rank: 0,
      laneIndex: laneIndexes.get(entry.id) ?? 0,
      baseFinishSeconds: finishSeconds,
      finishSeconds,
      qualified: false,
      skillEvent: getPrimarySkillEvent(skillEvents),
      skillEvents,
      eliminatedByHelicopter: false,
      speedSegments
    };
  });

  applyMotionFrenzyModes(placements, options, round, group);
  applyRandomFrenzySkills(placements, options, round, group);
  placements.forEach(finalizePlacementSkillEvents);

  const hazardDrafts = rollHelicopterHazards(placements, options, round, group);
  const hazardTargetIds = new Set(hazardDrafts.map((hazard) => hazard.targetEntryId));
  placements.forEach((placement) => {
    placement.eliminatedByHelicopter = hazardTargetIds.has(placement.entry.id);
  });

  const leadPlacement = placements.reduce((lead, placement) => (placement.finishSeconds < lead.finishSeconds ? placement : lead), placements[0]);
  const firstShotSeconds = Number((leadPlacement ? getRaceClockAtProgress(leadPlacement, 0.5) : 0).toFixed(3));
  const helicopterApproachSeconds = Number(Math.max(0, firstShotSeconds - HELICOPTER_ENTRANCE_SECONDS - BULLET_FLIGHT_SECONDS).toFixed(3));
  const shotSpacingSeconds = 2.4;

  const hazardEvents = hazardDrafts
    .map((hazardDraft) => {
      const draftIndex = hazardDrafts.indexOf(hazardDraft);
      const targetPlacement = placements.find((placement) => placement.entry.id === hazardDraft.targetEntryId);

      if (!targetPlacement) {
        return null;
      }

      const triggerSeconds = Number((firstShotSeconds + draftIndex * shotSpacingSeconds).toFixed(3));

      return {
        ...hazardDraft,
        triggerProgress: Number(clampNumber(triggerSeconds / targetPlacement.finishSeconds, 0.2, 0.92).toFixed(3)),
        triggerSeconds,
        approachSeconds: helicopterApproachSeconds
      };
    })
    .filter((hazard): hazard is HazardEvent => Boolean(hazard))
    .sort((left, right) => left.triggerSeconds - right.triggerSeconds);

  placements.sort((left, right) => {
    if (left.eliminatedByHelicopter !== right.eliminatedByHelicopter) {
      return left.eliminatedByHelicopter ? 1 : -1;
    }

    return left.finishSeconds - right.finishSeconds;
  });

  const lastFinisherSeconds = Math.max(
    ...placements.filter((placement) => !placement.eliminatedByHelicopter).map((placement) => placement.finishSeconds)
  );

  placements.forEach((placement, index) => {
    placement.rank = index + 1;
    placement.finishSeconds = placement.eliminatedByHelicopter
      ? Number((lastFinisherSeconds + 1.2).toFixed(3))
      : Number((placement.finishSeconds + index * 0.045).toFixed(3));
    placement.qualified = !placement.eliminatedByHelicopter && index < (isFinal ? options.winnerCount : options.qualifiersPerGroup);
  });

  const sortedEntries = placements.map((placement) => placement.entry);

  return {
    id: `round-${round}-group-${group}`,
    round,
    group,
    isFinal,
    options,
    entries: sortedEntries,
    placements,
    qualifiers: placements.filter((placement) => placement.qualified).map((placement) => placement.entry),
    hazardEvents,
    speedSegmentCount: 20
  };
}

function applyMotionFrenzyModes(placements: RacePlacement[], options: RaceOptions, round: number, group: number) {
  placements.forEach((placement) => {
    placement.skillEvents.forEach((skillEvent, eventIndex) => {
      if (!shouldApplyFrenzyModeToMotionSkill(skillEvent.skill) || hasSpeedSkill(skillEvent)) {
        return;
      }

      const rng = createRng(`${options.seed}:motion-frenzy:${round}:${group}:${placement.entry.id}:${eventIndex}`);
      const speedSegmentSpan = rollGuaranteedFrenzySpeedSegmentSpan(rng);
      applyFrenzyModeToSkillEvent(placement, skillEvent, withFrenzyCinematic(skillEvent.skill), speedSegmentSpan);
    });
  });
}

function shouldApplyFrenzyModeToMotionSkill(skill: SkillDefinition) {
  return skill.pose === 'dance' || skill.pose === 'lie-flat';
}

function applyRandomFrenzySkills(placements: RacePlacement[], options: RaceOptions, round: number, group: number) {
  placements.forEach((placement) => {
    placement.speedSegments.forEach((segment) => {
      const rng = createRng(`${options.seed}:frenzy-arrival:${round}:${group}:${placement.entry.id}:${segment.index}`);

      if (rng() >= FRENZY_EVENT_CHANCE_PER_SEGMENT) {
        return;
      }

      const speedSegmentSpan = rollGuaranteedFrenzySpeedSegmentSpan(rng);
      const event = createSegmentSkillEvent(FRENZY_SKILL, placement, segment, rng, 0.72);
      applyFrenzyModeToSkillEvent(placement, event, FRENZY_SKILL, speedSegmentSpan);
      placement.skillEvents.push(event);
    });
  });
}

function applyFrenzyModeToSkillEvent(
  placement: RacePlacement,
  skillEvent: SkillEvent,
  skill: SkillDefinition,
  speedSegmentSpan: FrenzySpeedSegmentSpan
) {
  const segmentTiming = getFrenzyTimingFromSegment(placement, skillEvent.triggerSegmentIndex ?? 0, speedSegmentSpan);

  skillEvent.skill = skill;
  skillEvent.triggerProgress = segmentTiming.triggerProgress;
  skillEvent.baseTriggerSeconds = segmentTiming.baseTriggerSeconds;
  skillEvent.durationSeconds = segmentTiming.durationSeconds;
  skillEvent.speedMultiplier = FRENZY_SPEED_MULTIPLIER;
  skillEvent.speedSegmentSpan = speedSegmentSpan;
  skillEvent.speedSegmentStartIndex = segmentTiming.startIndex;
  skillEvent.speedSegmentEndIndex = segmentTiming.endIndex;
}

function withFrenzyCinematic(skill: SkillDefinition): SkillDefinition {
  if (skill.cinematic === 'frenzy') {
    return skill;
  }

  return {
    ...skill,
    cinematic: 'frenzy'
  };
}

function rollGuaranteedFrenzySpeedSegmentSpan(rng: () => number): FrenzySpeedSegmentSpan {
  const totalChance = FRENZY_SPEED_SEGMENT_SPAN_CHANCES.reduce((sum, item) => sum + item.chance, 0);
  let roll = rng() * totalChance;

  for (const item of FRENZY_SPEED_SEGMENT_SPAN_CHANCES) {
    if (roll < item.chance) {
      return item.span;
    }

    roll -= item.chance;
  }

  return FRENZY_SPEED_SEGMENT_SPAN_CHANCES[FRENZY_SPEED_SEGMENT_SPAN_CHANCES.length - 1]?.span ?? 1;
}

function getFrenzyTimingFromSegment(placement: RacePlacement, segmentIndex: number, span: FrenzySpeedSegmentSpan) {
  const segmentCount = Math.max(1, placement.speedSegments.length);
  const clampedSpan = Math.min(span, segmentCount) as FrenzySpeedSegmentSpan;
  const startIndex = clampInteger(segmentIndex, 0, Math.max(0, segmentCount - clampedSpan));
  const endIndex = Math.min(segmentCount, startIndex + clampedSpan);
  const startProgress = placement.speedSegments[startIndex]?.startProgress ?? startIndex / segmentCount;
  const endProgress = placement.speedSegments[endIndex - 1]?.endProgress ?? endIndex / segmentCount;
  const baseTriggerSeconds = getSegmentedTimeAtProgress(placement.baseFinishSeconds, placement.speedSegments, startProgress);
  const boostEndBaseSeconds = getSegmentedTimeAtProgress(placement.baseFinishSeconds, placement.speedSegments, endProgress);
  const baseSpanSeconds = Math.max(0.3, boostEndBaseSeconds - baseTriggerSeconds);

  return {
    startIndex,
    endIndex,
    triggerProgress: Number(startProgress.toFixed(3)),
    baseTriggerSeconds: Number(baseTriggerSeconds.toFixed(3)),
    durationSeconds: Number((baseSpanSeconds / FRENZY_SPEED_MULTIPLIER).toFixed(3))
  };
}

function rollHelicopterHazards(placements: RacePlacement[], options: RaceOptions, round: number, group: number): HazardEvent[] {
  if (placements.length < 4) {
    return [];
  }

  const entrySignature = placements.map((placement) => placement.entry.id).join('|');
  const rng = createRng(`${options.seed}:helicopter:${round}:${group}:${placements.length}:${entrySignature}`);

  const targetCount = Math.min(placements.length - 1, Math.max(1, Math.floor(placements.length / 3)));
  const targets = pickUnique(placements, targetCount, rng);

  return targets.map((target, index) => ({
    type: 'helicopter-snipe',
    targetEntryId: target.entry.id,
    triggerProgress: 0.5 + index * 0.02,
    triggerSeconds: 0,
    approachSeconds: 0
  }));
}

function assignRaceLaneIndexes(entries: RaceEntry[], options: RaceOptions, round: number, group: number) {
  const entrySignature = entries.map((entry) => entry.id).join('|');
  const rng = createRng(`${options.seed}:lanes:${round}:${group}:${entries.length}:${entrySignature}`);
  const shuffled = shuffleItems(entries, rng);
  return new Map(shuffled.map((entry, index) => [entry.id, index]));
}

function shuffleItems<T>(items: T[], rng: () => number) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const current = shuffled[index];
    const replacement = shuffled[swapIndex];

    if (current !== undefined && replacement !== undefined) {
      shuffled[index] = replacement;
      shuffled[swapIndex] = current;
    }
  }

  return shuffled;
}

function rollHorseSpeedSegments(entry: RaceEntry, options: RaceOptions, round: number, group: number): SpeedSegment[] {
  const segmentCount = 20;
  const buckets = [
    { label: '감속', min: 0.58, max: 0.84 },
    { label: '유지', min: 0.9, max: 1.08 },
    { label: '가속', min: 1.12, max: 1.42 },
    { label: '폭주', min: 1.46, max: 1.82 }
  ];

  return Array.from({ length: segmentCount }, (_, index) => {
    const rollSeed = `${options.seed}:speed-arrival:${round}:${group}:${entry.id}:${index}`;
    const rng = createRng(rollSeed);
    const bucketRoll = rng();
    const bucket = bucketRoll < 0.24 ? buckets[0] : bucketRoll < 0.58 ? buckets[1] : bucketRoll < 0.9 ? buckets[2] : buckets[3];
    const multiplier = Number((bucket.min + rng() * (bucket.max - bucket.min)).toFixed(2));

    return {
      index,
      startProgress: index / segmentCount,
      endProgress: (index + 1) / segmentCount,
      multiplier,
      label: bucket.label,
      rollMode: 'segment-arrival',
      rollProgress: index / segmentCount,
      rollSeed
    };
  });
}

function rollSkillEvents(
  entry: RaceEntry,
  options: RaceOptions,
  round: number,
  group: number,
  speedSegments: SpeedSegment[],
  baseFinishSeconds: number
) {
  const events: SkillEvent[] = [];

  speedSegments.forEach((segment) => {
    const rng = createRng(`${options.seed}:motion-arrival:${round}:${group}:${entry.id}:${segment.index}`);
    const skill = pick(getEligibleSkillsForSegment(segment), rng);
    const chance = getSegmentSkillChance();

    if (rng() >= chance) {
      return;
    }

    events.push(createSegmentSkillEvent(skill, { baseFinishSeconds, speedSegments }, segment, rng));
  });

  return sortSkillEvents(events);
}

function getEligibleSkillsForSegment(segment: SpeedSegment) {
  const midpoint = (segment.startProgress + segment.endProgress) / 2;
  const eligible = SKILLS.filter((skill) => {
    if (skill.phase === 'start') {
      return midpoint <= 0.22;
    }

    if (skill.phase === 'corner') {
      return midpoint >= 0.24 && midpoint <= 0.58;
    }

    if (skill.phase === 'last') {
      return midpoint >= 0.66;
    }

    return midpoint >= 0.18 && midpoint <= 0.72;
  });

  return eligible.length > 0 ? eligible : SKILLS;
}

function getSegmentSkillChance() {
  return MOTION_EVENT_CHANCE_PER_SEGMENT;
}

function createSegmentSkillEvent(
  skill: SkillDefinition,
  placement: Pick<RacePlacement, 'baseFinishSeconds' | 'speedSegments'>,
  segment: SpeedSegment,
  rng: () => number,
  durationScale = 1
): SkillEvent {
  const baseTriggerSeconds = getSegmentedTimeAtProgress(placement.baseFinishSeconds, placement.speedSegments, segment.startProgress);

  return {
    skill,
    triggerProgress: Number(segment.startProgress.toFixed(3)),
    baseTriggerSeconds: Number(baseTriggerSeconds.toFixed(3)),
    durationSeconds: Number(((2.6 + rng() * 2.4) * durationScale).toFixed(3)),
    triggerSegmentIndex: segment.index,
    rollMode: 'segment-arrival'
  };
}

function finalizePlacementSkillEvents(placement: RacePlacement) {
  const events = sortSkillEvents(placement.skillEvents);
  const speedEvents: Array<SkillEvent & { speedMultiplier: number }> = [];

  events.forEach((event) => {
    const baseTriggerSeconds = event.baseTriggerSeconds ?? placement.baseFinishSeconds * event.triggerProgress;
    event.baseTriggerSeconds = Number(baseTriggerSeconds.toFixed(3));
    event.triggerSeconds = Number(getRaceClockFromBaseElapsed(baseTriggerSeconds, speedEvents).toFixed(3));

    if (hasSpeedSkill(event)) {
      speedEvents.push(event);
    }
  });

  placement.skillEvents = events;
  placement.skillEvent = getPrimarySkillEvent(events);
  placement.finishSeconds = Number(getRaceClockFromBaseElapsed(placement.baseFinishSeconds, speedEvents).toFixed(3));
}

function sortSkillEvents(events: SkillEvent[]) {
  return [...events].sort((left, right) => {
    const leftSeconds = left.baseTriggerSeconds ?? left.triggerSeconds ?? left.triggerProgress;
    const rightSeconds = right.baseTriggerSeconds ?? right.triggerSeconds ?? right.triggerProgress;
    return leftSeconds - rightSeconds;
  });
}

function getPrimarySkillEvent(events: SkillEvent[]) {
  return events.find((event) => event.skill.cinematic === 'frenzy') ?? events[0] ?? null;
}

function getSegmentedTimeAtProgress(finishSeconds: number, speedSegments: SpeedSegment[], progress: number) {
  if (speedSegments.length === 0) {
    return finishSeconds * progress;
  }

  const clampedProgress = clampNumber(progress, 0, 1);
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

function getRaceClockAtProgress(placement: RacePlacement, progress: number) {
  const baseFinishSeconds = getProgressBaseFinishSeconds(placement);
  const baseElapsedSeconds = getSegmentedTimeAtProgress(baseFinishSeconds, placement.speedSegments, progress);
  return getRaceClockFromBaseElapsed(baseElapsedSeconds, placement.skillEvents.filter(hasSpeedSkill));
}

function getProgressBaseFinishSeconds(placement: RacePlacement) {
  return placement.skillEvents.some(hasSpeedSkill) ? placement.baseFinishSeconds : placement.finishSeconds;
}

function hasSpeedSkill(skillEvent: SkillEvent | null | undefined): skillEvent is SkillEvent & { speedMultiplier: number } {
  return Boolean(skillEvent && skillEvent.speedMultiplier !== undefined && skillEvent.speedMultiplier > 1);
}

function getRaceClockFromBaseElapsed(baseElapsedSeconds: number, skillEvents: Array<SkillEvent & { speedMultiplier: number }>) {
  const activeEvents = skillEvents
    .map((skillEvent) => {
      const baseStart = skillEvent.baseTriggerSeconds ?? skillEvent.triggerSeconds ?? 0;
      const multiplier = Math.max(1, skillEvent.speedMultiplier);
      return {
        start: baseStart,
        end: baseStart + skillEvent.durationSeconds * multiplier,
        multiplier
      };
    })
    .filter((event) => event.end > 0 && event.start < baseElapsedSeconds)
    .sort((left, right) => left.start - right.start);

  if (activeEvents.length === 0) {
    return baseElapsedSeconds;
  }

  const boundaries = new Set<number>([0, baseElapsedSeconds]);

  activeEvents.forEach((event) => {
    boundaries.add(clampNumber(event.start, 0, baseElapsedSeconds));
    boundaries.add(clampNumber(event.end, 0, baseElapsedSeconds));
  });

  const points = [...boundaries].sort((left, right) => left - right);
  let raceClock = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index] ?? 0;
    const end = points[index + 1] ?? start;
    const midpoint = (start + end) / 2;
    const multiplier = activeEvents.reduce(
      (current, event) => (midpoint >= event.start && midpoint < event.end ? Math.max(current, event.multiplier) : current),
      1
    );

    raceClock += (end - start) / multiplier;
  }

  return raceClock;
}

function pickUnique<T>(items: T[], count: number, rng: () => number) {
  const pool = [...items];
  const selected: T[] = [];

  while (pool.length > 0 && selected.length < count) {
    const index = Math.floor(rng() * pool.length);
    const [item] = pool.splice(index, 1);

    if (item) {
      selected.push(item);
    }
  }

  return selected;
}

function makeBalancedGroups<T>(items: T[], fieldSize: number) {
  const groupCount = Math.ceil(items.length / fieldSize);
  const baseSize = Math.floor(items.length / groupCount);
  const extra = items.length % groupCount;
  const groups: T[][] = [];
  let cursor = 0;

  for (let index = 0; index < groupCount; index += 1) {
    const size = baseSize + (index < extra ? 1 : 0);
    groups.push(items.slice(cursor, cursor + size));
    cursor += size;
  }

  return groups;
}

function pick<T>(items: T[], rng: () => number) {
  return items[Math.floor(rng() * items.length)] ?? items[0];
}

function clampInteger(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(Number.isFinite(value) ? value : min)));
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function createRng(seed: string) {
  let state = hashString(seed);

  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(input: string) {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function hslToNumber(hue: number, saturation: number, lightness: number) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = hue * 6;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const match = lightness - chroma / 2;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime < 1) {
    red = chroma;
    green = x;
  } else if (huePrime < 2) {
    red = x;
    green = chroma;
  } else if (huePrime < 3) {
    green = chroma;
    blue = x;
  } else if (huePrime < 4) {
    green = x;
    blue = chroma;
  } else if (huePrime < 5) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  return (
    Math.round((red + match) * 255) * 65536 +
    Math.round((green + match) * 255) * 256 +
    Math.round((blue + match) * 255)
  );
}
