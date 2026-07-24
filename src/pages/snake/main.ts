import './snake.css';
import { onSwipe } from '../../shared/pointer';
import { loadBestScore, saveBestScore } from '../../shared/score-store';
import { setupRankingUI } from '../../shared/leaderboard';

const GAME_SLUG = 'snake';
const GRID_COLS = 16;
const GRID_ROWS = 22;
const INITIAL_LENGTH = 3;
const INITIAL_TICK_MS = 220;
const MIN_TICK_MS = 90;
const SPEED_STEP_INTERVAL_MS = 15_000;
const SPEED_STEP_FACTOR = 0.88;

type Phase = 'idle' | 'playing' | 'ended';

interface Cell {
  x: number;
  y: number;
}

interface Direction {
  dx: number;
  dy: number;
}

interface Theme {
  bg: string;
  snake: string;
  head: string;
  food: string;
}

const THEMES: Theme[] = [
  { bg: '#fff4f8', snake: '#ff8aa8', head: '#ff6f91', food: '#ffc857' },
  { bg: '#effbf5', snake: '#7fe3cd', head: '#3fb89e', food: '#ff8aa8' },
  { bg: '#f5f2ff', snake: '#c3b3ff', head: '#9b87f5', food: '#ffc857' },
  { bg: '#fffaf1', snake: '#ffd98a', head: '#f5a623', food: '#5ecfbc' },
  { bg: '#eef8ff', snake: '#8ecbff', head: '#4f9eea', food: '#ff8aa8' }
];

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="sn-shell">
    <header class="game-header">
      <a class="back-link" href="/">← 게임 선택</a>
      <h1 class="game-title">스네이크 비틀기</h1>
      <div class="best-score">최고 <strong id="best-score">0</strong></div>
    </header>

    <div class="game-stage" id="game-stage">
      <canvas id="sn-canvas"></canvas>

      <div class="hud" id="hud" hidden>
        <span class="hud-value" id="hud-score">0</span>
        <span class="hud-label">먹이</span>
      </div>

      <div class="overlay" id="start-overlay">
        <div class="overlay-card">
          <h2>스네이크 비틀기</h2>
          <p>방향키·WASD 또는 스와이프로 뱀을 조종해 먹이를 먹으세요.<br>벽은 없어요 — 반대편으로 통과합니다. 시간이 지날수록 빨라지고 색이 바뀝니다.</p>
          <button id="start-btn" class="primary-btn" type="button">시작하기</button>
          <button id="view-ranking-btn" class="ghost-btn" type="button">랭킹보기</button>
        </div>
      </div>

      <div class="overlay hidden" id="result-overlay">
        <div class="overlay-card">
          <h2>게임 오버!</h2>
          <div class="result-score" id="result-score">0</div>
          <div class="result-stats"><span>먹이를 먹음</span></div>
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
const canvas = document.getElementById('sn-canvas') as HTMLCanvasElement;
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
const rankNameInput = document.getElementById('rank-name-input') as HTMLInputElement;
const rankSaveBtn = document.getElementById('rank-save-btn') as HTMLButtonElement;
const rankSavedMsg = document.getElementById('rank-saved-msg')!;
const viewRankingBtn = document.getElementById('view-ranking-btn') as HTMLButtonElement;
const rankingOverlay = document.getElementById('ranking-overlay')!;
const rankingList = document.getElementById('ranking-list')!;
const closeRankingBtn = document.getElementById('close-ranking-btn') as HTMLButtonElement;
const rankingSaveImageBtn = document.getElementById('ranking-save-image-btn') as HTMLButtonElement;
const rankingShareImageBtn = document.getElementById('ranking-share-image-btn') as HTMLButtonElement;

// ── State ─────────────────────────────────────
let phase: Phase = 'idle';
let dpr = Math.max(1, window.devicePixelRatio || 1);
let stageWidth = 0;
let stageHeight = 0;
let cellSize = 20;
let offsetX = 0;
let offsetY = 0;

let snake: Cell[] = [];
let direction: Direction = { dx: 1, dy: 0 };
let pendingDirection: Direction | null = null;
let food: Cell = { x: 0, y: 0 };
let score = 0;
let tickMs = INITIAL_TICK_MS;
let elapsedMs = 0;
let nextSpeedStepAt = SPEED_STEP_INTERVAL_MS;
let themeIndex = 0;
let lastTickAt = 0;
let frameLastAt = 0;
let rafId: number | null = null;

