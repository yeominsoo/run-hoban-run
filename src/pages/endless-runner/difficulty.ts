export type RunnerSpecialPattern =
  | 'moving-platform'
  | 'jump-lane-creature'
  | 'double-jump-stack';

export type RunnerCoursePattern =
  | RunnerSpecialPattern
  | 'single-jump'
  | 'single-slide'
  | 'ground-gap'
  | 'jump-pair'
  | 'jump-slide'
  | 'slide-jump'
  | 'creature-wave'
  | 'platform-pair'
  | 'mixed-relay';

type RunnerRoundFocus = 'balanced' | 'jump' | 'slide' | 'pit' | 'air' | 'recovery';

interface SpecialPatternWeights {
  movingPlatform: number;
  jumpLaneCreature: number;
  doubleJumpStack: number;
}

interface RunnerRoundBlueprint {
  id: string;
  chapter: string;
  label: string;
  hint: string;
  focus: RunnerRoundFocus;
  intensity: 0 | 1 | 2 | 3;
  openingPattern: RunnerCoursePattern;
  patternPool: readonly RunnerCoursePattern[];
}

export interface RunnerRoundProfile extends RunnerRoundBlueprint {
  tier: number;
  baseSpeed: number;
  minGap: number;
  coinInterval: number;
  pitChance: number;
  highChance: number;
  patternChance: number;
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
  const normalizedTier = Math.min(50, Math.max(1, Math.floor(tier)));
  const advancedTier = Math.max(0, normalizedTier - 4);
  return {
    width: 118 + Math.min(18, normalizedTier),
    motionAmplitude: 16 + Math.min(12, advancedTier * 0.4),
    motionSpeed: 1.1 + Math.min(0.5, advancedTier * 0.012),
    pitPadding: 6
  };
}

export function doubleJumpStackWidth(tier: number): number {
  return 64 + Math.min(12, Math.max(1, Math.floor(tier)));
}

