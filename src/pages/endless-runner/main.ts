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

const GAME_SLUG = 'endless-runner';

const GROUND_Y_RATIO = 0.72;
const PLAYER_X_RATIO = 0.22;
const PLAYER_WIDTH = 30;
const PLAYER_HEIGHT = 42;
const SLIDE_HEIGHT = 22;
const GRAVITY = 2200; // px/s^2
const JUMP_VELOCITY = -760; // px/s
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
const COIN_OBSTACLE_ALIGN_DISTANCE = 135;
const PIT_MIN_WIDTH = 70;
const PIT_MAX_WIDTH = 110;
const FALL_ANIMATION_MS = 1100;
const CHARACTER_STORAGE_KEY = 'rhh_endless-runner_character';

type Phase = 'idle' | 'playing' | 'falling' | 'ended';
type PlayerState = 'running' | 'jumping' | 'sliding' | 'falling';
type ObstacleType = 'low' | 'high' | 'pit';
type CoinSafeAction = 'run' | 'jump' | 'slide';

interface Obstacle {
  type: ObstacleType;
  x: number;
  width: number;
}

interface Coin {
  x: number;
  y: number;
  collected: boolean;
  safeAction: CoinSafeAction;
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
      <h1 class="game-title">무한 러너</h1>
      <div class="best-score">최고 <strong id="best-score">0</strong></div>
    </header>

    <div class="game-stage" id="game-stage">
      <canvas id="er-canvas"></canvas>
      <img id="runner-character" class="runner-character" alt="" aria-hidden="true" draggable="false" />

      <div class="hud" id="hud" hidden>
        <div class="hud-item"><span class="hud-label">점수</span><span class="hud-value" id="hud-score">0</span></div>
        <div class="hud-item"><span class="hud-label">코인</span><span class="hud-value" id="hud-coins">0</span></div>
        <div class="hud-item"><span class="hud-label">라운드</span><span class="hud-value" id="hud-round">1</span></div>
      </div>

      <div class="overlay" id="start-overlay">
        <div class="overlay-card">
          <h2>무한 러너</h2>
          <p>탭하면 점프, 한 번 더 탭하면 2단 점프! 아래로 스와이프하면 슬라이드합니다.<br>코인은 안전한 회피 동선을 안내하며, 15초마다 라운드와 난이도가 올라갑니다. 코인 +10점, 달린 거리 1m = 1점.</p>
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
const COLOR_SECONDARY = cssVar('--color-secondary') || '#5ecfbc';
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
let distanceSinceSpawn = 0;
let distanceSinceCoin = 0;

let lastFrameAt = 0;
let rafId: number | null = null;

let pointerDownX = 0;
let pointerDownY = 0;

const preloadedVisuals = new Map<string, HTMLImageElement>();
const visualPreloadPromises = new Map<string, Promise<boolean>>();
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
    gameTitle: '무한 러너',
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
    character.actions.jump.animation,
    character.actions.fall.animation,
    ...Object.values(character.slideClips)
  ])];
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

async function prepareSelectedCharacterVisuals() {
  const request = ++characterPrepareRequest;
  const character = selectedCharacter;
  canvas.dataset.assetsReady = 'loading';
  startBtn.disabled = true;
  startBtn.textContent = '캐릭터 준비 중…';

  const results = await Promise.all(characterVisualAssets(character).map(preloadVisualAsset));
  if (request !== characterPrepareRequest || character.id !== selectedCharacter.id) return;

  canvas.dataset.assetsReady = results.every(Boolean) ? character.id : 'fallback';
  startBtn.disabled = false;
  startBtn.textContent = '시작하기';
}

