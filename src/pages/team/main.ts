import './team.css';
import { normalizeParticipants } from '../../game/rules';
import { distributeTeams, randomSeed } from '../../shared/seed';
import { loadParticipants, saveParticipants } from '../../shared/participants';

let currentSeed = randomSeed();

const app = document.getElementById('app')!;

app.innerHTML = `
  <div class="team-shell">
    <aside class="team-sidebar">
      <div class="sidebar-top">
        <a class="back-link" href="/">← 홈</a>
        <h1 class="sidebar-title">팀 랜덤 배분</h1>
      </div>

      <div class="input-group">
        <span class="input-label">참가자</span>
        <textarea
          id="participants"
          class="participants-input"
          spellcheck="false"
          placeholder="이름을 한 줄에 하나씩 입력하세요"
        ></textarea>
        <div class="count-hint" id="count-hint">0명</div>
      </div>

      <div>
        <span class="input-label">팀 수</span>
        <div class="team-count-row">
          <input id="team-count" class="team-count-input" type="number" min="2" max="20" value="2" />
          <span class="team-count-display" id="team-count-display">2팀</span>
        </div>
      </div>

      <div class="seed-row">
        <span class="seed-label">시드 <span class="seed-value" id="seed-display">${currentSeed}</span></span>
        <button id="new-seed" type="button" class="seed-btn">순서변경</button>
      </div>

      <button id="distribute-btn" type="button" class="distribute-btn">배분하기</button>
    </aside>

    <main class="team-main" id="team-main">
      <div class="team-placeholder" id="placeholder">
        <p>참가자를 입력하고<br>배분하기를 눌러주세요</p>
      </div>
      <div class="shuffle-stage hidden" id="shuffle-stage"></div>
      <div class="result-area hidden" id="result-area"></div>
    </main>
  </div>
`;

const participantInput = document.getElementById('participants') as HTMLTextAreaElement;
const teamCountInput = document.getElementById('team-count') as HTMLInputElement;
const teamCountDisplay = document.getElementById('team-count-display')!;
const countHint = document.getElementById('count-hint')!;
const seedDisplay = document.getElementById('seed-display')!;
const newSeedBtn = document.getElementById('new-seed')!;
const distributeBtn = document.getElementById('distribute-btn')!;
const placeholder = document.getElementById('placeholder')!;
const shuffleStage = document.getElementById('shuffle-stage')!;
const resultArea = document.getElementById('result-area')!;

participantInput.value = loadParticipants() ?? '';
updateCountHint();

function getParticipants(): string[] {
  return normalizeParticipants(participantInput.value.split(/\r?\n/));
}

function updateCountHint() {
  const count = getParticipants().length;
  countHint.textContent = `${count}명`;
}

function updateTeamCountDisplay() {
  const n = parseInt(teamCountInput.value, 10) || 2;
  teamCountDisplay.textContent = `${n}팀`;
}

participantInput.addEventListener('input', () => {
  updateCountHint();
  saveParticipants(participantInput.value);
});

teamCountInput.addEventListener('input', updateTeamCountDisplay);

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
  const teamCount = Math.max(2, Math.min(20, parseInt(teamCountInput.value, 10) || 2));
  if (teamCount > participants.length) {
    alert(`팀 수(${teamCount})가 참가자 수(${participants.length})보다 많습니다.`);
    return;
  }
  startDistribution(participants, teamCount);
});

function startDistribution(participants: string[], teamCount: number) {
  placeholder.classList.add('hidden');
  resultArea.classList.add('hidden');

  shuffleStage.innerHTML = participants
    .map((name) => `<span class="shuffle-card">${escapeHtml(name)}</span>`)
    .join('');
  shuffleStage.classList.remove('hidden');

  // Randomize animation delay per card so they don't all bounce in sync
  shuffleStage.querySelectorAll<HTMLElement>('.shuffle-card').forEach((card) => {
    card.style.animationDelay = `${Math.random() * 0.4}s`;
  });

  setTimeout(() => {
    shuffleStage.classList.add('hidden');
    showResult(participants, teamCount);
  }, 1500);
}

function showResult(participants: string[], teamCount: number) {
  const teams = distributeTeams(participants, teamCount, currentSeed);

  resultArea.innerHTML = `
    <div class="result-toolbar">
      <span class="result-toolbar-title">배분 결과 · ${participants.length}명 · ${teamCount}팀</span>
      <button type="button" class="toolbar-btn" id="copy-btn">복사</button>
      <button type="button" class="toolbar-btn" id="csv-btn">CSV</button>
    </div>
    <div class="result-grid" id="result-grid"></div>
  `;

  const grid = document.getElementById('result-grid')!;
  teams.forEach((members, i) => {
    const col = document.createElement('div');
    col.className = 'team-col';
    col.style.animationDelay = `${i * 60}ms`;
    col.innerHTML = `<div class="team-col-header">팀 ${i + 1}<span style="opacity:.5;font-weight:500;text-transform:none;letter-spacing:0"> · ${members.length}명</span></div>`;
    members.forEach((name, j) => {
      const card = document.createElement('div');
      card.className = 'member-card';
      card.style.animationDelay = `${i * 60 + j * 30}ms`;
      card.textContent = name;
      col.appendChild(card);
    });
    grid.appendChild(col);
  });

  resultArea.classList.remove('hidden');

  document.getElementById('copy-btn')!.addEventListener('click', () => copyResult(teams));
  document.getElementById('csv-btn')!.addEventListener('click', () => downloadCsv(teams));
}

function copyResult(teams: string[][]) {
  const text = teams
    .map((members, i) => `팀 ${i + 1}\n${members.join('\n')}`)
    .join('\n\n');
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copy-btn')!;
    const orig = btn.textContent;
    btn.textContent = '복사됨!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

function downloadCsv(teams: string[][]) {
  const rows = [['팀', '이름']];
  teams.forEach((members, i) => {
    members.forEach((name) => rows.push([String(i + 1), name]));
  });
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '팀배분결과.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
