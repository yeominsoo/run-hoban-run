import './team.css';
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
let autoRecordEnabled = false;
let teamMediaRecorder: MediaRecorder | null = null;
let teamVideoChunks: Blob[] = [];
let teamRecordingCanvas: HTMLCanvasElement | null = null;
let teamRecordingContext: CanvasRenderingContext2D | null = null;
let teamRecordingFrameRequest = 0;
let teamRecordingStopTimer: ReturnType<typeof setTimeout> | null = null;
let teamRecordingShouldPromptDownload = false;
let teamRecordingStartedAt = 0;

// ── HTML ──────────────────────────────────────
const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="team-shell">
    <aside class="sidebar">
      <a class="back-link" href="/">← 게임 선택</a>
      <h1 class="sidebar-title">팀 랜덤 배분</h1>

      <div class="sidebar-actions" id="sidebar-actions">
        <button id="actions-toggle" type="button" class="actions-toggle" aria-expanded="true" aria-controls="actions-body">버튼 영역 접기</button>
        <div class="actions-body" id="actions-body">
          <div class="setup-controls" id="setup-controls">
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
              <div class="size-row">
                <label class="field-label inline-label" for="team-count-input">팀 수</label>
                <input id="team-count-input" class="size-input" type="number" min="2" max="26" value="4" />
                <span class="size-unit">팀</span>
              </div>
            </div>

            <div id="size-field">
              <div class="size-row">
                <label class="field-label inline-label" for="team-size-input">팀당 인원</label>
                <input id="team-size-input" class="size-input" type="number" min="1" max="50" value="4" />
                <span class="size-unit">명씩</span>
              </div>
            </div>

            <label class="record-toggle">
              <input id="auto-record-toggle" type="checkbox" />
              <span>자동 영상저장</span>
            </label>

            <button id="distribute-btn" type="button" class="sidebar-action primary">카드오픈</button>
          </div>

          <div class="runtime-controls" id="runtime-controls">
            <button type="button" class="sidebar-action secondary hidden" id="copy-btn">복사</button>
          </div>
        </div>
      </div>
    </aside>

    <main class="main-area">
      <div class="progress-bar hidden" id="progress-bar">
        <div class="progress-fill" id="progress-fill"></div>
      </div>

      <!-- Idle / Shuffle: centered deck with start button below -->
      <div class="idle-panel" id="idle-panel">
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
        <button id="deck-start-btn" type="button" class="deck-start-btn">카드오픈</button>
        <p class="shuffle-status hidden" id="shuffle-status">섞는 중…</p>
      </div>

      <!-- Dealing / Final / Done: status bar + card grid -->
      <div class="reveal-wrap hidden" id="reveal-wrap">
        <div class="status-bar" id="status-bar">
          <span class="status-meta"  id="status-meta"></span>
          <span class="status-current" id="status-current"></span>
          <div class="status-actions" id="status-actions">
            <button type="button" class="header-action hidden" id="skip-btn">건너뛰기</button>
            <button type="button" class="header-action hidden" id="reset-btn">다시하기</button>
          </div>
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
const sidebarActions    = document.getElementById('sidebar-actions')!;
const actionsToggle     = document.getElementById('actions-toggle')   as HTMLButtonElement;
const autoRecordToggle  = document.getElementById('auto-record-toggle') as HTMLInputElement;
const distributeBtn     = document.getElementById('distribute-btn')   as HTMLButtonElement;
const idlePanel         = document.getElementById('idle-panel')!;
const deck              = document.getElementById('deck')!;
const deckStartBtn      = document.getElementById('deck-start-btn')    as HTMLButtonElement;
const shuffleStatus     = document.getElementById('shuffle-status')!;
const progressBar       = document.getElementById('progress-bar')!;
const progressFill      = document.getElementById('progress-fill')    as HTMLElement;
const revealWrap        = document.getElementById('reveal-wrap')!;
const statusBar         = document.getElementById('status-bar')!;
const statusMeta        = document.getElementById('status-meta')!;
const statusCurrent     = document.getElementById('status-current')!;
const skipBtn           = document.getElementById('skip-btn')!;
const copyBtn           = document.getElementById('copy-btn')!;
const resetBtn          = document.getElementById('reset-btn')!;
const groupsGrid        = document.getElementById('groups-grid')!;

// ── Init ──────────────────────────────────────
participantInput.value = loadParticipants() ?? '';
updateCountHint();
initializeTeamRecordingControls();

