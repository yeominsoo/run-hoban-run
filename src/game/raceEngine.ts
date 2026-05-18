export const MAX_PARTICIPANTS = 800;
export const RACE_DURATION_SECONDS = 84;
export const RACE_GROUP_SIZE = 10;
export const RACE_GROUP_SIZE_OPTIONS = Object.freeze([5, 10, 15, 20]);
export const RACE_GROUP_STAGE_SECONDS = 120;
export const SIMULATION_FRAME_RATE = 16;
export const TRACK_DISTANCE_PER_LAP = 1400;
export const TRACK_RENDER_LANE_COUNT = 24;
export const DEFAULT_LAP_COUNT = 1;
export const LAP_COUNT_OPTIONS = Object.freeze([1, 2, 3, 5]);
export const OBSTACLE_COUNT = 0;
export const OBSTACLE_PASS_PROBABILITY = 0.49;
export const SKILL_TRIGGER_PROBABILITY = 0.05;
export const SKILL_DURATION_SECONDS = 10;
export const MIN_SKILL_TRIGGER_COUNT = 2;
export const SIMULATION_TICK_SECONDS = 1 / SIMULATION_FRAME_RATE;
export const PACE_SEGMENT_COUNT = 6;
export const HELICOPTER_STRIKE_START_SECONDS = 12;
export const HELICOPTER_STRIKE_END_SECONDS = 64;
export const HELICOPTER_STRIKE_IMPACT_DELAY_SECONDS = 5.6;
export const HELICOPTER_APPEARANCE_MIN_COUNT = 3;
export const HELICOPTER_APPEARANCE_MAX_COUNT = 3;
export const HELICOPTER_ELIMINATIONS_PER_APPEARANCE_MIN_COUNT = 1;
export const HELICOPTER_ELIMINATIONS_PER_APPEARANCE_MAX_COUNT = 1;
export const HELICOPTER_STRIKE_SHOT_INTERVAL_SECONDS = 0.85;

export type Terrain = "lake" | "hill" | "forest";
export type TrackId = "lake" | "hill" | "forest";

export interface TrackType {
  id: TrackId;
  name: string;
  terrain: Terrain;
  description: string;
  paceFactor: number;
  variance: number;
  obstaclePenalty: number;
  skillMultiplier: number;
}

export interface Participant {
  id: number;
  name: string;
}

export interface PassRange {
  start: number;
  end: number;
}

export interface ObstacleEvent {
  id: number;
  time: number;
  name: string;
  impact: number;
  trackProgress: number;
  passCount: number;
  failCount: number;
}

export interface RacerObstacleEvent {
  id: number;
  obstacleIndex: number;
  racerId: number;
  racerName: string;
  time: number;
  trackProgress: number;
  laneIndex: number;
  name: string;
  impact: number;
  passed: boolean | null;
}

export interface HelicopterStrikeEvent {
  id: number;
  appearanceId: number;
  shotIndex: number;
  time: number;
  impactTime: number;
  trackProgress: number;
  laneIndex: number;
  targetId: number;
  targetName: string;
}

export interface FrameRacer {
  id: number;
  position: number;
  progress: number;
  skillActive: boolean;
  slowed: boolean;
  eliminated: boolean;
}

export interface RankedFrameRacer extends FrameRacer {
  name: string;
  rank: number;
}

export interface RaceFrame {
  time: number;
  racers: FrameRacer[];
}

export interface RankingRacer {
  id: number;
  name: string;
  rank: number;
  distance: number;
  progress: number;
  obstaclePasses: number;
  obstacleFails: number;
  eliminated: boolean;
  eliminatedAt: number | null;
  skillTriggered: boolean;
  skillStart: number | null;
  skillEnd: number | null;
  passed: boolean;
}

