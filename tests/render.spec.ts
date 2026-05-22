import { expect, test } from '@playwright/test';

const viewports = [
  { name: 'desktop', size: { width: 1440, height: 900 } },
  { name: 'mobile', size: { width: 390, height: 844 } }
];

for (const viewport of viewports) {
  test(`renders a nonblank 3d race scene on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport.size);
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('달려라 호반');

    const canvas = page.locator('#race-canvas');
    await expect(canvas).toBeVisible();

    const readCanvasSample = () => canvas.evaluate((element: HTMLCanvasElement) => {
      const rect = element.getBoundingClientRect();
      const gl = element.getContext('webgl2') ?? element.getContext('webgl');

      if (!gl) {
        return {
          width: rect.width,
          height: rect.height,
          nonBlankPixels: 0,
          colorVariance: 0
        };
      }

      const sampleWidth = Math.min(64, gl.drawingBufferWidth);
      const sampleHeight = Math.min(64, gl.drawingBufferHeight);
      const samplePoints = [
        [0.5, 0.5],
        [0.5, 0.35],
        [0.5, 0.65],
        [0.35, 0.5],
        [0.65, 0.5]
      ];

      let nonBlankPixels = 0;
      let colorVariance = 0;

      for (const [pointX, pointY] of samplePoints) {
        const x = Math.max(0, Math.floor(gl.drawingBufferWidth * pointX - sampleWidth / 2));
        const y = Math.max(0, Math.floor(gl.drawingBufferHeight * pointY - sampleHeight / 2));
        const pixels = new Uint8Array(sampleWidth * sampleHeight * 4);
        gl.readPixels(x, y, sampleWidth, sampleHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        for (let index = 0; index < pixels.length; index += 4) {
          const red = pixels[index];
          const green = pixels[index + 1];
          const blue = pixels[index + 2];
          const alpha = pixels[index + 3];

          if (alpha > 0 && (red < 246 || green < 246 || blue < 246)) {
            nonBlankPixels += 1;
          }

          colorVariance += Math.abs(red - green) + Math.abs(green - blue) + Math.abs(red - blue);
        }
      }

      return {
        width: rect.width,
        height: rect.height,
        nonBlankPixels,
        colorVariance
      };
    });

    await expect.poll(async () => (await readCanvasSample()).nonBlankPixels, {
      timeout: 5_000
    }).toBeGreaterThan(500);

    const sample = await readCanvasSample();
    expect(sample.width).toBeGreaterThan(300);
    expect(sample.height).toBeGreaterThan(500);
    expect(sample.nonBlankPixels).toBeGreaterThan(500);
    expect(sample.colorVariance).toBeGreaterThan(20_000);

    await page.screenshot({
      path: `test-results/render-${viewport.name}.png`,
      fullPage: true
    });
  });
}

test('starts a 64 runner tournament and advances to the final race', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#race-stage')).not.toHaveClass(/panels-hidden/);
  await expect(page.locator('#race-title')).toHaveText('출발 대기');
  await expect(page.locator('#race-summary')).toContainText('20구간');
  await expect(page.locator('#camera-target')).toHaveValue('leader');
  await expect(page.locator('#camera-target option')).toHaveCount(19);
  const cameraTargetValue = await page.locator('#camera-target option').nth(2).getAttribute('value');
  expect(cameraTargetValue).toBeTruthy();
  await page.locator('#camera-target').selectOption(cameraTargetValue ?? 'leader');
  await expect(page.locator('#camera-target')).toHaveValue(cameraTargetValue ?? 'leader');
  const previousSeed = await page.locator('#seed-input').inputValue();
  await page.locator('#random-seed').click();
  await expect(page.locator('#seed-input')).not.toHaveValue(previousSeed);
  await page.locator('#sample-64').click();
  await expect(page.locator('#race-title')).toHaveText('출발 대기');
  await page.locator('#start-tournament').click();
  await expect(page.locator('#race-stage')).toHaveClass(/panels-hidden/);
  await expect(page.locator('#race-summary')).toContainText('64명');
  await expect(page.locator('#race-meta')).toContainText('경기 1/5');

  for (let index = 0; index < 4; index += 1) {
    await page.locator('#next-race').click();
  }

  await expect(page.locator('#race-title')).toHaveText('결승전');
  await expect(page.locator('#race-meta')).toContainText('경기 5/5');
});

test('plays delayed helicopter shots and leaves eliminated runners down on the track', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#race-title')).toHaveText('출발 대기');
  await page.locator('#start-tournament').click();
  await expect(page.locator('#race-summary')).toContainText('출격 x6');
  await expect(page.locator('#race-summary')).toContainText('20구간');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-cinematic', 'idle');

  await page.waitForFunction(() => {
    return document.querySelector('#race-stage')?.getAttribute('data-cinematic') === 'approach';
  }, undefined, { timeout: 75_000 });

  await page.evaluate(() => {
      const testWindow = window as typeof window & {
        __cinematicIdleAfterApproach?: boolean;
        __cinematicIdleWatch?: number;
    };
    testWindow.__cinematicIdleAfterApproach = false;
    testWindow.__cinematicIdleWatch = window.setInterval(() => {
      const eliminatedCount = document.querySelectorAll('.runner-tag.eliminated').length;
      const state = document.querySelector('#race-stage')?.getAttribute('data-cinematic');

      if (eliminatedCount >= 6) {
        if (testWindow.__cinematicIdleWatch !== undefined) {
          window.clearInterval(testWindow.__cinematicIdleWatch);
        }
        return;
      }

      if (state === 'idle') {
        testWindow.__cinematicIdleAfterApproach = true;
      }
    }, 120);
  });

  await page.waitForFunction(() => {
    const stage = document.querySelector('#race-stage');
    return stage?.getAttribute('data-cinematic') === 'shot' || stage?.getAttribute('data-cinematic') === 'hit';
  }, undefined, { timeout: 95_000 });
  await expect(page.locator('#camera-target')).toBeDisabled();

  await expect(page.locator('.runner-tag.eliminated').first()).toBeVisible({ timeout: 12_000 });

  await expect.poll(async () => page.locator('.runner-tag.eliminated').count(), {
    timeout: 120_000
  }).toBeGreaterThanOrEqual(6);

  await expect(page.evaluate(() => Boolean((window as typeof window & { __cinematicIdleAfterApproach?: boolean }).__cinematicIdleAfterApproach))).resolves.toBe(
    false
  );

  await page.waitForFunction(() => {
    const stage = document.querySelector('#race-stage');
    return stage?.getAttribute('data-cinematic') !== 'shot' && stage?.getAttribute('data-cinematic') !== 'hit';
  }, undefined, { timeout: 6_000 });

  await expect(page.locator('.runner-tag.eliminated').first()).toBeVisible();
  await page.screenshot({
    path: 'test-results/helicopter-elimination.png',
    fullPage: true
  });
});
