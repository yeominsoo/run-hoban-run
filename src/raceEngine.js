export const MAX_PARTICIPANTS = 800;
export const RACE_DURATION_SECONDS = 60;
export const OBSTACLE_COUNT = 10;
export const OBSTACLE_PASS_PROBABILITY = 0.49;
export const SKILL_TRIGGER_PROBABILITY = 0.05;
export const SKILL_DURATION_SECONDS = 10;
export const SIMULATION_TICK_SECONDS = 0.5;

export const TRACK_TYPES = Object.freeze([
  {
    id: "lake",
    name: "호수 순환 트랙",
    terrain: "lake",
    description: "균형 잡힌 속도와 안정적인 흐름",
    paceFactor: 1,
    variance: 0.16,
    obstaclePenalty: 8,
    skillMultiplier: 1.68
  },
  {
    id: "hill",
    name: "언덕 스퍼트 트랙",
    terrain: "hill",
    description: "빠른 상위권과 큰 장애물 손실",
    paceFactor: 1.03,
    variance: 0.22,
    obstaclePenalty: 10,
    skillMultiplier: 1.82
  },
  {
    id: "forest",
    name: "숲길 변수 트랙",
    terrain: "forest",
    description: "변수가 크고 회복 기회가 많은 코스",
    paceFactor: 0.98,
    variance: 0.27,
    obstaclePenalty: 6.5,
    skillMultiplier: 1.74
  }
]);

const OBSTACLE_TYPES = Object.freeze([
  { name: "물웅덩이", impact: 1 },
  { name: "급커브", impact: 0.9 },
  { name: "허들", impact: 1.1 },
  { name: "자갈길", impact: 0.95 },
  { name: "바람길", impact: 1.05 }
]);

export function createSeed() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createSeededRandom(seed) {
  const seedFactory = xmur3(String(seed ?? createSeed()));
  return mulberry32(seedFactory());
}

export function normalizeParticipants(value) {
  const rawList = Array.isArray(value) ? value : String(value ?? "").split(/\r?\n/);
  const participants = rawList
    .map((name) => String(name).trim())
    .filter(Boolean)
    .map((name, index) => ({
      id: index + 1,
      name
    }));

  if (participants.length < 1) {
    throw new RangeError("참가자를 1명 이상 입력하세요.");
  }

  if (participants.length > MAX_PARTICIPANTS) {
    throw new RangeError(`참가자는 최대 ${MAX_PARTICIPANTS}명까지 가능합니다.`);
  }

  return participants;
}

