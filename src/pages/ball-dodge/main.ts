import './ball-dodge.css';
import { onDrag } from '../../shared/pointer';
import { loadBestScore, saveBestScore } from '../../shared/score-store';
import { setupRankingUI } from '../../shared/leaderboard';

const GAME_SLUG = 'ball-dodge';
const PLAYER_RADIUS = 16;
const BALL_RADIUS = 10;
const INITIAL_RED = 3;
const INITIAL_GREEN = 3;
const DIFFICULTY_INTERVAL_MS = 30_000;
const SPEED_MULTIPLIER_STEP = 1.2;
const GREEN_SCORE = 10;
const MAX_HP = 3;
const INVINCIBLE_MS = 1_000;
const BASE_BALL_SPEED = 90; // px/sec
const MIN_SPAWN_DIST_FROM_PLAYER = 70;
const PLAYER_SPRITE_SIZE = 64;
const BALL_SPRITE_SIZE = 34;
const SPRITE_URLS = {
  player: '/assets/game-art/ball-dodge/player-star-collector.webp',
  red: '/assets/game-art/ball-dodge/hazard-meteor.webp',
  green: '/assets/game-art/ball-dodge/collectible-star.webp'
} as const;

type Phase = 'idle' | 'playing' | 'ended';
type BallKind = 'red' | 'green';

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: BallKind;
}

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="bd-shell">
    <header class="game-header">
      <a class="back-link" href="/">← 게임 선택</a>
      <h1 class="game-title">볼 피하기 + 수집</h1>
      <div class="best-score">최고 <strong id="best-score">0</strong></div>
    </header>

    <div class="game-stage" id="game-stage">
      <canvas id="bd-canvas"></canvas>

      <div class="hud" id="hud" hidden>
        <div class="hud-item"><span class="hud-label">HP</span><span class="hud-value" id="hud-hp">❤️❤️❤️</span></div>
        <div class="hud-item"><span class="hud-label">점수</span><span class="hud-value" id="hud-score">0</span></div>
        <div class="hud-item"><span class="hud-label">생존</span><span class="hud-value" id="hud-time">0.0s</span></div>
      </div>

      <div class="overlay" id="start-overlay">
        <div class="overlay-card">
          <h2>볼 피하기 + 수집</h2>
          <p>드래그로 별 수집선을 움직여 가시 운석을 피하고 별을 모으세요.<br>HP 3, 별 하나당 +10점. 30초마다 더 빨라지고 오브젝트가 늘어납니다.</p>
          <button id="start-btn" class="primary-btn" type="button">시작하기</button>
          <button id="view-ranking-btn" class="ghost-btn" type="button">랭킹보기</button>
        </div>
      </div>

      <div class="overlay hidden" id="result-overlay">
        <div class="overlay-card">
          <h2>게임 오버!</h2>
          <div class="result-score" id="result-score">0</div>
          <div class="result-stats">
            <span id="result-time">생존 0.0초</span>
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
const canvas = document.getElementById('bd-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hud = document.getElementById('hud')!;
const hudHp = document.getElementById('hud-hp')!;
const hudScore = document.getElementById('hud-score')!;
const hudTime = document.getElementById('hud-time')!;
const bestScoreEl = document.getElementById('best-score')!;
const startOverlay = document.getElementById('start-overlay')!;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const resultOverlay = document.getElementById('result-overlay')!;
const resultScore = document.getElementById('result-score')!;
const resultTime = document.getElementById('result-time')!;
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

// ── Sprite assets ─────────────────────────────
const spriteImages = {
  player: new Image(),
  red: new Image(),
  green: new Image()
};
let loadedSpriteCount = 0;
let failedSpriteCount = 0;

function updateSpriteState() {
  canvas.dataset.assetState = failedSpriteCount > 0
    ? 'fallback'
    : loadedSpriteCount === Object.keys(spriteImages).length
      ? 'ready'
      : 'loading';
}

for (const [key, image] of Object.entries(spriteImages) as Array<[keyof typeof spriteImages, HTMLImageElement]>) {
  image.decoding = 'async';
  image.addEventListener('load', () => {
    loadedSpriteCount += 1;
    updateSpriteState();
  }, { once: true });
  image.addEventListener('error', () => {
    failedSpriteCount += 1;
    updateSpriteState();
  }, { once: true });
  image.src = SPRITE_URLS[key];
}
updateSpriteState();

// ── Theme colors ───────────────────────────────
const rootStyle = getComputedStyle(document.documentElement);
const cssVar = (name: string) => rootStyle.getPropertyValue(name).trim();
const COLOR_PRIMARY = cssVar('--color-primary') || '#ff6f91';
const COLOR_DANGER = cssVar('--color-danger') || '#e85d75';
const COLOR_SUCCESS = cssVar('--color-success') || '#39b879';

// ── State ─────────────────────────────────────
let phase: Phase = 'idle';
let dpr = Math.max(1, window.devicePixelRatio || 1);
let stageWidth = 0;
let stageHeight = 0;
let player = { x: 0, y: 0 };
let hp = MAX_HP;
let score = 0;
let balls: Ball[] = [];
let speedMultiplier = 1;
let elapsedMs = 0;
let nextDifficultyStepAt = DIFFICULTY_INTERVAL_MS;
let invincibleUntil = 0;
let lastFrameAt = 0;
let rafId: number | null = null;

// ── Init ──────────────────────────────────────
bestScoreEl.textContent = String(loadBestScore(GAME_SLUG));
canvas.dataset.phase = phase;
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const resetRanking = setupRankingUI(
  {
    gameSlug: GAME_SLUG,
    gameTitle: '볼 피하기 + 수집',
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
  () => score
);

function resizeCanvas() {
  dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = stage.getBoundingClientRect();
  stageWidth = rect.width;
  stageHeight = rect.height;
  canvas.width = Math.round(stageWidth * dpr);
  canvas.height = Math.round(stageHeight * dpr);
  canvas.style.width = `${stageWidth}px`;
  canvas.style.height = `${stageHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  player.x = Math.min(player.x || stageWidth / 2, stageWidth - PLAYER_RADIUS);
  player.y = Math.min(player.y || stageHeight / 2, stageHeight - PLAYER_RADIUS);
}

// ── Helpers ───────────────────────────────────
function randomVelocity(): { vx: number; vy: number } {
  const angle = Math.random() * Math.PI * 2;
  const speed = BASE_BALL_SPEED * (0.8 + Math.random() * 0.4);
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

function spawnBall(kind: BallKind): Ball {
  let x = 0;
  let y = 0;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    x = BALL_RADIUS + Math.random() * Math.max(1, stageWidth - BALL_RADIUS * 2);
    y = BALL_RADIUS + Math.random() * Math.max(1, stageHeight - BALL_RADIUS * 2);
    if (Math.hypot(x - player.x, y - player.y) >= MIN_SPAWN_DIST_FROM_PLAYER) break;
  }
  const { vx, vy } = randomVelocity();
  return { x, y, vx, vy, kind };
}

function respawnBall(ball: Ball) {
  const fresh = spawnBall(ball.kind);
  ball.x = fresh.x;
  ball.y = fresh.y;
  ball.vx = fresh.vx;
  ball.vy = fresh.vy;
}

function updateHudNumbers() {
  hudHp.textContent = '❤️'.repeat(Math.max(0, hp)) + '🖤'.repeat(Math.max(0, MAX_HP - hp));
  hudScore.textContent = String(score);
  hudTime.textContent = `${(elapsedMs / 1000).toFixed(1)}s`;
}

// ── Game flow ─────────────────────────────────
function startGame() {
  phase = 'playing';
  hp = MAX_HP;
  score = 0;
  elapsedMs = 0;
  nextDifficultyStepAt = DIFFICULTY_INTERVAL_MS;
  speedMultiplier = 1;
  invincibleUntil = 0;
  player = { x: stageWidth / 2, y: stageHeight / 2 };

  balls = [];
  for (let i = 0; i < INITIAL_RED; i += 1) balls.push(spawnBall('red'));
  for (let i = 0; i < INITIAL_GREEN; i += 1) balls.push(spawnBall('green'));

  startOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  hud.hidden = false;
  updateHudNumbers();
  canvas.dataset.phase = phase;

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
  ctx.clearRect(0, 0, stageWidth, stageHeight);
  hud.hidden = true;

  const isRecord = saveBestScore(GAME_SLUG, score);
  bestScoreEl.textContent = String(loadBestScore(GAME_SLUG));

  resultScore.textContent = String(score);
  resultTime.textContent = `생존 ${(elapsedMs / 1000).toFixed(1)}초`;
  recordBadge.classList.toggle('hidden', !isRecord);
  resetRanking();
  resultOverlay.classList.remove('hidden');
}

function applyDifficultyStep() {
  speedMultiplier *= SPEED_MULTIPLIER_STEP;
  balls.push(spawnBall('red'));
  balls.push(spawnBall('green'));
}

function updateBalls(dt: number) {
  for (const ball of balls) {
    ball.x += ball.vx * speedMultiplier * dt;
    ball.y += ball.vy * speedMultiplier * dt;

    if (ball.x - BALL_RADIUS < 0) {
      ball.x = BALL_RADIUS;
      ball.vx = Math.abs(ball.vx);
    } else if (ball.x + BALL_RADIUS > stageWidth) {
      ball.x = stageWidth - BALL_RADIUS;
      ball.vx = -Math.abs(ball.vx);
    }
    if (ball.y - BALL_RADIUS < 0) {
      ball.y = BALL_RADIUS;
      ball.vy = Math.abs(ball.vy);
    } else if (ball.y + BALL_RADIUS > stageHeight) {
      ball.y = stageHeight - BALL_RADIUS;
      ball.vy = -Math.abs(ball.vy);
    }
  }
}

function checkCollisions(now: number) {
  for (const ball of balls) {
    const dist = Math.hypot(ball.x - player.x, ball.y - player.y);
    if (dist >= PLAYER_RADIUS + BALL_RADIUS) continue;

    if (ball.kind === 'green') {
      score += GREEN_SCORE;
      respawnBall(ball);
      updateHudNumbers();
    } else if (now >= invincibleUntil) {
      hp -= 1;
      invincibleUntil = now + INVINCIBLE_MS;
      respawnBall(ball);
      updateHudNumbers();
      canvas.dataset.hp = String(hp); // 게임오버 프레임엔 updateTestAttrs()가 돌지 않으므로 즉시 반영
      if (hp <= 0) {
        endGame();
        return;
      }
    }
  }
}

// ── Render ────────────────────────────────────
function isSpriteReady(image: HTMLImageElement): boolean {
  return image.complete && image.naturalWidth > 0;
}

function drawSprite(image: HTMLImageElement, x: number, y: number, size: number) {
  ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
}

function drawBall(ball: Ball) {
  const image = spriteImages[ball.kind];
  if (isSpriteReady(image)) {
    ctx.save();
    ctx.shadowColor = ball.kind === 'red'
      ? 'rgba(232, 93, 117, 0.3)'
      : 'rgba(245, 184, 61, 0.32)';
    ctx.shadowBlur = 8;
    drawSprite(image, ball.x, ball.y, BALL_SPRITE_SIZE);
    ctx.restore();
    return;
  }

  const color = ball.kind === 'red' ? COLOR_DANGER : COLOR_SUCCESS;
  const gradient = ctx.createRadialGradient(
    ball.x - BALL_RADIUS * 0.3, ball.y - BALL_RADIUS * 0.3, BALL_RADIUS * 0.1,
    ball.x, ball.y, BALL_RADIUS
  );
  gradient.addColorStop(0, 'rgba(255,255,255,0.65)');
  gradient.addColorStop(0.4, color);
  gradient.addColorStop(1, color);

  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
}

function drawPlayer(now: number) {
  const isInvincible = now < invincibleUntil;
  const blinking = isInvincible && Math.floor(now / 100) % 2 === 0;
  if (blinking) return;

  if (isSpriteReady(spriteImages.player)) {
    ctx.save();
    ctx.shadowColor = 'rgba(89, 207, 191, 0.42)';
    ctx.shadowBlur = isInvincible ? 22 : 12;
    drawSprite(spriteImages.player, player.x, player.y, PLAYER_SPRITE_SIZE);
    ctx.restore();
    return;
  }

  const gradient = ctx.createRadialGradient(
    player.x - PLAYER_RADIUS * 0.3, player.y - PLAYER_RADIUS * 0.35, PLAYER_RADIUS * 0.1,
    player.x, player.y, PLAYER_RADIUS
  );
  gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.6, COLOR_PRIMARY);
  gradient.addColorStop(1, COLOR_PRIMARY);

  ctx.save();
  ctx.shadowColor = 'rgba(255, 111, 145, 0.5)';
  ctx.shadowBlur = isInvincible ? 22 : 12;
  ctx.beginPath();
  ctx.arc(player.x, player.y, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
}

function loop(now: number) {
  if (phase !== 'playing') return;

  const dt = Math.min(0.05, (now - lastFrameAt) / 1000);
  lastFrameAt = now;
  elapsedMs += dt * 1000;

  if (elapsedMs >= nextDifficultyStepAt) {
    applyDifficultyStep();
    nextDifficultyStepAt += DIFFICULTY_INTERVAL_MS;
  }

  updateBalls(dt);
  checkCollisions(now);
  if (phase !== 'playing') return;

  hudTime.textContent = `${(elapsedMs / 1000).toFixed(1)}s`;

  ctx.clearRect(0, 0, stageWidth, stageHeight);
  for (const ball of balls) drawBall(ball);
  drawPlayer(now);
  updateTestAttrs();

  rafId = requestAnimationFrame(loop);
}

/** Playwright 테스트가 결정론적으로 상호작용할 수 있도록 상태를 data-* 속성으로 노출한다. */
function updateTestAttrs() {
  canvas.dataset.playerX = String(player.x);
  canvas.dataset.playerY = String(player.y);
  canvas.dataset.hp = String(hp);
  canvas.dataset.redCount = String(balls.filter((b) => b.kind === 'red').length);
  canvas.dataset.greenCount = String(balls.filter((b) => b.kind === 'green').length);
  const firstGreen = balls.find((b) => b.kind === 'green');
  const firstRed = balls.find((b) => b.kind === 'red');
  if (firstGreen) {
    canvas.dataset.greenX = String(firstGreen.x);
    canvas.dataset.greenY = String(firstGreen.y);
  }
  if (firstRed) {
    canvas.dataset.redX = String(firstRed.x);
    canvas.dataset.redY = String(firstRed.y);
  }
}

// ── Events ────────────────────────────────────
onDrag(canvas, {
  onMove: (pos) => {
    if (phase !== 'playing') return;
    player.x = Math.min(Math.max(PLAYER_RADIUS, pos.x), stageWidth - PLAYER_RADIUS);
    player.y = Math.min(Math.max(PLAYER_RADIUS, pos.y), stageHeight - PLAYER_RADIUS);
  }
});

startBtn.addEventListener('click', startGame);
retryBtn.addEventListener('click', startGame);
