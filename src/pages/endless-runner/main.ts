import './endless-runner.css';
import { loadBestScore, saveBestScore } from '../../shared/score-store';
import { setupRankingUI, resetRankingSubmission } from '../../shared/leaderboard';

const GAME_SLUG = 'endless-runner';

const GROUND_Y_RATIO = 0.72;
const PLAYER_X_RATIO = 0.22;
const PLAYER_WIDTH = 30;
const PLAYER_HEIGHT = 42;
const SLIDE_HEIGHT = 22;
const GRAVITY = 2200; // px/s^2
const JUMP_VELOCITY = -760; // px/s
const SLIDE_DURATION_MS = 500;
const DOUBLE_TAP_WINDOW_MS = 300;
const SWIPE_MIN_DISTANCE = 30;
const BASE_SPEED = 260; // px/s
const SPEED_ACCEL = 4; // px/s per second (연속 상승)
const PX_PER_METER = 50;
const COIN_SCORE = 10;
const OBSTACLE_MIN_GAP_START = 420;
const OBSTACLE_MIN_GAP_END = 220;
const GAP_SHRINK_DURATION_S = 60;
const COIN_INTERVAL_S = 1.4;
const PIT_MIN_WIDTH = 70;
const PIT_MAX_WIDTH = 110;

type Phase = 'idle' | 'playing' | 'ended';
type PlayerState = 'running' | 'jumping' | 'sliding';
type ObstacleType = 'low' | 'high' | 'pit';

interface Obstacle {
  type: ObstacleType;
  x: number;
  width: number;
}

interface Coin {
  x: number;
  y: number;
  collected: boolean;
}

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

      <div class="hud" id="hud" hidden>
        <div class="hud-item"><span class="hud-label">점수</span><span class="hud-value" id="hud-score">0</span></div>
        <div class="hud-item"><span class="hud-label">코인</span><span class="hud-value" id="hud-coins">0</span></div>
      </div>

      <div class="overlay" id="start-overlay">
        <div class="overlay-card">
          <h2>무한 러너</h2>
          <p>탭하면 점프, 아래로 스와이프(또는 빠르게 2번 탭)하면 슬라이드!<br>낮은 장애물은 점프, 높은 장애물은 슬라이드, 구덩이는 타이밍 점프로 통과하세요. 코인 +10점, 달린 거리 1m = 1점.</p>
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
const hud = document.getElementById('hud')!;
const hudScore = document.getElementById('hud-score')!;
const hudCoins = document.getElementById('hud-coins')!;
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
const COLOR_PRIMARY = cssVar('--color-primary') || '#ff6f91';
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
let playerState: PlayerState = 'running';
let slideEndAt = 0;

let speed = BASE_SPEED;
let elapsedS = 0;
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
let lastTapAt = -Infinity;

// ── Init ──────────────────────────────────────
bestScoreEl.textContent = String(loadBestScore(GAME_SLUG));
canvas.dataset.phase = phase;
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
  if (phase !== 'playing') {
    playerY = groundY;
    draw();
  }
}

// ── Helpers ───────────────────────────────────
function currentMinGap(): number {
  const t = Math.min(1, elapsedS / GAP_SHRINK_DURATION_S);
  return OBSTACLE_MIN_GAP_START + (OBSTACLE_MIN_GAP_END - OBSTACLE_MIN_GAP_START) * t;
}

function playerHeight(): number {
  return playerState === 'sliding' ? SLIDE_HEIGHT : PLAYER_HEIGHT;
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
  if (roll < 0.34) {
    obstacles.push({ type: 'low', x: stageWidth + 20, width: 34 });
  } else if (roll < 0.67) {
    obstacles.push({ type: 'high', x: stageWidth + 20, width: 50 });
  } else {
    const width = PIT_MIN_WIDTH + Math.random() * (PIT_MAX_WIDTH - PIT_MIN_WIDTH);
    obstacles.push({ type: 'pit', x: stageWidth + 20, width });
  }
}

function spawnCoin() {
  const height = 40 + Math.random() * 90;
  coins.push({ x: stageWidth + 20, y: groundY - height, collected: false });
}

function triggerJump() {
  if (phase !== 'playing' || playerState !== 'running') return;
  playerState = 'jumping';
  playerVy = JUMP_VELOCITY;
  canvas.dataset.state = playerState;
}

function triggerSlide() {
  if (phase !== 'playing' || playerState !== 'running') return;
  playerState = 'sliding';
  slideEndAt = performance.now() + SLIDE_DURATION_MS;
  canvas.dataset.state = playerState;
}

function updateHudNumbers() {
  hudScore.textContent = String(score);
  hudCoins.textContent = String(coinsCollected);
  canvas.dataset.score = String(score);
  canvas.dataset.coins = String(coinsCollected);
}

