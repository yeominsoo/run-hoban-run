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
      const samplePoints = [
        [0.5, 0.5],
        [0.5, 0.35],
        [0.5, 0.65],
        [0.35, 0.5],
        [0.65, 0.5]
      ];

      if (gl) {
        const sampleWidth = Math.min(64, gl.drawingBufferWidth);
        const sampleHeight = Math.min(64, gl.drawingBufferHeight);
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
      }

      const context = element.getContext('2d');

      if (!context) {
        return {
          width: rect.width,
          height: rect.height,
          nonBlankPixels: 0,
          colorVariance: 0
        };
      }

      const sampleWidth = Math.min(64, element.width);
      const sampleHeight = Math.min(64, element.height);

      let nonBlankPixels = 0;
      let colorVariance = 0;

      for (const [pointX, pointY] of samplePoints) {
        const x = Math.max(0, Math.floor(element.width * pointX - sampleWidth / 2));
        const y = Math.max(0, Math.floor(element.height * pointY - sampleHeight / 2));
        const pixels = context.getImageData(x, y, sampleWidth, sampleHeight).data;

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
  await expect(page.locator('#race-summary')).toContainText('헬기');
  await expect(page.locator('#camera-target')).toHaveCount(0);
  await expect(page.locator('#race-minimap')).toBeVisible();
  await expect(page.locator('.minimap-dot')).toHaveCount(18);
  await expect(page.locator('#leaderboard li')).toHaveCount(8);
  await expect(page.locator('#leaderboard')).toHaveAttribute('data-camera-mode', 'overview');
  await page.locator('#leaderboard li').nth(1).click();
  await expect(page.locator('#leaderboard li.selected')).toHaveCount(1);
  await expect(page.locator('#leaderboard')).toHaveAttribute('data-camera-mode', 'tracking');
  await expect(page.locator('.minimap-dot.selected')).toHaveCount(1);
  await page.locator('#leaderboard li.selected').click();
  await expect(page.locator('#leaderboard li.selected')).toHaveCount(0);
  await expect(page.locator('#leaderboard')).toHaveAttribute('data-camera-mode', 'overview');
  await expect(page.locator('.minimap-dot.selected')).toHaveCount(0);
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

test('updates field size max from the participant count', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#field-size')).toHaveAttribute('max', '18');
  await page.locator('#participants').fill(['1번주자', '2번주자', '3번주자', '4번주자', '5번주자', '6번주자'].join('\n'));
  await expect(page.locator('#field-size')).toHaveAttribute('max', '6');
  await expect(page.locator('#field-size')).toHaveValue('6');
  await expect(page.locator('#qualifiers')).toHaveAttribute('max', '5');
  await expect(page.locator('#winner-count')).toHaveAttribute('max', '6');
});

test('plays the frenzy cutscene with active vortex state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('#seed-input').fill('광폭빠름-00127');
  await page.locator('#start-tournament').click();

  await page.waitForFunction(() => document.querySelector('#race-stage')?.getAttribute('data-cinematic') === 'frenzy', undefined, {
    timeout: 35_000
  });

  await expect(page.locator('#race-stage')).toHaveAttribute('data-frenzy', 'active');
  await expect(page.locator('#leaderboard')).toHaveAttribute('data-camera-locked', 'true');
  await expect(page.locator('.runner-tag.skill')).toContainText('광폭 질주');
  await page.screenshot({
    path: 'test-results/frenzy-cutscene.png',
    fullPage: true
  });
});

test('plays delayed helicopter shots and leaves eliminated runners down on the track', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#race-title')).toHaveText('출발 대기');
  await page.locator('#start-tournament').click();
  await expect(page.locator('#race-summary')).toContainText('출격 x6');
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
  await expect(page.locator('#leaderboard')).toHaveAttribute('data-camera-locked', 'true');

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
