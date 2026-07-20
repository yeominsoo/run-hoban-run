import './gomoku.css';
import '../../shared/ws-ranking.css';
import { prepareRoomInviteEntry, ROOM_SHARE_RETURN_EVENT, shareRoomLink } from '../../shared/share';
import { createChatWidget } from '../../shared/chat-widget';
import { setupWsRankingUI } from '../../shared/ws-ranking';
import { handIcon, hiddenHandIcon, CHOICE_LABEL, type Choice } from '../../shared/hand-icons';

type Phase =
  | 'entry' | 'connecting' | 'waiting-opponent' | 'countdown'
  | 'deciding' | 'playing' | 'game_over'
  | 'reconnecting' | 'error';

type PendingAction = { kind: 'create' } | { kind: 'join'; roomCode: string } | { kind: 'rejoin' };
type Stone = 'black' | 'white' | null;

const SIZE = 15;

const WS_URL = (() => {
  const c = import.meta.env.VITE_GOMOKU_WS_URL as string | undefined;
  if (c) return c;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8787/gomoku`;
})();

const NAME_KEY = 'run-hoban-run:gomoku-nickname';
const SESSION_KEY = 'run-hoban-run:gomoku-session';
const RECONNECT_RETRY_MS = 2000;
const RECONNECT_MAX = 24;

interface SavedSession { roomCode: string; token: string; name: string; }

function saveSession() {
  if (!myToken || !roomCode) return;
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

let phase: Phase = 'entry';
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

let myColor: 'black' | 'white' = 'black';
let board: Stone[][] = [];
let turn: 'black' | 'white' = 'black';
let blackName = '';
let whiteName = '';
let turnTimeoutMs = 30000;
let turnDeadlineClient = 0;
let lastMove: { row: number; col: number } | null = null;
let countdownInterval: ReturnType<typeof setInterval> | null = null;
let turnTimerInterval: ReturnType<typeof setInterval> | null = null;

// ── 선공(흑) 결정전 상태 ──────────────────────────────────────────
let decideAToken = '';
let decideAName = '';
let decideBName = '';
let myDecideChoice: Choice | null = null;

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

<div class="gm-shell">
  <div class="gm-top-bar">
    <a class="back-link" href="/">← 게임 선택</a>
    <button class="ws-ranking-btn" id="ws-ranking-btn" type="button">🏆 이번 주 랭킹</button>
  </div>
  <div class="gm-stage">
    <h1 class="gm-title">오목</h1>
    <p class="gm-sub">1:1 실시간 대결! 가로·세로·대각선 어디든 내 돌을 5개 이상 먼저 이으면 승리.</p>

    <!-- Entry -->
    <div class="gm-panel" id="entry-panel">
      <div class="resume-banner hidden" id="resume-banner">
        <p class="status-text" id="resume-text">이전에 참여하던 대결이 있어요.</p>
        <div class="resume-actions">
          <button id="resume-btn" type="button" class="gm-btn primary">재입장하기</button>
          <button id="resume-dismiss-btn" type="button" class="gm-btn secondary">새로 시작</button>
        </div>
      </div>

      <label class="field-label" for="nickname">닉네임</label>
      <input id="nickname" type="text" maxlength="20" placeholder="닉네임을 입력하세요" class="nickname-input" />

      <div class="entry-tabs" role="tablist">
        <button id="tab-create" type="button" class="entry-tab active" role="tab">방 만들기</button>
        <button id="tab-join" type="button" class="entry-tab" role="tab">방 참가하기</button>
      </div>

      <div class="entry-section" id="create-section">
        <button id="create-btn" type="button" class="gm-btn primary">방 만들기</button>
      </div>

      <div class="entry-section hidden" id="join-section">
        <label class="field-label" for="room-code-input">방 코드</label>
        <input id="room-code-input" type="text" maxlength="6" placeholder="예: 3F9A2C" class="nickname-input room-code-input" />
        <button id="join-btn" type="button" class="gm-btn primary">참가하기</button>
      </div>

      <div class="how-to-play">
        <p class="how-to-play-title">🎮 게임 방법</p>
        <ul class="how-to-play-list">
          <li>방을 만들거나 참가하면 상대가 들어오는 즉시 대결이 시작돼요. 가위바위보(단판)로 흑(선공)을 정해요.</li>
          <li>번갈아 가며 빈 칸에 돌을 놓아 가로·세로·대각선 중 한 방향으로 5개 이상 이으면 승리해요.</li>
          <li>30초 안에 두지 않으면 서버가 대신 빈 칸에 둬요. 판이 가득 차면 무승부!</li>
        </ul>
      </div>

      <p class="entry-error hidden" id="entry-error"></p>
    </div>

    <!-- Waiting / reconnecting -->
    <div class="gm-panel hidden" id="waiting-panel">
      <div class="spinner" aria-hidden="true"></div>
      <p class="status-text" id="waiting-status">서버에 연결하는 중…</p>
      <button id="cancel-btn" type="button" class="gm-btn secondary">취소</button>
    </div>

    <!-- Waiting for opponent -->
    <div class="gm-panel hidden" id="waiting-opponent-panel">
      <div class="room-share" id="lobby-share">
        <span class="room-share-label">방 코드</span>
        <span class="room-code-display" id="lobby-code-display"></span>
        <button id="lobby-copy-btn" type="button" class="gm-btn secondary">공유하기</button>
      </div>
      <div class="spinner" aria-hidden="true"></div>
      <p class="status-text">상대가 들어오면 자동으로 시작해요…</p>
      <button id="waiting-opponent-cancel-btn" type="button" class="gm-btn secondary">나가기</button>
    </div>

    <!-- Countdown -->
    <div class="gm-panel hidden" id="countdown-panel">
      <p class="status-text">곧 대결이 시작됩니다!</p>
      <div class="ws-countdown-number" id="countdown-number">3</div>
    </div>

    <!-- 선공(흑) 결정전 -->
    <div class="gm-panel hidden" id="deciding-panel">
      <p class="status-text">선공(흑)을 가리는 가위바위보! 단판승부예요.</p>
      <div class="decide-names">
        <span class="decide-name" id="decide-a-name"></span>
        <span class="vs-mark">VS</span>
        <span class="decide-name" id="decide-b-name"></span>
      </div>
      <div class="decide-hands">
        <div class="hand-slot mine" id="decide-my-hand">${hiddenHandIcon()}</div>
        <div class="hand-slot theirs" id="decide-opp-hand">${hiddenHandIcon()}</div>
      </div>
      <p class="decide-status" id="decide-status">가위바위보를 선택하세요!</p>
      <div class="decide-choice-row" id="decide-choice-row">
        <button class="decide-choice-btn" data-choice="rock" type="button">${handIcon('rock', true)}<span>${CHOICE_LABEL.rock}</span></button>
        <button class="decide-choice-btn" data-choice="scissors" type="button">${handIcon('scissors', true)}<span>${CHOICE_LABEL.scissors}</span></button>
        <button class="decide-choice-btn" data-choice="paper" type="button">${handIcon('paper', true)}<span>${CHOICE_LABEL.paper}</span></button>
      </div>
    </div>

    <!-- Playing -->
    <div class="gm-panel wide hidden" id="playing-panel">
      <div class="gm-scores-row">
        <span class="gm-score-tag black" id="black-name-tag">● 호스트</span>
        <span class="gm-score-tag white" id="white-name-tag">○ 게스트</span>
      </div>
      <p class="gm-turn-msg" id="turn-msg"></p>
      <div class="gm-timer-track"><div class="gm-timer-fill" id="timer-fill" style="width:100%"></div></div>
      <div class="gm-board-wrap">
        <div class="gm-board" id="gm-board"></div>
      </div>
    </div>

    <!-- Game over -->
    <div class="gm-panel hidden" id="game-over-panel">
      <p class="set-over-result" id="game-over-banner"></p>
      <button id="game-over-leave-btn" type="button" class="gm-btn secondary">나가기</button>
    </div>

    <!-- Error -->
    <div class="gm-panel hidden" id="error-panel">
      <p class="status-text" id="error-text">게임 서버에 연결할 수 없습니다.</p>
      <button id="retry-btn" type="button" class="gm-btn primary">다시 시도</button>
    </div>
  </div>
</div>
`;

// ── Refs ──────────────────────────────────────────────────────────
setupWsRankingUI({
  gameKey: 'gomoku',
  gameTitle: '오목',
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
  entry: document.getElementById('entry-panel')!,
  waiting: document.getElementById('waiting-panel')!,
  waitingOpponent: document.getElementById('waiting-opponent-panel')!,
  countdown: document.getElementById('countdown-panel')!,
  deciding: document.getElementById('deciding-panel')!,
  playing: document.getElementById('playing-panel')!,
  gameOver: document.getElementById('game-over-panel')!,
  error: document.getElementById('error-panel')!,
};

const resumeBanner = document.getElementById('resume-banner')!;
const resumeText = document.getElementById('resume-text')!;
const resumeBtn = document.getElementById('resume-btn') as HTMLButtonElement;
const resumeDismissBtn = document.getElementById('resume-dismiss-btn') as HTMLButtonElement;
const nicknameInput = document.getElementById('nickname') as HTMLInputElement;
const tabCreate = document.getElementById('tab-create') as HTMLButtonElement;
const tabJoin = document.getElementById('tab-join') as HTMLButtonElement;
const createSection = document.getElementById('create-section')!;
const joinSection = document.getElementById('join-section')!;
const createBtn = document.getElementById('create-btn') as HTMLButtonElement;
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
const roomCodeInput = document.getElementById('room-code-input') as HTMLInputElement;
const entryError = document.getElementById('entry-error')!;

const waitingStatus = document.getElementById('waiting-status')!;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;

const lobbyCopyBtn = document.getElementById('lobby-copy-btn') as HTMLButtonElement;
const lobbyCodeDisplay = document.getElementById('lobby-code-display')!;
const waitingOpponentCancelBtn = document.getElementById('waiting-opponent-cancel-btn') as HTMLButtonElement;

const countdownNumber = document.getElementById('countdown-number')!;

const decideANameEl = document.getElementById('decide-a-name')!;
const decideBNameEl = document.getElementById('decide-b-name')!;
const decideMyHand = document.getElementById('decide-my-hand')!;
const decideOppHand = document.getElementById('decide-opp-hand')!;
const decideStatus = document.getElementById('decide-status')!;
const decideChoiceRow = document.getElementById('decide-choice-row')!;
const decideChoiceBtns = Array.from(decideChoiceRow.querySelectorAll<HTMLButtonElement>('.decide-choice-btn'));

const blackNameTag = document.getElementById('black-name-tag')!;
const whiteNameTag = document.getElementById('white-name-tag')!;
const turnMsg = document.getElementById('turn-msg')!;
const timerFill = document.getElementById('timer-fill')!;
const gmBoard = document.getElementById('gm-board')!;

const gameOverBanner = document.getElementById('game-over-banner')!;
const gameOverLeaveBtn = document.getElementById('game-over-leave-btn') as HTMLButtonElement;

const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;
const errorText = document.getElementById('error-text')!;

// ── Init ──────────────────────────────────────────────────────────
nicknameInput.value = localStorage.getItem(NAME_KEY) ?? '';

const roomFromUrl = new URLSearchParams(location.search).get('room');
if (roomFromUrl) {
  roomCodeInput.value = roomFromUrl.trim().toUpperCase().slice(0, 6);
  setTab('join');
  prepareRoomInviteEntry(roomCodeInput, joinBtn, roomFromUrl);
}

const resumableSession = loadSession();
if (resumableSession) {
  resumeText.textContent = `"${resumableSession.name}"님으로 참여하던 대결(${resumableSession.roomCode})이 있어요. 다시 들어가시겠어요?`;
  resumeBanner.classList.remove('hidden');
}

// 보드 칸을 미리 그려둔다(칸 자체는 고정, 돌만 바뀐다).
gmBoard.innerHTML = Array.from({ length: SIZE * SIZE }, (_, i) =>
  `<button type="button" class="gm-cell" data-row="${Math.floor(i / SIZE)}" data-col="${i % SIZE}"><span class="gm-stone"></span></button>`
).join('');
const cellEls = Array.from(gmBoard.querySelectorAll<HTMLButtonElement>('.gm-cell'));
cellEls.forEach((el) => {
  el.addEventListener('click', () => {
    if (phase !== 'playing' || turn !== myColor) return;
    const row = Number(el.dataset.row);
    const col = Number(el.dataset.col);
    if (board[row]?.[col]) return;
    send({ type: 'place', row, col });
  });
});

// ── UI helpers ────────────────────────────────────────────────────
function setTab(tab: 'create' | 'join') {
  tabCreate.classList.toggle('active', tab === 'create');
  tabJoin.classList.toggle('active', tab === 'join');
  createSection.classList.toggle('hidden', tab !== 'create');
  joinSection.classList.toggle('hidden', tab !== 'join');
  hideEntryError();
}
tabCreate.addEventListener('click', () => setTab('create'));
tabJoin.addEventListener('click', () => setTab('join'));

function clearCountdownInterval() {
  if (countdownInterval !== null) { clearInterval(countdownInterval); countdownInterval = null; }
}
function clearTurnTimerInterval() {
  if (turnTimerInterval !== null) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
}

function setPhase(next: Phase) {
  phase = next;
  const vis = (el: HTMLElement, show: boolean) => el.classList.toggle('hidden', !show);
  vis(panels.entry, next === 'entry');
  vis(panels.waiting, next === 'connecting' || next === 'reconnecting');
  vis(panels.waitingOpponent, next === 'waiting-opponent');
  vis(panels.countdown, next === 'countdown');
  vis(panels.deciding, next === 'deciding');
  vis(panels.playing, next === 'playing');
  vis(panels.gameOver, next === 'game_over');
  vis(panels.error, next === 'error');
  if (next !== 'countdown') clearCountdownInterval();
  if (next !== 'playing') clearTurnTimerInterval();
}

function setDecideButtonsEnabled(enabled: boolean) {
  decideChoiceBtns.forEach((btn) => { btn.disabled = !enabled; });
}
decideChoiceBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (phase !== 'deciding' || myDecideChoice) return;
    const choice = btn.dataset.choice as Choice;
    myDecideChoice = choice;
    setDecideButtonsEnabled(false);
    decideMyHand.innerHTML = handIcon(choice, true);
    decideStatus.textContent = '선택 완료! 상대를 기다리는 중…';
    send({ type: 'decide_choice', choice });
  });
});

