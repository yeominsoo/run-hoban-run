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

test('aim trainer: the 30s countdown only starts on the first tap', async ({ page }) => {
  await page.goto('/aim-trainer/');
  await page.locator('#start-btn').click();
  await expect(page.locator('#hud-time')).toHaveText('30.0');

  await page.waitForTimeout(600);
  await expect(page.locator('#hud-time')).toHaveText('30.0');

  await clickAimCircle(page);
  await expect
    .poll(async () => page.locator('#hud-time').textContent())
    .not.toBe('30.0');
});

test('aim trainer: saving a ranking entry shows it in the ranking view with the prefilled nickname', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/aim-trainer/');
  await page.evaluate(() => {
    localStorage.removeItem('rhh_last_nickname');
    localStorage.removeItem('rhh_aim-trainer_ranking');
  });
  await page.reload();
  await expect(page.locator('#view-ranking-btn')).toBeVisible();

  await page.locator('#start-btn').click();
  await clickAimCircle(page); // 첫 탭으로 타이머 시작

  await expect(page.locator('#result-overlay')).toBeVisible({ timeout: 35_000 });
  await expect(page.locator('#rank-name-input')).toHaveValue('');

  await page.locator('#rank-name-input').fill('플레이어1');
  await page.locator('#rank-save-btn').click();
  await expect(page.locator('#rank-saved-msg')).toBeVisible();
  await expect(page.locator('#rank-save-btn')).toBeDisabled();

  await page.locator('#retry-btn').click();
  await expect(page.locator('#result-overlay')).toBeHidden();

  await page.goto('/aim-trainer/');
  await expect(page.locator('#start-overlay')).toBeVisible();
  await page.locator('#view-ranking-btn').click();
  await expect(page.locator('#ranking-overlay')).toBeVisible();
  await expect(page.locator('#ranking-list')).toContainText('플레이어1');
  await page.locator('#close-ranking-btn').click();
  await expect(page.locator('#ranking-overlay')).toBeHidden();

  await page.locator('#start-btn').click();
  await clickAimCircle(page);
  await expect(page.locator('#result-overlay')).toBeVisible({ timeout: 35_000 });
  // 마지막에 쓴 닉네임이 다음 판 결과 화면에도 자동으로 선입력돼야 한다.
  await expect(page.locator('#rank-name-input')).toHaveValue('플레이어1');
});

test('aim trainer: the ranking list can be saved as an image', async ({ page }) => {
  await page.goto('/aim-trainer/');
  await page.evaluate(() => {
    localStorage.setItem('rhh_aim-trainer_ranking', JSON.stringify([
      { name: '민수', score: 5000, at: Date.now() }
    ]));
  });
  await page.reload();

  await page.locator('#view-ranking-btn').click();
  await expect(page.locator('#ranking-overlay')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#ranking-save-image-btn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/랭킹.*\.png$/);
});

test('hub: splits games into single-player and multiplayer categories', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.hub-title')).toHaveText('Toris Arcade');
  await expect(page.locator('[data-category="single"]')).toBeVisible();
  await expect(page.locator('[data-category="multi"]')).toBeVisible();
  await expect(page.locator('#hub-game-list')).toBeHidden();

  await page.locator('[data-category="single"]').click();
  await expect(page.locator('#hub-game-list')).toBeVisible();
  await expect(page.locator('#hub-categories')).toBeHidden();
  await expect(page.locator('#hub-list-title')).toHaveText('싱글플레이');
  await expect(page.locator('.game-card[data-slug="race"]')).toBeVisible();
  await expect(page.locator('.game-card[data-slug="aim-trainer"]')).toBeVisible();
  await expect(page.locator('.game-card[data-slug="rps"]')).toHaveCount(0);

  await page.locator('#hub-back-btn').click();
  await expect(page.locator('#hub-categories')).toBeVisible();
  await expect(page.locator('#hub-game-list')).toBeHidden();

  await page.locator('[data-category="multi"]').click();
  await expect(page.locator('#hub-list-title')).toHaveText('멀티플레이');
  await expect(page.locator('.game-card[data-slug="rps"]')).toBeVisible();
  await expect(page.locator('.game-card[data-slug="strategy-yutnori"]')).toBeVisible();
  await expect(page.locator('.game-card[data-slug="race"]')).toHaveCount(0);

  await page.locator('.game-card[data-slug="rps"] .game-card-toggle').click();
  await expect(page.locator('#details-rps')).toBeVisible();
  await expect(page.locator('.game-card[data-slug="rps"] .game-card-start-btn')).toHaveAttribute('href', '/rps/');
});

test('theme: selecting a theme on the hub persists to localStorage and applies immediately', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('rhh_theme'));
  await page.reload();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);

  await page.locator('#hub-theme-btn').click();
  await expect(page.locator('#theme-overlay')).toBeVisible();
  await expect(page.locator('.theme-option[data-theme-id="cloud"]')).toHaveClass(/selected/);

  await page.locator('.theme-option[data-theme-id="cyberpunk"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'cyberpunk');
  await expect(page.locator('.theme-option[data-theme-id="cyberpunk"]')).toHaveClass(/selected/);
  expect(await page.evaluate(() => localStorage.getItem('rhh_theme'))).toBe('cyberpunk');

  await page.locator('#theme-close-btn').click();
  await expect(page.locator('#theme-overlay')).toBeHidden();
});

