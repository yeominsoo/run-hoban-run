import './endless-runner.css';
import { loadBestScore, saveBestScore } from '../../shared/score-store';
import { setupRankingUI, resetRankingSubmission } from '../../shared/leaderboard';
import {
  DEFAULT_RUNNER_CHARACTER_ID,
  RUNNER_CHARACTERS,
  findRunnerCharacter,
  type RunnerAction,
  type RunnerCharacter,
  type RunnerSlidePhase
} from './character-assets';
import { OBSTACLE_ASSET_URLS, type ObstacleVisual } from './obstacle-assets';
import { TERRAIN_ASSET_URLS } from './terrain-assets';

const GAME_SLUG = 'endless-runner';

const GROUND_Y_RATIO = 0.82;
const PLAYER_X_RATIO = 0.22;
const PLAYER_WIDTH = 30;
const PLAYER_HEIGHT = 42;
const SLIDE_HEIGHT = 22;
const GRAVITY = 2200; // px/s^2
const JUMP_VELOCITY = -760; // px/s
const LANDING_POSE_MS = 90;
const SLIDE_ENTER_MS = 180;
const SLIDE_HOLD_MS = 800;
const SLIDE_EXIT_MS = 180;
const SWIPE_MIN_DISTANCE = 30;
const MAX_JUMPS = 2;
const SECOND_JUMP_VELOCITY = -690;
const ROUND_DURATION_S = 15;
const MAX_DIFFICULTY_TIER = 6;
const BASE_SPEED = 245; // px/s
const ROUND_SPEED_STEP = 28;
const ROUND_SPEED_RAMP = 1.4;
const PX_PER_METER = 50;
const COIN_SCORE = 10;
const OBSTACLE_MIN_GAP_START = 440;
const OBSTACLE_MIN_GAP_STEP = 34;
const OBSTACLE_MIN_GAP_FLOOR = 270;
const COIN_INTERVAL_START_S = 1.35;
const COIN_INTERVAL_STEP_S = 0.07;
const COIN_INTERVAL_FLOOR_S = 0.9;
const COIN_HAZARD_CLEARANCE = 180;
const MAX_CREATURE_APPROACH_SPEED = 102;
const PIT_MIN_WIDTH = 70;
const PIT_MAX_WIDTH = 110;
const FALL_ANIMATION_MS = 1100;
const CHARACTER_STORAGE_KEY = 'rhh_endless-runner_character';

type Phase = 'idle' | 'playing' | 'falling' | 'ended';
type PlayerState = 'running' | 'jumping' | 'landing' | 'sliding' | 'falling';
type ObstacleType = 'low' | 'high' | 'pit';
type CoinSafeAction = 'run' | 'jump' | 'slide';

interface Obstacle {
  type: ObstacleType;
  x: number;
  width: number;
  visual: ObstacleVisual;
  phase: number;
  approachSpeed: number;
}

interface Coin {
  x: number;
  groundOffset: number;
  collected: boolean;
  safeAction: CoinSafeAction;
  approachSpeed: number;
}

function loadSelectedCharacter(): RunnerCharacter {
  try {
    const storedId = localStorage.getItem(CHARACTER_STORAGE_KEY);
    const character = findRunnerCharacter(storedId ?? DEFAULT_RUNNER_CHARACTER_ID);
    if (storedId !== null && storedId !== character.id) {
      localStorage.setItem(CHARACTER_STORAGE_KEY, character.id);
    }
    return character;
  } catch {
    return findRunnerCharacter(DEFAULT_RUNNER_CHARACTER_ID);
  }
}

const PLAYER_ACTIONS: Record<PlayerState, RunnerAction> = {
  running: 'run',
  jumping: 'jump',
  landing: 'jump',
  sliding: 'slide',
  falling: 'fall'
};

let selectedCharacter = loadSelectedCharacter();

const characterPickerHtml = RUNNER_CHARACTERS.map((character) => `
  <button
    class="character-option${character.id === selectedCharacter.id ? ' selected' : ''}"
    type="button"
    aria-pressed="${character.id === selectedCharacter.id}"
    aria-label="${character.label} 선택"
    data-character-id="${character.id}"
  >
    <img src="${character.preview}" alt="" aria-hidden="true" draggable="false" />
    <span>${character.shortLabel}</span>
  </button>
`).join('');

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="er-shell">
    <header class="game-header">
      <a class="back-link" href="/">← 게임 선택</a>
      <h1 class="game-title">안엘런</h1>
      <div class="best-score">최고 <strong id="best-score">0</strong></div>
    </header>

    <div class="game-stage" id="game-stage">
      <canvas id="er-canvas"></canvas>
      <img id="runner-character" class="runner-character is-active" data-visual-layer="front" alt="" aria-hidden="true" draggable="false" />
      <img id="runner-character-buffer" class="runner-character" data-visual-layer="back" alt="" aria-hidden="true" draggable="false" />

      <div class="hud" id="hud" hidden>
        <div class="hud-item"><span class="hud-label">점수</span><span class="hud-value" id="hud-score">0</span></div>
        <div class="hud-item"><span class="hud-label">코인</span><span class="hud-value" id="hud-coins">0</span></div>
        <div class="hud-item"><span class="hud-label">라운드</span><span class="hud-value" id="hud-round">1</span></div>
      </div>

      <div class="overlay" id="start-overlay">
        <div class="overlay-card">
          <h2>안엘런</h2>
          <p>탭하면 점프, 한 번 더 탭하면 2단 점프! 아래로 스와이프하면 슬라이드합니다.<br>잔디 절벽·가시·공중 지형과 날아오는 생물이 라운드마다 추가됩니다. 코인은 장애물과 떨어진 안전한 길에 등장합니다. 코인 +10점, 달린 거리 1m = 1점.</p>
          <fieldset class="character-picker">
            <legend>달릴 캐릭터 선택</legend>
            <div class="character-picker-grid" role="group" aria-label="달릴 캐릭터 선택">
              ${characterPickerHtml}
            </div>
          </fieldset>
          <button id="start-btn" class="primary-btn" type="button">시작하기</button>
          <button id="view-ranking-btn" class="ghost-btn" type="button">랭킹보기</button>
        </div>
      </div>

      <div class="overlay hidden" id="result-overlay">
        <div class="overlay-card">
          <h2>게임 오버!</h2>
          <div class="result-score" id="result-score">0</div>
          <div class="result-stats">
            <span id="result-distance">거리 0m</span>
            <span id="result-coins">코인 0개</span>
          </div>
          <p class="record-badge hidden" id="record-badge">🏆 신기록!</p>

          <div class="rank-entry-form" id="rank-entry-form">
            <input id="rank-name-input" class="rank-name-input" type="text" maxlength="12" placeholder="닉네임" autocomplete="off" />
            <button id="rank-save-btn" class="rank-save-btn" type="button">기록 저장</button>
          </div>
          <p class="rank-saved-msg hidden" id="rank-saved-msg">저장했어요!</p>

          <button id="retry-btn" class="primary-btn" type="button">다시 하기</button>
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
    </div>
  </div>