// ── Helpers ───────────────────────────────────
function normalizeEnteredParticipants(input: string[]): string[] {
  const seen = new Map<string, number>();
  return input
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 500)
    .map((name) => {
      const count = seen.get(name) ?? 0;
      seen.set(name, count + 1);
      return count === 0 ? name : `${name} ${count + 1}`;
    });
}

function getParticipants(): string[] {
  return normalizeEnteredParticipants(participantInput.value.split(/\r?\n/));
}
function updateCountHint() {
  countHint.textContent = `현재 참가자 ${getParticipants().length}명`;
}
function getSupportedTeamRecordingMimeType() {
  if (typeof MediaRecorder === 'undefined') {
    return '';
  }

  return ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4']
    .find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? '';
}
function isTeamRecordingSupported() {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    getSupportedTeamRecordingMimeType() !== ''
  );
}
function initializeTeamRecordingControls() {
  const supported = isTeamRecordingSupported();
  autoRecordToggle.disabled = !supported;
  autoRecordToggle.checked = false;
  autoRecordToggle.parentElement?.classList.toggle('disabled', !supported);
  autoRecordToggle.parentElement?.setAttribute(
    'title',
    supported ? '카드오픈 과정을 MP4로 저장합니다.' : '이 브라우저는 MP4 자동 영상저장을 지원하지 않습니다.'
  );
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

function isFinalRevealCard(gi: number, mi: number): boolean {
  return mi === groups[gi].length - 1;
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
  deckStartBtn.disabled  = locked;
  modeCountBtn.disabled  = locked;
  modeSizeBtn.disabled   = locked;
  autoRecordToggle.disabled = locked || !isTeamRecordingSupported();
}

function syncActionButtons() {
  sidebarActions.classList.toggle('game-active', phase !== 'idle');
  distributeBtn.classList.toggle('hidden', phase !== 'idle' && phase !== 'shuffle');
  deckStartBtn.classList.toggle('hidden', phase !== 'idle');
  skipBtn.classList.toggle('hidden', phase !== 'dealing' && phase !== 'final');
  copyBtn.classList.toggle('hidden', phase !== 'done');
  resetBtn.classList.toggle('hidden', phase === 'idle' || phase === 'shuffle');
}

function setActionsCollapsed(collapsed: boolean) {
  sidebarActions.classList.toggle('collapsed', collapsed);
  actionsToggle.setAttribute('aria-expanded', String(!collapsed));
  actionsToggle.textContent = collapsed ? '버튼 영역 열기' : '버튼 영역 접기';
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
actionsToggle.addEventListener('click', () => {
  setActionsCollapsed(!sidebarActions.classList.contains('collapsed'));
});
autoRecordToggle.addEventListener('change', () => {
  autoRecordEnabled = autoRecordToggle.checked && isTeamRecordingSupported();
  if (!isTeamRecordingSupported()) {
    autoRecordToggle.checked = false;
  }
});

// Clicking the deck triggers shuffle
deck.addEventListener('click', doShuffle);

function handleCardOpen() {
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
  startCardOpen(participants, groupCount);
}

distributeBtn.addEventListener('click', handleCardOpen);
deckStartBtn.addEventListener('click', handleCardOpen);

resetBtn.addEventListener('click', resetToIdle);

skipBtn.addEventListener('click', () => {
  if (phase === 'dealing') skipDealing();
  else if (phase === 'final') revealAllFinal();
});

// ── Shuffle ───────────────────────────────────
function startCardOpen(participants: string[], groupCount: number) {
  if (autoRecordEnabled) {
    startTeamRecording();
  }

  setActionsCollapsed(true);
  runCardOpenShuffle(participants, groupCount);
}

function runCardOpenShuffle(participants: string[], groupCount: number) {
  if (animTimer) { clearTimeout(animTimer); animTimer = null; }
  phase = 'shuffle';
  syncActionButtons();
  setLocked(true);
  deck.classList.add('shuffling');
  shuffleStatus.textContent = '카드 섞는 중…';
  shuffleStatus.classList.remove('hidden');
  startProgress(SHUFFLE_MS);

  animTimer = setTimeout(() => {
    animTimer = null;
    currentSeed = randomSeed();
    deck.classList.remove('shuffling');
    shuffleStatus.classList.add('hidden');
    stopProgress();
    startDistribution(participants, groupCount);
  }, SHUFFLE_MS);
}

function doShuffle() {
  if (phase !== 'idle') return;

  phase = 'shuffle';
  syncActionButtons();
  setLocked(true);
  deck.classList.add('shuffling');
  shuffleStatus.textContent = '섞는 중…';
  shuffleStatus.classList.remove('hidden');
  startProgress(SHUFFLE_MS);

  animTimer = setTimeout(() => {
    animTimer = null;
    currentSeed = randomSeed();

    deck.classList.remove('shuffling');
    shuffleStatus.classList.add('hidden');
    stopProgress();
    setLocked(false);
    phase = 'idle';
    syncActionButtons();
  }, SHUFFLE_MS);
}

// ── Reset ─────────────────────────────────────
function resetToIdle() {
  if (animTimer) { clearTimeout(animTimer); animTimer = null; }
  if (teamRecordingStopTimer) { clearTimeout(teamRecordingStopTimer); teamRecordingStopTimer = null; }
  stopTeamRecording(false);
  groups = [];
  groupsGrid.innerHTML = '';
  resetRecordingLayoutDiagnostics();
  deck.classList.remove('shuffling');
  shuffleStatus.classList.add('hidden');
  stopProgress();
  setLocked(false);
  phase = 'idle';
  syncActionButtons();
  setActionsCollapsed(false);

  idlePanel.classList.remove('hidden');
  revealWrap.classList.add('hidden');
  statusBar.classList.remove('status-done');
}

function resetRecordingLayoutDiagnostics() {
  delete groupsGrid.dataset.recordingLayout;
  delete groupsGrid.dataset.recordingRows;
  delete groupsGrid.dataset.recordingColumns;
  delete groupsGrid.dataset.recordingScrollMax;
  delete groupsGrid.dataset.recordingCapturedGroups;
}

// ── Distribution ──────────────────────────────
function startDistribution(participants: string[], groupCount: number) {
  if (animTimer) { clearTimeout(animTimer); animTimer = null; }
  phase = 'dealing';
  syncActionButtons();

  groups = buildGroups(participants, groupCount, currentSeed);
  groupsGrid.innerHTML = '';
  resetRecordingLayoutDiagnostics();
  buildGrid(groups);

  idlePanel.classList.add('hidden');
  revealWrap.classList.remove('hidden');
  statusBar.classList.remove('status-done');

  setLocked(true);
  statusMeta.textContent = `${participants.length}명 · ${groups.length}그룹`;
  statusCurrent.textContent = '배치 중…';
  skipBtn.textContent = '건너뛰기';
  syncActionButtons();

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
  // Update group header and status at the start of each new group
  if (mi === 0) {
    if (gi > 0) {
      const prevCol = document.getElementById(`group-col-${gi - 1}`);
      prevCol?.classList.remove('active');
      prevCol?.classList.add('done');
    }
    document.getElementById(`group-col-${gi}`)?.classList.add('active');
    statusCurrent.textContent = `${groupLabel(gi)} 배치 중`;
  }

  // Deal card: slide in, then settle and auto-flip except each group's final slot.
  const card = document.getElementById(`card-${gi}-${mi}`)!;
  card.classList.add('dealing');

  setTimeout(() => {
    card.classList.remove('dealing');
    card.classList.add('dealt');
    if (!isFinalRevealCard(gi, mi)) {
      card.getBoundingClientRect(); // ensure transition is active before revealing
      card.classList.add('revealed');
    }
  }, DEAL_ANIM_MS);

  dealIdx++;

  // Pause between groups; extra-long pause before the final group
  const isLastInGroup = mi === groups[gi].length - 1;
  let delay = DEAL_INTERVAL_MS;
  if (isLastInGroup && gi < groups.length - 1) delay += (gi === groups.length - 2 ? 450 : 200);

  animTimer = setTimeout(runDeal, delay);
}

function skipDealing() {
  if (animTimer) { clearTimeout(animTimer); animTimer = null; }
  dealCards.forEach(({ gi, mi }) => {
    const card = document.getElementById(`card-${gi}-${mi}`)!;
    card.classList.remove('dealing');
    card.classList.add('dealt');
    if (!isFinalRevealCard(gi, mi)) card.classList.add('revealed');
  });
  enterFinalPhase();
}

// ── Final-group interactive reveal ────────────
function enterFinalPhase() {
  if (phase !== 'dealing') return;
  phase = 'final';
  syncActionButtons();

  for (let gi = 0; gi < groups.length; gi++) {
    const col = document.getElementById(`group-col-${gi}`);
    col?.classList.remove('active');
    col?.classList.remove('done');
    col?.classList.add('final');
  }

  setLocked(false);
  skipBtn.textContent = '한번에 열기';
  statusCurrent.textContent = '마지막 순번 — 각 그룹 카드를 눌러 공개하세요';

  groups.forEach((members, gi) => {
    const mi = members.length - 1;
    const card = document.getElementById(`card-${gi}-${mi}`)!;
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
  const anyUnrevealed = groups.some((members, gi) => {
    const mi = members.length - 1;
    return !document.getElementById(`card-${gi}-${mi}`)!.classList.contains('revealed');
  });
  if (!anyUnrevealed) setTimeout(enterDonePhase, 400);
}

function revealAllFinal() {
  if (phase !== 'final') return;
  groups.forEach((members, gi) => {
    const mi = members.length - 1;
    const card = document.getElementById(`card-${gi}-${mi}`)!;
    card.classList.remove('clickable');
    card.classList.add('dealt', 'revealed');
  });
  setTimeout(enterDonePhase, 400);
}

function enterDonePhase() {
  phase = 'done';
  syncActionButtons();
  groups.forEach((_, gi) => {
    const col = document.getElementById(`group-col-${gi}`);
    col?.classList.remove('active');
    col?.classList.remove('final');
    col?.classList.add('done');
  });

  statusCurrent.textContent = '배분 완료!';
  statusBar.classList.add('status-done');
  syncActionButtons();
  scheduleTeamRecordingStop();
}

// ── Auto video recording ──────────────────────
function startTeamRecording() {
  if (!isTeamRecordingSupported() || teamMediaRecorder) {
    return;
  }

  const mimeType = getSupportedTeamRecordingMimeType();
  if (!mimeType) {
    return;
  }

  teamRecordingCanvas = document.createElement('canvas');
  teamRecordingCanvas.width = 1280;
  teamRecordingCanvas.height = 720;
  teamRecordingContext = teamRecordingCanvas.getContext('2d');
  teamRecordingStartedAt = Date.now();
  drawTeamRecordingFrame();

  let stream: MediaStream;
  let recorder: MediaRecorder;
  try {
    stream = teamRecordingCanvas.captureStream(30);
    recorder = new MediaRecorder(stream, { mimeType });
  } catch {
    stopTeamRecordingLoop();
    teamVideoChunks = [];
    teamRecordingShouldPromptDownload = false;
    return;
  }
  teamVideoChunks = [];
  teamRecordingShouldPromptDownload = true;
  teamMediaRecorder = recorder;

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) {
      teamVideoChunks.push(event.data);
    }
  });

  recorder.addEventListener('stop', () => {
    stopTeamRecordingLoop();
    stream.getTracks().forEach((track) => track.stop());
    const chunks = teamVideoChunks;
    const shouldPrompt = teamRecordingShouldPromptDownload;
    teamVideoChunks = [];
    teamRecordingShouldPromptDownload = false;
    teamMediaRecorder = null;

    if (chunks.length === 0 || !shouldPrompt) {
      return;
    }

    if (window.confirm('결과 영상을 다운받으시겠습니까?')) {
      downloadBlob(new Blob(chunks, { type: mimeType }), makeDownloadFilename('card-open', 'mp4'));
    }
  });

  recorder.start(500);
}

function stopTeamRecording(promptDownload: boolean) {
  const recorder = teamMediaRecorder;
  if (!recorder || recorder.state === 'inactive') {
    return;
  }

  teamRecordingShouldPromptDownload = promptDownload;
  if (recorder.state === 'recording') {
    recorder.requestData();
  }
  recorder.stop();
}

function scheduleTeamRecordingStop() {
  if (!teamMediaRecorder) {
    return;
  }

  if (teamRecordingStopTimer) {
    clearTimeout(teamRecordingStopTimer);
  }

  teamRecordingStopTimer = setTimeout(() => {
    teamRecordingStopTimer = null;
    stopTeamRecording(true);
  }, 2000);
}

function stopTeamRecordingLoop() {
  if (teamRecordingFrameRequest) {
    window.cancelAnimationFrame(teamRecordingFrameRequest);
    teamRecordingFrameRequest = 0;
  }
  teamRecordingCanvas = null;
  teamRecordingContext = null;
  teamRecordingStartedAt = 0;
}

function drawTeamRecordingFrame() {
  if (!teamRecordingCanvas || !teamRecordingContext) {
    return;
  }

  const context = teamRecordingContext;
  const width = teamRecordingCanvas.width;
  const height = teamRecordingCanvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#0b1622';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#f0f9ff';
  context.font = '900 52px system-ui, sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillText('Toris Arcade', 56, 40);
  context.font = '800 30px system-ui, sans-serif';
  context.fillStyle = '#7ec8ff';
  context.fillText('팀 랜덤 배분', 58, 104);

  const participants = getParticipants();
  context.font = '700 24px system-ui, sans-serif';
  context.fillStyle = '#d8ecff';
  context.fillText(`현재 참가자 ${participants.length}명`, 56, 158);
  context.fillStyle = phase === 'done' ? '#69d994' : '#ffd77a';
  context.fillText(statusCurrent.textContent || getRecordingStatusText(), 56, 194);

  if (groups.length === 0) {
    drawRecordingDeck(context, width / 2 - 80, 290, phase === 'shuffle');
  } else {
    drawRecordingGroups(context);
  }

  teamRecordingFrameRequest = window.requestAnimationFrame(drawTeamRecordingFrame);
}

function getRecordingStatusText() {
  if (phase === 'shuffle') return '카드 섞는 중';
  if (phase === 'dealing') return '카드 배치 중';
  if (phase === 'final') return '마지막 순번 공개 중';
  if (phase === 'done') return '배분 완료';
  return '카드오픈 대기';
}

function drawRecordingDeck(context: CanvasRenderingContext2D, x: number, y: number, shuffling: boolean) {
  for (let index = 0; index < 8; index += 1) {
    const offset = shuffling ? Math.sin(Date.now() / 90 + index) * 10 : index * -3;
    drawRecordingCardBack(context, x + offset, y + index * -4, 160, 220);
  }
  context.fillStyle = '#e4f0ff';
  context.font = '900 34px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(shuffling ? '셔플 중' : '셔플', x + 80, y + 102);
}

function drawRecordingGroups(context: CanvasRenderingContext2D) {
  const layout = getRecordingGroupLayout(context.canvas.width, context.canvas.height);
  const maxScroll = Math.max(0, layout.contentHeight - layout.viewportHeight);
  const scrollY = getRecordingScrollY(maxScroll);
  groupsGrid.dataset.recordingLayout = maxScroll > 0 ? 'wrapped-scroll' : 'wrapped';
  groupsGrid.dataset.recordingRows = String(layout.rows);
  groupsGrid.dataset.recordingColumns = String(layout.columnsPerRow);
  groupsGrid.dataset.recordingScrollMax = String(Math.round(maxScroll));
  groupsGrid.dataset.recordingCapturedGroups = String(groups.length);

  context.save();
  context.beginPath();
  context.rect(layout.left, layout.top, layout.usableWidth, layout.viewportHeight);
  context.clip();
  context.translate(0, -scrollY);

  groups.forEach((members, gi) => {
    const row = Math.floor(gi / layout.columnsPerRow);
    const column = gi % layout.columnsPerRow;
    const x = layout.left + column * (layout.colWidth + layout.gap);
    const y = layout.top + row * (layout.groupHeight + layout.rowGap);
    context.fillStyle = phase === 'final' ? '#ffd77a' : '#9acaf3';
    context.font = '900 24px system-ui, sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.fillText(groupLabel(gi), x, y);
    members.forEach((member, mi) => {
      const cardY = y + layout.headerHeight + 10 + mi * (layout.cardHeight + layout.slotGap);
      const card = document.getElementById(`card-${gi}-${mi}`);
      const revealed = card?.classList.contains('revealed') ?? false;
      if (revealed) {
        drawRecordingCardFront(context, x, cardY, layout.colWidth, layout.cardHeight, member.name, member.ghost);
      } else {
        drawRecordingCardBack(context, x, cardY, layout.colWidth, layout.cardHeight);
      }
    });
  });

  context.restore();

  if (maxScroll > 0) {
    drawRecordingScrollIndicator(context, layout, scrollY, maxScroll);
  }
}

function getRecordingGroupLayout(canvasWidth: number, canvasHeight: number) {
  const left = 56;
  const top = 250;
  const gap = 16;
  const rowGap = 24;
  const usableWidth = canvasWidth - left * 2;
  const minColWidth = 150;
  const columnsPerRow = Math.max(
    1,
    Math.min(groups.length || 1, Math.floor((usableWidth + gap) / (minColWidth + gap)))
  );
  const colWidth = Math.floor((usableWidth - gap * (columnsPerRow - 1)) / columnsPerRow);
  const maxMembers = Math.max(1, ...groups.map((members) => members.length));
  const cardHeight = maxMembers > 8 ? 40 : maxMembers > 5 ? 46 : 58;
  const slotGap = maxMembers > 8 ? 6 : 8;
  const headerHeight = 34;
  const groupHeight = headerHeight + 10 + maxMembers * cardHeight + Math.max(0, maxMembers - 1) * slotGap;
  const rows = Math.ceil(groups.length / columnsPerRow);
  const viewportHeight = canvasHeight - top - 42;
  const contentHeight = rows * groupHeight + Math.max(0, rows - 1) * rowGap;

  return {
    left,
    top,
    gap,
    rowGap,
    usableWidth,
    columnsPerRow,
    colWidth,
    cardHeight,
    slotGap,
    headerHeight,
    groupHeight,
    rows,
    viewportHeight,
    contentHeight
  };
}

function getRecordingScrollY(maxScroll: number) {
  if (maxScroll <= 0 || teamRecordingStartedAt === 0) {
    return 0;
  }

  const elapsed = Math.max(0, Date.now() - teamRecordingStartedAt);
  const cycleDuration = Math.max(3500, Math.min(7500, maxScroll * 18));
  const cycle = (elapsed % (cycleDuration * 2)) / cycleDuration;
  const progress = cycle <= 1 ? cycle : 2 - cycle;
  return maxScroll * progress;
}

function drawRecordingScrollIndicator(
  context: CanvasRenderingContext2D,
  layout: ReturnType<typeof getRecordingGroupLayout>,
  scrollY: number,
  maxScroll: number,
) {
  const trackX = layout.left + layout.usableWidth + 14;
  const trackWidth = 8;
  context.fillStyle = 'rgba(228,240,255,0.14)';
  roundedCanvasRect(context, trackX, layout.top, trackWidth, layout.viewportHeight, 4);
  context.fill();

  const thumbHeight = Math.max(44, layout.viewportHeight * (layout.viewportHeight / layout.contentHeight));
  const thumbY = layout.top + (scrollY / maxScroll) * (layout.viewportHeight - thumbHeight);
  context.fillStyle = 'rgba(126,200,255,0.74)';
  roundedCanvasRect(context, trackX, thumbY, trackWidth, thumbHeight, 4);
  context.fill();

  context.fillStyle = 'rgba(216,236,255,0.72)';
  context.font = '700 19px system-ui, sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'bottom';
  context.fillText('아래 행까지 자동 스크롤 캡처 중', layout.left, context.canvas.height - 18);
}

function drawRecordingCardBack(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  context.fillStyle = '#102f5f';
  roundedCanvasRect(context, x, y, width, height, 12);
  context.fill();
  context.strokeStyle = '#2f78c8';
  context.lineWidth = 3;
  roundedCanvasRect(context, x + 2, y + 2, width - 4, height - 4, 10);
  context.stroke();
}

function drawRecordingCardFront(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  name: string,
  ghost: boolean,
) {
  context.fillStyle = ghost ? 'rgba(255,255,255,0.08)' : '#12365f';
  roundedCanvasRect(context, x, y, width, height, 12);
  context.fill();
  context.strokeStyle = ghost ? 'rgba(255,255,255,0.24)' : '#4fa5f4';
  context.lineWidth = 3;
  roundedCanvasRect(context, x + 2, y + 2, width - 4, height - 4, 10);
  context.stroke();
  context.fillStyle = ghost ? 'rgba(228,240,255,0.45)' : '#f0f9ff';
  const fontSize = Math.max(16, Math.min(24, height * 0.42));
  context.font = `800 ${fontSize}px system-ui, sans-serif`;
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillText(fitRecordingText(context, name, width - 28), x + 16, y + height / 2);
}

function roundedCanvasRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function fitRecordingText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) {
    return text;
  }

  let end = text.length;
  while (end > 1 && context.measureText(`${text.slice(0, end)}...`).width > maxWidth) {
    end -= 1;
  }
  return `${text.slice(0, end)}...`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function makeDownloadFilename(kind: string, extension: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `toris-arcade-team-${kind}-${timestamp}.${extension}`;
}

// ── Copy ──────────────────────────────────────
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
