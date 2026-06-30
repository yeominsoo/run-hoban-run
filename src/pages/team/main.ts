import './team.css';
import { normalizeParticipants } from '../../game/rules';
import { seededShuffle, randomSeed } from '../../shared/seed';
import { loadParticipants, saveParticipants } from '../../shared/participants';

// ── Types ─────────────────────────────────────
interface Member { name: string; ghost: boolean; }
type Mode    = 'count' | 'size';
type Phase   = 'idle' | 'shuffle' | 'dealing' | 'final' | 'done';

// ── Constants ─────────────────────────────────
const GROUP_LETTERS    = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
const DEAL_INTERVAL_MS = 160;
const DEAL_ANIM_MS     = 220;
const SHUFFLE_MS       = 1800;

// ── State ─────────────────────────────────────
let currentSeed = randomSeed();
let mode: Mode  = 'size';
let phase: Phase = 'idle';
let groups: Member[][] = [];
let animTimer: ReturnType<typeof setTimeout> | null = null;
let dealCards: { gi: number; mi: number }[] = [];
let dealIdx = 0;

// ── HTML ──────────────────────────────────────
const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="team-shell">
    <aside class="sidebar">
      <a class="back-link" href="/">← 홈</a>
      <h1 class="sidebar-title">팀 랜덤 배분</h1>

      <div>
        <label class="field-label" for="participants">참가자</label>
        <textarea
          id="participants"
          class="participants-area"
          rows="8"
          spellcheck="false"
          placeholder="이름을 한 줄에 하나씩 입력하세요"
        ></textarea>
        <div class="count-hint" id="count-hint">0명</div>
      </div>

      <div>
        <span class="field-label">분배 방식</span>
        <div class="mode-toggle">
          <button type="button" class="mode-btn" id="mode-count-btn">팀 수 입력</button>
          <button type="button" class="mode-btn active" id="mode-size-btn">팀당 인원</button>
        </div>
      </div>

      <div id="count-field" class="hidden">
        <label class="field-label" for="team-count-input">팀 수</label>
        <div class="size-row">
          <input id="team-count-input" class="size-input" type="number" min="2" max="26" value="4" />
          <span class="size-unit">팀</span>
        </div>
      </div>

      <div id="size-field">
        <label class="field-label" for="team-size-input">팀당 인원</label>
        <div class="size-row">
          <input id="team-size-input" class="size-input" type="number" min="1" max="50" value="4" />
          <span class="size-unit">명씩</span>
        </div>
      </div>
    </aside>

    <main class="main-area">
      <div class="progress-bar hidden" id="progress-bar">
        <div class="progress-fill" id="progress-fill"></div>
      </div>

      <!-- Idle / Shuffle: centered deck with distribute button above -->
      <div class="idle-panel" id="idle-panel">
        <button id="distribute-btn" type="button" class="idle-dist-btn">배분하기</button>
        <div class="deck" id="deck">
          <div class="deck-card"></div>
          <div class="deck-card"></div>
          <div class="deck-card"></div>
          <div class="deck-card"></div>
          <div class="deck-card"></div>
          <div class="deck-card"></div>
          <div class="deck-card"></div>
          <div class="deck-card"></div>
          <span class="deck-label">셔플</span>
        </div>
        <p class="shuffle-status hidden" id="shuffle-status">섞는 중…</p>
        <p class="seed-hint">시드 <span id="seed-display">${currentSeed}</span></p>
      </div>

      <!-- Dealing / Final / Done: status bar + card grid -->
      <div class="reveal-wrap hidden" id="reveal-wrap">
        <div class="status-bar" id="status-bar">
          <span class="status-meta"  id="status-meta"></span>
          <span class="status-current" id="status-current"></span>
          <button type="button" class="btn-bar hidden" id="skip-btn">건너뛰기</button>
          <button type="button" class="btn-bar hidden" id="copy-btn">복사</button>
          <button type="button" class="btn-bar hidden" id="csv-btn">CSV</button>
          <button type="button" class="btn-bar hidden" id="reset-btn">처음으로</button>
        </div>
        <div class="groups-grid" id="groups-grid"></div>
      </div>
    </main>
  </div>