// ── Init ──────────────────────────────────────
bestScoreEl.textContent = String(loadBestScore(GAME_SLUG));
canvas.dataset.phase = phase;
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const resetRanking = setupRankingUI(
  {
    gameSlug: GAME_SLUG,
    gameTitle: '스네이크 비틀기',
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

  cellSize = Math.min(stageWidth / GRID_COLS, stageHeight / GRID_ROWS);
  offsetX = (stageWidth - cellSize * GRID_COLS) / 2;
  offsetY = (stageHeight - cellSize * GRID_ROWS) / 2;

  if (phase !== 'playing') draw();
}

// ── Helpers ───────────────────────────────────
function isOpposite(a: Direction, b: Direction): boolean {
  return a.dx === -b.dx && a.dy === -b.dy;
}

function spawnFood() {
  const occupied = new Set(snake.map((c) => `${c.x},${c.y}`));
  let x = 0;
  let y = 0;
  do {
    x = Math.floor(Math.random() * GRID_COLS);
    y = Math.floor(Math.random() * GRID_ROWS);
  } while (occupied.has(`${x},${y}`));
  food = { x, y };
}

function updateHudNumbers() {
  hudScore.textContent = String(score);
  canvas.dataset.score = String(score);
}

function updateTestAttrs() {
  canvas.dataset.headX = String(snake[0]?.x ?? -1);
  canvas.dataset.headY = String(snake[0]?.y ?? -1);
  canvas.dataset.foodX = String(food.x);
  canvas.dataset.foodY = String(food.y);
  canvas.dataset.length = String(snake.length);
  canvas.dataset.dirDx = String(direction.dx);
  canvas.dataset.dirDy = String(direction.dy);
}

// ── Game flow ─────────────────────────────────
function startGame() {
  phase = 'playing';
  canvas.dataset.phase = phase;
  score = 0;
  tickMs = INITIAL_TICK_MS;
  elapsedMs = 0;
  nextSpeedStepAt = SPEED_STEP_INTERVAL_MS;
  themeIndex = 0;
  direction = { dx: 1, dy: 0 };
  pendingDirection = null;

  const startX = Math.floor(GRID_COLS / 2);
  const startY = Math.floor(GRID_ROWS / 2);
  snake = Array.from({ length: INITIAL_LENGTH }, (_, i) => ({ x: startX - i, y: startY }));
  spawnFood();

  startOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  hud.hidden = false;
  updateHudNumbers();
  updateTestAttrs();

  lastTickAt = performance.now();
  frameLastAt = lastTickAt;
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

  resultScore.textContent = String(score);
  recordBadge.classList.toggle('hidden', !isRecord);
  resetRanking();
  resultOverlay.classList.remove('hidden');
}

function tick() {
  if (pendingDirection && !isOpposite(pendingDirection, direction)) {
    direction = pendingDirection;
  }
  pendingDirection = null;

  const head = snake[0];
  const nx = (head.x + direction.dx + GRID_COLS) % GRID_COLS;
  const ny = (head.y + direction.dy + GRID_ROWS) % GRID_ROWS;
  const willEat = nx === food.x && ny === food.y;

  const collides = snake.some((seg, i) => {
    if (!willEat && i === snake.length - 1) return false; // 성장하지 않으면 꼬리는 이번 틱에 비워짐
    return seg.x === nx && seg.y === ny;
  });
  if (collides) {
    endGame();
    return;
  }

  snake.unshift({ x: nx, y: ny });
  if (willEat) {
    score += 1;
    spawnFood();
    updateHudNumbers();
  } else {
    snake.pop();
  }
  updateTestAttrs();
}

// ── Render ────────────────────────────────────
function cellRect(cell: Cell) {
  return {
    x: offsetX + cell.x * cellSize,
    y: offsetY + cell.y * cellSize,
    size: cellSize
  };
}

function shadeColor(hex: string, percent: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 0xff) + Math.round(255 * percent)));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + Math.round(255 * percent)));
  const b = Math.min(255, Math.max(0, (n & 0xff) + Math.round(255 * percent)));
  return `rgb(${r},${g},${b})`;
}

function drawSnakeEyes(cx: number, cy: number, size: number, dir: Direction) {
  const eyeOffset = size * 0.16;
  const alongX = dir.dx * size * 0.14;
  const alongY = dir.dy * size * 0.14;
  const sideX = -dir.dy * eyeOffset;
  const sideY = dir.dx * eyeOffset;
  const eyeR = size * 0.11;

  for (const sign of [-1, 1]) {
    const ex = cx + alongX + sideX * sign;
    const ey = cy + alongY + sideY * sign;
    ctx.beginPath();
    ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
    ctx.fillStyle = '#fffdf8';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + dir.dx * eyeR * 0.4, ey + dir.dy * eyeR * 0.4, eyeR * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = '#2a1f28';
    ctx.fill();
  }
}

