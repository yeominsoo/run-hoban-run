import './idle-farm.css';
import { setupRankingUI } from '../../shared/leaderboard';

const GAME_SLUG = 'idle-farm';
const STORAGE_KEY = 'rhh_idle-farm_state';
const PLOT_COUNT = 6;
const AUTO_TICK_MS = 500;
const YIELD_BASE_COST = 50;
const SPEED_BASE_COST = 60;
const AUTO_HARVESTER_COST = 500;
const TOAST_DURATION_MS = 4000;
const FARM_BACKGROUND_ASSET_URL = '/assets/game-art/idle-farm/farm-background.webp';

type CropId = 'carrot' | 'tomato' | 'watermelon';

interface CropDef {
  id: CropId;
  name: string;
  growMs: number;
  yield: number;
}

const CROPS: CropDef[] = [
  { id: 'carrot', name: '당근', growMs: 8_000, yield: 4 },
  { id: 'tomato', name: '토마토', growMs: 25_000, yield: 15 },
  { id: 'watermelon', name: '수박', growMs: 60_000, yield: 45 }
];

function cropById(id: CropId): CropDef {
  return CROPS.find((c) => c.id === id)!;
}

interface PlotState {
  crop: CropId | null;
  plantedAt: number | null;
}

interface FarmState {
  coins: number;
  totalEarned: number;
  plots: PlotState[];
  yieldLevel: number;
  speedLevel: number;
  autoHarvester: boolean;
}

function defaultState(): FarmState {
  return {
    coins: 0,
    totalEarned: 0,
    plots: Array.from({ length: PLOT_COUNT }, () => ({ crop: null, plantedAt: null })),
    yieldLevel: 0,
    speedLevel: 0,
    autoHarvester: false
  };
}

function loadState(): FarmState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as FarmState;
    if (!parsed || !Array.isArray(parsed.plots) || parsed.plots.length !== PLOT_COUNT) return defaultState();
    return parsed;
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function upgradeCost(base: number, level: number): number {
  return Math.round(base * Math.pow(1.6, level));
}

function yieldMultiplier(level: number): number {
  return 1 + level * 0.1;
}

function speedMultiplier(level: number): number {
  return Math.max(0.2, Math.pow(0.92, level));
}

function effectiveGrowMs(crop: CropDef): number {
  return crop.growMs * speedMultiplier(state.speedLevel);
}

function plotProgress(plot: PlotState, now: number): number {
  if (!plot.crop || plot.plantedAt === null) return 0;
  const growMs = effectiveGrowMs(cropById(plot.crop));
  return Math.min(1, (now - plot.plantedAt) / growMs);
}

function isPlotReady(plot: PlotState, now: number): boolean {
  return plot.crop !== null && plotProgress(plot, now) >= 1;
}

// 오프라인 동안 지나간 자동 수확 사이클을 심은 시각(절대 타임스탬프)만으로 계산한다.
// 페이지가 열려 있을 때의 주기적 틱과 새로고침 직후 1회 호출이 완전히 같은 코드 경로를
// 타므로, "온라인/오프라인"을 구분하는 별도 상태가 필요 없다.
let firstAutoTickDone = false;

function processAutoHarvest(now: number) {
  if (!state.autoHarvester) return;
  let gained = 0;
  for (const plot of state.plots) {
    if (!plot.crop || plot.plantedAt === null) continue;
    const crop = cropById(plot.crop);
    const growMs = effectiveGrowMs(crop);
    const elapsed = now - plot.plantedAt;
    const cycles = Math.floor(elapsed / growMs);
    if (cycles > 0) {
      const coinsPerCycle = Math.round(crop.yield * yieldMultiplier(state.yieldLevel));
      gained += coinsPerCycle * cycles;
      plot.plantedAt += cycles * growMs;
    }
  }
  if (gained > 0) {
    state.coins += gained;
    state.totalEarned += gained;
    if (!firstAutoTickDone) showToast(`자리를 비운 동안 자동 수확기가 ${gained}코인을 모았어요!`);
  }
  firstAutoTickDone = true;
}

// ── State ─────────────────────────────
let state = loadState();
let pendingPlotIndex: number | null = null;
let toastTimer: number | null = null;