`;

// ── Refs ──────────────────────────────────────
const stage = document.getElementById('game-stage')!;
const canvas = document.getElementById('er-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let playerImage = document.getElementById('runner-character') as HTMLImageElement;
let playerImageBuffer = document.getElementById('runner-character-buffer') as HTMLImageElement;
const characterOptions = Array.from(document.querySelectorAll<HTMLButtonElement>('.character-option'));
const hud = document.getElementById('hud')!;
const hudScore = document.getElementById('hud-score')!;
const hudCoins = document.getElementById('hud-coins')!;
const hudRound = document.getElementById('hud-round')!;
const bestScoreEl = document.getElementById('best-score')!;
const startOverlay = document.getElementById('start-overlay')!;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const resultOverlay = document.getElementById('result-overlay')!;
const resultScore = document.getElementById('result-score')!;
const resultDistance = document.getElementById('result-distance')!;
const resultCoins = document.getElementById('result-coins')!;
const recordBadge = document.getElementById('record-badge')!;
const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;
const rankNameInput = document.getElementById('rank-name-input') as HTMLInputElement;
const rankSaveBtn = document.getElementById('rank-save-btn') as HTMLButtonElement;
const rankSavedMsg = document.getElementById('rank-saved-msg')!;
const viewRankingBtn = document.getElementById('view-ranking-btn') as HTMLButtonElement;
const rankingOverlay = document.getElementById('ranking-overlay')!;
const rankingList = document.getElementById('ranking-list')!;
const closeRankingBtn = document.getElementById('close-ranking-btn') as HTMLButtonElement;
const rankingSaveImageBtn = document.getElementById('ranking-save-image-btn') as HTMLButtonElement;
const rankingShareImageBtn = document.getElementById('ranking-share-image-btn') as HTMLButtonElement;

// ── Theme colors ───────────────────────────────
const rootStyle = getComputedStyle(document.documentElement);
const cssVar = (name: string) => rootStyle.getPropertyValue(name).trim();
const COLOR_ACCENT = cssVar('--color-accent') || '#ffc857';
const COLOR_DANGER = cssVar('--color-danger') || '#e85d75';
const COLOR_TEXT = cssVar('--color-page-text') || '#4b3447';

// ── State ─────────────────────────────────────
let phase: Phase = 'idle';
let dpr = Math.max(1, window.devicePixelRatio || 1);
let stageWidth = 0;
let stageHeight = 0;
let groundY = 0;
let playerX = 0;

let playerY = 0; // 캐릭터 하단(발) y좌표. groundY면 지면.
let playerVy = 0;
let jumpsUsed = 0;
let playerState: PlayerState = 'running';
let jumpTakeoffSpeed = Math.abs(JUMP_VELOCITY);
let jumpExpectedLandingSpeed = Math.abs(JUMP_VELOCITY);
let landingEndAt = 0;
let slidePhase: RunnerSlidePhase | null = null;
let slidePhaseEndAt = 0;
let slideHoldEndAt = 0;
let keyboardSlideHeld = false;
let fallEndAt = 0;

let speed = BASE_SPEED;
let elapsedS = 0;
let roundNumber = 1;
let distancePx = 0;
let coinsCollected = 0;
let score = 0;

let obstacles: Obstacle[] = [];
let coins: Coin[] = [];
let standingPlatform: Obstacle | null = null;
let distanceSinceSpawn = 0;
let distanceSinceCoin = 0;

let lastFrameAt = 0;
let rafId: number | null = null;

let pointerDownX = 0;
let pointerDownY = 0;

const preloadedVisuals = new Map<string, HTMLImageElement>();
const visualPreloadPromises = new Map<string, Promise<boolean>>();
const characterVisualBlobPromises = new Map<string, Promise<boolean>>();
const characterVisualBlobs = new Map<string, Blob>();
let playerVisualReplay = 0;
let pendingPlayerVisualKey: string | null = null;
let pendingPlayerVisualAbort: AbortController | null = null;
let characterPrepareRequest = 0;

// ── Init ──────────────────────────────────────
bestScoreEl.textContent = String(loadBestScore(GAME_SLUG));
canvas.dataset.phase = phase;
canvas.dataset.state = playerState;
canvas.dataset.character = selectedCharacter.id;
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

setupRankingUI(
  {
    gameSlug: GAME_SLUG,
    gameTitle: '안엘런',
    nameInput: rankNameInput,
    saveBtn: rankSaveBtn,
    savedMsg: rankSavedMsg,
    viewRankingBtn,
    rankingOverlay,
    rankingList,
    closeRankingBtn,
    rankingSaveImageBtn,
    rankingShareImageBtn
  },
  () => score
);
void prepareSelectedCharacterVisuals();

function resizeCanvas() {
  const previousGroundY = groundY;
  dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = stage.getBoundingClientRect();
  stageWidth = rect.width;
  stageHeight = rect.height;
  groundY = stageHeight * GROUND_Y_RATIO;
  playerX = stageWidth * PLAYER_X_RATIO;
  canvas.width = Math.round(stageWidth * dpr);
  canvas.height = Math.round(stageHeight * dpr);
  canvas.style.width = `${stageWidth}px`;
  canvas.style.height = `${stageHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (phase === 'idle' || phase === 'ended') {
    playerY = groundY;
    draw();
  } else {
    // 모바일 브라우저 주소창/도구막대가 접히며 높이가 바뀌어도 캐릭터의 지면 기준
    // 높이를 보존한다. 코인은 groundOffset으로 그려져 별도의 좌표 보정이 필요 없다.
    if (previousGroundY > 0) playerY += groundY - previousGroundY;
    syncPlayerVisual();
  }
}

// ── Helpers ───────────────────────────────────
function currentMinGap(): number {
  const tier = Math.min(MAX_DIFFICULTY_TIER, roundNumber);
  return Math.max(
    OBSTACLE_MIN_GAP_FLOOR,
    OBSTACLE_MIN_GAP_START - (tier - 1) * OBSTACLE_MIN_GAP_STEP
  );
}

function currentCoinInterval(): number {
  const tier = Math.min(MAX_DIFFICULTY_TIER, roundNumber);
  return Math.max(
    COIN_INTERVAL_FLOOR_S,
    COIN_INTERVAL_START_S - (tier - 1) * COIN_INTERVAL_STEP_S
  );
}

function speedForCurrentRound(): number {
  const tier = Math.min(MAX_DIFFICULTY_TIER, roundNumber);
  const secondsIntoRound = tier === MAX_DIFFICULTY_TIER
    ? Math.min(ROUND_DURATION_S, Math.max(0, elapsedS - (tier - 1) * ROUND_DURATION_S))
    : elapsedS % ROUND_DURATION_S;
  return BASE_SPEED + (tier - 1) * ROUND_SPEED_STEP + secondsIntoRound * ROUND_SPEED_RAMP;
}

function playerHeight(): number {
  return playerState === 'sliding' ? SLIDE_HEIGHT : PLAYER_HEIGHT;
}

function characterVisualAssets(character: RunnerCharacter): string[] {
  return [...new Set([
    character.actions.run.animation,
    character.actions.fall.animation,
    ...(character.actions.jump.frames ?? [character.actions.jump.animation]),
    ...Object.values(character.slideClips)
  ])];
}

function currentJumpFrameIndex(): number | null {
  const frames = selectedCharacter.actions.jump.frames;
  if (!frames?.length) return null;
  if (playerState === 'landing') return frames.length - 1;
  if (playerState !== 'jumping') return null;

  if (playerVy < 0) {
    // 1~5번은 웅크림 → 도약 → 정점 포즈다. 현재 상승 속도가 0에 가까워질수록
    // 정점 프레임에 가까워지므로 체공시간이 달라져도 포즈가 물리 위치와 일치한다.
    const ascentProgress = Math.max(0, Math.min(1, 1 - Math.abs(playerVy) / jumpTakeoffSpeed));
    if (ascentProgress < 0.06) return 0;
    if (ascentProgress < 0.16) return 1;
    if (ascentProgress < 0.48) return 2;
    if (ascentProgress < 0.78) return 3;
    return 4;
  }

  // 5~7번은 정점 → 하강 → 착지 직전이다. 8번 착지 포즈는 실제 발이 지면이나
  // 공중 발판에 닿은 순간 landing 상태에서 짧게 표시한다.
  const descentProgress = Math.max(0, Math.min(0.999, playerVy / jumpExpectedLandingSpeed));
  if (descentProgress < 0.18) return 4;
  if (descentProgress < 0.82) return 5;
  return 6;
}

