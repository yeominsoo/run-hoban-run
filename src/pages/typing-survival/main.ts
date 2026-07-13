import './typing-survival.css';
import { loadBestScore, saveBestScore } from '../../shared/score-store';
import { WORDS_EN, WORDS_KO } from './word-lists';

const GAME_SLUG = 'typing-survival';
const MAX_HP = 3;
const INITIAL_MAX_CONCURRENT = 1;
const MAX_CONCURRENT_CAP = 6;
const INITIAL_FALL_SPEED = 40; // px/sec
const SPEED_STEP_FACTOR = 1.12;
const LEVEL_STEP_INTERVAL_MS = 10_000;
const MIN_SPAWN_GAP_MS = 700;
const FLOOR_MARGIN = 34;
const WORD_PADDING_X = 40;

type Phase = 'idle' | 'playing' | 'ended';

interface FallingWord {
  id: number;
  text: string;
  x: number;
  y: number;
}

const isMobile = window.matchMedia('(pointer: coarse)').matches;
const wordPool = isMobile ? WORDS_EN : [...WORDS_EN, ...WORDS_KO];

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="tp-shell">
    <header class="game-header">
      <a class="back-link" href="/">← 게임 선택</a>
      <h1 class="game-title">타이핑 생존</h1>
      <div class="best-score">최고 <strong id="best-score">0</strong></div>
    </header>

    <div class="game-stage" id="game-stage">
      <canvas id="tp-canvas"></canvas>

      <div class="hud" id="hud" hidden>
        <span class="hud-value" id="hud-hp">❤️❤️❤️</span>
        <span class="hud-value" id="hud-score">0</span>
        <span class="hud-value" id="hud-level">Lv.1</span>
      </div>

      <div class="input-bar" id="input-bar" hidden>
        <input id="tp-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="단어를 입력하세요" />
      </div>

      <div class="overlay" id="start-overlay">
        <div class="overlay-card">
          <h2>타이핑 생존</h2>
          <p>떨어지는 단어를 바닥에 닿기 전에 타이핑하세요.<br>HP 3, 10초마다 더 빨라지고 동시에 더 많은 단어가 떨어집니다.${isMobile ? '<br><small>모바일에서는 영어 단어만 출제됩니다.</small>' : ''}</p>
          <button id="start-btn" class="primary-btn" type="button">시작하기</button>
        </div>
      </div>

      <div class="overlay hidden" id="result-overlay">
        <div class="overlay-card">
          <h2>게임 오버!</h2>
          <div class="result-score" id="result-score">0</div>
          <div class="result-stats"><span id="result-level">레벨 1까지 생존</span></div>
          <p class="record-badge hidden" id="record-badge">🏆 신기록!</p>
          <button id="retry-btn" class="primary-btn" type="button">다시 하기</button>
        </div>
      </div>
    </div>
  </div>
`;

// ── Refs ──────────────────────────────────────
const stage = document.getElementById('game-stage')!;
const canvas = document.getElementById('tp-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hud = document.getElementById('hud')!;
const hudHp = document.getElementById('hud-hp')!;
const hudScore = document.getElementById('hud-score')!;
const hudLevel = document.getElementById('hud-level')!;
const bestScoreEl = document.getElementById('best-score')!;
const inputBar = document.getElementById('input-bar')!;
const input = document.getElementById('tp-input') as HTMLInputElement;
const startOverlay = document.getElementById('start-overlay')!;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const resultOverlay = document.getElementById('result-overlay')!;
const resultScore = document.getElementById('result-score')!;
const resultLevel = document.getElementById('result-level')!;
const recordBadge = document.getElementById('record-badge')!;
const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;

// ── Theme colors ───────────────────────────────
const rootStyle = getComputedStyle(document.documentElement);
const cssVar = (name: string) => rootStyle.getPropertyValue(name).trim();
const COLOR_TEXT = cssVar('--color-page-text') || '#4b3447';
const COLOR_DANGER = cssVar('--color-danger') || '#e85d75';

// ── State ─────────────────────────────────────
let phase: Phase = 'idle';
let dpr = Math.max(1, window.devicePixelRatio || 1);
let stageWidth = 0;
let stageHeight = 0;
let words: FallingWord[] = [];
let nextId = 0;
let hp = MAX_HP;
let score = 0;
let elapsedMs = 0;
let level = 1;
let fallSpeed = INITIAL_FALL_SPEED;
let maxConcurrent = INITIAL_MAX_CONCURRENT;
let lastSpawnAt = 0;
let lastFrameAt = 0;
let rafId: number | null = null;

// ── Init ──────────────────────────────────────
bestScoreEl.textContent = String(loadBestScore(GAME_SLUG));
canvas.dataset.phase = phase;
resizeCanvas();
window.addEventListener('resize', resizeCanvas);
window.visualViewport?.addEventListener('resize', resizeCanvas);

function resizeCanvas() {
  dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = stage.getBoundingClientRect();
  const vv = window.visualViewport;
  // 소프트 키보드가 열려 visualViewport가 줄어들면 그 높이를 우선 사용해 캔버스가
  // 키보드 밑으로 가려지지 않게 한다.
  const vvAvailable = vv ? Math.max(0, vv.height - rect.top) : rect.height;
  stageWidth = rect.width;
  stageHeight = Math.min(rect.height, vvAvailable || rect.height);

  canvas.width = Math.round(stageWidth * dpr);
  canvas.height = Math.round(stageHeight * dpr);
  canvas.style.width = `${stageWidth}px`;
  canvas.style.height = `${stageHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ── Helpers ───────────────────────────────────
function floorY(): number {
  return stageHeight - FLOOR_MARGIN;
}

function randomWordText(): string {
  return wordPool[Math.floor(Math.random() * wordPool.length)];
}

function spawnWord(now: number) {
  if (words.length >= maxConcurrent) return;
  if (now - lastSpawnAt < MIN_SPAWN_GAP_MS) return;

  const text = randomWordText();
  let x = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    x = WORD_PADDING_X + Math.random() * Math.max(1, stageWidth - WORD_PADDING_X * 2);
    const tooClose = words.some((w) => Math.abs(w.x - x) < 60 && w.y < stageHeight * 0.3);
    if (!tooClose) break;
  }

  words.push({ id: nextId++, text, x, y: -20 });
  lastSpawnAt = now;
}

