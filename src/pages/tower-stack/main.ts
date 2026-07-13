import './tower-stack.css';
import { onTap } from '../../shared/pointer';
import { loadBestScore, saveBestScore } from '../../shared/score-store';

const GAME_SLUG = 'tower-stack';
const BLOCK_HEIGHT = 34;
const MOVE_SPEED = 170; // px/sec
const MIN_WIDTH = 10;
const VISIBLE_LAYERS = 6;
const CAMERA_EASE_RATE = 8;
const GRAVITY = 900; // px/sec^2
const BASE_HUE = 200;
const HUE_STEP = 18;

type Phase = 'idle' | 'playing' | 'ended';

interface Layer {
  left: number;
  width: number;
  hue: number;
}

interface Moving {
  left: number;
  width: number;
  vx: number;
}

interface FallingChunk {
  left: number;
  width: number;
  y: number;
  vy: number;
  alpha: number;
  hue: number;
}

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="ts-shell">
    <header class="game-header">
      <a class="back-link" href="/">← 게임 선택</a>
      <h1 class="game-title">타워 쌓기</h1>
      <div class="best-score">최고 <strong id="best-score">0</strong></div>
    </header>

    <div class="game-stage" id="game-stage">
      <canvas id="ts-canvas"></canvas>

      <div class="hud" id="hud" hidden>
        <span class="hud-value" id="hud-score">0</span>
        <span class="hud-label">층</span>
      </div>

      <div class="overlay" id="start-overlay">
        <div class="overlay-card">
          <h2>타워 쌓기</h2>
          <p>좌우로 움직이는 블록을 탭해서 정확히 쌓으세요.<br>겹치지 않은 부분은 잘려나가고, 너비가 10px 미만이 되면 게임 오버!</p>
          <button id="start-btn" class="primary-btn" type="button">시작하기</button>
        </div>
      </div>

      <div class="overlay hidden" id="result-overlay">
        <div class="overlay-card">
          <h2>게임 오버!</h2>
          <div class="result-score" id="result-score">0</div>
          <div class="result-stats"><span>층 쌓음</span></div>
          <p class="record-badge hidden" id="record-badge">🏆 신기록!</p>
          <button id="retry-btn" class="primary-btn" type="button">다시 하기</button>
        </div>
      </div>
    </div>
  </div>
`;

// ── Refs ──────────────────────────────────────
const stage = document.getElementById('game-stage')!;
const canvas = document.getElementById('ts-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hud = document.getElementById('hud')!;
const hudScore = document.getElementById('hud-score')!;
const bestScoreEl = document.getElementById('best-score')!;
const startOverlay = document.getElementById('start-overlay')!;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const resultOverlay = document.getElementById('result-overlay')!;
const resultScore = document.getElementById('result-score')!;
const recordBadge = document.getElementById('record-badge')!;
const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;

// ── State ─────────────────────────────────────
let phase: Phase = 'idle';
let dpr = Math.max(1, window.devicePixelRatio || 1);
let stageWidth = 0;
let stageHeight = 0;
let layers: Layer[] = [];
let moving: Moving | null = null;
let fallingChunks: FallingChunk[] = [];
let cameraOffset = 0;
let score = 0;
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
}

// ── Helpers ───────────────────────────────────
function screenY(layerIndex: number): number {
  return stageHeight - BLOCK_HEIGHT * (layerIndex - cameraOffset + 1);
}

function spawnMoving() {
  const prev = layers[layers.length - 1];
  const width = prev.width;
  const fromLeft = layers.length % 2 === 1;
  const left = fromLeft ? 0 : stageWidth - width;
  const vx = fromLeft ? MOVE_SPEED : -MOVE_SPEED;
  moving = { left, width, vx };
}

function updateHudNumbers() {
  hudScore.textContent = String(score);
  canvas.dataset.score = String(score);
}

// ── Game flow ─────────────────────────────────
function startGame() {
  phase = 'playing';
  canvas.dataset.phase = phase;
  score = 0;
  cameraOffset = 0;
  fallingChunks = [];

  const baseWidth = Math.min(220, stageWidth * 0.6);
  layers = [{ left: (stageWidth - baseWidth) / 2, width: baseWidth, hue: BASE_HUE }];
  spawnMoving();

  startOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  hud.hidden = false;
  updateHudNumbers();

  lastFrameAt = performance.now();
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}

function endGame() {
  phase = 'ended';
  canvas.dataset.phase = phase;
  moving = null;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  hud.hidden = true;

  const isRecord = saveBestScore(GAME_SLUG, score);
  bestScoreEl.textContent = String(loadBestScore(GAME_SLUG));

  resultScore.textContent = String(score);
  recordBadge.classList.toggle('hidden', !isRecord);
  resultOverlay.classList.remove('hidden');
}

function placeBlock() {
  if (phase !== 'playing' || !moving) return;

  const prev = layers[layers.length - 1];
  const prevRight = prev.left + prev.width;
  const movingRight = moving.left + moving.width;

  const newLeft = Math.max(prev.left, moving.left);
  const newRight = Math.min(prevRight, movingRight);
  const newWidth = newRight - newLeft;

  const layerY = screenY(layers.length);
  if (moving.left < newLeft) {
    fallingChunks.push({ left: moving.left, width: newLeft - moving.left, y: layerY, vy: 40, alpha: 1, hue: BASE_HUE + layers.length * HUE_STEP });
  }
  if (movingRight > newRight) {
    fallingChunks.push({ left: newRight, width: movingRight - newRight, y: layerY, vy: 40, alpha: 1, hue: BASE_HUE + layers.length * HUE_STEP });
  }

  if (newWidth < MIN_WIDTH) {
    moving = null;
    endGame();
    return;
  }

  layers.push({ left: newLeft, width: newWidth, hue: BASE_HUE + layers.length * HUE_STEP });
  score = layers.length - 1;
  updateHudNumbers();
  spawnMoving();
}

// ── Render ────────────────────────────────────
function drawBlock(left: number, width: number, y: number, hue: number) {
  const gradient = ctx.createLinearGradient(0, y, 0, y + BLOCK_HEIGHT);
  gradient.addColorStop(0, `hsl(${hue}, 72%, 68%)`);
  gradient.addColorStop(1, `hsl(${hue}, 68%, 54%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(left, y, width, BLOCK_HEIGHT - 3);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, y + 0.5, width - 1, BLOCK_HEIGHT - 4);
}

