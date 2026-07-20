import './sum-ten-puzzle.css';
import '../../shared/ws-ranking.css';
import { onDrag, type PointerPos } from '../../shared/pointer';
import { loadBestScore, saveBestScore } from '../../shared/score-store';
import { setupRankingUI, resetRankingSubmission } from '../../shared/leaderboard';
import { prepareRoomInviteEntry, ROOM_SHARE_RETURN_EVENT, shareRoomLink } from '../../shared/share';
import { createChatWidget } from '../../shared/chat-widget';
import { setupWsRankingUI } from '../../shared/ws-ranking';

const GAME_SLUG = 'sum-ten-puzzle';
const ROWS = 8;
const COLS = 10;
const SOLO_ROUND_MS = 90000;

type Mode = 'solo' | 'multi';
type Phase =
  | 'mode-select' | 'connecting' | 'lobby' | 'countdown'
  | 'playing' | 'game_over'
  | 'reconnecting' | 'error';

type PendingAction = { kind: 'create'; capacity: number } | { kind: 'join'; roomCode: string } | { kind: 'rejoin' };

const WS_URL = (() => {
  const c = import.meta.env.VITE_SUM_TEN_PUZZLE_WS_URL as string | undefined;
  if (c) return c;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8787/sum-ten-puzzle`;
})();

const NAME_KEY = 'run-hoban-run:sum-ten-puzzle-nickname';
const SESSION_KEY = 'run-hoban-run:sum-ten-puzzle-session';
const RECONNECT_RETRY_MS = 2000;
const RECONNECT_MAX = 24;

interface SavedSession { roomCode: string; token: string; name: string; }

function saveSession() {
  if (mode !== 'multi' || !myToken || !roomCode) return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode, token: myToken, name: myName }));
  } catch { /* storage unavailable */ }
}
function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* storage unavailable */ }
}

let mode: Mode = 'solo';
let phase: Phase = 'mode-select';
let socket: WebSocket | null = null;
let myName = '';
let roomCode = '';
let myToken: string | null = null;
let pendingAction: PendingAction | null = null;
let intentionalClose = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const chatWidget = createChatWidget({
  channels: [{ id: 'general', label: '채팅' }],
  position: 'right',
  onSend: (_channelId, text) => send({ type: 'submit_chat', text }),
});

type BoardEntry = { token: string; name: string; score: number };

let grid: (number | null)[][] = [];
let score = 0;
let board: BoardEntry[] = [];
let roundEndsAtClient = 0;
let countdownInterval: ReturnType<typeof setInterval> | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;

// ── HTML ──────────────────────────────────────────────────────────
const app = document.getElementById('app')!;
app.innerHTML = `
<div class="ws-ranking-overlay hidden" id="ws-ranking-overlay" role="dialog" aria-modal="true" aria-label="이번 주 랭킹">
  <div class="ws-ranking-modal">
    <div class="ws-ranking-header">
      <h2 class="ws-ranking-title">🏆 이번 주 랭킹</h2>
      <button class="ws-ranking-close" id="ws-ranking-close" type="button" aria-label="닫기">✕</button>
    </div>
    <p class="ws-ranking-week" id="ws-ranking-week"></p>
    <div class="ws-ranking-tabs">
      <button class="ws-ranking-tab active" data-week="current" type="button">이번 주</button>
      <button class="ws-ranking-tab" data-week="prev" type="button">지난 주</button>
    </div>
    <div class="ws-ranking-body" id="ws-ranking-body">
      <div class="ws-ranking-loading"><div class="ws-ranking-spinner"></div></div>
    </div>
    <div class="ws-ranking-footer">
      <button class="ws-ranking-action-btn" id="ws-ranking-save-btn" type="button">이미지 저장</button>
      <button class="ws-ranking-action-btn hidden" id="ws-ranking-share-btn" type="button">공유하기</button>
    </div>
  </div>
</div>

<div class="st-shell">
  <div class="st-top-bar">
    <a class="back-link" href="/">← 게임 선택</a>
    <button class="ws-ranking-btn" id="ws-ranking-btn" type="button">🏆 이번 주 랭킹</button>
  </div>
  <div class="st-stage">
    <h1 class="st-title">합이 10 퍼즐</h1>
    <p class="st-sub">숫자 칸을 드래그로 사각형으로 묶어 합이 10이 되면 사라져요!</p>

    <!-- Mode select / entry -->
    <div class="st-panel" id="mode-select-panel">
      <div class="resume-banner hidden" id="resume-banner">
        <p class="status-text" id="resume-text">이전에 참여하던 방이 있어요.</p>
        <div class="resume-actions">
          <button id="resume-btn" type="button" class="st-btn primary">재입장하기</button>
          <button id="resume-dismiss-btn" type="button" class="st-btn secondary">새로 시작</button>
        </div>
      </div>

      <div class="entry-tabs" role="tablist">
        <button id="tab-solo" type="button" class="entry-tab active" role="tab">혼자 연습하기</button>
        <button id="tab-create" type="button" class="entry-tab" role="tab">방 만들기</button>
        <button id="tab-join" type="button" class="entry-tab" role="tab">방 참가하기</button>
      </div>

      <div class="entry-section" id="solo-section">
        <p class="status-text">${ROWS}×${COLS} 격자에서 90초 동안 최대한 많이 없애보세요. 최고 <strong id="solo-best">0</strong>개</p>
        <button id="solo-start-btn" type="button" class="st-btn primary">시작하기</button>
        <button id="view-ranking-btn" type="button" class="st-btn secondary">내 랭킹보기</button>
      </div>

      <div class="entry-section hidden" id="create-section">
        <label class="field-label" for="nickname-create">닉네임</label>
        <input id="nickname-create" type="text" maxlength="20" placeholder="닉네임을 입력하세요" class="nickname-input" />
        <label class="field-label" for="capacity-input">인원 수 (2~8)</label>
        <input id="capacity-input" type="number" min="2" max="8" value="6" class="nickname-input capacity-input" />
        <button id="create-btn" type="button" class="st-btn primary">방 만들기</button>
      </div>

      <div class="entry-section hidden" id="join-section">
        <label class="field-label" for="nickname-join">닉네임</label>
        <input id="nickname-join" type="text" maxlength="20" placeholder="닉네임을 입력하세요" class="nickname-input" />
        <label class="field-label" for="room-code-input">방 코드</label>
        <input id="room-code-input" type="text" maxlength="6" placeholder="예: 3F9A2C" class="nickname-input room-code-input" />
        <button id="join-btn" type="button" class="st-btn primary">참가하기</button>
      </div>

      <p class="entry-error hidden" id="entry-error"></p>
    </div>

    <!-- Waiting / reconnecting -->
    <div class="st-panel hidden" id="waiting-panel">
      <div class="spinner" aria-hidden="true"></div>
      <p class="status-text" id="waiting-status">서버에 연결하는 중…</p>
      <button id="cancel-btn" type="button" class="st-btn secondary">취소</button>
    </div>

    <!-- Lobby -->
    <div class="st-panel hidden" id="lobby-panel">
      <div class="room-share" id="lobby-share">
        <span class="room-share-label">방 코드</span>
        <span class="room-code-display" id="lobby-code-display"></span>
        <button id="lobby-copy-btn" type="button" class="st-btn secondary">공유하기</button>
      </div>
      <div class="lobby-players" id="lobby-players"></div>
      <div class="how-to-play">
        <p class="how-to-play-title">🎮 게임 방법</p>
        <ul class="how-to-play-list">
          <li>전원에게 똑같은 숫자 격자가 주어져요. 각자 자기 화면에서 따로 풀어요.</li>
          <li>드래그로 사각형 범위를 묶어서, 그 안의 숫자 합이 10이 되면 사라져요.</li>
          <li>90초 동안 가장 많은 칸을 없앤 사람이 1등!</li>
        </ul>
      </div>
      <p class="status-text" id="lobby-status">참가자를 기다리는 중…</p>
      <button id="start-btn" type="button" class="st-btn primary hidden">게임 시작</button>
      <button id="lobby-cancel-btn" type="button" class="st-btn secondary">나가기</button>
    </div>

    <!-- Countdown -->
    <div class="st-panel hidden" id="countdown-panel">
      <p class="status-text">곧 격자가 나타납니다! 사각형으로 묶을 준비를 하세요.</p>
      <div class="ws-countdown-number" id="countdown-number">3</div>
    </div>

    <!-- Playing -->
    <div class="st-panel wide hidden" id="playing-panel">
      <div class="st-timer-track"><div class="st-timer-fill" id="timer-fill" style="width:100%"></div></div>
      <div class="st-grid-wrap" id="grid-wrap">
        <canvas id="grid-canvas"></canvas>
      </div>
      <p class="st-my-stat" id="my-stat">내 점수: 0</p>
      <div class="st-board hidden" id="st-board"></div>
    </div>

    <!-- Game over -->
    <div class="st-panel hidden" id="game-over-panel">
      <p class="set-over-result" id="game-over-banner"></p>

      <div class="rank-entry-form hidden" id="rank-entry-form">
        <input id="rank-name-input" class="rank-name-input" type="text" maxlength="12" placeholder="닉네임" autocomplete="off" />
        <button id="rank-save-btn" class="rank-save-btn" type="button">기록 저장</button>
      </div>
      <p class="rank-saved-msg hidden" id="rank-saved-msg">저장했어요!</p>

      <div class="roles-list hidden" id="final-board"></div>
      <button id="game-over-leave-btn" type="button" class="st-btn secondary">나가기</button>
    </div>

    <!-- Error -->
    <div class="st-panel hidden" id="error-panel">
      <p class="status-text" id="error-text">게임 서버에 연결할 수 없습니다.</p>
      <button id="retry-btn" type="button" class="st-btn primary">다시 시도</button>
    </div>

    <div id="test-state" hidden></div>

    <!-- Solo local ranking -->
    <div class="overlay hidden" id="ranking-overlay">
      <div class="overlay-card">
        <h2>내 랭킹 (이 기기 기준)</h2>
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

// ── Refs ──────────────────────────────────────────────────────────
setupWsRankingUI({
  gameKey: 'sum-ten-puzzle',
  gameTitle: '합이 10 퍼즐',
  wsUrl: WS_URL,
  openBtn: document.getElementById('ws-ranking-btn') as HTMLButtonElement,
  overlay: document.getElementById('ws-ranking-overlay')!,
  closeBtn: document.getElementById('ws-ranking-close') as HTMLButtonElement,
  weekEl: document.getElementById('ws-ranking-week')!,
  tabBtns: Array.from(document.querySelectorAll<HTMLButtonElement>('.ws-ranking-tab')),
  bodyEl: document.getElementById('ws-ranking-body')!,
  saveImageBtn: document.getElementById('ws-ranking-save-btn') as HTMLButtonElement,
  shareImageBtn: document.getElementById('ws-ranking-share-btn') as HTMLButtonElement,
});

const panels = {
  modeSelect: document.getElementById('mode-select-panel')!,
  waiting: document.getElementById('waiting-panel')!,
  lobby: document.getElementById('lobby-panel')!,
  countdown: document.getElementById('countdown-panel')!,
  playing: document.getElementById('playing-panel')!,
  gameOver: document.getElementById('game-over-panel')!,
  error: document.getElementById('error-panel')!,
};

const resumeBanner = document.getElementById('resume-banner')!;
const resumeText = document.getElementById('resume-text')!;
const resumeBtn = document.getElementById('resume-btn') as HTMLButtonElement;
const resumeDismissBtn = document.getElementById('resume-dismiss-btn') as HTMLButtonElement;

const tabSolo = document.getElementById('tab-solo') as HTMLButtonElement;
const tabCreate = document.getElementById('tab-create') as HTMLButtonElement;
const tabJoin = document.getElementById('tab-join') as HTMLButtonElement;
const soloSection = document.getElementById('solo-section')!;
const createSection = document.getElementById('create-section')!;
const joinSection = document.getElementById('join-section')!;
const soloBestEl = document.getElementById('solo-best')!;
const soloStartBtn = document.getElementById('solo-start-btn') as HTMLButtonElement;
const nicknameCreateInput = document.getElementById('nickname-create') as HTMLInputElement;
const nicknameJoinInput = document.getElementById('nickname-join') as HTMLInputElement;
const capacityInput = document.getElementById('capacity-input') as HTMLInputElement;
const createBtn = document.getElementById('create-btn') as HTMLButtonElement;
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
const roomCodeInput = document.getElementById('room-code-input') as HTMLInputElement;
const entryError = document.getElementById('entry-error')!;

const waitingStatus = document.getElementById('waiting-status')!;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;

const lobbyCopyBtn = document.getElementById('lobby-copy-btn') as HTMLButtonElement;
const lobbyCodeDisplay = document.getElementById('lobby-code-display')!;
const lobbyPlayers = document.getElementById('lobby-players')!;
const lobbyStatus = document.getElementById('lobby-status')!;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const lobbyCancelBtn = document.getElementById('lobby-cancel-btn') as HTMLButtonElement;

const countdownNumber = document.getElementById('countdown-number')!;

const timerFill = document.getElementById('timer-fill')!;
const gridWrap = document.getElementById('grid-wrap')!;
const canvas = document.getElementById('grid-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const myStat = document.getElementById('my-stat')!;
const stBoard = document.getElementById('st-board')!;

const gameOverBanner = document.getElementById('game-over-banner')!;
const rankEntryForm = document.getElementById('rank-entry-form')!;
const rankNameInput = document.getElementById('rank-name-input') as HTMLInputElement;
const rankSaveBtn = document.getElementById('rank-save-btn') as HTMLButtonElement;
const rankSavedMsg = document.getElementById('rank-saved-msg')!;
const finalBoard = document.getElementById('final-board')!;
const gameOverLeaveBtn = document.getElementById('game-over-leave-btn') as HTMLButtonElement;

const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;
const errorText = document.getElementById('error-text')!;
const testStateEl = document.getElementById('test-state')!;

const viewRankingBtn = document.getElementById('view-ranking-btn') as HTMLButtonElement;
const rankingOverlay = document.getElementById('ranking-overlay')!;
const rankingList = document.getElementById('ranking-list')!;
const closeRankingBtn = document.getElementById('close-ranking-btn') as HTMLButtonElement;
const rankingSaveImageBtn = document.getElementById('ranking-save-image-btn') as HTMLButtonElement;
const rankingShareImageBtn = document.getElementById('ranking-share-image-btn') as HTMLButtonElement;

setupRankingUI(
  {
    gameSlug: GAME_SLUG,
    gameTitle: '합이 10 퍼즐',
    nameInput: rankNameInput,
    saveBtn: rankSaveBtn,
    savedMsg: rankSavedMsg,
    viewRankingBtn,
    rankingOverlay,
    rankingList,
    closeRankingBtn,
    rankingSaveImageBtn,
    rankingShareImageBtn,
  },
  () => score
);

// ── Init ──────────────────────────────────────────────────────────
soloBestEl.textContent = String(loadBestScore(GAME_SLUG));

const roomFromUrl = new URLSearchParams(location.search).get('room');
if (roomFromUrl) {
  roomCodeInput.value = roomFromUrl.trim().toUpperCase().slice(0, 6);
  setEntryTab('join');
  prepareRoomInviteEntry(roomCodeInput, joinBtn, roomFromUrl);
}

const resumableSession = loadSession();
if (resumableSession) {
  resumeText.textContent = `"${resumableSession.name}"님으로 참여하던 방(${resumableSession.roomCode})이 있어요. 다시 들어가시겠어요?`;
  resumeBanner.classList.remove('hidden');
}

// ── Entry tabs ────────────────────────────────────────────────────
function setEntryTab(tab: 'solo' | 'create' | 'join') {
  tabSolo.classList.toggle('active', tab === 'solo');
  tabCreate.classList.toggle('active', tab === 'create');
  tabJoin.classList.toggle('active', tab === 'join');
  soloSection.classList.toggle('hidden', tab !== 'solo');
  createSection.classList.toggle('hidden', tab !== 'create');
  joinSection.classList.toggle('hidden', tab !== 'join');
  hideEntryError();
}
tabSolo.addEventListener('click', () => setEntryTab('solo'));
tabCreate.addEventListener('click', () => setEntryTab('create'));
tabJoin.addEventListener('click', () => setEntryTab('join'));

function clearCountdownInterval() {
  if (countdownInterval !== null) { clearInterval(countdownInterval); countdownInterval = null; }
}
function clearTimerInterval() {
  if (timerInterval !== null) { clearInterval(timerInterval); timerInterval = null; }
}

function setPhase(next: Phase) {
  phase = next;
  const vis = (el: HTMLElement, show: boolean) => el.classList.toggle('hidden', !show);
  vis(panels.modeSelect, next === 'mode-select');
  vis(panels.waiting, next === 'connecting' || next === 'reconnecting');
  vis(panels.lobby, next === 'lobby');
  vis(panels.countdown, next === 'countdown');
  vis(panels.playing, next === 'playing');
  vis(panels.gameOver, next === 'game_over');
  vis(panels.error, next === 'error');
  stBoard.classList.toggle('hidden', mode !== 'multi');
  if (next !== 'countdown') clearCountdownInterval();
  if (next !== 'playing') clearTimerInterval();
  if (next === 'playing') resizeCanvas();
}

function showEntryError(msg: string) { entryError.textContent = msg; entryError.classList.remove('hidden'); }
function hideEntryError() { entryError.classList.add('hidden'); }

async function copyLink(code: string, btn: HTMLButtonElement) {
  const link = `${location.origin}/sum-ten-puzzle/?room=${code}`;
  await shareRoomLink({ url: link, title: '합이 10 퍼즐 초대', text: `합이 10 퍼즐 방(${code})에 초대할게요!`, btn });
}

// ── Grid rendering + drag-select ───────────────────────────────────
let cellSize = 0;
let dragState: { startRow: number; startCol: number; curRow: number; curCol: number } | null = null;

function resizeCanvas() {
  const rect = gridWrap.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  cellSize = Math.floor(rect.width / COLS);
  const width = cellSize * COLS;
  const height = cellSize * ROWS;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderGrid();
}
window.addEventListener('resize', () => { if (phase === 'playing') resizeCanvas(); });

function cellAt(pos: PointerPos): { row: number; col: number } {
  const col = Math.min(COLS - 1, Math.max(0, Math.floor(pos.x / cellSize)));
  const row = Math.min(ROWS - 1, Math.max(0, Math.floor(pos.y / cellSize)));
  return { row, col };
}

function selectionSum(): { cells: { row: number; col: number }[]; sum: number } {
  if (!dragState) return { cells: [], sum: 0 };
  const r0 = Math.min(dragState.startRow, dragState.curRow);
  const r1 = Math.max(dragState.startRow, dragState.curRow);
  const c0 = Math.min(dragState.startCol, dragState.curCol);
  const c1 = Math.max(dragState.startCol, dragState.curCol);
  const cells: { row: number; col: number }[] = [];
  let sum = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const v = grid[r]?.[c];
      if (v !== null && v !== undefined) {
        cells.push({ row: r, col: c });
        sum += v;
      }
    }
  }
  return { cells, sum };
}

function renderGrid() {
  if (!cellSize) return;
  const width = cellSize * COLS;
  const height = cellSize * ROWS;
  ctx.clearRect(0, 0, width, height);

  let selR0 = -1, selR1 = -1, selC0 = -1, selC1 = -1;
  if (dragState) {
    selR0 = Math.min(dragState.startRow, dragState.curRow);
    selR1 = Math.max(dragState.startRow, dragState.curRow);
    selC0 = Math.min(dragState.startCol, dragState.curCol);
    selC1 = Math.max(dragState.startCol, dragState.curCol);
  }
  const { sum } = dragState ? selectionSum() : { sum: 0 };
  const inSelection = (r: number, c: number) => dragState && r >= selR0 && r <= selR1 && c >= selC0 && c <= selC1;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const value = grid[r]?.[c];
      const x = c * cellSize;
      const y = r * cellSize;
      const pad = 2;
      const selected = inSelection(r, c);

      if (value !== null && value !== undefined) {
        ctx.fillStyle = selected ? (sum === 10 ? 'rgba(143,240,176,0.85)' : 'rgba(255,214,102,0.55)') : 'rgba(255,255,255,0.7)';
        ctx.strokeStyle = 'rgba(75,52,71,0.18)';
        ctx.lineWidth = 1;
        roundRect(x + pad, y + pad, cellSize - pad * 2, cellSize - pad * 2, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#4b3447';
        ctx.font = `700 ${Math.floor(cellSize * 0.42)}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(value), x + cellSize / 2, y + cellSize / 2 + 1);
      } else if (selected) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        roundRect(x + pad, y + pad, cellSize - pad * 2, cellSize - pad * 2, 6);
        ctx.fill();
      }
    }
  }

  if (dragState) {
    ctx.strokeStyle = sum === 10 ? '#4fae72' : 'rgba(75,52,71,0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(selC0 * cellSize + 1, selR0 * cellSize + 1, (selC1 - selC0 + 1) * cellSize - 2, (selR1 - selR0 + 1) * cellSize - 2);
  }

  testStateEl.dataset.grid = JSON.stringify(grid);
  testStateEl.dataset.score = String(score);
  testStateEl.dataset.cellSize = String(cellSize);
}

function roundRect(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

onDrag(canvas, {
  onStart: (pos) => {
    if (phase !== 'playing') return;
    const { row, col } = cellAt(pos);
    dragState = { startRow: row, startCol: col, curRow: row, curCol: col };
  },
  onMove: (pos) => {
    if (phase !== 'playing' || !dragState) return;
    const { row, col } = cellAt(pos);
    dragState.curRow = row;
    dragState.curCol = col;
    renderGrid();
  },
  onEnd: () => {
    if (phase !== 'playing' || !dragState) return;
    const { cells, sum } = selectionSum();
    dragState = null;
    if (cells.length > 0 && sum === 10) {
      for (const cell of cells) grid[cell.row][cell.col] = null;
      score += cells.length;
      myStat.textContent = `내 점수: ${score}`;
      if (mode === 'multi') send({ type: 'clear', cells });
    }
    renderGrid();
  },
});

// ── Solo flow ─────────────────────────────────────────────────────
function randCellValue(): number { return 1 + Math.floor(Math.random() * 9); }
function generateSoloGrid(): (number | null)[][] {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => randCellValue()));
}

function startSoloGame() {
  mode = 'solo';
  grid = generateSoloGrid();
  score = 0;
  myStat.textContent = '내 점수: 0';
  roundEndsAtClient = Date.now() + SOLO_ROUND_MS;
  setPhase('playing');
  startTimerDisplay(() => endSoloGame());
}

function endSoloGame() {
  clearTimerInterval();
  const isRecord = saveBestScore(GAME_SLUG, score);
  soloBestEl.textContent = String(loadBestScore(GAME_SLUG));
  gameOverBanner.textContent = `게임 종료! ${score}개를 없앴어요${isRecord ? ' — 신기록!' : ''}`;
  gameOverBanner.className = 'set-over-result ' + (isRecord ? 'win' : '');
  rankEntryForm.classList.remove('hidden');
  finalBoard.classList.add('hidden');
  resetRankingSubmission({ nameInput: rankNameInput, saveBtn: rankSaveBtn, savedMsg: rankSavedMsg });
  setPhase('game_over');
}

soloStartBtn.addEventListener('click', startSoloGame);

// ── Networking (multiplayer) ────────────────────────────────────────
function connect(action: PendingAction) {
  mode = 'multi';
  pendingAction = action;
  intentionalClose = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  if (action.kind !== 'rejoin') {
    hideEntryError();
    waitingStatus.textContent = '서버에 연결하는 중…';
    setPhase('connecting');
  }

  let ws: WebSocket;
  try { ws = new WebSocket(WS_URL); }
  catch { showError('게임 서버 주소가 올바르지 않습니다.'); return; }
  socket = ws;

  ws.addEventListener('open', () => {
    if (action.kind === 'create') {
      waitingStatus.textContent = '방을 만드는 중…';
      send({ type: 'create', name: myName, capacity: action.capacity });
    } else if (action.kind === 'join') {
      waitingStatus.textContent = '참가하는 중…';
      send({ type: 'join', name: myName, roomCode: action.roomCode });
    } else {
      send({ type: 'rejoin', roomCode, token: myToken });
    }
  });

  ws.addEventListener('message', (e) => {
    try { handleServerMessage(JSON.parse(e.data)); } catch { }
  });

  ws.addEventListener('close', () => {
    if (intentionalClose) return;
    const inGame = ['lobby', 'countdown', 'playing', 'reconnecting'].includes(phase);
    if (inGame) beginReconnect();
    else if (phase !== 'mode-select') {
      showError('서버와의 연결이 끊어졌습니다.');
    }
  });

  ws.addEventListener('error', () => {
    if (action.kind === 'rejoin') return;
    showError('게임 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
  });
}

function beginReconnect() {
  if (!myToken || !roomCode) { showError('서버와의 연결이 끊어졌습니다.'); return; }
  setPhase('reconnecting');
  reconnectAttempts++;
  waitingStatus.textContent = `연결이 끊어졌습니다. 재연결 중… (${reconnectAttempts}/${RECONNECT_MAX})`;
  if (reconnectAttempts > RECONNECT_MAX) {
    showError('연결을 복구하지 못했습니다. 처음부터 다시 시작해주세요.');
    return;
  }
  reconnectTimer = setTimeout(() => connect({ kind: 'rejoin' }), RECONNECT_RETRY_MS);
}

function send(payload: unknown) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function showError(message: string) {
  errorText.textContent = message;
  setPhase('error');
  socket?.close();
  socket = null;
}

function leaveRoom() {
  intentionalClose = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  send({ type: 'leave' });
  socket?.close();
  socket = null;
  myToken = null;
  roomCode = '';
  resetMultiState();
  clearSession();
  setPhase('mode-select');
}

function resetMultiState() {
  board = [];
  score = 0;
  roundEndsAtClient = 0;
  chatWidget.clearAll();
}

// ── Rendering helpers ─────────────────────────────────────────────
function renderLobbyPlayers(players: { name: string; isHost: boolean; connected: boolean }[]) {
  lobbyPlayers.innerHTML = players.map(p =>
    `<div class="lobby-player${p.connected ? '' : ' disconnected'}">
      <span class="lobby-name">${p.name}</span>
      ${p.isHost ? '<span class="lobby-badge host">호스트</span>' : ''}
      ${!p.connected ? '<span class="lobby-badge offline">연결 끊김</span>' : ''}
    </div>`
  ).join('');
}

function renderBoard() {
  const sorted = [...board].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score ?? 0;
  stBoard.innerHTML = sorted.map((p) => `
    <div class="st-board-row${p.token === myToken ? ' me' : ''}${topScore > 0 && p.score === topScore ? ' leader' : ''}">
      <span class="st-board-name">${p.name}${p.token === myToken ? ' (나)' : ''}</span>
      <span class="st-board-count">${p.score}개</span>
    </div>
  `).join('');
}

function startTimerDisplay(onExpire: () => void) {
  clearTimerInterval();
  const totalMs = roundEndsAtClient - Date.now();
  let expired = false;
  const tick = () => {
    const remaining = Math.max(0, roundEndsAtClient - Date.now());
    timerFill.style.width = `${Math.max(0, Math.min(100, (remaining / Math.max(1, totalMs)) * 100))}%`;
    if (remaining <= 0 && !expired) {
      expired = true;
      clearTimerInterval();
      if (mode === 'solo') onExpire();
    }
  };
  tick();
  timerInterval = setInterval(tick, 200);
}

// ── Server message handler ────────────────────────────────────────
function handleServerMessage(msg: any) {
  switch (msg.type) {

    case 'room_created':
      myToken = msg.token;
      roomCode = msg.roomCode;
      reconnectAttempts = 0;
      lobbyCodeDisplay.textContent = roomCode;
      lobbyStatus.textContent = '참가자를 기다리는 중…';
      lobbyPlayers.innerHTML = `<div class="lobby-player"><span class="lobby-name">${myName}</span><span class="lobby-badge host">호스트</span></div>`;
      startBtn.classList.add('hidden');
      setPhase('lobby');
      break;

    case 'joined_lobby':
      myToken = msg.token;
      roomCode = msg.roomCode;
      reconnectAttempts = 0;
      lobbyCodeDisplay.textContent = roomCode;
      startBtn.classList.add('hidden');
      setPhase('lobby');
      break;

    case 'lobby_update': {
      roomCode = msg.roomCode ?? roomCode;
      lobbyCodeDisplay.textContent = roomCode;
      const players = msg.players as { name: string; isHost: boolean; connected: boolean }[];
      const connectedCount = players.filter(p => p.connected).length;
      renderLobbyPlayers(players);
      if (msg.canStart) {
        startBtn.classList.remove('hidden');
        lobbyStatus.textContent = `${connectedCount}명 입장 — 시작할 준비가 됐어요! (최소 2명)`;
      } else {
        startBtn.classList.add('hidden');
        lobbyStatus.textContent = msg.isHost
          ? `현재 ${connectedCount}명 입장 중 — 최소 2명이 필요해요…`
          : `현재 ${connectedCount}명 입장 중 — 호스트가 시작하기를 기다리는 중…`;
      }
      break;
    }

    case 'rejoined': {
      reconnectAttempts = 0;
      myToken = msg.token ?? myToken;
      roomCode = msg.roomCode ?? roomCode;
      if (!msg.started || msg.phase === 'lobby') {
        lobbyCodeDisplay.textContent = roomCode;
        renderLobbyPlayers(msg.players ?? []);
        setPhase('lobby');
        break;
      }
      const game = msg.game;
      grid = game?.grid ?? grid;
      board = game?.board ?? [];
      score = game?.myScore ?? 0;
      roundEndsAtClient = Date.now() + (game?.remainingMs ?? 0);
      myStat.textContent = `내 점수: ${score}`;
      renderBoard();
      startTimerDisplay(() => {});
      setPhase('playing');
      break;
    }

    case 'game_starting': {
      const seconds = Math.ceil((msg.countdownMs ?? 3000) / 1000);
      let remaining = seconds;
      countdownNumber.textContent = String(remaining);
      setPhase('countdown');
      clearCountdownInterval();
      countdownInterval = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) { clearCountdownInterval(); return; }
        countdownNumber.textContent = String(remaining);
      }, 1000);
      break;
    }

    case 'round_start': {
      grid = msg.grid;
      board = msg.board ?? [];
      score = 0;
      roundEndsAtClient = Date.now() + (msg.durationMs ?? 90000);
      myStat.textContent = '내 점수: 0';
      renderBoard();
      startTimerDisplay(() => {});
      setPhase('playing');
      break;
    }

    case 'clear_result':
      // 서버가 최종 랭킹 계산의 권위 있는 출처 — 클라이언트는 이미 낙관적으로 반영했으므로
      // ok:false(드문 불일치)일 때만 자기 점수를 서버 기준으로 되돌린다.
      if (!msg.ok) { /* 드문 불일치 — 다음 progress_update로 자연히 동기화됨 */ }
      break;

    case 'progress_update':
      board = msg.board ?? [];
      renderBoard();
      break;

    case 'chat_message':
      chatWidget.addMessage('general', { name: msg.name, text: msg.text, mine: msg.token === myToken });
      break;

    case 'game_over':
      renderMultiGameOver(msg);
      break;

    case 'player_disconnected':
      break;

    case 'player_reconnected':
      break;

    case 'error':
      if (phase === 'reconnecting') {
        showError(msg.message ?? '재연결에 실패했습니다.');
        clearSession();
      } else {
        showEntryError(msg.message ?? '방에 참가할 수 없습니다.');
        socket?.close();
        socket = null;
        if (pendingAction?.kind === 'rejoin') clearSession();
        setPhase('mode-select');
      }
      break;

    default:
      break;
  }

  saveSession();
}

function renderMultiGameOver(msg: any) {
  const winnerToken: string | null = msg.winnerToken ?? null;
  const winnerName: string | null = msg.winnerName ?? null;
  const iWon = !!myToken && winnerToken === myToken;

  gameOverBanner.textContent = !winnerToken
    ? '아무도 점수를 얻지 못했어요!'
    : iWon
      ? '🏆 우승! 가장 많이 없앴어요!'
      : `🏆 ${winnerName}님 우승!`;
  gameOverBanner.className = 'set-over-result ' + (iWon ? 'win' : winnerToken ? 'lose' : '');

  rankEntryForm.classList.add('hidden');
  const results = (msg.results as { token: string; name: string; rank: number; score: number }[]) ?? [];
  finalBoard.classList.remove('hidden');
  finalBoard.innerHTML = results
    .map((r) => `<div class="scores-row${r.token === myToken ? ' me' : ''}">
      <span>${r.rank}위 ${r.name}</span>
      <span>${r.score}개</span>
    </div>`)
    .join('') || '<div class="scores-row"><span>결과 없음</span></div>';
  resetMultiState();
  setPhase('game_over');
}

// ── Events ────────────────────────────────────────────────────────
resumeBtn.addEventListener('click', () => {
  const s = loadSession();
  if (!s) { resumeBanner.classList.add('hidden'); return; }
  myName = s.name;
  roomCode = s.roomCode;
  myToken = s.token;
  resumeBanner.classList.add('hidden');
  connect({ kind: 'rejoin' });
});

resumeDismissBtn.addEventListener('click', () => {
  clearSession();
  resumeBanner.classList.add('hidden');
});

function requireName(input: HTMLInputElement): string | null {
  const name = input.value.trim().slice(0, 20);
  if (!name) { showEntryError('닉네임을 입력해주세요.'); return null; }
  myName = name;
  localStorage.setItem(NAME_KEY, name);
  return name;
}

nicknameCreateInput.value = localStorage.getItem(NAME_KEY) ?? '';
nicknameJoinInput.value = localStorage.getItem(NAME_KEY) ?? '';

createBtn.addEventListener('click', () => {
  if (!requireName(nicknameCreateInput)) return;
  const capacity = Math.min(Math.max(Number(capacityInput.value) || 6, 2), 8);
  connect({ kind: 'create', capacity });
});

joinBtn.addEventListener('click', () => {
  if (!requireName(nicknameJoinInput)) return;
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) { showEntryError('방 코드를 입력해주세요.'); return; }
  connect({ kind: 'join', roomCode: code });
});

cancelBtn.addEventListener('click', leaveRoom);
lobbyCancelBtn.addEventListener('click', leaveRoom);
gameOverLeaveBtn.addEventListener('click', () => {
  if (mode === 'multi') { leaveRoom(); return; }
  setPhase('mode-select');
});

lobbyCopyBtn.addEventListener('click', () => copyLink(roomCode, lobbyCopyBtn));

window.addEventListener(ROOM_SHARE_RETURN_EVENT, () => {
  if (!myToken || !roomCode || intentionalClose || reconnectTimer) return;
  if (socket?.readyState === WebSocket.OPEN) {
    socket.close(4000, 'resume-after-share');
  } else if (socket?.readyState !== WebSocket.CONNECTING) {
    beginReconnect();
  }
});

startBtn.addEventListener('click', () => { send({ type: 'start' }); });

retryBtn.addEventListener('click', () => { if (pendingAction) connect(pendingAction); });

setPhase('mode-select');