function updateHudNumbers() {
  hudHp.textContent = '❤️'.repeat(Math.max(0, hp)) + '🖤'.repeat(Math.max(0, MAX_HP - hp));
  hudScore.textContent = String(score);
  hudLevel.textContent = `Lv.${level}`;
  canvas.dataset.hp = String(hp);
  canvas.dataset.score = String(score);
  canvas.dataset.level = String(level);
}

function updateTestAttrs() {
  canvas.dataset.wordCount = String(words.length);
  canvas.dataset.words = words.map((w) => w.text).join('|');
}

// ── Game flow ─────────────────────────────────
function startGame() {
  phase = 'playing';
  canvas.dataset.phase = phase;
  hp = MAX_HP;
  score = 0;
  elapsedMs = 0;
  level = 1;
  fallSpeed = INITIAL_FALL_SPEED;
  maxConcurrent = INITIAL_MAX_CONCURRENT;
  words = [];
  nextId = 0;
  lastSpawnAt = -MIN_SPAWN_GAP_MS;

  startOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  hud.hidden = false;
  inputBar.hidden = false;
  input.value = '';
  updateHudNumbers();
  updateTestAttrs();

  lastFrameAt = performance.now();
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
  requestAnimationFrame(() => input.focus());
}

function endGame() {
  phase = 'ended';
  canvas.dataset.phase = phase;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  hud.hidden = true;
  inputBar.hidden = true;

  const isRecord = saveBestScore(GAME_SLUG, score);
  bestScoreEl.textContent = String(loadBestScore(GAME_SLUG));

  resultScore.textContent = String(score);
  resultLevel.textContent = `레벨 ${level}까지 생존`;
  recordBadge.classList.toggle('hidden', !isRecord);
  resultOverlay.classList.remove('hidden');
}

function tryMatch(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return;

  let best: FallingWord | null = null;
  for (const w of words) {
    if (w.text.toLowerCase() !== normalized) continue;
    if (!best || w.y > best.y) best = w;
  }
  if (!best) return;

  words = words.filter((w) => w.id !== best!.id);
  score += level;
  input.value = '';
  updateHudNumbers();
  updateTestAttrs();
}

// ── Render ────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, stageWidth, stageHeight);

  const fy = floorY();
  ctx.strokeStyle = 'rgba(232, 93, 117, 0.35)';
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(0, fy);
  ctx.lineTo(stageWidth, fy);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const w of words) {
    const dangerT = Math.min(1, Math.max(0, w.y / fy));
    ctx.font = '800 20px Inter, sans-serif';
    ctx.fillStyle = dangerT > 0.75 ? COLOR_DANGER : COLOR_TEXT;
    ctx.fillText(w.text, w.x, w.y);
  }
}

function loop(now: number) {
  if (phase !== 'playing') return;

  const dt = Math.min(0.05, (now - lastFrameAt) / 1000);
  lastFrameAt = now;
  elapsedMs += dt * 1000;

  const targetLevel = Math.floor(elapsedMs / LEVEL_STEP_INTERVAL_MS) + 1;
  if (targetLevel > level) {
    level = targetLevel;
    fallSpeed *= SPEED_STEP_FACTOR;
    maxConcurrent = Math.min(MAX_CONCURRENT_CAP, maxConcurrent + 1);
    updateHudNumbers();
  }

  spawnWord(now);

  const fy = floorY();
  let hpLost = 0;
  words = words.filter((w) => {
    w.y += fallSpeed * dt;
    if (w.y >= fy) {
      hpLost += 1;
      return false;
    }
    return true;
  });

  if (hpLost > 0) {
    hp -= hpLost;
    updateHudNumbers();
    if (hp <= 0) {
      endGame();
      return;
    }
  }

  updateTestAttrs();
  draw();
  rafId = requestAnimationFrame(loop);
}

// ── Events ────────────────────────────────────
input.addEventListener('input', () => tryMatch(input.value));
input.addEventListener('blur', () => {
  if (phase === 'playing') requestAnimationFrame(() => input.focus());
});

startBtn.addEventListener('click', startGame);
retryBtn.addEventListener('click', startGame);