// ── Markup ────────────────────────────
const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="farm-shell">
    <header class="game-header">
      <a class="back-link" href="/">← 게임 선택</a>
      <h1 class="game-title">방치형 농장</h1>
      <div class="best-score">누적수익 <strong id="total-earned">0</strong></div>
    </header>

    <main class="farm-main">
      <div class="farm-topbar">
        <div class="coin-balance">보유 코인 <strong id="coin-balance">0</strong></div>
        <button id="view-ranking-btn" class="ghost-btn" type="button">랭킹보기</button>
      </div>

      <section class="farm-scene" id="farm-scene" aria-label="농장 밭">
        <div class="farm-plots" id="farm-plots"></div>
      </section>

      <section class="farm-upgrades">
        <h2>업그레이드</h2>
        <button class="upgrade-btn" id="upgrade-yield" type="button">
          <span class="upgrade-name">수확량 증가 <span class="upgrade-level" id="yield-level">Lv.0</span></span>
          <span class="upgrade-desc">작물 수확량 +10%</span>
          <span class="upgrade-cost" id="yield-cost">50코인</span>
        </button>
        <button class="upgrade-btn" id="upgrade-speed" type="button">
          <span class="upgrade-name">성장 속도 증가 <span class="upgrade-level" id="speed-level">Lv.0</span></span>
          <span class="upgrade-desc">성장 시간 -8%</span>
          <span class="upgrade-cost" id="speed-cost">60코인</span>
        </button>
        <button class="upgrade-btn" id="upgrade-auto" type="button">
          <span class="upgrade-name">자동 수확기</span>
          <span class="upgrade-desc">다 자란 작물을 자동으로 수확하고 같은 작물을 다시 심어요</span>
          <span class="upgrade-cost" id="auto-cost">500코인</span>
        </button>
      </section>

      <section class="farm-record">
        <h2>내 기록 등록</h2>
        <p class="farm-record-desc">누적수익은 언제든 랭킹에 등록할 수 있어요. 코인을 더 모은 뒤 다시 등록하면 점수가 갱신돼요.</p>
        <div class="rank-entry-form" id="rank-entry-form">
          <input id="rank-name-input" class="rank-name-input" type="text" maxlength="12" placeholder="닉네임" autocomplete="off" />
          <button id="rank-save-btn" class="rank-save-btn" type="button">기록 저장</button>
        </div>
        <p class="rank-saved-msg hidden" id="rank-saved-msg">저장했어요!</p>
      </section>
    </main>

    <div class="overlay hidden" id="intro-overlay">
      <div class="overlay-card">
        <h2>🎮 게임 방법</h2>
        <p class="farm-record-desc">
          빈 밭을 탭해 작물을 심으세요. 창을 닫아도 실제 시간에 맞춰 계속 자라고, 다 자란
          작물을 탭하면 수확해서 코인을 얻어요. 코인으로 수확량·성장 속도를 올리거나, 자동
          수확기를 사면 다 자란 작물을 알아서 수확하고 다시 심어줘요.
        </p>
        <button id="intro-start-btn" class="primary-btn" type="button">시작하기</button>
      </div>
    </div>

    <div class="overlay hidden" id="crop-picker-overlay">
      <div class="overlay-card">
        <h2>어떤 작물을 심을까요?</h2>
        <div class="crop-picker-list" id="crop-picker-list"></div>
        <button id="crop-picker-cancel" class="ghost-btn" type="button">취소</button>
      </div>
    </div>

    <div class="overlay hidden" id="ranking-overlay">
      <div class="overlay-card">
        <h2>랭킹</h2>
        <ol class="ranking-list" id="ranking-list"></ol>
        <div class="result-image-actions">
          <button id="ranking-save-image-btn" class="ghost-btn" type="button">이미지 저장</button>
          <button id="ranking-share-image-btn" class="ghost-btn hidden" type="button">공유하기</button>
        </div>
        <button id="close-ranking-btn" class="primary-btn" type="button">닫기</button>
      </div>
    </div>

    <div class="farm-toast hidden" id="farm-toast"></div>
    <div id="farm-state" hidden></div>
  </div>