test('theme: a theme chosen on the hub is applied on the very first paint of a game page (no FOUC flash)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('rhh_theme', 'casino'));

  // 인라인 스크립트가 <head> 맨 앞에서 즉시 실행되므로, 페이지 스크립트가 로드되기 전에도
  // data-theme가 이미 반영되어 있어야 한다(깜빡임 없이 첫 페인트부터 카지노 테마).
  await page.goto('/idle-farm/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'casino');

  await page.goto('/aim-trainer/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'casino');
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

/**
 * 결과 화면(닉네임 저장 폼이 보이는 상태)에서 시작해, 랭킹 저장 → 재방문 시 랭킹 목록에
 * 표시 → 이미지 저장까지 공용 랭킹 UI(src/shared/leaderboard.ts) 흐름을 검증한다.
 * 게임마다 결과 화면에 도달하는 과정만 다르고 이후 흐름은 동일해 공용 헬퍼로 뺐다.
 */
async function verifyRankingSaveAndView(page: Page, gamePath: string, name = '테스터') {
  await expect(page.locator('#rank-name-input')).toBeVisible();
  await page.locator('#rank-name-input').fill(name);
  await page.locator('#rank-save-btn').click();
  await expect(page.locator('#rank-saved-msg')).toBeVisible();
  await expect(page.locator('#rank-save-btn')).toBeDisabled();

  await page.goto(gamePath);
  await expect(page.locator('#view-ranking-btn')).toBeVisible();
  await page.locator('#view-ranking-btn').click();
  await expect(page.locator('#ranking-overlay')).toBeVisible();
  await expect(page.locator('#ranking-list')).toContainText(name);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#ranking-save-image-btn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
}

test('color slider: saving a ranking entry shows it on revisit and can be exported as an image', async ({ page }) => {
  await page.goto('/color-slider/');
  await page.evaluate(() => localStorage.removeItem('rhh_color-slider_ranking'));
  await page.reload();

  await page.locator('#start-btn').click();
  for (let i = 0; i < 10; i += 1) await page.locator('#confirm-btn').click();
  await expect(page.locator('#result-overlay')).toBeVisible();

  await verifyRankingSaveAndView(page, '/color-slider/');
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

test('ball dodge: dedicated player, hazard, and collectible sprites load before play', async ({ page }) => {
  const loadedAssetPaths = new Set<string>();
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/assets/game-art/ball-dodge/') && response.ok()) {
      loadedAssetPaths.add(path);
    }
  });

  await page.goto('/ball-dodge/');
  await expect(page.locator('#bd-canvas')).toHaveAttribute('data-asset-state', 'ready');
  expect([...loadedAssetPaths].sort()).toEqual([
    '/assets/game-art/ball-dodge/collectible-star.webp',
    '/assets/game-art/ball-dodge/hazard-meteor.webp',
    '/assets/game-art/ball-dodge/player-star-collector.webp'
  ]);
  await expect(page.locator('#start-overlay p')).toContainText('별 수집선');
});

test('ball dodge: a failed sprite request keeps the Canvas fallback playable', async ({ page }) => {
  await page.route('**/assets/game-art/ball-dodge/hazard-meteor.webp', (route) => route.abort());
  await page.goto('/ball-dodge/');

  await expect(page.locator('#bd-canvas')).toHaveAttribute('data-asset-state', 'fallback');
  await page.locator('#start-btn').click();
  await expect(page.locator('#bd-canvas')).toHaveAttribute('data-phase', 'playing');
});

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

test('ball dodge: saving a ranking entry shows it on revisit and can be exported as an image', async ({ page }) => {
  await page.goto('/ball-dodge/');
  await page.evaluate(() => localStorage.removeItem('rhh_ball-dodge_ranking'));
  await page.reload();

  await page.locator('#start-btn').click();
  const box = await page.locator('#bd-canvas').boundingBox();
  if (!box) throw new Error('ball-dodge canvas has no bounding box');
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();

  for (let hpLossAttempt = 0; hpLossAttempt < 3; hpLossAttempt += 1) {
    const hpBefore = Number(await page.locator('#bd-canvas').getAttribute('data-hp'));
    await expect
      .poll(async () => {
        await chaseBall(page, 'red', 5);
        return Number(await page.locator('#bd-canvas').getAttribute('data-hp'));
      }, { timeout: 20_000 })
      .toBeLessThanOrEqual(hpBefore);
    await page.waitForTimeout(1_050);
  }
  await page.mouse.up();
  await expect(page.locator('#result-overlay')).toBeVisible({ timeout: 10_000 });

  await verifyRankingSaveAndView(page, '/ball-dodge/');
});

test('mole hunt: dedicated sprite loads and appears in an active hole', async ({ page }) => {
  let spriteResponseOk = false;
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/assets/game-art/mole-hunt/mole.webp') {
      spriteResponseOk = response.ok();
    }
  });

  await page.goto('/mole-hunt/');
  await expect(page.locator('#mh-grid')).toHaveAttribute('data-asset-state', 'ready');
  expect(spriteResponseOk).toBe(true);

  await page.evaluate(() => {
    document.querySelectorAll('.mh-panel').forEach((el) => el.classList.add('hidden'));
    document.querySelector('#playing-panel')?.classList.remove('hidden');
    document.querySelectorAll('.mh-hole')[4]?.classList.add('active');
  });
  const activeMole = page.locator('.mh-hole.active .mh-mole');
  await expect(activeMole).toBeVisible();
  await expect(activeMole).toHaveCSS('background-image', /mole\.webp/);
});

test('mole hunt: a failed sprite request shows the CSS target fallback', async ({ page }) => {
  await page.route('**/assets/game-art/mole-hunt/mole.webp', (route) => route.abort());
  await page.goto('/mole-hunt/');
  await expect(page.locator('#mh-grid')).toHaveAttribute('data-asset-state', 'fallback');

  await page.evaluate(() => {
    document.querySelectorAll('.mh-panel').forEach((el) => el.classList.add('hidden'));
    document.querySelector('#playing-panel')?.classList.remove('hidden');
    document.querySelectorAll('.mh-hole')[4]?.classList.add('active');
  });
  await expect(page.locator('.mh-hole.active .mh-mole-fallback')).toBeVisible();
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

test('tower stack: saving a ranking entry shows it on revisit and can be exported as an image', async ({ page }) => {
  await page.goto('/tower-stack/');
  await page.evaluate(() => localStorage.removeItem('rhh_tower-stack_ranking'));
  await page.reload();

  await page.locator('#start-btn').click();
  await expect
    .poll(async () => {
      await page.locator('#ts-canvas').click();
      return page.locator('#ts-canvas').getAttribute('data-phase');
    }, { timeout: 20_000 })
    .toBe('ended');
  await expect(page.locator('#result-overlay')).toBeVisible();

  await verifyRankingSaveAndView(page, '/tower-stack/');
});

interface SnakeState {
  headX: number;
  headY: number;
  foodX: number;
  foodY: number;
  length: number;
  dirDx: number;
  dirDy: number;
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
      dirDx: Number(canvas.dataset.dirDx),
      dirDy: Number(canvas.dataset.dirDy),
      phase: canvas.dataset.phase
    };
  });
}