function setJumpVelocity(velocity: number) {
  playerVy = velocity;
  landingEndAt = 0;
  jumpTakeoffSpeed = Math.max(1, Math.abs(velocity));
  const remainingDrop = Math.max(0, groundY - playerY);
  jumpExpectedLandingSpeed = Math.max(
    jumpTakeoffSpeed,
    Math.sqrt(jumpTakeoffSpeed ** 2 + 2 * GRAVITY * remainingDrop)
  );
}

function beginLanding(now: number) {
  playerVy = 0;
  jumpsUsed = 0;
  playerState = 'landing';
  landingEndAt = now + LANDING_POSE_MS;
  syncPlayerVisual(true);
}

function sceneVisualAssets(): string[] {
  return [...Object.values(OBSTACLE_ASSET_URLS), ...Object.values(TERRAIN_ASSET_URLS)];
}

function preloadVisualAsset(asset: string): Promise<boolean> {
  const cached = visualPreloadPromises.get(asset);
  if (cached) return cached;

  const promise = new Promise<boolean>((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('load', async () => {
      try {
        await image.decode();
      } catch {
        // 일부 브라우저는 애니메이션 GIF의 decode()를 지원하지 않아도 load 후 표시할 수 있다.
      }
      preloadedVisuals.set(asset, image);
      resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
    }, { once: true });
    image.addEventListener('error', () => resolve(false), { once: true });
    image.src = asset;
  });

  visualPreloadPromises.set(asset, promise);
  return promise;
}

function preloadCharacterVisualAsset(asset: string): Promise<boolean> {
  const cached = characterVisualBlobPromises.get(asset);
  if (cached) return cached;

  // 실제 화면에서 사용하는 원본 URL을 먼저 디코딩해 둔다. Blob은 유한 GIF를 매번
  // 처음부터 재생할 때만 사용하며, 두 요청은 브라우저 HTTP 캐시를 공유한다.
  const blobReady = fetch(asset)
    .then((response) => {
      if (!response.ok) throw new Error(`Failed to preload character asset: ${response.status}`);
      return response.blob();
    })
    .then((blob) => {
      characterVisualBlobs.set(asset, blob);
      return true;
    })
    .catch(() => false);
  const promise = Promise.all([preloadVisualAsset(asset), blobReady])
    .then(([visualReady]) => visualReady);

  characterVisualBlobPromises.set(asset, promise);
  return promise;
}

async function prepareSelectedCharacterVisuals() {
  const request = ++characterPrepareRequest;
  const character = selectedCharacter;
  canvas.dataset.assetsReady = 'loading';
  canvas.dataset.sceneAssetsReady = 'loading';
  startBtn.disabled = true;
  startBtn.textContent = '캐릭터 준비 중…';

  const [characterResults, sceneResults] = await Promise.all([
    Promise.all(characterVisualAssets(character).map(preloadCharacterVisualAsset)),
    Promise.all(sceneVisualAssets().map(preloadVisualAsset))
  ]);
  if (request !== characterPrepareRequest || character.id !== selectedCharacter.id) return;

  canvas.dataset.sceneAssetsReady = String(sceneResults.every(Boolean));
  canvas.dataset.assetsReady = characterResults.every(Boolean) && sceneResults.every(Boolean)
    ? character.id
    : 'fallback';
  startBtn.disabled = false;
  startBtn.textContent = '시작하기';
}

function releasePlayerLayerObjectUrl(layer: HTMLImageElement) {
  const objectUrl = layer.dataset.objectUrl;
  if (!objectUrl) return;
  URL.revokeObjectURL(objectUrl);
  delete layer.dataset.objectUrl;
}

function resetPlayerVisualBuffer() {
  releasePlayerLayerObjectUrl(playerImageBuffer);
  playerImageBuffer.removeAttribute('src');
  playerImageBuffer.classList.remove('is-active');
  delete playerImageBuffer.dataset.assetFallback;
}

function cancelPendingPlayerVisual() {
  pendingPlayerVisualAbort?.abort();
  pendingPlayerVisualAbort = null;
  pendingPlayerVisualKey = null;
  resetPlayerVisualBuffer();
}

async function loadPlayerLayer(
  layer: HTMLImageElement,
  source: string,
  signal: AbortSignal
): Promise<boolean> {
  const loaded = await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      layer.onload = null;
      layer.onerror = null;
      signal.removeEventListener('abort', onAbort);
      resolve(success);
    };
    const onAbort = () => finish(false);
    layer.onload = () => finish(true);
    layer.onerror = () => finish(false);
    signal.addEventListener('abort', onAbort, { once: true });
    layer.src = source;
    if (layer.complete) {
      queueMicrotask(() => finish(layer.naturalWidth > 0 && layer.naturalHeight > 0));
    }
  });
  if (!loaded || signal.aborted) return false;
  try {
    await layer.decode();
  } catch {
    // 일부 브라우저는 GIF decode()를 지원하지 않아도 load가 끝나면 표시할 수 있다.
  }
  return !signal.aborted && layer.complete && layer.naturalWidth > 0 && layer.naturalHeight > 0;
}

async function preparePlayerVisual(
  visualKey: string,
  asset: string,
  fallbackAsset: string,
  action: RunnerAction,
  clip: string,
  jumpFrameIndex: number | null,
  nextObjectUrl: string | null,
  controller: AbortController
) {
  const nextLayer = playerImageBuffer;
  resetPlayerVisualBuffer();
  if (nextObjectUrl) nextLayer.dataset.objectUrl = nextObjectUrl;
  nextLayer.dataset.character = selectedCharacter.id;
  nextLayer.dataset.action = action;
  nextLayer.dataset.clip = clip;
  nextLayer.dataset.asset = asset;
  nextLayer.dataset.frame = jumpFrameIndex === null ? 'none' : String(jumpFrameIndex + 1);
  nextLayer.dataset.replay = String(++playerVisualReplay);

  let loaded = await loadPlayerLayer(nextLayer, nextObjectUrl ?? asset, controller.signal);
  if (!loaded && !controller.signal.aborted) {
    releasePlayerLayerObjectUrl(nextLayer);
    nextLayer.dataset.assetFallback = 'true';
    loaded = await loadPlayerLayer(nextLayer, fallbackAsset, controller.signal);
  }
  if (!loaded || controller.signal.aborted || pendingPlayerVisualKey !== visualKey) return;

  // 새 레이어가 완전히 디코딩된 뒤에만 앞뒤를 교환한다. 기존 레이어는 CSS 전환이
  // 끝날 때까지 남아 있으므로 프레임 사이에 투명한 순간이 생기지 않는다.
  const previousLayer = playerImage;
  nextLayer.removeAttribute('id');
  previousLayer.id = 'runner-character-buffer';
  nextLayer.id = 'runner-character';
  nextLayer.classList.add('is-active');
  previousLayer.classList.remove('is-active');
  playerImage = nextLayer;
  playerImageBuffer = previousLayer;
  pendingPlayerVisualAbort = null;
  pendingPlayerVisualKey = null;
  canvas.dataset.visualLayer = nextLayer.dataset.visualLayer ?? 'unknown';
  canvas.dataset.visualReady = 'true';
}

