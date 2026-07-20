import { expect, test, type Page } from '@playwright/test';

async function showPanel(page: Page, prefix: string, panelId: string) {
  await page.evaluate(({ gamePrefix, targetId }) => {
    document.querySelectorAll(`.${gamePrefix}-panel`).forEach((el) => el.classList.add('hidden'));
    document.querySelector(`#${targetId}`)?.classList.remove('hidden');
  }, { gamePrefix: prefix, targetId: panelId });
}

test('halligalli: five Twemoji assets load and a real flipped card uses SVG fruit images', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const loadedPaths = new Set<string>();

  host.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/assets/game-art/halligalli/twemoji/') && response.ok()) {
      loadedPaths.add(path);
    }
  });

  try {
    await host.goto('/halligalli/');
    await expect(host.locator('#hg-board')).toHaveAttribute('data-asset-state', 'ready');
    expect([...loadedPaths].sort()).toEqual([
      '/assets/game-art/halligalli/twemoji/banana.svg',
      '/assets/game-art/halligalli/twemoji/bell.svg',
      '/assets/game-art/halligalli/twemoji/grape.svg',
      '/assets/game-art/halligalli/twemoji/lime.svg',
      '/assets/game-art/halligalli/twemoji/strawberry.svg'
    ]);
    expect(await host.locator('.hg-bell-icon').evaluate((image) => {
      const img = image as HTMLImageElement;
      return img.complete && img.naturalWidth > 0;
    })).toBe(true);

    await host.locator('#nickname').fill('그래픽호스트');
    await host.locator('#capacity-input').fill('2');
    await host.locator('#create-btn').click();
    await expect(host.locator('#lobby-panel')).toBeVisible();
    const roomCode = (await host.locator('#lobby-code-display').textContent())?.trim() ?? '';
    expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);

    await guest.goto('/halligalli/');
    await guest.locator('#nickname').fill('그래픽게스트');
    await guest.locator('#tab-join').click();
    await guest.locator('#room-code-input').fill(roomCode);
    await guest.locator('#join-btn').click();
    await expect(guest.locator('#lobby-panel')).toBeVisible();
    await expect(host.locator('#start-btn')).toBeVisible();
    await host.locator('#start-btn').click();
    await expect(host.locator('#playing-panel')).toBeVisible();
    await expect(guest.locator('#playing-panel')).toBeVisible();
    await expect(host.locator('.hg-bell-icon')).toBeVisible();

    await expect.poll(async () => {
      if (await host.locator('#flip-btn').isEnabled()) return 'host';
      if (await guest.locator('#flip-btn').isEnabled()) return 'guest';
      return 'none';
    }).not.toBe('none');

    const actor = await host.locator('#flip-btn').isEnabled() ? host : guest;
    await actor.locator('#flip-btn').click();
    await expect.poll(() => host.locator('.hg-fruit-icon').count()).toBeGreaterThan(0);
    const fruitImage = host.locator('.hg-fruit-icon').first();
    await expect(fruitImage).toBeVisible();
    expect(await fruitImage.evaluate((image) => {
      const img = image as HTMLImageElement;
      return img.complete && img.naturalWidth > 0;
    })).toBe(true);
    await expect(host.locator('.hg-fruit-icons')).toHaveAttribute('aria-label', /개$/);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test('halligalli: a failed fruit asset switches cards to the text fallback', async ({ page }) => {
  await page.route('**/assets/game-art/halligalli/twemoji/grape.svg', (route) => route.abort());
  await page.goto('/halligalli/');
  await expect(page.locator('#hg-board')).toHaveAttribute('data-asset-state', 'fallback');

  await showPanel(page, 'hg', 'playing-panel');
  await page.locator('#hg-board').evaluate((board) => {
    board.innerHTML = `
      <div class="hg-pile">
        <div class="hg-top-card">
          <span class="hg-fruit-count">2</span>
          <span class="hg-fruit-icons count-2" aria-label="포도 2개">
            <span class="hg-fruit-item"><img class="hg-fruit-icon" src="/assets/game-art/halligalli/twemoji/grape.svg" alt="" /><span class="hg-fruit-fallback">포</span></span>
            <span class="hg-fruit-item"><img class="hg-fruit-icon" src="/assets/game-art/halligalli/twemoji/grape.svg" alt="" /><span class="hg-fruit-fallback">포</span></span>
          </span>
        </div>
      </div>`;
  });

  await expect(page.locator('.hg-fruit-icon').first()).toBeHidden();
  await expect(page.locator('.hg-fruit-fallback').first()).toBeVisible();
  await expect(page.locator('.hg-fruit-fallback').first()).toHaveText('포');
});

