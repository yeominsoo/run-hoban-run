import { stat } from 'node:fs/promises';
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

test('uses a single generated helicopter model without loading the GLB asset', async ({ page }) => {
  const modelRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    const viteUrlImportProbe = url.searchParams.has('import') || url.searchParams.has('url');

    if (/freepixel-helicopter.*\.glb$/.test(url.pathname) && !viteUrlImportProbe) {
      modelRequests.push(url.pathname);
    }
  });

  await page.goto('/');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-helicopter-asset', 'generated');
  await page.locator('#start-tournament').click();
  await expect(page.locator('#race-stage')).toHaveAttribute('data-helicopter-asset', 'generated');

  const assetUrl = await page.locator('#race-stage').getAttribute('data-helicopter-asset-url');
  expect(assetUrl).toBe('generated');
  expect(modelRequests).toEqual([]);
});

test('serves the frenzy particle texture assets', async ({ page }) => {
  for (const path of [
    '/assets/frenzy/blackSmoke07.png',
    '/assets/frenzy/blackSmoke14.png',
    '/assets/frenzy/whitePuff08.png',
    '/assets/frenzy/whitePuff16.png'
  ]) {
    const response = await page.request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');
    expect((await response.body()).byteLength).toBeGreaterThan(50_000);
  }
});

test('keeps initial runtime asset requests local', async ({ page }) => {
  const externalRequests: string[] = [];
  const deferredAssetRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());

    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      externalRequests.push(request.url());
    }

    const viteUrlImportProbe = url.searchParams.has('import') || url.searchParams.has('url');

    if ((/freepixel-helicopter.*\.glb$/.test(url.pathname) && !viteUrlImportProbe) || url.pathname.includes('/assets/frenzy/')) {
      deferredAssetRequests.push(url.pathname);
    }
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  expect(externalRequests).toEqual([]);
  expect(deferredAssetRequests).toEqual([]);
});

test('keeps performance graphics on generated assets during race start', async ({ page }) => {
  const deferredAssetRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    const viteUrlImportProbe = url.searchParams.has('import') || url.searchParams.has('url');

    if ((/freepixel-helicopter.*\.glb$/.test(url.pathname) && !viteUrlImportProbe) || url.pathname.includes('/assets/frenzy/')) {
      deferredAssetRequests.push(url.pathname);
    }
  });

  await page.goto('/');
  await page.locator('#graphics-select').selectOption('performance');
  await page.locator('#start-tournament').click();
  await expect(page.locator('#race-stage')).toHaveAttribute('data-graphics-quality', 'performance');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-helicopter-asset', 'generated');
  await page.waitForTimeout(3000);

  expect(deferredAssetRequests).toEqual([]);
});

test('downloads a composited result screenshot', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#download-result-shot')).toBeVisible();
  await page.locator('#start-tournament').click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.runner-tag')].some(
      (element) => element.textContent?.trim() && Number(window.getComputedStyle(element).opacity) > 0.03
    )
  );

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download-result-shot').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^run-hoban-run-.*-result-.*\.png$/);
  expect(Number(await page.locator('#race-stage').getAttribute('data-last-screenshot-runner-labels'))).toBeGreaterThan(0);

  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();

  if (downloadPath) {
    expect((await stat(downloadPath)).size).toBeGreaterThan(20_000);
  }
});

test('records the race canvas to a downloadable video', async ({ page }) => {
  await page.goto('/');
  const supported = await page.evaluate(() => {
    return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  });

  test.skip(!supported, 'MediaRecorder canvas capture is not available in this browser');
  await expect(page.locator('#toggle-recording')).toBeEnabled();
  await page.locator('#start-tournament').click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.runner-tag')].some(
      (element) => element.textContent?.trim() && Number(window.getComputedStyle(element).opacity) > 0.03
    )
  );

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#toggle-recording').click();
  await expect(page.locator('#race-stage')).toHaveAttribute('data-recording', 'active');
  await expect
    .poll(async () => Number((await page.locator('#race-stage').getAttribute('data-recording-runner-labels')) ?? 0), {
      timeout: 5_000
    })
    .toBeGreaterThan(0);
  await page.waitForTimeout(1200);
  await page.locator('#toggle-recording').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^run-hoban-run-.*-race-capture-.*\.(webm|mp4)$/);
  await expect(page.locator('#race-stage')).toHaveAttribute('data-recording', 'idle');

  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();

  if (downloadPath) {
    expect((await stat(downloadPath)).size).toBeGreaterThan(1_000);
  }
});

