import { expect, test } from "@playwright/test";
import type { ConsoleMessage, Page } from "@playwright/test";

test.describe("race scene", () => {
  test.setTimeout(95_000);

  test("maps render clean live canvases without excessive dark artifacts", async ({
    page,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    const horseModelResponse = page.waitForResponse(
      (response) =>
        response.url().includes("d37dbc87-ca61-4b2c-a2da-d2f0c4240bef.glb") &&
        [200, 304].includes(response.status()),
    );
    const helicopterModelResponse = page.waitForResponse(
      (response) =>
        response.url().includes("a57d2f32-b663-41ce-9d4a-c7f99fe5df08.glb") &&
        [200, 304].includes(response.status()),
    );

    await page.goto("/");
    await Promise.all([horseModelResponse, helicopterModelResponse]);
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.locator('[aria-label="현재 경주 그룹"]')).toContainText(
      /그룹 1\/\d+/,
    );
    await expect(page.locator(".racer-billboard")).toHaveCount(10);

    await page.getByRole("button", { name: "설정" }).click();
    const speedOptions = page.getByRole("group", { name: "재생 속도" });
    await expect(
      speedOptions.getByRole("button", { name: "1x" }),
    ).toBeVisible();
    await expect(
      speedOptions.getByRole("button", { name: "2x" }),
    ).toBeVisible();
    await expect(
      speedOptions.getByRole("button", { name: "4x" }),
    ).toBeVisible();
    await expect(speedOptions.getByRole("button", { name: "20x" })).toHaveCount(
      0,
    );

    const trackNames = ["호수 리본 코스", "언덕 스퍼트 코스", "숲길 절벽 코스"];

    for (const [index, trackName] of trackNames.entries()) {
      if (index > 0) {
        await page.getByRole("button", { name: "설정" }).click();
      }

      await page.getByRole("button", { name: new RegExp(trackName) }).click();
      await page.getByRole("button", { name: "설정 닫기" }).click();
      await expect(
        page.getByRole("heading", { name: trackName }),
      ).toBeVisible();

      const stats = await sampleCanvas(page);

      expect(stats.width).toBeGreaterThan(300);
      expect(stats.height).toBeGreaterThan(250);
      expect(stats.uniqueBuckets).toBeGreaterThan(48);
      expect(stats.changedRatio).toBeGreaterThan(0.3);
      expect(stats.nearBlackRatio).toBeLessThan(0.006);
      expect(stats.veryDarkRatio).toBeLessThan(0.0025);
    }

    expect(consoleErrors).toEqual([]);
  });

  test("race can start on the strict 5174 server", async ({ page }) => {
    await page.goto("/");
    await configureTwentyParticipantRace(page);
    await page.getByRole("button", { name: "레이스 시작" }).click();

    await expect(page.getByLabel("레이스 시작 연출")).toContainText(
      "게임준비!",
    );
    await expect(page.getByLabel("레이스 시작 연출")).toContainText("1/20");
    await expect(page.getByLabel("레이스 시작 연출")).toContainText("2/20", {
      timeout: 3_000,
    });
    await expect(page.getByLabel("레이스 시작 연출")).toContainText("3/20", {
      timeout: 3_000,
    });
    await expect(
      page.getByLabel("레이스 시작 연출").locator("strong"),
    ).toHaveText("출발!", { timeout: 65_000 });
    await expect(page.getByRole("button", { name: "메뉴" })).toBeVisible();

    const firstBillboard = page.locator('.racer-billboard[data-racer-id="1"]');
    const beforeProgress = Number(
      await firstBillboard.getAttribute("data-progress"),
    );
    await page.waitForTimeout(1_600);
    const afterProgress = Number(
      await firstBillboard.getAttribute("data-progress"),
    );

    expect(afterProgress).toBeGreaterThan(beforeProgress);

    await expect(page.getByText(/누굴 맞출까/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".helicopter-cue").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".strike-marker").first()).toBeVisible();
    await expect(
      page.locator(".obstacle-marker.is-hot, .obstacle-marker.is-done"),
    ).toHaveCount(0);
    await expect(page.locator(".track-leader-list li").first()).toBeVisible();
  });
});

async function configureTwentyParticipantRace(page: Page) {
  await page.getByRole("button", { name: "설정" }).click();
  await page.locator("#participantInput").fill(
    Array.from({ length: 20 }, (_, index) => {
      return `참가자 ${String(index + 1).padStart(3, "0")}`;
    }).join("\n"),
  );
  await page.getByLabel("통과 시작").fill("1");
  await page.getByLabel("통과 종료").fill("10");
  await page.getByRole("button", { name: "20마리" }).click();
  await page
    .getByLabel("설정 패널")
    .getByRole("button", { name: "규칙 갱신" })
    .click();
}

function collectConsoleErrors(page: Page): string[] {
  const consoleErrors: string[] = [];

  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  return consoleErrors;
}

async function sampleCanvas(page: Page) {
  await page.waitForTimeout(900);

  return page.locator("canvas").evaluate((canvas) => {
    const source = canvas as HTMLCanvasElement;
    const width = Math.min(360, source.width);
    const height = Math.min(240, source.height);
    const scratch = document.createElement("canvas");
    scratch.width = width;
    scratch.height = height;
    const context = scratch.getContext("2d");

    if (!context) {
      throw new Error("2d canvas context is unavailable");
    }

    context.drawImage(source, 0, 0, width, height);

    const data = context.getImageData(0, 0, width, height).data;
    const first = [data[0], data[1], data[2]];
    const buckets = new Set<string>();
    let changed = 0;
    let sampled = 0;
    let nearBlack = 0;
    let veryDark = 0;

    for (let index = 0; index < data.length; index += 4 * 8) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const delta =
        Math.abs(red - first[0]) +
        Math.abs(green - first[1]) +
        Math.abs(blue - first[2]);

      buckets.add(
        `${Math.floor(red / 16)}-${Math.floor(green / 16)}-${Math.floor(blue / 16)}`,
      );

      if (delta > 24) {
        changed += 1;
      }

      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;

      if (luminance < 35) {
        nearBlack += 1;
      }

      if (luminance < 18) {
        veryDark += 1;
      }

      sampled += 1;
    }

    return {
      width: source.clientWidth,
      height: source.clientHeight,
      uniqueBuckets: buckets.size,
      changedRatio: sampled === 0 ? 0 : changed / sampled,
      nearBlackRatio: sampled === 0 ? 0 : nearBlack / sampled,
      veryDarkRatio: sampled === 0 ? 0 : veryDark / sampled,
    };
  });
}
