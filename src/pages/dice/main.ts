import './dice.css';
import { rollValues, randomSeed } from '../../shared/seed';
import { loadParticipants, saveParticipants } from '../../shared/participants';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 20;
const MAX_PER_PLAYER = 10;
const ROLL_SPIN_MS = 900;
const ROLL_STAGGER_MS = 90;
const SPIN_TICK_MS = 55;

type Phase = 'idle' | 'rolling' | 'done';

let phase: Phase = 'idle';
let currentSeed = randomSeed();
let intervalTimers: ReturnType<typeof setInterval>[] = [];
let timeoutTimers: ReturnType<typeof setTimeout>[] = [];

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="dice-shell">
    <aside class="sidebar">
      <a class="back-link" href="/">← 게임 선택</a>
      <h1 class="sidebar-title">주사위 돌리기</h1>
      <p class="sidebar-desc">2~20명이 각자 주사위를 굴려요. 주사위 눈은 1부터 참가자 수 × 10까지 나옵니다.</p>

      <label class="field-label" for="participants">참가자 (2~20명)</label>
      <textarea
        id="participants"
        class="participants-area"
        rows="10"
        spellcheck="false"
        placeholder="이름을 한 줄에 하나씩 입력하세요"
      ></textarea>
      <div class="count-hint" id="count-hint"></div>

      <div class="dice-actions">
        <button id="roll-btn" type="button" class="sidebar-action primary">굴리기</button>
        <button id="reroll-btn" type="button" class="sidebar-action secondary hidden">다시 굴리기</button>
        <button id="save-image-btn" type="button" class="sidebar-action secondary hidden">결과 이미지 저장</button>
        <button id="reset-btn" type="button" class="sidebar-action secondary hidden">새로 입력</button>
      </div>
    </aside>

    <main class="main-area">
      <div class="result-bar hidden" id="result-bar"></div>
      <div class="dice-grid" id="dice-grid">
        <p class="empty-hint" id="empty-hint">참가자를 입력하고 굴리기를 눌러보세요</p>
      </div>
    </main>
  </div>
