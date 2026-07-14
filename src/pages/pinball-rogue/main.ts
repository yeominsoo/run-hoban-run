import './pinball-rogue.css';
import { loadBestScore, saveBestScore } from '../../shared/score-store';
import { setupRankingUI, resetRankingSubmission } from '../../shared/leaderboard';

const GAME_SLUG = 'pinball-rogue';

const GRAVITY = 1400;
const BALL_RADIUS = 8;
const WALL_RESTITUTION = 0.7;
const BUMPER_RESTITUTION = 0.65;
const BUMPER_KICK = 260;
const TRIANGLE_KICK = 200;
const FLIPPER_KICK_REST = 160;
const FLIPPER_KICK_ACTIVE = 620;
const FLIPPER_THICKNESS = 8;
const FLIPPER_LENGTH_RATIO = 0.22;
const FLIPPER_SWING_RATE = 9;
const MAX_SPEED = 900;
const STARTING_LIVES = 3;
const BASE_ROUND_TARGET = 300;
const ROUND_TARGET_STEP = 220;
const CIRCLE_BUMPER_SCORE = 10;
const TRIANGLE_BUMPER_SCORE = 15;
const MAGNET_RADIUS_BASE = 60;
const MAGNET_FORCE_PER_LEVEL = 240;
const PIERCE_SCORE_COOLDOWN_MS = 260;
const HIT_FLASH_DURATION_MS = 220;
const MAX_DT = 0.032;

type Phase = 'ready' | 'playing' | 'round-clear' | 'ended';
type FlipperSide = 'left' | 'right';
type UpgradeId = 'multiball' | 'bumperScore' | 'flipperLength' | 'magnet' | 'piercing';

interface Point {
  x: number;
  y: number;
}

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface CircleBumperLayout {
  x: number;
  y: number;
  radius: number;
}

interface TriangleBumperLayout {
  points: [Point, Point, Point];
}

interface Layout {
  leftWallX: number;
  rightWallX: number;
  topWallY: number;
  flipperY: number;
  leftPivot: Point;
  rightPivot: Point;
  baseFlipperLength: number;
  circleBumpers: CircleBumperLayout[];
  triangleBumpers: TriangleBumperLayout[];
}

interface RuntimeFlipper {
  side: FlipperSide;
  pivot: Point;
  t: number; // 0 = 정지, 1 = 완전히 들림
  active: boolean;
}

interface UpgradeDef {
  id: UpgradeId;
  name: string;
  desc: string;
}

const UPGRADE_POOL: UpgradeDef[] = [
  { id: 'multiball', name: '멀티볼', desc: '공이 1개 추가로 동시에 굴러갑니다' },
  { id: 'bumperScore', name: '범퍼 강화', desc: '모든 범퍼 점수가 2배가 됩니다' },
  { id: 'flipperLength', name: '플리퍼 연장', desc: '플리퍼 길이가 20% 길어집니다' },
  { id: 'magnet', name: '자석 효과', desc: '공이 범퍼 쪽으로 살짝 끌려갑니다' },
  { id: 'piercing', name: '관통 볼', desc: '원형 범퍼를 통과하며 계속 점수를 얻습니다' }
];

interface Upgrades {
  multiballLevel: number;
  bumperMultiplier: number;
  flipperLengthMultiplier: number;
  magnetLevel: number;
  piercing: boolean;
}

function defaultUpgrades(): Upgrades {
  return { multiballLevel: 0, bumperMultiplier: 1, flipperLengthMultiplier: 1, magnetLevel: 0, piercing: false };
}

function roundTarget(round: number): number {
  return BASE_ROUND_TARGET + (round - 1) * ROUND_TARGET_STEP;
}

function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  return { x: a.x + abx * t, y: a.y + aby * t };
}

