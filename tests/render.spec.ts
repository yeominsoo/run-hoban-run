import { stat } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const viewports = [
  { name: 'desktop', size: { width: 1440, height: 900 } },
  { name: 'mobile', size: { width: 390, height: 844 } }
];

async function setHiddenSeed(page: Page, seed: string) {
  await page.locator('#seed-input').evaluate((element, nextSeed) => {
    if (element instanceof HTMLInputElement) {
      element.value = nextSeed;
    }
  }, seed);
}

for (const viewport of viewports) {
  test(`renders a nonblank 3d race scene on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport.size);
    await page.goto('/race/');
    await expect(page.locator('h1')).toHaveText('말발광 레이스');
    await expect(page.getByRole('link', { name: '게임 선택' })).toBeVisible();

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

for (const viewport of viewports) {
  test(`keeps race callouts limited on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport.size);
    await page.goto('/race/');
    await page.locator('#start-tournament').click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.runner-tag')].some(
        (element) => element.textContent?.trim() && Number(window.getComputedStyle(element).opacity) > 0.03
      )
    );

    const readFrame = () => page.evaluate(() => {
      const visibleCallouts = [...document.querySelectorAll('.runner-tag')].filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return Number(style.opacity) > 0.03 && rect.width > 0 && rect.height > 0;
      });
      const leaderboardBox = document.querySelector('#leaderboard')?.getBoundingClientRect();
      const minimapBox = document.querySelector('#race-minimap')?.getBoundingClientRect();

      return {
        visibleCalloutCount: visibleCallouts.length,
        leaderboardCount: document.querySelectorAll('#leaderboard li').length,
        minimapToLeaderboard:
          leaderboardBox && minimapBox ? Math.round(leaderboardBox.top - minimapBox.bottom) : null
      };
    });

    await expect.poll(async () => (await readFrame()).visibleCalloutCount, {
      timeout: 5_000
    }).toBeLessThanOrEqual(4);

    const frame = await readFrame();

    expect(frame.visibleCalloutCount).toBeGreaterThan(0);
    expect(frame.visibleCalloutCount).toBeLessThanOrEqual(4);
    expect(frame.leaderboardCount).toBe(20);

    if (frame.minimapToLeaderboard !== null) {
      expect(frame.minimapToLeaderboard).toBeGreaterThan(0);
    }

    await page.screenshot({
      path: `test-results/callouts-limited-${viewport.name}.png`,
      fullPage: true
    });
  });
}

