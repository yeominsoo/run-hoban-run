export interface WsRankingEntry {
  name: string;
  wins: number;
  losses: number;
}

interface WsRankingResponse {
  week: string;
  entries: WsRankingEntry[];
  prevWeek: string;
}

/** RPS와 동일한 방식(wss→https, ws→http)으로 WS URL에서 랭킹 HTTP URL을 유도한다. */
export function toRankingUrl(wsUrl: string, gameKey: string): string {
  return wsUrl
    .replace(/^wss:/, 'https:')
    .replace(/^ws:/, 'http:')
    .replace(new RegExp(`/${gameKey}$`), `/ranking/${gameKey}`);
}

function drawRoundedRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function buildRankingImageCanvas(gameTitle: string, week: string, entries: WsRankingEntry[]): HTMLCanvasElement {
  const width = 640;
  const rowHeight = 48;
  const headerHeight = 104;
  const footerHeight = 44;
  const rowsHeight = (entries.length === 0 ? 1 : entries.length) * rowHeight;
  const height = headerHeight + rowsHeight + footerHeight;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext('2d')!;

  const bg = c.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, '#132338');
  bg.addColorStop(1, '#0b1622');
  c.fillStyle = bg;
  c.fillRect(0, 0, width, height);

  c.textAlign = 'center';
  c.fillStyle = '#f0f9ff';
  c.font = '900 28px Inter, sans-serif';
  c.fillText(`${gameTitle} 이번 주 랭킹`, width / 2, 46);
  c.font = '700 13px Inter, sans-serif';
  c.fillStyle = 'rgba(232,244,255,0.55)';
  c.fillText(`Toris Arcade · ${week}`, width / 2, 70);

  if (entries.length === 0) {
    c.font = '700 16px Inter, sans-serif';
    c.fillStyle = 'rgba(232,244,255,0.6)';
    c.fillText('아직 이번 주 기록이 없어요', width / 2, headerHeight + rowHeight / 2);
  } else {
    entries.forEach((entry, i) => {
      const y = headerHeight + i * rowHeight;
      const isFirst = i === 0;

      c.fillStyle = isFirst ? 'rgba(255,214,102,0.14)' : i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.015)';
      drawRoundedRect(c, 24, y + 4, width - 48, rowHeight - 8, 10);
      c.fill();

      c.textAlign = 'left';
      c.font = '800 16px Inter, sans-serif';
      c.fillStyle = isFirst ? '#ffe08a' : 'rgba(126,200,248,0.9)';
      c.fillText(`${i + 1}위`, 40, y + rowHeight / 2 + 6);

      c.font = '700 15px Inter, sans-serif';
      c.fillStyle = isFirst ? '#fff4d6' : '#eaf6ff';
      c.fillText(entry.name, 96, y + rowHeight / 2 + 6);

      c.textAlign = 'right';
      c.font = '900 17px Inter, sans-serif';
      c.fillStyle = isFirst ? '#ffe08a' : '#eaf6ff';
      c.fillText(`${entry.wins}승`, width - 40, y + rowHeight / 2 + 6);
      c.font = '700 13px Inter, sans-serif';
      c.fillStyle = 'rgba(232,244,255,0.5)';
      c.fillText(`${entry.losses}패`, width - 90, y + rowHeight / 2 + 6);
    });
  }

  c.textAlign = 'center';
  c.font = '600 11px Inter, sans-serif';
  c.fillStyle = 'rgba(232,244,255,0.4)';
  c.fillText(new Date().toLocaleString('ko-KR'), width / 2, height - 18);

  return canvas;
}

function rankingImageBlob(gameTitle: string, week: string, entries: WsRankingEntry[]): Promise<Blob | null> {
  return new Promise((resolve) => {
    buildRankingImageCanvas(gameTitle, week, entries).toBlob((blob) => resolve(blob), 'image/png');
  });
}

