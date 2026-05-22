export type Surface = 'turf' | 'dirt';
export type DistanceType = 'sprint' | 'mile' | 'medium' | 'long';
export type TrackCondition = 'firm' | 'damp' | 'muddy';
export type AptitudeGrade = 'S' | 'A' | 'B' | 'C' | 'D';
export type Pattern = 'solid' | 'spots' | 'stripes' | 'socks';
export type SkillPose = 'handstand' | 'dance' | 'lie-flat' | 'cheer';

export type Stats = {
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  intelligence: number;
};

export type Aptitudes = {
  surface: AptitudeGrade;
  distance: AptitudeGrade;
};

export type SkillDefinition = {
  id: string;
  name: string;
  phase: 'start' | 'corner' | 'middle' | 'last';
  boost: number;
  pose: SkillPose;
  effectColor: number;
  callout: string;
};

export type HorseProfile = {
  id: string;
  participantName: string;
  color: number;
  secondaryColor: number;
  pattern: Pattern;
  stats: Stats;
  aptitudes: Aptitudes;
};

export type RaceOptions = {
  seed: string;
  fieldSize: number;
  qualifiersPerGroup: number;
  winnerCount: number;
  surface: Surface;
  distance: DistanceType;
  condition: TrackCondition;
};

export type RaceEntry = {
  id: string;
  name: string;
  profile: HorseProfile;
};

export type SkillEvent = {
  skill: SkillDefinition;
  triggerProgress: number;
  durationSeconds: number;
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
};

export type RacePlacement = {
  entry: RaceEntry;
  rank: number;
  score: number;
  finishSeconds: number;
  qualified: boolean;
  skillEvent: SkillEvent | null;
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

const SURFACES: Surface[] = ['turf', 'dirt'];
const DISTANCES: DistanceType[] = ['sprint', 'mile', 'medium', 'long'];
const PATTERNS: Pattern[] = ['solid', 'spots', 'stripes', 'socks'];
const GRADES: AptitudeGrade[] = ['S', 'A', 'A', 'A', 'B', 'B', 'C', 'D'];
const STAT_KEYS: Array<keyof Stats> = ['speed', 'stamina', 'power', 'guts', 'intelligence'];

export const SKILLS: SkillDefinition[] = [
  {
    id: 'rocket-start',
    name: '로켓 출발',
    phase: 'start',
    boost: 0.7,
    pose: 'handstand',
    effectColor: 0xff6b35,
    callout: '출발대에서 폭발적으로 치고 나간다'
  },
  {
    id: 'corner-dance',
    name: '코너 댄스',
    phase: 'corner',
    boost: 0.48,
    pose: 'dance',
    effectColor: 0xf2c94c,
    callout: '코너를 무대처럼 휘감아 돈다'
  },
  {
    id: 'flatout-glide',
    name: '납작 활주',
    phase: 'middle',
    boost: 0.58,
    pose: 'lie-flat',
    effectColor: 0x56ccf2,
    callout: '낮게 엎드려 속도를 끌어올린다'
  },
  {
    id: 'finish-frenzy',
    name: '결승 광란',
    phase: 'last',
    boost: 0.82,
    pose: 'cheer',
    effectColor: 0xff4d8d,
    callout: '결승 직선에서 거칠게 몰아친다'
  },
  {
    id: 'mud-splash',
    name: '진흙 튀기기',
    phase: 'middle',
    boost: 0.5,
    pose: 'dance',
    effectColor: 0x8b5e34,
    callout: '뒤쪽으로 흙먼지를 크게 뿌린다'
  },
  {
    id: 'turf-slide',
    name: '잔디 미끄럼',
    phase: 'corner',
    boost: 0.5,
    pose: 'lie-flat',
    effectColor: 0x6fcf97,
    callout: '잔디 위를 미끄러지듯 치고 나간다'
  }
];

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

export function sanitizeOptions(options: Partial<RaceOptions>): RaceOptions {
  const fieldSize = clampInteger(options.fieldSize ?? 18, 2, 18);
  const qualifiersPerGroup = clampInteger(options.qualifiersPerGroup ?? 2, 1, fieldSize - 1);
  const winnerCount = clampInteger(options.winnerCount ?? 1, 1, fieldSize);

  return {
    seed: String(options.seed?.trim() || '호반-2026'),
    fieldSize,
    qualifiersPerGroup,
    winnerCount,
    surface: SURFACES.includes(options.surface as Surface) ? (options.surface as Surface) : 'turf',
    distance: DISTANCES.includes(options.distance as DistanceType)
      ? (options.distance as DistanceType)
      : 'mile',
    condition: ['firm', 'damp', 'muddy'].includes(options.condition as TrackCondition)
      ? (options.condition as TrackCondition)
      : 'firm'
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
    return createSampleParticipants(18);
  }

  return names;
}

export function runTournament(rawParticipants: string[], rawOptions: Partial<RaceOptions>) {
  const names = normalizeParticipants(rawParticipants);
  const options = sanitizeOptions(rawOptions);
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
    pattern: pick(PATTERNS, rng),
    stats: createStats(rng),
    aptitudes: {
      surface: pick(GRADES, rng),
      distance: pick(GRADES, rng)
    }
  };
}

