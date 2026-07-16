import './color-instruction.css';
import '../../shared/ws-ranking.css';
import { shareRoomLink } from '../../shared/share';
import { createChatWidget } from '../../shared/chat-widget';
import { setupWsRankingUI } from '../../shared/ws-ranking';

type Phase =
  | 'entry' | 'connecting' | 'lobby' | 'countdown'
  | 'playing' | 'game_over'
  | 'reconnecting' | 'error';

type PendingAction = { kind: 'create'; capacity: number } | { kind: 'join'; roomCode: string } | { kind: 'rejoin' };

const WS_URL = (() => {
  const c = import.meta.env.VITE_COLOR_INSTRUCTION_WS_URL as string | undefined;
  if (c) return c;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8787/color-instruction`;
})();

const NAME_KEY = 'run-hoban-run:color-instruction-nickname';
const SESSION_KEY = 'run-hoban-run:color-instruction-session';
const RECONNECT_RETRY_MS = 2000;
const RECONNECT_MAX = 24;

const COLOR_LABELS: Record<string, string> = { red: '빨강', blue: '파랑', green: '초록', yellow: '노랑' };
const COLOR_HEX: Record<string, string> = { red: '#e5484d', blue: '#3b82f6', green: '#22c55e', yellow: '#f2c94c' };

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

type BoardEntry = { token: string; name: string; correctCount: number };

let colorList: string[] = ['red', 'blue', 'green', 'yellow'];
let board: BoardEntry[] = [];
let myCorrectCount = 0;
let roundEndsAtClient = 0;
let answeredThisProblem = false;
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

<div class="ci-shell">
  <div class="ci-top-bar">
    <a class="back-link" href="/">← 게임 선택</a>
    <button class="ws-ranking-btn" id="ws-ranking-btn" type="button">🏆 이번 주 랭킹</button>
  </div>
  <div class="ci-stage">
    <h1 class="ci-title">컬러 지시 게임</h1>
    <p class="ci-sub">글자의 뜻이 아니라, 실제로 보이는 색을 고르세요!</p>

    <!-- Entry -->
    <div class="ci-panel" id="entry-panel">
      <div class="resume-banner hidden" id="resume-banner">
        <p class="status-text" id="resume-text">이전에 참여하던 방이 있어요.</p>
        <div class="resume-actions">
          <button id="resume-btn" type="button" class="ci-btn primary">재입장하기</button>
          <button id="resume-dismiss-btn" type="button" class="ci-btn secondary">새로 시작</button>
        </div>
      </div>

      <label class="field-label" for="nickname">닉네임</label>
      <input id="nickname" type="text" maxlength="20" placeholder="닉네임을 입력하세요" class="nickname-input" />

      <div class="entry-tabs" role="tablist">
        <button id="tab-create" type="button" class="entry-tab active" role="tab">방 만들기</button>
        <button id="tab-join" type="button" class="entry-tab" role="tab">방 참가하기</button>
      </div>

      <div class="entry-section" id="create-section">
        <label class="field-label" for="capacity-input">인원 수 (2~8)</label>
        <input id="capacity-input" type="number" min="2" max="8" value="6" class="nickname-input capacity-input" />
        <button id="create-btn" type="button" class="ci-btn primary">방 만들기</button>
      </div>

      <div class="entry-section hidden" id="join-section">
        <label class="field-label" for="room-code-input">방 코드</label>
        <input id="room-code-input" type="text" maxlength="6" placeholder="예: 3F9A2C" class="nickname-input room-code-input" />
        <button id="join-btn" type="button" class="ci-btn primary">참가하기</button>
      </div>

      <p class="entry-error hidden" id="entry-error"></p>
    </div>

    <!-- Waiting / reconnecting -->
    <div class="ci-panel hidden" id="waiting-panel">
      <div class="spinner" aria-hidden="true"></div>
      <p class="status-text" id="waiting-status">서버에 연결하는 중…</p>
      <button id="cancel-btn" type="button" class="ci-btn secondary">취소</button>
    </div>

    <!-- Lobby -->
    <div class="ci-panel hidden" id="lobby-panel">
      <div class="room-share" id="lobby-share">
        <span class="room-share-label">방 코드</span>
        <span class="room-code-display" id="lobby-code-display"></span>
        <button id="lobby-copy-btn" type="button" class="ci-btn secondary">공유하기</button>
      </div>
      <div class="lobby-players" id="lobby-players"></div>
      <div class="how-to-play">
        <p class="how-to-play-title">🎮 게임 방법</p>
        <ul class="how-to-play-list">
          <li>화면에 색 이름 글자가 뜨는데, 글자 색과 뜻이 다를 수 있어요(예: 빨간색으로
            쓰인 "파랑").</li>
          <li>글자의 <strong>뜻이 아니라 실제로 보이는 색</strong>과 같은 버튼을 탭하세요.</li>
          <li>2.2초마다 새 문제가 나오고, 가장 많이·빠르게 맞힌 사람이 1등!</li>
        </ul>
      </div>
      <p class="status-text" id="lobby-status">참가자를 기다리는 중…</p>
      <button id="start-btn" type="button" class="ci-btn primary hidden">게임 시작</button>
      <button id="lobby-cancel-btn" type="button" class="ci-btn secondary">나가기</button>
    </div>

    <!-- Countdown -->
    <div class="ci-panel hidden" id="countdown-panel">
      <p class="status-text">곧 문제가 출제됩니다! 뜻이 아니라 색을 보세요.</p>
      <div class="ws-countdown-number" id="countdown-number">3</div>
    </div>

    <!-- Playing -->
    <div class="ci-panel wide hidden" id="playing-panel">
      <div class="ci-timer-track"><div class="ci-timer-fill" id="timer-fill" style="width:100%"></div></div>
      <p class="ci-problem" id="problem-display">?</p>
      <div class="ci-choice-row" id="choice-row"></div>
      <p class="ci-my-stat" id="my-stat">내 정답 수: 0</p>
      <div class="ci-board" id="ci-board"></div>
    </div>

    <!-- Game over -->
    <div class="ci-panel hidden" id="game-over-panel">
      <p class="set-over-result" id="game-over-banner"></p>
      <div class="roles-list" id="final-board"></div>
      <button id="game-over-leave-btn" type="button" class="ci-btn secondary">나가기</button>
    </div>

    <!-- Error -->
    <div class="ci-panel hidden" id="error-panel">
      <p class="status-text" id="error-text">게임 서버에 연결할 수 없습니다.</p>
      <button id="retry-btn" type="button" class="ci-btn primary">다시 시도</button>
    </div>
  </div>
</div>
`;

// ── Refs ──────────────────────────────────────────────────────────
setupWsRankingUI({
  gameKey: 'color-instruction',
  gameTitle: '컬러 지시 게임',
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
const nicknameInput = document.getElementById('nickname') as HTMLInputElement;
const tabCreate = document.getElementById('tab-create') as HTMLButtonElement;
const tabJoin = document.getElementById('tab-join') as HTMLButtonElement;
const createSection = document.getElementById('create-section')!;
const joinSection = document.getElementById('join-section')!;
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
const problemDisplay = document.getElementById('problem-display')!;
const choiceRow = document.getElementById('choice-row')!;
const myStat = document.getElementById('my-stat')!;
const ciBoard = document.getElementById('ci-board')!;

const gameOverBanner = document.getElementById('game-over-banner')!;
const finalBoard = document.getElementById('final-board')!;
const gameOverLeaveBtn = document.getElementById('game-over-leave-btn') as HTMLButtonElement;

const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;
const errorText = document.getElementById('error-text')!;

// ── Init ──────────────────────────────────────────────────────────
nicknameInput.value = localStorage.getItem(NAME_KEY) ?? '';

const roomFromUrl = new URLSearchParams(location.search).get('room');
if (roomFromUrl) {
  roomCodeInput.value = roomFromUrl.trim().toUpperCase().slice(0, 6);
  setTab('join');
}

const resumableSession = loadSession();
if (resumableSession) {
  resumeText.textContent = `"${resumableSession.name}"님으로 참여하던 방(${resumableSession.roomCode})이 있어요. 다시 들어가시겠어요?`;
  resumeBanner.classList.remove('hidden');
}

function renderChoiceButtons() {
  choiceRow.innerHTML = colorList.map((c) =>
    `<button type="button" class="ci-choice-btn" data-color="${c}" style="background:${COLOR_HEX[c]}"></button>`
  ).join('');
  Array.from(choiceRow.querySelectorAll<HTMLButtonElement>('.ci-choice-btn')).forEach((btn) => {
    btn.addEventListener('click', () => submitAnswer(btn.dataset.color!));
  });
}
renderChoiceButtons();

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
function clearTimerInterval() {
  if (timerInterval !== null) { clearInterval(timerInterval); timerInterval = null; }
}

function setPhase(next: Phase) {
  phase = next;
  const vis = (el: HTMLElement, show: boolean) => el.classList.toggle('hidden', !show);
  vis(panels.entry, next === 'entry');
  vis(panels.waiting, next === 'connecting' || next === 'reconnecting');
  vis(panels.lobby, next === 'lobby');
  vis(panels.countdown, next === 'countdown');
  vis(panels.playing, next === 'playing');
  vis(panels.gameOver, next === 'game_over');
  vis(panels.error, next === 'error');
  if (next !== 'countdown') clearCountdownInterval();
  if (next !== 'playing') clearTimerInterval();
}

function showEntryError(msg: string) { entryError.textContent = msg; entryError.classList.remove('hidden'); }
function hideEntryError() { entryError.classList.add('hidden'); }

async function copyLink(code: string, btn: HTMLButtonElement) {
  const link = `${location.origin}/color-instruction/?room=${code}`;
  await shareRoomLink({ url: link, title: '컬러 지시 게임 초대', text: `컬러 지시 게임 방(${code})에 초대할게요!`, btn });
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
  board = [];
  myCorrectCount = 0;
  roundEndsAtClient = 0;
  answeredThisProblem = false;
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
  const sorted = [...board].sort((a, b) => b.correctCount - a.correctCount);
  const topScore = sorted[0]?.correctCount ?? 0;
  ciBoard.innerHTML = sorted.map((p) => `
    <div class="ci-board-row${p.token === myToken ? ' me' : ''}${topScore > 0 && p.correctCount === topScore ? ' leader' : ''}">
      <span class="ci-board-name">${p.name}${p.token === myToken ? ' (나)' : ''}</span>
      <span class="ci-board-count">${p.correctCount}개</span>
    </div>
  `).join('');
}

function startTimerDisplay() {
  clearTimerInterval();
  const totalMs = roundEndsAtClient - Date.now();
  const tick = () => {
    const remaining = Math.max(0, roundEndsAtClient - Date.now());
    timerFill.style.width = `${Math.max(0, Math.min(100, (remaining / Math.max(1, totalMs)) * 100))}%`;
    if (remaining <= 0) clearTimerInterval();
  };
  tick();
  timerInterval = setInterval(tick, 200);
}

function showProblem(word: string, displayColor: string) {
  answeredThisProblem = false;
  problemDisplay.textContent = COLOR_LABELS[word] ?? word;
  problemDisplay.style.color = COLOR_HEX[displayColor] ?? '#000';
  problemDisplay.className = 'ci-problem';
  Array.from(choiceRow.querySelectorAll<HTMLButtonElement>('.ci-choice-btn')).forEach((btn) => { btn.disabled = false; });
}

function submitAnswer(value: string) {
  if (phase !== 'playing' || answeredThisProblem) return;
  send({ type: 'answer', value });
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
      colorList = game?.colors ?? colorList;
      renderChoiceButtons();
      board = game?.board ?? [];
      myCorrectCount = game?.myCorrectCount ?? 0;
      roundEndsAtClient = Date.now() + (game?.remainingMs ?? 0);
      myStat.textContent = `내 정답 수: ${myCorrectCount}`;
      if (game?.problem) showProblem(game.problem.word, game.problem.displayColor);
      renderBoard();
      startTimerDisplay();
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
      colorList = msg.colors ?? colorList;
      renderChoiceButtons();
      board = msg.board ?? [];
      myCorrectCount = 0;
      roundEndsAtClient = Date.now() + (msg.durationMs ?? 40000);
      myStat.textContent = '내 정답 수: 0';
      renderBoard();
      startTimerDisplay();
      setPhase('playing');
      break;
    }

    case 'problem':
      showProblem(msg.word, msg.displayColor);
      break;

    case 'answer_result':
      if (msg.correct) {
        answeredThisProblem = true;
        myCorrectCount = msg.correctCount;
        myStat.textContent = `내 정답 수: ${myCorrectCount}`;
        problemDisplay.classList.add('correct-flash');
        Array.from(choiceRow.querySelectorAll<HTMLButtonElement>('.ci-choice-btn')).forEach((btn) => { btn.disabled = true; });
      } else {
        problemDisplay.classList.add('wrong-flash');
        setTimeout(() => problemDisplay.classList.remove('wrong-flash'), 260);
      }
      break;

    case 'progress_update':
      board = msg.board ?? [];
      renderBoard();
      break;

    case 'chat_message':
      chatWidget.addMessage('general', { name: msg.name, text: msg.text, mine: msg.token === myToken });
      break;

    case 'game_over':
      renderGameOver(msg);
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
  const winnerName: string | null = msg.winnerName ?? null;
  const iWon = !!myToken && winnerToken === myToken;

  gameOverBanner.textContent = !winnerToken
    ? '아무도 정답을 맞히지 못했어요!'
    : iWon
      ? '🏆 우승! 가장 많이·빠르게 맞혔어요!'
      : `🏆 ${winnerName}님 우승!`;
  gameOverBanner.className = 'set-over-result ' + (iWon ? 'win' : winnerToken ? 'lose' : '');

  const results = (msg.results as { token: string; name: string; rank: number; correctCount: number; avgMs: number | null }[]) ?? [];
  finalBoard.innerHTML = results
    .map((r) => `<div class="scores-row${r.token === myToken ? ' me' : ''}">
      <span>${r.rank}위 ${r.name}</span>
      <span>${r.correctCount}개${r.avgMs !== null ? ` (평균 ${(r.avgMs / 1000).toFixed(1)}초)` : ''}</span>
    </div>`)
    .join('') || '<div class="scores-row"><span>결과 없음</span></div>';
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
  const capacity = Math.min(Math.max(Number(capacityInput.value) || 6, 2), 8);
  connect({ kind: 'create', capacity });
});

joinBtn.addEventListener('click', () => {
  if (!requireName()) return;
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) { showEntryError('방 코드를 입력해주세요.'); return; }
  connect({ kind: 'join', roomCode: code });
});

cancelBtn.addEventListener('click', leaveRoom);
lobbyCancelBtn.addEventListener('click', leaveRoom);
gameOverLeaveBtn.addEventListener('click', leaveRoom);

lobbyCopyBtn.addEventListener('click', () => copyLink(roomCode, lobbyCopyBtn));

startBtn.addEventListener('click', () => { send({ type: 'start' }); });

retryBtn.addEventListener('click', () => { if (pendingAction) connect(pendingAction); });

setPhase('entry');