`;

// ── Refs ──────────────────────────────────────
const participantInput  = document.getElementById('participants')     as HTMLTextAreaElement;
const teamCountInput    = document.getElementById('team-count-input') as HTMLInputElement;
const teamSizeInput     = document.getElementById('team-size-input')  as HTMLInputElement;
const countField        = document.getElementById('count-field')!;
const sizeField         = document.getElementById('size-field')!;
const modeCountBtn      = document.getElementById('mode-count-btn')   as HTMLButtonElement;
const modeSizeBtn       = document.getElementById('mode-size-btn')    as HTMLButtonElement;
const countHint         = document.getElementById('count-hint')!;
const seedDisplay       = document.getElementById('seed-display')!;
const distributeBtn     = document.getElementById('distribute-btn')   as HTMLButtonElement;
const idlePanel         = document.getElementById('idle-panel')!;
const deck              = document.getElementById('deck')!;
const shuffleStatus     = document.getElementById('shuffle-status')!;
const progressBar       = document.getElementById('progress-bar')!;
const progressFill      = document.getElementById('progress-fill')    as HTMLElement;
const revealWrap        = document.getElementById('reveal-wrap')!;
const statusBar         = document.getElementById('status-bar')!;
const statusMeta        = document.getElementById('status-meta')!;
const statusCurrent     = document.getElementById('status-current')!;
const skipBtn           = document.getElementById('skip-btn')!;
const copyBtn           = document.getElementById('copy-btn')!;
const csvBtn            = document.getElementById('csv-btn')!;
const resetBtn          = document.getElementById('reset-btn')!;
const groupsGrid        = document.getElementById('groups-grid')!;

// ── Init ──────────────────────────────────────
participantInput.value = loadParticipants() ?? '';
updateCountHint();

// ── Helpers ───────────────────────────────────
function getParticipants(): string[] {
  return normalizeParticipants(participantInput.value.split(/\r?\n/));
}
function updateCountHint() {
  countHint.textContent = `${getParticipants().length}명`;
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function groupLabel(gi: number): string {
  return (GROUP_LETTERS[gi] ?? String(gi + 1)) + '그룹';
}
function computeGroupCount(participants: string[]): number {
  if (mode === 'count') {
    return Math.max(2, Math.min(26, parseInt(teamCountInput.value, 10) || 2));
  }
  const size = Math.max(1, Math.min(50, parseInt(teamSizeInput.value, 10) || 4));
  return Math.ceil(participants.length / size);
}
function buildGroups(names: string[], groupCount: number, seed: number): Member[][] {
  const shuffled = seededShuffle(names, seed);
  const teamSize = Math.ceil(shuffled.length / groupCount);
  const totalSlots = groupCount * teamSize;
  const all: Member[] = shuffled.map(n => ({ name: n, ghost: false }));
  for (let i = shuffled.length; i < totalSlots; i++) all.push({ name: '빈자리', ghost: true });
  const result: Member[][] = Array.from({ length: groupCount }, () => []);
  all.forEach((m, i) => result[i % groupCount].push(m));
  return result;
}

// ── Progress bar ──────────────────────────────
function startProgress(ms: number) {
  progressBar.classList.remove('hidden');
  progressFill.style.transition = 'none';
  progressFill.style.width = '0%';
  progressFill.getBoundingClientRect();
  progressFill.style.transition = `width ${ms}ms linear`;
  progressFill.style.width = '100%';
}
function stopProgress() {
  progressFill.style.transition = 'none';
  progressFill.style.width = '0%';
  progressBar.classList.add('hidden');
}

// ── Input locking ─────────────────────────────
function setLocked(locked: boolean) {
  distributeBtn.disabled = locked;
  modeCountBtn.disabled  = locked;
  modeSizeBtn.disabled   = locked;
}

// ── Mode toggle ───────────────────────────────
function setMode(m: Mode) {
  mode = m;
  if (m === 'count') {
    modeCountBtn.classList.add('active');   modeSizeBtn.classList.remove('active');
    countField.classList.remove('hidden');  sizeField.classList.add('hidden');
  } else {
    modeSizeBtn.classList.add('active');    modeCountBtn.classList.remove('active');
    sizeField.classList.remove('hidden');   countField.classList.add('hidden');
  }
}

// ── Events ────────────────────────────────────
participantInput.addEventListener('input', () => {
  updateCountHint();
  saveParticipants(participantInput.value);
});
modeCountBtn.addEventListener('click', () => setMode('count'));
modeSizeBtn.addEventListener('click',  () => setMode('size'));

// Clicking the deck triggers shuffle
deck.addEventListener('click', doShuffle);

distributeBtn.addEventListener('click', () => {
  if (phase === 'shuffle') return;
  const participants = getParticipants();
  if (participants.length < 2) {
    alert('참가자를 2명 이상 입력해주세요.');
    return;
  }
  const groupCount = computeGroupCount(participants);
  if (groupCount > participants.length) {
    alert(`그룹 수(${groupCount})가 참가자 수(${participants.length})보다 많습니다.`);
    return;
  }
  startDistribution(participants, groupCount);
});

resetBtn.addEventListener('click', resetToIdle);

skipBtn.addEventListener('click', () => {
  if (phase === 'dealing') skipDealing();
  else if (phase === 'final') revealAllFinal();
});

// ── Shuffle ───────────────────────────────────
function doShuffle() {
  if (phase !== 'idle') return;

  phase = 'shuffle';
  setLocked(true);
  deck.classList.add('shuffling');
  shuffleStatus.classList.remove('hidden');
  startProgress(SHUFFLE_MS);

  animTimer = setTimeout(() => {
    animTimer = null;
    currentSeed = randomSeed();
    seedDisplay.textContent = String(currentSeed);

    deck.classList.remove('shuffling');
    shuffleStatus.classList.add('hidden');
    stopProgress();
    setLocked(false);
    phase = 'idle';
  }, SHUFFLE_MS);
}

// ── Reset ─────────────────────────────────────
function resetToIdle() {
  if (animTimer) { clearTimeout(animTimer); animTimer = null; }
  groups = [];
  groupsGrid.innerHTML = '';
  deck.classList.remove('shuffling');
  shuffleStatus.classList.add('hidden');
  stopProgress();
  setLocked(false);
  phase = 'idle';

  idlePanel.classList.remove('hidden');
  revealWrap.classList.add('hidden');
  statusBar.classList.remove('status-done');
}

// ── Distribution ──────────────────────────────
function startDistribution(participants: string[], groupCount: number) {
  if (animTimer) { clearTimeout(animTimer); animTimer = null; }
  phase = 'dealing';

  groups = buildGroups(participants, groupCount, currentSeed);
  groupsGrid.innerHTML = '';
  buildGrid(groups);

  idlePanel.classList.add('hidden');
  revealWrap.classList.remove('hidden');
  statusBar.classList.remove('status-done');

  setLocked(true);
  statusMeta.textContent = `${participants.length}명 · ${groups.length}그룹`;
  statusCurrent.textContent = '배치 중…';
  skipBtn.textContent = '건너뛰기';
  skipBtn.classList.remove('hidden');
  copyBtn.classList.add('hidden');
  csvBtn.classList.add('hidden');
  resetBtn.classList.remove('hidden');

  // Build sequential deal order: all of A, then all of B, then C...
  dealCards = [];
  groups.forEach((members, gi) => members.forEach((_, mi) => dealCards.push({ gi, mi })));
  dealIdx = 0;
  runDeal();
}

function buildGrid(gs: Member[][]) {
  gs.forEach((members, gi) => {
    const col = document.createElement('div');
    col.className = 'group-col';
    col.id = `group-col-${gi}`;
    col.innerHTML = `
      <div class="group-col-header">
        <span>${groupLabel(gi)}</span>
        <span class="check-icon">✓</span>
      </div>
      <div class="group-slots">
        ${members.map((m, mi) => `
          <div class="slot-card" id="card-${gi}-${mi}">
            <div class="card-inner">
              <div class="card-face card-back"></div>
              <div class="card-face card-front${m.ghost ? ' ghost-card' : ''}">
                <span class="card-name${m.ghost ? ' ghost-name' : ''}">${escapeHtml(m.name)}</span>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    groupsGrid.appendChild(col);
  });
}

// ── Dealing sequence ──────────────────────────
function runDeal() {
  if (phase !== 'dealing') return;

  if (dealIdx >= dealCards.length) {
    animTimer = setTimeout(enterFinalPhase, 300);
    return;
  }

  const { gi, mi } = dealCards[dealIdx];
  const isLastGroup = gi === groups.length - 1;

  // Update group header and status at the start of each new group
  if (mi === 0) {
    if (gi > 0) {
      const prevCol = document.getElementById(`group-col-${gi - 1}`);
      prevCol?.classList.remove('active');
      if (gi - 1 < groups.length - 1) prevCol?.classList.add('done');
    }
    document.getElementById(`group-col-${gi}`)?.classList.add('active');
    statusCurrent.textContent = `${groupLabel(gi)} 배치 중`;
  }

  // Deal card: slide in, then settle and auto-flip for non-last groups
  const card = document.getElementById(`card-${gi}-${mi}`)!;
  card.classList.add('dealing');

  setTimeout(() => {
    card.classList.remove('dealing');
    card.classList.add('dealt');
    if (!isLastGroup) {
      card.getBoundingClientRect(); // ensure transition is active before revealing
      card.classList.add('revealed');
    }
  }, DEAL_ANIM_MS);

  dealIdx++;

  // Pause between groups; extra-long pause before the final group
  const isLastInGroup = mi === groups[gi].length - 1;
  let delay = DEAL_INTERVAL_MS;
  if (isLastInGroup && !isLastGroup) delay += (gi === groups.length - 2 ? 450 : 200);

  animTimer = setTimeout(runDeal, delay);
}

function skipDealing() {
  if (animTimer) { clearTimeout(animTimer); animTimer = null; }
  dealCards.forEach(({ gi, mi }) => {
    const card = document.getElementById(`card-${gi}-${mi}`)!;
    card.classList.remove('dealing');
    card.classList.add('dealt');
    if (gi < groups.length - 1) card.classList.add('revealed');
  });
  enterFinalPhase();
}

// ── Final-group interactive reveal ────────────
function enterFinalPhase() {
  if (phase !== 'dealing') return;
  phase = 'final';

  for (let gi = 0; gi < groups.length - 1; gi++) {
    const col = document.getElementById(`group-col-${gi}`);
    col?.classList.remove('active');
    col?.classList.add('done');
  }

  const lastGi = groups.length - 1;
  const lastCol = document.getElementById(`group-col-${lastGi}`);
  lastCol?.classList.remove('active');
  lastCol?.classList.add('final');

  setLocked(false);
  skipBtn.textContent = '한번에 열기';
  statusCurrent.textContent = '마지막 그룹 — 카드를 눌러 공개하세요';

  groups[lastGi].forEach((_, mi) => {
    const card = document.getElementById(`card-${lastGi}-${mi}`)!;
    if (!card.classList.contains('revealed')) {
      card.classList.add('clickable');
      card.addEventListener('click', onFinalCardClick, { once: true });
    }
  });

  checkFinalComplete(); // edge case: all already revealed
}

function onFinalCardClick(e: Event) {
  const card = e.currentTarget as HTMLElement;
  if (card.classList.contains('revealed')) return;
  card.classList.remove('clickable');
  card.classList.add('revealed', 'lit');
  card.addEventListener('animationend', () => card.classList.remove('lit'), { once: true });
  checkFinalComplete();
}

function checkFinalComplete() {
  if (phase !== 'final') return;
  const lastGi = groups.length - 1;
  const anyUnrevealed = groups[lastGi].some(
    (_, mi) => !document.getElementById(`card-${lastGi}-${mi}`)!.classList.contains('revealed')
  );
  if (!anyUnrevealed) setTimeout(enterDonePhase, 400);
}

function revealAllFinal() {
  if (phase !== 'final') return;
  const lastGi = groups.length - 1;
  groups[lastGi].forEach((_, mi) => {
    const card = document.getElementById(`card-${lastGi}-${mi}`)!;
    card.classList.remove('clickable');
    card.classList.add('dealt', 'revealed');
  });
  setTimeout(enterDonePhase, 400);
}

function enterDonePhase() {
  phase = 'done';
  const lastGi = groups.length - 1;
  document.getElementById(`group-col-${lastGi}`)?.classList.remove('final');
  document.getElementById(`group-col-${lastGi}`)?.classList.add('done');

  statusCurrent.textContent = '배분 완료!';
  statusBar.classList.add('status-done');
  skipBtn.classList.add('hidden');
  copyBtn.classList.remove('hidden');
  csvBtn.classList.remove('hidden');
}

// ── Copy / CSV ────────────────────────────────
copyBtn.addEventListener('click', () => {
  const text = groups
    .map((members, gi) => `${groupLabel(gi)}\n${members.filter(m => !m.ghost).map(m => m.name).join('\n')}`)
    .join('\n\n');
  navigator.clipboard.writeText(text).then(() => {
    const orig = copyBtn.textContent;
    copyBtn.textContent = '복사됨!';
    setTimeout(() => { copyBtn.textContent = orig; }, 1500);
  });
});

csvBtn.addEventListener('click', () => {
  const rows: string[][] = [['그룹', '이름']];
  groups.forEach((members, gi) => {
    const label = groupLabel(gi);
    members.filter(m => !m.ghost).forEach(m => rows.push([label, m.name]));
  });
  const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = '팀배분결과.csv'; a.click();
  URL.revokeObjectURL(url);
});