function simulateRace(
  entries: RaceEntry[],
  context: { options: RaceOptions; round: number; group: number; isFinal: boolean }
): RaceResult {
  const { options, round, group, isFinal } = context;
  const hazardDrafts = rollHelicopterHazards(entries, options, round, group);
  const hazardTargetIds = new Set(hazardDrafts.map((hazard) => hazard.targetEntryId));
  const placements = entries.map((entry, index) => {
    const rng = createRng(`${options.seed}:race:${round}:${group}:${entry.id}`);
    const assignedSkill = pick(SKILLS, rng);
    const skillEvent = rollSkillEvent(assignedSkill, options, rng);
    const speedSegments = rollHorseSpeedSegments(entry, options, round, group);
    const score = calculateScore(entry.profile, options, skillEvent, rng);
    const startDelay = (100 - entry.profile.stats.power) * 0.018 + rng() * 0.32;
    const segmentScale =
      speedSegments.reduce((sum, segment) => sum + 1 / Math.max(0.1, segment.multiplier), 0) / speedSegments.length;
    const finishSeconds = clampNumber((117 - score * 0.096 + startDelay * 3.3 + index * 0.075) * segmentScale, 55, 114);

    return {
      entry,
      rank: 0,
      score,
      finishSeconds,
      qualified: false,
      skillEvent,
      eliminatedByHelicopter: hazardTargetIds.has(entry.id),
      speedSegments
    };
  });

  const leadPlacement = placements.reduce((lead, placement) => (placement.finishSeconds < lead.finishSeconds ? placement : lead), placements[0]);
  const leadFinishSeconds = leadPlacement?.finishSeconds ?? 0;
  const leadSegments = leadPlacement?.speedSegments ?? [];
  const helicopterApproachSeconds = Number(getSegmentedTimeAtProgress(leadFinishSeconds, leadSegments, 1 / 3).toFixed(3));
  const firstShotSeconds = Number(getSegmentedTimeAtProgress(leadFinishSeconds, leadSegments, 0.5).toFixed(3));
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

function rollHelicopterHazards(entries: RaceEntry[], options: RaceOptions, round: number, group: number): HazardEvent[] {
  if (entries.length < 4) {
    return [];
  }

  const rng = createRng(`${options.seed}:helicopter:${round}:${group}:${entries.length}`);

  const targetCount = Math.min(entries.length - 1, Math.max(1, Math.floor(entries.length / 3)));
  const targets = pickUnique(entries, targetCount, rng);

  return targets.map((target, index) => ({
    type: 'helicopter-snipe',
    targetEntryId: target.id,
    triggerProgress: 0.5 + index * 0.02,
    triggerSeconds: 0,
    approachSeconds: 0
  }));
}

function rollHorseSpeedSegments(entry: RaceEntry, options: RaceOptions, round: number, group: number): SpeedSegment[] {
  const rng = createRng(`${options.seed}:speed-segments:${round}:${group}:${entry.id}:${options.distance}:${options.condition}`);
  const segmentCount = 20;
  const buckets = [
    { label: '감속', min: 0.58, max: 0.84 },
    { label: '유지', min: 0.9, max: 1.08 },
    { label: '가속', min: 1.12, max: 1.42 },
    { label: '폭주', min: 1.46, max: 1.82 }
  ];

  return Array.from({ length: segmentCount }, (_, index) => {
    const bucketRoll = rng();
    const bucket = bucketRoll < 0.24 ? buckets[0] : bucketRoll < 0.58 ? buckets[1] : bucketRoll < 0.9 ? buckets[2] : buckets[3];
    const multiplier = Number((bucket.min + rng() * (bucket.max - bucket.min)).toFixed(2));

    return {
      index,
      startProgress: index / segmentCount,
      endProgress: (index + 1) / segmentCount,
      multiplier,
      label: bucket.label
    };
  });
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

function calculateScore(
  profile: HorseProfile,
  options: RaceOptions,
  skillEvent: SkillEvent | null,
  rng: () => number
) {
  const { speed, stamina, power, guts, intelligence } = profile.stats;
  const distanceWeights = getDistanceWeights(options.distance);
  const conditionWeight = options.condition === 'muddy' ? 0.92 : options.condition === 'damp' ? 0.96 : 1;
  const surfaceBias = options.surface === 'dirt' ? power * 0.16 : speed * 0.14;
  const aptitude = gradeModifier(profile.aptitudes.surface) * gradeModifier(profile.aptitudes.distance);
  const skillBoost = skillEvent ? 13 + skillEvent.skill.boost * 18 : 0;
  const raceNoise = (rng() - 0.5) * 10;

  return (
    (speed * distanceWeights.speed +
      stamina * distanceWeights.stamina +
      power * distanceWeights.power +
      guts * distanceWeights.guts +
      intelligence * distanceWeights.intelligence +
      surfaceBias +
      skillBoost +
      raceNoise) *
    aptitude *
    conditionWeight
  );
}

function rollSkillEvent(skill: SkillDefinition, options: RaceOptions, rng: () => number): SkillEvent | null {
  const surfaceBonus =
    (skill.id === 'mud-splash' && (options.surface === 'dirt' || options.condition === 'muddy')) ||
    (skill.id === 'turf-slide' && options.surface === 'turf' && options.condition === 'firm')
      ? 0.01
      : 0;

  if (rng() > 0.03 + surfaceBonus) {
    return null;
  }

  return {
    skill,
    triggerProgress: getSkillTrigger(skill.phase, rng),
    durationSeconds: 5
  };
}

function getSkillTrigger(phase: SkillDefinition['phase'], rng: () => number) {
  if (phase === 'start') {
    return 0.08 + rng() * 0.1;
  }

  if (phase === 'corner') {
    return 0.3 + rng() * 0.18;
  }

  if (phase === 'last') {
    return 0.72 + rng() * 0.16;
  }

  return 0.48 + rng() * 0.16;
}

function createStats(rng: () => number): Stats {
  const base = 42;
  const budget = 370 - base * STAT_KEYS.length;
  const weights = STAT_KEYS.map(() => 0.5 + rng());
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const values = STAT_KEYS.map((_, index) => Math.round(base + (budget * weights[index]) / totalWeight));

  return {
    speed: values[0],
    stamina: values[1],
    power: values[2],
    guts: values[3],
    intelligence: values[4]
  };
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

function getDistanceWeights(distance: DistanceType) {
  if (distance === 'sprint') {
    return { speed: 1.55, stamina: 0.62, power: 1.26, guts: 0.68, intelligence: 0.72 };
  }

  if (distance === 'mile') {
    return { speed: 1.28, stamina: 0.88, power: 1.02, guts: 0.78, intelligence: 0.84 };
  }

  if (distance === 'long') {
    return { speed: 0.98, stamina: 1.38, power: 0.86, guts: 1.12, intelligence: 0.9 };
  }

  return { speed: 1.12, stamina: 1.12, power: 0.94, guts: 0.96, intelligence: 0.86 };
}

function gradeModifier(grade: AptitudeGrade) {
  if (grade === 'S') {
    return 1.075;
  }

  if (grade === 'A') {
    return 1;
  }

  if (grade === 'B') {
    return 0.965;
  }

  if (grade === 'C') {
    return 0.92;
  }

  return 0.86;
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