function draw() {
  ctx.clearRect(0, 0, stageWidth, stageHeight);

  layers.forEach((layer, index) => {
    const y = screenY(index);
    if (y < -BLOCK_HEIGHT || y > stageHeight) return;
    drawBlock(layer.left, layer.width, y, layer.hue);
  });

  for (const chunk of fallingChunks) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, chunk.alpha);
    drawBlock(chunk.left, chunk.width, chunk.y, chunk.hue);
    ctx.restore();
  }

  if (moving) {
    drawBlock(moving.left, moving.width, screenY(layers.length), BASE_HUE + layers.length * HUE_STEP);
  }
}

function loop(now: number) {
  if (phase !== 'playing') return;

  const dt = Math.min(0.05, (now - lastFrameAt) / 1000);
  lastFrameAt = now;

  if (moving) {
    moving.left += moving.vx * dt;
    if (moving.left < 0) {
      moving.left = 0;
      moving.vx = Math.abs(moving.vx);
    } else if (moving.left + moving.width > stageWidth) {
      moving.left = stageWidth - moving.width;
      moving.vx = -Math.abs(moving.vx);
    }
  }

  const targetCameraOffset = Math.max(0, layers.length - VISIBLE_LAYERS);
  const easeFactor = 1 - Math.exp(-CAMERA_EASE_RATE * dt);
  cameraOffset += (targetCameraOffset - cameraOffset) * easeFactor;

  fallingChunks = fallingChunks.filter((chunk) => chunk.alpha > 0 && chunk.y < stageHeight + 80);
  for (const chunk of fallingChunks) {
    chunk.vy += GRAVITY * dt;
    chunk.y += chunk.vy * dt;
    chunk.alpha -= dt * 1.4;
  }

  draw();
  updateTestAttrs();
  rafId = requestAnimationFrame(loop);
}

/** Playwright 테스트가 정확한 타이밍에 탭할 수 있도록 상태를 data-* 속성으로 노출한다. */
function updateTestAttrs() {
  const top = layers[layers.length - 1];
  canvas.dataset.topLeft = String(top.left);
  canvas.dataset.topWidth = String(top.width);
  canvas.dataset.layers = String(layers.length);
  if (moving) {
    canvas.dataset.movingLeft = String(moving.left);
    canvas.dataset.movingWidth = String(moving.width);
  }
}

// ── Events ────────────────────────────────────
onTap(canvas, () => placeBlock());
window.addEventListener('keydown', (ev) => {
  if (ev.code === 'Space' && phase === 'playing') {
    ev.preventDefault();
    placeBlock();
  }
});

startBtn.addEventListener('click', startGame);
retryBtn.addEventListener('click', startGame);
