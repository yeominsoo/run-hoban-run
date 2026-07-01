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
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
const resultBar = document.getElementById('result-bar')!;
const diceGrid = document.getElementById('dice-grid')!;

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
  resetBtn.classList.remove('hidden');
  updateHint();

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

resetBtn.addEventListener('click', () => {
  clearTimers();
  phase = 'idle';
  participantInput.disabled = false;
  rerollBtn.classList.add('hidden');
  resetBtn.classList.add('hidden');
  resultBar.classList.add('hidden');
  diceGrid.innerHTML = '<p class="empty-hint" id="empty-hint">참가자를 입력하고 굴리기를 눌러보세요</p>';
  updateHint();
});