const ROUND_BLUEPRINTS: readonly RunnerRoundBlueprint[] = [
  { id: 'first-steps', chapter: '초원 학교', label: '첫 발걸음', hint: '낮은 장애물은 한 번 점프', focus: 'recovery', intensity: 0, openingPattern: 'single-jump', patternPool: ['single-jump'] },
  { id: 'log-rhythm', chapter: '초원 학교', label: '통나무 리듬', hint: '충분히 가까워진 뒤 점프', focus: 'jump', intensity: 0, openingPattern: 'single-jump', patternPool: ['single-jump', 'jump-pair'] },
  { id: 'vine-slide', chapter: '초원 학교', label: '덩굴 아래로', hint: '매달린 장애물은 슬라이드', focus: 'slide', intensity: 0, openingPattern: 'single-slide', patternPool: ['single-slide'] },
  { id: 'moving-lesson', chapter: '초원 학교', label: '움직이는 첫 발판', hint: '노란 화살표 높이에 맞춰 착지', focus: 'pit', intensity: 0, openingPattern: 'moving-platform', patternPool: ['ground-gap', 'moving-platform'] },
  { id: 'air-lane-lesson', chapter: '초원 학교', label: '점프 길목의 날개', hint: '점프 높이의 새는 지상으로 통과', focus: 'air', intensity: 0, openingPattern: 'jump-lane-creature', patternPool: ['single-slide', 'jump-lane-creature'] },
  { id: 'double-jump-lesson', chapter: '초원 학교', label: '두 번 뛰는 바위탑', hint: '×2 바위는 공중에서 한 번 더 점프', focus: 'jump', intensity: 0, openingPattern: 'double-jump-stack', patternPool: ['single-jump', 'double-jump-stack'] },
  { id: 'broken-meadow', chapter: '초원 학교', label: '갈라진 초원', hint: '구덩이 끝을 보고 길게 점프', focus: 'pit', intensity: 1, openingPattern: 'ground-gap', patternPool: ['ground-gap', 'single-jump'] },
  { id: 'jump-then-slide', chapter: '초원 학교', label: '점프 다음 슬라이드', hint: '착지 전 아래 입력으로 빠르게 전환', focus: 'balanced', intensity: 1, openingPattern: 'jump-slide', patternPool: ['single-jump', 'single-slide', 'jump-slide'] },
  { id: 'slide-then-jump', chapter: '초원 학교', label: '슬라이드 다음 점프', hint: '낮은 자세에서 바로 점프 가능', focus: 'balanced', intensity: 1, openingPattern: 'slide-jump', patternPool: ['single-slide', 'single-jump', 'slide-jump'] },
  { id: 'meadow-checkpoint', chapter: '초원 학교', label: '초원 종합시험', hint: '배운 세 동작을 표지로 먼저 읽기', focus: 'balanced', intensity: 1, openingPattern: 'mixed-relay', patternPool: ['jump-slide', 'slide-jump', 'moving-platform'] },

  { id: 'paired-logs', chapter: '숲속 리듬', label: '연속 통나무', hint: '첫 착지 직후 다시 점프', focus: 'jump', intensity: 1, openingPattern: 'jump-pair', patternPool: ['single-jump', 'jump-pair'] },
  { id: 'paired-platforms', chapter: '숲속 리듬', label: '징검 발판', hint: '첫 발판 끝에서 다음 발판으로', focus: 'pit', intensity: 1, openingPattern: 'platform-pair', patternPool: ['moving-platform', 'platform-pair'] },
  { id: 'creature-wave', chapter: '숲속 리듬', label: '숲새 무리', hint: '날아오는 무리는 슬라이드 유지', focus: 'air', intensity: 1, openingPattern: 'creature-wave', patternPool: ['single-slide', 'creature-wave'] },
  { id: 'pit-tempo', chapter: '숲속 리듬', label: '구덩이 박자', hint: '연속 구간에서도 입력을 서두르지 않기', focus: 'pit', intensity: 1, openingPattern: 'ground-gap', patternPool: ['ground-gap', 'jump-pair', 'moving-platform'] },
  { id: 'forest-breather', chapter: '숲속 리듬', label: '야생화 쉼길', hint: '넓은 간격에서 코인과 호흡 회복', focus: 'recovery', intensity: 0, openingPattern: 'single-jump', patternPool: ['single-jump', 'single-slide'] },
  { id: 'low-high-beat', chapter: '숲속 리듬', label: '낮고 높은 박자', hint: '점프 후 즉시 낮은 자세', focus: 'balanced', intensity: 1, openingPattern: 'jump-slide', patternPool: ['jump-slide', 'jump-pair'] },
  { id: 'high-low-beat', chapter: '숲속 리듬', label: '높고 낮은 박자', hint: '슬라이드에서 곧바로 점프', focus: 'balanced', intensity: 1, openingPattern: 'slide-jump', patternPool: ['slide-jump', 'creature-wave'] },
  { id: 'moving-forest', chapter: '숲속 리듬', label: '흔들리는 숲길', hint: '발판의 현재 높이를 보고 도약', focus: 'pit', intensity: 2, openingPattern: 'moving-platform', patternPool: ['moving-platform', 'platform-pair'] },
  { id: 'air-and-stone', chapter: '숲속 리듬', label: '날개와 바위', hint: '지상 유지와 2단 점프를 구분', focus: 'air', intensity: 2, openingPattern: 'jump-lane-creature', patternPool: ['jump-lane-creature', 'double-jump-stack', 'single-slide'] },
  { id: 'forest-checkpoint', chapter: '숲속 리듬', label: '숲속 종합시험', hint: '두 동작 연계를 침착하게 반복', focus: 'balanced', intensity: 2, openingPattern: 'mixed-relay', patternPool: ['jump-slide', 'slide-jump', 'creature-wave', 'mixed-relay'] },

  { id: 'canyon-jumps', chapter: '바위 협곡', label: '협곡 두 번 점프', hint: '바위 사이의 착지점을 확인', focus: 'jump', intensity: 2, openingPattern: 'jump-pair', patternPool: ['jump-pair', 'double-jump-stack'] },
  { id: 'canyon-gaps', chapter: '바위 협곡', label: '깊어진 균열', hint: '구덩이 앞 코인보다 지형을 우선', focus: 'pit', intensity: 2, openingPattern: 'ground-gap', patternPool: ['ground-gap', 'moving-platform'] },
  { id: 'canyon-bridge', chapter: '바위 협곡', label: '움직이는 다리', hint: '연속 발판에서는 두 번째 착지를 준비', focus: 'pit', intensity: 2, openingPattern: 'platform-pair', patternPool: ['platform-pair', 'moving-platform'] },
  { id: 'canyon-crosswind', chapter: '바위 협곡', label: '협곡 맞바람', hint: '다가오는 새의 속도까지 계산', focus: 'air', intensity: 2, openingPattern: 'creature-wave', patternPool: ['creature-wave', 'jump-lane-creature'] },
  { id: 'canyon-breather', chapter: '바위 협곡', label: '샘터 쉼길', hint: '넓어진 간격에서 다음 조합 준비', focus: 'recovery', intensity: 0, openingPattern: 'single-slide', patternPool: ['single-jump', 'single-slide'] },
  { id: 'tower-relay', chapter: '바위 협곡', label: '바위탑 릴레이', hint: '×2 표시는 반드시 두 번째 점프', focus: 'jump', intensity: 2, openingPattern: 'double-jump-stack', patternPool: ['double-jump-stack', 'jump-pair'] },
  { id: 'moving-crossing', chapter: '바위 협곡', label: '출렁이는 횡단로', hint: '상하 이동 폭이 커져도 윗면에 착지', focus: 'pit', intensity: 2, openingPattern: 'moving-platform', patternPool: ['moving-platform', 'platform-pair', 'ground-gap'] },
  { id: 'canyon-switchback', chapter: '바위 협곡', label: '협곡 전환로', hint: '점프와 슬라이드를 한 세트로 기억', focus: 'balanced', intensity: 2, openingPattern: 'jump-slide', patternPool: ['jump-slide', 'slide-jump'] },
  { id: 'canyon-relay', chapter: '바위 협곡', label: '세 동작 릴레이', hint: '점프·슬라이드·2단 점프 순서', focus: 'balanced', intensity: 3, openingPattern: 'mixed-relay', patternPool: ['mixed-relay', 'jump-slide', 'double-jump-stack'] },
  { id: 'canyon-checkpoint', chapter: '바위 협곡', label: '협곡 종합시험', hint: '빠른 화면보다 장애물 표지를 먼저 읽기', focus: 'balanced', intensity: 3, openingPattern: 'platform-pair', patternPool: ['platform-pair', 'creature-wave', 'mixed-relay'] },

  { id: 'storm-pace', chapter: '폭풍 고원', label: '폭풍의 속도', hint: '간격은 유지되지만 접근 시간이 짧아짐', focus: 'balanced', intensity: 2, openingPattern: 'single-jump', patternPool: ['single-jump', 'single-slide', 'ground-gap'] },
  { id: 'storm-flock', chapter: '폭풍 고원', label: '돌풍 새떼', hint: '접근 잔상을 보고 슬라이드 유지', focus: 'air', intensity: 3, openingPattern: 'creature-wave', patternPool: ['creature-wave', 'single-slide'] },
  { id: 'storm-platforms', chapter: '폭풍 고원', label: '폭풍 발판', hint: '움직임 화살표 끝점을 예측해 착지', focus: 'pit', intensity: 3, openingPattern: 'platform-pair', patternPool: ['platform-pair', 'moving-platform'] },
  { id: 'storm-towers', chapter: '폭풍 고원', label: '고원 바위탑', hint: '첫 점프를 아껴 정점에서 한 번 더', focus: 'jump', intensity: 3, openingPattern: 'double-jump-stack', patternPool: ['double-jump-stack', 'jump-pair'] },
  { id: 'storm-breather', chapter: '폭풍 고원', label: '구름 사이 쉼길', hint: '쉬운 패턴에서 손가락 리듬 회복', focus: 'recovery', intensity: 0, openingPattern: 'single-jump', patternPool: ['single-jump', 'single-slide'] },
  { id: 'storm-triple-beat', chapter: '폭풍 고원', label: '세 박자 질주', hint: '세 동작을 하나의 긴 패턴으로 보기', focus: 'balanced', intensity: 3, openingPattern: 'mixed-relay', patternPool: ['mixed-relay', 'jump-slide', 'slide-jump'] },
  { id: 'storm-air-lane', chapter: '폭풍 고원', label: '점프 길목 봉쇄', hint: '무조건 점프하지 말고 지상 통로 선택', focus: 'air', intensity: 3, openingPattern: 'jump-lane-creature', patternPool: ['jump-lane-creature', 'creature-wave', 'single-slide'] },
  { id: 'storm-broken-road', chapter: '폭풍 고원', label: '끊어진 고원길', hint: '구덩이와 발판을 하나의 지형으로 읽기', focus: 'pit', intensity: 3, openingPattern: 'moving-platform', patternPool: ['ground-gap', 'moving-platform', 'platform-pair'] },
  { id: 'storm-precision', chapter: '폭풍 고원', label: '폭풍 정밀구간', hint: '빠른 연속 입력보다 정확한 전환', focus: 'balanced', intensity: 3, openingPattern: 'jump-slide', patternPool: ['jump-slide', 'slide-jump', 'double-jump-stack'] },
  { id: 'storm-checkpoint', chapter: '폭풍 고원', label: '폭풍 종합시험', hint: '고난도 패턴 뒤에는 다음 표지를 확인', focus: 'balanced', intensity: 3, openingPattern: 'mixed-relay', patternPool: ['mixed-relay', 'platform-pair', 'creature-wave'] },

  { id: 'summit-jumps', chapter: '별빛 정상', label: '정상의 연속 도약', hint: '점프 사거리가 늘어도 착지 리듬 유지', focus: 'jump', intensity: 3, openingPattern: 'jump-pair', patternPool: ['jump-pair', 'double-jump-stack'] },
  { id: 'summit-slides', chapter: '별빛 정상', label: '낮게 스치는 별빛', hint: '비행몹이 지나갈 때까지 자세 유지', focus: 'slide', intensity: 3, openingPattern: 'creature-wave', patternPool: ['single-slide', 'creature-wave', 'slide-jump'] },
  { id: 'summit-bridge', chapter: '별빛 정상', label: '별빛 흔들다리', hint: '움직이는 두 발판의 위상을 따로 보기', focus: 'pit', intensity: 3, openingPattern: 'platform-pair', patternPool: ['platform-pair', 'moving-platform'] },
  { id: 'summit-towers', chapter: '별빛 정상', label: '정상 바위탑', hint: '2단 점프 후 다음 착지까지 시선 유지', focus: 'jump', intensity: 3, openingPattern: 'double-jump-stack', patternPool: ['double-jump-stack', 'mixed-relay'] },
  { id: 'summit-breather', chapter: '별빛 정상', label: '별꽃 쉼길', hint: '마지막 다섯 라운드 전 호흡 회복', focus: 'recovery', intensity: 0, openingPattern: 'single-jump', patternPool: ['single-jump', 'single-slide'] },
  { id: 'summit-no-hesitation', chapter: '별빛 정상', label: '망설임 없는 전환', hint: '보이는 순서 그대로 동작 전환', focus: 'balanced', intensity: 3, openingPattern: 'mixed-relay', patternPool: ['jump-slide', 'slide-jump', 'mixed-relay'] },
  { id: 'summit-crossfire', chapter: '별빛 정상', label: '별빛 교차비행', hint: '지상 통로와 슬라이드 통로를 구분', focus: 'air', intensity: 3, openingPattern: 'jump-lane-creature', patternPool: ['jump-lane-creature', 'creature-wave', 'single-slide'] },
  { id: 'summit-precision', chapter: '별빛 정상', label: '정상 정밀발판', hint: '구덩이보다 발판 윗면에 시선 고정', focus: 'pit', intensity: 3, openingPattern: 'platform-pair', patternPool: ['platform-pair', 'moving-platform', 'ground-gap'] },
  { id: 'summit-rehearsal', chapter: '별빛 정상', label: '최종 리허설', hint: '모든 표지와 동작을 한 번씩 확인', focus: 'balanced', intensity: 3, openingPattern: 'mixed-relay', patternPool: ['mixed-relay', 'platform-pair', 'creature-wave', 'double-jump-stack'] },
  { id: 'summit-finale', chapter: '별빛 정상', label: '50라운드 정상', hint: '최고 속도에서도 안전한 동작 순서를 유지', focus: 'balanced', intensity: 3, openingPattern: 'mixed-relay', patternPool: ['mixed-relay', 'platform-pair', 'creature-wave', 'double-jump-stack', 'jump-lane-creature'] }
];