test('shows an immediate loading state before the app bundle is ready', async ({ page }) => {
  const response = await page.request.get('/');
  const html = (await response.text()).replace(/<script\s+type="module"[^>]*><\/script>/, '');

  await page.setContent(html);
  await expect(page.locator('#boot-loader')).toBeVisible();
  await expect(page.locator('#boot-status')).toContainText('로딩');

  await page.goto('/');
  await expect(page.locator('#boot-loader')).toBeHidden({ timeout: 6_000 });
});

test('starts a 64 runner tournament and advances to the final race', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#race-stage')).not.toHaveClass(/panels-hidden/);
  await expect(page.locator('#race-title')).toHaveText('출발 대기');
  await expect(page.locator('#race-summary')).toContainText('헬기');
  await expect(page.locator('#camera-target')).toHaveCount(0);
  await expect(page.locator('#race-minimap')).toBeHidden();
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
  await expect(page.locator('#race-minimap')).toBeVisible();
  await expect(page.locator('#race-summary')).toContainText('64명');
  await expect(page.locator('#race-meta')).toContainText('경기 1/5');
  await expect(page.locator('#leaderboard')).not.toContainText(/% 지점/);

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

test('restores the recently edited participant list', async ({ page }) => {
  const recentParticipants = ['민수', '지수', '태오', '서윤'].join('\n');

  await page.goto('/');
  await page.locator('#participants').fill(recentParticipants);
  await expect(page.locator('#field-size')).toHaveAttribute('max', '4');

  await page.reload();
  await expect(page.locator('#participants')).toHaveValue(recentParticipants);
  await expect(page.locator('#field-size')).toHaveAttribute('max', '4');
});

test('keeps mobile minimap clear of the leaderboard and supports wheel zoom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#start-tournament').click();

  const minimap = page.locator('#race-minimap');
  const leaderboard = page.locator('#leaderboard');

  await expect(minimap).toBeVisible();
  await expect(leaderboard).toHaveAttribute('data-camera-mode', 'overview');
  await expect(leaderboard).toHaveAttribute('data-camera-zoom', '1.00');

  const gap = await page.evaluate(() => {
    const minimapBox = document.querySelector('#race-minimap')?.getBoundingClientRect();
    const leaderboardBox = document.querySelector('#leaderboard')?.getBoundingClientRect();
    return minimapBox && leaderboardBox
      ? {
          minimapToLeaderboard: leaderboardBox.top - minimapBox.bottom,
          leaderboardBottomSpace: window.innerHeight - leaderboardBox.bottom
        }
      : null;
  });

  expect(gap?.minimapToLeaderboard).toBeGreaterThan(260);
  expect(gap?.leaderboardBottomSpace).toBeGreaterThan(52);

  await page.mouse.move(196, 420);
  await page.mouse.wheel(0, 320);
  await expect(leaderboard).toHaveAttribute('data-camera-zoom', '0.92');
  await page.mouse.wheel(0, -320);
  await expect(leaderboard).toHaveAttribute('data-camera-zoom', '1.00');
});