function syncPlayerVisual(forceRestart = false) {
  const action = PLAYER_ACTIONS[playerState];
  const clip = playerState === 'sliding' ? `slide-${slidePhase ?? 'enter'}` : action;
  const asset = playerState === 'sliding'
    ? selectedCharacter.slideClips[slidePhase ?? 'enter']
    : selectedCharacter.actions[action].animation;
  const fallbackAsset = selectedCharacter.actions[action].still;
  const changed = playerImage.dataset.character !== selectedCharacter.id
    || playerImage.dataset.clip !== clip;

  if (changed || forceRestart) {
    // 같은 img의 src만 바꾸면 새 GIF가 디코딩되는 동안 직전 액션의 마지막 프레임이 남을 수
    // 있다. 준비된 에셋을 새 요소에 연결한 뒤 교체해 이전 액션이 화면에 잔류하지 않게 한다.
    const replacement = playerImage.cloneNode(false) as HTMLImageElement;
    replacement.removeAttribute('src');
    replacement.decoding = 'sync';
    replacement.src = asset;
    replacement.dataset.character = selectedCharacter.id;
    replacement.dataset.action = action;
    replacement.dataset.clip = clip;
    replacement.addEventListener('error', () => {
      if (playerImage !== replacement || replacement.dataset.clip !== clip) return;
      replacement.dataset.assetFallback = 'true';
      replacement.src = fallbackAsset;
    }, { once: true });
    playerImage.replaceWith(replacement);
    playerImage = replacement;
  }

  playerImage.style.left = `${playerX}px`;
  playerImage.style.top = `${playerY}px`;
  canvas.dataset.character = selectedCharacter.id;
  canvas.dataset.action = action;
  canvas.dataset.state = playerState;
  canvas.dataset.slidePhase = slidePhase ?? 'none';
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

/**
 * 장애물 종류별 충돌 판정용 사각형(위/높이)을 계산한다. "낮은 장애물"은 바닥에 붙은
 * 낮은 블록(점프로 넘김), "높은 장애물"은 슬라이드 통로(clearance)만 남기고 화면 위쪽까지
 * 뻗은 긴 기둥으로 만들어야 한다 — 높이를 obstacleHeight처럼 짧게 두면 점프 정점에서는
 * 오히려 장애물 위로 넘어가버려 "슬라이드해야만 통과"라는 의도가 깨진다(실제로 자동
 * 플레이 테스트 중 발견한 버그: 점프 최고점(약 131px)이 30px짜리 장애물보다 높아 그냥
 * 넘어가졌다).
 */
function obstacleGeometry(o: Obstacle): { top: number; height: number } {
  if (o.type === 'low') {
    const height = 30;
    return { top: groundY - height, height };
  }
  const bottom = groundY - highObstacleClearance();
  return { top: 0, height: bottom };
}

function spawnObstacle() {
  const roll = Math.random();
  const tier = Math.min(MAX_DIFFICULTY_TIER, roundNumber);
  const pitChance = tier === 1 ? 0 : Math.min(0.3, (tier - 1) * 0.075);
  const highChance = Math.min(0.4, 0.32 + (tier - 1) * 0.015);
  const lowChance = 1 - highChance - pitChance;
  let obstacle: Obstacle;

  if (roll < lowChance) {
    obstacle = { type: 'low', x: stageWidth + 20, width: 38 + Math.min(6, tier * 2) };
  } else if (roll < lowChance + highChance) {
    obstacle = { type: 'high', x: stageWidth + 20, width: 52 + Math.min(8, tier * 2) };
  } else {
    const width = PIT_MIN_WIDTH + Math.random() * (PIT_MAX_WIDTH - PIT_MIN_WIDTH);
    obstacle = { type: 'pit', x: stageWidth + 20, width };
  }

  obstacles.push(obstacle);
  alignNearbyCoinsWithObstacle(obstacle);
}

function requiredActionForObstacle(obstacle: Obstacle): CoinSafeAction {
  return obstacle.type === 'high' ? 'slide' : 'jump';
}

function coinYForAction(action: CoinSafeAction): number {
  if (action === 'jump') return groundY - 78;
  if (action === 'slide') return groundY - SLIDE_HEIGHT * 0.55;
  return groundY - PLAYER_HEIGHT * 0.52;
}

function horizontalDistanceToObstacle(x: number, obstacle: Obstacle): number {
  if (x < obstacle.x) return obstacle.x - x;
  if (x > obstacle.x + obstacle.width) return x - (obstacle.x + obstacle.width);
  return 0;
}

function alignCoinWithObstacle(coin: Coin, obstacle: Obstacle) {
  coin.safeAction = requiredActionForObstacle(obstacle);
  coin.y = coinYForAction(coin.safeAction);
}

function alignNearbyCoinsWithObstacle(obstacle: Obstacle) {
  for (const coin of coins) {
    if (coin.collected) continue;
    if (horizontalDistanceToObstacle(coin.x, obstacle) <= COIN_OBSTACLE_ALIGN_DISTANCE) {
      alignCoinWithObstacle(coin, obstacle);
    }
  }
}

function spawnCoin() {
  const x = stageWidth + 20;
  const nearbyObstacle = obstacles
    .filter((obstacle) => horizontalDistanceToObstacle(x, obstacle) <= COIN_OBSTACLE_ALIGN_DISTANCE)
    .sort((a, b) => horizontalDistanceToObstacle(x, a) - horizontalDistanceToObstacle(x, b))[0];
  const safeAction = nearbyObstacle ? requiredActionForObstacle(nearbyObstacle) : 'run';
  const coin: Coin = { x, y: coinYForAction(safeAction), collected: false, safeAction };
  if (nearbyObstacle) alignCoinWithObstacle(coin, nearbyObstacle);
  coins.push(coin);
}

function triggerJump() {
  if (phase !== 'playing' || playerState === 'falling') return;
  if (playerState === 'jumping') {
    if (jumpsUsed >= MAX_JUMPS) return;
    jumpsUsed += 1;
    playerVy = SECOND_JUMP_VELOCITY;
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
    playerY = groundY;
  } else if (playerState !== 'running') {
    return;
  }
  playerState = 'jumping';
  jumpsUsed = 1;
  playerVy = JUMP_VELOCITY;
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
  } else if (playerState !== 'running') {
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
  canvas.dataset.obstacles = obstacles.map((o) => `${o.type}:${Math.round(o.x)}:${Math.round(o.width)}`).join('|');
  canvas.dataset.playerY = String(Math.round(playerY));
  canvas.dataset.playerX = String(Math.round(playerX));
  canvas.dataset.groundY = String(Math.round(groundY));
  canvas.dataset.state = playerState;
  canvas.dataset.character = selectedCharacter.id;
  canvas.dataset.action = PLAYER_ACTIONS[playerState];
  canvas.dataset.slidePhase = slidePhase ?? 'none';
  canvas.dataset.jumpsUsed = String(jumpsUsed);
  canvas.dataset.speed = String(Math.round(speed));
  canvas.dataset.coinPaths = coins
    .filter((coin) => !coin.collected)
    .map((coin) => `${Math.round(coin.x)}:${Math.round(coin.y)}:${coin.safeAction}`)
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
      playerVy = 0;
      jumpsUsed = 0;
      playerState = 'running';
    }
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

  for (const o of obstacles) o.x -= travel;
  obstacles = obstacles.filter((o) => o.x + o.width > -10);

  for (const c of coins) c.x -= travel;
  coins = coins.filter((c) => !c.collected && c.x > -20);

  distanceSinceSpawn += travel;
  if (distanceSinceSpawn >= currentMinGap()) {
    distanceSinceSpawn = 0;
    spawnObstacle();
  }

  distanceSinceCoin += travel;
  const coinGap = currentCoinInterval() * speed;
  if (distanceSinceCoin >= coinGap) {
    distanceSinceCoin = 0;
    spawnCoin();
  }
}