function draw() {
  const theme = THEMES[themeIndex % THEMES.length];
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, stageWidth, stageHeight);
  if (snake.length === 0) return;

  const pad = Math.max(1, cellSize * 0.08);
  const len = snake.length;

  // 꼬리 쪽으로 갈수록 살짝 얇아지게 그려 뱀 특유의 유기적인 형태를 낸다.
  snake.forEach((cell, i) => {
    if (i === 0) return;
    const r = cellRect(cell);
    const taper = Math.max(0.55, 1 - (i / len) * 0.5);
    const inset = pad + (r.size - pad * 2) * (1 - taper) * 0.5;
    const segSize = r.size - inset * 2;
    const isEven = i % 2 === 0;
    ctx.fillStyle = isEven ? theme.snake : shadeColor(theme.snake, -0.08);
    drawRoundedRect(r.x + inset, r.y + inset, segSize, segSize, segSize * 0.32);
    ctx.fill();
    // 비늘 하이라이트
    ctx.beginPath();
    ctx.arc(r.x + r.size / 2, r.y + r.size / 2 - segSize * 0.18, segSize * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = shadeColor(theme.snake, isEven ? 0.14 : 0.06);
    ctx.fill();
  });

  // 머리
  const headCell = snake[0];
  const hr = cellRect(headCell);
  const hcx = hr.x + hr.size / 2;
  const hcy = hr.y + hr.size / 2;
  drawRoundedRect(hr.x + pad * 0.6, hr.y + pad * 0.6, hr.size - pad * 1.2, hr.size - pad * 1.2, hr.size * 0.36);
  ctx.fillStyle = theme.head;
  ctx.fill();
  drawSnakeEyes(hcx, hcy, hr.size, direction);

  drawFood();
}

function drawFood() {
  const theme = THEMES[themeIndex % THEMES.length];
  const foodRect = cellRect(food);
  const pulse = 1 + Math.sin(performance.now() / 220) * 0.08;
  const cx = foodRect.x + foodRect.size / 2;
  const cy = foodRect.y + foodRect.size / 2;
  const r = (foodRect.size / 2 - Math.max(1, cellSize * 0.08)) * pulse;

  // 사과 모양: 몸통(윗부분을 살짝 눌러 하트꼴로) + 줄기 + 잎
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.15);
  ctx.bezierCurveTo(cx - r * 0.55, cy - r * 1.15, cx - r * 1.15, cy - r * 0.15, cx, cy + r * 1.05);
  ctx.bezierCurveTo(cx + r * 1.15, cy - r * 0.15, cx + r * 0.55, cy - r * 1.15, cx, cy - r * 0.15);
  ctx.closePath();
  ctx.fillStyle = theme.food;
  ctx.fill();

  ctx.strokeStyle = shadeColor(theme.food, -0.25);
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.55);
  ctx.lineTo(cx, cy - r * 0.95);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(cx + r * 0.35, cy - r * 0.85, r * 0.32, r * 0.16, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = shadeColor('#5ecfbc', 0.05);
  ctx.fill();
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

function loop(now: number) {
  if (phase !== 'playing') return;

  const dt = Math.min(0.05, (now - frameLastAt) / 1000);
  frameLastAt = now;
  elapsedMs += dt * 1000;

  if (elapsedMs >= nextSpeedStepAt) {
    tickMs = Math.max(MIN_TICK_MS, tickMs * SPEED_STEP_FACTOR);
    themeIndex += 1;
    nextSpeedStepAt += SPEED_STEP_INTERVAL_MS;
  }

  if (now - lastTickAt >= tickMs) {
    lastTickAt = now;
    tick();
    if (phase !== 'playing') return;
  }

  draw();
  rafId = requestAnimationFrame(loop);
}

// ── Events ────────────────────────────────────
const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  KeyW: { dx: 0, dy: -1 },
  KeyS: { dx: 0, dy: 1 },
  KeyA: { dx: -1, dy: 0 },
  KeyD: { dx: 1, dy: 0 }
};

window.addEventListener('keydown', (ev) => {
  const dir = KEY_DIRECTIONS[ev.code];
  if (!dir || phase !== 'playing') return;
  ev.preventDefault();
  pendingDirection = dir;
});

onSwipe(canvas, (dir) => {
  if (phase !== 'playing') return;
  const map: Record<string, Direction> = {
    up: { dx: 0, dy: -1 },
    down: { dx: 0, dy: 1 },
    left: { dx: -1, dy: 0 },
    right: { dx: 1, dy: 0 }
  };
  pendingDirection = map[dir];
});

startBtn.addEventListener('click', startGame);
retryBtn.addEventListener('click', startGame);
