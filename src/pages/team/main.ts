import './team.css';
import { normalizeParticipants } from '../../game/rules';
import { seededShuffle, randomSeed } from '../../shared/seed';
import { loadParticipants, saveParticipants } from '../../shared/participants';

// ── Types ─────────────────────────────────────
interface Member {
  name: string;
  ghost: boolean;
}

type Mode = 'count' | 'size';
type Phase = 'idle' | 'shuffle' | 'reveal' | 'done';

// ── State ─────────────────────────────────────
let currentSeed = randomSeed();
let mode: Mode = 'size';
let phase: Phase = 'idle';
let groups: Member[][] = [];
let revealTimer: ReturnType<typeof setTimeout> | null = null;

const GROUP_LETTERS = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
const REVEAL_DELAY_MS = 380;
const SHUFFLE_DURATION_MS = 2000;

// ── Render shell ──────────────────────────────
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
          <button type="button" class="mode-btn" id="mode-count-btn" data-mode="count">팀 수 입력</button>
          <button type="button" class="mode-btn active" id="mode-size-btn" data-mode="size">팀당 인원</button>
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

      <div class="seed-row">
        <span class="seed-label">시드 <span class="seed-value" id="seed-display">${currentSeed}</span></span>
        <button id="new-seed" type="button" class="seed-btn">순서변경</button>
      </div>

      <div class="action-row">
        <button id="distribute-btn" type="button" class="btn-primary">배분하기</button>
        <button id="reset-btn" type="button" class="btn-secondary hidden">처음으로</button>
      </div>
    </aside>

    <main class="main-area">
      <div class="placeholder" id="placeholder">
        참가자를 입력하고<br>배분하기를 눌러주세요
      </div>

      <div class="shuffle-wrap hidden" id="shuffle-wrap">
        <div class="deck" id="deck">
          <div class="deck-card"></div>
          <div class="deck-card"></div>
          <div class="deck-card"></div>
          <div class="deck-card"></div>
          <div class="deck-card"></div>
          <div class="deck-card"></div>
          <div class="deck-card"></div>
          <div class="deck-card"></div>
        </div>
        <p class="shuffle-label">섞는 중…</p>
      </div>

      <div class="reveal-wrap hidden" id="reveal-wrap">
        <div class="status-bar" id="status-bar">
          <span class="status-meta" id="status-meta"></span>
          <span class="status-current" id="status-current"></span>
          <button type="button" class="btn-bar hidden" id="skip-btn">건너뛰기</button>
          <button type="button" class="btn-bar hidden" id="copy-btn">복사</button>
          <button type="button" class="btn-bar hidden" id="csv-btn">CSV</button>
        </div>
        <div class="groups-grid" id="groups-grid"></div>
      </div>
    </main>
  </div>
