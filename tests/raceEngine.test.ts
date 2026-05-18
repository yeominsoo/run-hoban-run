import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAP_COUNT,
  HELICOPTER_APPEARANCE_MAX_COUNT,
  HELICOPTER_APPEARANCE_MIN_COUNT,
  HELICOPTER_ELIMINATIONS_PER_APPEARANCE_MAX_COUNT,
  HELICOPTER_ELIMINATIONS_PER_APPEARANCE_MIN_COUNT,
  HELICOPTER_STRIKE_END_SECONDS,
  HELICOPTER_STRIKE_IMPACT_DELAY_SECONDS,
  HELICOPTER_STRIKE_SHOT_INTERVAL_SECONDS,
  HELICOPTER_STRIKE_START_SECONDS,
  LAP_COUNT_OPTIONS,
  MAX_PARTICIPANTS,
  MIN_SKILL_TRIGGER_COUNT,
  OBSTACLE_COUNT,
  OBSTACLE_PASS_PROBABILITY,
  PACE_SEGMENT_COUNT,
  RACE_DURATION_SECONDS,
  RACE_GROUP_SIZE,
  RACE_GROUP_SIZE_OPTIONS,
  RACE_GROUP_STAGE_SECONDS,
  SIMULATION_FRAME_RATE,
  SIMULATION_TICK_SECONDS,
  SKILL_DURATION_SECONDS,
  SKILL_TRIGGER_PROBABILITY,
  TRACK_DISTANCE_PER_LAP,
  TRACK_RENDER_LANE_COUNT,
  TRACK_TYPES,
  createSeededRandom,
  createSampleParticipants,
  findFrame,
  generateHelicopterStrikeEvents,
  generateObstacleSchedule,
  getRaceDisplayDurationSeconds,
  getRaceGroupCount,
  getRenderLaneIndex,
  getTerrainSpeedMultiplier,
  normalizeParticipants,
  simulateRace,
} from "../src/game/raceEngine";

