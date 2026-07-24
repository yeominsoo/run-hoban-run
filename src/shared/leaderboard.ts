const NICKNAME_KEY = 'rhh_last_nickname';
const MAX_ENTRIES = 20;
const MAX_GLOBAL_ENTRIES = 50;
const MAX_NAME_LENGTH = 12;
const GLOBAL_SYNC_SUFFIX = '_global_sync';
const syncPromises = new Map<string, Promise<boolean>>();

export interface RankingEntry {
  name: string;
  score: number;
  at: number;
  distance?: number;
  coins?: number;
  /** 통합 랭킹(`/ranking/score/_all`) 항목에만 붙는, 기록이 나온 게임 슬러그/표시명 */
  game?: string;
  gameTitle?: string;
}

export type RankingEntryDetails = Pick<RankingEntry, 'distance' | 'coins'>;

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

function combinedRankingUrl(): string {
  return `${scoreRankingApiBase()}/_all`;
}

function collapseBestScores(values: unknown[], limit: number): RankingEntry[] {
  const bestByName = new Map<string, RankingEntry>();

  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const candidate = value as Partial<RankingEntry>;
    const name = typeof candidate.name === 'string'
      ? candidate.name.trim().slice(0, MAX_NAME_LENGTH)
      : '';
    const score = Number(candidate.score);
    const at = Number(candidate.at);
    if (!name || !Number.isSafeInteger(score) || score < 0) continue;

    const entry: RankingEntry = {
      name,
      score,
      at: Number.isSafeInteger(at) && at > 0 ? at : 0,
    };
    const distance = Number(candidate.distance);
    const coins = Number(candidate.coins);
    if (Number.isSafeInteger(distance) && distance >= 0) entry.distance = distance;
    if (Number.isSafeInteger(coins) && coins >= 0) entry.coins = coins;

    const current = bestByName.get(name);
    const entryDetailCount = Number(entry.distance !== undefined) + Number(entry.coins !== undefined);
    const currentDetailCount = current
      ? Number(current.distance !== undefined) + Number(current.coins !== undefined)
      : -1;
    if (
      !current
      || entry.score > current.score
      || (
        entry.score === current.score
        && (
          entryDetailCount > currentDetailCount
          || (entryDetailCount === currentDetailCount && entry.at < current.at)
        )
      )
    ) {
      bestByName.set(name, entry);
    }
  }

  return [...bestByName.values()]
    .sort((a, b) => b.score - a.score || a.at - b.at || a.name.localeCompare(b.name, 'ko'))
    .slice(0, limit);
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
    const collapsed = collapseBestScores(parsed, MAX_ENTRIES);
    if (JSON.stringify(collapsed) !== JSON.stringify(parsed)) {
      localStorage.setItem(rankingKey(gameSlug), JSON.stringify(collapsed));
    }
    return collapsed;
  } catch {
    return [];
  }
}

/** 닉네임을 기록하고 게임별 랭킹에 점수를 추가한다. 닉네임별 최고점 하나, 상위 20명만 유지. */
export function addRankingEntry(
  gameSlug: string,
  name: string,
  score: number,
  details: RankingEntryDetails = {},
): RankingEntry[] {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH) || '익명';
  localStorage.setItem(NICKNAME_KEY, trimmed);

  const trimmedList = collapseBestScores([
    ...loadRanking(gameSlug),
    { name: trimmed, score, at: Date.now(), ...details },
  ], MAX_ENTRIES);
  localStorage.setItem(rankingKey(gameSlug), JSON.stringify(trimmedList));
  return trimmedList;
}

/**
 * 통합 랭킹은 게임마다 별도 줄로 남아야 하므로(같은 닉네임이 여러 게임에 등장 가능),
 * 닉네임 기준으로 합치는 collapseBestScores를 쓰지 않고 항목별로 검증만 한다.
 */
