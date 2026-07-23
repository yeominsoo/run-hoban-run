const NICKNAME_KEY = 'rhh_last_nickname';
const MAX_ENTRIES = 20;
const MAX_NAME_LENGTH = 12;
const GLOBAL_SYNC_SUFFIX = '_global_sync';
const syncPromises = new Map<string, Promise<boolean>>();

export interface RankingEntry {
  name: string;
  score: number;
  at: number;
}

function rankingKey(gameSlug: string): string {
  return `rhh_${gameSlug}_ranking`;
}

function globalSyncKey(gameSlug: string): string {
  return `${rankingKey(gameSlug)}${GLOBAL_SYNC_SUFFIX}`;
}

function scoreRankingApiBase(): string {
  const configured = import.meta.env.VITE_SCORE_RANKING_URL as string | undefined;
  if (configured) return configured.replace(/\/+$/, '');

  const rpsWsUrl = import.meta.env.VITE_RPS_WS_URL as string | undefined;
  if (rpsWsUrl) {
    return rpsWsUrl
      .replace(/^wss:/, 'https:')
      .replace(/^ws:/, 'http:')
      .replace(/\/rps\/?$/, '/ranking/score');
  }

  const protocol = location.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//${location.hostname}:8787/ranking/score`;
}

function scoreRankingUrl(gameSlug: string): string {
  return `${scoreRankingApiBase()}/${encodeURIComponent(gameSlug)}`;
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

function parseRemoteRanking(value: unknown): RankingEntry[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { entries?: unknown }).entries)) return [];

  return (value as { entries: unknown[] }).entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const { name, score, at } = entry as Partial<RankingEntry>;
      if (typeof name !== 'string' || !Number.isSafeInteger(score) || Number(score) < 0) return null;
      return {
        name: name.slice(0, MAX_NAME_LENGTH),
        score: Number(score),
        at: Number.isSafeInteger(at) && Number(at) > 0 ? Number(at) : Date.now(),
      };
    })
    .filter((entry): entry is RankingEntry => entry !== null);
}

async function syncRanking(gameSlug: string, entries: RankingEntry[]): Promise<boolean> {
  if (entries.length === 0) return true;

  const signature = JSON.stringify(entries);
  if (localStorage.getItem(globalSyncKey(gameSlug)) === signature) return true;

  try {
    const response = await fetch(scoreRankingUrl(gameSlug), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    if (!response.ok) return false;
    localStorage.setItem(globalSyncKey(gameSlug), signature);
    return true;
  } catch {
    return false;
  }
}

function queueRankingSync(gameSlug: string, entries: RankingEntry[]): Promise<boolean> {
  const pending = syncRanking(gameSlug, entries);
  syncPromises.set(gameSlug, pending);
  void pending.finally(() => {
    if (syncPromises.get(gameSlug) === pending) syncPromises.delete(gameSlug);
  });
  return pending;
}

async function loadGlobalRanking(gameSlug: string): Promise<RankingEntry[]> {
  const pendingSync = syncPromises.get(gameSlug);
  if (pendingSync) await pendingSync;

  const response = await fetch(scoreRankingUrl(gameSlug));
  if (!response.ok) throw new Error(`ranking HTTP ${response.status}`);
  return parseRemoteRanking(await response.json());
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
  let displayedEntries = loadRanking(refs.gameSlug);

  const rankingTitle = refs.rankingOverlay.querySelector<HTMLElement>('.overlay-card h2');
  if (rankingTitle) rankingTitle.textContent = '전체 점수 랭킹';
  const rankingScope = document.createElement('p');
  rankingScope.className = 'ranking-scope';
  rankingScope.textContent = '전체 사용자 기록을 불러옵니다.';
  rankingTitle?.after(rankingScope);

  // 싱글 게임의 랭킹 버튼은 원래 시작 오버레이 안에만 있었다. 공용 헤더를 쓰는
  // 게임에서는 같은 버튼을 헤더 우측으로 옮겨 시작 전/플레이 중/결과 화면 모두에서
  // 접근할 수 있게 한다. 버튼 노드를 재사용하므로 이벤트와 id가 중복되지 않는다.
  const gameHeader = document.querySelector<HTMLElement>('.game-header');
  if (gameHeader && !gameHeader.contains(refs.viewRankingBtn)) {
    refs.viewRankingBtn.classList.add('header-ranking-btn');
    refs.viewRankingBtn.setAttribute('aria-label', `${refs.gameTitle} 전체 랭킹 보기`);
    gameHeader.append(refs.viewRankingBtn);
  }

  refs.saveBtn.addEventListener('click', () => {
    const entries = addRankingEntry(refs.gameSlug, refs.nameInput.value, getScore());
    displayedEntries = entries;
    void queueRankingSync(refs.gameSlug, entries);
    refs.savedMsg.classList.remove('hidden');
    refs.saveBtn.disabled = true;
  });

  refs.viewRankingBtn.addEventListener('click', () => {
    displayedEntries = loadRanking(refs.gameSlug);
    renderRankingList(refs.rankingList, displayedEntries);
    rankingScope.textContent = '전체 사용자 기록을 불러오는 중…';
    refs.rankingOverlay.classList.remove('hidden');

    // 첫 진입 때 서버가 잠시 불안정했더라도 랭킹을 열면 로컬 기록 병합을 다시 시도한다.
    void queueRankingSync(refs.gameSlug, displayedEntries);
    void loadGlobalRanking(refs.gameSlug)
      .then((entries) => {
        displayedEntries = entries;
        renderRankingList(refs.rankingList, displayedEntries);
        rankingScope.textContent = '모든 기기에서 등록한 최고 점수';
      })
      .catch(() => {
        rankingScope.textContent = '서버 연결이 원활하지 않아 이 기기 기록을 표시합니다.';
      });
  });

  refs.closeRankingBtn.addEventListener('click', () => {
    refs.rankingOverlay.classList.add('hidden');
  });

  const shareNav = navigator as ShareNav;
  const shareSupported = typeof shareNav.share === 'function' && typeof shareNav.canShare === 'function';
  if (!shareSupported) refs.rankingShareImageBtn.classList.add('hidden');

  refs.rankingSaveImageBtn.addEventListener('click', () => {
    void downloadRankingImage(refs.gameTitle, displayedEntries);
  });
  refs.rankingShareImageBtn.addEventListener('click', () => {
    void shareRankingImage(refs.gameTitle, displayedEntries);
  });

  // 업데이트 전 이 기기에 저장돼 있던 기록도 첫 방문 때 전체 랭킹으로 합친다.
  void queueRankingSync(refs.gameSlug, displayedEntries);
}

/** 새 판이 끝나 결과 화면을 다시 보여줄 때, 직전 저장 상태(비활성화된 버튼 등)를 초기화한다. */
export function resetRankingSubmission(refs: Pick<RankingUIRefs, 'nameInput' | 'saveBtn' | 'savedMsg'>) {
  refs.nameInput.value = loadLastNickname();
  refs.saveBtn.disabled = false;
  refs.savedMsg.classList.add('hidden');
}
