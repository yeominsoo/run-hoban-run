import './color-slider.css';
import { loadBestScore, saveBestScore } from '../../shared/score-store';
import { setupRankingUI, resetRankingSubmission } from '../../shared/leaderboard';

const GAME_SLUG = 'color-slider';
const ROUND_COUNT = 10;
const ROUND_DURATION_MS = 15_000;
const MAX_DIST = Math.sqrt(255 ** 2 * 3);
const NEUTRAL = 128;

type Phase = 'idle' | 'playing' | 'ended';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="cs-shell">
    <header class="game-header">
      <a class="back-link" href="/">← 게임 선택</a>
      <h1 class="game-title">색 맞추기 슬라이더</h1>
      <div class="best-score">최고 <strong id="best-score">0</strong></div>
    </header>

    <div class="game-stage" id="game-stage">
      <div class="cs-play" id="cs-play" hidden>
        <div class="hud" id="hud">
          <div class="hud-item"><span class="hud-label">라운드</span><span class="hud-value" id="hud-round">1/10</span></div>
          <div class="hud-item"><span class="hud-label">시간</span><span class="hud-value" id="hud-time">15.0</span></div>
          <div class="hud-item"><span class="hud-label">점수</span><span class="hud-value" id="hud-score">0</span></div>
          <div class="hud-item"><span class="hud-label">정확도</span><span class="hud-value" id="hud-accuracy">0%</span></div>
        </div>

        <canvas id="cs-canvas"></canvas>

        <div class="cs-sliders">
          <label class="cs-slider-row">
            <span class="cs-slider-label cs-r">R</span>
            <input type="range" id="slider-r" min="0" max="255" value="128" />
            <span class="cs-slider-value" id="value-r">128</span>
          </label>
          <label class="cs-slider-row">
            <span class="cs-slider-label cs-g">G</span>
            <input type="range" id="slider-g" min="0" max="255" value="128" />
            <span class="cs-slider-value" id="value-g">128</span>
          </label>
          <label class="cs-slider-row">
            <span class="cs-slider-label cs-b">B</span>
            <input type="range" id="slider-b" min="0" max="255" value="128" />
            <span class="cs-slider-value" id="value-b">128</span>
          </label>
        </div>

        <button id="confirm-btn" class="primary-btn" type="button">확정하고 다음 라운드</button>
      </div>

      <div class="overlay" id="start-overlay">
        <div class="overlay-card">
          <h2>색 맞추기 슬라이더</h2>
          <p>10라운드 동안 R/G/B 슬라이더로 목표 색을 최대한 똑같이 맞춰보세요.<br>라운드당 15초, 정확할수록 높은 점수!</p>
          <button id="start-btn" class="primary-btn" type="button">시작하기</button>
          <button id="view-ranking-btn" class="ghost-btn" type="button">랭킹보기</button>
        </div>
      </div>

      <div class="overlay hidden" id="result-overlay">
        <div class="overlay-card">
          <h2>10라운드 종료!</h2>
          <div class="result-score" id="result-score">0</div>
          <div class="result-stats">
            <span id="result-avg">평균 정확도 0%</span>
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
const csPlay = document.getElementById('cs-play')!;
const canvas = document.getElementById('cs-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hudRound = document.getElementById('hud-round')!;
const hudTime = document.getElementById('hud-time')!;
const hudScore = document.getElementById('hud-score')!;
const hudAccuracy = document.getElementById('hud-accuracy')!;
const bestScoreEl = document.getElementById('best-score')!;
const startOverlay = document.getElementById('start-overlay')!;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const resultOverlay = document.getElementById('result-overlay')!;
const resultScore = document.getElementById('result-score')!;
const resultAvg = document.getElementById('result-avg')!;
const recordBadge = document.getElementById('record-badge')!;
const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;
const confirmBtn = document.getElementById('confirm-btn') as HTMLButtonElement;
const rankNameInput = document.getElementById('rank-name-input') as HTMLInputElement;
const rankSaveBtn = document.getElementById('rank-save-btn') as HTMLButtonElement;
const rankSavedMsg = document.getElementById('rank-saved-msg')!;
const viewRankingBtn = document.getElementById('view-ranking-btn') as HTMLButtonElement;
const rankingOverlay = document.getElementById('ranking-overlay')!;
const rankingList = document.getElementById('ranking-list')!;
const closeRankingBtn = document.getElementById('close-ranking-btn') as HTMLButtonElement;
const rankingSaveImageBtn = document.getElementById('ranking-save-image-btn') as HTMLButtonElement;
const rankingShareImageBtn = document.getElementById('ranking-share-image-btn') as HTMLButtonElement;
const sliderR = document.getElementById('slider-r') as HTMLInputElement;
const sliderG = document.getElementById('slider-g') as HTMLInputElement;
const sliderB = document.getElementById('slider-b') as HTMLInputElement;
const valueR = document.getElementById('value-r')!;
const valueG = document.getElementById('value-g')!;
const valueB = document.getElementById('value-b')!;

// ── State ─────────────────────────────────────
let phase: Phase = 'idle';
let currentRoundIndex = 0;
let score = 0;
let roundScores: number[] = [];
let target: Rgb = { r: NEUTRAL, g: NEUTRAL, b: NEUTRAL };
let current: Rgb = { r: NEUTRAL, g: NEUTRAL, b: NEUTRAL };
let roundStartedAt = 0;
let rafId: number | null = null;
let dpr = Math.max(1, window.devicePixelRatio || 1);

// ── Init ──────────────────────────────────────
bestScoreEl.textContent = String(loadBestScore(GAME_SLUG));
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

setupRankingUI(
  {
    gameSlug: GAME_SLUG,
    gameTitle: '색 맞추기 슬라이더',
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
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 320;
  const height = rect.height || 140;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawSwatches();
}

// ── Helpers ───────────────────────────────────
function rgbCss(c: Rgb): string {
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

function randomColor(): Rgb {
  return {
    r: Math.floor(Math.random() * 256),
    g: Math.floor(Math.random() * 256),
    b: Math.floor(Math.random() * 256)
  };
}

function accuracyFraction(): number {
  const dist = Math.hypot(current.r - target.r, current.g - target.g, current.b - target.b);
  return Math.max(0, 1 - dist / MAX_DIST);
}

function drawRoundedRect(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawSwatches() {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 320;
  const height = rect.height || 140;
  ctx.clearRect(0, 0, width, height);

  const gap = 12;
  const swatchW = (width - gap) / 2;

  ctx.fillStyle = rgbCss(target);
  drawRoundedRect(0, 0, swatchW, height, 14);
  ctx.fill();

  ctx.fillStyle = rgbCss(current);
  drawRoundedRect(swatchW + gap, 0, swatchW, height, 14);
  ctx.fill();

  ctx.font = '700 12px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.fillText('목표', swatchW / 2, height - 12);
  ctx.fillText('내 색', swatchW + gap + swatchW / 2, height - 12);
}

function updateSliderLabels() {
  valueR.textContent = String(current.r);
  valueG.textContent = String(current.g);
  valueB.textContent = String(current.b);
}

function updateAccuracyDisplay() {
  const pct = Math.round(accuracyFraction() * 100);
  hudAccuracy.textContent = `${pct}%`;
}

// ── Game flow ─────────────────────────────────
function startGame() {
  phase = 'playing';
  score = 0;
  roundScores = [];
  currentRoundIndex = 0;

  startOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  csPlay.hidden = false;
  hudScore.textContent = '0';

  startRound();

  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}

function startRound() {
  target = randomColor();
  current = { r: NEUTRAL, g: NEUTRAL, b: NEUTRAL };
  sliderR.value = String(NEUTRAL);
  sliderG.value = String(NEUTRAL);
  sliderB.value = String(NEUTRAL);
  updateSliderLabels();
  updateAccuracyDisplay();
  drawSwatches();
  roundStartedAt = performance.now();
  hudRound.textContent = `${currentRoundIndex + 1}/${ROUND_COUNT}`;
  hudTime.textContent = (ROUND_DURATION_MS / 1000).toFixed(1);
}

function confirmRound() {
  if (phase !== 'playing') return;
  const roundScore = Math.round(accuracyFraction() * 100);
  score += roundScore;
  roundScores.push(roundScore);
  hudScore.textContent = String(score);
  currentRoundIndex += 1;

  if (currentRoundIndex >= ROUND_COUNT) {
    endGame();
  } else {
    startRound();
  }
}

function endGame() {
  phase = 'ended';
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  csPlay.hidden = true;

  const isRecord = saveBestScore(GAME_SLUG, score);
  bestScoreEl.textContent = String(loadBestScore(GAME_SLUG));

  const avgAccuracy = roundScores.length === 0
    ? 0
    : Math.round(roundScores.reduce((a, b) => a + b, 0) / roundScores.length);

  resultScore.textContent = String(score);
  resultAvg.textContent = `평균 정확도 ${avgAccuracy}%`;
  recordBadge.classList.toggle('hidden', !isRecord);
  resetRankingSubmission({ nameInput: rankNameInput, saveBtn: rankSaveBtn, savedMsg: rankSavedMsg });
  resultOverlay.classList.remove('hidden');
}

function loop(now: number) {
  if (phase !== 'playing') return;

  const elapsed = now - roundStartedAt;
  const remainingMs = Math.max(0, ROUND_DURATION_MS - elapsed);
  hudTime.textContent = (remainingMs / 1000).toFixed(1);

  if (remainingMs <= 0) {
    confirmRound();
    if (phase !== 'playing') return;
  }

  rafId = requestAnimationFrame(loop);
}

// ── Events ────────────────────────────────────
function onSliderInput() {
  current = {
    r: Number(sliderR.value),
    g: Number(sliderG.value),
    b: Number(sliderB.value)
  };
  updateSliderLabels();
  updateAccuracyDisplay();
  drawSwatches();
}

sliderR.addEventListener('input', onSliderInput);
sliderG.addEventListener('input', onSliderInput);
sliderB.addEventListener('input', onSliderInput);

confirmBtn.addEventListener('click', confirmRound);
startBtn.addEventListener('click', startGame);
retryBtn.addEventListener('click', startGame);