function parseCombinedRanking(value: unknown): RankingEntry[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { entries?: unknown }).entries)) return [];
  const result: RankingEntry[] = [];
  for (const raw of (value as { entries: unknown[] }).entries) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as Partial<RankingEntry>;
    const name = typeof candidate.name === 'string' ? candidate.name.trim().slice(0, MAX_NAME_LENGTH) : '';
    const score = Number(candidate.score);
    const at = Number(candidate.at);
    if (!name || !Number.isSafeInteger(score) || score < 0) continue;

    const entry: RankingEntry = {
      name,
      score,
      at: Number.isSafeInteger(at) && at > 0 ? at : 0,
    };
    if (typeof candidate.game === 'string') entry.game = candidate.game;
    if (typeof candidate.gameTitle === 'string') entry.gameTitle = candidate.gameTitle;
    const distance = Number(candidate.distance);
    const coins = Number(candidate.coins);
    if (Number.isSafeInteger(distance) && distance >= 0) entry.distance = distance;
    if (Number.isSafeInteger(coins) && coins >= 0) entry.coins = coins;
    result.push(entry);
  }
  return result.slice(0, MAX_GLOBAL_ENTRIES);
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

/** 점수 랭킹을 지원하는 10개 싱글게임 전체를 하나로 합친 랭킹을 서버에서 가져온다. */
async function loadCombinedRanking(): Promise<RankingEntry[]> {
  const response = await fetch(combinedRankingUrl());
  if (!response.ok) throw new Error(`ranking HTTP ${response.status}`);
  return parseCombinedRanking(await response.json());
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
    .map((e, i) => {
      const hasDetails = e.distance !== undefined || e.coins !== undefined;
      const nameBlock = e.gameTitle
        ? `<span class="ranking-name-group">
            <span class="ranking-name">${escapeHtml(e.name)}</span>
            <span class="ranking-game">${escapeHtml(e.gameTitle)}</span>
          </span>`
        : `<span class="ranking-name">${escapeHtml(e.name)}</span>`;
      return `
    <li class="ranking-row${hasDetails ? ' runner-ranking-row' : ''}">
      <span class="ranking-rank">${i + 1}</span>
      ${nameBlock}
      <span class="ranking-record">
        <span class="ranking-score">${hasDetails ? `점수 ${e.score}` : e.score}</span>
        ${hasDetails ? `
          <span class="ranking-details">
            <span>거리 ${e.distance === undefined ? '-' : `${e.distance}m`}</span>
            <span>코인 ${e.coins === undefined ? '-' : `${e.coins}개`}</span>
          </span>
        ` : ''}
      </span>
    </li>`;
    })
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

const COMBINED_RANKING_TITLE = 'Toris Arcade 종합 랭킹';

function buildRankingImageCanvas(entries: RankingEntry[]): HTMLCanvasElement {
  const width = 640;
  const rowHeight = 58;
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
  c.font = '900 26px Inter, sans-serif';
  c.fillText(COMBINED_RANKING_TITLE, width / 2, 48);
  c.font = '700 13px Inter, sans-serif';
  c.fillStyle = 'rgba(232,244,255,0.55)';
  c.fillText('점수 랭킹을 지원하는 모든 게임 통합', width / 2, 72);

  if (entries.length === 0) {
    c.font = '700 16px Inter, sans-serif';
    c.fillStyle = 'rgba(232,244,255,0.6)';
    c.fillText('아직 기록이 없어요', width / 2, headerHeight + rowHeight / 2);
  } else {
    entries.forEach((entry, i) => {
      const y = headerHeight + i * rowHeight;
      const isFirst = i === 0;
      const hasDetails = entry.distance !== undefined || entry.coins !== undefined;

      c.fillStyle = isFirst ? 'rgba(255,214,102,0.14)' : i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.015)';
      drawRoundedRect(c, 24, y + 4, width - 48, rowHeight - 8, 10);
      c.fill();

      c.textAlign = 'left';
      c.font = '800 16px Inter, sans-serif';
      c.fillStyle = isFirst ? '#ffe08a' : 'rgba(126,200,248,0.9)';
      c.fillText(`${i + 1}위`, 40, y + rowHeight / 2 + (entry.gameTitle ? 0 : 6));

      c.font = '700 15px Inter, sans-serif';
      c.fillStyle = isFirst ? '#fff4d6' : '#eaf6ff';
      c.fillText(entry.name, 96, y + rowHeight / 2 + (entry.gameTitle ? 0 : 6));
      if (entry.gameTitle) {
        c.font = '650 11px Inter, sans-serif';
        c.fillStyle = isFirst ? 'rgba(255,232,170,0.75)' : 'rgba(232,244,255,0.55)';
        c.fillText(entry.gameTitle, 96, y + rowHeight / 2 + 16);
      }

      c.textAlign = 'right';
      c.font = '900 17px Inter, sans-serif';
      c.fillStyle = isFirst ? '#ffe08a' : '#eaf6ff';
      c.fillText(
        hasDetails ? `점수 ${entry.score}` : String(entry.score),
        width - 40,
        y + rowHeight / 2 + (hasDetails ? 0 : 6),
      );
      if (hasDetails) {
        c.font = '700 12px Inter, sans-serif';
        c.fillStyle = isFirst ? 'rgba(255,232,170,0.82)' : 'rgba(232,244,255,0.66)';
        const distanceText = entry.distance === undefined ? '거리 -' : `거리 ${entry.distance}m`;
        const coinsText = entry.coins === undefined ? '코인 -' : `코인 ${entry.coins}개`;
        c.fillText(`${distanceText}  ·  ${coinsText}`, width - 40, y + rowHeight / 2 + 18);
      }
    });
  }

  c.textAlign = 'center';
  c.font = '600 11px Inter, sans-serif';
  c.fillStyle = 'rgba(232,244,255,0.4)';
  c.fillText(new Date().toLocaleString('ko-KR'), width / 2, height - 18);

  return canvas;
}

