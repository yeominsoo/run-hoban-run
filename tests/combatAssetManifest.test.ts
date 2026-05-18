import { describe, expect, it } from "vitest";
import {
  HELICOPTER_MODEL,
  SNIPER_RIFLE_MODEL,
} from "../src/game/combatAssetManifest";

describe("combat asset manifest", () => {
  it("헬기와 장비 GLB 애셋을 오픈소스 원본 URL로 제공한다", () => {
    const assets = [HELICOPTER_MODEL, SNIPER_RIFLE_MODEL];

    assets.forEach((asset) => {
      expect(asset.url).toBe(asset.sourceModel);
      expect(asset.url).toMatch(/^https:\/\/static\.poly\.pizza\/.+\.glb$/);
      expect(asset.sourcePage).toMatch(/^https:\/\//);
      expect(asset.scale).toBeGreaterThan(0);
    });
  });

  it("저작권 표기를 런타임 매니페스트에 보존한다", () => {
    expect(HELICOPTER_MODEL.license).toBe("CC-BY-3.0");
    expect(HELICOPTER_MODEL.author).toBeTruthy();
    expect(SNIPER_RIFLE_MODEL.license).toBe("CC0-1.0");
    expect(SNIPER_RIFLE_MODEL.author).toBeTruthy();
  });
});