// 먹이를 향한 "이상적인" 키가 현재 실제 진행 방향의 정반대라면 게임이 그 입력을 그냥
// 무시해버린다(자기 몸쪽으로 순간 반전은 규칙상 금지). 그 사실을 모르고 계속 반대 키만
// 누르면 방향이 전혀 안 바뀐 채 시간만 흘러(먹이를 못 먹거나 루프가 깨짐) 테스트가
// 드물게 실패했다 — 정반대인 경우 수직 축으로 우회하도록 계산해야 한다.
function nextSnakeKey(s: SnakeState): string | null {
  const dx = s.foodX - s.headX;
  const dy = s.foodY - s.headY;
  let key: string | null = null;
  if (Math.abs(dx) > Math.abs(dy) && dx !== 0) {
    key = dx > 0 ? 'ArrowRight' : 'ArrowLeft';
  } else if (dy !== 0) {
    key = dy > 0 ? 'ArrowDown' : 'ArrowUp';
  }
  if (!key) return null;
  const isOpposite =
    (key === 'ArrowRight' && s.dirDx === -1) ||
    (key === 'ArrowLeft' && s.dirDx === 1) ||
    (key === 'ArrowDown' && s.dirDy === -1) ||
    (key === 'ArrowUp' && s.dirDy === 1);
  if (!isOpposite) return key;
  // 원하는 축이 막혔으니 다른 축으로 우회(둘 다 0이면 이미 그 축에서는 도착한 것).
  if (Math.abs(dx) > Math.abs(dy)) {
    return dy !== 0 ? (dy > 0 ? 'ArrowDown' : 'ArrowUp') : null;
  }
  return dx !== 0 ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft') : null;
}

test('snake: steering onto the food grows the snake and increases the score', async ({ page }) => {
  await page.goto('/snake/');
  await expect(page.locator('.game-title')).toHaveText('스네이크 비틀기');
  await expect(page.locator('#start-overlay')).toBeVisible();

  await page.locator('#start-btn').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
  await expect(page.locator('#sn-canvas')).toHaveAttribute('data-phase', 'playing');

  const startLength = (await readSnakeState(page)).length;

  for (let i = 0; i < 90; i += 1) {
    const s = await readSnakeState(page);
    if (s.phase !== 'playing' || s.length > startLength) break;
    const key = nextSnakeKey(s);
    if (key) await page.keyboard.press(key);
    await page.waitForTimeout(60);
  }

  const grown = await readSnakeState(page);
  expect(grown.phase).toBe('playing');
  expect(grown.length).toBeGreaterThan(startLength);
  expect(Number(await page.locator('#hud-score').textContent())).toBeGreaterThan(0);
});

async function driveSnakeToGameOver(page: Page) {
  // 키 입력을 60ms 간격으로 쌓으면 220ms 게임 틱 사이에 pendingDirection이 여러 번
  // 덮어써져 경로가 비결정적으로 변한다. 머리가 실제로 한 칸 이동할 때까지 기다린 뒤
  // 다음 키를 보내 테스트 입력을 게임 틱과 동기화한다.
  const advanceOneTick = async (key: string | null) => {
    const before = await readSnakeState(page);
    if (key) await page.keyboard.press(key);
    await expect.poll(async () => {
      const after = await readSnakeState(page);
      return after.phase !== 'playing'
        || after.headX !== before.headX
        || after.headY !== before.headY;
    }, { timeout: 1_000 }).toBe(true);
  };

  // 몸길이 5 이상(시작 3 + 먹이 2회)이 될 때까지 실제 틱 단위로 먹이를 추적한다.
  // 길이 4에서는 2×2 루프의 마지막 칸과 동시에 꼬리가 비워져 충돌이 보장되지 않는다.
  for (let step = 0; step < 360; step += 1) {
    const state = await readSnakeState(page);
    if (state.phase !== 'playing') return;
    if (state.length >= 5) break;
    await advanceOneTick(nextSnakeKey(state));
  }
  const grown = await readSnakeState(page);
  expect(grown.length).toBeGreaterThanOrEqual(5);

  // 현재 실제 진행 방향을 90도씩 같은 방향으로 4번 회전시키면 정확히 한 바퀴 돌아
  // 시작점으로 돌아온다. 몸길이가 5 이상이면 그 칸은 아직 몸통이 차지하고 있어(길이 5 >
  // 경과 틱 4) 반드시 자기 몸과 부딪힌다. 고정된 키 시퀀스(예: Down 먼저) 대신 "현재
  // 방향에서 90도 회전"으로 계산해야 한다 — 만약 스네이크가 이미 Up으로 가고 있는데
  // 첫 키로 Down을 누르면 게임이 반대 방향 입력을 무시해버려 루프 자체가 깨진다.
  const dirToKey = (dx: number, dy: number): string => {
    if (dx === 1) return 'ArrowRight';
    if (dx === -1) return 'ArrowLeft';
    return dy === 1 ? 'ArrowDown' : 'ArrowUp';
  };
  const rotate90 = ({ dx, dy }: { dx: number; dy: number }) => ({ dx: -dy, dy: dx });

  for (let cycle = 0; cycle < 2; cycle += 1) {
    const state = await readSnakeState(page);
    if (state.phase === 'ended') return;
    let dir = { dx: state.dirDx, dy: state.dirDy };
    const loopKeys = Array.from({ length: 4 }, () => {
      dir = rotate90(dir);
      return dirToKey(dir.dx, dir.dy);
    });

    for (const key of loopKeys) {
      const phaseNow = (await readSnakeState(page)).phase;
      if (phaseNow === 'ended') return;
      await advanceOneTick(key);
    }
  }
}

test('snake: turning back into its own body ends the game and saves the best score', async ({ page }) => {
  await page.goto('/snake/');
  await page.evaluate(() => localStorage.removeItem('rhh_snake_best'));
  await page.reload();

  await page.locator('#start-btn').click();
  await driveSnakeToGameOver(page);

  await expect(page.locator('#sn-canvas')).toHaveAttribute('data-phase', 'ended');
  await expect(page.locator('#result-overlay')).toBeVisible();

  const finalScore = Number(await page.locator('#result-score').textContent());
  await expect(page.locator('#best-score')).toHaveText(String(finalScore));
});

test('snake: saving a ranking entry shows it on revisit and can be exported as an image', async ({ page }) => {
  await page.goto('/snake/');
  await page.evaluate(() => localStorage.removeItem('rhh_snake_ranking'));
  await page.reload();

  await page.locator('#start-btn').click();
  await driveSnakeToGameOver(page);
  await expect(page.locator('#result-overlay')).toBeVisible();

  await verifyRankingSaveAndView(page, '/snake/');
});