function checkCollisions(): boolean {
  const halfW = PLAYER_WIDTH / 2;
  const pLeft = playerX - halfW;
  const pTop = playerTopY();
  const pHeight = playerHeight();

  for (const o of obstacles) {
    if (o.type === 'pit') {
      const withinPit = playerX >= o.x && playerX <= o.x + o.width;
      if (withinPit && playerState !== 'jumping') return true;
      continue;
    }
    const { top, height } = obstacleGeometry(o);
    if (aabbOverlap(pLeft, pTop, PLAYER_WIDTH, pHeight, o.x, top, o.width, height)) {
      return true;
    }
  }

  for (const c of coins) {
    if (c.collected) continue;
    const dist = Math.hypot(playerX - c.x, (pTop + pHeight / 2) - c.y);
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

function drawGround() {
  // 구덩이는 뚫어서 그리고, 안쪽엔 그라데이션으로 깊이감을 준다.
  const pits = obstacles.filter((o) => o.type === 'pit').sort((a, b) => a.x - b.x);
  let cursor = 0;
  ctx.fillStyle = COLOR_SECONDARY;
  for (const pit of pits) {
    if (pit.x > cursor) ctx.fillRect(cursor, groundY, pit.x - cursor, stageHeight - groundY);
    cursor = Math.max(cursor, pit.x + pit.width);
  }
  if (cursor < stageWidth) ctx.fillRect(cursor, groundY, stageWidth - cursor, stageHeight - groundY);

  // 지면 표면 하이라이트 줄무늬
  ctx.fillStyle = shadeColor(COLOR_SECONDARY, 0.16);
  cursor = 0;
  for (const pit of pits) {
    if (pit.x > cursor) ctx.fillRect(cursor, groundY, pit.x - cursor, 4);
    cursor = Math.max(cursor, pit.x + pit.width);
  }
  if (cursor < stageWidth) ctx.fillRect(cursor, groundY, stageWidth - cursor, 4);

  for (const pit of pits) {
    const depth = ctx.createLinearGradient(0, groundY, 0, stageHeight);
    depth.addColorStop(0, '#3f2f46');
    depth.addColorStop(0.45, '#241c2c');
    depth.addColorStop(1, '#120f19');
    ctx.fillStyle = depth;
    ctx.fillRect(pit.x, groundY, pit.width, stageHeight - groundY);

    const gradient = ctx.createLinearGradient(0, groundY, 0, groundY + 26);
    gradient.addColorStop(0, 'rgba(43,30,40,0.55)');
    gradient.addColorStop(1, 'rgba(43,30,40,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(pit.x, groundY, pit.width, 26);
    // 가장자리 위험 표시
    ctx.fillStyle = COLOR_ACCENT;
    for (let sx = pit.x - 6; sx < pit.x; sx += 6) ctx.fillRect(sx, groundY, 3, 4);
    for (let sx = pit.x + pit.width; sx < pit.x + pit.width + 6; sx += 6) ctx.fillRect(sx, groundY, 3, 4);

    // 절벽 입구를 평평한 사각형 대신 깨진 석재 테두리와 안쪽 암벽으로 표현한다.
    ctx.fillStyle = '#6d566f';
    ctx.beginPath();
    ctx.moveTo(pit.x - 10, groundY - 3);
    ctx.lineTo(pit.x + 5, groundY - 3);
    ctx.lineTo(pit.x + 12, groundY + 8);
    ctx.lineTo(pit.x + 2, groundY + 5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pit.x + pit.width - 5, groundY - 3);
    ctx.lineTo(pit.x + pit.width + 10, groundY - 3);
    ctx.lineTo(pit.x + pit.width - 2, groundY + 5);
    ctx.lineTo(pit.x + pit.width - 12, groundY + 8);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pit.x + 5, groundY + 8);
    ctx.lineTo(pit.x + 14, groundY + 18);
    ctx.lineTo(pit.x + 9, groundY + 29);
    ctx.moveTo(pit.x + pit.width - 5, groundY + 8);
    ctx.lineTo(pit.x + pit.width - 15, groundY + 20);
    ctx.lineTo(pit.x + pit.width - 10, groundY + 32);
    ctx.stroke();
  }
}

function drawLowObstacle(o: Obstacle, top: number, height: number) {
  ctx.save();
  drawRoundedRect(o.x, top, o.width, height, 4);
  const wood = ctx.createLinearGradient(o.x, top, o.x + o.width, top + height);
  wood.addColorStop(0, '#e2ae70');
  wood.addColorStop(0.48, '#b97848');
  wood.addColorStop(1, '#8d563a');
  ctx.fillStyle = wood;
  ctx.fill();
  ctx.strokeStyle = '#5f3a35';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // 안쪽 판넬과 교차 보강대를 분리해 작은 크기에서도 상자 깊이가 읽히게 한다.
  ctx.fillStyle = 'rgba(255,240,204,0.16)';
  ctx.fillRect(o.x + 4, top + 4, o.width - 8, height - 8);
  ctx.beginPath();
  drawRoundedRect(o.x, top, o.width, height, 4);
  ctx.clip();
  ctx.strokeStyle = 'rgba(91,53,45,0.78)';
  ctx.lineWidth = Math.max(3, o.width * 0.09);
  ctx.beginPath();
  ctx.moveTo(o.x + 5, top + 3);
  ctx.lineTo(o.x + o.width - 5, top + height - 3);
  ctx.moveTo(o.x + o.width - 5, top + 3);
  ctx.lineTo(o.x + 5, top + height - 3);
  ctx.stroke();

  const plateSize = 7;
  ctx.fillStyle = '#665f67';
  for (const [px, py] of [
    [o.x + 1, top + 1],
    [o.x + o.width - plateSize - 1, top + 1],
    [o.x + 1, top + height - plateSize - 1],
    [o.x + o.width - plateSize - 1, top + height - plateSize - 1]
  ]) {
    ctx.fillRect(px, py, plateSize, plateSize);
    ctx.beginPath();
    ctx.arc(px + plateSize / 2, py + plateSize / 2, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = '#f3d58e';
    ctx.fill();
    ctx.fillStyle = '#665f67';
  }

  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(o.x + 5, top + 3, o.width - 10, 2);
  ctx.restore();
}

function drawHighObstacle(o: Obstacle, top: number, height: number) {
  const bottom = top + height;
  const beamHeight = Math.min(50, Math.max(38, height * 0.22));
  const beamTop = bottom - beamHeight;
  ctx.save();

  // 위에서 매달린 구조임을 보여 주는 케이블과 반투명 위험 차단막.
  ctx.fillStyle = 'rgba(232,93,117,0.13)';
  ctx.fillRect(o.x, top, o.width, Math.max(0, beamTop - top));
  ctx.strokeStyle = 'rgba(83,56,73,0.72)';
  ctx.lineWidth = 3;
  for (const cableX of [o.x + 9, o.x + o.width - 9]) {
    ctx.beginPath();
    ctx.moveTo(cableX, top);
    ctx.lineTo(cableX, beamTop + 3);
    ctx.stroke();
  }

  const metal = ctx.createLinearGradient(o.x, beamTop, o.x + o.width, bottom);
  metal.addColorStop(0, '#ff8c8f');
  metal.addColorStop(0.5, COLOR_DANGER);
  metal.addColorStop(1, '#a63f63');
  drawRoundedRect(o.x, beamTop, o.width, beamHeight, 5);
  ctx.fillStyle = metal;
  ctx.fill();
  ctx.strokeStyle = '#71384f';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // 사선 경고띠와 리벳으로 단순한 붉은 벽 대신 기계식 장애물처럼 보이게 한다.
  ctx.save();
  drawRoundedRect(o.x + 2, beamTop + 2, o.width - 4, beamHeight - 4, 3);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,221,111,0.78)';
  ctx.lineWidth = 6;
  for (let stripeX = o.x - beamHeight; stripeX < o.x + o.width + beamHeight; stripeX += 18) {
    ctx.beginPath();
    ctx.moveTo(stripeX, bottom);
    ctx.lineTo(stripeX + beamHeight, beamTop);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = '#ffe5a6';
  for (const rivetX of [o.x + 7, o.x + o.width - 7]) {
    for (const rivetY of [beamTop + 8, bottom - 8]) {
      ctx.beginPath();
      ctx.arc(rivetX, rivetY, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 아래쪽 끝에 가시를 달아 슬라이드 통로를 실루엣만으로도 즉시 읽게 한다.
  const spikeCount = Math.max(2, Math.floor(o.width / 14));
  const spikeW = o.width / spikeCount;
  ctx.fillStyle = '#63314a';
  for (let i = 0; i < spikeCount; i += 1) {
    const sx = o.x + i * spikeW;
    ctx.beginPath();
    ctx.moveTo(sx, bottom);
    ctx.lineTo(sx + spikeW / 2, bottom + 10);
    ctx.lineTo(sx + spikeW, bottom);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawCoin(c: Coin, now: number) {
  const spin = Math.sin(now / 260 + c.x * 0.05);
  const scaleX = Math.max(0.18, Math.abs(spin));
  ctx.save();
  ctx.translate(c.x, c.y);
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

  // sky
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(0, 0, stageWidth, groundY);

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

  updatePhysics(dt, now);
  updateWorld(dt);
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