test('keeps the mobile helicopter entrance and leaderboard in frame', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#start-tournament').click();

  await page.waitForFunction(() => document.querySelector('#race-stage')?.getAttribute('data-cinematic') === 'approach', undefined, {
    timeout: 75_000
  });

  await page.waitForFunction(() => {
    const stage = document.querySelector('#race-stage');
    const x = Number(stage?.getAttribute('data-helicopter-screen-x'));
    const y = Number(stage?.getAttribute('data-helicopter-screen-y'));
    const left = Number(stage?.getAttribute('data-helicopter-box-left'));
    const right = Number(stage?.getAttribute('data-helicopter-box-right'));
    const top = Number(stage?.getAttribute('data-helicopter-box-top'));
    const bottom = Number(stage?.getAttribute('data-helicopter-box-bottom'));
    const width = Number(stage?.getAttribute('data-helicopter-box-width'));
    const distance = Number(stage?.getAttribute('data-helicopter-camera-distance'));
    const mainRotorClearance = Number(stage?.getAttribute('data-helicopter-main-rotor-clearance'));
    const tailRotorGap = Number(stage?.getAttribute('data-helicopter-tail-rotor-gap'));
    const generatedRootCount = Number(stage?.getAttribute('data-helicopter-generated-root-count'));
    const mainRotorCount = Number(stage?.getAttribute('data-helicopter-main-rotor-count'));
    const tailRotorCount = Number(stage?.getAttribute('data-helicopter-tail-rotor-count'));
    const staticRotorBladeCount = Number(stage?.getAttribute('data-helicopter-static-rotor-blade-count'));
    const muzzleLocalX = Number(stage?.getAttribute('data-helicopter-muzzle-local-x'));
    const noseTargetBias = Number(stage?.getAttribute('data-helicopter-nose-target-bias'));
    return (
      stage?.getAttribute('data-cinematic') === 'approach' &&
      stage?.getAttribute('data-helicopter-model-clean') === 'true' &&
      stage?.getAttribute('data-helicopter-shot-origin') === 'nose' &&
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(left) &&
      Number.isFinite(right) &&
      Number.isFinite(top) &&
      Number.isFinite(bottom) &&
      Number.isFinite(width) &&
      Number.isFinite(distance) &&
      Number.isFinite(mainRotorClearance) &&
      Number.isFinite(tailRotorGap) &&
      generatedRootCount === 1 &&
      mainRotorCount === 1 &&
      tailRotorCount === 1 &&
      staticRotorBladeCount === 0 &&
      Number.isFinite(muzzleLocalX) &&
      Number.isFinite(noseTargetBias) &&
      x > 0.43 &&
      x < 0.57 &&
      y > 0.3 &&
      y < 0.58 &&
      left > 0.04 &&
      right < 0.96 &&
      top > 0.08 &&
      bottom < 0.78 &&
      width > 0.2 &&
      distance > 18 &&
      distance < 28 &&
      mainRotorClearance > 0.55 &&
      tailRotorGap < 0.18 &&
      muzzleLocalX > 1.25 &&
      noseTargetBias > 0.2
    );
  }, undefined, { timeout: 8_000 });

  const frame = await page.evaluate(() => {
    const stage = document.querySelector('#race-stage');
    const leaderboardBox = document.querySelector('#leaderboard')?.getBoundingClientRect();
    return {
      helicopterInFrame: stage?.getAttribute('data-helicopter-in-frame'),
      helicopterScreenX: Number(stage?.getAttribute('data-helicopter-screen-x')),
      helicopterScreenY: Number(stage?.getAttribute('data-helicopter-screen-y')),
      helicopterBoxLeft: Number(stage?.getAttribute('data-helicopter-box-left')),
      helicopterBoxRight: Number(stage?.getAttribute('data-helicopter-box-right')),
      helicopterBoxTop: Number(stage?.getAttribute('data-helicopter-box-top')),
      helicopterBoxBottom: Number(stage?.getAttribute('data-helicopter-box-bottom')),
      helicopterBoxWidth: Number(stage?.getAttribute('data-helicopter-box-width')),
      helicopterCameraDistance: Number(stage?.getAttribute('data-helicopter-camera-distance')),
      helicopterModelClean: stage?.getAttribute('data-helicopter-model-clean'),
      helicopterShotOrigin: stage?.getAttribute('data-helicopter-shot-origin'),
      helicopterMainRotorClearance: Number(stage?.getAttribute('data-helicopter-main-rotor-clearance')),
      helicopterTailRotorGap: Number(stage?.getAttribute('data-helicopter-tail-rotor-gap')),
      helicopterGeneratedRootCount: Number(stage?.getAttribute('data-helicopter-generated-root-count')),
      helicopterMainRotorCount: Number(stage?.getAttribute('data-helicopter-main-rotor-count')),
      helicopterTailRotorCount: Number(stage?.getAttribute('data-helicopter-tail-rotor-count')),
      helicopterStaticRotorBladeCount: Number(stage?.getAttribute('data-helicopter-static-rotor-blade-count')),
      helicopterMuzzleLocalX: Number(stage?.getAttribute('data-helicopter-muzzle-local-x')),
      helicopterNoseTargetBias: Number(stage?.getAttribute('data-helicopter-nose-target-bias')),
      leaderboardBottomSpace: leaderboardBox ? window.innerHeight - leaderboardBox.bottom : -1
    };
  });

  expect(frame.helicopterModelClean).toBe('true');
  expect(frame.helicopterShotOrigin).toBe('nose');
  expect(frame.helicopterScreenX).toBeGreaterThan(0.43);
  expect(frame.helicopterScreenX).toBeLessThan(0.57);
  expect(frame.helicopterScreenY).toBeGreaterThan(0.3);
  expect(frame.helicopterScreenY).toBeLessThan(0.58);
  expect(frame.helicopterBoxLeft).toBeGreaterThan(0.04);
  expect(frame.helicopterBoxRight).toBeLessThan(0.96);
  expect(frame.helicopterBoxTop).toBeGreaterThan(0.08);
  expect(frame.helicopterBoxBottom).toBeLessThan(0.78);
  expect(frame.helicopterBoxWidth).toBeGreaterThan(0.2);
  expect(frame.helicopterCameraDistance).toBeGreaterThan(18);
  expect(frame.helicopterCameraDistance).toBeLessThan(28);
  expect(frame.helicopterMainRotorClearance).toBeGreaterThan(0.55);
  expect(frame.helicopterTailRotorGap).toBeLessThan(0.18);
  expect(frame.helicopterGeneratedRootCount).toBe(1);
  expect(frame.helicopterMainRotorCount).toBe(1);
  expect(frame.helicopterTailRotorCount).toBe(1);
  expect(frame.helicopterStaticRotorBladeCount).toBe(0);
  expect(frame.helicopterMuzzleLocalX).toBeGreaterThan(1.25);
  expect(frame.helicopterNoseTargetBias).toBeGreaterThan(0.2);
  expect(frame.leaderboardBottomSpace).toBeGreaterThan(52);

  await page.screenshot({
    path: 'test-results/mobile-helicopter-approach.png',
    fullPage: true
  });
});

