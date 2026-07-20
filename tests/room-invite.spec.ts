import { expect, test } from '@playwright/test';

const gameSlugs = [
  'rps',
  'liar',
  'mafia',
  'halligalli',
  'yutnori',
  'strategy-yutnori',
  'mole-hunt',
  'memory-sequence',
  'updown-number',
  'multiplication-sprint',
  'odd-even-math',
  'color-instruction',
  'sum-ten-puzzle',
  'tug-of-war-battle',
  'territory-clash',
  'light-guess',
  'reversi',
  'gomoku',
] as const;

test.describe('room invite QR', () => {
  test.skip(!process.env.ROOM_INVITE_E2E, 'Run with npm run test:room-invite');

  for (const slug of gameSlugs) {
    test(`${slug} creates a scannable room QR without mobile overflow`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${slug}/`);

      if (slug === 'sum-ten-puzzle') {
        await page.locator('#tab-create').click();
        await page.locator('#nickname-create').fill(`QR-${slug}`);
      } else {
        await page.locator('#nickname').fill(`QR-${slug}`);
      }

      await page.locator('#create-btn').click();
      const shareButton = page.locator('#copy-link-btn:visible, #lobby-copy-btn:visible').first();
      await expect(shareButton).toBeVisible();
      await shareButton.click();
      await expect(page.locator('.room-invite-backdrop')).toBeVisible();

      const qrState = await page.locator('.room-invite-qr').evaluate((canvas: HTMLCanvasElement) => {
        const context = canvas.getContext('2d');
        if (!context) return { darkPixels: 0, width: 0, height: 0 };
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let darkPixels = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] < 150 && pixels[index + 1] < 150 && pixels[index + 2] < 150) {
            darkPixels += 1;
          }
        }
        return { darkPixels, width: canvas.width, height: canvas.height };
      });

      expect(qrState).toEqual({
        darkPixels: expect.any(Number),
        width: 240,
        height: 240,
      });
      expect(qrState.darkPixels).toBeGreaterThan(1_000);
      await expect(page.locator('.room-invite-code')).toContainText(/방 코드 [A-F0-9]{6}/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    });
  }

  test('an invite URL opens the join tab with its room code prefilled', async ({ page }) => {
    await page.goto('/liar/?room=A1B2C3');
    await expect(page.locator('#tab-join')).toHaveClass(/active/);
    await expect(page.locator('#room-code-input')).toHaveValue('A1B2C3');
    await expect(page.locator('#room-code-input')).toBeHidden();
    await expect(page.locator('.room-invite-entry-note')).toHaveText('초대받은 방 A1B2C3');
    await expect(page.locator('#join-btn')).toHaveText('닉네임 확인 후 참가하기');
    await expect(page.locator('#join-section')).toBeVisible();
  });

  test('returning from a native share reopens the same room socket', async ({ page }) => {
    await page.addInitScript(() => {
      const state = window as typeof window & { __roomInviteSocketCount: number };
      state.__roomInviteSocketCount = 0;
      window.WebSocket = new Proxy(window.WebSocket, {
        construct(target, args) {
          state.__roomInviteSocketCount += 1;
          return new target(...args);
        },
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async () => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
          document.dispatchEvent(new Event('visibilitychange'));
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
          document.dispatchEvent(new Event('visibilitychange'));
        },
      });
    });

    await page.goto('/rps/');
    await page.locator('#nickname').fill('공유복귀');
    await page.locator('#create-btn').click();
    await expect(page.locator('#copy-link-btn')).toBeVisible();

    const roomCode = await page.locator('#room-code-display').textContent();
    const socketsBefore = await page.evaluate(
      () => (window as typeof window & { __roomInviteSocketCount: number }).__roomInviteSocketCount,
    );

    await page.locator('#copy-link-btn').click();
    await page.getByRole('button', { name: '다른 앱으로 공유' }).click();
    await page.waitForFunction(
      (before) => (window as typeof window & { __roomInviteSocketCount: number }).__roomInviteSocketCount > before,
      socketsBefore,
    );
    await expect(page.locator('#room-share')).toBeVisible();
    await expect(page.locator('#room-code-display')).toHaveText(roomCode ?? '');
  });
});