// ── DOM ───────────────────────────────
const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="pinball-shell">
    <header class="game-header">
      <a class="back-link" href="/">← 게임 선택</a>
      <h1 class="game-title">핀볼 로그라이크</h1>
      <div class="best-score">최고 <strong id="best-score">0</strong></div>
    </header>

    <div class="game-stage" id="game-stage">
      <canvas id="pb-canvas"></canvas>

      <div class="hud" id="hud" hidden>
        <div class="hud-item"><span class="hud-label">점수</span><span class="hud-value" id="hud-score">0</span></div>
        <div class="hud-item"><span class="hud-label">라운드</span><span class="hud-value" id="hud-round">1</span></div>
        <div class="hud-item"><span class="hud-label">목표</span><span class="hud-value" id="hud-target">300</span></div>
        <div class="hud-item"><span class="hud-label">공</span><span class="hud-value" id="hud-lives">●●●</span></div>
      </div>

      <div class="overlay" id="start-overlay">
        <div class="overlay-card">
          <h2>핀볼 로그라이크</h2>
          <p>화면 왼쪽/오른쪽을 눌러 플리퍼를 조작하세요(키보드 ←/→ 또는 Z/X도 가능).<br>
          라운드 목표 점수를 넘기면 업그레이드를 하나 고를 수 있어요. 공을 3번 놓치면 게임이 끝납니다.</p>
          <button id="start-btn" class="primary-btn" type="button">시작하기</button>
          <button id="view-ranking-btn" class="ghost-btn" type="button">랭킹보기</button>
        </div>
      </div>

      <div class="overlay hidden" id="upgrade-overlay">
        <div class="overlay-card">
          <h2>라운드 클리어!</h2>
          <p>업그레이드를 하나 선택하세요</p>
          <div class="upgrade-choice-list" id="upgrade-choice-list"></div>
        </div>
      </div>

      <div class="overlay hidden" id="result-overlay">
        <div class="overlay-card">
          <h2>게임 종료!</h2>
          <div class="result-score" id="result-score">0</div>
          <div class="result-stats"><span id="result-round">라운드 1</span></div>
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

// ── Refs ──────────────────────────────
const stage = document.getElementById('game-stage')!;
const canvas = document.getElementById('pb-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hud = document.getElementById('hud')!;
const hudScore = document.getElementById('hud-score')!;
const hudRound = document.getElementById('hud-round')!;
const hudTarget = document.getElementById('hud-target')!;
const hudLives = document.getElementById('hud-lives')!;
const bestScoreEl = document.getElementById('best-score')!;
const startOverlay = document.getElementById('start-overlay')!;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const upgradeOverlay = document.getElementById('upgrade-overlay')!;
const upgradeChoiceList = document.getElementById('upgrade-choice-list')!;
const resultOverlay = document.getElementById('result-overlay')!;
const resultScore = document.getElementById('result-score')!;
const resultRound = document.getElementById('result-round')!;
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

const rootStyle = getComputedStyle(document.documentElement);
const cssVar = (name: string) => rootStyle.getPropertyValue(name).trim();
const COLOR_PRIMARY = cssVar('--color-primary') || '#ff6f91';
const COLOR_SECONDARY = cssVar('--color-secondary') || '#5ecfbc';
const COLOR_ACCENT = cssVar('--color-accent') || '#ffc857';
const COLOR_ACCENT_STRONG = cssVar('--color-accent-strong') || '#f59f3a';
const COLOR_LILAC = cssVar('--color-lilac') || '#9b87f5';
const COLOR_TEXT = cssVar('--color-page-text') || '#4b3447';

// ── State ─────────────────────────────
let phase: Phase = 'ready';
let dpr = Math.max(1, window.devicePixelRatio || 1);
let stageWidth = 0;
let stageHeight = 0;
let layout: Layout = computeLayout(360, 600);
let balls: Ball[] = [];
let flippers: RuntimeFlipper[] = [];
let score = 0;
let round = 1;
let lives = STARTING_LIVES;
let upgrades = defaultUpgrades();
let bumperHitFlash = new Map<CircleBumperLayout, number>();
let triangleHitFlash = new Map<TriangleBumperLayout, number>();
let piercedAt = new Map<CircleBumperLayout, number>();
let lastTime = 0;
let rafId: number | null = null;

function computeLayout(W: number, H: number): Layout {
  const leftWallX = W * 0.1;
  const rightWallX = W * 0.9;
  const topWallY = H * 0.06;
  const flipperY = H * 0.84;
  const leftPivot = { x: W * 0.32, y: flipperY };
  const rightPivot = { x: W * 0.68, y: flipperY };
  const baseFlipperLength = W * FLIPPER_LENGTH_RATIO;
  const unit = Math.min(W, H);

  const circleBumpers: CircleBumperLayout[] = [
    { x: W * 0.3, y: H * 0.24, radius: unit * 0.045 },
    { x: W * 0.7, y: H * 0.24, radius: unit * 0.045 },
    { x: W * 0.5, y: H * 0.36, radius: unit * 0.05 },
    { x: W * 0.5, y: H * 0.16, radius: unit * 0.038 }
  ];

  const triangleBumpers: TriangleBumperLayout[] = [
    {
      points: [
        { x: W * 0.16, y: H * 0.72 },
        { x: W * 0.32, y: H * 0.66 },
        { x: W * 0.24, y: H * 0.8 }
      ]
    },
    {
      points: [
        { x: W * 0.84, y: H * 0.72 },
        { x: W * 0.68, y: H * 0.66 },
        { x: W * 0.76, y: H * 0.8 }
      ]
    }
  ];

  return { leftWallX, rightWallX, topWallY, flipperY, leftPivot, rightPivot, baseFlipperLength, circleBumpers, triangleBumpers };
}

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
  layout = computeLayout(stageWidth, stageHeight);
  flippers = [
    { side: 'left', pivot: layout.leftPivot, t: 0, active: activeSides.has('left') },
    { side: 'right', pivot: layout.rightPivot, t: 0, active: activeSides.has('right') }
  ];
  for (const ball of balls) {
    ball.x = Math.min(Math.max(ball.x, layout.leftWallX + BALL_RADIUS), layout.rightWallX - BALL_RADIUS);
  }
}