`;

// ── Element refs ──────────────────────────────
const participantInput = document.getElementById('participants') as HTMLTextAreaElement;
const teamCountInput = document.getElementById('team-count-input') as HTMLInputElement;
const teamSizeInput = document.getElementById('team-size-input') as HTMLInputElement;
const countField = document.getElementById('count-field')!;
const sizeField = document.getElementById('size-field')!;
const modeCountBtn = document.getElementById('mode-count-btn')!;
const modeSizeBtn = document.getElementById('mode-size-btn')!;
const countHint = document.getElementById('count-hint')!;
const seedDisplay = document.getElementById('seed-display')!;
const newSeedBtn = document.getElementById('new-seed')!;
const distributeBtn = document.getElementById('distribute-btn') as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn')!;
const placeholder = document.getElementById('placeholder')!;
const shuffleWrap = document.getElementById('shuffle-wrap')!;
const deck = document.getElementById('deck')!;
const revealWrap = document.getElementById('reveal-wrap')!;
const statusBar = document.getElementById('status-bar')!;
const statusMeta = document.getElementById('status-meta')!;
const statusCurrent = document.getElementById('status-current')!;
const skipBtn = document.getElementById('skip-btn')!;
const copyBtn = document.getElementById('copy-btn')!;
const csvBtn = document.getElementById('csv-btn')!;
const groupsGrid = document.getElementById('groups-grid')!;

// ── Init ──────────────────────────────────────
participantInput.value = loadParticipants() ?? '';
updateCountHint();

// ── Helpers ───────────────────────────────────
function getParticipants(): string[] {
  return normalizeParticipants(participantInput.value.split(/\r?\n/));
}

function updateCountHint() {
  const count = getParticipants().length;
  countHint.textContent = `${count}명`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function groupLabel(gi: number): string {
  return (GROUP_LETTERS[gi] ?? String(gi + 1)) + '그룹';
}

function computeGroupCount(participants: string[]): number {
  const n = participants.length;
  if (mode === 'count') {
    return Math.max(2, Math.min(26, parseInt(teamCountInput.value, 10) || 2));
  } else {
    const size = Math.max(1, Math.min(50, parseInt(teamSizeInput.value, 10) || 4));
    return Math.ceil(n / size);
  }
}

function buildGroups(names: string[], groupCount: number, seed: number): Member[][] {
  const shuffled = seededShuffle(names, seed);
  const teamSize = Math.ceil(shuffled.length / groupCount);
  const totalSlots = groupCount * teamSize;
  const all: Member[] = shuffled.map(n => ({ name: n, ghost: false }));
  for (let i = shuffled.length; i < totalSlots; i++) {
    all.push({ name: '빈자리', ghost: true });
  }
  const result: Member[][] = Array.from({ length: groupCount }, () => []);
  all.forEach((m, i) => result[i % groupCount].push(m));
  return result;
}

// ── Mode switching ────────────────────────────
function setMode(m: Mode) {
  mode = m;
  if (m === 'count') {
    modeCountBtn.classList.add('active');
    modeSizeBtn.classList.remove('active');
    countField.classList.remove('hidden');
    sizeField.classList.add('hidden');
  } else {
    modeSizeBtn.classList.add('active');
    modeCountBtn.classList.remove('active');
    sizeField.classList.remove('hidden');
    countField.classList.add('hidden');
  }
}

modeCountBtn.addEventListener('click', () => setMode('count'));
modeSizeBtn.addEventListener('click', () => setMode('size'));

// ── Input events ──────────────────────────────
participantInput.addEventListener('input', () => {
  updateCountHint();
  saveParticipants(participantInput.value);
});

newSeedBtn.addEventListener('click', () => {
  currentSeed = randomSeed();
  seedDisplay.textContent = String(currentSeed);
});

distributeBtn.addEventListener('click', () => {
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
skipBtn.addEventListener('click', skipAll);

// ── Phase management ──────────────────────────
function setPhase(p: Phase) {
  phase = p;
  placeholder.classList.add('hidden');
  shuffleWrap.classList.add('hidden');
  revealWrap.classList.add('hidden');
  deck.classList.remove('shuffling');
  statusBar.classList.remove('status-done');

  if (p === 'idle') {
    placeholder.classList.remove('hidden');
    distributeBtn.disabled = false;
    resetBtn.classList.add('hidden');
    skipBtn.classList.add('hidden');
    copyBtn.classList.add('hidden');
    csvBtn.classList.add('hidden');
  } else if (p === 'shuffle') {
    shuffleWrap.classList.remove('hidden');
    distributeBtn.disabled = true;
    resetBtn.classList.remove('hidden');
    skipBtn.classList.add('hidden');
    copyBtn.classList.add('hidden');
    csvBtn.classList.add('hidden');
  } else if (p === 'reveal') {
    revealWrap.classList.remove('hidden');
    skipBtn.classList.remove('hidden');
    copyBtn.classList.add('hidden');
    csvBtn.classList.add('hidden');
  } else {
    // done
    revealWrap.classList.remove('hidden');
    statusBar.classList.add('status-done');
    skipBtn.classList.add('hidden');
    copyBtn.classList.remove('hidden');
    csvBtn.classList.remove('hidden');
  }
}

function resetToIdle() {
  if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
  groupsGrid.innerHTML = '';
  setPhase('idle');
}

// ── Distribution flow ─────────────────────────
function startDistribution(participants: string[], groupCount: number) {
  groups = buildGroups(participants, groupCount, currentSeed);
  setPhase('shuffle');
  deck.classList.add('shuffling');

  revealTimer = setTimeout(() => {
    revealTimer = null;
    deck.classList.remove('shuffling');
    buildGrid(groups);
    setPhase('reveal');
    const totalParticipants = participants.length;
    statusMeta.textContent = `${totalParticipants}명 · ${groups.length}그룹`;
    revealNext(0, 0);
  }, SHUFFLE_DURATION_MS);
}

function buildGrid(gs: Member[][]) {
  groupsGrid.innerHTML = '';
  gs.forEach((members, gi) => {
    const col = document.createElement('div');
    col.className = 'group-col';
    col.id = `group-col-${gi}`;

    const slots = members.map((m, mi) => `
      <div class="slot-card" id="card-${gi}-${mi}">
        <div class="card-inner">
          <div class="card-face card-back"></div>
          <div class="card-face card-front${m.ghost ? ' ghost-card' : ''}">
            <span class="card-name${m.ghost ? ' ghost-name' : ''}">${escapeHtml(m.name)}</span>
          </div>
        </div>
      </div>
    `).join('');

    col.innerHTML = `
      <div class="group-col-header">
        <span>${groupLabel(gi)}</span>
        <span class="check-icon">✓</span>
      </div>
      <div class="group-slots">${slots}</div>
    `;
    groupsGrid.appendChild(col);
  });
}

function revealNext(gi: number, mi: number) {
  if (phase !== 'reveal') return;

  // All groups finished
  if (gi >= groups.length) {
    const lastCol = document.getElementById(`group-col-${gi - 1}`);
    lastCol?.classList.remove('active');
    lastCol?.classList.add('done');
    statusCurrent.textContent = '배분 완료!';
    setPhase('done');
    return;
  }

  const group = groups[gi];

  // Transition to a new group
  if (mi === 0) {
    if (gi > 0) {
      const prevCol = document.getElementById(`group-col-${gi - 1}`);
      prevCol?.classList.remove('active');
      prevCol?.classList.add('done');
    }
    document.getElementById(`group-col-${gi}`)?.classList.add('active');
    statusCurrent.textContent = `${groupLabel(gi)} 배정 중`;
  }

  // Finished all cards in this group
  if (mi >= group.length) {
    revealTimer = setTimeout(() => revealNext(gi + 1, 0), REVEAL_DELAY_MS);
    return;
  }

  // Flip the card
  const card = document.getElementById(`card-${gi}-${mi}`);
  if (card) {
    card.classList.add('revealed', 'lit');
    card.addEventListener('animationend', () => card.classList.remove('lit'), { once: true });
  }

  revealTimer = setTimeout(() => revealNext(gi, mi + 1), REVEAL_DELAY_MS);
}

function skipAll() {
  if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }

  groups.forEach((group, gi) => {
    const col = document.getElementById(`group-col-${gi}`);
    col?.classList.remove('active');
    col?.classList.add('done');
    group.forEach((_, mi) => {
      const card = document.getElementById(`card-${gi}-${mi}`);
      card?.classList.add('revealed');
      card?.classList.remove('lit');
    });
  });

  statusCurrent.textContent = '배분 완료!';
  setPhase('done');
}

// ── Copy / CSV ────────────────────────────────
copyBtn.addEventListener('click', () => {
  const text = groups
    .map((members, gi) => {
      const names = members.filter(m => !m.ghost).map(m => m.name);
      return `${groupLabel(gi)}\n${names.join('\n')}`;
    })
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
  a.href = url;
  a.download = '팀배분결과.csv';
  a.click();
  URL.revokeObjectURL(url);
});