export interface RaceResult {
  title: string;
  seed: string;
  track: TrackType;
  lapCount: number;
  totalDistance: number;
  passRange: PassRange;
  durationSeconds: number;
  obstacleCount: number;
  obstaclePassProbability: number;
  skillTriggerProbability: number;
  skillDurationSeconds: number;
  participants: Participant[];
  frames: RaceFrame[];
  obstacleEvents: ObstacleEvent[];
  racerObstacleEvents: RacerObstacleEvent[];
  helicopterStrikeEvents: HelicopterStrikeEvent[];
  ranking: RankingRacer[];
  passers: RankingRacer[];
  summary: {
    participantCount: number;
    passCount: number;
    skillTriggeredCount: number;
    obstaclePassCount: number;
    obstacleFailCount: number;
    obstaclesPerRacer: number;
    helicopterAppearanceCount: number;
    helicopterStrikeCount: number;
  };
}

export interface SimulateRaceOptions {
  participantNames: string[] | string;
  trackId?: TrackId;
  passStart?: number | string;
  passEnd?: number | string;
  lapCount?: number | string;
  seed?: string;
}

interface ObstacleType {
  name: string;
  impact: number;
}

interface RacerState extends Participant {
  baseSpeed: number;
  paceSegments: number[];
  position: number;
  penaltyUntil: number;
  obstaclePasses: number;
  obstacleFails: number;
  eliminated: boolean;
  eliminatedAt: number | null;
  skill: {
    triggered: boolean;
    start: number | null;
    end: number | null;
  };
}

export const TRACK_TYPES = Object.freeze([
  {
    id: "lake",
    name: "호수 리본 코스",
    terrain: "lake",
    description: "촘촘한 S라인과 안정적인 흐름",
    paceFactor: 1,
    variance: 0.16,
    obstaclePenalty: 8,
    skillMultiplier: 1.68,
  },
  {
    id: "hill",
    name: "언덕 스퍼트 코스",
    terrain: "hill",
    description: "오르막 감속 뒤 내리막 스퍼트",
    paceFactor: 1.03,
    variance: 0.22,
    obstaclePenalty: 10,
    skillMultiplier: 1.82,
  },
  {
    id: "forest",
    name: "숲길 절벽 코스",
    terrain: "forest",
    description: "완만한 숲길과 절벽 징검다리 연출",
    paceFactor: 0.98,
    variance: 0.27,
    obstaclePenalty: 6.5,
    skillMultiplier: 1.74,
  },
] satisfies TrackType[]);

const OBSTACLE_TYPES: readonly ObstacleType[] = Object.freeze([
  { name: "물웅덩이", impact: 1 },
  { name: "급커브", impact: 0.9 },
  { name: "허들", impact: 1.1 },
  { name: "자갈길", impact: 0.95 },
  { name: "바람길", impact: 1.05 },
]);

