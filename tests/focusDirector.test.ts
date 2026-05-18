import { describe, expect, it } from "vitest";
import {
  MIN_CAMERA_FOCUS_SECONDS,
  chooseCameraFocus,
  createEmptyCameraFocus,
} from "../src/game/focusDirector";
import type { RankedFrameRacer } from "../src/game/raceEngine";

function racer(
  overrides: Partial<RankedFrameRacer> & Pick<RankedFrameRacer, "id" | "rank">,
): RankedFrameRacer {
  return {
    id: overrides.id,
    name: `참가자 ${overrides.id}`,
    rank: overrides.rank,
    position: overrides.position ?? 100,
    progress: overrides.progress ?? 10,
    skillActive: overrides.skillActive ?? false,
    slowed: overrides.slowed ?? false,
    eliminated: overrides.eliminated ?? false,
  };
}

describe("focus director", () => {
  it("특이 이벤트가 없으면 사용자가 선택한 경주마를 줌인한다", () => {
    const focus = chooseCameraFocus({
      racers: [racer({ id: 1, rank: 1 }), racer({ id: 2, rank: 2 })],
      selectedRacerId: 2,
      nowSeconds: 10,
      current: createEmptyCameraFocus(10),
    });

    expect(focus).toEqual({
      racerId: 2,
      reason: "selected",
      lockedUntil: 10 + MIN_CAMERA_FOCUS_SECONDS,
    });
  });

  it("스킬 발동 경주마보다 사용자가 선택한 경주마를 우선 줌인한다", () => {
    const focus = chooseCameraFocus({
      racers: [
        racer({ id: 1, rank: 1 }),
        racer({ id: 2, rank: 2, skillActive: true }),
      ],
      selectedRacerId: 1,
      nowSeconds: 14,
      current: createEmptyCameraFocus(14),
    });

    expect(focus.racerId).toBe(1);
    expect(focus.reason).toBe("selected");
  });

  it("더 높은 우선순위 대상이 생겨도 실제 시간 기준 최소 줌인 시간을 유지한다", () => {
    const current = chooseCameraFocus({
      racers: [racer({ id: 1, rank: 1 }), racer({ id: 2, rank: 2 })],
      selectedRacerId: 1,
      nowSeconds: 20,
      current: createEmptyCameraFocus(20),
    });

    const stillLocked = chooseCameraFocus({
      racers: [
        racer({ id: 1, rank: 1 }),
        racer({ id: 2, rank: 2, skillActive: true }),
      ],
      selectedRacerId: 1,
      nowSeconds: 20 + MIN_CAMERA_FOCUS_SECONDS - 0.1,
      current,
    });

    expect(stillLocked).toBe(current);
    expect(stillLocked.racerId).toBe(1);
    expect(stillLocked.reason).toBe("selected");
  });

  it("배속 재생으로 스킬 프레임이 빨리 사라져도 줌인 잠금은 실제 시간 기준으로 남는다", () => {
    const skillFocus = chooseCameraFocus({
      racers: [
        racer({ id: 1, rank: 1 }),
        racer({ id: 2, rank: 2, skillActive: true }),
      ],
      selectedRacerId: null,
      nowSeconds: 40,
      current: createEmptyCameraFocus(40),
    });

    const stillFocused = chooseCameraFocus({
      racers: [racer({ id: 1, rank: 1 }), racer({ id: 2, rank: 2 })],
      selectedRacerId: null,
      nowSeconds: 41,
      current: skillFocus,
    });

    expect(stillFocused).toBe(skillFocus);
    expect(stillFocused.racerId).toBe(2);
    expect(stillFocused.lockedUntil).toBe(40 + MIN_CAMERA_FOCUS_SECONDS);
  });

  it("스킬 이벤트가 끝나고 잠금 시간이 지나면 다음 선택 대상으로 전환한다", () => {
    const skillFocus = chooseCameraFocus({
      racers: [
        racer({ id: 1, rank: 1 }),
        racer({ id: 2, rank: 2, skillActive: true }),
      ],
      selectedRacerId: null,
      nowSeconds: 30,
      current: createEmptyCameraFocus(30),
    });

    const nextFocus = chooseCameraFocus({
      racers: [racer({ id: 1, rank: 1 }), racer({ id: 2, rank: 2 })],
      selectedRacerId: 1,
      nowSeconds: 30 + MIN_CAMERA_FOCUS_SECONDS + 0.1,
      current: skillFocus,
    });

    expect(nextFocus.racerId).toBe(1);
    expect(nextFocus.reason).toBe("selected");
    expect(nextFocus.lockedUntil).toBe(30 + MIN_CAMERA_FOCUS_SECONDS * 2 + 0.1);
  });
});
