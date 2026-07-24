import './typing-survival.css';
import { loadBestScore, saveBestScore } from '../../shared/score-store';
import { setupRankingUI } from '../../shared/leaderboard';
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
const isKoreanLocale = (navigator.language ?? '').toLowerCase().startsWith('ko');
// 모바일은 소프트 키보드 언어 전환 마찰을 줄이기 위해 접속 로캘 기준 단일 언어만 출제한다
// (한국어 로캘이면 한국어만, 그 외에는 영어만). 데스크톱은 기존대로 영어+한국어를 섞는다.
const wordPool = isMobile ? (isKoreanLocale ? WORDS_KO : WORDS_EN) : [...WORDS_EN, ...WORDS_KO];

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
          <p>떨어지는 단어를 바닥에 닿기 전에 타이핑하세요.<br>HP 3, 10초마다 더 빨라지고 동시에 더 많은 단어가 떨어집니다.${isMobile ? `<br><small>모바일에서는 기기 언어 설정에 따라 ${isKoreanLocale ? '한국어' : '영어'} 단어만 출제됩니다.</small>` : ''}</p>
          <button id="start-btn" class="primary-btn" type="button">시작하기</button>
          <button id="view-ranking-btn" class="ghost-btn" type="button">랭킹보기</button>
        </div>
      </div>

      <div class="overlay hidden" id="result-overlay">
        <div class="overlay-card">
          <h2>게임 오버!</h2>
          <div class="result-score" id="result-score">0</div>
          <div class="result-stats"><span id="result-level">레벨 1까지 생존</span></div>
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

/**
 * 일부 모바일 브라우저는 소프트 키보드가 뜨면 포커스된 입력을 보여주려고 문서 전체를
 * 위로 스크롤해버려서(내부 요소 리사이즈가 아니라 스크롤), 화면 상단(단어 낙하 영역)이
 * 뷰포트 밖으로 밀려나 아무 단어도 안 보이는 문제가 있었다. body를 position:fixed로
 * 고정해 브라우저의 "포커스 요소로 스크롤" 동작 자체를 막고, visualViewport 크기·스크롤
 * 변화가 있을 때마다 문서 높이를 명시적으로 맞추고 스크롤 위치를 (0,0)으로 되돌린다.
 */
function syncViewport() {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  document.documentElement.style.height = `${h}px`;
  document.body.style.height = `${h}px`;
  if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
  resizeCanvas();
}

syncViewport();
window.addEventListener('resize', syncViewport);
window.visualViewport?.addEventListener('resize', syncViewport);
window.visualViewport?.addEventListener('scroll', syncViewport);

const resetRanking = setupRankingUI(
  {
    gameSlug: GAME_SLUG,
    gameTitle: '타이핑 생존',
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
  resetRanking();
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