function updateTestAttrs() {
  canvas.dataset.obstacles = obstacles.map((o) => `${o.type}:${Math.round(o.x)}:${Math.round(o.width)}`).join('|');
  canvas.dataset.playerY = String(Math.round(playerY));
  canvas.dataset.playerX = String(Math.round(playerX));
  canvas.dataset.state = playerState;
}

// ── Game flow ─────────────────────────────────
function startGame() {
  phase = 'playing';
  canvas.dataset.phase = phase;
  playerY = groundY;
  playerVy = 0;
  playerState = 'running';
  speed = BASE_SPEED;
  elapsedS = 0;
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

  lastFrameAt = performance.now();
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
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
      playerState = 'running';
    }
  } else if (playerState === 'sliding') {
    if (now >= slideEndAt) playerState = 'running';
  }
}

function updateWorld(dt: number) {
  speed += SPEED_ACCEL * dt;
  elapsedS += dt;
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
  const coinGap = COIN_INTERVAL_S * speed;
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
function draw() {
  ctx.clearRect(0, 0, stageWidth, stageHeight);

  // sky
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(0, 0, stageWidth, groundY);

  // ground (구덩이는 뚫어서 그린다)
  ctx.fillStyle = COLOR_SECONDARY;
  let cursor = 0;
  const pits = obstacles.filter((o) => o.type === 'pit').sort((a, b) => a.x - b.x);
  for (const pit of pits) {
    if (pit.x > cursor) ctx.fillRect(cursor, groundY, pit.x - cursor, stageHeight - groundY);
    cursor = Math.max(cursor, pit.x + pit.width);
  }
  if (cursor < stageWidth) ctx.fillRect(cursor, groundY, stageWidth - cursor, stageHeight - groundY);

  // obstacles
  for (const o of obstacles) {
    if (o.type === 'pit') continue;
    const { top, height } = obstacleGeometry(o);
    if (o.type === 'low') {
      ctx.fillStyle = COLOR_DANGER;
      ctx.fillRect(o.x, top, o.width, height);
    } else {
      // 위로 화면 밖까지 뻗은 "매달린 기둥" — 위쪽은 흐려져서 천장 너머로 이어지는 느낌을 준다.
      const gradient = ctx.createLinearGradient(0, top, 0, top + height);
      gradient.addColorStop(0, 'rgba(232,93,117,0)');
      gradient.addColorStop(0.35, COLOR_DANGER);
      gradient.addColorStop(1, COLOR_DANGER);
      ctx.fillStyle = gradient;
      ctx.fillRect(o.x, top, o.width, height);
    }
  }

  // coins
  for (const c of coins) {
    if (c.collected) continue;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = COLOR_ACCENT;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // player
  const pHeight = playerHeight();
  ctx.fillStyle = COLOR_PRIMARY;
  const radius = 8;
  const x = playerX - PLAYER_WIDTH / 2;
  const y = playerTopY();
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + PLAYER_WIDTH, y, x + PLAYER_WIDTH, y + pHeight, radius);
  ctx.arcTo(x + PLAYER_WIDTH, y + pHeight, x, y + pHeight, radius);
  ctx.arcTo(x, y + pHeight, x, y, radius);
  ctx.arcTo(x, y, x + PLAYER_WIDTH, y, radius);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = COLOR_TEXT;
  ctx.font = '700 12px Inter, sans-serif';
  ctx.textAlign = 'left';
}

function loop(now: number) {
  if (phase !== 'playing') return;

  const dt = Math.min(0.05, (now - lastFrameAt) / 1000);
  lastFrameAt = now;

  updatePhysics(dt, now);
  updateWorld(dt);
  const collided = checkCollisions();
  recomputeScore();
  updateHudNumbers();
  updateTestAttrs();

  if (collided) {
    endGame();
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
  const now = performance.now();
  const dx = ev.clientX - pointerDownX;
  const dy = ev.clientY - pointerDownY;

  const isSwipeDown = dy > SWIPE_MIN_DISTANCE && Math.abs(dy) > Math.abs(dx);
  if (isSwipeDown) {
    triggerSlide();
    lastTapAt = -Infinity;
    return;
  }

  if (now - lastTapAt < DOUBLE_TAP_WINDOW_MS) {
    triggerSlide();
    lastTapAt = -Infinity;
  } else {
    triggerJump();
    lastTapAt = now;
  }
});

window.addEventListener('keydown', (ev) => {
  if (phase !== 'playing') return;
  if (ev.code === 'Space' || ev.code === 'ArrowUp') {
    ev.preventDefault();
    triggerJump();
  } else if (ev.code === 'ArrowDown') {
    ev.preventDefault();
    triggerSlide();
  }
});

startBtn.addEventListener('click', startGame);
retryBtn.addEventListener('click', startGame);
