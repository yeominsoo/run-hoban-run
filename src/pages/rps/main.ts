import './rps.css';
import { handIcon, hiddenHandIcon, CHOICE_LABEL, type Choice } from './hand-icons';

type Phase = 'entry' | 'connecting' | 'hosting' | 'choosing' | 'result' | 'opponent-left' | 'error';
type PendingAction = { kind: 'create' } | { kind: 'join'; roomCode: string };

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

// wss://host:port/rps -> https://host:port/healthz, so a self-signed cert
// exception can be accepted by opening the plain HTTPS endpoint in a tab.
function resolveHealthzUrl(wsUrl: string): string {
  try {
    const httpUrl = wsUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    const u = new URL(httpUrl);
    u.pathname = '/healthz';
    u.search = '';
    return u.toString();
  } catch {
    return '';
  }
}

const WS_URL = resolveWsUrl();
const HEALTHZ_URL = resolveHealthzUrl(WS_URL);
const NAME_STORAGE_KEY = 'run-hoban-run:rps-nickname';
const CERT_SEEN_KEY = 'run-hoban-run:rps-cert-seen';

let phase: Phase = 'entry';
let socket: WebSocket | null = null;
let myName = '';
let opponentName = '';
let myChoice: Choice | null = null;
let roomCode = '';
let pendingAction: PendingAction | null = null;

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="rps-shell">
    <a class="back-link" href="/">← 게임 선택</a>
    <div class="rps-stage">
      <h1 class="rps-title">가위바위보 대결</h1>
      <p class="rps-sub">방을 만들고 코드를 공유해 1:1로 대결하세요</p>

      <div class="rps-panel" id="entry-panel">
        <p class="cert-hint" id="cert-hint">
          🔒 처음 접속하신다면 방 만들기/참가하기를 누를 때 새 탭이 하나 열립니다.
          거기서 나오는 보안 경고 화면에서 "고급" → "이동(안전하지 않음)"을 눌러주시면,
          이후 대결이 정상적으로 연결됩니다.
        </p>
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
const certHint = document.getElementById('cert-hint')!;
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
if (!HEALTHZ_URL || localStorage.getItem(CERT_SEEN_KEY) === '1') {
  certHint.classList.add('hidden');
}

function openCertTabIfNeeded() {
  if (!HEALTHZ_URL || localStorage.getItem(CERT_SEEN_KEY) === '1') return;
  window.open(HEALTHZ_URL, '_blank', 'noopener');
  localStorage.setItem(CERT_SEEN_KEY, '1');
  certHint.classList.add('hidden');
}

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
  panels.waiting.classList.toggle('hidden', next !== 'connecting' && next !== 'hosting');
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
  hideEntryError();
  roomShare.classList.add('hidden');
  waitingStatus.textContent = '서버에 연결하는 중…';
  setPhase('connecting');

  let ws: WebSocket;
  try {
    ws = new WebSocket(WS_URL);
  } catch {
    showError('게임 서버 주소가 올바르지 않습니다.');
    return;
  }
  socket = ws;

  ws.addEventListener('open', () => {
    if (pendingAction?.kind === 'create') {
      waitingStatus.textContent = '방을 만드는 중…';
      send({ type: 'create', name: myName });
    } else if (pendingAction?.kind === 'join') {
      waitingStatus.textContent = '참가하는 중…';
      send({ type: 'join', name: myName, roomCode: pendingAction.roomCode });
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
    if (phase !== 'opponent-left' && phase !== 'entry') {
      showError('서버와의 연결이 끊어졌습니다.');
    }
  });

  ws.addEventListener('error', () => {
    showError('게임 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
  });
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
      roomCode = msg.roomCode;
      roomCodeDisplay.textContent = roomCode;
      roomShare.classList.remove('hidden');
      waitingStatus.textContent = '상대를 기다리는 중…';
      setPhase('hosting');
      break;
    case 'matched':
      opponentName = msg.opponentName;
      roomCode = msg.roomCode;
      myNameEl.textContent = myName;
      oppNameEl.textContent = opponentName;
      myScoreEl.textContent = '0';
      oppScoreEl.textContent = '0';
      resetArena();
      matchStatus.textContent = '낼 것을 골라주세요';
      setPhase('choosing');
      break;
    case 'opponent_choice_made':
      if (phase === 'choosing') {
        matchStatus.textContent = '상대가 선택을 마쳤습니다. 당신의 차례!';
      }
      break;
    case 'result':
      playChantThenReveal(msg as ResultMsg);
      break;
    case 'opponent_left':
      setPhase('opponent-left');
      break;
    case 'error':
      showEntryError(msg.message ?? '방에 참가할 수 없습니다.');
      socket?.close();
      socket = null;
      setPhase('entry');
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
  openCertTabIfNeeded();
  connect({ kind: 'create' });
});

joinBtn.addEventListener('click', () => {
  if (!requireName()) return;
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) {
    showEntryError('방 코드를 입력해주세요.');
    return;
  }
  openCertTabIfNeeded();
  connect({ kind: 'join', roomCode: code });
});

cancelBtn.addEventListener('click', () => {
  send({ type: 'leave' });
  socket?.close();
  socket = null;
  setPhase('entry');
});

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

leaveBtn.addEventListener('click', () => {
  send({ type: 'leave' });
  socket?.close();
  socket = null;
  setPhase('entry');
});

newRoomBtn.addEventListener('click', () => {
  connect({ kind: 'create' });
});

quitBtn.addEventListener('click', () => {
  socket?.close();
  socket = null;
  setPhase('entry');
});

retryBtn.addEventListener('click', () => {
  if (pendingAction) connect(pendingAction);
});

setPhase('entry');
