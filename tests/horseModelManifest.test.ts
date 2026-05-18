import { describe, expect, test } from "vitest";
import {
  QUATERNIUS_HORSE_MODEL,
  type HorseAnimationKey,
} from "../src/game/horseModelManifest";

describe("horse model manifest", () => {
  test("points at the CC0 rigged horse source asset", () => {
    expect(QUATERNIUS_HORSE_MODEL.license).toBe("CC0-1.0");
    expect(QUATERNIUS_HORSE_MODEL.sourcePage).toContain("poly.pizza");
    expect(QUATERNIUS_HORSE_MODEL.url).toBe(QUATERNIUS_HORSE_MODEL.sourceModel);
    expect(QUATERNIUS_HORSE_MODEL.url).toMatch(
      /^https:\/\/static\.poly\.pizza\/.+\.glb$/,
    );
  });

  test("maps every game animation state to a named GLB clip", () => {
    const requiredStates: HorseAnimationKey[] = [
      "idle",
      "walk",
      "gallop",
      "jump",
      "brake",
    ];

    requiredStates.forEach((state) => {
      const clip = QUATERNIUS_HORSE_MODEL.clips[state];

      expect(clip).toEqual(expect.any(String));
      expect(clip.length).toBeGreaterThan(2);
    });
  });
});
