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
