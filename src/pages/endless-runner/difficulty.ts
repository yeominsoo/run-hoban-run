export type RunnerSpecialPattern =
  | 'moving-platform'
  | 'jump-lane-creature'
  | 'double-jump-stack';

interface SpecialPatternWeights {
  movingPlatform: number;
  jumpLaneCreature: number;
  doubleJumpStack: number;
}

export interface RunnerRoundProfile {
  tier: number;
  id: string;
  label: string;
  baseSpeed: number;
  minGap: number;
  coinInterval: number;
  pitChance: number;
  highChance: number;
  specialWeights: SpecialPatternWeights;
  guaranteedSpecial: RunnerSpecialPattern | null;
}

export const RUNNER_ROUND_DURATION_S = 15;
export const DOUBLE_JUMP_STACK_HEIGHT = 154;
export const JUMP_LANE_CREATURE_HEIGHT = 32;
export const JUMP_LANE_CREATURE_BOTTOM_OFFSET = 112;

export interface MovingPlatformSpec {
  width: number;
  motionAmplitude: number;
  motionSpeed: number;
  pitPadding: number;
}

export function movingPlatformSpec(tier: number): MovingPlatformSpec {
  const advancedTier = Math.max(0, Math.floor(tier) - 4);
  return {
    width: 118 + Math.min(14, Math.max(1, Math.floor(tier))),
    motionAmplitude: 16 + Math.min(10, advancedTier * 1.5),
    motionSpeed: 1.1 + Math.min(0.4, advancedTier * 0.05),
    pitPadding: 6
  };
}

export function doubleJumpStackWidth(tier: number): number {
  return 64 + Math.min(10, Math.max(1, Math.floor(tier)));
}

export const RUNNER_ROUND_PROFILES: readonly RunnerRoundProfile[] = [
  {
    tier: 1,
    id: 'basics',
    label: '기본 장애물',
    baseSpeed: 245,
    minGap: 440,
    coinInterval: 1.35,
    pitChance: 0,
    highChance: 0.32,
    specialWeights: { movingPlatform: 0, jumpLaneCreature: 0, doubleJumpStack: 0 },
    guaranteedSpecial: null
  },
  {
    tier: 2,
    id: 'terrain-breaks',
    label: '구덩이 지형',
    baseSpeed: 273,
    minGap: 406,
    coinInterval: 1.28,
    pitChance: 0.075,
    highChance: 0.335,
    specialWeights: { movingPlatform: 0, jumpLaneCreature: 0, doubleJumpStack: 0 },
    guaranteedSpecial: null
  },
  {
    tier: 3,
    id: 'creature-rush',
    label: '추격 생물',
    baseSpeed: 301,
    minGap: 372,
    coinInterval: 1.21,
    pitChance: 0.15,
    highChance: 0.35,
    specialWeights: { movingPlatform: 0, jumpLaneCreature: 0, doubleJumpStack: 0 },
    guaranteedSpecial: null
  },
  {
    tier: 4,
    id: 'moving-platforms',
    label: '상하 이동 발판',
    baseSpeed: 329,
    minGap: 350,
    coinInterval: 1.14,
    pitChance: 0.16,
    highChance: 0.34,
    specialWeights: { movingPlatform: 0.18, jumpLaneCreature: 0, doubleJumpStack: 0 },
    guaranteedSpecial: 'moving-platform'
  },
  {
    tier: 5,
    id: 'air-lane',
    label: '점프 높이 비행몹',
    baseSpeed: 357,
    minGap: 335,
    coinInterval: 1.08,
    pitChance: 0.18,
    highChance: 0.32,
    specialWeights: { movingPlatform: 0.12, jumpLaneCreature: 0.14, doubleJumpStack: 0 },
    guaranteedSpecial: 'jump-lane-creature'
  },
  {
    tier: 6,
    id: 'double-jump',
    label: '2단 점프 바위탑',
    baseSpeed: 385,
    minGap: 320,
    coinInterval: 1.02,
    pitChance: 0.2,
    highChance: 0.3,
    specialWeights: { movingPlatform: 0.1, jumpLaneCreature: 0.1, doubleJumpStack: 0.14 },
    guaranteedSpecial: 'double-jump-stack'
  },
  {
    tier: 7,
    id: 'moving-gauntlet',
    label: '이동 발판 연속',
    baseSpeed: 402,
    minGap: 330,
    coinInterval: 0.98,
    pitChance: 0.2,
    highChance: 0.28,
    specialWeights: { movingPlatform: 0.24, jumpLaneCreature: 0.06, doubleJumpStack: 0.06 },
    guaranteedSpecial: 'moving-platform'
  },
  {
    tier: 8,
    id: 'high-road',
    label: '높은 지형 연속',
    baseSpeed: 419,
    minGap: 345,
    coinInterval: 0.95,
    pitChance: 0.18,
    highChance: 0.28,
    specialWeights: { movingPlatform: 0.16, jumpLaneCreature: 0.08, doubleJumpStack: 0.22 },
    guaranteedSpecial: 'double-jump-stack'
  },
  {
    tier: 9,
    id: 'air-crossfire',
    label: '공중 교차 비행',
    baseSpeed: 436,
    minGap: 320,
    coinInterval: 0.93,
    pitChance: 0.22,
    highChance: 0.27,
    specialWeights: { movingPlatform: 0.12, jumpLaneCreature: 0.22, doubleJumpStack: 0.1 },
    guaranteedSpecial: 'jump-lane-creature'
  },
  {
    tier: 10,
    id: 'double-jump-rush',
    label: '2단 점프 연속',
    baseSpeed: 453,
    minGap: 315,
    coinInterval: 0.91,
    pitChance: 0.22,
    highChance: 0.26,
    specialWeights: { movingPlatform: 0.1, jumpLaneCreature: 0.16, doubleJumpStack: 0.22 },
    guaranteedSpecial: 'double-jump-stack'
  },
  {
    tier: 11,
    id: 'precision-mix',
    label: '정밀 혼합 코스',
    baseSpeed: 469,
    minGap: 305,
    coinInterval: 0.9,
    pitChance: 0.24,
    highChance: 0.25,
    specialWeights: { movingPlatform: 0.18, jumpLaneCreature: 0.18, doubleJumpStack: 0.14 },
    guaranteedSpecial: 'moving-platform'
  },
  {
    tier: 12,
    id: 'marathon',
    label: '마스터 마라톤',
    baseSpeed: 485,
    minGap: 300,
    coinInterval: 0.9,
    pitChance: 0.25,
    highChance: 0.25,
    specialWeights: { movingPlatform: 0.16, jumpLaneCreature: 0.18, doubleJumpStack: 0.18 },
    guaranteedSpecial: 'jump-lane-creature'
  }
];