`;

// ── Refs ──────────────────────────────────────
const participantInput = document.getElementById('participants') as HTMLTextAreaElement;
const countHint = document.getElementById('count-hint')!;
const rollBtn = document.getElementById('roll-btn') as HTMLButtonElement;
const rerollBtn = document.getElementById('reroll-btn') as HTMLButtonElement;
const saveImageBtn = document.getElementById('save-image-btn') as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
const resultBar = document.getElementById('result-bar')!;
const diceGrid = document.getElementById('dice-grid')!;

let lastResult: { participants: string[]; finals: number[]; max: number } | null = null;

// ── Init ──────────────────────────────────────
participantInput.value = loadParticipants() ?? '';
updateHint();

// ── Helpers ───────────────────────────────────
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getParticipants(): string[] {
  const seen = new Map<string, number>();
  return participantInput.value
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, MAX_PLAYERS)
    .map((name) => {
      const count = seen.get(name) ?? 0;
      seen.set(name, count + 1);
      return count === 0 ? name : `${name} ${count + 1}`;
    });
}

function maxFor(count: number): number {
  return count * MAX_PER_PLAYER;
}

function updateHint() {
  const n = getParticipants().length;
  const valid = n >= MIN_PLAYERS && n <= MAX_PLAYERS;
  if (n === 0) {
    countHint.textContent = `참가자를 입력하세요 (${MIN_PLAYERS}~${MAX_PLAYERS}명)`;
  } else {
    countHint.textContent = `${n}명 · 주사위 1~${maxFor(n)}`;
  }
  countHint.classList.toggle('invalid', n > 0 && !valid);
  rollBtn.disabled = !valid || phase === 'rolling';
}

function clearTimers() {
  intervalTimers.forEach(clearInterval);
  intervalTimers = [];
  timeoutTimers.forEach(clearTimeout);
  timeoutTimers = [];
}

function diceCardHtml(name: string, i: number): string {
  return `
    <div class="dice-card" data-card="${i}">
      <div class="dice-face" data-face="${i}">–</div>
      <div class="dice-name">${escapeHtml(name)}</div>
      <div class="dice-rank" data-rank="${i}"></div>
    </div>
  `;
}

// ── Roll flow ─────────────────────────────────
function startRoll(participants: string[]) {
  clearTimers();
  phase = 'rolling';
  participantInput.disabled = true;
  rerollBtn.classList.add('hidden');
  saveImageBtn.classList.add('hidden');
  resetBtn.classList.add('hidden');
  resultBar.classList.add('hidden');
  updateHint();

  const max = maxFor(participants.length);
  const finals = rollValues(participants.length, max, currentSeed);

  diceGrid.innerHTML = participants.map((name, i) => diceCardHtml(name, i)).join('');

  participants.forEach((_, i) => {
    const card = diceGrid.querySelector(`[data-card="${i}"]`) as HTMLElement;
    const face = diceGrid.querySelector(`[data-face="${i}"]`) as HTMLElement;
    const startDelay = i * ROLL_STAGGER_MS;

    const startTimer = setTimeout(() => {
      card.classList.add('rolling');
      const tick = setInterval(() => {
        face.textContent = String(1 + Math.floor(Math.random() * max));
      }, SPIN_TICK_MS);
      intervalTimers.push(tick);

      const settleTimer = setTimeout(() => {
        clearInterval(tick);
        face.textContent = String(finals[i]);
        card.classList.remove('rolling');
        card.classList.add('settled');
      }, ROLL_SPIN_MS);
      timeoutTimers.push(settleTimer);
    }, startDelay);
    timeoutTimers.push(startTimer);
  });

  const totalTime = (participants.length - 1) * ROLL_STAGGER_MS + ROLL_SPIN_MS + 120;
  const finishTimer = setTimeout(() => finishRoll(participants, finals), totalTime);
  timeoutTimers.push(finishTimer);
}

function finishRoll(participants: string[], finals: number[]) {
  phase = 'done';
  participantInput.disabled = false;
  rerollBtn.classList.remove('hidden');
  saveImageBtn.classList.remove('hidden');
  resetBtn.classList.remove('hidden');
  updateHint();
  lastResult = { participants, finals, max: maxFor(participants.length) };

  const sortedUnique = [...new Set(finals)].sort((a, b) => b - a);
  const rankOf = (v: number) => sortedUnique.indexOf(v) + 1;

  participants.forEach((_, i) => {
    const card = diceGrid.querySelector(`[data-card="${i}"]`) as HTMLElement;
    const rankLabel = diceGrid.querySelector(`[data-rank="${i}"]`) as HTMLElement;
    const rank = rankOf(finals[i]);
    rankLabel.textContent = `${rank}위 · ${finals[i]}`;
    card.classList.toggle('rank-1', rank === 1);
  });

  const winners = participants.filter((_, i) => rankOf(finals[i]) === 1);
  const winnerScore = finals[participants.findIndex((_, i) => rankOf(finals[i]) === 1)];
  resultBar.textContent = `🎲 1위: ${winners.join(', ')} (${winnerScore})`;
  resultBar.classList.remove('hidden');
}

// ── Result image ──────────────────────────────
function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function buildResultImage(result: { participants: string[]; finals: number[]; max: number }): HTMLCanvasElement {
  const { participants, finals, max } = result;
  const sortedUnique = [...new Set(finals)].sort((a, b) => b - a);
  const rankOf = (v: number) => sortedUnique.indexOf(v) + 1;
  const order = participants
    .map((name, i) => ({ name, value: finals[i], rank: rankOf(finals[i]) }))
    .sort((a, b) => a.rank - b.rank);

  const width = 680;
  const rowHeight = 60;
  const headerHeight = 150;
  const footerHeight = 56;
  const height = headerHeight + order.length * rowHeight + footerHeight;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, '#132338');
  bg.addColorStop(1, '#0b1622');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f0f9ff';
  ctx.font = '900 34px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('주사위 돌리기 결과', width / 2, 56);

  ctx.font = '700 15px Inter, sans-serif';
  ctx.fillStyle = 'rgba(232,244,255,0.6)';
  ctx.fillText(`${participants.length}명 · 주사위 1~${max}`, width / 2, 84);

  const winner = order[0];
  ctx.font = '800 18px Inter, sans-serif';
  ctx.fillStyle = '#ffe08a';
  ctx.fillText(`1위 · ${winner.name} (${winner.value})`, width / 2, 118);

  const listTop = headerHeight;
  const rowX = 32;
  const rowW = width - 64;

  order.forEach((entry, i) => {
    const y = listTop + i * rowHeight;
    const isFirst = entry.rank === 1;

    ctx.fillStyle = isFirst ? 'rgba(255,214,102,0.14)' : i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.015)';
    drawRoundedRect(ctx, rowX, y + 6, rowW, rowHeight - 12, 12);
    ctx.fill();
    if (isFirst) {
      ctx.strokeStyle = 'rgba(255,214,102,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.textAlign = 'left';
    ctx.font = '800 20px Inter, sans-serif';
    ctx.fillStyle = isFirst ? '#ffe08a' : 'rgba(126,200,248,0.9)';
    ctx.fillText(`${entry.rank}위`, rowX + 18, y + rowHeight / 2 + 7);

    ctx.font = '700 19px Inter, sans-serif';
    ctx.fillStyle = isFirst ? '#fff4d6' : '#eaf6ff';
    ctx.fillText(entry.name, rowX + 90, y + rowHeight / 2 + 7);

    ctx.textAlign = 'right';
    ctx.font = '900 22px Inter, sans-serif';
    ctx.fillStyle = isFirst ? '#ffe08a' : '#eaf6ff';
    ctx.fillText(String(entry.value), rowX + rowW - 20, y + rowHeight / 2 + 7);
  });

  ctx.textAlign = 'center';
  ctx.font = '600 12px Inter, sans-serif';
  ctx.fillStyle = 'rgba(232,244,255,0.4)';
  const timestamp = new Date().toLocaleString('ko-KR');
  ctx.fillText(`Toris Arcade · 주사위 돌리기 · ${timestamp}`, width / 2, height - 22);

  return canvas;
}

function downloadResultImage() {
  if (!lastResult) return;
  const canvas = buildResultImage(lastResult);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `주사위결과-${stamp}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