describe("race engine", () => {
  it("핵심 규칙 상수가 요구사항과 일치한다", () => {
    expect(MAX_PARTICIPANTS).toBe(800);
    expect(RACE_DURATION_SECONDS).toBe(84);
    expect(RACE_GROUP_SIZE).toBe(10);
    expect(RACE_GROUP_SIZE_OPTIONS).toEqual([5, 10, 15, 20]);
    expect(RACE_GROUP_STAGE_SECONDS).toBe(120);
    expect(SIMULATION_FRAME_RATE).toBe(16);
    expect(SIMULATION_TICK_SECONDS).toBe(1 / 16);
    expect(DEFAULT_LAP_COUNT).toBe(1);
    expect(LAP_COUNT_OPTIONS).toEqual([1, 2, 3, 5]);
    expect(TRACK_DISTANCE_PER_LAP).toBe(1400);
    expect(TRACK_RENDER_LANE_COUNT).toBe(24);
    expect(OBSTACLE_COUNT).toBe(0);
    expect(OBSTACLE_PASS_PROBABILITY).toBe(0.49);
    expect(HELICOPTER_STRIKE_START_SECONDS).toBe(12);
    expect(HELICOPTER_STRIKE_END_SECONDS).toBe(64);
    expect(HELICOPTER_STRIKE_IMPACT_DELAY_SECONDS).toBe(5.6);
    expect(HELICOPTER_APPEARANCE_MIN_COUNT).toBe(3);
    expect(HELICOPTER_APPEARANCE_MAX_COUNT).toBe(3);
    expect(HELICOPTER_ELIMINATIONS_PER_APPEARANCE_MIN_COUNT).toBe(1);
    expect(HELICOPTER_ELIMINATIONS_PER_APPEARANCE_MAX_COUNT).toBe(1);
    expect(HELICOPTER_STRIKE_SHOT_INTERVAL_SECONDS).toBe(0.85);
    expect(SKILL_TRIGGER_PROBABILITY).toBe(0.05);
    expect(SKILL_DURATION_SECONDS).toBe(10);
    expect(MIN_SKILL_TRIGGER_COUNT).toBe(2);
    expect(PACE_SEGMENT_COUNT).toBe(6);
    expect(TRACK_TYPES).toHaveLength(3);
    expect(getRaceGroupCount(180)).toBe(18);
    expect(getRaceGroupCount(180, 20)).toBe(9);
    expect(getRaceDisplayDurationSeconds(180)).toBe(2160);
    expect(getRaceDisplayDurationSeconds(180, 20)).toBe(1080);
  });

  it("참가자는 800명을 초과할 수 없다", () => {
    expect(() =>
      normalizeParticipants(
        createSampleParticipants(800).concat("초과 참가자"),
      ),
    ).toThrow(/최대 800명/);
    expect(normalizeParticipants(createSampleParticipants(800))).toHaveLength(
      800,
    );
  });

  it("장애물 스케줄은 비활성화되어 빈 배열을 생성한다", () => {
    const schedule = generateObstacleSchedule(() => 0.5);

    expect(schedule).toEqual([]);
  });

  it("헬기는 3회 등장하고 매 탈락 페이즈를 하나씩 배정한다", () => {
    let index = 0;
    const participants = normalizeParticipants(createSampleParticipants(8));
    const values = [
      0, 0.1, 0.2, 0.25, 0.4, 0.35, 0.6, 0.45, 0.8, 0.55, 0.3, 0.65, 0.5, 0.75,
      0.7, 0.85, 0.9, 0.95, 0.1, 0.05,
    ];
    const events = generateHelicopterStrikeEvents(
      participants,
      () => values[index++ % values.length],
    );
    const eventsByAppearance = events.reduce((groups, event) => {
      const group = groups.get(event.appearanceId) ?? [];
      group.push(event);
      groups.set(event.appearanceId, group);
      return groups;
    }, new Map<number, typeof events>());

    expect(events).toHaveLength(HELICOPTER_APPEARANCE_MIN_COUNT);
    expect(eventsByAppearance.size).toBe(HELICOPTER_APPEARANCE_MIN_COUNT);
    expect(
      Array.from(eventsByAppearance.values()).every(
        (appearanceEvents) =>
          appearanceEvents.length >=
            HELICOPTER_ELIMINATIONS_PER_APPEARANCE_MIN_COUNT &&
          appearanceEvents.length <=
            HELICOPTER_ELIMINATIONS_PER_APPEARANCE_MAX_COUNT,
      ),
    ).toBe(true);
    expect(
      Array.from(eventsByAppearance.values()).every((appearanceEvents) =>
        appearanceEvents.every(
          (event, shotIndex) => event.shotIndex === shotIndex + 1,
        ),
      ),
    ).toBe(true);
    expect(
      Array.from(eventsByAppearance.values()).every((appearanceEvents) =>
        appearanceEvents.every(
          (event) => event.time >= appearanceEvents[0].time,
        ),
      ),
    ).toBe(true);
    expect(new Set(events.map((event) => event.targetId)).size).toBe(
      events.length,
    );
    expect(
      events.every(
        (event) =>
          event.impactTime >= HELICOPTER_STRIKE_START_SECONDS &&
          event.impactTime <= HELICOPTER_STRIKE_END_SECONDS &&
          event.time >= HELICOPTER_STRIKE_START_SECONDS &&
          event.time < event.impactTime &&
          event.impactTime - event.time <=
            HELICOPTER_STRIKE_IMPACT_DELAY_SECONDS + 0.01 &&
          event.impactTime - event.time >=
            HELICOPTER_STRIKE_IMPACT_DELAY_SECONDS - 0.01 &&
          event.laneIndex === getRenderLaneIndex(event.targetId),
      ),
    ).toBe(true);
    expect(events.map((event) => event.time)).toEqual(
      [...events.map((event) => event.time)].sort((a, b) => a - b),
    );
  });

  it("헬기 탈락 대상은 참가자 목록의 뒤쪽으로 치우치지 않는다", () => {
    const participants = normalizeParticipants(createSampleParticipants(120));
    const targetIds = Array.from({ length: 24 }, (_, index) =>
      generateHelicopterStrikeEvents(
        participants,
        createSeededRandom(`strike-random-${index}`),
      ).map((event) => event.targetId),
    ).flat();

    expect(targetIds.some((id) => id <= 30)).toBe(true);
    expect(targetIds.some((id) => id > 30 && id <= 90)).toBe(true);
    expect(targetIds.some((id) => id > 90)).toBe(true);
  });

  it("맵 지형별 속도 보정이 서로 다른 특성을 가진다", () => {
    expect(getTerrainSpeedMultiplier("lake", 25)).toBe(1);
    expect(getTerrainSpeedMultiplier("hill", 20)).toBeLessThan(1);
    expect(getTerrainSpeedMultiplier("hill", 70)).toBeGreaterThan(1);
    expect(getTerrainSpeedMultiplier("forest", 25)).toBeLessThan(1);
    expect(getTerrainSpeedMultiplier("forest", 0)).toBe(1);
  });

  it("구간별 속도 변화로 같은 말의 이동폭이 계속 같지 않다", () => {
    const race = simulateRace({
      participantNames: createSampleParticipants(20),
      trackId: "lake",
      passStart: 1,
      passEnd: 5,
      seed: "pace-segments-test",
    });
    const samples = [8, 20, 34, 48, 68].map((time) => {
      const before = findFrame(race, time).racers[0].position;
      const after = findFrame(race, time + 1).racers[0].position;

      return Math.round((after - before) * 10) / 10;
    });

    expect(new Set(samples).size).toBeGreaterThan(1);
  });

  it("시뮬레이션은 지정 순위 범위 안의 참가자만 통과시킨다", () => {
    const race = simulateRace({
      participantNames: createSampleParticipants(180),
      trackId: "lake",
      passStart: 55,
      passEnd: 155,
      seed: "range-test",
    });

    expect(race.passers.length).toBeGreaterThan(0);
    expect(race.passers.length).toBeLessThanOrEqual(101);
    expect(race.lapCount).toBe(DEFAULT_LAP_COUNT);
    expect(race.totalDistance).toBe(TRACK_DISTANCE_PER_LAP);
    expect(race.frames).toHaveLength(
      RACE_DURATION_SECONDS * SIMULATION_FRAME_RATE + 1,
    );
    expect(
      race.passers.every((racer) => racer.rank >= 55 && racer.rank <= 155),
    ).toBe(true);
    expect(race.frames.at(-1)?.time).toBe(RACE_DURATION_SECONDS);
    expect(race.obstacleEvents).toHaveLength(0);
    expect(race.racerObstacleEvents).toHaveLength(180 * OBSTACLE_COUNT);
    expect(race.summary.obstaclesPerRacer).toBe(OBSTACLE_COUNT);
    expect(race.summary.skillTriggeredCount).toBeGreaterThanOrEqual(
      MIN_SKILL_TRIGGER_COUNT,
    );
    expect(race.helicopterStrikeEvents.length).toBeGreaterThanOrEqual(1);
    expect(race.helicopterStrikeEvents.length).toBeLessThanOrEqual(
      HELICOPTER_APPEARANCE_MAX_COUNT *
        HELICOPTER_ELIMINATIONS_PER_APPEARANCE_MAX_COUNT,
    );
    expect(race.summary.helicopterAppearanceCount).toBeGreaterThanOrEqual(
      HELICOPTER_APPEARANCE_MIN_COUNT,
    );
    expect(race.summary.helicopterAppearanceCount).toBeLessThanOrEqual(
      HELICOPTER_APPEARANCE_MAX_COUNT,
    );
    expect(race.summary.helicopterStrikeCount).toBe(
      race.helicopterStrikeEvents.length,
    );
    expect(race.ranking.filter((racer) => racer.eliminated)).toHaveLength(
      race.helicopterStrikeEvents.length,
    );
  });

  it("헬기가 떠있는 동안에는 프레임의 스킬 발동 표시를 잠근다", () => {
    const race = simulateRace({
      participantNames: createSampleParticipants(60),
      trackId: "lake",
      passStart: 1,
      passEnd: 10,
      seed: "helicopter-skill-lock-test",
    });
    const firstStrike = race.helicopterStrikeEvents[0];
    const frameDuringHelicopter = findFrame(race, firstStrike.time + 1);

    expect(firstStrike).toBeDefined();
    expect(
      frameDuringHelicopter.racers.every((racer) => !racer.skillActive),
    ).toBe(true);
  });

  it("선택한 코스 길이만큼 총거리를 늘리고 열린 코스 진행률을 고정한다", () => {
    const race = simulateRace({
      participantNames: createSampleParticipants(80),
      trackId: "lake",
      passStart: 1,
      passEnd: 10,
      lapCount: 3,
      seed: "lap-count-test",
    });

    expect(race.lapCount).toBe(3);
    expect(race.totalDistance).toBe(TRACK_DISTANCE_PER_LAP * 3);
    expect(race.ranking[0].distance).toBeGreaterThan(TRACK_DISTANCE_PER_LAP);
    expect(race.frames[0].racers.every((racer) => racer.progress < 1)).toBe(
      true,
    );
    expect(
      race.frames.every((frame) =>
        frame.racers.every(
          (racer) => racer.progress >= 0 && racer.progress <= 100,
        ),
      ),
    ).toBe(true);
    expect(
      race.frames.at(-1)?.racers.some((racer) => racer.progress > 45),
    ).toBe(true);
  });

  it("같은 시드는 같은 최종 순위를 만든다", () => {
    const options = {
      participantNames: createSampleParticipants(120),
      trackId: "forest" as const,
      passStart: 10,
      passEnd: 20,
      seed: "repeatable-seed",
    };
    const first = simulateRace(options);
    const second = simulateRace(options);

    expect(first.ranking.map((racer) => racer.id)).toEqual(
      second.ranking.map((racer) => racer.id),
    );
    expect(
      first.racerObstacleEvents.map((event) => ({
        racerId: event.racerId,
        time: event.time,
        trackProgress: event.trackProgress,
        laneIndex: event.laneIndex,
      })),
    ).toEqual(
      second.racerObstacleEvents.map((event) => ({
        racerId: event.racerId,
        time: event.time,
        trackProgress: event.trackProgress,
        laneIndex: event.laneIndex,
      })),
    );
    expect(
      first.helicopterStrikeEvents.map((event) => ({
        appearanceId: event.appearanceId,
        shotIndex: event.shotIndex,
        targetId: event.targetId,
        time: event.time,
        impactTime: event.impactTime,
        trackProgress: event.trackProgress,
        laneIndex: event.laneIndex,
      })),
    ).toEqual(
      second.helicopterStrikeEvents.map((event) => ({
        appearanceId: event.appearanceId,
        shotIndex: event.shotIndex,
        targetId: event.targetId,
        time: event.time,
        impactTime: event.impactTime,
        trackProgress: event.trackProgress,
        laneIndex: event.laneIndex,
      })),
    );
  });

  it("800명 레이스도 요구 규칙 범위 안에서 완료된다", () => {
    const race = simulateRace({
      participantNames: createSampleParticipants(800),
      trackId: "hill",
      passStart: 300,
      passEnd: 350,
      seed: "max-load",
    });

    expect(race.summary.participantCount).toBe(800);
    expect(race.ranking).toHaveLength(800);
    expect(race.passers).toHaveLength(51);
    expect(
      race.summary.obstaclePassCount + race.summary.obstacleFailCount,
    ).toBe(0);
    expect(race.summary.helicopterAppearanceCount).toBeGreaterThanOrEqual(
      HELICOPTER_APPEARANCE_MIN_COUNT,
    );
    expect(race.summary.helicopterAppearanceCount).toBeLessThanOrEqual(
      HELICOPTER_APPEARANCE_MAX_COUNT,
    );
    expect(race.summary.helicopterStrikeCount).toBeGreaterThanOrEqual(1);
    expect(race.summary.helicopterStrikeCount).toBeLessThanOrEqual(
      HELICOPTER_APPEARANCE_MAX_COUNT *
        HELICOPTER_ELIMINATIONS_PER_APPEARANCE_MAX_COUNT,
    );
  });
});