function showEntryError(msg: string) { entryError.textContent = msg; entryError.classList.remove('hidden'); }
function hideEntryError() { entryError.classList.add('hidden'); }

async function copyLink(code: string, btn: HTMLButtonElement) {
  const link = `${location.origin}/gomoku/?room=${code}`;
  await shareRoomLink({ url: link, title: '오목 초대', text: `오목 대결 방(${code})에 초대할게요!`, btn });
}

// ── Networking ────────────────────────────────────────────────────
function connect(action: PendingAction) {
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
      send({ type: 'create', name: myName });
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
    const inGame = ['waiting-opponent', 'countdown', 'deciding', 'playing', 'reconnecting'].includes(phase);
    if (inGame) beginReconnect();
    else if (phase !== 'entry') {
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
  resetGameState();
  clearSession();
  setPhase('entry');
}

function resetGameState() {
  chatWidget.clearAll();
  lastMove = null;
}

function renderNames() {
  blackNameTag.textContent = `● ${blackName}`;
  whiteNameTag.textContent = `○ ${whiteName}`;
}

function renderBoard() {
  cellEls.forEach((el) => {
    const r = Number(el.dataset.row);
    const c = Number(el.dataset.col);
    const stone = el.querySelector('.gm-stone')!;
    const value = board[r]?.[c];
    stone.className = `gm-stone${value ? ` ${value}` : ''}`;
    el.classList.toggle('last-move', !!lastMove && lastMove.row === r && lastMove.col === c);
  });
}

function renderTurnMessage() {
  if (turn === myColor) {
    turnMsg.textContent = '내 차례예요! 돌을 놓을 칸을 탭하세요.';
    turnMsg.className = 'gm-turn-msg mine';
  } else {
    turnMsg.textContent = `${turn === 'black' ? blackName : whiteName}님 차례를 기다리는 중…`;
    turnMsg.className = 'gm-turn-msg';
  }
}

function startTurnTimerDisplay() {
  clearTurnTimerInterval();
  turnDeadlineClient = Date.now() + turnTimeoutMs;
  const tick = () => {
    const remaining = Math.max(0, turnDeadlineClient - Date.now());
    timerFill.style.width = `${Math.max(0, Math.min(100, (remaining / turnTimeoutMs) * 100))}%`;
    if (remaining <= 0) clearTurnTimerInterval();
  };
  tick();
  turnTimerInterval = setInterval(tick, 200);
}

// ── Server message handler ────────────────────────────────────────
function handleServerMessage(msg: any) {
  switch (msg.type) {

    case 'room_created':
      myToken = msg.token;
      roomCode = msg.roomCode;
      myColor = 'black';
      reconnectAttempts = 0;
      lobbyCodeDisplay.textContent = roomCode;
      setPhase('waiting-opponent');
      break;

    case 'joined':
      myToken = msg.token;
      roomCode = msg.roomCode;
      myColor = 'white';
      reconnectAttempts = 0;
      break;

    case 'opponent_joined':
      break;

    case 'rejoined': {
      reconnectAttempts = 0;
      myToken = msg.token ?? myToken;
      roomCode = msg.roomCode ?? roomCode;
      if (!msg.started) {
        setPhase('waiting-opponent');
        break;
      }
      const game = msg.game;
      myColor = game.myColor;
      board = game.board;
      turn = game.turn;
      blackName = game.blackName;
      whiteName = game.whiteName;
      renderNames();
      renderTurnMessage();
      renderBoard();
      startTurnTimerDisplay();
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

    case 'decide_start': {
      decideAToken = msg.playerAToken;
      decideAName = msg.playerAName;
      decideBName = msg.playerBName;
      myDecideChoice = null;
      decideANameEl.textContent = decideAName;
      decideBNameEl.textContent = decideBName;
      decideMyHand.innerHTML = hiddenHandIcon();
      decideOppHand.innerHTML = hiddenHandIcon();
      decideStatus.textContent = '가위바위보를 선택하세요!';
      setDecideButtonsEnabled(true);
      setPhase('deciding');
      break;
    }

    case 'decide_tie': {
      const myChoice = myToken === decideAToken ? msg.choiceA : msg.choiceB;
      const oppChoice = myToken === decideAToken ? msg.choiceB : msg.choiceA;
      decideMyHand.innerHTML = handIcon(myChoice, true);
      decideOppHand.innerHTML = handIcon(oppChoice, true);
      decideStatus.textContent = '비겼어요! 다시 선택하세요.';
      setTimeout(() => {
        if (phase !== 'deciding') return;
        myDecideChoice = null;
        decideMyHand.innerHTML = hiddenHandIcon();
        decideOppHand.innerHTML = hiddenHandIcon();
        decideStatus.textContent = '가위바위보를 선택하세요!';
        setDecideButtonsEnabled(true);
      }, 900);
      break;
    }

    case 'decide_result': {
      const myChoice = myToken === decideAToken ? msg.choiceA : msg.choiceB;
      const oppChoice = myToken === decideAToken ? msg.choiceB : msg.choiceA;
      decideMyHand.innerHTML = handIcon(myChoice, true);
      decideOppHand.innerHTML = handIcon(oppChoice, true);
      const iWon = msg.winnerToken === myToken;
      decideStatus.textContent = iWon ? `🏆 ${msg.winnerName}님 승리! 흑(선공)이에요.` : `${msg.winnerName}님 승리 — 흑(선공)이에요.`;
      setDecideButtonsEnabled(false);
      break;
    }

    case 'match_start': {
      board = msg.board;
      turn = msg.turn;
      blackName = msg.blackName;
      whiteName = msg.whiteName;
      turnTimeoutMs = msg.turnTimeoutMs ?? 30000;
      lastMove = null;
      renderNames();
      renderTurnMessage();
      renderBoard();
      startTurnTimerDisplay();
      setPhase('playing');
      break;
    }

    case 'move_made': {
      board = msg.board;
      lastMove = { row: msg.row, col: msg.col };
      renderBoard();
      if (msg.isAuto) {
        chatWidget.addMessage('general', { name: '알림', text: '시간 초과 — 서버가 자동으로 빈 칸에 뒀어요.', mine: false, system: true });
      }
      break;
    }

    case 'turn_change': {
      turn = msg.turn;
      turnTimeoutMs = msg.turnTimeoutMs ?? 30000;
      renderTurnMessage();
      startTurnTimerDisplay();
      break;
    }

    case 'chat_message':
      chatWidget.addMessage('general', { name: msg.name, text: msg.text, mine: msg.token === myToken });
      break;

    case 'game_over':
      renderGameOver(msg);
      break;

    case 'opponent_disconnected':
      break;

    case 'opponent_reconnected':
      break;

    case 'opponent_left':
      showError('상대가 대결을 나갔어요. 처음부터 다시 시작해주세요.');
      clearSession();
      break;

    case 'guest_left':
      setPhase('waiting-opponent');
      break;

    case 'host_left':
      showError('호스트가 방을 나가 대결이 종료됐어요.');
      clearSession();
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
        setPhase('entry');
      }
      break;

    default:
      break;
  }

  if (myToken && roomCode) saveSession();
}

function renderGameOver(msg: any) {
  const winnerToken: string | null = msg.winnerToken ?? null;
  const iWon = !!myToken && winnerToken === myToken;

  gameOverBanner.textContent = !winnerToken
    ? '무승부! 판이 가득 찼어요.'
    : iWon
      ? '🏆 승리! 5개를 먼저 이었어요!'
      : '패배! 상대가 먼저 5개를 이었어요.';
  gameOverBanner.className = 'set-over-result ' + (!winnerToken ? '' : iWon ? 'win' : 'lose');
  resetGameState();
  setPhase('game_over');
}

// ── Events ────────────────────────────────────────────────────────
resumeBtn.addEventListener('click', () => {
  const s = loadSession();
  if (!s) { resumeBanner.classList.add('hidden'); return; }
  myName = s.name;
  nicknameInput.value = s.name;
  localStorage.setItem(NAME_KEY, s.name);
  roomCode = s.roomCode;
  myToken = s.token;
  resumeBanner.classList.add('hidden');
  connect({ kind: 'rejoin' });
});

resumeDismissBtn.addEventListener('click', () => {
  clearSession();
  resumeBanner.classList.add('hidden');
});

function requireName(): string | null {
  const name = nicknameInput.value.trim().slice(0, 20);
  if (!name) { showEntryError('닉네임을 입력해주세요.'); return null; }
  myName = name;
  localStorage.setItem(NAME_KEY, name);
  return name;
}

createBtn.addEventListener('click', () => {
  if (!requireName()) return;
  connect({ kind: 'create' });
});

joinBtn.addEventListener('click', () => {
  if (!requireName()) return;
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) { showEntryError('방 코드를 입력해주세요.'); return; }
  connect({ kind: 'join', roomCode: code });
});

cancelBtn.addEventListener('click', leaveRoom);
waitingOpponentCancelBtn.addEventListener('click', leaveRoom);
gameOverLeaveBtn.addEventListener('click', leaveRoom);

lobbyCopyBtn.addEventListener('click', () => copyLink(roomCode, lobbyCopyBtn));

window.addEventListener(ROOM_SHARE_RETURN_EVENT, () => {
  if (!myToken || !roomCode || intentionalClose || reconnectTimer) return;
  if (socket?.readyState === WebSocket.OPEN) {
    socket.close(4000, 'resume-after-share');
  } else if (socket?.readyState !== WebSocket.CONNECTING) {
    beginReconnect();
  }
});

retryBtn.addEventListener('click', () => { if (pendingAction) connect(pendingAction); });

setPhase('entry');