function syncPlayerVisual(forceRestart = false) {
  const action = PLAYER_ACTIONS[playerState];
  const jumpFrameIndex = currentJumpFrameIndex();
  const clip = playerState === 'sliding' ? `slide-${slidePhase ?? 'enter'}` : action;
  const asset = jumpFrameIndex !== null
    ? selectedCharacter.actions.jump.frames?.[jumpFrameIndex] ?? selectedCharacter.actions.jump.animation
    : playerState === 'sliding'
      ? selectedCharacter.slideClips[slidePhase ?? 'enter']
      : selectedCharacter.actions[action].animation;
  const fallbackAsset = selectedCharacter.actions[action].still;
  const changed = playerImage.dataset.character !== selectedCharacter.id
    || playerImage.dataset.clip !== clip
    || playerImage.dataset.asset !== asset;
  const visualKey = `${selectedCharacter.id}|${clip}|${asset}`;

  if (pendingPlayerVisualKey && pendingPlayerVisualKey !== visualKey) {
    cancelPendingPlayerVisual();
  }

  if ((changed || forceRestart) && (forceRestart || pendingPlayerVisualKey !== visualKey)) {
    // 넘어짐·슬라이드 진입/복귀는 유한 GIF다. 같은 URL을 다시 지정하면 일부
    // 브라우저가 끝난 디코딩 타임라인을 공유하므로, 메모리 Blob에서 매번 고유 URL을
    // 만들어 첫 프레임부터 재생한다. 네트워크 재다운로드는 발생하지 않는다.
    const requiresFreshTimeline = playerState === 'falling'
      || (playerState === 'sliding' && slidePhase !== 'hold');
    const replayBlob = requiresFreshTimeline ? characterVisualBlobs.get(asset) : undefined;
    const nextObjectUrl = replayBlob ? URL.createObjectURL(replayBlob) : null;
    pendingPlayerVisualAbort?.abort();
    const controller = new AbortController();
    pendingPlayerVisualAbort = controller;
    pendingPlayerVisualKey = visualKey;
    canvas.dataset.visualReady = 'loading';
    void preparePlayerVisual(
      visualKey,
      asset,
      fallbackAsset,
      action,
      clip,
      jumpFrameIndex,
      nextObjectUrl,
      controller
    );
  }

  for (const layer of [playerImage, playerImageBuffer]) {
    layer.style.left = `${playerX}px`;
    layer.style.top = `${playerY}px`;
  }
  canvas.dataset.character = selectedCharacter.id;
  canvas.dataset.action = action;
  canvas.dataset.state = playerState;
  canvas.dataset.slidePhase = slidePhase ?? 'none';
  canvas.dataset.jumpFrame = jumpFrameIndex === null ? 'none' : String(jumpFrameIndex + 1);
}

function selectCharacter(characterId: string) {
  selectedCharacter = findRunnerCharacter(characterId);
  try {
    localStorage.setItem(CHARACTER_STORAGE_KEY, selectedCharacter.id);
  } catch {
    // 저장소 접근이 제한된 환경에서도 현재 세션의 선택은 유지한다.
  }

  for (const option of characterOptions) {
    const isSelected = option.dataset.characterId === selectedCharacter.id;
    option.classList.toggle('selected', isSelected);
    option.setAttribute('aria-pressed', String(isSelected));
  }
  syncPlayerVisual(true);
  void prepareSelectedCharacterVisuals();
}

function playerTopY(): number {
  return playerY - playerHeight();
}

function highObstacleClearance(): number {
  return SLIDE_HEIGHT + 8;
}

function isLandingPlatform(o: Obstacle): boolean {
  return o.type === 'high' && o.visual === 'floating-grass-platform';
}

/**
 * 낮은 장애물은 점프로, 비행 생물은 슬라이드로 피할 수 있는 판정 상자를 만든다. 공중 잔디
 * 지형은 같은 high 스폰 계열이지만 위에서 착지할 수 있는 발판으로 별도 처리한다.
 */
function obstacleGeometry(o: Obstacle): { top: number; height: number } {
  if (o.type === 'low') {
    const height = o.visual === 'thorn-patch' ? 24 : o.visual === 'mossy-rock' ? 32 : 36;
    return { top: groundY - height, height };
  }
  if (o.type === 'high') {
    if (o.visual === 'honeybee' || o.visual === 'bluebird') {
      const bob = Math.sin(elapsedS * 4.4 + o.phase) * 3;
      return { top: groundY - 64 + bob, height: 30 };
    }
    const bottom = groundY - highObstacleClearance() - 2;
    const height = 56;
    return { top: bottom - height, height };
  }
  return { top: groundY, height: stageHeight - groundY };
}

function lowVisualForTier(tier: number): ObstacleVisual {
  const roll = Math.random();
  if (tier >= 2 && roll > 0.72) return 'thorn-patch';
  if (tier >= 2 && roll > 0.36) return 'mossy-rock';
  return 'stump';
}

function highVisualForTier(tier: number): ObstacleVisual {
  if (tier < 2 || Math.random() < 0.55) return 'floating-grass-platform';
  if (tier >= 3 && Math.random() > 0.55) return 'bluebird';
  return 'honeybee';
}

function creatureApproachSpeed(visual: ObstacleVisual, tier: number): number {
  if (visual === 'honeybee') return 52 + Math.min(MAX_DIFFICULTY_TIER, tier) * 4;
  if (visual === 'bluebird') return 72 + Math.min(MAX_DIFFICULTY_TIER, tier) * 5;
  return 0;
}

function canSpawnObstacleAt(x: number): boolean {
  return coins.every((coin) => {
    if (coin.collected) return true;
    const visibleTimeLeft = Math.max(0, coin.x + 20) / Math.max(BASE_SPEED, speed);
    const catchUpBuffer = MAX_CREATURE_APPROACH_SPEED * visibleTimeLeft;
    return x - coin.x > COIN_HAZARD_CLEARANCE + catchUpBuffer;
  });
}

function spawnObstacle(): boolean {
  const spawnX = stageWidth + 20;
  if (!canSpawnObstacleAt(spawnX)) return false;

  const roll = Math.random();
  const tier = Math.min(MAX_DIFFICULTY_TIER, roundNumber);
  const pitChance = tier === 1 ? 0 : Math.min(0.3, (tier - 1) * 0.075);
  const highChance = Math.min(0.4, 0.32 + (tier - 1) * 0.015);
  const lowChance = 1 - highChance - pitChance;
  const spawned: Obstacle[] = [];

  if (roll < lowChance) {
    const visual = lowVisualForTier(tier);
    const baseWidth = visual === 'thorn-patch' ? 54 : visual === 'mossy-rock' ? 46 : 42;
    spawned.push({
      type: 'low',
      visual,
      phase: Math.random() * Math.PI * 2,
      x: spawnX,
      width: baseWidth + Math.min(6, tier * 2),
      approachSpeed: 0
    });
  } else if (roll < lowChance + highChance) {
    const visual = highVisualForTier(tier);
    const baseWidth = visual === 'floating-grass-platform' ? 96 : visual === 'bluebird' ? 42 : 38;
    const platform: Obstacle = {
      type: 'high',
      visual,
      phase: Math.random() * Math.PI * 2,
      x: spawnX,
      width: baseWidth + Math.min(8, tier * 2),
      approachSpeed: creatureApproachSpeed(visual, tier)
    };
    spawned.push(platform);
    if (isLandingPlatform(platform)) {
      // 공중 지형은 선택 장식이 아니라 실제 착지 구간이다. 발판 바로 아래 지면을 같은
      // 폭의 구덩이로 비워 점프로 올라타야만 안전하게 통과할 수 있게 한다.
      spawned.push({
        type: 'pit',
        visual: 'thorn-patch',
        phase: platform.phase,
        x: platform.x - 9,
        width: platform.width + 18,
        approachSpeed: 0
      });
    }
  } else {
    const width = PIT_MIN_WIDTH + Math.random() * (PIT_MAX_WIDTH - PIT_MIN_WIDTH);
    spawned.push({
      type: 'pit',
      visual: 'thorn-patch',
      phase: Math.random() * Math.PI * 2,
      x: spawnX,
      width,
      approachSpeed: 0
    });
  }

  obstacles.push(...spawned);
  return true;
}

