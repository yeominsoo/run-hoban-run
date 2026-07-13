import './2048-hex.css';
import { loadBestScore, saveBestScore } from '../../shared/score-store';

const GAME_SLUG = '2048-hex';
const RADIUS = 2;
const WIN_VALUE = 2048;
const FOUR_SPAWN_CHANCE = 0.1;
const SWIPE_MIN_DISTANCE = 24;

type Phase = 'idle' | 'playing' | 'ended';

interface Axial {
  q: number;
  r: number;
}

interface DirectionDef {
  key: string;
  dq: number;
  dr: number;
}

const DIRECTIONS: DirectionDef[] = [
  { key: 'E', dq: 1, dr: 0 },
  { key: 'W', dq: -1, dr: 0 },
  { key: 'NE', dq: 1, dr: -1 },
  { key: 'SW', dq: -1, dr: 1 },
  { key: 'NW', dq: 0, dr: -1 },
  { key: 'SE', dq: 0, dr: 1 }
];

const KEY_TO_DIRECTION: Record<string, string> = {
  KeyQ: 'NW',
  KeyW: 'NE',
  KeyE: 'E',
  KeyA: 'W',
  KeyS: 'SW',
  KeyD: 'SE'
};

function cellKey(q: number, r: number): string {
  return `${q},${r}`;
}

function allCells(): Axial[] {
  const cells: Axial[] = [];
  for (let q = -RADIUS; q <= RADIUS; q += 1) {
    for (let r = -RADIUS; r <= RADIUS; r += 1) {
      if (q + r >= -RADIUS && q + r <= RADIUS) cells.push({ q, r });
    }
  }
  return cells;
}

function cube(q: number, r: number) {
  return { x: q, z: r, y: -q - r };
}

/** pointy-top 육각형 픽셀 델타. size=1 기준 단위 벡터 — 렌더링과 스와이프 판정이 이 식을 공유한다. */
function axialDeltaToPixel(dq: number, dr: number) {
  return { x: Math.sqrt(3) * (dq + dr / 2), y: 1.5 * dr };
}

const DIRECTION_ANGLES = DIRECTIONS.map((d) => {
  const p = axialDeltaToPixel(d.dq, d.dr);
  return { key: d.key, angle: Math.atan2(p.y, p.x) };
});

function angleToDirectionKey(angle: number): string {
  let best = DIRECTION_ANGLES[0].key;
  let bestDiff = Infinity;
  for (const d of DIRECTION_ANGLES) {
    let diff = Math.abs(angle - d.angle);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = d.key;
    }
  }
  return best;
}

const ALL_CELLS = allCells();

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="hx-shell">
    <header class="game-header">
      <a class="back-link" href="/">← 게임 선택</a>
      <h1 class="game-title">2048 변형(육각형)</h1>
      <div class="best-score">최고 <strong id="best-score">0</strong></div>
    </header>

    <div class="game-stage" id="game-stage">
      <canvas id="hx-canvas"></canvas>

      <div class="hud" id="hud" hidden>
        <span class="hud-value" id="hud-score">0</span>
        <span class="hud-label">점수</span>
      </div>

      <div class="win-badge hidden" id="win-badge">2048 달성! 🎉</div>

      <div class="overlay" id="start-overlay">
        <div class="overlay-card">
          <h2>2048 변형(육각형)</h2>
          <p>같은 숫자 타일을 밀어서 합쳐 2048을 만들어보세요.<br>
          키보드: <strong>Q</strong>=NW · <strong>W</strong>=NE · <strong>E</strong>=E · <strong>A</strong>=W · <strong>S</strong>=SW · <strong>D</strong>=SE<br>
          모바일에서는 6방향 스와이프로 조작하세요.</p>
          <button id="start-btn" class="primary-btn" type="button">시작하기</button>
        </div>
      </div>

      <div class="overlay hidden" id="result-overlay">
        <div class="overlay-card">
          <h2>더 이상 이동할 수 없어요!</h2>
          <div class="result-score" id="result-score">0</div>
          <div class="result-stats"><span id="result-max-tile">최고 타일 0</span></div>
          <p class="record-badge hidden" id="record-badge">🏆 신기록!</p>
          <button id="retry-btn" class="primary-btn" type="button">다시 하기</button>
        </div>
      </div>
    </div>
  </div>