window.addEventListener('resize', resizeCanvas);

// ── 입력 ──────────────────────────────
const activeSides = new Set<FlipperSide>();
const pointerSides = new Map<number, FlipperSide>();

function setFlipperActive(side: FlipperSide, active: boolean) {
  if (active) activeSides.add(side);
  else activeSides.delete(side);
  const fl = flippers.find((f) => f.side === side);
  if (fl) fl.active = active;
}

canvas.addEventListener('pointerdown', (e) => {
  if (phase !== 'playing') return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const side: FlipperSide = x < stageWidth / 2 ? 'left' : 'right';
  pointerSides.set(e.pointerId, side);
  setFlipperActive(side, true);
  canvas.setPointerCapture(e.pointerId);
});

function releasePointer(e: PointerEvent) {
  const side = pointerSides.get(e.pointerId);
  if (!side) return;
  pointerSides.delete(e.pointerId);
  const stillHeld = [...pointerSides.values()].includes(side);
  if (!stillHeld) setFlipperActive(side, false);
}
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);

function keyToSide(key: string): FlipperSide | null {
  const k = key.toLowerCase();
  if (key === 'ArrowLeft' || k === 'z') return 'left';
  if (key === 'ArrowRight' || k === 'x') return 'right';
  return null;
}

window.addEventListener('keydown', (e) => {
  if (phase !== 'playing') return;
  const side = keyToSide(e.key);
  if (side) setFlipperActive(side, true);
});
window.addEventListener('keyup', (e) => {
  const side = keyToSide(e.key);
  if (side) setFlipperActive(side, false);
});

// ── 게임 로직 ──────────────────────────
function ballTargetCount(): number {
  return 1 + upgrades.multiballLevel;
}

function spawnBalls(count: number): Ball[] {
  const out: Ball[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      x: stageWidth * 0.5 + (Math.random() - 0.5) * stageWidth * 0.1,
      y: stageHeight * 0.12 + i * 18,
      vx: (Math.random() - 0.5) * 60,
      vy: 0
    });
  }
  return out;
}

function addScore(base: number) {
  score += Math.round(base * upgrades.bumperMultiplier);
}

function currentFlipperLength(): number {
  return layout.baseFlipperLength * upgrades.flipperLengthMultiplier;
}

function flipperTip(fl: RuntimeFlipper): Point {
  const length = currentFlipperLength();
  const sign = fl.side === 'left' ? 1 : -1;
  // 정지: 바깥쪽 아래(드레인 반대쪽 벽 방향)를 향함. 활성: 안쪽 위(중앙)로 스윙.
  const restAngle = Math.atan2(0.55, -sign);
  // 안쪽 성분(x)을 더 키워, 양쪽을 동시에 들었을 때 팁이 중앙 근처에서 거의 맞닿게 한다
  // (그래야 "양쪽 다 든" 상태가 실제로 드레인을 막아준다).
  const activeAngle = Math.atan2(-0.7, sign);
  const angle = restAngle + (activeAngle - restAngle) * fl.t;
  return { x: fl.pivot.x + Math.cos(angle) * length, y: fl.pivot.y + Math.sin(angle) * length };
}