`;

// ── Refs ──────────────────────────────
const plotsContainer = document.getElementById('farm-plots')!;
const farmScene = document.getElementById('farm-scene')!;
const totalEarnedEl = document.getElementById('total-earned')!;
const coinBalanceEl = document.getElementById('coin-balance')!;
const upgradeYieldBtn = document.getElementById('upgrade-yield') as HTMLButtonElement;
const upgradeSpeedBtn = document.getElementById('upgrade-speed') as HTMLButtonElement;
const upgradeAutoBtn = document.getElementById('upgrade-auto') as HTMLButtonElement;
const yieldLevelEl = document.getElementById('yield-level')!;
const speedLevelEl = document.getElementById('speed-level')!;
const yieldCostEl = document.getElementById('yield-cost')!;
const speedCostEl = document.getElementById('speed-cost')!;
const autoCostEl = document.getElementById('auto-cost')!;
const introOverlay = document.getElementById('intro-overlay')!;
const introStartBtn = document.getElementById('intro-start-btn') as HTMLButtonElement;
const cropPickerOverlay = document.getElementById('crop-picker-overlay')!;
const cropPickerList = document.getElementById('crop-picker-list')!;
const cropPickerCancel = document.getElementById('crop-picker-cancel') as HTMLButtonElement;
const rankNameInput = document.getElementById('rank-name-input') as HTMLInputElement;
const rankSaveBtn = document.getElementById('rank-save-btn') as HTMLButtonElement;
const rankSavedMsg = document.getElementById('rank-saved-msg')!;
const viewRankingBtn = document.getElementById('view-ranking-btn') as HTMLButtonElement;
const rankingOverlay = document.getElementById('ranking-overlay')!;
const rankingList = document.getElementById('ranking-list')!;
const closeRankingBtn = document.getElementById('close-ranking-btn') as HTMLButtonElement;
const rankingSaveImageBtn = document.getElementById('ranking-save-image-btn') as HTMLButtonElement;
const rankingShareImageBtn = document.getElementById('ranking-share-image-btn') as HTMLButtonElement;
const toastEl = document.getElementById('farm-toast')!;
const testStateEl = document.getElementById('farm-state')!;

farmScene.dataset.assetState = 'loading';
const farmBackgroundImage = new Image();
farmBackgroundImage.decoding = 'async';
farmBackgroundImage.addEventListener('load', () => { farmScene.dataset.assetState = 'ready'; });
farmBackgroundImage.addEventListener('error', () => { farmScene.dataset.assetState = 'fallback'; });
farmBackgroundImage.src = FARM_BACKGROUND_ASSET_URL;

// ── 작물 선택 팝업 ──────────────────────────
cropPickerList.innerHTML = CROPS.map(
  (c) => `
  <button class="crop-picker-btn" type="button" data-crop-id="${c.id}">
    <span class="crop-picker-icon crop-icon-${c.id}" aria-hidden="true"></span>
    <span class="crop-picker-name">${c.name}</span>
    <span class="crop-picker-meta">${Math.round(c.growMs / 1000)}초 · ${c.yield}코인</span>
  </button>`
).join('');

cropPickerList.querySelectorAll<HTMLButtonElement>('.crop-picker-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (pendingPlotIndex === null) return;
    const cropId = btn.dataset.cropId as CropId;
    state.plots[pendingPlotIndex] = { crop: cropId, plantedAt: Date.now() };
    pendingPlotIndex = null;
    cropPickerOverlay.classList.add('hidden');
    saveState();
    render(Date.now());
  });
});

cropPickerCancel.addEventListener('click', () => {
  pendingPlotIndex = null;
  cropPickerOverlay.classList.add('hidden');
});

// ── 밭 칸 엘리먼트 ──────────────────────────
interface PlotRefs {
  root: HTMLButtonElement;
  icon: HTMLElement;
  fill: HTMLElement;
  label: HTMLElement;
}

const plotRefs: PlotRefs[] = [];
for (let i = 0; i < PLOT_COUNT; i++) {
  const root = document.createElement('button');
  root.type = 'button';
  root.className = 'plot';
  root.dataset.plotIndex = String(i);
  root.innerHTML = `
    <span class="plot-icon" data-role="icon" aria-hidden="true"></span>
    <div class="plot-progress-track"><div class="plot-progress-fill" data-role="fill"></div></div>
    <span class="plot-label" data-role="label">빈 밭</span>
  `;
  root.addEventListener('click', () => handlePlotTap(i));
  plotsContainer.appendChild(root);
  plotRefs.push({
    root,
    icon: root.querySelector('[data-role="icon"]')!,
    fill: root.querySelector('[data-role="fill"]')!,
    label: root.querySelector('[data-role="label"]')!
  });
}

function handlePlotTap(index: number) {
  const now = Date.now();
  const plot = state.plots[index];
  if (!plot.crop) {
    pendingPlotIndex = index;
    cropPickerOverlay.classList.remove('hidden');
    return;
  }
  if (isPlotReady(plot, now)) {
    harvestPlot(index, now);
  }
}

function harvestPlot(index: number, now: number) {
  const plot = state.plots[index];
  if (!plot.crop || !isPlotReady(plot, now)) return;
  const crop = cropById(plot.crop);
  const coinsGained = Math.round(crop.yield * yieldMultiplier(state.yieldLevel));
  state.coins += coinsGained;
  state.totalEarned += coinsGained;
  plot.crop = null;
  plot.plantedAt = null;
  saveState();
  resetRanking();
  render(now);
}

// ── 업그레이드 구매 ─────────────────────────
upgradeYieldBtn.addEventListener('click', () => {
  const cost = upgradeCost(YIELD_BASE_COST, state.yieldLevel);
  if (state.coins < cost) return;
  state.coins -= cost;
  state.yieldLevel += 1;
  saveState();
  render(Date.now());
});

upgradeSpeedBtn.addEventListener('click', () => {
  const cost = upgradeCost(SPEED_BASE_COST, state.speedLevel);
  if (state.coins < cost) return;
  state.coins -= cost;
  state.speedLevel += 1;
  saveState();
  render(Date.now());
});

upgradeAutoBtn.addEventListener('click', () => {
  if (state.autoHarvester || state.coins < AUTO_HARVESTER_COST) return;
  state.coins -= AUTO_HARVESTER_COST;
  state.autoHarvester = true;
  saveState();
  render(Date.now());
});

// ── 토스트 ────────────────────────────────
function showToast(message: string) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.add('hidden'), TOAST_DURATION_MS);
}

// ── 랭킹 UI ───────────────────────────────
const resetRanking = setupRankingUI(
  {
    gameSlug: GAME_SLUG,
    gameTitle: '방치형 농장',
    nameInput: rankNameInput,
    saveBtn: rankSaveBtn,
    savedMsg: rankSavedMsg,
    viewRankingBtn,
    rankingOverlay,
    rankingList,
    closeRankingBtn,
    rankingSaveImageBtn,
    rankingShareImageBtn,
    autoRecord: true
  },
  () => state.totalEarned
);

// ── 렌더 ──────────────────────────────────
function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${s}초`;
}