test('tug-of-war: mascot arena loads and a real match moves the accessible flag', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  let arenaResponseOk = false;

  host.on('response', (response) => {
    if (new URL(response.url()).pathname === '/assets/game-art/tug-of-war-battle/arena.webp') {
      arenaResponseOk = response.ok();
    }
  });

  try {
    await host.goto('/tug-of-war-battle/');
    await expect(host.locator('#tw-arena')).toHaveAttribute('data-asset-state', 'ready');
    expect(arenaResponseOk).toBe(true);

    await host.locator('#nickname').fill('줄다리기호스트');
    await host.locator('#create-btn').click();
    await expect(host.locator('#waiting-opponent-panel')).toBeVisible();
    const roomCode = (await host.locator('#lobby-code-display').textContent())?.trim() ?? '';
    expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);

    await guest.goto('/tug-of-war-battle/');
    await guest.locator('#nickname').fill('줄다리기게스트');
    await guest.locator('#tab-join').click();
    await guest.locator('#room-code-input').fill(roomCode);
    await guest.locator('#join-btn').click();

    await expect(host.locator('#playing-panel')).toBeVisible({ timeout: 8_000 });
    await expect(guest.locator('#playing-panel')).toBeVisible({ timeout: 8_000 });
    await expect(host.locator('#tw-arena')).toBeVisible();
    await expect(host.locator('#rope-track')).toHaveAttribute('aria-valuenow', '50');

    await host.locator('#tap-btn').click();
    await expect.poll(
      async () => Number(await host.locator('#rope-track').getAttribute('aria-valuenow')),
      { timeout: 3_000 },
    ).not.toBe(50);

    const markerLeft = Number.parseFloat(await host.locator('#rope-marker').evaluate(
      (marker) => (marker as HTMLElement).style.left,
    ));
    expect(markerLeft).toBeGreaterThanOrEqual(0);
    expect(markerLeft).toBeLessThanOrEqual(100);
    await expect(host.locator('#rope-track')).toHaveAttribute('aria-valuetext', /(왼쪽|오른쪽) \d+/);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test('tug-of-war: failed arena request keeps the CSS fallback and rope semantics', async ({ page }) => {
  await page.route('**/assets/game-art/tug-of-war-battle/arena.webp', (route) => route.abort());
  await page.goto('/tug-of-war-battle/');
  await expect(page.locator('#tw-arena')).toHaveAttribute('data-asset-state', 'fallback');

  await showPanel(page, 'tw', 'playing-panel');
  await expect(page.locator('#tw-arena')).toBeVisible();
  await expect(page.locator('#tw-arena')).toHaveCSS('background-image', /gradient/);
  await expect(page.locator('#rope-track')).toHaveAttribute('role', 'progressbar');
  await expect(page.locator('#rope-track')).toHaveAttribute('aria-valuenow', '50');
});

test('light-guess: playground loads and a real match keeps the signal as semantic DOM', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  let playgroundResponseOk = false;

  host.on('response', (response) => {
    if (new URL(response.url()).pathname === '/assets/game-art/light-guess/playground.webp') {
      playgroundResponseOk = response.ok();
    }
  });

  try {
    await host.goto('/light-guess/');
    await expect(host.locator('#playing-panel')).toHaveAttribute('data-asset-state', 'ready');
    expect(playgroundResponseOk).toBe(true);

    await host.locator('#nickname').fill('불빛호스트');
    await host.locator('#capacity-input').fill('2');
    await host.locator('#create-btn').click();
    await expect(host.locator('#lobby-panel')).toBeVisible();
    const roomCode = (await host.locator('#lobby-code-display').textContent())?.trim() ?? '';
    expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);

    await guest.goto('/light-guess/');
    await guest.locator('#nickname').fill('불빛게스트');
    await guest.locator('#tab-join').click();
    await guest.locator('#room-code-input').fill(roomCode);
    await guest.locator('#join-btn').click();
    await expect(host.locator('#start-btn')).toBeVisible();
    await host.locator('#start-btn').click();

    await expect(host.locator('#playing-panel')).toBeVisible({ timeout: 8_000 });
    await expect(guest.locator('#playing-panel')).toBeVisible({ timeout: 8_000 });
    await expect(host.locator('#lg-status-msg')).toHaveText('초록불! 계속 탭하세요!');
    await expect(host.locator('#lg-light')).toHaveAttribute('aria-label', '초록불, 계속 탭하세요');
    await expect(host.locator('#lg-light')).toHaveCSS('background-color', 'rgb(57, 71, 75)');
    await expect(host.locator('#playing-panel')).toHaveCSS('background-image', /playground\.webp/);
    await host.locator('#tap-area-btn').dispatchEvent('pointerdown');
    await guest.locator('#tap-area-btn').dispatchEvent('pointerdown');
    await expect(host.locator('#lg-light')).toHaveAttribute(
      'aria-label',
      '빨간불, 멈추세요',
      { timeout: 6_000 },
    );
    await expect(host.locator('#lg-status-msg')).toHaveText('빨간불! 손을 멈추세요!');
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test('light-guess: failed playground request preserves the signal and CSS track fallback', async ({ page }) => {
  await page.route('**/assets/game-art/light-guess/playground.webp', (route) => route.abort());
  await page.goto('/light-guess/');
  await expect(page.locator('#playing-panel')).toHaveAttribute('data-asset-state', 'fallback');

  await showPanel(page, 'lg', 'playing-panel');
  await expect(page.locator('#playing-panel')).toBeVisible();
  await expect(page.locator('#playing-panel')).toHaveCSS('background-image', /gradient/);
  await expect(page.locator('#lg-light')).toHaveAttribute('role', 'img');
  await expect(page.locator('#lg-light')).toHaveAttribute('aria-label', '신호 대기');
  await expect(page.locator('#tap-area-btn')).toBeVisible();
});