// ── Events ────────────────────────────────────
participantInput.addEventListener('input', () => {
  updateHint();
  saveParticipants(participantInput.value);
});

rollBtn.addEventListener('click', () => {
  const participants = getParticipants();
  if (participants.length < MIN_PLAYERS) {
    alert(`참가자를 ${MIN_PLAYERS}명 이상 입력해주세요.`);
    return;
  }
  if (participants.length > MAX_PLAYERS) {
    alert(`참가자는 최대 ${MAX_PLAYERS}명까지 가능합니다.`);
    return;
  }
  currentSeed = randomSeed();
  startRoll(participants);
});

rerollBtn.addEventListener('click', () => {
  const participants = getParticipants();
  if (participants.length < MIN_PLAYERS) return;
  currentSeed = randomSeed();
  startRoll(participants);
});

saveImageBtn.addEventListener('click', downloadResultImage);

resetBtn.addEventListener('click', () => {
  clearTimers();
  phase = 'idle';
  lastResult = null;
  participantInput.disabled = false;
  rerollBtn.classList.add('hidden');
  saveImageBtn.classList.add('hidden');
  resetBtn.classList.add('hidden');
  resultBar.classList.add('hidden');
  diceGrid.innerHTML = '<p class="empty-hint" id="empty-hint">참가자를 입력하고 굴리기를 눌러보세요</p>';
  updateHint();
});
