const NICKNAME_KEY = 'rhh_last_nickname';
const MAX_ENTRIES = 20;
const MAX_NAME_LENGTH = 12;

export interface RankingEntry {
  name: string;
  score: number;
  at: number;
}

function rankingKey(gameSlug: string): string {
  return `rhh_${gameSlug}_ranking`;
}

export function loadLastNickname(): string {
  return localStorage.getItem(NICKNAME_KEY) ?? '';
}

export function loadRanking(gameSlug: string): RankingEntry[] {
  try {
    const raw = localStorage.getItem(rankingKey(gameSlug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RankingEntry[];
  } catch {
    return [];
  }
}

/** 닉네임을 기록하고(다음 방문 시 재사용) 게임별 랭킹에 점수를 추가한다. 상위 20개만 유지. */
export function addRankingEntry(gameSlug: string, name: string, score: number): RankingEntry[] {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH) || '익명';
  localStorage.setItem(NICKNAME_KEY, trimmed);

  const list = loadRanking(gameSlug);
  list.push({ name: trimmed, score, at: Date.now() });
  list.sort((a, b) => b.score - a.score);
  const trimmedList = list.slice(0, MAX_ENTRIES);
  localStorage.setItem(rankingKey(gameSlug), JSON.stringify(trimmedList));
  return trimmedList;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderRankingList(container: HTMLElement, entries: RankingEntry[]) {
  if (entries.length === 0) {
    container.innerHTML = '<li class="ranking-empty">아직 기록이 없어요</li>';
    return;
  }
  container.innerHTML = entries
    .map(
      (e, i) => `
    <li class="ranking-row">
      <span class="ranking-rank">${i + 1}</span>
      <span class="ranking-name">${escapeHtml(e.name)}</span>
      <span class="ranking-score">${e.score}</span>
    </li>`
    )
    .join('');
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

function buildRankingImageCanvas(gameTitle: string, entries: RankingEntry[]): HTMLCanvasElement {
  const width = 640;
  const rowHeight = 44;
  const headerHeight = 96;
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
  c.fillText(`${gameTitle} 랭킹`, width / 2, 48);
  c.font = '700 13px Inter, sans-serif';
  c.fillStyle = 'rgba(232,244,255,0.55)';
  c.fillText('Toris Arcade', width / 2, 72);

  if (entries.length === 0) {
    c.font = '700 16px Inter, sans-serif';
    c.fillStyle = 'rgba(232,244,255,0.6)';
    c.fillText('아직 기록이 없어요', width / 2, headerHeight + rowHeight / 2);
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
      c.fillText(String(entry.score), width - 40, y + rowHeight / 2 + 6);
    });
  }

  c.textAlign = 'center';
  c.font = '600 11px Inter, sans-serif';
  c.fillStyle = 'rgba(232,244,255,0.4)';
  c.fillText(new Date().toLocaleString('ko-KR'), width / 2, height - 18);

  return canvas;
}

function rankingImageBlob(gameTitle: string, entries: RankingEntry[]): Promise<Blob | null> {
  return new Promise((resolve) => {
    buildRankingImageCanvas(gameTitle, entries).toBlob((blob) => resolve(blob), 'image/png');
  });
}

async function downloadRankingImage(gameTitle: string, entries: RankingEntry[]) {
  const blob = await rankingImageBlob(gameTitle, entries);
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

async function shareRankingImage(gameTitle: string, entries: RankingEntry[]) {
  const blob = await rankingImageBlob(gameTitle, entries);
  if (!blob) return;
  const file = new File([blob], 'ranking.png', { type: 'image/png' });
  const nav = navigator as ShareNav;
  if (!nav.canShare?.({ files: [file] }) || !nav.share) return;
  try {
    await nav.share({ files: [file], title: `${gameTitle} 랭킹`, text: `${gameTitle} 랭킹을 확인해보세요!` });
  } catch (e) {
    if ((e as Error)?.name !== 'AbortError') console.error(e);
  }
}

export interface RankingUIRefs {
  gameSlug: string;
  gameTitle: string;
  nameInput: HTMLInputElement;
  saveBtn: HTMLButtonElement;
  savedMsg: HTMLElement;
  viewRankingBtn: HTMLButtonElement;
  rankingOverlay: HTMLElement;
  rankingList: HTMLElement;
  closeRankingBtn: HTMLButtonElement;
  rankingSaveImageBtn: HTMLButtonElement;
  rankingShareImageBtn: HTMLButtonElement;
}

/**
 * 결과 화면의 닉네임 저장 폼 + 랭킹 보기 오버레이(목록 + 이미지 저장/공유) 동작을
 * 한 번에 연결한다.
 */
export function setupRankingUI(refs: RankingUIRefs, getScore: () => number) {
  refs.nameInput.value = loadLastNickname();

  refs.saveBtn.addEventListener('click', () => {
    addRankingEntry(refs.gameSlug, refs.nameInput.value, getScore());
    refs.savedMsg.classList.remove('hidden');
    refs.saveBtn.disabled = true;
  });

  refs.viewRankingBtn.addEventListener('click', () => {
    renderRankingList(refs.rankingList, loadRanking(refs.gameSlug));
    refs.rankingOverlay.classList.remove('hidden');
  });

  refs.closeRankingBtn.addEventListener('click', () => {
    refs.rankingOverlay.classList.add('hidden');
  });

  const shareNav = navigator as ShareNav;
  const shareSupported = typeof shareNav.share === 'function' && typeof shareNav.canShare === 'function';
  if (!shareSupported) refs.rankingShareImageBtn.classList.add('hidden');

  refs.rankingSaveImageBtn.addEventListener('click', () => {
    void downloadRankingImage(refs.gameTitle, loadRanking(refs.gameSlug));
  });
  refs.rankingShareImageBtn.addEventListener('click', () => {
    void shareRankingImage(refs.gameTitle, loadRanking(refs.gameSlug));
  });
}

/** 새 판이 끝나 결과 화면을 다시 보여줄 때, 직전 저장 상태(비활성화된 버튼 등)를 초기화한다. */
export function resetRankingSubmission(refs: Pick<RankingUIRefs, 'nameInput' | 'saveBtn' | 'savedMsg'>) {
  refs.nameInput.value = loadLastNickname();
  refs.saveBtn.disabled = false;
  refs.savedMsg.classList.add('hidden');
}