function stepBall(ball: Ball, dt: number) {
  ball.vy += GRAVITY * dt;

  if (upgrades.magnetLevel > 0) {
    for (const bump of layout.circleBumpers) {
      const dx = bump.x - ball.x;
      const dy = bump.y - ball.y;
      const dist = Math.hypot(dx, dy);
      const pullRadius = MAGNET_RADIUS_BASE + upgrades.magnetLevel * 18;
      if (dist > 1 && dist < pullRadius) {
        const force = MAGNET_FORCE_PER_LEVEL * upgrades.magnetLevel * (1 - dist / pullRadius);
        ball.vx += (dx / dist) * force * dt;
        ball.vy += (dy / dist) * force * dt;
      }
    }
  }

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed > MAX_SPEED) {
    ball.vx = (ball.vx / speed) * MAX_SPEED;
    ball.vy = (ball.vy / speed) * MAX_SPEED;
  }

  if (ball.y < layout.flipperY) {
    if (ball.x - BALL_RADIUS < layout.leftWallX) {
      ball.x = layout.leftWallX + BALL_RADIUS;
      ball.vx = Math.abs(ball.vx) * WALL_RESTITUTION;
    }
    if (ball.x + BALL_RADIUS > layout.rightWallX) {
      ball.x = layout.rightWallX - BALL_RADIUS;
      ball.vx = -Math.abs(ball.vx) * WALL_RESTITUTION;
    }
  }
  if (ball.y - BALL_RADIUS < layout.topWallY) {
    ball.y = layout.topWallY + BALL_RADIUS;
    ball.vy = Math.abs(ball.vy) * WALL_RESTITUTION;
  }

  const now = performance.now();

  for (const bump of layout.circleBumpers) {
    const dx = ball.x - bump.x;
    const dy = ball.y - bump.y;
    const dist = Math.hypot(dx, dy);
    const minDist = BALL_RADIUS + bump.radius;
    if (dist >= minDist || dist <= 0) continue;

    if (upgrades.piercing) {
      const last = piercedAt.get(bump) ?? 0;
      if (now - last > PIERCE_SCORE_COOLDOWN_MS) {
        addScore(CIRCLE_BUMPER_SCORE);
        piercedAt.set(bump, now);
        bumperHitFlash.set(bump, now);
      }
      continue;
    }

    const nx = dx / dist;
    const ny = dy / dist;
    ball.x = bump.x + nx * minDist;
    ball.y = bump.y + ny * minDist;
    const vDotN = ball.vx * nx + ball.vy * ny;
    ball.vx = (ball.vx - 2 * vDotN * nx) * BUMPER_RESTITUTION + nx * BUMPER_KICK;
    ball.vy = (ball.vy - 2 * vDotN * ny) * BUMPER_RESTITUTION + ny * BUMPER_KICK;
    addScore(CIRCLE_BUMPER_SCORE);
    bumperHitFlash.set(bump, now);
  }

  for (const tri of layout.triangleBumpers) {
    const [p0, p1, p2] = tri.points;
    const edges: [Point, Point][] = [
      [p0, p1],
      [p1, p2],
      [p2, p0]
    ];
    for (const [a, b] of edges) {
      const cp = closestPointOnSegment(ball, a, b);
      const dx = ball.x - cp.x;
      const dy = ball.y - cp.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= BALL_RADIUS || dist <= 0) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      ball.x = cp.x + nx * BALL_RADIUS;
      ball.y = cp.y + ny * BALL_RADIUS;
      const vDotN = ball.vx * nx + ball.vy * ny;
      ball.vx = (ball.vx - 2 * vDotN * nx) * BUMPER_RESTITUTION + nx * TRIANGLE_KICK;
      ball.vy = (ball.vy - 2 * vDotN * ny) * BUMPER_RESTITUTION + ny * TRIANGLE_KICK;
      addScore(TRIANGLE_BUMPER_SCORE);
      triangleHitFlash.set(tri, now);
      break;
    }
  }

  for (const fl of flippers) {
    const tip = flipperTip(fl);
    const cp = closestPointOnSegment(ball, fl.pivot, tip);
    const dx = ball.x - cp.x;
    const dy = ball.y - cp.y;
    const dist = Math.hypot(dx, dy);
    const minDist = BALL_RADIUS + FLIPPER_THICKNESS / 2;
    if (dist >= minDist || dist <= 0) continue;
    const nx = dx / dist;
    const ny = dy / dist;
    ball.x = cp.x + nx * minDist;
    ball.y = cp.y + ny * minDist;
    const vDotN = ball.vx * nx + ball.vy * ny;
    const kick = FLIPPER_KICK_REST + (FLIPPER_KICK_ACTIVE - FLIPPER_KICK_REST) * fl.t;
    ball.vx = ball.vx - 2 * vDotN * nx + nx * kick;
    ball.vy = ball.vy - 2 * vDotN * ny + ny * kick;
  }
}