function coinGroundOffsetForAction(action: CoinSafeAction): number {
  if (action === 'jump') return 78;
  if (action === 'slide') return SLIDE_HEIGHT * 0.55;
  return PLAYER_HEIGHT * 0.52;
}

function coinY(coin: Coin): number {
  return groundY - coin.groundOffset;
}

function horizontalDistanceToObstacle(x: number, obstacle: Obstacle): number {
  if (x < obstacle.x) return obstacle.x - x;
  if (x > obstacle.x + obstacle.width) return x - (obstacle.x + obstacle.width);
  return 0;
}

function isCoinSpawnAreaClear(x: number): boolean {
  return obstacles.every((obstacle) => (
    horizontalDistanceToObstacle(x, obstacle) > COIN_HAZARD_CLEARANCE
  ));
}

function spawnCoin(): boolean {
  const x = stageWidth + 20;
  if (!isCoinSpawnAreaClear(x)) return false;

  // 코인은 이미 보인 뒤 장애물에 맞춰 순간 이동하지 않는다. 생성 시 정한 안전한
  // 달리기/점프 높이와 지형 스크롤 속도를 수명 내내 유지한다.
  const safeAction: CoinSafeAction = Math.random() < 0.28 ? 'jump' : 'run';
  coins.push({
    x,
    groundOffset: coinGroundOffsetForAction(safeAction),
    collected: false,
    safeAction,
    approachSpeed: 0
  });
  return true;
}

function triggerJump() {
  if (phase !== 'playing' || playerState === 'falling') return;
  if (playerState === 'jumping') {
    if (jumpsUsed >= MAX_JUMPS) return;
    jumpsUsed += 1;
    setJumpVelocity(SECOND_JUMP_VELOCITY);
    syncPlayerVisual(true);
    return;
  }
  if (playerState === 'sliding') {
    // 점프 입력은 슬라이드 진입·유지·복귀 중 어느 시점에서도 마지막 입력으로 우선한다.
    // GIF만 점프로 바뀌고 충돌 상태는 낮게 남는 일이 없도록 슬라이드 상태도 함께 해제한다.
    slidePhase = null;
    slidePhaseEndAt = 0;
    slideHoldEndAt = 0;
    keyboardSlideHeld = false;
  } else if (playerState !== 'running' && playerState !== 'landing') {
    return;
  }
  standingPlatform = null;
  playerState = 'jumping';
  jumpsUsed = 1;
  setJumpVelocity(JUMP_VELOCITY);
  syncPlayerVisual();
}

function triggerSlide(holdForKeyboard = false) {
  if (phase !== 'playing') return;
  const now = performance.now();
  if (playerState === 'sliding') {
    keyboardSlideHeld ||= holdForKeyboard;
    // 반복 입력은 진입 포즈를 다시 재생하지 않고 낮은 유지 구간만 연장한다. 키를 누르고
    // 있거나 스와이프를 다시 해도 일어났다 다시 눕는 부자연스러운 루프가 생기지 않는다.
    if (slidePhase === 'exit') {
      slidePhase = 'hold';
      slideHoldEndAt = keyboardSlideHeld ? Infinity : now + SLIDE_HOLD_MS;
      slidePhaseEndAt = slideHoldEndAt;
      syncPlayerVisual();
    } else if (!keyboardSlideHeld) {
      slideHoldEndAt = Math.max(slideHoldEndAt, now + SLIDE_HOLD_MS);
    }
    canvas.dataset.slidePhase = slidePhase ?? 'hold';
    return;
  }
  if (playerState === 'jumping') {
    // 공중에서도 아래 스와이프/ArrowDown을 무시하지 않고 점프를 즉시 취소해 슬라이드로
    // 전환한다. 모바일의 연속 입력과 키보드 입력이 같은 물리 상태를 만들게 한다.
    playerY = groundY;
    playerVy = 0;
    jumpsUsed = 0;
  } else if (playerState !== 'running' && playerState !== 'landing') {
    return;
  }
  playerState = 'sliding';
  keyboardSlideHeld = holdForKeyboard;
  slidePhase = 'enter';
  slidePhaseEndAt = now + SLIDE_ENTER_MS;
  slideHoldEndAt = keyboardSlideHeld ? Infinity : slidePhaseEndAt + SLIDE_HOLD_MS;
  syncPlayerVisual();
}

function releaseKeyboardSlide() {
  if (!keyboardSlideHeld) return;
  keyboardSlideHeld = false;
  if (phase !== 'playing' || playerState !== 'sliding' || slidePhase === 'exit') return;

  // 아래 키를 놓는 순간부터 일어서기 GIF를 재생한다. 고정 800ms 타이머를 기다리지 않아
  // 실제 키 입력과 화면 자세가 뒤늦게 어긋나는 현상을 막는다.
  slidePhase = 'exit';
  slidePhaseEndAt = performance.now() + SLIDE_EXIT_MS;
  slideHoldEndAt = slidePhaseEndAt;
  syncPlayerVisual();
}

function updateHudNumbers() {
  hudScore.textContent = String(score);
  hudCoins.textContent = String(coinsCollected);
  hudRound.textContent = String(roundNumber);
  canvas.dataset.score = String(score);
  canvas.dataset.coins = String(coinsCollected);
  canvas.dataset.round = String(roundNumber);
}

function updateTestAttrs() {
  const jumpFrameIndex = currentJumpFrameIndex();
  canvas.dataset.obstacles = obstacles
    .map((o) => `${o.type}:${Math.round(o.x)}:${Math.round(o.width)}:${o.visual}:${o.approachSpeed}`)
    .join('|');
  canvas.dataset.playerY = String(Math.round(playerY));
  canvas.dataset.playerVy = String(Math.round(playerVy));
  canvas.dataset.playerX = String(Math.round(playerX));
  canvas.dataset.groundY = String(Math.round(groundY));
  canvas.dataset.state = playerState;
  canvas.dataset.character = selectedCharacter.id;
  canvas.dataset.action = PLAYER_ACTIONS[playerState];
  canvas.dataset.slidePhase = slidePhase ?? 'none';
  canvas.dataset.jumpFrame = jumpFrameIndex === null
    ? 'none'
    : String(jumpFrameIndex + 1);
  canvas.dataset.jumpsUsed = String(jumpsUsed);
  canvas.dataset.speed = String(Math.round(speed));
  canvas.dataset.groundRatio = GROUND_Y_RATIO.toFixed(2);
  canvas.dataset.obstacleCatalog = Object.keys(OBSTACLE_ASSET_URLS).join('|');
  canvas.dataset.standingPlatform = standingPlatform?.visual ?? 'none';
  const terrainTexture = preloadedVisuals.get(TERRAIN_ASSET_URLS.meadowGround);
  canvas.dataset.terrainTextureReady = String(
    Boolean(terrainTexture?.complete && terrainTexture.naturalWidth > 0)
  );
  canvas.dataset.coinPaths = coins
    .filter((coin) => !coin.collected)
    .map((coin) => (
      `${Math.round(coin.x)}:${Math.round(coinY(coin))}:${coin.safeAction}:${coin.approachSpeed}:${coin.groundOffset}`
    ))
    .join('|');
}

