import './ball-dodge.css';
import { onDrag } from '../../shared/pointer';
import { loadBestScore, saveBestScore } from '../../shared/score-store';

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
          <p>드래그로 캐릭터를 움직여 빨간 볼을 피하고 초록 볼을 모으세요.<br>HP 3, 초록 볼 하나당 +10점. 30초마다 더 빨라지고 볼이 늘어납니다.</p>
          <button id="start-btn" class="primary-btn" type="button">시작하기</button>
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
          <button id="retry-btn" class="primary-btn" type="button">다시 하기</button>
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
function drawBall(ball: Ball) {
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