test('plays the frenzy cutscene with active vortex state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('#seed-input').fill('광폭빠름-00001');
  await page.locator('#start-tournament').click();

  await page.waitForFunction(
    () =>
      document.querySelector('#race-stage')?.getAttribute('data-cinematic') === 'frenzy' &&
      document.querySelector('#race-stage')?.getAttribute('data-frenzy') === 'active' &&
      document.querySelector('#race-stage')?.getAttribute('data-frenzy-vortex') === 'active' &&
      document.querySelector('#race-stage')?.getAttribute('data-frenzy-spin') === 'active' &&
      document.querySelector('#race-stage')?.getAttribute('data-mirror-ball') === 'idle' &&
      [...document.querySelectorAll('.runner-tag.skill')].some((element) => element.textContent?.includes('광폭 질주')),
    undefined,
    { timeout: 35_000 }
  );

  await expect(page.locator('#race-stage')).toHaveAttribute('data-frenzy', 'active');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-frenzy-vortex', 'active');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-frenzy-spin', 'active');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-mirror-ball', 'idle');
  await expect(page.locator('#leaderboard')).toHaveAttribute('data-camera-locked', 'true');
  await page.screenshot({
    path: 'test-results/frenzy-cutscene.png',
    fullPage: true
  });
});

test('plays dance skills with the frenzy mode effect active', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('#seed-input').fill('댄스광폭-0113');
  await page.locator('#start-tournament').click();

  await page.waitForFunction(
    () =>
      document.querySelector('#race-stage')?.getAttribute('data-cinematic') === 'frenzy' &&
      document.querySelector('#race-stage')?.getAttribute('data-frenzy-vortex') === 'idle' &&
      document.querySelector('#race-stage')?.getAttribute('data-frenzy-spin') === 'idle' &&
      document.querySelector('#race-stage')?.getAttribute('data-mirror-ball') === 'active' &&
      document.querySelector('#race-stage')?.getAttribute('data-flat-glide') === 'idle' &&
      [...document.querySelectorAll('.runner-tag.skill')].some((element) => element.textContent?.includes('코너 댄스')),
    undefined,
    { timeout: 40_000 }
  );

  await expect(page.locator('#race-stage')).toHaveAttribute('data-frenzy', 'active');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-frenzy-vortex', 'idle');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-frenzy-spin', 'idle');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-mirror-ball', 'active');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-flat-glide', 'idle');
  await expect(page.locator('.runner-tag.skill').filter({ hasText: '코너 댄스' })).toBeVisible();
  await page.screenshot({
    path: 'test-results/dance-mirrorball-cutscene.png',
    fullPage: true
  });
});