// ── Game flow ─────────────────────────────────
function startGame() {
  phase = 'playing';
  canvas.dataset.phase = phase;
  playerY = groundY;
  playerVy = 0;
  jumpsUsed = 0;
  playerState = 'running';
  landingEndAt = 0;
  slidePhase = null;
  slidePhaseEndAt = 0;
  slideHoldEndAt = 0;
  keyboardSlideHeld = false;
  fallEndAt = 0;
  speed = BASE_SPEED;
  elapsedS = 0;
  roundNumber = 1;
  distancePx = 0;
  coinsCollected = 0;
  score = 0;
  obstacles = [];
  coins = [];
  standingPlatform = null;
  distanceSinceSpawn = 0;
  distanceSinceCoin = 0;

  startOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  hud.hidden = false;
  updateHudNumbers();
  updateTestAttrs();
  syncPlayerVisual(true);

  lastFrameAt = performance.now();
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}

function beginFall(now: number) {
  phase = 'falling';
  playerState = 'falling';
  slidePhase = null;
  keyboardSlideHeld = false;
  jumpsUsed = 0;
  standingPlatform = null;
  playerY = groundY;
  fallEndAt = now + FALL_ANIMATION_MS;
  canvas.dataset.phase = phase;
  updateTestAttrs();
  syncPlayerVisual(true);
}

function endGame() {
  phase = 'ended';
  canvas.dataset.phase = phase;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  hud.hidden = true;

  const isRecord = saveBestScore(GAME_SLUG, score);
  bestScoreEl.textContent = String(loadBestScore(GAME_SLUG));

  const meters = Math.floor(distancePx / PX_PER_METER);
  resultScore.textContent = String(score);
  resultDistance.textContent = `거리 ${meters}m`;
  resultCoins.textContent = `코인 ${coinsCollected}개`;
  recordBadge.classList.toggle('hidden', !isRecord);
  resetRankingSubmission({ nameInput: rankNameInput, saveBtn: rankSaveBtn, savedMsg: rankSavedMsg });
  resultOverlay.classList.remove('hidden');
}

function aabbOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function updatePhysics(dt: number, now: number) {
  if (playerState === 'jumping') {
    playerVy += GRAVITY * dt;
    playerY += playerVy * dt;
    if (playerY >= groundY) {
      playerY = groundY;
      beginLanding(now);
    }
  } else if (playerState === 'landing') {
    if (now >= landingEndAt) playerState = 'running';
  } else if (playerState === 'sliding') {
    if (slidePhase === 'enter' && now >= slidePhaseEndAt) {
      slidePhase = 'hold';
      slidePhaseEndAt = slideHoldEndAt;
      syncPlayerVisual();
    } else if (slidePhase === 'hold' && now >= slideHoldEndAt) {
      slidePhase = 'exit';
      slidePhaseEndAt = now + SLIDE_EXIT_MS;
      syncPlayerVisual();
    } else if (slidePhase === 'exit' && now >= slidePhaseEndAt) {
      playerState = 'running';
      slidePhase = null;
    }
  }
}

function updateWorld(dt: number) {
  elapsedS += dt;
  roundNumber = Math.min(MAX_DIFFICULTY_TIER, Math.floor(elapsedS / ROUND_DURATION_S) + 1);
  speed = speedForCurrentRound();
  const travel = speed * dt;
  distancePx += travel;

  for (const o of obstacles) {
    // 생물형 장애물은 지형 스크롤에 실려 오는 데서 그치지 않고 플레이어 쪽으로 직접 날아온다.
    o.x -= travel + o.approachSpeed * dt;
  }
  obstacles = obstacles.filter((o) => o.x + o.width > -10);

  for (const c of coins) c.x -= travel;
  coins = coins.filter((c) => !c.collected && c.x > -20);

  distanceSinceSpawn += travel;
  let obstacleSpawned = false;
  if (distanceSinceSpawn >= currentMinGap()) {
    obstacleSpawned = spawnObstacle();
    if (obstacleSpawned) distanceSinceSpawn = 0;
  }

  distanceSinceCoin += travel;
  const coinGap = currentCoinInterval() * speed;
  // 장애물 생성이 코인 때문에 대기 중이면 새 코인을 더 쌓지 않는다. 기존 코인이 충분히
  // 멀어진 뒤 장애물을 먼저 놓고, 그 장애물과도 간격이 확보된 뒤 다음 코인을 생성한다.
  if (distanceSinceCoin >= coinGap && !obstacleSpawned && distanceSinceSpawn < currentMinGap()) {
    if (spawnCoin()) distanceSinceCoin = 0;
  }
}

function horizontallyOverlapsPlatform(platform: Obstacle): boolean {
  const margin = 5;
  const playerLeft = playerX - PLAYER_WIDTH / 2 + margin;
  const playerRight = playerX + PLAYER_WIDTH / 2 - margin;
  return playerLeft < platform.x + platform.width && playerRight > platform.x;
}

function leavePlatform() {
  standingPlatform = null;
  if (playerState !== 'running' && playerState !== 'landing' && playerState !== 'sliding') return;
  playerState = 'jumping';
  setJumpVelocity(0);
  jumpsUsed = 0;
  slidePhase = null;
  slidePhaseEndAt = 0;
  slideHoldEndAt = 0;
  keyboardSlideHeld = false;
  syncPlayerVisual(true);
}

function resolvePlatformLanding(previousPlayerY: number, wasJumping: boolean) {
  if (standingPlatform) {
    const stillExists = obstacles.includes(standingPlatform);
    if (stillExists && horizontallyOverlapsPlatform(standingPlatform)) {
      playerY = obstacleGeometry(standingPlatform).top;
      playerVy = 0;
      return;
    }
    leavePlatform();
  }

  if (!wasJumping || playerVy < 0) return;
  const landingPlatform = obstacles
    .filter((obstacle) => isLandingPlatform(obstacle) && horizontallyOverlapsPlatform(obstacle))
    .sort((a, b) => obstacleGeometry(a).top - obstacleGeometry(b).top)
    .find((platform) => {
      const top = obstacleGeometry(platform).top;
      return previousPlayerY <= top + 3 && playerY >= top;
    });
  if (!landingPlatform) return;

  standingPlatform = landingPlatform;
  playerY = obstacleGeometry(landingPlatform).top;
  beginLanding(performance.now());
  slidePhase = null;
  keyboardSlideHeld = false;
}

function checkCollisions(): boolean {
  const halfW = PLAYER_WIDTH / 2;
  const pLeft = playerX - halfW;
  const pTop = playerTopY();
  const pHeight = playerHeight();

  for (const o of obstacles) {
    if (o.type === 'pit') {
      const withinPit = playerX >= o.x && playerX <= o.x + o.width;
      if (withinPit && playerState !== 'jumping' && !standingPlatform) return true;
      continue;
    }
    // 공중 잔디 지형은 착지면만 갖는 안전한 발판이다. 옆면이나 아랫면에 닿아도 사망하지 않는다.
    if (isLandingPlatform(o)) continue;
    const { top, height } = obstacleGeometry(o);
    if (aabbOverlap(pLeft, pTop, PLAYER_WIDTH, pHeight, o.x, top, o.width, height)) {
      return true;
    }
  }

  for (const c of coins) {
    if (c.collected) continue;
    const dist = Math.hypot(playerX - c.x, (pTop + pHeight / 2) - coinY(c));
    if (dist < 24) {
      c.collected = true;
      coinsCollected += 1;
    }
  }

  return false;
}

function recomputeScore() {
  const meters = Math.floor(distancePx / PX_PER_METER);
  score = meters + coinsCollected * COIN_SCORE;
}

// ── Render ────────────────────────────────────
function shadeColor(hex: string, percent: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 0xff) + Math.round(255 * percent)));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + Math.round(255 * percent)));
  const b = Math.min(255, Math.max(0, (n & 0xff) + Math.round(255 * percent)));
  return `rgb(${r},${g},${b})`;
}