export function createSeed(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createSeededRandom(seed: string): () => number {
  const seedFactory = xmur3(String(seed || createSeed()));
  return mulberry32(seedFactory());
}

export function normalizeParticipants(
  value: string[] | string | null | undefined,
): Participant[] {
  const rawList = Array.isArray(value)
    ? value
    : String(value ?? "").split(/\r?\n/);
  const participants = rawList
    .map((name) => String(name).trim())
    .filter(Boolean)
    .map((name, index) => ({
      id: index + 1,
      name,
    }));

  if (participants.length < 1) {
    throw new RangeError("참가자를 1명 이상 입력하세요.");
  }

  if (participants.length > MAX_PARTICIPANTS) {
    throw new RangeError(`참가자는 최대 ${MAX_PARTICIPANTS}명까지 가능합니다.`);
  }

  return participants;
}

export function normalizePassRange(
  start: number | string,
  end: number | string,
  participantCount: number,
): PassRange {
  const passStart = Number.parseInt(String(start), 10);
  const passEnd = Number.parseInt(String(end), 10);

  if (!Number.isInteger(passStart) || !Number.isInteger(passEnd)) {
    throw new RangeError("통과 순위 범위는 숫자로 입력하세요.");
  }

  if (passStart < 1 || passEnd < 1) {
    throw new RangeError("통과 순위는 1등 이상이어야 합니다.");
  }

  if (passStart > passEnd) {
    throw new RangeError("통과 시작 순위는 종료 순위보다 클 수 없습니다.");
  }

  if (passEnd > participantCount) {
    throw new RangeError("통과 종료 순위가 참가자 수보다 큽니다.");
  }

  return { start: passStart, end: passEnd };
}

export function normalizeLapCount(value: number | string): number {
  const lapCount = Number.parseInt(String(value), 10);

  if (!LAP_COUNT_OPTIONS.includes(lapCount)) {
    throw new RangeError(
      `코스 길이는 ${LAP_COUNT_OPTIONS.join(", ")} 중에서 선택하세요.`,
    );
  }

  return lapCount;
}

export function getTrack(trackId: TrackId): TrackType {
  const track = TRACK_TYPES.find((candidate) => candidate.id === trackId);

  if (!track) {
    throw new RangeError("지원하지 않는 트랙입니다.");
  }

  return track;
}

export function generateObstacleSchedule(
  rng: () => number = Math.random,
): ObstacleEvent[] {
  return Array.from({ length: OBSTACLE_COUNT }, (_, index) => {
    const obstacle =
      OBSTACLE_TYPES[Math.floor(rng() * OBSTACLE_TYPES.length)] ??
      OBSTACLE_TYPES[0];
    const time = 4 + rng() * (RACE_DURATION_SECONDS - 8);

    return {
      id: index + 1,
      time: round(time, 2),
      name: obstacle.name,
      impact: obstacle.impact,
      trackProgress: round((time / RACE_DURATION_SECONDS) * 100, 2),
      passCount: 0,
      failCount: 0,
    };
  })
    .sort((a, b) => a.time - b.time)
    .map((event, index) => ({
      ...event,
      id: index + 1,
    }));
}

export function generateRacerObstacleEvents(
  participants: Participant[],
  obstacleSlots: ObstacleEvent[],
  rng: () => number = Math.random,
): RacerObstacleEvent[] {
  return participants
    .flatMap((participant) => {
      return obstacleSlots.map((slot) => {
        const obstacle =
          OBSTACLE_TYPES[Math.floor(rng() * OBSTACLE_TYPES.length)] ??
          OBSTACLE_TYPES[0];
        const lanePhase = ((participant.id * 9.73 + rng() * 16) % 100) - 50;
        const timeOffset =
          (rng() - 0.5) * 4.8 + ((participant.id % 5) - 2) * 0.18;
        const time = clamp(
          slot.time + timeOffset,
          3,
          RACE_DURATION_SECONDS - 2,
        );
        const trackProgress = clampProgress(slot.trackProgress + lanePhase);
        const laneIndex = getRenderLaneIndex(participant.id);

        return {
          id: 0,
          obstacleIndex: slot.id,
          racerId: participant.id,
          racerName: participant.name,
          time: round(time, 2),
          trackProgress,
          laneIndex,
          name: obstacle.name,
          impact: obstacle.impact,
          passed: null,
        };
      });
    })
    .sort(
      (a, b) =>
        a.time - b.time ||
        a.racerId - b.racerId ||
        a.obstacleIndex - b.obstacleIndex,
    )
    .map((event, index) => ({
      ...event,
      id: index + 1,
    }));
}

export function generateHelicopterStrikeEvents(
  participants: Participant[],
  rng: () => number = Math.random,
): HelicopterStrikeEvent[] {
  const maxAppearanceCount = Math.min(
    HELICOPTER_APPEARANCE_MAX_COUNT,
    participants.length,
  );
  const minAppearanceCount = Math.min(
    HELICOPTER_APPEARANCE_MIN_COUNT,
    maxAppearanceCount,
  );
  const appearanceCount =
    minAppearanceCount +
    Math.floor(rng() * (maxAppearanceCount - minAppearanceCount + 1));
  const shuffledParticipants = participants
    .map((participant) => ({ participant, roll: rng() }))
    .sort((a, b) => a.roll - b.roll)
    .map(({ participant }) => participant);
  let participantCursor = 0;
  const firstImpactTime =
    HELICOPTER_STRIKE_START_SECONDS + HELICOPTER_STRIKE_IMPACT_DELAY_SECONDS;
  const lastAppearanceTime =
    HELICOPTER_STRIKE_END_SECONDS -
    HELICOPTER_STRIKE_IMPACT_DELAY_SECONDS -
    (HELICOPTER_ELIMINATIONS_PER_APPEARANCE_MAX_COUNT - 1) *
      HELICOPTER_STRIKE_SHOT_INTERVAL_SECONDS;
  const appearanceWindowSeconds = Math.max(
    1,
    lastAppearanceTime - HELICOPTER_STRIKE_START_SECONDS,
  );
  const events: HelicopterStrikeEvent[] = [];

  for (
    let appearanceIndex = 0;
    appearanceIndex < appearanceCount;
    appearanceIndex += 1
  ) {
    const remainingParticipants = participants.length - participantCursor;
    const remainingAppearances = appearanceCount - appearanceIndex - 1;
    const maxEliminationsThisAppearance = Math.min(
      HELICOPTER_ELIMINATIONS_PER_APPEARANCE_MAX_COUNT,
      remainingParticipants - remainingAppearances,
    );
    const eliminationCount =
      HELICOPTER_ELIMINATIONS_PER_APPEARANCE_MIN_COUNT +
      Math.floor(
        rng() *
          (maxEliminationsThisAppearance -
            HELICOPTER_ELIMINATIONS_PER_APPEARANCE_MIN_COUNT +
            1),
      );
    const appearanceSpread =
      appearanceCount === 1
        ? 0.5
        : appearanceIndex / Math.max(1, appearanceCount - 1);
    const rawAppearanceTime =
      HELICOPTER_STRIKE_START_SECONDS +
      appearanceSpread * appearanceWindowSeconds +
      (rng() - 0.5) * 1.8;
    const appearanceTime = clamp(
      rawAppearanceTime,
      HELICOPTER_STRIKE_START_SECONDS,
      Math.max(HELICOPTER_STRIKE_START_SECONDS, lastAppearanceTime),
    );

    for (let shotIndex = 0; shotIndex < eliminationCount; shotIndex += 1) {
      const participant = shuffledParticipants[participantCursor];

      if (!participant) {
        break;
      }

      const shotTime =
        appearanceTime + shotIndex * HELICOPTER_STRIKE_SHOT_INTERVAL_SECONDS;
      const impactTime = clamp(
        shotTime + HELICOPTER_STRIKE_IMPACT_DELAY_SECONDS,
        firstImpactTime,
        HELICOPTER_STRIKE_END_SECONDS,
      );

      events.push({
        id: events.length + 1,
        appearanceId: appearanceIndex + 1,
        shotIndex: shotIndex + 1,
        time: round(shotTime, 2),
        impactTime: round(impactTime, 2),
        trackProgress: round((impactTime / RACE_DURATION_SECONDS) * 100, 2),
        laneIndex: getRenderLaneIndex(participant.id),
        targetId: participant.id,
        targetName: participant.name,
      });
      participantCursor += 1;
    }
  }

  return events
    .sort(
      (a, b) =>
        a.time - b.time ||
        a.impactTime - b.impactTime ||
        a.appearanceId - b.appearanceId ||
        a.shotIndex - b.shotIndex,
    )
    .map((event, index) => ({
      ...event,
      id: index + 1,
    }));
}

function getHelicopterAppearanceCount(events: HelicopterStrikeEvent[]): number {
  return new Set(events.map((event) => event.appearanceId)).size;
}

function isHelicopterActive(
  events: HelicopterStrikeEvent[],
  time: number,
): boolean {
  const windows = new Map<number, { start: number; end: number }>();

  events.forEach((event) => {
    const current = windows.get(event.appearanceId);

    if (!current) {
      windows.set(event.appearanceId, {
        start: event.time,
        end: event.impactTime,
      });
      return;
    }

    current.start = Math.min(current.start, event.time);
    current.end = Math.max(current.end, event.impactTime);
  });

  return Array.from(windows.values()).some(
    (window) => time >= window.start && time <= window.end,
  );
}

export function simulateRace(options: SimulateRaceOptions): RaceResult {
  const {
    participantNames,
    trackId = TRACK_TYPES[0].id,
    passStart = 1,
    passEnd = 1,
    lapCount: rawLapCount = DEFAULT_LAP_COUNT,
    seed = createSeed(),
  } = options;

  const participants = normalizeParticipants(participantNames);
  const passRange = normalizePassRange(passStart, passEnd, participants.length);
  const lapCount = normalizeLapCount(rawLapCount);
  const totalDistance = TRACK_DISTANCE_PER_LAP * lapCount;
  const track = getTrack(trackId);
  const rng = createSeededRandom(seed);
  const obstacleEvents: ObstacleEvent[] = [];
  const racerObstacleEvents: RacerObstacleEvent[] = [];
  const helicopterStrikeEvents = generateHelicopterStrikeEvents(
    participants,
    rng,
  );
  const states = participants.map((participant) =>
    createRacerState(participant, track, lapCount, rng),
  );
  ensureMinimumSkillTriggers(states, rng);
  const frames: RaceFrame[] = [];
  let obstacleCursor = 0;
  let strikeCursor = 0;
  const frameCount = RACE_DURATION_SECONDS * SIMULATION_FRAME_RATE;

  for (let frameIndex = 0; frameIndex <= frameCount; frameIndex += 1) {
    const currentTime = round(frameIndex * SIMULATION_TICK_SECONDS, 4);

    while (
      obstacleCursor < racerObstacleEvents.length &&
      racerObstacleEvents[obstacleCursor].time <= currentTime + 0.001
    ) {
      applyObstacle(
        racerObstacleEvents[obstacleCursor],
        obstacleEvents[racerObstacleEvents[obstacleCursor].obstacleIndex - 1],
        states,
        track,
        rng,
      );
      obstacleCursor += 1;
    }

    while (
      strikeCursor < helicopterStrikeEvents.length &&
      helicopterStrikeEvents[strikeCursor].impactTime <= currentTime + 0.001
    ) {
      applyHelicopterStrike(helicopterStrikeEvents[strikeCursor], states);
      strikeCursor += 1;
    }

    const helicopterActive = isHelicopterActive(
      helicopterStrikeEvents,
      currentTime,
    );

    if (currentTime > 0) {
      advanceRacers(
        states,
        track,
        currentTime,
        totalDistance,
        rng,
        helicopterActive,
      );
    }

    frames.push(
      createFrame(currentTime, states, totalDistance, helicopterActive),
    );
  }

  const ranking = states
    .slice()
    .sort(
      (a, b) =>
        Number(a.eliminated) - Number(b.eliminated) ||
        b.position - a.position ||
        a.id - b.id,
    )
    .map(
      (state, index): RankingRacer => ({
        id: state.id,
        name: state.name,
        rank: index + 1,
        distance: round(state.position, 2),
        progress: progressForPosition(state.position, totalDistance),
        obstaclePasses: state.obstaclePasses,
        obstacleFails: state.obstacleFails,
        eliminated: state.eliminated,
        eliminatedAt: state.eliminatedAt,
        skillTriggered: state.skill.triggered,
        skillStart: state.skill.start,
        skillEnd: state.skill.end,
        passed:
          !state.eliminated &&
          index + 1 >= passRange.start &&
          index + 1 <= passRange.end,
      }),
    );

  const passers = ranking.filter((racer) => racer.passed);
  const skillTriggeredCount = ranking.filter(
    (racer) => racer.skillTriggered,
  ).length;
  const obstaclePassCount = ranking.reduce(
    (sum, racer) => sum + racer.obstaclePasses,
    0,
  );
  const obstacleFailCount = ranking.reduce(
    (sum, racer) => sum + racer.obstacleFails,
    0,
  );

  return {
    title: "달려라 검단호수공원 호반써밋",
    seed,
    track,
    lapCount,
    totalDistance,
    passRange,
    durationSeconds: RACE_DURATION_SECONDS,
    obstacleCount: OBSTACLE_COUNT,
    obstaclePassProbability: OBSTACLE_PASS_PROBABILITY,
    skillTriggerProbability: SKILL_TRIGGER_PROBABILITY,
    skillDurationSeconds: SKILL_DURATION_SECONDS,
    participants,
    frames,
    obstacleEvents,
    racerObstacleEvents,
    helicopterStrikeEvents,
    ranking,
    passers,
    summary: {
      participantCount: participants.length,
      passCount: passers.length,
      skillTriggeredCount,
      obstaclePassCount,
      obstacleFailCount,
      obstaclesPerRacer: OBSTACLE_COUNT,
      helicopterAppearanceCount: getHelicopterAppearanceCount(
        helicopterStrikeEvents,
      ),
      helicopterStrikeCount: helicopterStrikeEvents.length,
    },
  };
}

export function createSampleParticipants(count: number | string): string[] {
  const safeCount = Math.max(
    1,
    Math.min(MAX_PARTICIPANTS, Number.parseInt(String(count), 10) || 1),
  );

  return Array.from({ length: safeCount }, (_, index) => {
    return `참가자 ${String(index + 1).padStart(3, "0")}`;
  });
}

export function rankFrame(
  race: RaceResult,
  frame: RaceFrame,
): RankedFrameRacer[] {
  const racerById = new Map(
    race.participants.map((racer) => [racer.id, racer]),
  );
  return frame.racers
    .map((racer) => ({
      ...racer,
      name: racerById.get(racer.id)?.name ?? `참가자 ${racer.id}`,
    }))
    .sort((a, b) => b.position - a.position || a.id - b.id)
    .map((racer, index) => ({
      ...racer,
      rank: index + 1,
    }));
}

export function findFrame(race: RaceResult, time: number): RaceFrame {
  const index = Math.min(
    race.frames.length - 1,
    Math.max(0, Math.round(time / SIMULATION_TICK_SECONDS)),
  );

  return race.frames[index];
}

export function normalizeRaceGroupSize(value: number | string): number {
  const groupSize = Number.parseInt(String(value), 10);

  if (!RACE_GROUP_SIZE_OPTIONS.includes(groupSize)) {
    throw new RangeError(
      `그룹당 마리 수는 ${RACE_GROUP_SIZE_OPTIONS.join(", ")} 중에서 선택하세요.`,
    );
  }

  return groupSize;
}

export function getRaceGroupCount(
  participantCount: number,
  groupSize = RACE_GROUP_SIZE,
): number {
  return Math.max(
    1,
    Math.ceil(participantCount / normalizeRaceGroupSize(groupSize)),
  );
}

export function getRaceDisplayDurationSeconds(
  participantCount: number,
  groupSize = RACE_GROUP_SIZE,
): number {
  return (
    getRaceGroupCount(participantCount, groupSize) * RACE_GROUP_STAGE_SECONDS
  );
}

export function toRankingCsv(ranking: RankingRacer[]): string {
  const header = [
    "rank",
    "name",
    "passed",
    "distance",
    "obstaclePasses",
    "obstacleFails",
    "eliminated",
    "eliminatedAt",
    "skillTriggered",
    "skillStart",
    "skillEnd",
  ];
  const rows = ranking.map((racer) => [
    racer.rank,
    csvEscape(racer.name),
    racer.passed ? "Y" : "N",
    racer.distance,
    racer.obstaclePasses,
    racer.obstacleFails,
    racer.eliminated ? "Y" : "N",
    racer.eliminatedAt ?? "",
    racer.skillTriggered ? "Y" : "N",
    racer.skillStart ?? "",
    racer.skillEnd ?? "",
  ]);

  return [header, ...rows].map((row) => row.join(",")).join("\n");
}

function createRacerState(
  participant: Participant,
  track: TrackType,
  lapCount: number,
  rng: () => number,
): RacerState {
  const normalizedVariance = (rng() - 0.5) * track.variance;
  const startBoost = 0.95 + rng() * 0.12;
  const baseSpeed =
    (15.2 + rng() * 2.6) *
    track.paceFactor *
    (1 + normalizedVariance) *
    startBoost *
    lapCount;
  const paceSegments = createPaceSegments(rng);
  const skillTriggered = rng() < SKILL_TRIGGER_PROBABILITY;
  const skillStart = skillTriggered ? createSkillStart(rng) : null;

  return {
    ...participant,
    baseSpeed,
    paceSegments,
    position: rng() * 2,
    penaltyUntil: 0,
    obstaclePasses: 0,
    obstacleFails: 0,
    eliminated: false,
    eliminatedAt: null,
    skill: {
      triggered: skillTriggered,
      start: skillStart,
      end:
        skillTriggered && skillStart !== null
          ? round(skillStart + SKILL_DURATION_SECONDS, 2)
          : null,
    },
  };
}

function ensureMinimumSkillTriggers(
  states: RacerState[],
  rng: () => number,
): void {
  const requiredCount = Math.min(MIN_SKILL_TRIGGER_COUNT, states.length);
  const triggeredCount = states.filter((state) => state.skill.triggered).length;

  if (triggeredCount >= requiredCount) {
    return;
  }

  states
    .filter((state) => !state.skill.triggered)
    .map((state) => ({ state, roll: rng() }))
    .sort((a, b) => a.roll - b.roll)
    .slice(0, requiredCount - triggeredCount)
    .forEach(({ state }) => {
      const skillStart = createSkillStart(rng);

      state.skill = {
        triggered: true,
        start: skillStart,
        end: round(skillStart + SKILL_DURATION_SECONDS, 2),
      };
    });
}

function createSkillStart(rng: () => number): number {
  const skillWindowStart = 6;
  const skillWindowEnd = RACE_DURATION_SECONDS - SKILL_DURATION_SECONDS - 6;

  return round(
    skillWindowStart + rng() * Math.max(1, skillWindowEnd - skillWindowStart),
    2,
  );
}

function createPaceSegments(rng: () => number): number[] {
  return Array.from({ length: PACE_SEGMENT_COUNT }, (_, index) => {
    const phaseBias = Math.sin((index / PACE_SEGMENT_COUNT) * Math.PI * 2);
    return round(0.9 + rng() * 0.24 + phaseBias * 0.035, 3);
  });
}

function applyObstacle(
  event: RacerObstacleEvent,
  slot: ObstacleEvent,
  states: RacerState[],
  track: TrackType,
  rng: () => number,
): void {
  const state = states.find((candidate) => candidate.id === event.racerId);

  if (!state || state.eliminated) {
    return;
  }

  const passed = rng() < OBSTACLE_PASS_PROBABILITY;
  event.passed = passed;

  if (passed) {
    state.obstaclePasses += 1;
    slot.passCount += 1;
    state.position += 1.4 + rng() * 1.8;
    return;
  }

  state.obstacleFails += 1;
  slot.failCount += 1;
  state.penaltyUntil = Math.max(
    state.penaltyUntil,
    event.time + 2.7 + rng() * 2.8,
  );
  state.position = Math.max(
    0,
    state.position -
      track.obstaclePenalty * event.impact * (0.72 + rng() * 0.42),
  );
}

function applyHelicopterStrike(
  event: HelicopterStrikeEvent,
  states: RacerState[],
): void {
  const state = states.find((candidate) => candidate.id === event.targetId);

  if (!state || state.eliminated) {
    return;
  }

  state.eliminated = true;
  state.eliminatedAt = event.impactTime;
  state.penaltyUntil = RACE_DURATION_SECONDS + 1;
}

function advanceRacers(
  states: RacerState[],
  track: TrackType,
  currentTime: number,
  totalDistance: number,
  rng: () => number,
  helicopterActive: boolean,
): void {
  states.forEach((state) => {
    if (state.eliminated) {
      return;
    }

    const penaltyMultiplier = currentTime < state.penaltyUntil ? 0.48 : 1;
    const skillMultiplier =
      !helicopterActive && isSkillActive(state, currentTime)
        ? track.skillMultiplier
        : 1;
    const segmentMultiplier = getPaceSegmentMultiplier(
      state,
      currentTime,
      totalDistance,
    );
    const terrainMultiplier = getTerrainSpeedMultiplier(
      track.terrain,
      progressForPosition(state.position, totalDistance),
    );
    const rhythm = 0.97 + rng() * 0.06;
    state.position +=
      state.baseSpeed *
      penaltyMultiplier *
      skillMultiplier *
      segmentMultiplier *
      terrainMultiplier *
      rhythm *
      SIMULATION_TICK_SECONDS;
  });
}

export function getTerrainSpeedMultiplier(
  terrain: Terrain,
  progress: number,
): number {
  if (terrain === "hill") {
    if (progress >= 8 && progress < 36) {
      return 0.88;
    }

    if (progress >= 36 && progress < 58) {
      return 0.96;
    }

    if (progress >= 58 && progress < 82) {
      return 1.1;
    }

    return 1.02;
  }

  if (terrain === "forest") {
    const bendLoad = Math.abs(Math.sin((progress / 100) * Math.PI * 6));
    return round(1 - bendLoad * 0.13, 3);
  }

  return 1;
}

function getPaceSegmentMultiplier(
  state: RacerState,
  currentTime: number,
  totalDistance: number,
): number {
  const progress = progressForPosition(state.position, totalDistance);
  const segmentByProgress = Math.floor((progress / 100) * PACE_SEGMENT_COUNT);
  const segmentByTime = Math.floor(
    (currentTime / RACE_DURATION_SECONDS) * PACE_SEGMENT_COUNT,
  );
  const segmentIndex = Math.min(
    PACE_SEGMENT_COUNT - 1,
    Math.max(0, Math.max(segmentByProgress, segmentByTime)),
  );
  const nextIndex = Math.min(PACE_SEGMENT_COUNT - 1, segmentIndex + 1);
  const blend =
    ((currentTime / RACE_DURATION_SECONDS) * PACE_SEGMENT_COUNT) % 1;

  return round(
    state.paceSegments[segmentIndex] * (1 - blend) +
      state.paceSegments[nextIndex] * blend,
    3,
  );
}

function createFrame(
  time: number,
  states: RacerState[],
  totalDistance: number,
  helicopterActive: boolean,
): RaceFrame {
  return {
    time,
    racers: states.map((state) => {
      return {
        id: state.id,
        position: round(state.position, 2),
        progress: progressForPosition(state.position, totalDistance),
        skillActive: !helicopterActive && isSkillActive(state, time),
        slowed: time < state.penaltyUntil,
        eliminated: state.eliminated,
      };
    }),
  };
}

function isSkillActive(state: RacerState, time: number): boolean {
  return state.skill.triggered &&
    state.skill.start !== null &&
    state.skill.end !== null
    ? time >= state.skill.start && time < state.skill.end
    : false;
}

function progressForPosition(position: number, totalDistance: number): number {
  return clampProgress((position / totalDistance) * 100);
}

function clampProgress(progress: number): number {
  return round(clamp(progress, 0, 100), 2);
}

export function getRenderLaneIndex(participantId: number): number {
  return Math.max(0, (participantId - 1) % TRACK_RENDER_LANE_COUNT);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function csvEscape(value: string): string {
  const stringValue = String(value);

  if (!/[",\n]/.test(stringValue)) {
    return stringValue;
  }

  return `"${stringValue.replaceAll('"', '""')}"`;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;

  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }

  return function seedHash() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(seed: number): () => number {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