test('typing survival: typing the falling word clears it and increases the score', async ({ page }) => {
  await page.goto('/typing-survival/');
  await expect(page.locator('.game-title')).toHaveText('타이핑 생존');
  await expect(page.locator('#start-overlay')).toBeVisible();

  await page.locator('#start-btn').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
  await expect(page.locator('#tp-canvas')).toHaveAttribute('data-phase', 'playing');
  await expect(page.locator('#hud-score')).toHaveText('0');

  await expect
    .poll(async () => (await page.locator('#tp-canvas').getAttribute('data-word-count')) ?? '0')
    .not.toBe('0');
  const firstWord = ((await page.locator('#tp-canvas').getAttribute('data-words')) ?? '').split('|')[0];
  expect(firstWord.length).toBeGreaterThan(0);

  await page.locator('#tp-input').fill(firstWord);
  await expect(page.locator('#hud-score')).toHaveText('1');
  await expect(page.locator('#tp-input')).toHaveValue('');
});

test('typing survival: letting words hit the floor loses HP and ends the game', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/typing-survival/');
  await page.evaluate(() => localStorage.removeItem('rhh_typing-survival_best'));
  await page.reload();

  await page.locator('#start-btn').click();
  await expect(page.locator('#tp-canvas')).toHaveAttribute('data-phase', 'playing');

  // 아무것도 입력하지 않고 단어가 계속 바닥에 닿게 방치해 HP 3을 전부 소진시킨다.
  await expect
    .poll(async () => page.locator('#tp-canvas').getAttribute('data-phase'), { timeout: 90_000 })
    .toBe('ended');

  await expect(page.locator('#result-overlay')).toBeVisible();
  const finalScore = Number(await page.locator('#result-score').textContent());
  await expect(page.locator('#best-score')).toHaveText(String(finalScore));
});

test('typing survival: saving a ranking entry shows it on revisit and can be exported as an image', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/typing-survival/');
  await page.evaluate(() => localStorage.removeItem('rhh_typing-survival_ranking'));
  await page.reload();

  await page.locator('#start-btn').click();
  await expect
    .poll(async () => page.locator('#tp-canvas').getAttribute('data-phase'), { timeout: 45_000 })
    .toBe('ended');
  await expect(page.locator('#result-overlay')).toBeVisible();

  await verifyRankingSaveAndView(page, '/typing-survival/');
});

async function readHexTiles(page: Page): Promise<Array<{ q: number; r: number; value: number }>> {
  const raw = (await page.locator('#hx-canvas').getAttribute('data-tiles')) ?? '';
  return raw.split('|').filter(Boolean).map((entry) => {
    const [pos, value] = entry.split(':');
    const [q, r] = pos.split(',').map(Number);
    return { q, r, value: Number(value) };
  });
}

test('2048 hex: keyboard moves slide and merge tiles, increasing the score', async ({ page }) => {
  await page.goto('/2048-hex/');
  await expect(page.locator('.game-title')).toHaveText('2048 변형(육각형)');
  await expect(page.locator('#start-overlay')).toBeVisible();

  await page.locator('#start-btn').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
  await expect(page.locator('#hx-canvas')).toHaveAttribute('data-phase', 'playing');

  const before = await readHexTiles(page);
  expect(before.length).toBe(2);

  for (const key of ['KeyE', 'KeyA', 'KeyQ', 'KeyD', 'KeyW', 'KeyS']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(30);
  }

  const after = await readHexTiles(page);
  expect(after.length).toBeGreaterThan(before.length);
  // 19칸짜리 격자 밖으로 나간 타일이 없어야 한다(반지름 2: |q|,|r|,|q+r| 전부 2 이하).
  for (const tile of after) {
    expect(Math.max(Math.abs(tile.q), Math.abs(tile.r), Math.abs(tile.q + tile.r))).toBeLessThanOrEqual(2);
  }
});