function drawRoundedRect(x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawCloud(x: number, y: number, scale: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  for (const [cx, cy, radius] of [[0, 6, 12], [14, 0, 16], [31, 7, 12], [15, 10, 21]] as const) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSky() {
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, '#fff8ed');
  sky.addColorStop(0.54, '#dff5ed');
  sky.addColorStop(1, '#bde9d7');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, stageWidth, groundY);

  ctx.fillStyle = 'rgba(255,207,92,0.42)';
  ctx.beginPath();
  ctx.arc(stageWidth * 0.82, Math.max(72, groundY * 0.2), 38, 0, Math.PI * 2);
  ctx.fill();

  const cloudOffset = (distancePx * 0.055) % (stageWidth + 180);
  drawCloud(stageWidth - cloudOffset, groundY * 0.2, 0.9);
  drawCloud(stageWidth * 0.45 - cloudOffset * 0.55, groundY * 0.34, 0.65);
  drawCloud(stageWidth * 1.28 - cloudOffset * 0.8, groundY * 0.13, 0.52);

  const farOffset = (distancePx * 0.11) % 180;
  ctx.fillStyle = '#a6dbc2';
  ctx.beginPath();
  ctx.moveTo(-180 - farOffset, groundY);
  for (let x = -180 - farOffset; x <= stageWidth + 220; x += 90) {
    ctx.quadraticCurveTo(x + 45, groundY - 86, x + 90, groundY);
  }
  ctx.closePath();
  ctx.fill();

  const nearOffset = (distancePx * 0.2) % 150;
  ctx.fillStyle = '#83cba9';
  ctx.beginPath();
  ctx.moveTo(-150 - nearOffset, groundY);
  for (let x = -150 - nearOffset; x <= stageWidth + 190; x += 75) {
    ctx.quadraticCurveTo(x + 38, groundY - 48, x + 75, groundY);
  }
  ctx.closePath();
  ctx.fill();

}

function pointIsOnGround(x: number, pits: Obstacle[]): boolean {
  return !pits.some((pit) => x >= pit.x && x <= pit.x + pit.width);
}

function drawGroundTextureSegment(
  start: number,
  end: number,
  texture: HTMLImageElement | undefined,
  fallback: CanvasGradient
) {
  if (end <= start) return;
  if (!texture?.complete || texture.naturalWidth <= 0) {
    ctx.fillStyle = fallback;
    ctx.fillRect(start, groundY, end - start, stageHeight - groundY);
    ctx.fillStyle = '#5fbd55';
    ctx.fillRect(start, groundY - 6, end - start, 14);
    return;
  }

  const top = groundY - 16;
  const height = stageHeight - top;
  const tileWidth = Math.max(170, height * 1.45);
  const offset = distancePx % tileWidth;
  ctx.save();
  ctx.beginPath();
  ctx.rect(start, top, end - start, height);
  ctx.clip();
  for (let x = -offset - tileWidth; x < stageWidth + tileWidth; x += tileWidth) {
    ctx.drawImage(texture, x, top, tileWidth, height);
  }
  const depthShade = ctx.createLinearGradient(0, groundY, 0, stageHeight);
  depthShade.addColorStop(0, 'rgba(255,255,255,0)');
  depthShade.addColorStop(1, 'rgba(52,31,31,0.14)');
  ctx.fillStyle = depthShade;
  ctx.fillRect(start, groundY, end - start, stageHeight - groundY);
  ctx.restore();
}