function rankingImageBlob(entries: RankingEntry[]): Promise<Blob | null> {
  return new Promise((resolve) => {
    buildRankingImageCanvas(entries).toBlob((blob) => resolve(blob), 'image/png');
  });
}

async function downloadRankingImage(entries: RankingEntry[]) {
  const blob = await rankingImageBlob(entries);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `종합랭킹-${stamp}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type ShareNav = Navigator & {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
};

async function shareRankingImage(entries: RankingEntry[]) {
  const blob = await rankingImageBlob(entries);
  if (!blob) return;
  const file = new File([blob], 'ranking.png', { type: 'image/png' });
  const nav = navigator as ShareNav;
  if (!nav.canShare?.({ files: [file] }) || !nav.share) return;
  try {
    await nav.share({ files: [file], title: COMBINED_RANKING_TITLE, text: `${COMBINED_RANKING_TITLE}을 확인해보세요!` });
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
  /** true면 닉네임이 이미 저장돼 있을 때, 신기록 달성 시 저장 버튼 없이 자동으로 기록한다. */
  autoRecord?: boolean;
}

/**
 * 결과 화면의 닉네임 저장 폼 + 랭킹 보기 오버레이(목록 + 이미지 저장/공유) 동작을
 * 한 번에 연결한다. 랭킹 보기는 이 게임뿐 아니라 점수 랭킹을 지원하는 10개 게임 전체를
 * 합친 통합 랭킹을 보여준다.
 *
 * 반환값은 판이 끝날 때마다 호출할 `reset()` 함수다 — 저장 폼을 초기화하고,
 * `autoRecord`가 켜져 있으면 닉네임이 있는 상태에서 이번 점수가 기존 최고 기록보다
 * 높을 때만 저장 버튼 클릭 없이 자동으로 기록한다.
 */
export function setupRankingUI(
  refs: RankingUIRefs,
  getScore: () => number,
  getDetails?: () => RankingEntryDetails,
): () => void {
  refs.nameInput.value = loadLastNickname();
  let displayedEntries: RankingEntry[] = [];
  const defaultSavedMsgText = refs.savedMsg.textContent ?? '저장했어요!';

  const rankingTitle = refs.rankingOverlay.querySelector<HTMLElement>('.overlay-card h2');
  if (rankingTitle) rankingTitle.textContent = '전체 게임 통합 랭킹';
  const rankingScope = document.createElement('p');
  rankingScope.className = 'ranking-scope';
  rankingScope.textContent = '점수 랭킹을 지원하는 모든 게임을 합쳐서 보여줘요.';
  rankingTitle?.after(rankingScope);

  // 싱글 게임의 랭킹 버튼은 원래 시작 오버레이 안에만 있었다. 공용 헤더를 쓰는
  // 게임에서는 같은 버튼을 헤더 우측으로 옮겨 시작 전/플레이 중/결과 화면 모두에서
  // 접근할 수 있게 한다. 버튼 노드를 재사용하므로 이벤트와 id가 중복되지 않는다.
  const gameHeader = document.querySelector<HTMLElement>('.game-header');
  if (gameHeader && !gameHeader.contains(refs.viewRankingBtn)) {
    refs.viewRankingBtn.classList.add('header-ranking-btn');
    refs.viewRankingBtn.setAttribute('aria-label', '전체 게임 통합 랭킹 보기');
    gameHeader.append(refs.viewRankingBtn);
  }

  function record(name: string, score: number): RankingEntry[] {
    const entries = addRankingEntry(refs.gameSlug, name, score, getDetails?.() ?? {});
    void queueRankingSync(refs.gameSlug, entries);
    return entries;
  }

  refs.saveBtn.addEventListener('click', () => {
    record(refs.nameInput.value, getScore());
    refs.savedMsg.textContent = defaultSavedMsgText;
    refs.savedMsg.classList.remove('hidden');
    refs.saveBtn.disabled = true;
  });

  refs.viewRankingBtn.addEventListener('click', () => {
    displayedEntries = [];
    refs.rankingList.innerHTML = '<li class="ranking-empty">불러오는 중…</li>';
    rankingScope.textContent = '점수 랭킹을 지원하는 모든 게임을 합쳐서 보여줘요.';
    refs.rankingOverlay.classList.remove('hidden');

    // 첫 진입 때 서버가 잠시 불안정했더라도 랭킹을 열면 로컬 기록 병합을 다시 시도한다.
    void queueRankingSync(refs.gameSlug, loadRanking(refs.gameSlug));
    void loadCombinedRanking()
      .then((entries) => {
        displayedEntries = entries;
        renderRankingList(refs.rankingList, displayedEntries);
        rankingScope.textContent = '모든 기기 · 모든 게임 통합 랭킹';
      })
      .catch(() => {
        displayedEntries = loadRanking(refs.gameSlug);
        renderRankingList(refs.rankingList, displayedEntries);
        rankingScope.textContent = '서버 연결이 원활하지 않아 이 게임의 기기 기록만 표시합니다.';
      });
  });

  refs.closeRankingBtn.addEventListener('click', () => {
    refs.rankingOverlay.classList.add('hidden');
  });

  const shareNav = navigator as ShareNav;
  const shareSupported = typeof shareNav.share === 'function' && typeof shareNav.canShare === 'function';
  if (!shareSupported) refs.rankingShareImageBtn.classList.add('hidden');

  refs.rankingSaveImageBtn.addEventListener('click', () => {
    void downloadRankingImage(displayedEntries);
  });
  refs.rankingShareImageBtn.addEventListener('click', () => {
    void shareRankingImage(displayedEntries);
  });

  // 업데이트 전 이 기기에 저장돼 있던 기록도 첫 방문 때 전체 랭킹으로 합친다.
  void queueRankingSync(refs.gameSlug, loadRanking(refs.gameSlug));

  return function reset() {
    refs.nameInput.value = loadLastNickname();
    refs.saveBtn.disabled = false;
    refs.savedMsg.textContent = defaultSavedMsgText;
    refs.savedMsg.classList.add('hidden');

    if (!refs.autoRecord) return;
    const nickname = loadLastNickname();
    if (!nickname) return;

    const score = getScore();
    const existing = loadRanking(refs.gameSlug).find((e) => e.name === nickname);
    if (existing && existing.score >= score) return;

    record(nickname, score);
    refs.savedMsg.textContent = '자동으로 기록했어요!';
    refs.savedMsg.classList.remove('hidden');
  };
}
