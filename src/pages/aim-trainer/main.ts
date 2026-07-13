import './aim-trainer.css';
import { onTap } from '../../shared/pointer';
import { loadBestScore, saveBestScore } from '../../shared/score-store';
import { setupRankingUI, resetRankingSubmission } from '../../shared/leaderboard';

const GAME_SLUG = 'aim-trainer';
const GAME_DURATION_MS = 30_000;
const START_RADIUS = 80;
const MIN_RADIUS = 30;
const RADIUS_STEP_PER_HIT = 5;
const HIT_BASE_SCORE = 100;
const SPEED_BONUS_MAX = 100;
const SPEED_BONUS_WINDOW_MS = 600;
const HIT_POPUP_DURATION_MS = 700;
const MISS_FLASH_DURATION_MS = 220;
const MAX_LEVEL = Math.floor((START_RADIUS - MIN_RADIUS) / RADIUS_STEP_PER_HIT) + 1;

type Phase = 'idle' | 'playing' | 'ended';

interface Circle {
  x: number;
  y: number;
  radius: number;
  spawnedAt: number;
}

interface ScorePopup {
  x: number;
  y: number;
  text: string;
  startedAt: number;
}

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="aim-shell">
    <header class="game-header">
      <a class="back-link" href="/">← 게임 선택</a>
      <h1 class="game-title">에임 트레이너</h1>
      <div class="best-score">최고 <strong id="best-score">0</strong></div>
    </header>

    <div class="game-stage" id="game-stage">
      <canvas id="aim-canvas"></canvas>

      <div class="hud" id="hud" hidden>
        <div class="hud-item"><span class="hud-label">시간</span><span class="hud-value" id="hud-time">30.0</span></div>
        <div class="hud-item"><span class="hud-label">점수</span><span class="hud-value" id="hud-score">0</span></div>
        <div class="hud-item"><span class="hud-label">명중</span><span class="hud-value" id="hud-hits">0</span></div>
        <div class="hud-item"><span class="hud-label">Lv</span><span class="hud-value" id="hud-level">1</span></div>
      </div>

      <div class="overlay" id="start-overlay">
        <div class="overlay-card">
          <h2>에임 트레이너</h2>
          <p>화면에 나타나는 원을 최대한 빠르고 정확하게 탭하세요(첫 탭부터 30초 시작).<br>레벨이 오를수록 원이 작아집니다.</p>
          <button id="start-btn" class="primary-btn" type="button">시작하기</button>
          <button id="view-ranking-btn" class="ghost-btn" type="button">랭킹보기</button>
        </div>
      </div>

      <div class="overlay hidden" id="result-overlay">
        <div class="overlay-card">
          <h2>게임 종료!</h2>
          <div class="result-score" id="result-score">0</div>
          <div class="result-stats">
            <span id="result-hits">명중 0</span>
            <span id="result-misses">미스 0</span>
            <span id="result-accuracy">정확도 0%</span>
          </div>
          <p class="record-badge hidden" id="record-badge">🏆 신기록!</p>

          <div class="rank-entry-form" id="rank-entry-form">
            <input id="rank-name-input" class="rank-name-input" type="text" maxlength="12" placeholder="닉네임" autocomplete="off" />
            <button id="rank-save-btn" class="rank-save-btn" type="button">기록 저장</button>
          </div>
          <p class="rank-saved-msg hidden" id="rank-saved-msg">저장했어요!</p>

          <div class="result-image-actions">
            <button id="save-image-btn" class="ghost-btn" type="button">이미지 저장</button>
            <button id="share-image-btn" class="ghost-btn hidden" type="button">공유하기</button>
          </div>

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
const canvas = document.getElementById('aim-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hud = document.getElementById('hud')!;
const hudTime = document.getElementById('hud-time')!;
const hudScore = document.getElementById('hud-score')!;
const hudHits = document.getElementById('hud-hits')!;
const hudLevel = document.getElementById('hud-level')!;
const bestScoreEl = document.getElementById('best-score')!;
const startOverlay = document.getElementById('start-overlay')!;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const resultOverlay = document.getElementById('result-overlay')!;
const resultScore = document.getElementById('result-score')!;
const resultHits = document.getElementById('result-hits')!;
const resultMisses = document.getElementById('result-misses')!;
const resultAccuracy = document.getElementById('result-accuracy')!;
const recordBadge = document.getElementById('record-badge')!;
const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;
const rankNameInput = document.getElementById('rank-name-input') as HTMLInputElement;
const rankSaveBtn = document.getElementById('rank-save-btn') as HTMLButtonElement;
const rankSavedMsg = document.getElementById('rank-saved-msg')!;
const viewRankingBtn = document.getElementById('view-ranking-btn') as HTMLButtonElement;
const rankingOverlay = document.getElementById('ranking-overlay')!;
const rankingList = document.getElementById('ranking-list')!;
const closeRankingBtn = document.getElementById('close-ranking-btn') as HTMLButtonElement;
const saveImageBtn = document.getElementById('save-image-btn') as HTMLButtonElement;
const shareImageBtn = document.getElementById('share-image-btn') as HTMLButtonElement;
const rankingSaveImageBtn = document.getElementById('ranking-save-image-btn') as HTMLButtonElement;
const rankingShareImageBtn = document.getElementById('ranking-share-image-btn') as HTMLButtonElement;

// ── Theme colors (read once from CSS custom properties) ──
const rootStyle = getComputedStyle(document.documentElement);
const cssVar = (name: string) => rootStyle.getPropertyValue(name).trim();
const COLOR_PRIMARY = cssVar('--color-primary') || '#ff6f91';
const COLOR_PRIMARY_HOVER = cssVar('--color-primary-hover') || '#ff567f';
const COLOR_SECONDARY = cssVar('--color-secondary') || '#5ecfbc';
const COLOR_ACCENT_STRONG = cssVar('--color-accent-strong') || '#f59f3a';

// ── State ─────────────────────────────────────
let phase: Phase = 'idle';
let dpr = Math.max(1, window.devicePixelRatio || 1);
let stageWidth = 0;
let stageHeight = 0;
let startedAt = 0;
let hasStarted = false;
let score = 0;
let hits = 0;
let misses = 0;
let circle: Circle | null = null;
let popups: ScorePopup[] = [];
let rafId: number | null = null;

// ── Init ──────────────────────────────────────
bestScoreEl.textContent = String(loadBestScore(GAME_SLUG));
canvas.dataset.phase = phase;
resizeCanvas();

setupRankingUI(
  {
    gameSlug: GAME_SLUG,
    gameTitle: '에임 트레이너',
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

const shareNav = navigator as Navigator & {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
};
const canShareImages = typeof shareNav.share === 'function' && typeof shareNav.canShare === 'function';
if (!canShareImages) shareImageBtn.classList.add('hidden');

// ── Canvas sizing ─────────────────────────────
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

  if (circle) {
    circle.x = Math.min(circle.x, Math.max(circle.radius, stageWidth - circle.radius));
    circle.y = Math.min(circle.y, Math.max(circle.radius, stageHeight - circle.radius));
  }
}

window.addEventListener('resize', resizeCanvas);

// ── Game logic ────────────────────────────────
function radiusForHits(hitCount: number): number {
  return Math.max(MIN_RADIUS, START_RADIUS - hitCount * RADIUS_STEP_PER_HIT);
}

function levelForHits(hitCount: number): number {
  return Math.min(MAX_LEVEL, hitCount + 1);
}

function spawnCircle() {
  const radius = radiusForHits(hits);
  const maxX = Math.max(radius, stageWidth - radius);
  const maxY = Math.max(radius, stageHeight - radius);
  const x = radius + Math.random() * Math.max(0, maxX - radius);
  const y = radius + Math.random() * Math.max(0, maxY - radius);
  circle = { x, y, radius, spawnedAt: performance.now() };
  canvas.dataset.circleX = String(x);
  canvas.dataset.circleY = String(y);
  canvas.dataset.circleR = String(radius);
}

function updateHudNumbers() {
  hudScore.textContent = String(score);
  hudHits.textContent = String(hits);
  hudLevel.textContent = String(levelForHits(hits));
}

function startGame() {
  phase = 'playing';
  canvas.dataset.phase = phase;
  score = 0;
  hits = 0;
  misses = 0;
  popups = [];
  hasStarted = false;
  startedAt = 0;

  startOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  hud.hidden = false;
  stage.classList.remove('flash-miss');

  resizeCanvas();
  spawnCircle();
  updateHudNumbers();
  hudTime.textContent = (GAME_DURATION_MS / 1000).toFixed(1);

  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}

function endGame() {
  phase = 'ended';
  canvas.dataset.phase = phase;
  circle = null;
  delete canvas.dataset.circleX;
  delete canvas.dataset.circleY;
  delete canvas.dataset.circleR;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  ctx.clearRect(0, 0, stageWidth, stageHeight);
  hud.hidden = true;

  const isRecord = saveBestScore(GAME_SLUG, score);
  bestScoreEl.textContent = String(loadBestScore(GAME_SLUG));

  const totalTaps = hits + misses;
  const accuracy = totalTaps === 0 ? 0 : Math.round((hits / totalTaps) * 100);

  resultScore.textContent = String(score);
  resultHits.textContent = `명중 ${hits}`;
  resultMisses.textContent = `미스 ${misses}`;
  resultAccuracy.textContent = `정확도 ${accuracy}%`;
  recordBadge.classList.toggle('hidden', !isRecord);
  resetRankingSubmission({ nameInput: rankNameInput, saveBtn: rankSaveBtn, savedMsg: rankSavedMsg });
  resultOverlay.classList.remove('hidden');
}

function handleTap(pos: { x: number; y: number }) {
  if (phase !== 'playing' || !circle) return;
  const now = performance.now();

  // 대기 중에는 원이 떠 있어도 시간이 흐르지 않다가, 플레이어가 처음으로 원을 노려
  // 탭한 이 순간부터(명중이든 미스든) 30초 카운트다운이 시작된다.
  if (!hasStarted) {
    hasStarted = true;
    startedAt = now;
  }

  const dist = Math.hypot(pos.x - circle.x, pos.y - circle.y);

  if (dist <= circle.radius) {
    const reactionMs = now - circle.spawnedAt;
    const bonus = Math.max(
      0,
      Math.min(SPEED_BONUS_MAX, Math.round(((SPEED_BONUS_WINDOW_MS - reactionMs) / SPEED_BONUS_WINDOW_MS) * SPEED_BONUS_MAX))
    );
    const gained = HIT_BASE_SCORE + bonus;
    score += gained;
    hits += 1;
    popups.push({ x: circle.x, y: circle.y, text: `+${gained}`, startedAt: now });
    updateHudNumbers();
    spawnCircle();
  } else {
    misses += 1;
    stage.classList.add('flash-miss');
    setTimeout(() => stage.classList.remove('flash-miss'), MISS_FLASH_DURATION_MS);
  }
}

// ── Render loop ───────────────────────────────
function drawCircle(now: number) {
  if (!circle) return;
  const pulse = 1 + Math.sin(now / 260) * 0.035;
  const r = circle.radius * pulse;

  const gradient = ctx.createRadialGradient(
    circle.x - r * 0.3, circle.y - r * 0.35, r * 0.1,
    circle.x, circle.y, r
  );
  gradient.addColorStop(0, COLOR_PRIMARY_HOVER);
  gradient.addColorStop(0.7, COLOR_PRIMARY);
  gradient.addColorStop(1, COLOR_ACCENT_STRONG);

  ctx.save();
  ctx.shadowColor = 'rgba(255, 111, 145, 0.45)';
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(circle.x, circle.y, r, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(circle.x, circle.y, r * 0.55, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawPopups(now: number) {
  popups = popups.filter((p) => now - p.startedAt < HIT_POPUP_DURATION_MS);
  for (const p of popups) {
    const t = (now - p.startedAt) / HIT_POPUP_DURATION_MS;
    const yOffset = -t * 42;
    const alpha = 1 - t;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '900 22px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = COLOR_SECONDARY;
    ctx.fillText(p.text, p.x, p.y + yOffset);
    ctx.restore();
  }
}

function loop(now: number) {
  if (phase !== 'playing') return;

  if (hasStarted) {
    const elapsed = now - startedAt;
    const remainingMs = Math.max(0, GAME_DURATION_MS - elapsed);
    hudTime.textContent = (remainingMs / 1000).toFixed(1);

    if (remainingMs <= 0) {
      endGame();
      return;
    }
  }

  ctx.clearRect(0, 0, stageWidth, stageHeight);
  drawCircle(now);
  drawPopups(now);

  rafId = requestAnimationFrame(loop);
}

// ── 결과 이미지 저장/공유 ───────────────────────
function buildResultImage(): HTMLCanvasElement {
  const width = 640;
  const height = 360;
  const totalTaps = hits + misses;
  const accuracy = totalTaps === 0 ? 0 : Math.round((hits / totalTaps) * 100);

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const c = out.getContext('2d')!;

  const bg = c.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, '#132338');
  bg.addColorStop(1, '#0b1622');
  c.fillStyle = bg;
  c.fillRect(0, 0, width, height);

  c.textAlign = 'center';
  c.fillStyle = '#f0f9ff';
  c.font = '900 32px Inter, sans-serif';
  c.fillText('에임 트레이너', width / 2, 64);

  c.font = '900 64px Inter, sans-serif';
  c.fillStyle = '#ffe08a';
  c.fillText(String(score), width / 2, 168);

  c.font = '700 18px Inter, sans-serif';
  c.fillStyle = 'rgba(232,244,255,0.85)';
  c.fillText(`명중 ${hits} · 미스 ${misses} · 정확도 ${accuracy}%`, width / 2, 206);

  c.font = '600 13px Inter, sans-serif';
  c.fillStyle = 'rgba(232,244,255,0.45)';
  const timestamp = new Date().toLocaleString('ko-KR');
  c.fillText(`Toris Arcade · 에임 트레이너 · ${timestamp}`, width / 2, height - 24);

  return out;
}

function resultImageBlob(): Promise<Blob | null> {
  return new Promise((resolve) => {
    buildResultImage().toBlob((blob) => resolve(blob), 'image/png');
  });
}

async function downloadResultImage() {
  const blob = await resultImageBlob();
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `에임트레이너결과-${stamp}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function shareResultImage() {
  const blob = await resultImageBlob();
  if (!blob) return;
  const file = new File([blob], 'aim-trainer-result.png', { type: 'image/png' });

  if (!shareNav.canShare?.({ files: [file] }) || !shareNav.share) return;
  try {
    await shareNav.share({ files: [file], title: '에임 트레이너 결과', text: `점수 ${score}점을 기록했어요!` });
  } catch (e) {
    if ((e as Error)?.name !== 'AbortError') console.error(e);
  }
}

// ── Events ────────────────────────────────────
// 캔버스가 스테이지 전체(inset: 0)를 덮고, 재생 중에는 오버레이가 전부 숨겨지므로
// 캔버스 하나에만 바인딩하면 스테이지 내 모든 탭을 받는다.
onTap(canvas, (pos) => handleTap(pos));

startBtn.addEventListener('click', startGame);
retryBtn.addEventListener('click', startGame);
saveImageBtn.addEventListener('click', downloadResultImage);
shareImageBtn.addEventListener('click', shareResultImage);