test('2048 hex: a swipe gesture is recognized as a directional move', async ({ page }) => {
  await page.goto('/2048-hex/');
  await page.locator('#start-btn').click();
  await expect(page.locator('#hx-canvas')).toHaveAttribute('data-phase', 'playing');

  const box = await page.locator('#hx-canvas').boundingBox();
  if (!box) throw new Error('hex canvas has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // 랜덤 초기 배치상 특정 방향은 우연히 "이동할 게 없는" 상태일 수 있으므로(스펙대로
  // 그 스와이프는 아무 효과가 없는 게 맞는 동작), 여러 방향을 순서대로 시도해 스와이프
  // 입력 자체가 인식되는지 확인한다.
  const swipes: Array<[number, number]> = [[80, 0], [-80, 0], [0, 80], [0, -80]];
  let changed = false;
  for (const [dx, dy] of swipes) {
    const before = await readHexTiles(page);
    await page.mouse.move(cx - dx, cy - dy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(50);
    const after = await readHexTiles(page);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changed = true;
      break;
    }
  }
  expect(changed).toBe(true);
});

test('2048 hex: the ranking list can be saved as an image', async ({ page }) => {
  // 정상적인 플레이만으로 "더 이상 이동 불가" 상태(19칸 전부 채워지고 인접 병합도 불가)를
  // 결정론적으로 만들기는 비현실적이라, 랭킹보기/이미지 내보내기 경로만 저장된 랭킹으로
  // 검증한다. 결과 화면에서의 "기록 저장" 자체는 다른 6개 게임에서 이미 충분히 검증했다.
  await page.goto('/2048-hex/');
  await page.evaluate(() => {
    localStorage.setItem('rhh_2048-hex_ranking', JSON.stringify([
      { name: '민수', score: 4096, at: Date.now() }
    ]));
  });
  await page.reload();

  await page.locator('#view-ranking-btn').click();
  await expect(page.locator('#ranking-overlay')).toBeVisible();
  await expect(page.locator('#ranking-list')).toContainText('민수');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#ranking-save-image-btn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
});

interface RunnerObstacle {
  type: string;
  x: number;
  width: number;
  visual: string;
}

interface RunnerCoinPath {
  x: number;
  y: number;
  safeAction: string;
}

interface RunnerState {
  phase: string | undefined;
  playerX: number;
  groundY: number;
  playerState: string | undefined;
  obstacles: RunnerObstacle[];
  coinPaths: RunnerCoinPath[];
  score: number;
  coins: number;
  round: number;
  jumpsUsed: number;
  groundRatio: number;
  obstacleCatalog: string[];
}

async function readRunnerState(page: Page): Promise<RunnerState> {
  return page.locator('#er-canvas').evaluate((el) => {
    const canvas = el as HTMLElement;
    const obstacles = (canvas.dataset.obstacles ?? '')
      .split('|')
      .filter(Boolean)
      .map((entry) => {
        const [type, x, width, visual] = entry.split(':');
        return { type, x: Number(x), width: Number(width), visual };
      });
    const coinPaths = (canvas.dataset.coinPaths ?? '')
      .split('|')
      .filter(Boolean)
      .map((entry) => {
        const [x, y, safeAction] = entry.split(':');
        return { x: Number(x), y: Number(y), safeAction };
      });
    return {
      phase: canvas.dataset.phase,
      playerX: Number(canvas.dataset.playerX),
      groundY: Number(canvas.dataset.groundY),
      playerState: canvas.dataset.state,
      obstacles,
      coinPaths,
      score: Number(canvas.dataset.score ?? 0),
      coins: Number(canvas.dataset.coins ?? 0),
      round: Number(canvas.dataset.round ?? 1),
      jumpsUsed: Number(canvas.dataset.jumpsUsed ?? 0),
      groundRatio: Number(canvas.dataset.groundRatio ?? 0),
      obstacleCatalog: (canvas.dataset.obstacleCatalog ?? '').split('|').filter(Boolean)
    };
  });
}

test('endless runner: selects one of two character GIF sets and reflects every action state', async ({ page }) => {
  test.setTimeout(40_000);
  await page.addInitScript(() => {
    Math.random = () => 0.1;
  });
  await page.goto('/endless-runner/');
  await page.evaluate(() => {
    localStorage.setItem('rhh_endless-runner_character', 'checkered-vest-boy-flat-sticker');
  });
  await page.reload();

  const characterOptions = page.locator('.character-option[data-character-id]');
  const characterPreviews = characterOptions.locator('img');
  await expect(characterOptions).toHaveCount(2);
  await expect(characterPreviews).toHaveCount(2);
  const characterIds = await characterOptions.evaluateAll((options) => options.map((option) => (
    (option as HTMLElement).dataset.characterId
  )));
  expect(characterIds).toEqual([
    'pink-glasses-girl-soft-3d-toy',
    'checkered-vest-boy-soft-3d-toy'
  ]);
  const boyOption = page.locator(
    '.character-option[data-character-id="checkered-vest-boy-soft-3d-toy"]'
  );
  await expect(boyOption).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(
    () => page.evaluate(() => localStorage.getItem('rhh_endless-runner_character'))
  ).toBe('checkered-vest-boy-soft-3d-toy');

  await page.evaluate(() => {
    localStorage.setItem('rhh_endless-runner_character', 'floral-hat-girl-soft-3d-toy');
  });
  await page.reload();
  const defaultOption = page.locator(
    '.character-option[data-character-id="pink-glasses-girl-soft-3d-toy"]'
  );
  await expect(defaultOption).toHaveAttribute('aria-pressed', 'true');
  await expect(defaultOption).toHaveClass(/selected/);
  await expect(page.locator('.character-option[aria-pressed="true"]')).toHaveCount(1);
  await expect.poll(
    () => page.evaluate(() => localStorage.getItem('rhh_endless-runner_character'))
  ).toBe('pink-glasses-girl-soft-3d-toy');
  await expect.poll(
    () => characterPreviews.evaluateAll((images) => images.every((image) => {
      const preview = image as HTMLImageElement;
      return preview.complete && preview.naturalWidth > 0 && preview.naturalHeight > 0;
    })),
    { timeout: 10_000 }
  ).toBe(true);

  const characterId = 'checkered-vest-boy-soft-3d-toy';
  const selectedOption = page.locator(`.character-option[data-character-id="${characterId}"]`);
  await selectedOption.click();
  await expect(selectedOption).toHaveAttribute('aria-pressed', 'true');
  await expect(selectedOption).toHaveClass(/selected/);
  await expect(defaultOption).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.character-option[aria-pressed="true"]')).toHaveCount(1);
  await expect.poll(
    () => page.evaluate(() => localStorage.getItem('rhh_endless-runner_character'))
  ).toBe(characterId);

  await page.reload();
  await expect(selectedOption).toHaveAttribute('aria-pressed', 'true');
  await expect(selectedOption).toHaveClass(/selected/);
  await expect(page.locator('.character-option[aria-pressed="true"]')).toHaveCount(1);

  const canvas = page.locator('#er-canvas');
  const player = page.locator('#runner-character');
  await expect(canvas).toHaveAttribute('data-character', characterId);
  await page.locator('#start-btn').click();
  await expect(canvas).toHaveAttribute('data-phase', 'playing');
  await expect(canvas).toHaveAttribute('data-scene-assets-ready', 'true');
  await expect(canvas).toHaveAttribute('data-character', characterId);
  await expect(player).toHaveAttribute('data-character', characterId);
  await expect(player).toHaveAttribute('data-action', 'run');

  await expect.poll(() => player.evaluate((element) => {
    const image = element as HTMLImageElement;
    return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
  }), { timeout: 10_000 }).toBe(true);
  const playerBounds = await player.boundingBox();
  expect(playerBounds?.width).toBeGreaterThanOrEqual(92);
  expect(playerBounds?.height).toBeGreaterThanOrEqual(92);
  const initialScene = await readRunnerState(page);
  expect(initialScene.groundRatio).toBe(0.82);
  expect(initialScene.obstacleCatalog).toEqual([
    'stump',
    'thorn-patch',
    'floating-grass-platform',
    'honeybee',
    'bluebird',
    'mossy-rock'
  ]);
  const playerImageSource = await player.evaluate((element) => {
    const image = element as HTMLImageElement;
    return image.currentSrc || image.src;
  });
  expect(playerImageSource).toMatch(/(?:\.gif(?:$|[?#])|^data:image\/gif)/);
  expect(playerImageSource).toContain('checkered-vest-boy-soft-3d-toy');

  await page.keyboard.press('ArrowUp');
  await expect(canvas).toHaveAttribute('data-state', 'jumping');
  await expect(player).toHaveAttribute('data-action', 'jump');
  await expect(canvas).toHaveAttribute('data-state', 'running', { timeout: 3_000 });
  await expect(player).toHaveAttribute('data-action', 'run');

  await page.keyboard.press('ArrowDown');
  await expect(canvas).toHaveAttribute('data-state', 'sliding');
  await expect(player).toHaveAttribute('data-action', 'slide');
  await expect(canvas).toHaveAttribute('data-state', 'running', { timeout: 3_000 });
  await expect(player).toHaveAttribute('data-action', 'run');

  await expect.poll(async () => ({
    phase: await canvas.getAttribute('data-phase'),
    state: await canvas.getAttribute('data-state'),
    action: await player.getAttribute('data-action')
  }), { timeout: 20_000 }).toEqual({
    phase: 'falling',
    state: 'falling',
    action: 'fall'
  });
  await expect(canvas).toHaveAttribute('data-phase', 'ended', { timeout: 5_000 });
  await expect(page.locator('#result-overlay')).toBeVisible();
});

test('endless runner: an eight-frame slide enters, stays low while held, and exits on release', async ({ page }) => {
  test.setTimeout(15_000);
  // 첫 장애물을 높은 장애물로 고정해 슬라이드 단계 자체를 검증하는 동안 우발적인 구덩이 충돌을 막는다.
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  await page.goto('/endless-runner/');
  await page.locator('#start-btn').click();

  const canvas = page.locator('#er-canvas');
  const player = page.locator('#runner-character');
  await page.keyboard.down('ArrowDown');
  await expect(canvas).toHaveAttribute('data-state', 'sliding');
  await expect(canvas).toHaveAttribute('data-slide-phase', 'enter');
  await expect(player).toHaveAttribute('data-clip', 'slide-enter');

  await expect(canvas).toHaveAttribute('data-slide-phase', 'hold', { timeout: 1_000 });
  await expect(player).toHaveAttribute('data-clip', 'slide-hold');
  await page.waitForTimeout(500);
  await expect(canvas).toHaveAttribute('data-state', 'sliding');
  await expect(canvas).toHaveAttribute('data-slide-phase', 'hold');

  await page.keyboard.up('ArrowDown');
  await expect(canvas).toHaveAttribute('data-slide-phase', 'exit');
  await expect(player).toHaveAttribute('data-clip', 'slide-exit');
  await expect(canvas).toHaveAttribute('data-state', 'running', { timeout: 1_000 });
  await expect(player).toHaveAttribute('data-clip', 'run');
});

test('endless runner: rapid jump, slide, and stand inputs keep state and GIF clip synchronized', async ({ page }) => {
  test.setTimeout(15_000);
  // 첫 장애물 도착 전에 입력 전환만 검증할 수 있도록 높은 장애물 시퀀스로 고정한다.
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  await page.goto('/endless-runner/');

  const characterId = 'pink-glasses-girl-soft-3d-toy';
  const canvas = page.locator('#er-canvas');
  const player = page.locator('#runner-character');
  await expect(canvas).toHaveAttribute('data-assets-ready', characterId, { timeout: 10_000 });
  await page.locator('#start-btn').click();
  await expect(canvas).toHaveAttribute('data-phase', 'playing');

  await page.keyboard.down('ArrowUp');
  await page.keyboard.up('ArrowUp');
  await expect(canvas).toHaveAttribute('data-state', 'jumping');
  await expect(player).toHaveAttribute('data-action', 'jump');
  await expect(player).toHaveAttribute('data-clip', 'jump');
  await expect.poll(() => player.evaluate((element) => (element as HTMLImageElement).currentSrc))
    .toContain(`${characterId}-jump`);

  // 착지를 기다리지 않고 아래 키를 누르면 점프 물리와 화면 모두 즉시 슬라이드로 바뀐다.
  await page.keyboard.down('ArrowDown');
  await expect(canvas).toHaveAttribute('data-state', 'sliding');
  await expect(canvas).toHaveAttribute('data-slide-phase', 'enter');
  await expect(player).toHaveAttribute('data-action', 'slide');
  await expect(player).toHaveAttribute('data-clip', 'slide-enter');
  await expect.poll(() => player.evaluate((element) => (element as HTMLImageElement).currentSrc))
    .toContain(`${characterId}-slide-enter`);

  // 키를 놓는 입력은 잔여 유지 타이머를 기다리지 않고 일어서기 클립으로 전환한다.
  await page.keyboard.up('ArrowDown');
  await expect(canvas).toHaveAttribute('data-slide-phase', 'exit');
  await expect(player).toHaveAttribute('data-clip', 'slide-exit');
  await expect.poll(() => player.evaluate((element) => (element as HTMLImageElement).currentSrc))
    .toContain(`${characterId}-slide-exit`);

  // 일어서기 도중 들어온 점프도 무시하지 않고 마지막 입력으로 즉시 반영한다.
  await page.keyboard.down('ArrowUp');
  await page.keyboard.up('ArrowUp');
  await expect(canvas).toHaveAttribute('data-state', 'jumping');
  await expect(player).toHaveAttribute('data-action', 'jump');
  await expect(player).toHaveAttribute('data-clip', 'jump');
  await expect.poll(() => player.evaluate((element) => (element as HTMLImageElement).currentSrc))
    .toContain(`${characterId}-jump`);

  // 다시 숙였다가 놓으면 exit을 거쳐 달리기 GIF로 정확히 복귀한다.
  await page.keyboard.down('ArrowDown');
  await expect(canvas).toHaveAttribute('data-slide-phase', 'hold', { timeout: 1_000 });
  await expect(player).toHaveAttribute('data-clip', 'slide-hold');
  await page.keyboard.up('ArrowDown');
  await expect(player).toHaveAttribute('data-clip', 'slide-exit');
  await expect(canvas).toHaveAttribute('data-state', 'running', { timeout: 1_000 });
  await expect(player).toHaveAttribute('data-action', 'run');
  await expect(player).toHaveAttribute('data-clip', 'run');
  await expect.poll(() => player.evaluate((element) => (element as HTMLImageElement).currentSrc))
    .toContain(`${characterId}-run`);
});

test('endless runner: jumping/sliding at the right moment clears obstacles and pits', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    let seed = 0x6d2b79f5;
    Math.random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
  });
  await page.goto('/endless-runner/');
  await expect(page.locator('.game-title')).toHaveText('무한 러너');

  await page.locator('#start-btn').click();
  await expect(page.locator('#er-canvas')).toHaveAttribute('data-phase', 'playing');

  const canvas = page.locator('#er-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('endless-runner canvas has no bounding box');
  const deadline = Date.now() + 18_000;
  let highestRound = 1;
  let alignedCoinSamples = 0;
  const encounteredVisuals = new Set<string>();

  while (Date.now() < deadline) {
    const state = await readRunnerState(page);
    if (state.phase !== 'playing') break;
    highestRound = Math.max(highestRound, state.round);
    for (const obstacle of state.obstacles) encounteredVisuals.add(obstacle.visual);

    for (const coin of state.coinPaths) {
      const nearbyObstacle = state.obstacles.find((obstacle) => {
        const distance = coin.x < obstacle.x
          ? obstacle.x - coin.x
          : coin.x > obstacle.x + obstacle.width
            ? coin.x - (obstacle.x + obstacle.width)
            : 0;
        return distance <= 135;
      });
      if (!nearbyObstacle) continue;
      const expectedAction = nearbyObstacle.type === 'high' ? 'slide' : 'jump';
      expect(coin.safeAction).toBe(expectedAction);
      if (expectedAction === 'slide') expect(coin.y).toBeGreaterThanOrEqual(state.groundY - 20);
      else expect(coin.y).toBeLessThanOrEqual(state.groundY - 60);
      alignedCoinSamples += 1;
    }

    // 반응 창을 장애물 바로 앞(약 0.2초 거리)까지 좁혀야 한다 — 너무 일찍(예: 140px 밖)
    // 점프하면 특히 폭이 넓은 구덩이를 건너는 도중 체공 시간이 바닥나 착지해버린다(실제로
    // 겪은 실패 원인). 장애물이 코앞에 왔을 때 반응해야 점프 체공 시간을 최대한 활용한다.
    const upcoming = state.obstacles.find(
      (o) => o.x >= state.playerX + 10 && o.x <= state.playerX + 60
    );
    if (upcoming && state.playerState === 'running') {
      if (upcoming.type === 'high') {
        // 더블탭 타이밍에 기대는 대신, 명확한 아래로 스와이프 제스처로 슬라이드를 발동한다
        // (연속 클릭 두 번은 이 테스트 환경의 실행 지연 때문에 더블탭 판정 창을 놓치기 쉬웠다).
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 3 });
        await page.mouse.up();
      } else {
        await canvas.click();
      }
    }
    await page.waitForTimeout(35);
  }

  // 여러 장애물·구덩이를 만나고 2라운드에 진입하면서도 살아남아야 한다.
  const finalState = await readRunnerState(page);
  expect(finalState.phase).toBe('playing');
  expect(finalState.score).toBeGreaterThan(0);
  expect(highestRound).toBeGreaterThanOrEqual(2);
  expect(alignedCoinSamples).toBeGreaterThan(0);
  expect(encounteredVisuals.size).toBeGreaterThanOrEqual(2);
  expect([...encounteredVisuals].every((visual) => finalState.obstacleCatalog.includes(visual))).toBe(true);
});

test('endless runner: colliding with an obstacle ends the game and saves a ranking entry', async ({ page }) => {
  await page.goto('/endless-runner/');
  await page.evaluate(() => localStorage.removeItem('rhh_endless-runner_ranking'));
  await page.reload();

  await page.locator('#start-btn').click();
  // 아무 조작도 하지 않고 방치하면 낮은 장애물/높은 장애물/구덩이 중 하나에 반드시 걸린다.
  await expect(page.locator('#er-canvas')).toHaveAttribute('data-phase', 'ended', { timeout: 20_000 });
  await expect(page.locator('#result-overlay')).toBeVisible();

  await verifyRankingSaveAndView(page, '/endless-runner/');
});

test('endless runner: a second tap while airborne performs a double jump and ignores a third jump', async ({ page }) => {
  await page.goto('/endless-runner/');
  await page.locator('#start-btn').click();
  const canvas = page.locator('#er-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('endless-runner canvas has no bounding box');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-state', 'jumping');
  await expect(canvas).toHaveAttribute('data-jumps-used', '1');

  await page.mouse.down();
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-state', 'jumping');
  await expect(canvas).toHaveAttribute('data-jumps-used', '2');
  await expect(page.locator('#runner-character')).toHaveAttribute('data-action', 'jump');

  await page.mouse.down();
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-jumps-used', '2');
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

function emptyFarmState(overrides: Record<string, unknown> = {}) {
  return {
    coins: 0,
    totalEarned: 0,
    plots: Array.from({ length: 6 }, () => ({ crop: null, plantedAt: null })),
    yieldLevel: 0,
    speedLevel: 0,
    autoHarvester: false,
    ...overrides
  };
}

async function skipIdleFarmTutorial(page: Page) {
  await page.addInitScript(() => localStorage.setItem('rhh_idle-farm_tutorial_seen', '1'));
}

test('idle farm: planting via the crop picker grows to a harvestable state and pays out on tap', async ({ page }) => {
  const start = new Date('2026-01-01T00:00:00Z').getTime();
  await skipIdleFarmTutorial(page);
  await page.clock.install({ time: start });
  await page.goto('/idle-farm/');
  await page.evaluate((state) => localStorage.setItem('rhh_idle-farm_state', JSON.stringify(state)), emptyFarmState());
  await page.reload();

  const plot0 = page.locator('.plot').nth(0);
  await plot0.click();
  await expect(page.locator('#crop-picker-overlay')).toBeVisible();
  await page.locator('.crop-picker-btn[data-crop-id="carrot"]').click();
  await expect(page.locator('#crop-picker-overlay')).toBeHidden();
  await expect(plot0).toHaveAttribute('data-crop', 'carrot');
  await expect(plot0).toHaveAttribute('data-ready', 'false');

  // 당근 성장시간(8초)에 못 미치는 시점에서는 아직 수확할 수 없어야 한다.
  await page.clock.fastForward(7000);
  await expect(plot0).toHaveAttribute('data-ready', 'false');

  await page.clock.fastForward(2000);
  await expect(plot0).toHaveAttribute('data-ready', 'true');

  await plot0.click();
  await expect(plot0).toHaveAttribute('data-crop', '');
  await expect(page.locator('#coin-balance')).toHaveText('4');
  await expect(page.locator('#total-earned')).toHaveText('4');
});

test('idle farm: buying the yield upgrade increases coins earned per harvest', async ({ page }) => {
  const start = new Date('2026-01-01T00:00:00Z').getTime();
  await skipIdleFarmTutorial(page);
  await page.clock.install({ time: start });
  await page.goto('/idle-farm/');
  await page.evaluate((state) => localStorage.setItem('rhh_idle-farm_state', JSON.stringify(state)), emptyFarmState({ coins: 1000 }));
  await page.reload();

  await expect(page.locator('#yield-cost')).toHaveText('50코인');
  await page.locator('#upgrade-yield').click();
  await expect(page.locator('#yield-level')).toHaveText('Lv.1');
  await expect(page.locator('#coin-balance')).toHaveText('950');

  const plot0 = page.locator('.plot').nth(0);
  await plot0.click();
  await page.locator('.crop-picker-btn[data-crop-id="tomato"]').click();
  await page.clock.fastForward(25_000);
  await expect(plot0).toHaveAttribute('data-ready', 'true');
  await plot0.click();

  // 토마토 기본 수확량 15코인에 Lv.1(+10%) 보정 → round(16.5) = 17코인.
  await expect(page.locator('#total-earned')).toHaveText('17');
});

test('idle farm: buying the growth speed upgrade shortens the time until a plot is ready', async ({ page }) => {
  const start = new Date('2026-01-01T00:00:00Z').getTime();
  await skipIdleFarmTutorial(page);
  await page.clock.install({ time: start });
  await page.goto('/idle-farm/');
  await page.evaluate((state) => localStorage.setItem('rhh_idle-farm_state', JSON.stringify(state)), emptyFarmState({ coins: 1000 }));
  await page.reload();

  await page.locator('#upgrade-speed').click();
  await expect(page.locator('#speed-level')).toHaveText('Lv.1');

  const plot0 = page.locator('.plot').nth(0);
  await plot0.click();
  await page.locator('.crop-picker-btn[data-crop-id="carrot"]').click();

  // 기본 성장시간 8000ms의 92%는 7360ms. 업그레이드가 없었다면 아직 안 익었을
  // 7500ms 시점에도 Lv.1 속도 보정 덕에 이미 수확 가능해야 한다.
  await page.clock.fastForward(7500);
  await expect(plot0).toHaveAttribute('data-ready', 'true');
});

test('idle farm: the auto harvester automatically re-harvests and replants while the page stays open', async ({ page }) => {
  const start = new Date('2026-01-01T00:00:00Z').getTime();
  await skipIdleFarmTutorial(page);
  await page.clock.install({ time: start });
  await page.goto('/idle-farm/');
  await page.evaluate((state) => localStorage.setItem('rhh_idle-farm_state', JSON.stringify(state)), emptyFarmState({ coins: 1000 }));
  await page.reload();

  await page.locator('#upgrade-auto').click();
  await expect(page.locator('#auto-cost')).toHaveText('보유 중');

  const plot0 = page.locator('.plot').nth(0);
  await plot0.click();
  await page.locator('.crop-picker-btn[data-crop-id="carrot"]').click();

  // 아무것도 탭하지 않아도 자동 수확기가 스스로 수확하고 같은 작물을 다시 심는다.
  await page.clock.runFor(17_000);

  const totalEarned = Number(await page.locator('#total-earned').textContent());
  expect(totalEarned).toBeGreaterThanOrEqual(4);
  const coinBalance = Number(await page.locator('#coin-balance').textContent());
  expect(coinBalance).toBeGreaterThan(500);
  await expect(plot0).toHaveAttribute('data-crop', 'carrot');
});

test('idle farm: reopening after time away catches up multiple auto-harvest cycles at once and shows a one-time toast', async ({ page }) => {
  const start = new Date('2026-01-01T00:00:00Z').getTime();
  const seeded = emptyFarmState({ autoHarvester: true });
  (seeded as { plots: unknown[] }).plots[0] = { crop: 'carrot', plantedAt: start };
  await skipIdleFarmTutorial(page);

  // 옛 페이지가 살아있는 채로 localStorage를 직접 덮어쓰고 시계만 돌리면, 그 옛 페이지의
  // 자동 저장 틱이 먼저 깨어나 방금 덮어쓴 값을 기본값으로 되돌려버리는 레이스가 있었다
  // (구현 노트의 "테스트로 발견한 버그" 참고). addInitScript로 첫 네비게이션이 일어나기
  // 전에 값을 심어 그 경쟁 자체를 없앤 상태에서 "떠나 있던 동안"을 재현한다.
  await page.clock.install({ time: start });
  await page.addInitScript((state) => localStorage.setItem('rhh_idle-farm_state', JSON.stringify(state)), seeded);
  // 심어놓고 3.5사이클(28초)치 시간이 흐른 뒤에야 처음 열어본 상황을 재현한다.
  await page.clock.fastForward(28_000);
  await page.goto('/idle-farm/');

  await expect(page.locator('#farm-toast')).toBeVisible();
  await expect(page.locator('#farm-toast')).toContainText('12코인');
  await expect(page.locator('#total-earned')).toHaveText('12');
  await expect(page.locator('#coin-balance')).toHaveText('12');

  const plot0 = page.locator('.plot').nth(0);
  await expect(plot0).toHaveAttribute('data-crop', 'carrot');
  await expect(plot0).toHaveAttribute('data-ready', 'false');
});

test('idle farm: without the auto harvester, time away only makes a plot ready for one manual harvest', async ({ page }) => {
  const start = new Date('2026-01-01T00:00:00Z').getTime();
  const seeded = emptyFarmState();
  (seeded as { plots: unknown[] }).plots[0] = { crop: 'carrot', plantedAt: start };
  await skipIdleFarmTutorial(page);

  await page.clock.install({ time: start });
  await page.addInitScript((state) => localStorage.setItem('rhh_idle-farm_state', JSON.stringify(state)), seeded);
  await page.clock.fastForward(28_000);
  await page.goto('/idle-farm/');

  const plot0 = page.locator('.plot').nth(0);
  await expect(plot0).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#total-earned')).toHaveText('0');

  await plot0.click();
  await expect(page.locator('#total-earned')).toHaveText('4');
  await expect(plot0).toHaveAttribute('data-crop', '');
});

test('idle farm: saving a ranking entry shows it on revisit and can be exported as an image', async ({ page }) => {
  await skipIdleFarmTutorial(page);
  await page.goto('/idle-farm/');
  await page.evaluate(() => localStorage.removeItem('rhh_idle-farm_ranking'));
  await page.reload();

  await verifyRankingSaveAndView(page, '/idle-farm/');
});