`;

// ── Refs ──────────────────────────────────────
const stage = document.getElementById('game-stage')!;
const canvas = document.getElementById('hx-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hud = document.getElementById('hud')!;
const hudScore = document.getElementById('hud-score')!;
const bestScoreEl = document.getElementById('best-score')!;
const winBadge = document.getElementById('win-badge')!;
const startOverlay = document.getElementById('start-overlay')!;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const resultOverlay = document.getElementById('result-overlay')!;
const resultScore = document.getElementById('result-score')!;
const resultMaxTile = document.getElementById('result-max-tile')!;
const recordBadge = document.getElementById('record-badge')!;
const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;

// ── Theme colors ───────────────────────────────
const rootStyle = getComputedStyle(document.documentElement);
const cssVar = (name: string) => rootStyle.getPropertyValue(name).trim();
const COLOR_TEXT = cssVar('--color-page-text') || '#4b3447';

const TILE_COLORS: Record<number, string> = {
  2: '#fff4f8',
  4: '#ffe3ec',
  8: '#ffc857',
  16: '#ff9f6b',
  32: '#ff8aa8',
  64: '#ff6f91',
  128: '#c3b3ff',
  256: '#9b87f5',
  512: '#7fe3cd',
  1024: '#3fb89e',
  2048: '#f5a623'
};

function tileColor(value: number): string {
  return TILE_COLORS[value] ?? '#4b3447';
}

// ── State ─────────────────────────────────────
let phase: Phase = 'idle';
let dpr = Math.max(1, window.devicePixelRatio || 1);
let stageWidth = 0;
let stageHeight = 0;
let hexSize = 30;
let grid = new Map<string, number>();
let score = 0;
let reachedWin = false;

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

  const gridPixelSpan = (2 * RADIUS + 1) * 2; // 대략적인 가로/세로 폭 배수
  hexSize = Math.max(18, Math.min(stageWidth, stageHeight) / gridPixelSpan);
  draw();
}

// ── Helpers ───────────────────────────────────
function hexToPixel(q: number, r: number) {
  const x = hexSize * Math.sqrt(3) * (q + r / 2);
  const y = hexSize * 1.5 * r;
  return { x: stageWidth / 2 + x, y: stageHeight / 2 + y };
}

function emptyCells(): Axial[] {
  return ALL_CELLS.filter((c) => !grid.has(cellKey(c.q, c.r)));
}

function spawnRandomTile(): boolean {
  const empties = emptyCells();
  if (empties.length === 0) return false;
  const cell = empties[Math.floor(Math.random() * empties.length)];
  const value = Math.random() < FOUR_SPAWN_CHANCE ? 4 : 2;
  grid.set(cellKey(cell.q, cell.r), value);
  return true;
}

function neighbors(q: number, r: number): Axial[] {
  return DIRECTIONS.map((d) => ({ q: q + d.dq, r: r + d.dr }));
}

function hasAnyMove(): boolean {
  if (emptyCells().length > 0) return true;
  for (const cell of ALL_CELLS) {
    const value = grid.get(cellKey(cell.q, cell.r));
    if (value === undefined) continue;
    for (const n of neighbors(cell.q, cell.r)) {
      if (grid.get(cellKey(n.q, n.r)) === value) return true;
    }
  }
  return false;
}

function mergeTowardStart(values: number[]): { result: number[]; scoreGained: number } {
  const result: number[] = [];
  let scoreGained = 0;
  let i = 0;
  while (i < values.length) {
    if (i + 1 < values.length && values[i] === values[i + 1]) {
      const merged = values[i] * 2;
      result.push(merged);
      scoreGained += merged;
      i += 2;
    } else {
      result.push(values[i]);
      i += 1;
    }
  }
  return { result, scoreGained };
}

function move(directionKey: string): boolean {
  const dir = DIRECTIONS.find((d) => d.key === directionKey);
  if (!dir) return false;

  const dx = dir.dq;
  const dz = dir.dr;
  const dy = -dir.dq - dir.dr;

  let groupKeyFn: (c: Axial) => number;
  let sortKeyFn: (c: Axial) => number;
  let sign: number;

  if (dz === 0) {
    groupKeyFn = (c) => cube(c.q, c.r).z;
    sortKeyFn = (c) => cube(c.q, c.r).x;
    sign = dx;
  } else if (dy === 0) {
    groupKeyFn = (c) => cube(c.q, c.r).y;
    sortKeyFn = (c) => cube(c.q, c.r).x;
    sign = dx;
  } else {
    groupKeyFn = (c) => cube(c.q, c.r).x;
    sortKeyFn = (c) => cube(c.q, c.r).y;
    sign = dy;
  }

  const lines = new Map<number, Axial[]>();
  for (const cell of ALL_CELLS) {
    const key = groupKeyFn(cell);
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key)!.push(cell);
  }

  let moved = false;
  let totalScoreGained = 0;

  for (const cells of lines.values()) {
    cells.sort((a, b) => sortKeyFn(a) - sortKeyFn(b));
    const originalValues = cells.map((c) => grid.get(cellKey(c.q, c.r)) ?? null);
    const nonNullValues = originalValues.filter((v): v is number => v !== null);

    const orderedForMerge = sign > 0 ? [...nonNullValues].reverse() : nonNullValues;
    const { result, scoreGained } = mergeTowardStart(orderedForMerge);
    const padded: (number | null)[] = [...result, ...Array(cells.length - result.length).fill(null)];
    const finalValues = sign > 0 ? [...padded].reverse() : padded;

    finalValues.forEach((value, i) => {
      const cell = cells[i];
      const key = cellKey(cell.q, cell.r);
      if (value === null) {
        grid.delete(key);
      } else {
        grid.set(key, value);
      }
      if (value !== originalValues[i]) moved = true;
    });

    totalScoreGained += scoreGained;
  }

  if (moved) {
    score += totalScoreGained;
    if (!reachedWin && totalScoreGained > 0) {
      for (const v of grid.values()) {
        if (v >= WIN_VALUE) {
          reachedWin = true;
          winBadge.classList.remove('hidden');
          setTimeout(() => winBadge.classList.add('hidden'), 2400);
          break;
        }
      }
    }
  }

  return moved;
}

function updateHudNumbers() {
  hudScore.textContent = String(score);
  canvas.dataset.score = String(score);
}

function updateTestAttrs() {
  const entries: string[] = [];
  for (const cell of ALL_CELLS) {
    const v = grid.get(cellKey(cell.q, cell.r));
    if (v !== undefined) entries.push(`${cell.q},${cell.r}:${v}`);
  }
  canvas.dataset.tiles = entries.join('|');
}

// ── Game flow ─────────────────────────────────
function startGame() {
  phase = 'playing';
  canvas.dataset.phase = phase;
  grid = new Map();
  score = 0;
  reachedWin = false;
  spawnRandomTile();
  spawnRandomTile();

  startOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  winBadge.classList.add('hidden');
  hud.hidden = false;
  updateHudNumbers();
  updateTestAttrs();
  draw();
}

function endGame() {
  phase = 'ended';
  canvas.dataset.phase = phase;
  hud.hidden = true;

  const isRecord = saveBestScore(GAME_SLUG, score);
  bestScoreEl.textContent = String(loadBestScore(GAME_SLUG));

  const maxTile = Math.max(0, ...grid.values());
  resultScore.textContent = String(score);
  resultMaxTile.textContent = `최고 타일 ${maxTile}`;
  recordBadge.classList.toggle('hidden', !isRecord);
  resultOverlay.classList.remove('hidden');
}

function handleMove(directionKey: string) {
  if (phase !== 'playing') return;
  const moved = move(directionKey);
  if (!moved) return;

  spawnRandomTile();
  updateHudNumbers();
  updateTestAttrs();
  draw();

  if (!hasAnyMove()) {
    endGame();
  }
}

// ── Render ────────────────────────────────────
function drawHex(cx: number, cy: number, size: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const x = cx + size * Math.cos(angle);
    const y = cy + size * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function draw() {
  ctx.clearRect(0, 0, stageWidth, stageHeight);

  for (const cell of ALL_CELLS) {
    const { x, y } = hexToPixel(cell.q, cell.r);
    const value = grid.get(cellKey(cell.q, cell.r));

    drawHex(x, y, hexSize * 0.92);
    ctx.fillStyle = value ? tileColor(value) : 'rgba(255,255,255,0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (value) {
      ctx.fillStyle = value >= 8 ? '#fffdf8' : COLOR_TEXT;
      ctx.font = `900 ${Math.max(12, hexSize * 0.42)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(value), x, y);
    }
  }
}

// ── Events ────────────────────────────────────
window.addEventListener('keydown', (ev) => {
  const dir = KEY_TO_DIRECTION[ev.code];
  if (!dir || phase !== 'playing') return;
  ev.preventDefault();
  handleMove(dir);
});

let swipeStart: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (ev) => {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  swipeStart = { x: ev.clientX, y: ev.clientY };
});
canvas.addEventListener('pointerup', (ev) => {
  if (!swipeStart || phase !== 'playing') {
    swipeStart = null;
    return;
  }
  const dx = ev.clientX - swipeStart.x;
  const dy = ev.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.hypot(dx, dy) < SWIPE_MIN_DISTANCE) return;
  handleMove(angleToDirectionKey(Math.atan2(dy, dx)));
});

startBtn.addEventListener('click', startGame);
retryBtn.addEventListener('click', startGame);