function updateFlippers(dt: number) {
  for (const fl of flippers) {
    const target = fl.active ? 1 : 0;
    fl.t += (target - fl.t) * Math.min(1, FLIPPER_SWING_RATE * dt);
    if (Math.abs(target - fl.t) < 0.01) fl.t = target;
  }
}

function offerUpgrades(): UpgradeDef[] {
  const pool = UPGRADE_POOL.filter((u) => !(u.id === 'piercing' && upgrades.piercing));
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

function applyUpgrade(id: UpgradeId) {
  switch (id) {
    case 'multiball':
      upgrades.multiballLevel += 1;
      break;
    case 'bumperScore':
      upgrades.bumperMultiplier *= 2;
      break;
    case 'flipperLength':
      upgrades.flipperLengthMultiplier = Math.min(2, upgrades.flipperLengthMultiplier + 0.2);
      break;
    case 'magnet':
      upgrades.magnetLevel += 1;
      break;
    case 'piercing':
      upgrades.piercing = true;
      break;
  }
}

function startRoundClear() {
  phase = 'round-clear';
  upgradeChoiceList.innerHTML = '';
  for (const def of offerUpgrades()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'upgrade-choice-btn';
    btn.dataset.upgradeId = def.id;
    btn.innerHTML = `<span class="upgrade-choice-name">${def.name}</span><span class="upgrade-choice-desc">${def.desc}</span>`;
    btn.addEventListener('click', () => {
      applyUpgrade(def.id);
      round += 1;
      upgradeOverlay.classList.add('hidden');
      phase = 'playing';
    });
    upgradeChoiceList.appendChild(btn);
  }
  upgradeOverlay.classList.remove('hidden');
}

function startGame() {
  phase = 'playing';
  score = 0;
  round = 1;
  lives = STARTING_LIVES;
  upgrades = defaultUpgrades();
  bumperHitFlash = new Map();
  triangleHitFlash = new Map();
  piercedAt = new Map();
  resizeCanvas();
  balls = spawnBalls(ballTargetCount());

  startOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  upgradeOverlay.classList.add('hidden');
  hud.hidden = false;
  updateHud();

  lastTime = performance.now();
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}

function endGame() {
  phase = 'ended';
  hud.hidden = true;

  const isRecord = saveBestScore(GAME_SLUG, score);
  bestScoreEl.textContent = String(loadBestScore(GAME_SLUG));

  resultScore.textContent = String(score);
  resultRound.textContent = `라운드 ${round}`;
  recordBadge.classList.toggle('hidden', !isRecord);
  resetRankingSubmission({ nameInput: rankNameInput, saveBtn: rankSaveBtn, savedMsg: rankSavedMsg });
  resultOverlay.classList.remove('hidden');
}

function updateHud() {
  hudScore.textContent = String(score);
  hudRound.textContent = String(round);
  hudTarget.textContent = String(roundTarget(round));
  hudLives.textContent = '●'.repeat(Math.max(0, lives)) + '○'.repeat(Math.max(0, STARTING_LIVES - lives));
}

// ── 렌더 ──────────────────────────────
function drawBoard() {
  ctx.clearRect(0, 0, stageWidth, stageHeight);

  ctx.strokeStyle = 'rgba(75,52,71,0.28)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(layout.leftWallX, layout.flipperY);
  ctx.lineTo(layout.leftWallX, layout.topWallY);
  ctx.lineTo(layout.rightWallX, layout.topWallY);
  ctx.lineTo(layout.rightWallX, layout.flipperY);
  ctx.stroke();

  const now = performance.now();

  for (const bump of layout.circleBumpers) {
    const hitAt = bumperHitFlash.get(bump) ?? 0;
    const flashT = Math.max(0, 1 - (now - hitAt) / HIT_FLASH_DURATION_MS);
    ctx.beginPath();
    ctx.arc(bump.x, bump.y, bump.radius, 0, Math.PI * 2);
    ctx.fillStyle = flashT > 0 ? COLOR_ACCENT : COLOR_PRIMARY;
    ctx.fill();
    if (flashT > 0) {
      ctx.beginPath();
      ctx.arc(bump.x, bump.y, bump.radius + flashT * 6, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,200,87,${flashT})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  for (const tri of layout.triangleBumpers) {
    const hitAt = triangleHitFlash.get(tri) ?? 0;
    const flashT = Math.max(0, 1 - (now - hitAt) / HIT_FLASH_DURATION_MS);
    const [p0, p1, p2] = tri.points;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.closePath();
    ctx.fillStyle = flashT > 0 ? COLOR_ACCENT : COLOR_LILAC;
    ctx.fill();
  }

  for (const fl of flippers) {
    const tip = flipperTip(fl);
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineWidth = FLIPPER_THICKNESS;
    ctx.strokeStyle = COLOR_SECONDARY;
    ctx.moveTo(fl.pivot.x, fl.pivot.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
  }

  for (const ball of balls) {
    const gradient = ctx.createRadialGradient(
      ball.x - BALL_RADIUS * 0.3,
      ball.y - BALL_RADIUS * 0.35,
      BALL_RADIUS * 0.1,
      ball.x,
      ball.y,
      BALL_RADIUS
    );
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, COLOR_ACCENT_STRONG);
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  ctx.fillStyle = COLOR_TEXT;
  ctx.globalAlpha = 0.35;
  ctx.font = '700 11px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('DRAIN', stageWidth / 2, layout.flipperY + 22);
  ctx.globalAlpha = 1;
}

function updateTestAttrs() {
  canvas.dataset.phase = phase;
  canvas.dataset.score = String(score);
  canvas.dataset.round = String(round);
  canvas.dataset.target = String(roundTarget(round));
  canvas.dataset.lives = String(lives);
  canvas.dataset.ballsCount = String(balls.length);
  if (balls[0]) {
    canvas.dataset.ballX = String(balls[0].x);
    canvas.dataset.ballY = String(balls[0].y);
  } else {
    delete canvas.dataset.ballX;
    delete canvas.dataset.ballY;
  }
}

function loop(now: number) {
  const dt = Math.min(MAX_DT, (now - lastTime) / 1000);
  lastTime = now;

  if (phase === 'playing') {
    updateFlippers(dt);
    for (const ball of balls) stepBall(ball, dt);
    const before = balls.length;
    balls = balls.filter((b) => b.y - BALL_RADIUS <= stageHeight);
    if (balls.length === 0 && before > 0) {
      lives -= 1;
      updateHud();
      if (lives <= 0) {
        endGame();
        updateTestAttrs();
        return;
      }
      balls = spawnBalls(ballTargetCount());
    }
    if (score >= roundTarget(round)) {
      startRoundClear();
    }
    updateHud();
  } else if (phase === 'round-clear') {
    updateFlippers(dt);
  }

  drawBoard();
  updateTestAttrs();
  rafId = requestAnimationFrame(loop);
}

// ── 이벤트 ────────────────────────────
startBtn.addEventListener('click', startGame);
retryBtn.addEventListener('click', startGame);

setupRankingUI(
  {
    gameSlug: GAME_SLUG,
    gameTitle: '핀볼 로그라이크',
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

// ── 초기화 ────────────────────────────
bestScoreEl.textContent = String(loadBestScore(GAME_SLUG));
resizeCanvas();
canvas.dataset.phase = phase;
drawBoard();
