import './tug-of-war-battle.css';
import '../../shared/ws-ranking.css';
import { prepareRoomInviteEntry, ROOM_SHARE_RETURN_EVENT, shareRoomLink } from '../../shared/share';
import { createChatWidget } from '../../shared/chat-widget';
import { setupWsRankingUI } from '../../shared/ws-ranking';

type Phase =
  | 'entry' | 'connecting' | 'waiting-opponent' | 'countdown'
  | 'playing' | 'game_over'
  | 'reconnecting' | 'error';

type PendingAction = { kind: 'create' } | { kind: 'join'; roomCode: string } | { kind: 'rejoin' };

const WS_URL = (() => {
  const c = import.meta.env.VITE_TUG_OF_WAR_BATTLE_WS_URL as string | undefined;
  if (c) return c;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8787/tug-of-war-battle`;
})();

const NAME_KEY = 'run-hoban-run:tug-of-war-battle-nickname';
const SESSION_KEY = 'run-hoban-run:tug-of-war-battle-session';
const RECONNECT_RETRY_MS = 2000;
const RECONNECT_MAX = 24;
const ARENA_ASSET_URL = '/assets/game-art/tug-of-war-battle/arena.webp';

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

let mySide: 'left' | 'right' = 'left';
let leftName = '';
let rightName = '';
let winThreshold = 100;
let position = 0;
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

<div class="tw-shell">
  <div class="tw-top-bar">
    <a class="back-link" href="/">← 게임 선택</a>
    <button class="ws-ranking-btn" id="ws-ranking-btn" type="button">🏆 이번 주 랭킹</button>
  </div>
  <div class="tw-stage">
    <h1 class="tw-title">줄다리기 배틀</h1>
    <p class="tw-sub">1:1 실시간 연타 대결! 상대보다 먼저 줄을 내 쪽으로 끝까지 당기세요.</p>

    <!-- Entry -->
    <div class="tw-panel" id="entry-panel">
      <div class="resume-banner hidden" id="resume-banner">
        <p class="status-text" id="resume-text">이전에 참여하던 대결이 있어요.</p>
        <div class="resume-actions">
          <button id="resume-btn" type="button" class="tw-btn primary">재입장하기</button>
          <button id="resume-dismiss-btn" type="button" class="tw-btn secondary">새로 시작</button>
        </div>
      </div>

      <label class="field-label" for="nickname">닉네임</label>
      <input id="nickname" type="text" maxlength="20" placeholder="닉네임을 입력하세요" class="nickname-input" />

      <div class="entry-tabs" role="tablist">
        <button id="tab-create" type="button" class="entry-tab active" role="tab">방 만들기</button>
        <button id="tab-join" type="button" class="entry-tab" role="tab">방 참가하기</button>
      </div>

      <div class="entry-section" id="create-section">
        <button id="create-btn" type="button" class="tw-btn primary">방 만들기</button>
      </div>

      <div class="entry-section hidden" id="join-section">
        <label class="field-label" for="room-code-input">방 코드</label>
        <input id="room-code-input" type="text" maxlength="6" placeholder="예: 3F9A2C" class="nickname-input room-code-input" />
        <button id="join-btn" type="button" class="tw-btn primary">참가하기</button>
      </div>

      <div class="how-to-play">
        <p class="how-to-play-title">🎮 게임 방법</p>
        <ul class="how-to-play-list">
          <li>방을 만들거나 참가하면 상대가 들어오는 즉시 대결이 시작돼요.</li>
          <li>화면의 큰 버튼을 최대한 빠르게 연타해서 줄을 내 쪽으로 당기세요.</li>
          <li>줄이 내 쪽 끝까지 오면 승리! 30초 안에 승부가 안 나면 더 많이 당긴 쪽이 이겨요.</li>
        </ul>
      </div>

      <p class="entry-error hidden" id="entry-error"></p>
    </div>

    <!-- Waiting / reconnecting -->
    <div class="tw-panel hidden" id="waiting-panel">
      <div class="spinner" aria-hidden="true"></div>
      <p class="status-text" id="waiting-status">서버에 연결하는 중…</p>
      <button id="cancel-btn" type="button" class="tw-btn secondary">취소</button>
    </div>

    <!-- Waiting for opponent (room created, sharing link) -->
    <div class="tw-panel hidden" id="waiting-opponent-panel">
      <div class="room-share" id="lobby-share">
        <span class="room-share-label">방 코드</span>
        <span class="room-code-display" id="lobby-code-display"></span>
        <button id="lobby-copy-btn" type="button" class="tw-btn secondary">공유하기</button>
      </div>
      <div class="spinner" aria-hidden="true"></div>
      <p class="status-text">상대가 들어오면 자동으로 시작해요…</p>
      <button id="waiting-opponent-cancel-btn" type="button" class="tw-btn secondary">나가기</button>
    </div>

    <!-- Countdown -->
    <div class="tw-panel hidden" id="countdown-panel">
      <p class="status-text" id="countdown-status">곧 대결이 시작됩니다! 연타할 준비를 하세요.</p>
      <div class="ws-countdown-number" id="countdown-number">3</div>
    </div>

    <!-- Playing -->
    <div class="tw-panel wide hidden" id="playing-panel">
      <div class="tw-timer-track"><div class="tw-timer-fill" id="timer-fill" style="width:100%"></div></div>
      <div class="tw-names-row">
        <span class="tw-name-tag" id="left-name-tag">호스트</span>
        <span class="tw-name-tag" id="right-name-tag">게스트</span>
      </div>
      <div class="tw-arena" id="tw-arena">
        <div class="tw-rope-track" id="rope-track" role="progressbar" aria-label="줄 위치" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
          <div class="tw-rope-marker" id="rope-marker" aria-hidden="true"></div>
        </div>
      </div>
      <button id="tap-btn" type="button" class="tw-tap-btn">당기기!</button>
    </div>

    <!-- Game over -->
    <div class="tw-panel hidden" id="game-over-panel">
      <p class="set-over-result" id="game-over-banner"></p>
      <button id="game-over-leave-btn" type="button" class="tw-btn secondary">나가기</button>
    </div>

    <!-- Error -->
    <div class="tw-panel hidden" id="error-panel">
      <p class="status-text" id="error-text">게임 서버에 연결할 수 없습니다.</p>
      <button id="retry-btn" type="button" class="tw-btn primary">다시 시도</button>
    </div>
  </div>
</div>
`;

// ── Refs ──────────────────────────────────────────────────────────
setupWsRankingUI({
  gameKey: 'tug-of-war-battle',
  gameTitle: '줄다리기 배틀',
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

const timerFill = document.getElementById('timer-fill')!;
const leftNameTag = document.getElementById('left-name-tag')!;
const rightNameTag = document.getElementById('right-name-tag')!;
const arena = document.getElementById('tw-arena')!;
const ropeTrack = document.getElementById('rope-track')!;
const ropeMarker = document.getElementById('rope-marker')!;
const tapBtn = document.getElementById('tap-btn') as HTMLButtonElement;

const gameOverBanner = document.getElementById('game-over-banner')!;
const gameOverLeaveBtn = document.getElementById('game-over-leave-btn') as HTMLButtonElement;

const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;
const errorText = document.getElementById('error-text')!;

// ── Init ──────────────────────────────────────────────────────────
nicknameInput.value = localStorage.getItem(NAME_KEY) ?? '';

arena.dataset.assetState = 'loading';
const arenaImage = new Image();
arenaImage.decoding = 'async';
arenaImage.addEventListener('load', () => { arena.dataset.assetState = 'ready'; });
arenaImage.addEventListener('error', () => { arena.dataset.assetState = 'fallback'; });
arenaImage.src = ARENA_ASSET_URL;

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
  vis(panels.waitingOpponent, next === 'waiting-opponent');
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
  const link = `${location.origin}/tug-of-war-battle/?room=${code}`;
  await shareRoomLink({ url: link, title: '줄다리기 배틀 초대', text: `줄다리기 배틀 방(${code})에 초대할게요!`, btn });
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
    const inGame = ['waiting-opponent', 'countdown', 'playing', 'reconnecting'].includes(phase);
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
  position = 0;
  roundEndsAtClient = 0;
  chatWidget.clearAll();
}

function renderRope() {
  const pct = ((position + winThreshold) / (winThreshold * 2)) * 100;
  const clampedPct = Math.max(0, Math.min(100, pct));
  ropeMarker.style.left = `${clampedPct}%`;
  ropeMarker.dataset.position = String(position);
  ropeTrack.setAttribute('aria-valuenow', String(Math.round(clampedPct)));
  const direction = position > 0 ? '오른쪽' : position < 0 ? '왼쪽' : '중앙';
  ropeTrack.setAttribute('aria-valuetext', `${direction} ${Math.abs(position)}`);
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

// ── Server message handler ────────────────────────────────────────
function handleServerMessage(msg: any) {
  switch (msg.type) {

    case 'room_created':
      myToken = msg.token;
      roomCode = msg.roomCode;
      mySide = 'left';
      reconnectAttempts = 0;
      lobbyCodeDisplay.textContent = roomCode;
      setPhase('waiting-opponent');
      break;

    case 'joined':
      myToken = msg.token;
      roomCode = msg.roomCode;
      mySide = 'right';
      reconnectAttempts = 0;
      // 상대(호스트)가 이미 있으니 곧바로 game_starting이 뒤따라온다.
      break;

    case 'opponent_joined':
      // 호스트 쪽에서 상대 입장을 확인 — 곧 game_starting이 뒤따라온다.
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
      mySide = game.mySide;
      winThreshold = game.winThreshold;
      position = game.position;
      leftName = game.leftName;
      rightName = game.rightName;
      leftNameTag.textContent = leftName;
      rightNameTag.textContent = rightName;
      roundEndsAtClient = Date.now() + (game.remainingMs ?? 0);
      renderRope();
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

    case 'match_start': {
      winThreshold = msg.winThreshold;
      leftName = msg.leftName;
      rightName = msg.rightName;
      leftNameTag.textContent = leftName;
      rightNameTag.textContent = rightName;
      leftNameTag.classList.toggle('me', mySide === 'left');
      rightNameTag.classList.toggle('me', mySide === 'right');
      position = 0;
      roundEndsAtClient = Date.now() + (msg.durationMs ?? 30000);
      renderRope();
      startTimerDisplay();
      setPhase('playing');
      break;
    }

    case 'position_update':
      position = msg.position;
      renderRope();
      break;

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
    ? '무승부! 아무도 완전히 당기지 못했어요.'
    : iWon
      ? '🏆 승리! 줄을 내 쪽으로 완전히 당겼어요!'
      : '패배! 상대가 먼저 당겼어요.';
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

function doTap() {
  if (phase !== 'playing') return;
  send({ type: 'tap' });
}
tapBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); doTap(); });

setPhase('entry');