test('plays lie-flat skills with the frenzy mode speed effect active', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('#participants').fill(['혜성', '민트', '번개', '남색', '장미', '재빛'].join('\n'));
  await page.locator('#seed-input').fill('flat-six-00002');
  await page.locator('#start-tournament').click();

  await page.waitForFunction(
    () =>
      document.querySelector('#race-stage')?.getAttribute('data-cinematic') === 'frenzy' &&
      document.querySelector('#race-stage')?.getAttribute('data-frenzy') === 'active' &&
      document.querySelector('#race-stage')?.getAttribute('data-frenzy-vortex') === 'idle' &&
      document.querySelector('#race-stage')?.getAttribute('data-frenzy-spin') === 'idle' &&
      document.querySelector('#race-stage')?.getAttribute('data-mirror-ball') === 'idle' &&
      document.querySelector('#race-stage')?.getAttribute('data-flat-glide') === 'active' &&
      [...document.querySelectorAll('.runner-tag.skill')].some((element) => element.textContent?.includes('납작 활주')),
    undefined,
    { timeout: 45_000 }
  );

  await expect(page.locator('#race-stage')).toHaveAttribute('data-frenzy', 'active');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-frenzy-vortex', 'idle');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-frenzy-spin', 'idle');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-mirror-ball', 'idle');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-flat-glide', 'active');
  await expect(page.locator('.runner-tag.skill').filter({ hasText: '납작 활주' })).toBeVisible();
  await page.screenshot({
    path: 'test-results/lie-flat-frenzy-cutscene.png',
    fullPage: true
  });
});

test('plays rocket start with rear gas burst effect', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('#participants').fill(['혜성', '민트', '번개', '남색', '장미', '재빛'].join('\n'));
  await page.locator('#seed-input').fill('rocket-six-0002');
  await page.locator('#start-tournament').click();

  await expect(page.locator('#race-stage')).toHaveAttribute('data-rocket-fart', 'active', { timeout: 25_000 });
  await expect(page.locator('.runner-tag.skill').filter({ hasText: '로켓 출발' })).toBeVisible();
  await page.waitForTimeout(700);
  await page.screenshot({
    path: 'test-results/rocket-start-fart.png',
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
  await page.waitForFunction(() => {
    const stage = document.querySelector('#race-stage');
    return Number(stage?.getAttribute('data-helicopter-forward-dot')) > 0.92 && Number(stage?.getAttribute('data-bullet-direction-dot')) > 0.98;
  }, undefined, { timeout: 8_000 });
  await expect(page.locator('#leaderboard')).toHaveAttribute('data-camera-locked', 'true');

  const helicopterModel = await page.evaluate(() => {
    const stage = document.querySelector('#race-stage');
    return {
      clean: stage?.getAttribute('data-helicopter-model-clean'),
      shotOrigin: stage?.getAttribute('data-helicopter-shot-origin'),
      mainRotorClear: stage?.getAttribute('data-helicopter-main-rotor-clear'),
      tailRotorAttached: stage?.getAttribute('data-helicopter-tail-rotor-attached'),
      muzzleForward: stage?.getAttribute('data-helicopter-muzzle-forward'),
      generatedRootCount: Number(stage?.getAttribute('data-helicopter-generated-root-count')),
      mainRotorCount: Number(stage?.getAttribute('data-helicopter-main-rotor-count')),
      tailRotorCount: Number(stage?.getAttribute('data-helicopter-tail-rotor-count')),
      staticRotorBladeCount: Number(stage?.getAttribute('data-helicopter-static-rotor-blade-count')),
      mainRotorClearance: Number(stage?.getAttribute('data-helicopter-main-rotor-clearance')),
      tailRotorGap: Number(stage?.getAttribute('data-helicopter-tail-rotor-gap')),
      muzzleLocalX: Number(stage?.getAttribute('data-helicopter-muzzle-local-x')),
      noseTargetBias: Number(stage?.getAttribute('data-helicopter-nose-target-bias'))
    };
  });

  expect(helicopterModel.clean).toBe('true');
  expect(helicopterModel.shotOrigin).toBe('nose');
  expect(helicopterModel.mainRotorClear).toBe('true');
  expect(helicopterModel.tailRotorAttached).toBe('true');
  expect(helicopterModel.muzzleForward).toBe('true');
  expect(helicopterModel.generatedRootCount).toBe(1);
  expect(helicopterModel.mainRotorCount).toBe(1);
  expect(helicopterModel.tailRotorCount).toBe(1);
  expect(helicopterModel.staticRotorBladeCount).toBe(0);
  expect(helicopterModel.mainRotorClearance).toBeGreaterThan(0.55);
  expect(helicopterModel.tailRotorGap).toBeLessThan(0.18);
  expect(helicopterModel.muzzleLocalX).toBeGreaterThan(1.25);
  expect(helicopterModel.noseTargetBias).toBeGreaterThan(0.35);

  await page.screenshot({
    path: 'test-results/helicopter-clean-model.png',
    fullPage: true
  });

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