function render(now: number) {
  totalEarnedEl.textContent = String(state.totalEarned);
  coinBalanceEl.textContent = String(state.coins);

  const yCost = upgradeCost(YIELD_BASE_COST, state.yieldLevel);
  const sCost = upgradeCost(SPEED_BASE_COST, state.speedLevel);
  yieldLevelEl.textContent = `Lv.${state.yieldLevel}`;
  speedLevelEl.textContent = `Lv.${state.speedLevel}`;
  yieldCostEl.textContent = `${yCost}코인`;
  speedCostEl.textContent = `${sCost}코인`;
  upgradeYieldBtn.disabled = state.coins < yCost;
  upgradeSpeedBtn.disabled = state.coins < sCost;

  if (state.autoHarvester) {
    autoCostEl.textContent = '보유 중';
    upgradeAutoBtn.disabled = true;
    upgradeAutoBtn.classList.add('owned');
  } else {
    autoCostEl.textContent = `${AUTO_HARVESTER_COST}코인`;
    upgradeAutoBtn.disabled = state.coins < AUTO_HARVESTER_COST;
  }

  state.plots.forEach((plot, i) => {
    const refs = plotRefs[i];
    if (!plot.crop) {
      refs.root.className = 'plot plot--empty';
      refs.root.dataset.crop = '';
      refs.root.dataset.ready = 'false';
      delete refs.root.dataset.plantedAt;
      refs.icon.className = 'plot-icon';
      refs.icon.style.transform = '';
      refs.fill.style.width = '0%';
      refs.label.textContent = '빈 밭 (탭해서 심기)';
      return;
    }

    const crop = cropById(plot.crop);
    const progress = plotProgress(plot, now);
    const ready = isPlotReady(plot, now);
    refs.root.className = `plot plot--${ready ? 'ready' : 'growing'}`;
    refs.root.dataset.crop = plot.crop;
    refs.root.dataset.ready = String(ready);
    refs.root.dataset.plantedAt = String(plot.plantedAt);
    refs.icon.className = `plot-icon crop-icon-${plot.crop}`;
    const growScale = 0.45 + progress * 0.55;
    refs.icon.style.transform = ready ? '' : `scale(${growScale.toFixed(3)})`;
    refs.fill.style.width = `${Math.round(progress * 100)}%`;
    refs.label.textContent = ready
      ? `${crop.name} 수확하기!`
      : `${crop.name} 성장 중 (${formatRemaining(effectiveGrowMs(crop) - (now - plot.plantedAt!))})`;
  });

  testStateEl.dataset.coins = String(state.coins);
  testStateEl.dataset.totalEarned = String(state.totalEarned);
  testStateEl.dataset.yieldLevel = String(state.yieldLevel);
  testStateEl.dataset.speedLevel = String(state.speedLevel);
  testStateEl.dataset.autoHarvester = String(state.autoHarvester);
}

// ── 처음 방문 시 게임 방법 안내 ────────────────
const TUTORIAL_SEEN_KEY = 'rhh_idle-farm_tutorial_seen';
if (!localStorage.getItem(TUTORIAL_SEEN_KEY)) introOverlay.classList.remove('hidden');
introStartBtn.addEventListener('click', () => {
  introOverlay.classList.add('hidden');
  try { localStorage.setItem(TUTORIAL_SEEN_KEY, '1'); } catch { /* storage unavailable */ }
});

// ── 초기화 + 틱 루프 ────────────────────────
const initNow = Date.now();
processAutoHarvest(initNow);
saveState();
render(initNow);

function tick() {
  const now = Date.now();
  processAutoHarvest(now);
  render(now);
  saveState();
}

window.setInterval(tick, AUTO_TICK_MS);