for (const viewport of viewports) {
  test(`captures the gallop and grounding visual regression frame on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport.size);
    await page.goto('/race/');
    await page.locator('#participants').fill(['혜성', '민트', '번개', '노을', '바람', '호수'].join('\n'));
    await setHiddenSeed(page, `p2c-gallop-grounding-${viewport.name}`);
    await page.locator('#start-tournament').click();
    await page.waitForFunction(() => {
      const stage = document.querySelector('#race-stage');
      const leadProgress = Math.max(
        ...[...document.querySelectorAll('.minimap-dot')].map((dot) =>
          Number.parseFloat((dot instanceof HTMLElement ? dot.style.left : '0') || '0')
        )
      );
      return (
        leadProgress > 42 &&
        stage?.getAttribute('data-cinematic') === 'idle' &&
        stage?.getAttribute('data-camera-sequence') !== 'cinematic'
      );
    }, undefined, { timeout: 45_000 });
    await page.waitForTimeout(250);

    const frame = await page.evaluate(() => {
      const visibleCallouts = [...document.querySelectorAll('.runner-tag')].filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return Number(style.opacity) > 0.03 && rect.width > 0 && rect.height > 0;
      });
      const visibleIdentities = [...document.querySelectorAll('.runner-identity')].filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return Number(style.opacity) > 0.03 && rect.width > 0 && rect.height > 0;
      });
      const leadProgress = Math.max(
        ...[...document.querySelectorAll('.minimap-dot')].map((dot) =>
          Number.parseFloat((dot instanceof HTMLElement ? dot.style.left : '0') || '0')
        )
      );

      return {
        cameraSequence: document.querySelector('#race-stage')?.getAttribute('data-camera-sequence'),
        leadProgress,
        visibleCalloutCount: visibleCallouts.length,
        visibleIdentityCount: visibleIdentities.length,
        identityLabelCount: document.querySelectorAll('.runner-identity').length,
        leaderboardCount: document.querySelectorAll('#leaderboard li').length
      };
    });

    expect(frame.leaderboardCount).toBe(6);
    expect(frame.identityLabelCount).toBe(6);
    expect(frame.leadProgress).toBeGreaterThan(42);
    expect(frame.visibleCalloutCount).toBeLessThanOrEqual(4);
    expect(frame.visibleCalloutCount + frame.visibleIdentityCount).toBeGreaterThan(0);
    expect(['early', 'mid', 'final-stretch']).toContain(frame.cameraSequence);

    await page.screenshot({
      path: `test-results/p2c-gallop-grounding-${viewport.name}.png`,
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

  await page.goto('/race/');
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

    const isLocalRequest =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      (url.protocol === 'blob:' && (request.url().startsWith('blob:http://localhost') || request.url().startsWith('blob:http://127.0.0.1')));

    if (!isLocalRequest) {
      externalRequests.push(request.url());
    }

    const viteUrlImportProbe = url.searchParams.has('import') || url.searchParams.has('url');

    if (
      ((/freepixel-helicopter.*\.glb$/.test(url.pathname) || /racer|horse|rider|bridle|sitting/i.test(url.pathname)) && !viteUrlImportProbe) ||
      url.pathname.includes('/assets/frenzy/')
    ) {
      deferredAssetRequests.push(url.pathname);
    }
  });

  await page.goto('/race/');
  await page.waitForLoadState('networkidle');

  expect(externalRequests).toEqual([]);
  expect(deferredAssetRequests).toEqual([]);
});

test('uses detailed graphics as the only race graphics mode', async ({ page }) => {
  const modelRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    const viteUrlImportProbe = url.searchParams.has('import') || url.searchParams.has('url');

    if (/freepixel-helicopter.*\.glb$/.test(url.pathname) && !viteUrlImportProbe) {
      modelRequests.push(url.pathname);
    }
  });

  await page.goto('/race/');
  await expect(page.locator('#graphics-select')).toHaveCount(0);
  await page.locator('#start-tournament').click();
  await expect(page.locator('#race-stage')).toHaveAttribute('data-graphics-quality', 'standard');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-helicopter-asset', 'generated');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-crowd-quality', 'procedural-crowd-wall');
  const crowdDiagnostics = await page.locator('#race-stage').evaluate((element) => ({
    spectators: Number(element.getAttribute('data-crowd-spectators')),
    drawGroups: Number(element.getAttribute('data-crowd-draw-groups'))
  }));
  expect(crowdDiagnostics.spectators).toBeGreaterThanOrEqual(700);
  expect(crowdDiagnostics.drawGroups).toBeLessThanOrEqual(12);
  await page.waitForTimeout(3000);

  expect(modelRequests).toEqual([]);
});

test('downloads a composited result screenshot', async ({ page }) => {
  await page.goto('/race/');
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
  await page.goto('/race/');
  const supported = await page.evaluate(() => {
    const mp4Types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'];
    return (
      typeof MediaRecorder !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
      mp4Types.some((mimeType) => MediaRecorder.isTypeSupported(mimeType))
    );
  });

  test.skip(!supported, 'MP4 MediaRecorder canvas capture is not available in this browser');
  await expect(page.locator('#toggle-recording')).toBeEnabled();
  await expect(page.locator('#race-stage')).toHaveAttribute('data-recording-format', 'mp4');
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
  expect(download.suggestedFilename()).toMatch(/^run-hoban-run-.*-race-capture-.*\.mp4$/);
  await expect(page.locator('#race-stage')).toHaveAttribute('data-recording', 'idle');

  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();

  if (downloadPath) {
    expect((await stat(downloadPath)).size).toBeGreaterThan(1_000);
  }
});

test('shows an immediate loading state before the app bundle is ready', async ({ page }) => {
  const response = await page.request.get('/race/');
  const html = (await response.text()).replace(/<script\s+type="module"[^>]*><\/script>/, '');

  await page.setContent(html);
  await expect(page.locator('#boot-loader')).toBeVisible();
  await expect(page.locator('#boot-status')).toContainText('로딩');

  await page.goto('/race/');
  await expect(page.locator('#boot-loader')).toBeHidden({ timeout: 6_000 });
});

test('uses a faster default race pace and exposes upgraded racer visuals', async ({ page }) => {
  await page.goto('/race/');
  const raceStage = page.locator('#race-stage');

  await expect(page.locator('#race-speed-select')).toHaveCount(0);
  await expect(raceStage).toHaveAttribute('data-race-pace', '1.25');
  await expect(raceStage).toHaveAttribute('data-racer-model-strategy', 'procedural-stylized');
  await expect(raceStage).toHaveAttribute('data-horse-asset', 'procedural-stylized-horse');
  await expect(raceStage).toHaveAttribute('data-rider-asset', 'procedural-stylized-jockey');
  await expect(raceStage).toHaveAttribute('data-horse-asset-license', 'generated-local');
  await expect(raceStage).toHaveAttribute('data-rider-asset-license', 'generated-local');
  await expect(raceStage).toHaveAttribute('data-horse-asset-status', 'procedural');
  await expect(raceStage).toHaveAttribute('data-rider-asset-status', 'procedural');
  await expect(raceStage).toHaveAttribute('data-horse-visual-style', 'procedural-stylized');
  await expect(raceStage).toHaveAttribute('data-rider-visual-style', 'procedural-stylized');

  await page.locator('#start-tournament').click();
  await expect(page.locator('#race-summary')).not.toContainText('속도');
});

test('moves the overview camera through broadcast, finish, and winner phases', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/race/');
  await page.locator('#participants').fill(['혜성', '민트', '번개'].join('\n'));
  await setHiddenSeed(page, 'camera-sequence-0001');
  await page.locator('#start-tournament').click();

  const waitForBroadcastPhase = async (phase: 'early' | 'mid' | 'final-stretch' | 'finish' | 'winner', timeout: number) => {
    await page.waitForFunction(
      (expectedPhase) => {
        const stage = document.querySelector('#race-stage');
        return stage?.getAttribute('data-camera-sequence') === expectedPhase && stage?.getAttribute('data-cinematic') === 'idle';
      },
      phase,
      { timeout }
    );

    if (phase === 'final-stretch') {
      await page.waitForFunction(() => {
        const leadProgress = Math.max(
          ...[...document.querySelectorAll('.minimap-dot')].map((dot) =>
            Number.parseFloat((dot instanceof HTMLElement ? dot.style.left : '0') || '0')
          )
        );
        return leadProgress > 82;
      }, undefined, { timeout: 20_000 });
    }

    await page.waitForTimeout(phase === 'finish' ? 120 : 500);
    const frame = await page.evaluate(() => {
      const visibleCallouts = [...document.querySelectorAll('.runner-tag')].filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return Number(style.opacity) > 0.03 && rect.width > 0 && rect.height > 0;
      });
      const stage = document.querySelector('#race-stage');
      const winnerBanner = document.querySelector('#winner-banner');

      return {
        cameraMode: stage?.getAttribute('data-camera-mode'),
        cameraSequence: stage?.getAttribute('data-camera-sequence'),
        cinematic: stage?.getAttribute('data-cinematic'),
        victory: stage?.getAttribute('data-victory'),
        winnerBannerHidden: winnerBanner?.getAttribute('aria-hidden'),
        visibleCalloutCount: visibleCallouts.length,
        leaderboardCount: document.querySelectorAll('#leaderboard li').length,
        leadProgress: Math.max(
          ...[...document.querySelectorAll('.minimap-dot')].map((dot) =>
            Number.parseFloat((dot instanceof HTMLElement ? dot.style.left : '0') || '0')
          )
        )
      };
    });

    expect(frame).toMatchObject({
      cameraMode: 'overview',
      cinematic: 'idle',
      leaderboardCount: 3
    });
    if (phase === 'finish') {
      expect(['finish', 'winner']).toContain(frame.cameraSequence);
    } else {
      expect(frame.cameraSequence).toBe(phase);
    }
    expect(frame.visibleCalloutCount).toBeGreaterThan(0);
    expect(frame.visibleCalloutCount).toBeLessThanOrEqual(4);

    if (phase === 'final-stretch') {
      expect(frame.leadProgress).toBeGreaterThan(82);
    }

    if (phase === 'finish') {
      expect(frame.victory).toBe('active');
    }

    if (phase === 'winner') {
      expect(frame.victory).toBe('active');
      expect(frame.winnerBannerHidden).toBe('false');
    }

    await page.screenshot({
      path: phase === 'early' || phase === 'mid'
        ? `test-results/p3a-camera-sequence-${phase}.png`
        : phase === 'winner'
          ? 'test-results/p4a-winner-presentation.png'
          : `test-results/p3b-${phase}.png`,
      fullPage: true
    });
  };

  await waitForBroadcastPhase('early', 8_000);
  await waitForBroadcastPhase('mid', 45_000);
  await waitForBroadcastPhase('final-stretch', 85_000);
  await waitForBroadcastPhase('finish', 120_000);
  await waitForBroadcastPhase('winner', 20_000);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download-result-shot').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^run-hoban-run-.*-result-.*\.png$/);
  await expect(page.locator('#race-stage')).toHaveAttribute('data-last-screenshot-winner-banner', 'active');

  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  await download.saveAs('test-results/p4b-result-capture.png');

  if (downloadPath) {
    expect((await stat(downloadPath)).size).toBeGreaterThan(30_000);
  }

  expect((await stat('test-results/p4b-result-capture.png')).size).toBeGreaterThan(30_000);
});

test('starts a 64 runner tournament and advances to the final race', async ({ page }) => {
  await page.goto('/race/');
  await expect(page.locator('#race-stage')).not.toHaveClass(/panels-hidden/);
  await expect(page.locator('#race-title')).toHaveText('출발 대기');
  await expect(page.locator('#race-summary')).toContainText('헬기');
  await expect(page.locator('#result-list')).toHaveCount(0);
  await expect(page.locator('.hud-heading')).toHaveText('현재 순위');
  await expect(page.locator('.hud-heading')).toBeVisible();
  await expect(page.locator('#camera-target')).toHaveCount(0);
  await expect(page.locator('#toggle-fullscreen svg')).toBeVisible();
  await expect(page.locator('#toggle-fullscreen')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#toggle-recording svg')).toBeVisible();
  await expect(page.locator('#download-result-shot svg')).toBeVisible();
  await expect(page.locator('#seed-input')).toBeHidden();
  await expect(page.locator('#random-seed')).toHaveText('순서변경');
  await expect(page.locator('.option-group').filter({ hasText: '진행 방식' })).toContainText('출전');
  await expect(page.locator('.option-group').filter({ hasText: '진행 방식' })).toContainText('진출');
  await expect(page.locator('.option-group').filter({ hasText: '진행 방식' })).toContainText('우승');
  await expect(page.locator('.option-group').filter({ hasText: '경기 조건' })).toHaveCount(0);
  await expect(page.locator('#race-minimap')).toBeHidden();
  await expect(page.locator('.minimap-dot')).toHaveCount(20);
  await expect(page.locator('#leaderboard li')).toHaveCount(20);
  await expect(page.locator('#leaderboard')).toHaveAttribute('data-camera-mode', 'overview');
  await expect(page.locator('#leaderboard')).toHaveAttribute('data-camera-zoom', '1.00');
  const rosterScroll = await page.locator('#leaderboard').evaluate((element) => ({
    canScroll: element.scrollHeight > element.clientHeight,
    horizontalScroll: element.scrollWidth > element.clientWidth,
    count: element.children.length
  }));
  expect(rosterScroll).toEqual({ canScroll: true, horizontalScroll: false, count: 20 });
  const desktopRankingLayout = await page.evaluate(() => {
    const racePanel = document.querySelector('.race-panel')?.getBoundingClientRect();
    const rankingPanel = document.querySelector('.hud-bottom')?.getBoundingClientRect();

    return {
      underRacePanel: Boolean(racePanel && rankingPanel && rankingPanel.top >= racePanel.bottom - 1),
      rightAligned: Boolean(racePanel && rankingPanel && Math.abs(rankingPanel.right - racePanel.right) <= 1),
      sameWidth: Boolean(racePanel && rankingPanel && Math.abs(rankingPanel.width - racePanel.width) <= 1)
    };
  });
  expect(desktopRankingLayout).toEqual({ underRacePanel: true, rightAligned: true, sameWidth: true });
  const scrollAfterVerticalMove = await page.locator('#leaderboard').evaluate((element) => {
    element.scrollTop = 160;
    return element.scrollTop;
  });
  await expect(page.locator('#leaderboard')).toHaveAttribute('data-camera-zoom', '1.00');
  expect(scrollAfterVerticalMove).toBeGreaterThan(0);
  await page.locator('#leaderboard').evaluate((element) => {
    element.scrollTop = 0;
  });
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
  await expect(page.locator('#race-stage')).toHaveAttribute('data-crowd-banner-count', '64');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-crowd-banner-rows', '1');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-crowd-banner-columns', '64');
  await expect.poll(async () => Number(await page.locator('#race-stage').getAttribute('data-crowd-banner-height'))).toBeLessThanOrEqual(1.05);
  await expect(page.locator('#race-minimap')).toBeVisible();
  await expect(page.locator('#race-summary')).toContainText('64명');
  await expect(page.locator('#race-summary')).not.toContainText('시드');
  await expect(page.locator('#race-meta')).toContainText('경기 1/5');
  await expect(page.locator('#leaderboard')).not.toContainText(/% 지점/);

  for (let index = 0; index < 4; index += 1) {
    await page.locator('#next-race').click();
  }

  await expect(page.locator('#race-title')).toHaveText('결승전');
  await expect(page.locator('#race-meta')).toContainText('경기 5/5');
});

test('updates field size max from the participant count', async ({ page }) => {
  await page.goto('/race/');
  await expect(page.locator('#field-size')).toHaveAttribute('max', '20');
  await page.locator('#participants').fill(['1번주자', '2번주자', '3번주자', '4번주자', '5번주자', '6번주자'].join('\n'));
  await expect(page.locator('#field-size')).toHaveAttribute('max', '6');
  await expect(page.locator('#field-size')).toHaveValue('6');
  await expect(page.locator('#qualifiers')).toHaveAttribute('max', '5');
  await expect(page.locator('#winner-count')).toHaveAttribute('max', '6');
});

test('restores the recently edited participant list', async ({ page }) => {
  const recentParticipants = ['민수', '지수', '태오', '서윤'].join('\n');

  await page.goto('/race/');
  await page.locator('#participants').fill(recentParticipants);
  await expect(page.locator('#field-size')).toHaveAttribute('max', '4');

  await page.reload();
  await expect(page.locator('#participants')).toHaveValue(recentParticipants);
  await expect(page.locator('#field-size')).toHaveAttribute('max', '4');
});

test('renders participant names on the race crowd banners', async ({ page }) => {
  await page.goto('/race/');
  await page.locator('#participants').fill(['혜성', '민트', '번개', '노을', '바람', '호수'].join('\n'));
  await expect(page.locator('#race-stage')).toHaveAttribute('data-crowd-banner-count', '6');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-crowd-banner-rows', '1');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-crowd-banner-columns', '6');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-crowd-banner-messages', '혜성!|민트 가자!|번개 우승!|노을 파이팅!|바람!|호수 가자!');
  await expect(page.locator('#race-stage')).not.toHaveAttribute('data-crowd-banner-messages', /호반/);

  await page.locator('#start-tournament').click();
  await expect(page.locator('#race-stage')).toHaveAttribute('data-crowd-banner-count', '6');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-crowd-banner-messages', '혜성!|민트 가자!|번개 우승!|노을 파이팅!|바람!|호수 가자!');
  await expect(page.locator('#race-stage')).not.toHaveAttribute('data-crowd-banner-messages', /호반/);
});

test('keeps the team card shuffle usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/team/');
  await expect(page.getByRole('link', { name: '게임 선택' })).toBeVisible();
  await expect(page.locator('text=시드')).toHaveCount(0);
  await expect(page.locator('#count-hint')).toHaveText('현재 참가자 0명');
  await expect(page.locator('#shuffle-btn')).toHaveCount(0);
  await expect(page.locator('#deck-start-btn')).toBeVisible();
  await expect(page.locator('#deck-start-btn')).toHaveText('카드오픈');
  await expect(page.locator('.sidebar #distribute-btn')).toHaveText('카드오픈');
  await expect(page.locator('#actions-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#actions-body')).toBeVisible();
  await expect(page.locator('#actions-body #participants')).toBeVisible();
  await expect(page.locator('#setup-controls')).toBeVisible();
  await expect(page.locator('#runtime-controls')).toBeHidden();
  expect(await page.locator('#sidebar-actions').evaluate((panel) => panel.contains(document.querySelector('#participants')))).toBe(true);
  const expandedActionBox = await page.locator('#sidebar-actions').boundingBox();
  const expandedBodyBox = await page.locator('#actions-body').boundingBox();
  expect(expandedBodyBox?.height ?? 0).toBeGreaterThan(0);

  await page.locator('#participants').fill([
    '민수',
    '   ',
    '지수',
    '태오',
    '서윤',
    '',
    '현우',
    '아라',
    '도윤',
    '하린',
    '준서',
    '나래',
    '우진',
    '세아'
  ].join('\n'));
  await expect(page.locator('#count-hint')).toHaveText('현재 참가자 12명');
  await page.locator('#team-size-input').fill('3');
  await page.locator('#deck-start-btn').click();
  await expect(page.locator('#deck-start-btn')).toBeHidden();
  await expect(page.locator('#actions-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#actions-body')).toBeHidden();
  const collapsedActionBox = await page.locator('#sidebar-actions').boundingBox();
  expect(collapsedActionBox?.height ?? 0).toBeLessThan((expandedActionBox?.height ?? 80) - (expandedBodyBox?.height ?? 1));
  await expect(page.locator('#setup-controls')).toBeHidden();
  await expect(page.locator('#participants')).toBeHidden();
  await expect(page.locator('.status-bar #skip-btn')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.sidebar #skip-btn')).toHaveCount(0);
  await page.locator('#skip-btn').click();
  await expect(page.locator('#status-current')).toContainText('마지막 순번');
  await expect(page.locator('.status-bar #skip-btn')).toHaveText('한번에 열기');
  await expect(page.locator('.slot-card.revealed')).toHaveCount(8);
  await expect(page.locator('.group-slots .slot-card:not(:last-child).revealed')).toHaveCount(8);
  await expect(page.locator('.slot-card.clickable')).toHaveCount(4);
  await expect(page.locator('.group-slots .slot-card:last-child.clickable')).toHaveCount(4);

  const mobileLayout = await page.evaluate(() => {
    const grid = document.querySelector('#groups-grid');
    const columns = [...document.querySelectorAll('.group-col')].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width
      };
    });
    const firstRowTop = Math.min(...columns.map((column) => column.top));
    const firstRowColumns = columns.filter((column) => Math.abs(column.top - firstRowTop) < 2).length;

    return {
      viewportWidth: window.innerWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      gridClientWidth: grid?.clientWidth ?? 0,
      gridScrollWidth: grid?.scrollWidth ?? 0,
      groupCount: columns.length,
      firstRowColumns,
      minColumnWidth: Math.min(...columns.map((column) => column.width)),
      maxColumnRight: Math.max(...columns.map((column) => column.right))
    };
  });

  expect(mobileLayout.pageScrollWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth + 1);
  expect(mobileLayout.gridScrollWidth).toBeLessThanOrEqual(mobileLayout.gridClientWidth + 1);
  expect(mobileLayout.groupCount).toBe(4);
  expect(mobileLayout.firstRowColumns).toBe(2);
  expect(mobileLayout.minColumnWidth).toBeGreaterThan(140);
  expect(mobileLayout.maxColumnRight).toBeLessThanOrEqual(mobileLayout.viewportWidth + 1);

  await page.locator('#skip-btn').click();
  await expect(page.locator('#status-current')).toHaveText('배분 완료!');
  await page.locator('#actions-toggle').click();
  await expect(page.locator('.sidebar #copy-btn')).toBeVisible();
  await expect(page.locator('.sidebar #csv-btn')).toHaveCount(0);
  await expect(page.locator('.sidebar #reset-btn')).toHaveCount(0);
  await expect(page.locator('.status-bar #reset-btn')).toHaveText('다시하기');
  await expect(page.locator('.status-bar #reset-btn')).toBeVisible();
});

test('records the team card-open flow automatically when enabled', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 520 });
  await page.goto('/team/');
  const supported = await page.evaluate(() => {
    const mp4Types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'];
    return (
      typeof MediaRecorder !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
      mp4Types.some((mimeType) => MediaRecorder.isTypeSupported(mimeType))
    );
  });

  test.skip(!supported, 'MP4 MediaRecorder canvas capture is not available in this browser');
  await expect(page.locator('#auto-record-toggle')).toBeEnabled();
  const participants = Array.from({ length: 52 }, (_, index) => `참가자${String(index + 1).padStart(2, '0')}`);
  await page.locator('#participants').fill(participants.join('\n'));
  await expect(page.locator('#count-hint')).toHaveText('현재 참가자 52명');
  await page.locator('#team-size-input').fill('4');
  await page.locator('.record-toggle').click();
  await expect(page.locator('#auto-record-toggle')).toBeChecked();
  await page.locator('#deck-start-btn').click();
  await expect(page.locator('#actions-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#actions-toggle').click();
  await expect(page.locator('#setup-controls')).toBeHidden();
  await expect(page.locator('#participants')).toBeHidden();
  await expect(page.locator('.status-bar #skip-btn')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.group-col')).toHaveCount(13);

  const wrappedLayout = await page.evaluate(() => {
    const grid = document.querySelector('#groups-grid');
    const columns = [...document.querySelectorAll('.group-col')].map((element) => element.getBoundingClientRect());
    const rowTops = new Set(columns.map((rect) => Math.round(rect.top)));

    return {
      viewportWidth: window.innerWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      gridClientWidth: grid?.clientWidth ?? 0,
      gridScrollWidth: grid?.scrollWidth ?? 0,
      gridClientHeight: grid?.clientHeight ?? 0,
      gridScrollHeight: grid?.scrollHeight ?? 0,
      rowCount: rowTops.size,
      maxColumnRight: Math.max(...columns.map((rect) => rect.right))
    };
  });

  expect(wrappedLayout.pageScrollWidth).toBeLessThanOrEqual(wrappedLayout.viewportWidth + 1);
  expect(wrappedLayout.gridScrollWidth).toBeLessThanOrEqual(wrappedLayout.gridClientWidth + 1);
  expect(wrappedLayout.gridScrollHeight).toBeGreaterThan(wrappedLayout.gridClientHeight);
  expect(wrappedLayout.rowCount).toBeGreaterThan(1);
  expect(wrappedLayout.maxColumnRight).toBeLessThanOrEqual(wrappedLayout.viewportWidth + 1);
  await expect.poll(async () => page.locator('#groups-grid').getAttribute('data-recording-layout'), {
    timeout: 5_000
  }).toBe('wrapped-scroll');
  expect(Number(await page.locator('#groups-grid').getAttribute('data-recording-rows'))).toBeGreaterThan(1);
  expect(Number(await page.locator('#groups-grid').getAttribute('data-recording-scroll-max'))).toBeGreaterThan(0);
  expect(Number(await page.locator('#groups-grid').getAttribute('data-recording-captured-groups'))).toBe(13);

  await page.locator('#skip-btn').click();
  await expect(page.locator('#status-current')).toContainText('마지막 순번');

  const dialogPromise = page.waitForEvent('dialog');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#skip-btn').click();
  const dialog = await dialogPromise;
  expect(dialog.message()).toBe('결과 영상을 다운받으시겠습니까?');
  await dialog.accept();

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^toris-arcade-team-card-open-.*\.mp4$/);

  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();

  if (downloadPath) {
    expect((await stat(downloadPath)).size).toBeGreaterThan(1_000);
  }
});

test('keeps mobile minimap clear of the leaderboard and supports wheel zoom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/race/');
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
  await page.goto('/race/');
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
  await page.goto('/race/');
  await setHiddenSeed(page, '광폭빠름-00001');
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
    path: 'test-results/p3c-frenzy-brief-cut.png',
    fullPage: true
  });

  await page.waitForFunction(() => {
    const stage = document.querySelector('#race-stage');
    const leaderboard = document.querySelector('#leaderboard');
    return (
      stage?.getAttribute('data-cinematic') === 'idle' &&
      stage?.getAttribute('data-frenzy') === 'active' &&
      stage?.getAttribute('data-camera-sequence') !== 'cinematic' &&
      leaderboard?.getAttribute('data-camera-locked') === 'false'
    );
  }, undefined, { timeout: 12_000 });
  await page.waitForTimeout(150);
  await expect(page.locator('#race-stage')).toHaveAttribute('data-cinematic', 'idle');
  await expect(page.locator('#race-stage')).toHaveAttribute('data-frenzy', 'active');
  await expect(page.locator('#leaderboard')).toHaveAttribute('data-camera-locked', 'false');
  await page.screenshot({
    path: 'test-results/p3c-frenzy-return.png',
    fullPage: true
  });
});

test('plays dance skills with the frenzy mode effect active', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/race/');
  await setHiddenSeed(page, '댄스광폭-0113');
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
  await page.goto('/race/');
  await page.locator('#participants').fill(['혜성', '민트', '번개', '남색', '장미', '재빛'].join('\n'));
  await setHiddenSeed(page, 'flat-six-00002');
  await page.locator('#start-tournament').click();

  const flatGlideState = await page.waitForFunction(
    () => {
      const stage = document.querySelector('#race-stage');
      const hasFlatGlideLabel = [...document.querySelectorAll('.runner-tag.skill')].some((element) =>
        element.textContent?.includes('납작 활주')
      );
      const active =
        stage?.getAttribute('data-cinematic') === 'frenzy' &&
        stage.getAttribute('data-frenzy') === 'active' &&
        stage.getAttribute('data-frenzy-vortex') === 'idle' &&
        stage.getAttribute('data-frenzy-spin') === 'idle' &&
        stage.getAttribute('data-mirror-ball') === 'idle' &&
        stage.getAttribute('data-flat-glide') === 'active' &&
        hasFlatGlideLabel;

      if (!active) {
        return false;
      }

      return {
        frenzy: stage.getAttribute('data-frenzy'),
        frenzyVortex: stage.getAttribute('data-frenzy-vortex'),
        frenzySpin: stage.getAttribute('data-frenzy-spin'),
        mirrorBall: stage.getAttribute('data-mirror-ball'),
        flatGlide: stage.getAttribute('data-flat-glide'),
        hasFlatGlideLabel
      };
    },
    undefined,
    { timeout: 45_000 }
  );

  expect(await flatGlideState.jsonValue()).toMatchObject({
    frenzy: 'active',
    frenzyVortex: 'idle',
    frenzySpin: 'idle',
    mirrorBall: 'idle',
    flatGlide: 'active',
    hasFlatGlideLabel: true
  });
  await page.screenshot({
    path: 'test-results/lie-flat-frenzy-cutscene.png',
    fullPage: true
  });
});

test('plays rocket start with rear gas burst effect', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/race/');
  await page.locator('#participants').fill(['혜성', '민트', '번개', '남색', '장미', '재빛'].join('\n'));
  await setHiddenSeed(page, 'rocket-six-0002');
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
  await page.goto('/race/');
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
    const leaderboard = document.querySelector('#leaderboard');
    return (
      stage?.getAttribute('data-cinematic') === 'idle' &&
      stage?.getAttribute('data-camera-sequence') !== 'cinematic' &&
      leaderboard?.getAttribute('data-camera-locked') === 'false'
    );
  }, undefined, { timeout: 12_000 });

  await expect(page.locator('.runner-tag.eliminated').first()).toBeVisible();
  await expect(page.locator('#leaderboard')).toHaveAttribute('data-camera-locked', 'false');
  await page.screenshot({
    path: 'test-results/p3c-helicopter-return.png',
    fullPage: true
  });
});

async function clickAimCircle(page: Page) {
  const canvas = page.locator('#aim-canvas');
  const box = await canvas.boundingBox();
  const attrs = await canvas.evaluate((el) => ({
    x: Number(el.dataset.circleX),
    y: Number(el.dataset.circleY),
    r: Number(el.dataset.circleR)
  }));
  if (!box) throw new Error('aim canvas has no bounding box');
  await page.mouse.click(box.x + attrs.x, box.y + attrs.y);
  return attrs;
}

test('aim trainer: starts, registers hits and misses, tracks level and best score', async ({ page }) => {
  await page.goto('/aim-trainer/');
  await expect(page.locator('.game-title')).toHaveText('에임 트레이너');
  await expect(page.getByRole('link', { name: '게임 선택' })).toBeVisible();
  await expect(page.locator('#best-score')).toHaveText('0');
  await expect(page.locator('#start-overlay')).toBeVisible();
  await expect(page.locator('#hud')).toBeHidden();

  await page.locator('#start-btn').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#aim-canvas')).toHaveAttribute('data-phase', 'playing');
  await expect(page.locator('#aim-canvas')).toHaveAttribute('data-circle-r', '80');

  const firstCircle = await clickAimCircle(page);
  expect(firstCircle.r).toBe(80);
  await expect(page.locator('#hud-hits')).toHaveText('1');
  await expect(page.locator('#hud-level')).toHaveText('2');
  await expect
    .poll(async () => Number(await page.locator('#hud-score').textContent()))
    .toBeGreaterThanOrEqual(100);

  const scoreAfterHit = Number(await page.locator('#hud-score').textContent());

  // 캔버스 바깥에 가까운, 다음 원과 겹치지 않을 확률이 높은 모서리를 클릭해 미스를 유도한다.
  const canvasBox = await page.locator('#aim-canvas').boundingBox();
  if (!canvasBox) throw new Error('aim canvas has no bounding box');
  await page.mouse.click(canvasBox.x + 2, canvasBox.y + 2);

  await expect(page.locator('#hud-hits')).toHaveText('1');
  expect(Number(await page.locator('#hud-score').textContent())).toBe(scoreAfterHit);

  const secondCircle = await clickAimCircle(page);
  expect(secondCircle.r).toBe(75);
  await expect(page.locator('#hud-hits')).toHaveText('2');
  await expect(page.locator('#hud-level')).toHaveText('3');
});

test('color slider: moving sliders updates live accuracy and confirming advances rounds', async ({ page }) => {
  await page.goto('/color-slider/');
  await expect(page.locator('.game-title')).toHaveText('색 맞추기 슬라이더');
  await expect(page.locator('#start-overlay')).toBeVisible();

  await page.locator('#start-btn').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
  await expect(page.locator('#hud-round')).toHaveText('1/10');
  await expect(page.locator('#value-r')).toHaveText('128');

  await page.locator('#slider-r').fill('200');
  await page.locator('#slider-r').dispatchEvent('input');
  await expect(page.locator('#value-r')).toHaveText('200');
  await expect
    .poll(async () => Number((await page.locator('#hud-accuracy').textContent())?.replace('%', '')))
    .toBeGreaterThanOrEqual(0);

  const scoreBefore = Number(await page.locator('#hud-score').textContent());
  await page.locator('#confirm-btn').click();
  await expect(page.locator('#hud-round')).toHaveText('2/10');
  await expect(page.locator('#value-r')).toHaveText('128');
  expect(Number(await page.locator('#hud-score').textContent())).toBeGreaterThanOrEqual(scoreBefore);
});

test('color slider: completing all 10 rounds shows the result overlay with a bounded score', async ({ page }) => {
  await page.goto('/color-slider/');
  await page.locator('#start-btn').click();

  for (let i = 0; i < 10; i += 1) {
    await page.locator('#confirm-btn').click();
  }

  await expect(page.locator('#result-overlay')).toBeVisible();
  await expect(page.locator('#cs-play')).toBeHidden();
  const finalScore = Number(await page.locator('#result-score').textContent());
  expect(finalScore).toBeGreaterThanOrEqual(0);
  expect(finalScore).toBeLessThanOrEqual(1000);
  await expect(page.locator('#result-avg')).toContainText('평균 정확도');
});

async function chaseBall(page: Page, kind: 'green' | 'red', maxIterations: number) {
  const canvas = page.locator('#bd-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('ball-dodge canvas has no bounding box');

  for (let i = 0; i < maxIterations; i += 1) {
    const pos = await canvas.evaluate((el, k) => ({
      x: Number((el as HTMLElement).dataset[`${k}X`]),
      y: Number((el as HTMLElement).dataset[`${k}Y`])
    }), kind);
    if (Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      await page.mouse.move(box.x + pos.x, box.y + pos.y);
    }
    await page.waitForTimeout(50);
  }
}

test('ball dodge: dragging onto a green ball scores points, red ball costs HP', async ({ page }) => {
  await page.goto('/ball-dodge/');
  await expect(page.locator('.game-title')).toHaveText('볼 피하기 + 수집');
  await expect(page.locator('#start-overlay')).toBeVisible();

  await page.locator('#start-btn').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
  await expect(page.locator('#bd-canvas')).toHaveAttribute('data-phase', 'playing');
  await expect(page.locator('#hud-hp')).toHaveText('❤️❤️❤️');

  const box = await page.locator('#bd-canvas').boundingBox();
  if (!box) throw new Error('ball-dodge canvas has no bounding box');
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();

  await chaseBall(page, 'green', 40);
  await expect
    .poll(async () => Number(await page.locator('#hud-score').textContent()))
    .toBeGreaterThanOrEqual(10);

  await chaseBall(page, 'red', 40);
  await expect
    .poll(async () => Number(await page.locator('#bd-canvas').getAttribute('data-hp')))
    .toBeLessThan(3);
  await expect(page.locator('#hud-hp')).not.toHaveText('❤️❤️❤️');

  await page.mouse.up();
});

test('ball dodge: losing all HP shows the result overlay and saves the best score', async ({ page }) => {
  await page.goto('/ball-dodge/');
  await page.evaluate(() => localStorage.removeItem('rhh_ball-dodge_best'));
  await page.reload();

  await page.locator('#start-btn').click();
  const box = await page.locator('#bd-canvas').boundingBox();
  if (!box) throw new Error('ball-dodge canvas has no bounding box');
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();

  // 무적 시간(1초)이 끝날 때마다 빨간 볼을 계속 쫓아가 HP 3을 전부 소진시킨다.
  // 정확히 몇 번째 시도에 맞았는지는 신경 쓰지 않고, phase가 'ended'가 될 때까지 반복한다
  // (게임오버를 유발한 마지막 충돌 프레임엔 data-hp 갱신이 한 프레임 늦게 반영될 수 있어
  // hp 값을 단계별로 정확히 추적하는 대신 최종 phase만 기준으로 삼는 편이 더 안정적이다).
  await expect
    .poll(async () => {
      await chaseBall(page, 'red', 5);
      return page.locator('#bd-canvas').getAttribute('data-phase');
    }, { timeout: 30_000, intervals: [1_050] })
    .toBe('ended');
  await page.mouse.up();

  await expect(page.locator('#result-overlay')).toBeVisible();

  const finalScore = Number(await page.locator('#result-score').textContent());
  await expect(page.locator('#best-score')).toHaveText(String(finalScore));
});

/**
 * 정렬 감지와 탭을 Node↔브라우저 왕복 없이 같은 requestAnimationFrame 틱 안에서 처리한다.
 * (Node 쪽에서 "정렬 확인 → 그 다음 별도 CDP 호출로 클릭" 2단계로 나누면, 그 사이 애니메이션이
 * 계속 진행돼 실제 클릭 시점엔 이미 크게 어긋나 있는 레이스 컨디션이 있었다.)
 */
async function waitAndTapWhenAligned(page: Page, tolerancePx: number, maxFrames: number): Promise<boolean> {
  return page.evaluate(({ tol, maxFrames: cap }) => {
    return new Promise<boolean>((resolve) => {
      const canvas = document.querySelector('#ts-canvas') as HTMLElement | null;
      if (!canvas) {
        resolve(false);
        return;
      }
      let frame = 0;
      const tick = () => {
        const diff = Math.abs(Number(canvas.dataset.topLeft) - Number(canvas.dataset.movingLeft));
        if (diff < tol) {
          canvas.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: 'mouse',
            button: 0,
            clientX: 0,
            clientY: 0
          }));
          resolve(true);
          return;
        }
        frame += 1;
        if (frame > cap) {
          resolve(false);
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, { tol: tolerancePx, maxFrames });
}

test('tower stack: well-timed taps stack layers and increase the score', async ({ page }) => {
  // 좁은 뷰포트일수록 블록의 왕복 폭이 짧아 정렬 타이밍을 더 자주 잡을 수 있다.
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto('/tower-stack/');
  await expect(page.locator('.game-title')).toHaveText('타워 쌓기');
  await expect(page.locator('#start-overlay')).toBeVisible();

  await page.locator('#start-btn').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
  await expect(page.locator('#ts-canvas')).toHaveAttribute('data-phase', 'playing');
  await expect(page.locator('#hud-score')).toHaveText('0');

  for (let i = 0; i < 5; i += 1) {
    const tapped = await waitAndTapWhenAligned(page, 20, 600);
    expect(tapped).toBe(true);
    await expect(page.locator('#ts-canvas')).toHaveAttribute('data-phase', 'playing');
  }

  await expect(page.locator('#hud-score')).toHaveText('5');
  await expect(page.locator('#ts-canvas')).toHaveAttribute('data-layers', '6');

  const topWidth = Number(await page.locator('#ts-canvas').getAttribute('data-top-width'));
  expect(topWidth).toBeGreaterThan(0);
});

test('tower stack: a badly misaligned tap eventually ends the game and saves the best score', async ({ page }) => {
  await page.goto('/tower-stack/');
  await page.evaluate(() => localStorage.removeItem('rhh_tower-stack_best'));
  await page.reload();

  await page.locator('#start-btn').click();

  // 정렬을 신경 쓰지 않고 계속 탭해서 너비를 빠르게 깎아 게임 오버를 유도한다.
  await expect
    .poll(async () => {
      await page.locator('#ts-canvas').click();
      return page.locator('#ts-canvas').getAttribute('data-phase');
    }, { timeout: 20_000 })
    .toBe('ended');

  await expect(page.locator('#result-overlay')).toBeVisible();
  const finalScore = Number(await page.locator('#result-score').textContent());
  await expect(page.locator('#best-score')).toHaveText(String(finalScore));
});

interface SnakeState {
  headX: number;
  headY: number;
  foodX: number;
  foodY: number;
  length: number;
  phase: string | undefined;
}

async function readSnakeState(page: Page): Promise<SnakeState> {
  return page.locator('#sn-canvas').evaluate((el) => {
    const canvas = el as HTMLElement;
    return {
      headX: Number(canvas.dataset.headX),
      headY: Number(canvas.dataset.headY),
      foodX: Number(canvas.dataset.foodX),
      foodY: Number(canvas.dataset.foodY),
      length: Number(canvas.dataset.length),
      phase: canvas.dataset.phase
    };
  });
}

test('snake: steering onto the food grows the snake and increases the score', async ({ page }) => {
  await page.goto('/snake/');
  await expect(page.locator('.game-title')).toHaveText('스네이크 비틀기');
  await expect(page.locator('#start-overlay')).toBeVisible();

  await page.locator('#start-btn').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
  await expect(page.locator('#sn-canvas')).toHaveAttribute('data-phase', 'playing');

  const startLength = (await readSnakeState(page)).length;

  for (let i = 0; i < 60; i += 1) {
    const s = await readSnakeState(page);
    if (s.phase !== 'playing' || s.length > startLength) break;
    const dx = s.foodX - s.headX;
    const dy = s.foodY - s.headY;
    if (Math.abs(dx) > Math.abs(dy)) {
      await page.keyboard.press(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
    } else if (dy !== 0) {
      await page.keyboard.press(dy > 0 ? 'ArrowDown' : 'ArrowUp');
    }
    await page.waitForTimeout(60);
  }

  const grown = await readSnakeState(page);
  expect(grown.phase).toBe('playing');
  expect(grown.length).toBeGreaterThan(startLength);
  expect(Number(await page.locator('#hud-score').textContent())).toBeGreaterThan(0);
});

test('snake: turning back into its own body ends the game and saves the best score', async ({ page }) => {
  await page.goto('/snake/');
  await page.evaluate(() => localStorage.removeItem('rhh_snake_best'));
  await page.reload();

  await page.locator('#start-btn').click();

  // 몸길이를 조금 늘려야 좁은 반전 동작으로 확실히 자기 몸에 부딪힌다.
  for (let grownCount = 0; grownCount < 2; grownCount += 1) {
    for (let i = 0; i < 60; i += 1) {
      const s = await readSnakeState(page);
      if (s.phase !== 'playing') break;
      const dx = s.foodX - s.headX;
      const dy = s.foodY - s.headY;
      if (Math.abs(dx) > Math.abs(dy)) {
        await page.keyboard.press(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
      } else if (dy !== 0) {
        await page.keyboard.press(dy > 0 ? 'ArrowDown' : 'ArrowUp');
      }
      await page.waitForTimeout(60);
    }
  }

  // 왼쪽으로 좁은 사각형을 그려 자기 몸통과 부딪히게 만든다.
  for (const key of ['ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) {
    const phaseNow = (await readSnakeState(page)).phase;
    if (phaseNow === 'ended') break;
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }

  await expect(page.locator('#sn-canvas')).toHaveAttribute('data-phase', 'ended');
  await expect(page.locator('#result-overlay')).toBeVisible();

  const finalScore = Number(await page.locator('#result-score').textContent());
  await expect(page.locator('#best-score')).toHaveText(String(finalScore));
});

test('aim trainer: saves and restores the best score across visits', async ({ page }) => {
  await page.goto('/aim-trainer/');
  await page.evaluate(() => localStorage.removeItem('rhh_aim-trainer_best'));
  await page.reload();
  await expect(page.locator('#best-score')).toHaveText('0');

  await page.locator('#start-btn').click();
  await clickAimCircle(page);
  await clickAimCircle(page);
  await clickAimCircle(page);

  const scoreAfterHits = Number(await page.locator('#hud-score').textContent());
  expect(scoreAfterHits).toBeGreaterThan(0);

  await page.evaluate(() => {
    localStorage.setItem('rhh_aim-trainer_best', '999999');
  });
  await page.reload();
  await expect(page.locator('#best-score')).toHaveText('999999');
});