function drawGround() {
  const pits = obstacles.filter((o) => o.type === 'pit').sort((a, b) => a.x - b.x);
  const terrainTexture = preloadedVisuals.get(TERRAIN_ASSET_URLS.meadowGround);
  const terrainReady = Boolean(terrainTexture?.complete && terrainTexture.naturalWidth > 0);
  const soil = ctx.createLinearGradient(0, groundY, 0, stageHeight);
  soil.addColorStop(0, '#a96f43');
  soil.addColorStop(0.5, '#805137');
  soil.addColorStop(1, '#573a35');

  let cursor = 0;
  for (const pit of pits) {
    if (pit.x > cursor) {
      drawGroundTextureSegment(cursor, pit.x, terrainTexture, soil);
    }
    cursor = Math.max(cursor, pit.x + pit.width);
  }
  if (cursor < stageWidth) {
    drawGroundTextureSegment(cursor, stageWidth, terrainTexture, soil);
  }

  if (!terrainReady) {
    ctx.fillStyle = 'rgba(255,209,135,0.12)';
    for (let bandY = groundY + 34; bandY < stageHeight; bandY += 42) {
      ctx.fillRect(0, bandY, stageWidth, 3);
    }

    const pebbleOffset = distancePx % 58;
    for (let x = -pebbleOffset; x < stageWidth + 20; x += 58) {
      if (!pointIsOnGround(x, pits)) continue;
      const row = Math.abs(Math.floor((x + distancePx) / 58)) % 3;
      const y = groundY + 27 + row * 25;
      ctx.fillStyle = row === 1 ? '#c39763' : '#705064';
      ctx.beginPath();
      ctx.ellipse(x, y, 4 + row, 2.5 + row * 0.5, -0.25, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const grassOffset = distancePx % 18;
  for (let x = -grassOffset; x < stageWidth + 18; x += 18) {
    if (!pointIsOnGround(x, pits)) continue;
    ctx.fillStyle = Math.floor((x + distancePx) / 18) % 2 === 0 ? '#8ddb58' : '#74cb4e';
    ctx.beginPath();
    ctx.moveTo(x - 7, groundY - 5);
    ctx.quadraticCurveTo(x - 2, groundY - 13, x, groundY - 5);
    ctx.quadraticCurveTo(x + 5, groundY - 15, x + 8, groundY - 5);
    ctx.closePath();
    ctx.fill();
  }

  const flowerOffset = distancePx % 190;
  for (let x = 70 - flowerOffset; x < stageWidth + 190; x += 190) {
    if (!pointIsOnGround(x, pits)) continue;
    ctx.strokeStyle = '#4eaa55';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, groundY - 5);
    ctx.lineTo(x, groundY - 18);
    ctx.stroke();
    ctx.fillStyle = '#fff2a6';
    for (let petal = 0; petal < 5; petal += 1) {
      const angle = petal * Math.PI * 0.4;
      ctx.beginPath();
      ctx.arc(x + Math.cos(angle) * 4, groundY - 20 + Math.sin(angle) * 4, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#f49a5a';
    ctx.beginPath();
    ctx.arc(x, groundY - 20, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const pit of pits) {
    const depth = ctx.createLinearGradient(0, groundY, 0, stageHeight);
    depth.addColorStop(0, '#483349');
    depth.addColorStop(0.42, '#281f31');
    depth.addColorStop(1, '#120f19');
    ctx.fillStyle = depth;
    ctx.fillRect(pit.x, groundY - 7, pit.width, stageHeight - groundY + 7);

    ctx.fillStyle = '#4b332e';
    ctx.beginPath();
    ctx.moveTo(pit.x - 9, groundY - 7);
    ctx.lineTo(pit.x + 8, groundY - 7);
    ctx.lineTo(pit.x + 14, groundY + 9);
    ctx.lineTo(pit.x + 3, groundY + 5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pit.x + pit.width - 8, groundY - 7);
    ctx.lineTo(pit.x + pit.width + 9, groundY - 7);
    ctx.lineTo(pit.x + pit.width - 3, groundY + 5);
    ctx.lineTo(pit.x + pit.width - 14, groundY + 10);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,220,160,0.23)';
    ctx.lineWidth = 2;
    for (const edgeX of [pit.x + 6, pit.x + pit.width - 6]) {
      ctx.beginPath();
      ctx.moveTo(edgeX, groundY + 5);
      ctx.lineTo(edgeX + (edgeX < pit.x + pit.width / 2 ? 8 : -8), groundY + 23);
      ctx.lineTo(edgeX + (edgeX < pit.x + pit.width / 2 ? 3 : -3), groundY + 40);
      ctx.stroke();
    }
  }
}

function drawObstacleSprite(
  visual: ObstacleVisual,
  centerX: number,
  centerY: number,
  width: number,
  height: number
): boolean {
  const image = preloadedVisuals.get(OBSTACLE_ASSET_URLS[visual]);
  if (!image?.complete || image.naturalWidth <= 0) return false;
  ctx.drawImage(image, centerX - width / 2, centerY - height / 2, width, height);
  return true;
}

function drawLowObstacle(o: Obstacle, top: number, height: number) {
  const visualHeight = o.visual === 'thorn-patch' ? 58 : o.visual === 'mossy-rock' ? 64 : 72;
  const visualWidth = o.width + (o.visual === 'thorn-patch' ? 28 : 22);
  const visibleBaselineRatio = 236 / 256;
  const centerY = groundY - visualHeight * visibleBaselineRatio + visualHeight / 2;
  if (drawObstacleSprite(o.visual, o.x + o.width / 2, centerY, visualWidth, visualHeight)) return;

  ctx.save();
  drawRoundedRect(o.x, top, o.width, height, 6);
  ctx.fillStyle = o.visual === 'thorn-patch' ? COLOR_DANGER : '#9a6844';
  ctx.fill();
  ctx.strokeStyle = '#5d3a42';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawApproachTrails(o: Obstacle, centerX: number, centerY: number, spriteSize: number) {
  if (o.approachSpeed <= 0) return;
  const speedRatio = Math.min(1, o.approachSpeed / 100);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = o.visual === 'honeybee'
    ? `rgba(255,190,72,${0.28 + speedRatio * 0.18})`
    : `rgba(112,190,235,${0.25 + speedRatio * 0.2})`;
  for (let index = 0; index < 3; index += 1) {
    const flutter = Math.sin(elapsedS * 10 + o.phase + index * 1.7) * 2.5;
    const startX = centerX + spriteSize * 0.28 + index * 5;
    const startY = centerY - 11 + index * 11 + flutter;
    const length = 12 + speedRatio * 15 - index * 2;
    ctx.lineWidth = 2.4 - index * 0.45;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX + length, startY + flutter * 0.22);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHighObstacle(o: Obstacle, top: number, height: number) {
  const centerX = o.x + o.width / 2;
  const centerY = top + height / 2;
  if (o.visual === 'floating-grass-platform') {
    if (drawObstacleSprite(o.visual, centerX, centerY, o.width + 32, 112)) return;
  } else {
    const spriteSize = o.visual === 'bluebird' ? 58 : 62;
    drawApproachTrails(o, centerX, centerY, spriteSize);
    ctx.save();
    const wingPulse = 1 + Math.sin(elapsedS * 12 + o.phase) * 0.035;
    ctx.translate(centerX, centerY);
    ctx.rotate(Math.sin(elapsedS * 6 + o.phase) * 0.025);
    ctx.scale(1, wingPulse);
    const drawn = drawObstacleSprite(o.visual, 0, 0, spriteSize, spriteSize);
    ctx.restore();
    if (drawn) return;
  }

  ctx.save();
  drawRoundedRect(o.x, top, o.width, height, 8);
  ctx.fillStyle = o.visual === 'floating-grass-platform' ? '#75c853' : COLOR_DANGER;
  ctx.fill();
  ctx.strokeStyle = '#563a4d';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawCoin(c: Coin, now: number) {
  const spin = Math.sin(now / 260 + c.x * 0.05);
  const scaleX = Math.max(0.18, Math.abs(spin));
  ctx.save();
  ctx.translate(c.x, coinY(c));
  ctx.scale(scaleX, 1);
  ctx.shadowColor = 'rgba(255,200,67,0.65)';
  ctx.shadowBlur = 9;
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  const coinGradient = ctx.createRadialGradient(-3, -4, 1, 0, 0, 10);
  coinGradient.addColorStop(0, '#fff4b5');
  coinGradient.addColorStop(0.42, COLOR_ACCENT);
  coinGradient.addColorStop(1, '#df922d');
  ctx.fillStyle = coinGradient;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = shadeColor(COLOR_ACCENT, -0.25);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.48)';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (spin > 0) {
    ctx.beginPath();
    ctx.moveTo(-3.5, -4.5);
    ctx.lineTo(1.5, -4.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlayer(now: number) {
  // 물리 충돌 상자는 PLAYER_WIDTH/PLAYER_HEIGHT로 유지하고, 시각 요소만 DOM GIF로 교체한다.
  syncPlayerVisual();
  void now;
}

function draw() {
  const now = performance.now();
  ctx.clearRect(0, 0, stageWidth, stageHeight);

  drawSky();

  drawGround();

  for (const o of obstacles) {
    if (o.type === 'pit') continue;
    const { top, height } = obstacleGeometry(o);
    if (o.type === 'low') drawLowObstacle(o, top, height);
    else drawHighObstacle(o, top, height);
  }

  for (const c of coins) {
    if (c.collected) continue;
    drawCoin(c, now);
  }

  drawPlayer(now);

  ctx.fillStyle = COLOR_TEXT;
  ctx.font = '700 12px Inter, sans-serif';
  ctx.textAlign = 'left';
}

function loop(now: number) {
  if (phase !== 'playing' && phase !== 'falling') return;

  const dt = Math.min(0.05, (now - lastFrameAt) / 1000);
  lastFrameAt = now;

  if (phase === 'falling') {
    updateTestAttrs();
    draw();
    if (now >= fallEndAt) {
      endGame();
      return;
    }
    rafId = requestAnimationFrame(loop);
    return;
  }

  const previousPlayerY = playerY;
  const wasJumping = playerState === 'jumping';
  updatePhysics(dt, now);
  updateWorld(dt);
  resolvePlatformLanding(previousPlayerY, wasJumping);
  const collided = checkCollisions();
  recomputeScore();
  updateHudNumbers();
  updateTestAttrs();

  if (collided) {
    beginFall(now);
    draw();
    rafId = requestAnimationFrame(loop);
    return;
  }

  draw();
  rafId = requestAnimationFrame(loop);
}

// ── Events ────────────────────────────────────
canvas.addEventListener('pointerdown', (ev) => {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  pointerDownX = ev.clientX;
  pointerDownY = ev.clientY;
});

canvas.addEventListener('pointerup', (ev) => {
  if (phase !== 'playing') return;
  const dx = ev.clientX - pointerDownX;
  const dy = ev.clientY - pointerDownY;

  const isSwipeDown = dy > SWIPE_MIN_DISTANCE && Math.abs(dy) > Math.abs(dx);
  if (isSwipeDown) {
    triggerSlide();
    return;
  }

  triggerJump();
});

window.addEventListener('keydown', (ev) => {
  if (phase !== 'playing') return;
  if (ev.code === 'Space' || ev.code === 'ArrowUp') {
    ev.preventDefault();
    if (!ev.repeat) triggerJump();
  } else if (ev.code === 'ArrowDown') {
    ev.preventDefault();
    if (!ev.repeat) triggerSlide(true);
  }
});

window.addEventListener('keyup', (ev) => {
  if (ev.code !== 'ArrowDown') return;
  ev.preventDefault();
  releaseKeyboardSlide();
});

startBtn.addEventListener('click', startGame);
retryBtn.addEventListener('click', startGame);
for (const option of characterOptions) {
  option.addEventListener('click', () => selectCharacter(option.dataset.characterId ?? DEFAULT_RUNNER_CHARACTER_ID));
}