export const RUNNER_MAX_DIFFICULTY_TIER = RUNNER_ROUND_PROFILES.length;

const MASTERY_SPECIAL_CYCLE: readonly RunnerSpecialPattern[] = [
  'moving-platform',
  'jump-lane-creature',
  'double-jump-stack'
];

export function runnerRoundProfile(roundNumber: number): RunnerRoundProfile {
  const index = Math.min(
    RUNNER_MAX_DIFFICULTY_TIER - 1,
    Math.max(0, Math.floor(roundNumber) - 1)
  );
  return RUNNER_ROUND_PROFILES[index];
}

export function guaranteedSpecialForRound(roundNumber: number): RunnerSpecialPattern | null {
  if (roundNumber <= RUNNER_MAX_DIFFICULTY_TIER) {
    return runnerRoundProfile(roundNumber).guaranteedSpecial;
  }
  const cycleIndex = (Math.floor(roundNumber) - RUNNER_MAX_DIFFICULTY_TIER - 1)
    % MASTERY_SPECIAL_CYCLE.length;
  return MASTERY_SPECIAL_CYCLE[cycleIndex];
}

export function selectSpecialPattern(
  roundNumber: number,
  spawnIndex: number,
  roll: number
): RunnerSpecialPattern | null {
  const guaranteed = guaranteedSpecialForRound(roundNumber);
  if (spawnIndex === 0 && guaranteed) return guaranteed;

  const weights = runnerRoundProfile(roundNumber).specialWeights;
  if (roll < weights.movingPlatform) return 'moving-platform';
  if (roll < weights.movingPlatform + weights.jumpLaneCreature) {
    return 'jump-lane-creature';
  }
  if (
    roll
    < weights.movingPlatform + weights.jumpLaneCreature + weights.doubleJumpStack
  ) {
    return 'double-jump-stack';
  }
  return null;
}

export function runnerRoundCatalog(): string {
  const tiers = RUNNER_ROUND_PROFILES
    .map((profile) => `${profile.tier}:${profile.id}`)
    .join('|');
  return `${tiers}|13+:master-cycle`;
}
