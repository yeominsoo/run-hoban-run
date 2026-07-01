import './rps.css';
import { handIcon, hiddenHandIcon, CHOICE_LABEL, type Choice } from './hand-icons';

type Phase = 'entry' | 'connecting' | 'waiting' | 'choosing' | 'result' | 'opponent-left' | 'error';

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

let phase: Phase = 'entry';
let socket: WebSocket | null = null;
let myName = '';
let opponentName = '';
let myChoice: Choice | null = null;

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="rps-shell">
    <a class="back-link" href="/">← 게임 선택</a>
    <div class="rps-stage">
      <h1 class="rps-title">가위바위보 대결</h1>
      <p class="rps-sub">실시간 1:1 매칭 · WebSocket</p>

      <div class="rps-panel" id="entry-panel">
        <label class="field-label" for="nickname">닉네임</label>
        <input id="nickname" type="text" maxlength="20" placeholder="닉네임을 입력하세요" class="nickname-input" />
        <button id="start-btn" type="button" class="rps-btn primary">매칭 시작</button>
      </div>

      <div class="rps-panel hidden" id="waiting-panel">
        <div class="spinner" aria-hidden="true"></div>
        <p class="status-text">상대를 찾는 중…</p>
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
        <button id="requeue-btn" type="button" class="rps-btn primary">새 상대 찾기</button>
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
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
const myNameEl = document.getElementById('my-name')!;
const oppNameEl = document.getElementById('opp-name')!;
const myScoreEl = document.getElementById('my-score')!;
const oppScoreEl = document.getElementById('opp-score')!;
const myHandEl = document.getElementById('my-hand')!;
const oppHandEl = document.getElementById('opp-hand')!;
const outcomeBanner = document.getElementById('outcome-banner')!;
const matchStatus = document.getElementById('match-status')!;
const choiceRow = document.getElementById('choice-row')!;
const choiceButtons = Array.from(choiceRow.querySelectorAll<HTMLButtonElement>('.choice-btn'));
const matchActions = document.getElementById('match-actions')!;
const continueBtn = document.getElementById('continue-btn') as HTMLButtonElement;
const leaveBtn = document.getElementById('leave-btn') as HTMLButtonElement;
const requeueBtn = document.getElementById('requeue-btn') as HTMLButtonElement;
const quitBtn = document.getElementById('quit-btn') as HTMLButtonElement;
const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;
const errorText = document.getElementById('error-text')!;

// ── Init ──────────────────────────────────────
nicknameInput.value = localStorage.getItem(NAME_STORAGE_KEY) ?? '';

// ── Phase rendering ───────────────────────────
function setPhase(next: Phase) {
  phase = next;
  panels.entry.classList.toggle('hidden', next !== 'entry');
  panels.waiting.classList.toggle('hidden', next !== 'connecting' && next !== 'waiting');
  panels.match.classList.toggle('hidden', next !== 'choosing' && next !== 'result');
  panels.left.classList.toggle('hidden', next !== 'opponent-left');
  panels.error.classList.toggle('hidden', next !== 'error');
}

function resetArena() {
  myHandEl.className = 'hand-slot mine';
  oppHandEl.className = 'hand-slot theirs';
  myHandEl.innerHTML = hiddenHandIcon();
  oppHandEl.innerHTML = hiddenHandIcon();
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

// ── Networking ────────────────────────────────
function connect() {
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
    send({ type: 'join', name: myName });
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
    case 'waiting':
      setPhase('waiting');
      break;
    case 'matched':
      opponentName = msg.opponentName;
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
      renderResult(msg as ResultMsg);
      break;
    case 'opponent_left':
      setPhase('opponent-left');
      break;
    default:
      break;
  }
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
startBtn.addEventListener('click', () => {
  const name = nicknameInput.value.trim().slice(0, 20);
  if (!name) {
    alert('닉네임을 입력해주세요.');
    return;
  }
  myName = name;
  localStorage.setItem(NAME_STORAGE_KEY, name);
  connect();
});

cancelBtn.addEventListener('click', () => {
  send({ type: 'leave' });
  socket?.close();
  socket = null;
  setPhase('entry');
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

requeueBtn.addEventListener('click', () => {
  send({ type: 'join', name: myName });
  setPhase('connecting');
});

quitBtn.addEventListener('click', () => {
  socket?.close();
  socket = null;
  setPhase('entry');
});

retryBtn.addEventListener('click', () => {
  connect();
});

setPhase('entry');
