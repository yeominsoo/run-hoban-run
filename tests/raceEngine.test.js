import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PARTICIPANTS,
  OBSTACLE_COUNT,
  OBSTACLE_PASS_PROBABILITY,
  RACE_DURATION_SECONDS,
  SKILL_DURATION_SECONDS,
  SKILL_TRIGGER_PROBABILITY,
  TRACK_TYPES,
  createSampleParticipants,
  generateObstacleSchedule,
  normalizeParticipants,
  simulateRace
} from "../src/raceEngine.js";

test("핵심 규칙 상수가 요구사항과 일치한다", () => {
  assert.equal(MAX_PARTICIPANTS, 800);
  assert.equal(RACE_DURATION_SECONDS, 60);
  assert.equal(OBSTACLE_COUNT, 10);
  assert.equal(OBSTACLE_PASS_PROBABILITY, 0.49);
  assert.equal(SKILL_TRIGGER_PROBABILITY, 0.05);
  assert.equal(SKILL_DURATION_SECONDS, 10);
  assert.equal(TRACK_TYPES.length, 3);
});

test("참가자는 800명을 초과할 수 없다", () => {
  assert.throws(
    () => normalizeParticipants(createSampleParticipants(800).concat("초과 참가자")),
    /최대 800명/
  );
  assert.equal(normalizeParticipants(createSampleParticipants(800)).length, 800);
});

test("장애물 스케줄은 60초 안에 10개를 생성한다", () => {
  let index = 0;
  const values = [0, 0.1, 0.2, 0.25, 0.4, 0.35, 0.6, 0.45, 0.8, 0.55, 0.3, 0.65, 0.5, 0.75, 0.7, 0.85, 0.9, 0.95, 0.1, 0.05];
  const schedule = generateObstacleSchedule(() => values[index++ % values.length]);

  assert.equal(schedule.length, 10);
  assert.ok(schedule.every((event) => event.time >= 4 && event.time <= 56));
  assert.deepEqual(
    schedule.map((event) => event.time),
    schedule.map((event) => event.time).toSorted((a, b) => a - b)
  );
});

test("시뮬레이션은 지정 순위 범위 안의 참가자만 통과시킨다", () => {
  const race = simulateRace({
    participantNames: createSampleParticipants(180),
    trackId: "lake",
    passStart: 55,
    passEnd: 155,
    seed: "range-test"
  });

  assert.equal(race.passers.length, 101);
  assert.ok(race.passers.every((racer) => racer.rank >= 55 && racer.rank <= 155));
  assert.equal(race.frames.at(-1).time, 60);
  assert.equal(race.obstacleEvents.length, 10);
});

test("같은 시드는 같은 최종 순위를 만든다", () => {
  const options = {
    participantNames: createSampleParticipants(120),
    trackId: "forest",
    passStart: 10,
    passEnd: 20,
    seed: "repeatable-seed"
  };
  const first = simulateRace(options).ranking.map((racer) => racer.id);
  const second = simulateRace(options).ranking.map((racer) => racer.id);

  assert.deepEqual(first, second);
});

test("800명 레이스도 요구 규칙 범위 안에서 완료된다", () => {
  const race = simulateRace({
    participantNames: createSampleParticipants(800),
    trackId: "hill",
    passStart: 300,
    passEnd: 350,
    seed: "max-load"
  });

  assert.equal(race.summary.participantCount, 800);
  assert.equal(race.ranking.length, 800);
  assert.equal(race.passers.length, 51);
  assert.equal(race.summary.obstaclePassCount + race.summary.obstacleFailCount, 800 * 10);
});