export function normalizePassRange(start, end, participantCount) {
  const passStart = Number.parseInt(start, 10);
  const passEnd = Number.parseInt(end, 10);

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

export function getTrack(trackId) {
  const track = TRACK_TYPES.find((candidate) => candidate.id === trackId);

  if (!track) {
    throw new RangeError("지원하지 않는 트랙입니다.");
  }

  return track;
}

export function generateObstacleSchedule(rng = Math.random) {
  return Array.from({ length: OBSTACLE_COUNT }, (_, index) => {
    const obstacle = OBSTACLE_TYPES[Math.floor(rng() * OBSTACLE_TYPES.length)];
    const time = 4 + rng() * (RACE_DURATION_SECONDS - 8);

    return {
      id: index + 1,
      time: round(time, 2),
      name: obstacle.name,
      impact: obstacle.impact,
      passCount: 0,
      failCount: 0
    };
  })
    .sort((a, b) => a.time - b.time)
    .map((event, index) => ({
      ...event,
      id: index + 1
    }));
}

export function simulateRace(options) {
  const {
    participantNames,
    trackId = TRACK_TYPES[0].id,
    passStart = 1,
    passEnd = 1,
    seed = createSeed()
  } = options ?? {};

  const participants = normalizeParticipants(participantNames);
  const passRange = normalizePassRange(passStart, passEnd, participants.length);
  const track = getTrack(trackId);
  const rng = createSeededRandom(seed);
  const obstacleEvents = generateObstacleSchedule(rng);
  const states = participants.map((participant) => createRacerState(participant, track, rng));
  const frames = [];
  let obstacleCursor = 0;

  for (let time = 0; time <= RACE_DURATION_SECONDS + 0.001; time += SIMULATION_TICK_SECONDS) {
    const currentTime = round(time, 2);

    while (
      obstacleCursor < obstacleEvents.length &&
      obstacleEvents[obstacleCursor].time <= currentTime + 0.001
    ) {
      applyObstacle(obstacleEvents[obstacleCursor], states, track, rng);
      obstacleCursor += 1;
    }

    if (currentTime > 0) {
      advanceRacers(states, track, currentTime, rng);
    }

    frames.push(createFrame(currentTime, states));
  }

  const ranking = states
    .slice()
    .sort((a, b) => b.position - a.position || a.id - b.id)
    .map((state, index) => ({
      id: state.id,
      name: state.name,
      rank: index + 1,
      distance: round(state.position, 2),
      progress: progressForPosition(state.position),
      obstaclePasses: state.obstaclePasses,
      obstacleFails: state.obstacleFails,
      skillTriggered: state.skill.triggered,
      skillStart: state.skill.start,
      skillEnd: state.skill.end,
      passed: index + 1 >= passRange.start && index + 1 <= passRange.end
    }));

  const passers = ranking.filter((racer) => racer.passed);
  const skillTriggeredCount = ranking.filter((racer) => racer.skillTriggered).length;
  const obstaclePassCount = ranking.reduce((sum, racer) => sum + racer.obstaclePasses, 0);
  const obstacleFailCount = ranking.reduce((sum, racer) => sum + racer.obstacleFails, 0);

  return {
    title: "달려라 검단호수공원 호반써밋",
    seed,
    track,
    passRange,
    durationSeconds: RACE_DURATION_SECONDS,
    obstacleCount: OBSTACLE_COUNT,
    obstaclePassProbability: OBSTACLE_PASS_PROBABILITY,
    skillTriggerProbability: SKILL_TRIGGER_PROBABILITY,
    skillDurationSeconds: SKILL_DURATION_SECONDS,
    participants,
    frames,
    obstacleEvents,
    ranking,
    passers,
    summary: {
      participantCount: participants.length,
      passCount: passers.length,
      skillTriggeredCount,
      obstaclePassCount,
      obstacleFailCount
    }
  };
}

export function createSampleParticipants(count) {
  const safeCount = Math.max(1, Math.min(MAX_PARTICIPANTS, Number.parseInt(count, 10) || 1));

  return Array.from({ length: safeCount }, (_, index) => {
    return `참가자 ${String(index + 1).padStart(3, "0")}`;
  });
}

export function toRankingCsv(ranking) {
  const header = [
    "rank",
    "name",
    "passed",
    "distance",
    "obstaclePasses",
    "obstacleFails",
    "skillTriggered",
    "skillStart",
    "skillEnd"
  ];
  const rows = ranking.map((racer) => [
    racer.rank,
    csvEscape(racer.name),
    racer.passed ? "Y" : "N",
    racer.distance,
    racer.obstaclePasses,
    racer.obstacleFails,
    racer.skillTriggered ? "Y" : "N",
    racer.skillStart ?? "",
    racer.skillEnd ?? ""
  ]);

  return [header, ...rows].map((row) => row.join(",")).join("\n");
}

function createRacerState(participant, track, rng) {
  const normalizedVariance = (rng() - 0.5) * track.variance;
  const startBoost = 0.95 + rng() * 0.12;
  const baseSpeed = (9.5 + rng() * 1.8) * track.paceFactor * (1 + normalizedVariance) * startBoost;
  const skillTriggered = rng() < SKILL_TRIGGER_PROBABILITY;
  const skillStart = skillTriggered
    ? round(rng() * (RACE_DURATION_SECONDS - SKILL_DURATION_SECONDS), 2)
    : null;

  return {
    ...participant,
    baseSpeed,
    position: rng() * 2,
    penaltyUntil: 0,
    obstaclePasses: 0,
    obstacleFails: 0,
    skill: {
      triggered: skillTriggered,
      start: skillStart,
      end: skillTriggered ? round(skillStart + SKILL_DURATION_SECONDS, 2) : null
    }
  };
}

function applyObstacle(event, states, track, rng) {
  states.forEach((state) => {
    const passed = rng() < OBSTACLE_PASS_PROBABILITY;

    if (passed) {
      state.obstaclePasses += 1;
      event.passCount += 1;
      state.position += 1.4 + rng() * 1.8;
      return;
    }

    state.obstacleFails += 1;
    event.failCount += 1;
    state.penaltyUntil = Math.max(state.penaltyUntil, event.time + 2.7 + rng() * 2.8);
    state.position = Math.max(
      0,
      state.position - track.obstaclePenalty * event.impact * (0.72 + rng() * 0.42)
    );
  });
}

function advanceRacers(states, track, currentTime, rng) {
  states.forEach((state) => {
    const penaltyMultiplier = currentTime < state.penaltyUntil ? 0.48 : 1;
    const skillMultiplier = isSkillActive(state, currentTime) ? track.skillMultiplier : 1;
    const rhythm = 0.97 + rng() * 0.06;
    state.position += state.baseSpeed * penaltyMultiplier * skillMultiplier * rhythm * SIMULATION_TICK_SECONDS;
  });
}

function createFrame(time, states) {
  return {
    time,
    racers: states.map((state) => ({
      id: state.id,
      position: round(state.position, 2),
      progress: progressForPosition(state.position),
      skillActive: isSkillActive(state, time),
      slowed: time < state.penaltyUntil
    }))
  };
}

function isSkillActive(state, time) {
  return (
    state.skill.triggered &&
    time >= state.skill.start &&
    time < state.skill.end
  );
}

function progressForPosition(position) {
  return Math.max(0, Math.min(100, round((position / 650) * 100, 2)));
}

function csvEscape(value) {
  const stringValue = String(value);

  if (!/[",\n]/.test(stringValue)) {
    return stringValue;
  }

  return `"${stringValue.replaceAll('"', '""')}"`;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function xmur3(str) {
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

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