const SPECIAL_PATTERNS = new Set<RunnerSpecialPattern>([
  'moving-platform',
  'jump-lane-creature',
  'double-jump-stack'
]);

function isSpecialPattern(pattern: RunnerCoursePattern): pattern is RunnerSpecialPattern {
  return SPECIAL_PATTERNS.has(pattern as RunnerSpecialPattern);
}

function roundTo(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function specialWeightsFor(
  patternPool: readonly RunnerCoursePattern[],
  patternChance: number
): SpecialPatternWeights {
  const divisor = Math.max(1, patternPool.length);
  const weightFor = (pattern: RunnerSpecialPattern) => (
    roundTo(patternPool.filter((candidate) => candidate === pattern).length / divisor * patternChance)
  );
  return {
    movingPlatform: weightFor('moving-platform'),
    jumpLaneCreature: weightFor('jump-lane-creature'),
    doubleJumpStack: weightFor('double-jump-stack')
  };
}

function buildRoundProfile(blueprint: RunnerRoundBlueprint, index: number): RunnerRoundProfile {
  const tier = index + 1;
  const progress = index / (ROUND_BLUEPRINTS.length - 1);
  const curve = progress ** 0.72;
  const recovery = blueprint.focus === 'recovery';
  const recoverySpeedRelief = recovery && tier > 1 ? 6 : 0;
  const baseSpeed = Math.round(245 + curve * 255 + blueprint.intensity * 1.5 - recoverySpeedRelief);
  const minGap = Math.max(
    300,
    Math.round(440 - progress ** 0.68 * 140 - blueprint.intensity * 2 + (recovery ? 24 : 0))
  );
  const coinInterval = roundTo(
    Math.max(0.9, 1.35 - progress ** 0.62 * 0.45 - (recovery ? 0.08 : 0)),
    2
  );
  const pitBias = blueprint.focus === 'pit' ? 0.055 : blueprint.focus === 'recovery' ? -0.05 : 0;
  const highBias = blueprint.focus === 'slide' || blueprint.focus === 'air'
    ? 0.065
    : blueprint.focus === 'jump'
      ? -0.035
      : blueprint.focus === 'recovery'
        ? -0.04
        : 0;
  const pitChance = tier === 1
    ? 0
    : roundTo(Math.max(0.02, Math.min(0.27, 0.035 + progress * 0.19 + pitBias)));
  const highChance = tier === 1
    ? 0.32
    : roundTo(Math.max(0.22, Math.min(0.4, 0.3 + progress * 0.035 + highBias)));
  const patternChance = roundTo(
    recovery
      ? 0.1
      : Math.min(0.6, 0.08 + progress * 0.34 + blueprint.intensity * 0.045)
  );

  return {
    ...blueprint,
    tier,
    baseSpeed,
    minGap,
    coinInterval,
    pitChance,
    highChance,
    patternChance,
    specialWeights: specialWeightsFor(blueprint.patternPool, patternChance),
    guaranteedSpecial: isSpecialPattern(blueprint.openingPattern)
      ? blueprint.openingPattern
      : null
  };
}

export const RUNNER_ROUND_PROFILES: readonly RunnerRoundProfile[] = ROUND_BLUEPRINTS
  .map(buildRoundProfile);

export const RUNNER_MAX_DIFFICULTY_TIER = RUNNER_ROUND_PROFILES.length;

export function runnerRoundNumberForElapsed(elapsedS: number): number {
  return Math.min(
    RUNNER_MAX_DIFFICULTY_TIER,
    Math.max(1, Math.floor(Math.max(0, elapsedS) / RUNNER_ROUND_DURATION_S) + 1)
  );
}

export function runnerRoundProfile(roundNumber: number): RunnerRoundProfile {
  const index = Math.min(
    RUNNER_MAX_DIFFICULTY_TIER - 1,
    Math.max(0, Math.floor(roundNumber) - 1)
  );
  return RUNNER_ROUND_PROFILES[index];
}

export function runnerSequenceGap(
  roundNumber: number,
  transition: 'jump' | 'slide' | 'platform'
): number {
  const profile = runnerRoundProfile(roundNumber);
  const seconds = transition === 'jump' ? 0.94 : transition === 'platform' ? 0.9 : 0.58;
  const minimum = transition === 'slide' ? 230 : 280;
  return Math.round(Math.max(minimum, profile.baseSpeed * seconds));
}

export function guaranteedSpecialForRound(roundNumber: number): RunnerSpecialPattern | null {
  return runnerRoundProfile(roundNumber).guaranteedSpecial;
}

export function selectRoundPattern(
  roundNumber: number,
  spawnIndex: number,
  roll: number
): RunnerCoursePattern | null {
  const profile = runnerRoundProfile(roundNumber);
  if (spawnIndex === 0) return profile.openingPattern;
  if (profile.patternPool.length === 0 || roll >= profile.patternChance) return null;
  const normalizedRoll = Math.max(0, roll) / profile.patternChance;
  const index = Math.min(
    profile.patternPool.length - 1,
    Math.floor(normalizedRoll * profile.patternPool.length)
  );
  return profile.patternPool[index];
}

export function selectSpecialPattern(
  roundNumber: number,
  spawnIndex: number,
  roll: number
): RunnerSpecialPattern | null {
  const pattern = selectRoundPattern(roundNumber, spawnIndex, roll);
  return pattern && isSpecialPattern(pattern) ? pattern : null;
}

export function runnerRoundCatalog(): string {
  return RUNNER_ROUND_PROFILES
    .map((profile) => `${profile.tier}:${profile.id}`)
    .join('|');
}
