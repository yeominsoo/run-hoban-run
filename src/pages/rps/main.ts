import './rps.css';
import { handIcon, hiddenHandIcon, CHOICE_LABEL, type Choice } from './hand-icons';

type Phase = 'entry' | 'connecting' | 'hosting' | 'choosing' | 'result' | 'reconnecting' | 'opponent-left' | 'error';
type PendingAction = { kind: 'create' } | { kind: 'join'; roomCode: string } | { kind: 'rejoin' };

interface ResultMsg {
  type: 'result';
  you: Choice;
  opponent: Choice;
  outcome: 'win' | 'lose' | 'draw';
  score: { you: number; opponent: number };
}

function resolveWsUrl(): string {
  const configured = import.meta.env.VITE_RPS_WS_URL as string | undefined;
  if (configured) return configured;
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${location.hostname}:8787/rps`;
}

const WS_URL = resolveWsUrl();
const NAME_STORAGE_KEY = 'run-hoban-run:rps-nickname';
const RECONNECT_RETRY_MS = 2000;
const RECONNECT_MAX_ATTEMPTS = 24; // ~48s, matches the server's 45s reconnect grace window

let phase: Phase = 'entry';
let socket: WebSocket | null = null;
let myName = '';
let opponentName = '';
let myChoice: Choice | null = null;
let roomCode = '';
let myToken: string | null = null;
let pendingAction: PendingAction | null = null;
let intentionalClose = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="rps-shell">
    <a class="back-link" href="/">← 게임 선택</a>
    <div class="rps-stage">
      <h1 class="rps-title">가위바위보 대결</h1>
      <p class="rps-sub">방을 만들고 코드를 공유해 1:1로 대결하세요</p>

      <div class="rps-panel" id="entry-panel">
        <label class="field-label" for="nickname">닉네임</label>
        <input id="nickname" type="text" maxlength="20" placeholder="닉네임을 입력하세요" class="nickname-input" />

        <div class="entry-tabs" role="tablist">
          <button id="tab-create" type="button" class="entry-tab active" role="tab">방 만들기</button>
          <button id="tab-join" type="button" class="entry-tab" role="tab">방 참가하기</button>
        </div>

        <div class="entry-section" id="create-section">
          <p class="status-text">방을 만들면 코드가 생성돼요. 친구에게 코드나 링크를 공유하세요.</p>
          <button id="create-btn" type="button" class="rps-btn primary">방 만들기</button>
        </div>

        <div class="entry-section hidden" id="join-section">
          <label class="field-label" for="room-code-input">방 코드</label>
          <input id="room-code-input" type="text" maxlength="6" placeholder="예: 3F9A2C" class="nickname-input room-code-input" />
          <button id="join-btn" type="button" class="rps-btn primary">참가하기</button>
        </div>

        <p class="entry-error hidden" id="entry-error"></p>
      </div>

      <div class="rps-panel hidden" id="waiting-panel">
        <div class="spinner" aria-hidden="true"></div>
        <p class="status-text" id="waiting-status">서버에 연결하는 중…</p>
        <div class="room-share hidden" id="room-share">
          <span class="room-share-label">방 코드</span>
          <span class="room-code-display" id="room-code-display"></span>
          <button id="copy-link-btn" type="button" class="rps-btn secondary">초대 링크 복사</button>
        </div>
        <button id="cancel-btn" type="button" class="rps-btn secondary">취소</button>
      </div>

      <div class="match-view hidden" id="match-view">
        <div class="match-header">
          <div class="player-tag me">
            <span class="player-name" id="my-name"></span>
            <span class="player-score" id="my-score">0</span>
          </div>
          <span class="vs-mark">VS</span>
          <div class="player-tag opponent">
            <span class="player-score" id="opp-score">0</span>
            <span class="player-name" id="opp-name"></span>
          </div>
        </div>

        <p class="opponent-status hidden" id="opponent-status"></p>

        <p class="chant-text hidden" id="chant-text"></p>

        <div class="arena" id="arena">
          <div class="hand-slot mine" id="my-hand">${hiddenHandIcon()}</div>
          <div class="hand-slot theirs" id="opp-hand">${hiddenHandIcon()}</div>
        </div>

        <p class="outcome-banner hidden" id="outcome-banner"></p>
        <p class="status-text" id="match-status">낼 것을 골라주세요</p>

        <div class="choice-row" id="choice-row">
          <button class="choice-btn" data-choice="rock" type="button">${handIcon('rock', true)}<span>바위</span></button>
          <button class="choice-btn" data-choice="scissors" type="button">${handIcon('scissors', true)}<span>가위</span></button>
          <button class="choice-btn" data-choice="paper" type="button">${handIcon('paper', true)}<span>보</span></button>
        </div>

        <div class="match-actions hidden" id="match-actions">
          <button id="continue-btn" type="button" class="rps-btn primary">다음 판</button>
          <button id="leave-btn" type="button" class="rps-btn secondary">그만하기</button>
        </div>
      </div>

      <div class="rps-panel hidden" id="left-panel">
        <p class="status-text">상대방이 나갔습니다.</p>
        <button id="new-room-btn" type="button" class="rps-btn primary">새 방 만들기</button>
        <button id="quit-btn" type="button" class="rps-btn secondary">나가기</button>
      </div>

      <div class="rps-panel hidden" id="error-panel">
        <p class="status-text" id="error-text">게임 서버에 연결할 수 없습니다.</p>
        <button id="retry-btn" type="button" class="rps-btn primary">다시 시도</button>
      </div>
    </div>
  </div>
`;

// ── Refs ──────────────────────────────────────
const panels = {
  entry: document.getElementById('entry-panel')!,
  waiting: document.getElementById('waiting-panel')!,
  match: document.getElementById('match-view')!,
  left: document.getElementById('left-panel')!,
  error: document.getElementById('error-panel')!,
};
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
const roomShare = document.getElementById('room-share')!;
const roomCodeDisplay = document.getElementById('room-code-display')!;
const copyLinkBtn = document.getElementById('copy-link-btn') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
const myNameEl = document.getElementById('my-name')!;
const oppNameEl = document.getElementById('opp-name')!;
const myScoreEl = document.getElementById('my-score')!;
const oppScoreEl = document.getElementById('opp-score')!;
const opponentStatus = document.getElementById('opponent-status')!;
const chantText = document.getElementById('chant-text')!;
const myHandEl = document.getElementById('my-hand')!;
const oppHandEl = document.getElementById('opp-hand')!;
const outcomeBanner = document.getElementById('outcome-banner')!;
const matchStatus = document.getElementById('match-status')!;
const choiceRow = document.getElementById('choice-row')!;
const choiceButtons = Array.from(choiceRow.querySelectorAll<HTMLButtonElement>('.choice-btn'));
const matchActions = document.getElementById('match-actions')!;
const continueBtn = document.getElementById('continue-btn') as HTMLButtonElement;
const leaveBtn = document.getElementById('leave-btn') as HTMLButtonElement;
const newRoomBtn = document.getElementById('new-room-btn') as HTMLButtonElement;
const quitBtn = document.getElementById('quit-btn') as HTMLButtonElement;
const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;
const errorText = document.getElementById('error-text')!;

// ── Init ──────────────────────────────────────
nicknameInput.value = localStorage.getItem(NAME_STORAGE_KEY) ?? '';

const roomFromUrl = new URLSearchParams(location.search).get('room');
if (roomFromUrl) {
  roomCodeInput.value = roomFromUrl.trim().toUpperCase().slice(0, 6);
  setTab('join');
}

// ── Tabs ──────────────────────────────────────
function setTab(tab: 'create' | 'join') {
  tabCreate.classList.toggle('active', tab === 'create');
  tabJoin.classList.toggle('active', tab === 'join');
  createSection.classList.toggle('hidden', tab !== 'create');
  joinSection.classList.toggle('hidden', tab !== 'join');
  hideEntryError();
}
tabCreate.addEventListener('click', () => setTab('create'));
tabJoin.addEventListener('click', () => setTab('join'));

// ── Phase rendering ───────────────────────────
function setPhase(next: Phase) {
  phase = next;
  panels.entry.classList.toggle('hidden', next !== 'entry');
  panels.waiting.classList.toggle('hidden', next !== 'connecting' && next !== 'hosting' && next !== 'reconnecting');
  panels.match.classList.toggle('hidden', next !== 'choosing' && next !== 'result');
  panels.left.classList.toggle('hidden', next !== 'opponent-left');
  panels.error.classList.toggle('hidden', next !== 'error');
}

function showEntryError(message: string) {
  entryError.textContent = message;
  entryError.classList.remove('hidden');
}
function hideEntryError() {
  entryError.classList.add('hidden');
}

function resetArena() {
  myHandEl.className = 'hand-slot mine';
  oppHandEl.className = 'hand-slot theirs';
  myHandEl.innerHTML = hiddenHandIcon();
  oppHandEl.innerHTML = hiddenHandIcon();
  chantText.classList.add('hidden');
  opponentStatus.classList.add('hidden');
  outcomeBanner.classList.add('hidden');
  outcomeBanner.className = 'outcome-banner hidden';
  matchActions.classList.add('hidden');
  choiceRow.classList.remove('hidden');
  choiceButtons.forEach((btn) => {
    btn.disabled = false;
    btn.classList.remove('selected');
  });
  myChoice = null;
}

// ── Name / room code helpers ───────────────────
function requireName(): string | null {
  const name = nicknameInput.value.trim().slice(0, 20);
  if (!name) {
    showEntryError('닉네임을 입력해주세요.');
    return null;
  }
  myName = name;
  localStorage.setItem(NAME_STORAGE_KEY, name);
  return name;
}

// ── Networking ────────────────────────────────
function connect(action: PendingAction) {
  pendingAction = action;
  intentionalClose = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (action.kind !== 'rejoin') {
    hideEntryError();
    roomShare.classList.add('hidden');
    waitingStatus.textContent = '서버에 연결하는 중…';
    setPhase('connecting');
  }

  let ws: WebSocket;
  try {
    ws = new WebSocket(WS_URL);
  } catch {
    showError('게임 서버 주소가 올바르지 않습니다.');
    return;
  }
  socket = ws;

  ws.addEventListener('open', () => {
    if (action.kind === 'create') {
      waitingStatus.textContent = '방을 만드는 중…';
      send({ type: 'create', name: myName });
    } else if (action.kind === 'join') {
      waitingStatus.textContent = '참가하는 중…';
      send({ type: 'join', name: myName, roomCode: action.roomCode });
    } else if (action.kind === 'rejoin') {
      send({ type: 'rejoin', roomCode, token: myToken });
    }
  });

  ws.addEventListener('message', (event) => {
    let msg: any;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    handleServerMessage(msg);
  });

  ws.addEventListener('close', () => {
    if (intentionalClose) return;
    if (phase === 'hosting' || phase === 'choosing' || phase === 'result' || phase === 'reconnecting') {
      beginReconnect();
    } else if (phase !== 'opponent-left' && phase !== 'entry') {
      showError('서버와의 연결이 끊어졌습니다.');
    }
  });

  ws.addEventListener('error', () => {
    if (action.kind === 'rejoin') return; // the close handler will schedule the next retry
    showError('게임 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
  });
}

// 카카오톡 공유 등으로 탭이 백그라운드로 가면서 소켓이 끊기는 경우를 흡수한다.
// 서버가 방을 45초간 유예해주는 동안, 같은 토큰으로 재연결을 시도한다.
function beginReconnect() {
  if (!myToken || !roomCode) {
    showError('서버와의 연결이 끊어졌습니다.');
    return;
  }
  setPhase('reconnecting');
  roomShare.classList.add('hidden');
  reconnectAttempts++;
  waitingStatus.textContent = `연결이 끊어졌습니다. 재연결 중… (${reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})`;

  if (reconnectAttempts > RECONNECT_MAX_ATTEMPTS) {
    showError('상대와의 연결을 복구하지 못했습니다. 처음부터 다시 시작해주세요.');
    return;
  }
  reconnectTimer = setTimeout(() => connect({ kind: 'rejoin' }), RECONNECT_RETRY_MS);
}

function send(payload: unknown) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function showError(message: string) {
  errorText.textContent = message;
  setPhase('error');
  socket?.close();
  socket = null;
}

function handleServerMessage(msg: any) {
  switch (msg.type) {
    case 'room_created':
      myToken = msg.token;
      roomCode = msg.roomCode;
      reconnectAttempts = 0;
      roomCodeDisplay.textContent = roomCode;
      roomShare.classList.remove('hidden');
      waitingStatus.textContent = '상대를 기다리는 중…';
      setPhase('hosting');
      break;
    case 'matched':
      myToken = msg.token ?? myToken;
      opponentName = msg.opponentName;
      roomCode = msg.roomCode;
      reconnectAttempts = 0;
      myNameEl.textContent = myName;
      oppNameEl.textContent = opponentName;
      myScoreEl.textContent = '0';
      oppScoreEl.textContent = '0';
      resetArena();
      matchStatus.textContent = '낼 것을 골라주세요';
      setPhase('choosing');
      break;
    case 'rejoined':
      reconnectAttempts = 0;
      myToken = msg.token ?? myToken;
      roomCode = msg.roomCode ?? roomCode;
      if (msg.opponentName) {
        opponentName = msg.opponentName;
        myNameEl.textContent = myName;
        oppNameEl.textContent = opponentName;
        myScoreEl.textContent = String(msg.score.you);
        oppScoreEl.textContent = String(msg.score.opponent);
        resetArena();
        matchStatus.textContent = msg.opponentConnected
          ? '낼 것을 골라주세요'
          : '상대가 다시 연결되길 기다리는 중…';
        setPhase('choosing');
      } else {
        roomCodeDisplay.textContent = roomCode;
        roomShare.classList.remove('hidden');
        waitingStatus.textContent = '상대를 기다리는 중…';
        setPhase('hosting');
      }
      break;
    case 'opponent_choice_made':
      if (phase === 'choosing') {
        matchStatus.textContent = '상대가 선택을 마쳤습니다. 당신의 차례!';
      }
      break;
    case 'opponent_disconnected':
      opponentStatus.textContent = '⚠️ 상대방 연결이 불안정합니다. 잠시만 기다려주세요…';
      opponentStatus.classList.remove('hidden');
      break;
    case 'opponent_reconnected':
      opponentStatus.classList.add('hidden');
      break;
    case 'result':
      opponentStatus.classList.add('hidden');
      playChantThenReveal(msg as ResultMsg);
      break;
    case 'opponent_left':
      setPhase('opponent-left');
      break;
    case 'error':
      if (phase === 'reconnecting') {
        showError(msg.message ?? '재연결에 실패했습니다.');
      } else {
        showEntryError(msg.message ?? '방에 참가할 수 없습니다.');
        socket?.close();
        socket = null;
        setPhase('entry');
      }
      break;
    default:
      break;
  }
}

const CHANT_WORDS = ['가위', '바위', '보!!'];
const CHANT_STEP_MS = 420;

function playChantThenReveal(msg: ResultMsg) {
  choiceRow.classList.add('hidden');
  matchStatus.textContent = '';
  chantText.textContent = '';
  chantText.classList.remove('hidden');
  myHandEl.className = 'hand-slot mine pending';
  oppHandEl.className = 'hand-slot theirs pending';
  myHandEl.innerHTML = hiddenHandIcon();
  oppHandEl.innerHTML = hiddenHandIcon();

  let step = 0;
  const tick = () => {
    chantText.textContent = CHANT_WORDS[step];
    chantText.classList.remove('pop');
    void chantText.offsetWidth;
    chantText.classList.add('pop');
    step++;
    if (step < CHANT_WORDS.length) {
      setTimeout(tick, CHANT_STEP_MS);
    } else {
      setTimeout(() => {
        chantText.classList.add('hidden');
        renderResult(msg);
      }, CHANT_STEP_MS);
    }
  };
  tick();
}

function renderResult(msg: ResultMsg) {
  myScoreEl.textContent = String(msg.score.you);
  oppScoreEl.textContent = String(msg.score.opponent);

  myHandEl.innerHTML = handIcon(msg.you);
  oppHandEl.innerHTML = handIcon(msg.opponent);
  myHandEl.className = 'hand-slot mine reveal';
  oppHandEl.className = 'hand-slot theirs reveal';

  const outcomeLabel = msg.outcome === 'win' ? '승리!' : msg.outcome === 'lose' ? '패배' : '무승부';
  outcomeBanner.textContent = `${outcomeLabel} (나: ${CHOICE_LABEL[msg.you]} / 상대: ${CHOICE_LABEL[msg.opponent]})`;
  outcomeBanner.className = `outcome-banner ${msg.outcome}`;

  choiceRow.classList.add('hidden');
  matchStatus.textContent = '';
  matchActions.classList.remove('hidden');
  setPhase('result');
}

// ── Events ────────────────────────────────────
createBtn.addEventListener('click', () => {
  if (!requireName()) return;
  connect({ kind: 'create' });
});

joinBtn.addEventListener('click', () => {
  if (!requireName()) return;
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) {
    showEntryError('방 코드를 입력해주세요.');
    return;
  }
  connect({ kind: 'join', roomCode: code });
});

function leaveRoom() {
  intentionalClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  send({ type: 'leave' });
  socket?.close();
  socket = null;
  myToken = null;
  roomCode = '';
  setPhase('entry');
}

cancelBtn.addEventListener('click', leaveRoom);

copyLinkBtn.addEventListener('click', async () => {
  const link = `${location.origin}/rps/?room=${roomCode}`;
  try {
    await navigator.clipboard.writeText(link);
    const original = copyLinkBtn.textContent;
    copyLinkBtn.textContent = '복사됨!';
    setTimeout(() => {
      copyLinkBtn.textContent = original;
    }, 1500);
  } catch {
    window.prompt('아래 링크를 복사해서 공유하세요', link);
  }
});

choiceButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (myChoice) return;
    const choice = btn.dataset.choice as Choice;
    myChoice = choice;
    choiceButtons.forEach((b) => {
      b.disabled = true;
      b.classList.toggle('selected', b === btn);
    });
    myHandEl.classList.add('pending');
    matchStatus.textContent = '상대의 선택을 기다리는 중…';
    send({ type: 'choice', choice });
  });
});

continueBtn.addEventListener('click', () => {
  resetArena();
  matchStatus.textContent = '낼 것을 골라주세요';
  setPhase('choosing');
});

leaveBtn.addEventListener('click', leaveRoom);

newRoomBtn.addEventListener('click', () => {
  myToken = null;
  roomCode = '';
  connect({ kind: 'create' });
});

quitBtn.addEventListener('click', () => {
  intentionalClose = true;
  socket?.close();
  socket = null;
  myToken = null;
  roomCode = '';
  setPhase('entry');
});

retryBtn.addEventListener('click', () => {
  if (pendingAction) connect(pendingAction);
});

setPhase('entry');