async function downloadRankingImage(gameTitle: string, week: string, entries: WsRankingEntry[]) {
  const blob = await rankingImageBlob(gameTitle, week, entries);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `${gameTitle}-랭킹-${stamp}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type ShareNav = Navigator & {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
};

async function shareRankingImage(gameTitle: string, week: string, entries: WsRankingEntry[]) {
  const blob = await rankingImageBlob(gameTitle, week, entries);
  if (!blob) return;
  const file = new File([blob], 'ranking.png', { type: 'image/png' });
  const nav = navigator as ShareNav;
  if (!nav.canShare?.({ files: [file] }) || !nav.share) return;
  try {
    await nav.share({ files: [file], title: `${gameTitle} 랭킹`, text: `${gameTitle} 이번 주 랭킹을 확인해보세요!` });
  } catch (e) {
    if ((e as Error)?.name !== 'AbortError') console.error(e);
  }
}

export interface WsRankingRefs {
  gameKey: string;
  gameTitle: string;
  wsUrl: string;
  openBtn: HTMLButtonElement;
  overlay: HTMLElement;
  closeBtn: HTMLButtonElement;
  weekEl: HTMLElement;
  tabBtns: HTMLButtonElement[];
  bodyEl: HTMLElement;
  saveImageBtn: HTMLButtonElement;
  shareImageBtn: HTMLButtonElement;
}

/**
 * 서버 파일 기반 승/패 랭킹(주간)을 조회·렌더링하고, 이미지 저장/공유까지 배선한다.
 * RPS는 모드별 집계라는 다른 응답 스키마를 쓰기 때문에 이 모듈을 쓰지 않는다.
 */
export function setupWsRankingUI(refs: WsRankingRefs) {
  const rankingUrl = toRankingUrl(refs.wsUrl, refs.gameKey);
  let currentEntries: WsRankingEntry[] = [];
  let currentWeek = '';
  let prevWeek = '';

  const shareNav = navigator as ShareNav;
  const shareSupported = typeof shareNav.share === 'function' && typeof shareNav.canShare === 'function';
  if (!shareSupported) refs.shareImageBtn.classList.add('hidden');

  async function fetchAndShow(weekParam: 'current' | 'prev') {
    refs.overlay.classList.remove('hidden');
    refs.bodyEl.innerHTML = '<div class="ws-ranking-loading"><div class="ws-ranking-spinner"></div></div>';

    const url = weekParam === 'prev' && prevWeek ? `${rankingUrl}?week=${encodeURIComponent(prevWeek)}` : rankingUrl;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: WsRankingResponse = await res.json();

      prevWeek = data.prevWeek;
      currentWeek = data.week;
      currentEntries = data.entries;
      refs.weekEl.textContent = data.week;

      if (data.entries.length === 0) {
        refs.bodyEl.innerHTML = '<p class="ws-ranking-empty">아직 이번 주 기록이 없어요.</p>';
        return;
      }

      const medal: Record<number, string> = { 0: '🥇', 1: '🥈', 2: '🥉' };
      refs.bodyEl.innerHTML = data.entries
        .map((e, i) => `
          <div class="ws-ranking-row${i < 3 ? ' top' : ''}">
            <span class="ws-ranking-rank">${medal[i] ?? i + 1}</span>
            <span class="ws-ranking-name">${escapeHtml(e.name)}</span>
            <span class="ws-ranking-record">${e.wins}승 <span class="ws-ranking-losses">${e.losses}패</span></span>
          </div>`)
        .join('');
    } catch {
      refs.bodyEl.innerHTML = '<p class="ws-ranking-empty">랭킹을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
    }
  }

  function close() {
    refs.overlay.classList.add('hidden');
  }

  refs.openBtn.addEventListener('click', () => {
    refs.tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.week === 'current'));
    void fetchAndShow('current');
  });
  refs.closeBtn.addEventListener('click', close);
  refs.overlay.addEventListener('click', (e) => { if (e.target === refs.overlay) close(); });
  refs.tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      refs.tabBtns.forEach((b) => b.classList.toggle('active', b === btn));
      void fetchAndShow((btn.dataset.week as 'current' | 'prev') ?? 'current');
    });
  });

  refs.saveImageBtn.addEventListener('click', () => {
    void downloadRankingImage(refs.gameTitle, currentWeek, currentEntries);
  });
  refs.shareImageBtn.addEventListener('click', () => {
    void shareRankingImage(refs.gameTitle, currentWeek, currentEntries);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
