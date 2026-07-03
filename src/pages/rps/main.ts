import './rps.css';
import { handIcon, hiddenHandIcon, CHOICE_LABEL, type Choice } from './hand-icons';

type Mode = '1v1' | 'group' | 'tournament';
type Phase =
  | 'entry' | 'connecting' | 'hosting' | 'lobby'
  | 'choosing' | 'result' | 'set_over' | 'bye'
  | 'round_over' | 'tournament_winner' | 'group_over'
  | 'reconnecting' | 'opponent-left' | 'error';

type PendingAction = { kind: 'create'; mode: Mode; capacity: number } | { kind: 'join'; roomCode: string } | { kind: 'rejoin' };

const WS_URL = (() => {
  const c = import.meta.env.VITE_RPS_WS_URL as string | undefined;
  if (c) return c;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8787/rps`;
})();

const RANKING_URL = WS_URL
  .replace(/^wss:/, 'https:')
  .replace(/^ws:/, 'http:')
  .replace(/\/rps$/, '/ranking');

const NAME_KEY = 'run-hoban-run:rps-nickname';
const SESSION_KEY = 'run-hoban-run:rps-session';
const RECONNECT_RETRY_MS = 2000;
const RECONNECT_MAX = 24;

interface SavedSession { roomCode: string; token: string; name: string; mode: Mode; }

function saveSession() {
  if (!myToken || !roomCode) return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode, token: myToken, name: myName, mode: roomMode }));
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
let opponentName = '';
let myChoice: Choice | null = null;
let roomCode = '';
let myToken: string | null = null;
let roomMode: Mode = '1v1';
let isHost = false;
let pendingAction: PendingAction | null = null;
let intentionalClose = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let matchWins = { you: 0, opponent: 0 };
let setScore = { you: 0, opponent: 0 };
let autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
// 세트를 끝내는 판은 서버가 'result' 다음에 곧바로 'set_over'(+다음 라운드 match_start)를
// 보낸다. 'result'의 가위-바위-보 콜 애니메이션은 ~1.3초가 걸려서, 그 사이 더 최신 메시지가
// 이미 화면(phase)을 바꿔놨는데 뒤늦게 renderResult가 덮어써버리는 경쟁 상태가 있었다.
// setPhase가 호출될 때마다 증가하는 세대 번호로, 자신이 처리되는 시점에 화면이 이미
// 다른 곳으로 넘어갔으면(세대 번호가 달라졌으면) 조용히 무시한다. tournament_state/
// group_scores처럼 화면을 안 바꾸는 순수 정보성 브로드캐스트는 세대를 올리지 않는다.
let messageGeneration = 0;
// 세트를 끝내는 판이면 서버가 'result' 바로 뒤에 'set_over'를(그룹 우승 조건까지 달성했다면
// 'group_over'까지) 지연 없이 곧장 보낸다. 예전에는 그 즉시 화면을 넘겨버려서, 정작 승부가
// 갈리는 마지막 판에는 가위-바위-보!! 리빌 애니메이션을 아예 못 보고 화면이 훅 넘어가는
// 것처럼 느껴졌다("도중에 게임이 넘어간다"는 제보의 원인). 리빌이 재생 중일 때 도착한
// set_over/group_over는 큐에 쌓아뒀다가, 리빌이 끝난 뒤 잠깐 더 보여주고 나서 순서대로 처리한다.
let chantInProgress = false;
let deferredMessages: any[] = [];
const REVEAL_HOLD_MS = 1000;
const WINS_TO_SET = 2;
const AUTO_ADVANCE_MS = 1800;

// ── HTML ──────────────────────────────────────────────────────────
const app = document.getElementById('app')!;
app.innerHTML = `
<!-- Ranking overlay -->
<div class="ranking-overlay hidden" id="ranking-overlay" role="dialog" aria-modal="true" aria-label="이번 주 랭킹">
  <div class="ranking-modal">
    <div class="ranking-header">
      <h2 class="ranking-title">🏆 이번 주 랭킹</h2>
      <button class="ranking-close" id="ranking-close" type="button" aria-label="닫기">✕</button>
    </div>
    <p class="ranking-week" id="ranking-week"></p>
    <div class="ranking-tabs">
      <button class="ranking-tab active" data-week="current" type="button">이번 주</button>
      <button class="ranking-tab" data-week="prev" type="button">지난 주</button>
    </div>
    <div class="ranking-body" id="ranking-body">
      <div class="ranking-loading"><div class="spinner"></div></div>
    </div>
  </div>
</div>

<div class="rps-shell">
  <div class="rps-top-bar">
    <a class="back-link" href="/">← 게임 선택</a>
    <button class="ranking-btn" id="ranking-btn" type="button">🏆 이번 주 랭킹</button>
  </div>
  <div class="rps-stage">
    <h1 class="rps-title">가위바위보 대결</h1>
    <p class="rps-sub" id="rps-sub">방을 만들고 코드를 공유해 대결하세요</p>

    <!-- Entry -->
    <div class="rps-panel" id="entry-panel">
      <div class="resume-banner hidden" id="resume-banner">
        <p class="status-text" id="resume-text">이전에 참여하던 대결이 있어요.</p>
        <div class="resume-actions">
          <button id="resume-btn" type="button" class="rps-btn primary">재입장하기</button>
          <button id="resume-dismiss-btn" type="button" class="rps-btn secondary">새로 시작</button>
        </div>
      </div>

      <label class="field-label" for="nickname">닉네임</label>
      <input id="nickname" type="text" maxlength="20" placeholder="닉네임을 입력하세요" class="nickname-input" />

      <div class="entry-tabs" role="tablist">
        <button id="tab-create" type="button" class="entry-tab active" role="tab">방 만들기</button>
        <button id="tab-join" type="button" class="entry-tab" role="tab">방 참가하기</button>
      </div>

      <div class="entry-section" id="create-section">
        <span class="field-label">게임 모드</span>
        <div class="mode-selector">
          <button type="button" class="mode-btn active" data-mode="1v1">1 : 1</button>
          <button type="button" class="mode-btn" data-mode="group">그룹전</button>
          <button type="button" class="mode-btn" data-mode="tournament">토너먼트</button>
        </div>
        <div id="capacity-row" class="hidden">
          <label class="field-label" for="capacity-input">인원 수 (2~16)</label>
          <input id="capacity-input" type="number" min="2" max="16" value="4" class="nickname-input capacity-input" />
        </div>
        <button id="create-btn" type="button" class="rps-btn primary">방 만들기</button>
      </div>

      <div class="entry-section hidden" id="join-section">
        <label class="field-label" for="room-code-input">방 코드</label>
        <input id="room-code-input" type="text" maxlength="6" placeholder="예: 3F9A2C" class="nickname-input room-code-input" />
        <button id="join-btn" type="button" class="rps-btn primary">참가하기</button>
      </div>

      <p class="entry-error hidden" id="entry-error"></p>
    </div>

    <!-- Waiting / hosting / reconnecting -->
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

    <!-- Lobby (group / tournament) -->
    <div class="rps-panel hidden" id="lobby-panel">
      <div class="room-share" id="lobby-share">
        <span class="room-share-label">방 코드</span>
        <span class="room-code-display" id="lobby-code-display"></span>
        <button id="lobby-copy-btn" type="button" class="rps-btn secondary">초대 링크 복사</button>
      </div>
      <div class="lobby-players" id="lobby-players"></div>
      <p class="status-text" id="lobby-status">호스트가 시작하기를 기다리는 중…</p>
      <button id="start-btn" type="button" class="rps-btn primary hidden">시작하기</button>
      <button id="lobby-cancel-btn" type="button" class="rps-btn secondary">나가기</button>
    </div>

    <!-- Match view -->
    <div class="match-view hidden" id="match-view">
      <div class="match-header">
        <div class="player-tag me">
          <span class="player-name" id="my-name"></span>
          <span class="player-score set-score" id="my-score">0</span>
        </div>
        <div class="vs-center">
          <span class="vs-mark">VS</span>
          <span class="round-badge hidden" id="round-badge"></span>
        </div>
        <div class="player-tag opponent">
          <span class="player-score set-score" id="opp-score">0</span>
          <span class="player-name" id="opp-name"></span>
        </div>
      </div>

      <div class="match-wins-row" id="match-wins-row">
        <div class="match-pips" id="my-pips"></div>
        <span class="match-wins-label">세트 진행</span>
        <div class="match-pips" id="opp-pips"></div>
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

    <!-- Set-over -->
    <div class="rps-panel hidden" id="set-over-panel">
      <p class="set-over-result" id="set-over-result"></p>
      <p class="status-text" id="set-over-score"></p>
      <button id="next-set-btn" type="button" class="rps-btn primary">다음 세트</button>
      <button id="set-leave-btn" type="button" class="rps-btn secondary">그만하기</button>
      <div class="live-status hidden" id="set-over-live-status"></div>
    </div>

    <!-- Bye (tournament) -->
    <div class="rps-panel hidden" id="bye-panel">
      <p class="set-over-result">🎉 부전승!</p>
      <p class="status-text" id="bye-status">이번 라운드는 쉬어가세요. 다음 라운드를 기다리는 중…</p>
      <div class="live-status hidden" id="bye-live-status"></div>
    </div>

    <!-- Round over (group) -->
    <div class="rps-panel hidden" id="round-over-panel">
      <p class="field-label" id="round-over-title">라운드 종료</p>
      <div class="scores-list" id="round-scores"></div>
      <button id="next-round-btn" type="button" class="rps-btn primary hidden">다음 라운드</button>
      <button id="end-group-btn" type="button" class="rps-btn secondary hidden">게임 종료</button>
      <p class="status-text hidden" id="waiting-next-round">호스트가 다음 라운드를 시작하기를 기다리는 중…</p>
    </div>

    <!-- Tournament / group winner -->
    <div class="rps-panel hidden" id="winner-panel">
      <p class="set-over-result" id="winner-text"></p>
      <p class="status-text" id="winner-sub"></p>
      <button id="winner-quit-btn" type="button" class="rps-btn secondary">나가기</button>
    </div>

    <!-- Opponent left (1v1) -->
    <div class="rps-panel hidden" id="left-panel">
      <p class="status-text" id="left-text">상대방이 나갔습니다.</p>
      <button id="new-room-btn" type="button" class="rps-btn primary hidden">새 방 만들기</button>
      <button id="quit-btn" type="button" class="rps-btn secondary">나가기</button>
    </div>

    <!-- Error -->
    <div class="rps-panel hidden" id="error-panel">
      <p class="status-text" id="error-text">게임 서버에 연결할 수 없습니다.</p>
      <button id="retry-btn" type="button" class="rps-btn primary">다시 시도</button>
    </div>
  </div>
</div>
`;

// ── Ranking refs ─────────────────────────────────────────────────
const rankingOverlay = document.getElementById('ranking-overlay')!;
const rankingClose = document.getElementById('ranking-close') as HTMLButtonElement;
const rankingBody = document.getElementById('ranking-body')!;
const rankingWeekEl = document.getElementById('ranking-week')!;
const rankingBtnEl = document.getElementById('ranking-btn') as HTMLButtonElement;
const rankingTabBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.ranking-tab'));

// ── Refs ──────────────────────────────────────────────────────────
const panels = {
  entry: document.getElementById('entry-panel')!,
  waiting: document.getElementById('waiting-panel')!,
  lobby: document.getElementById('lobby-panel')!,
  match: document.getElementById('match-view')!,
  setOver: document.getElementById('set-over-panel')!,
  bye: document.getElementById('bye-panel')!,
  roundOver: document.getElementById('round-over-panel')!,
  winner: document.getElementById('winner-panel')!,
  left: document.getElementById('left-panel')!,
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
const modeBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.mode-btn'));
const capacityRow = document.getElementById('capacity-row')!;
const capacityInput = document.getElementById('capacity-input') as HTMLInputElement;
const createBtn = document.getElementById('create-btn') as HTMLButtonElement;
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
const roomCodeInput = document.getElementById('room-code-input') as HTMLInputElement;
const entryError = document.getElementById('entry-error')!;

const waitingStatus = document.getElementById('waiting-status')!;
const roomShare = document.getElementById('room-share')!;
const roomCodeDisplay = document.getElementById('room-code-display')!;
const copyLinkBtn = document.getElementById('copy-link-btn') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;

const lobbyCopyBtn = document.getElementById('lobby-copy-btn') as HTMLButtonElement;
const lobbyCodeDisplay = document.getElementById('lobby-code-display')!;
const lobbyPlayers = document.getElementById('lobby-players')!;
const lobbyStatus = document.getElementById('lobby-status')!;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const lobbyCancelBtn = document.getElementById('lobby-cancel-btn') as HTMLButtonElement;

const myNameEl = document.getElementById('my-name')!;
const oppNameEl = document.getElementById('opp-name')!;
const myScoreEl = document.getElementById('my-score')!;
const oppScoreEl = document.getElementById('opp-score')!;
const roundBadge = document.getElementById('round-badge')!;
const myPips = document.getElementById('my-pips')!;
const oppPips = document.getElementById('opp-pips')!;
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

const setOverResult = document.getElementById('set-over-result')!;
const setOverScore = document.getElementById('set-over-score')!;
const nextSetBtn = document.getElementById('next-set-btn') as HTMLButtonElement;
const setLeaveBtn = document.getElementById('set-leave-btn') as HTMLButtonElement;

const byeStatus = document.getElementById('bye-status')!;
const setOverLiveStatus = document.getElementById('set-over-live-status')!;
const byeLiveStatus = document.getElementById('bye-live-status')!;

const roundOverTitle = document.getElementById('round-over-title')!;
const roundScores = document.getElementById('round-scores')!;
const nextRoundBtn = document.getElementById('next-round-btn') as HTMLButtonElement;
const endGroupBtn = document.getElementById('end-group-btn') as HTMLButtonElement;
const waitingNextRound = document.getElementById('waiting-next-round')!;

const winnerText = document.getElementById('winner-text')!;
const winnerSub = document.getElementById('winner-sub')!;
const winnerQuitBtn = document.getElementById('winner-quit-btn') as HTMLButtonElement;

const leftText = document.getElementById('left-text')!;
const newRoomBtn = document.getElementById('new-room-btn') as HTMLButtonElement;
const quitBtn = document.getElementById('quit-btn') as HTMLButtonElement;
const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;
const errorText = document.getElementById('error-text')!;

// ── Init ──────────────────────────────────────────────────────────
nicknameInput.value = localStorage.getItem(NAME_KEY) ?? '';

const roomFromUrl = new URLSearchParams(location.search).get('room');
if (roomFromUrl) {
  roomCodeInput.value = roomFromUrl.trim().toUpperCase().slice(0, 6);
  setTab('join');
}

// 실수로 탭을 새로고침/닫아서 소켓이 끊긴 경우, 토큰이 메모리에서만 있으면 사라져서
// 다시 들어가려 해도 "방이 가득 찼습니다"만 뜨게 된다. localStorage에 저장해두고
// 재입장을 제안한다.
const resumableSession = loadSession();
if (resumableSession) {
  resumeText.textContent = `"${resumableSession.name}"님으로 참여하던 방(${resumableSession.roomCode})이 있어요. 다시 들어가시겠어요?`;
  resumeBanner.classList.remove('hidden');
}

let selectedMode: Mode = '1v1';

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

modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    selectedMode = btn.dataset.mode as Mode;
    modeBtns.forEach(b => b.classList.toggle('active', b === btn));
    capacityRow.classList.toggle('hidden', selectedMode === '1v1');
  });
});

function setPhase(next: Phase) {
  messageGeneration++;
  phase = next;
  const vis = (el: HTMLElement, show: boolean) => el.classList.toggle('hidden', !show);
  vis(panels.entry, next === 'entry');
  vis(panels.waiting, next === 'connecting' || next === 'hosting' || next === 'reconnecting');
  vis(panels.lobby, next === 'lobby');
  vis(panels.match, next === 'choosing' || next === 'result');
  vis(panels.setOver, next === 'set_over');
  vis(panels.bye, next === 'bye');
  vis(panels.roundOver, next === 'round_over');
  vis(panels.winner, next === 'tournament_winner' || next === 'group_over');
  vis(panels.left, next === 'opponent-left');
  vis(panels.error, next === 'error');
}

function showEntryError(msg: string) { entryError.textContent = msg; entryError.classList.remove('hidden'); }
function hideEntryError() { entryError.classList.add('hidden'); }

function renderPips(el: HTMLElement, wins: number) {
  el.innerHTML = '';
  for (let i = 0; i < WINS_TO_SET; i++) {
    const pip = document.createElement('span');
    pip.className = 'pip' + (i < wins ? ' filled' : '');
    el.appendChild(pip);
  }
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
  choiceButtons.forEach(b => { b.disabled = false; b.classList.remove('selected'); });
  myChoice = null;
}

function enterMatch(oppName: string, round?: number) {
  opponentName = oppName;
  myNameEl.textContent = myName;
  oppNameEl.textContent = opponentName;
  myScoreEl.textContent = String(setScore.you);
  oppScoreEl.textContent = String(setScore.opponent);
  renderPips(myPips, matchWins.you);
  renderPips(oppPips, matchWins.opponent);
  if (round != null) { roundBadge.textContent = `라운드 ${round}`; roundBadge.classList.remove('hidden'); }
  else { roundBadge.classList.add('hidden'); }
  resetArena();
  matchStatus.textContent = '낼 것을 골라주세요';
  setPhase('choosing');
}

function requireName(): string | null {
  const name = nicknameInput.value.trim().slice(0, 20);
  if (!name) { showEntryError('닉네임을 입력해주세요.'); return null; }
  myName = name;
  localStorage.setItem(NAME_KEY, name);
  return name;
}

async function copyLink(code: string, btn: HTMLButtonElement) {
  const link = `${location.origin}/rps/?room=${code}`;
  try {
    await navigator.clipboard.writeText(link);
    const orig = btn.textContent!;
    btn.textContent = '복사됨!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch {
    window.prompt('아래 링크를 복사해서 공유하세요', link);
  }
}

// ── Networking ────────────────────────────────────────────────────
function connect(action: PendingAction) {
  pendingAction = action;
  intentionalClose = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  if (action.kind !== 'rejoin') {
    hideEntryError();
    roomShare.classList.add('hidden');
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
      send({ type: 'create', name: myName, mode: action.mode, capacity: action.capacity });
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
    const inGame = ['hosting', 'lobby', 'choosing', 'result', 'set_over', 'bye', 'round_over', 'reconnecting'].includes(phase);
    if (inGame) beginReconnect();
    else if (!['opponent-left', 'entry', 'tournament_winner', 'group_over'].includes(phase)) {
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
  roomShare.classList.add('hidden');
  reconnectAttempts++;
  waitingStatus.textContent = `연결이 끊어졌습니다. 재연결 중… (${reconnectAttempts}/${RECONNECT_MAX})`;
  if (reconnectAttempts > RECONNECT_MAX) {
    showError('상대와의 연결을 복구하지 못했습니다. 처음부터 다시 시작해주세요.');
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
  matchWins = { you: 0, opponent: 0 };
  setScore = { you: 0, opponent: 0 };
  clearSession();
  setPhase('entry');
}

// ── Server message handler ────────────────────────────────────────
function handleServerMessage(msg: any) {
  switch (msg.type) {

    case 'room_created':
      myToken = msg.token;
      roomCode = msg.roomCode;
      roomMode = msg.mode ?? '1v1';
      isHost = true;
      reconnectAttempts = 0;
      matchWins = { you: 0, opponent: 0 };
      setScore = { you: 0, opponent: 0 };

      if (roomMode === '1v1') {
        roomCodeDisplay.textContent = roomCode;
        roomShare.classList.remove('hidden');
        waitingStatus.textContent = '상대를 기다리는 중…';
        setPhase('hosting');
      } else {
        lobbyCodeDisplay.textContent = roomCode;
        lobbyStatus.textContent = '참가자를 기다리는 중…';
        lobbyPlayers.innerHTML = `<div class="lobby-player"><span class="lobby-name">${myName}</span><span class="lobby-badge host">호스트</span></div>`;
        startBtn.classList.add('hidden');
        setPhase('lobby');
      }
      break;

    case 'joined_lobby':
      myToken = msg.token;
      roomCode = msg.roomCode;
      roomMode = msg.mode ?? 'group';
      isHost = false;
      reconnectAttempts = 0;
      lobbyCodeDisplay.textContent = roomCode;
      startBtn.classList.add('hidden');
      setPhase('lobby');
      break;

    case 'lobby_update': {
      roomCode = msg.roomCode ?? roomCode;
      isHost = msg.isHost;
      lobbyCodeDisplay.textContent = roomCode;
      const players = msg.players as any[];
      const connectedCount = players.filter((p: any) => p.connected).length;
      lobbyPlayers.innerHTML = players.map(p =>
        `<div class="lobby-player${p.connected ? '' : ' disconnected'}">
          <span class="lobby-name">${p.name}</span>
          ${p.isHost ? '<span class="lobby-badge host">호스트</span>' : ''}
          ${!p.connected ? '<span class="lobby-badge offline">연결 끊김</span>' : ''}
        </div>`
      ).join('');
      if (msg.canStart) {
        startBtn.classList.remove('hidden');
        lobbyStatus.textContent = `${connectedCount}명 입장 — 시작할 준비가 됐어요!`;
      } else {
        startBtn.classList.add('hidden');
        lobbyStatus.textContent = isHost
          ? `현재 ${connectedCount}명 입장 중 — 더 기다리는 중…`
          : `현재 ${connectedCount}명 입장 중 — 호스트가 시작하기를 기다리는 중…`;
      }
      break;
    }

    case 'matched':
      myToken = msg.token ?? myToken;
      roomCode = msg.roomCode ?? roomCode;
      roomMode = '1v1';
      reconnectAttempts = 0;
      matchWins = { you: 0, opponent: 0 };
      setScore = { you: 0, opponent: 0 };
      enterMatch(msg.opponentName);
      break;

    case 'rejoined':
      reconnectAttempts = 0;
      myToken = msg.token ?? myToken;
      roomCode = msg.roomCode ?? roomCode;
      roomMode = msg.mode ?? '1v1';
      if (roomMode === '1v1') {
        if (msg.opponentName) {
          matchWins = { you: msg.matchWins?.you ?? 0, opponent: msg.matchWins?.opponent ?? 0 };
          setScore = { you: msg.score?.you ?? 0, opponent: msg.score?.opponent ?? 0 };
          enterMatch(msg.opponentName);
          if (!msg.opponentConnected) {
            matchStatus.textContent = '상대가 다시 연결되길 기다리는 중…';
          }
        } else {
          roomCodeDisplay.textContent = roomCode;
          roomShare.classList.remove('hidden');
          waitingStatus.textContent = '상대를 기다리는 중…';
          setPhase('hosting');
        }
      } else {
        if (!msg.started) {
          lobbyCodeDisplay.textContent = roomCode;
          setPhase('lobby');
        }
      }
      break;

    case 'tournament_starting':
    case 'group_starting':
      setPhase('connecting');
      waitingStatus.textContent = '게임을 시작합니다…';
      break;

    case 'match_start':
      matchWins = msg.matchWins ?? { you: 0, opponent: 0 };
      enterMatch(msg.opponentName, msg.round);
      break;

    case 'bye':
      byeStatus.textContent = `라운드 ${msg.round} — 이번 라운드는 쉬어가세요. 다음 라운드를 기다리는 중…`;
      setPhase('bye');
      break;

    case 'opponent_choice_made':
      if (phase === 'choosing') matchStatus.textContent = '상대가 선택을 마쳤습니다. 당신의 차례!';
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
      matchWins = { you: msg.matchWins?.you ?? 0, opponent: msg.matchWins?.opponent ?? 0 };
      setScore = { you: msg.setScore?.you ?? setScore.you, opponent: msg.setScore?.opponent ?? setScore.opponent };
      chantInProgress = true;
      playChantThenReveal(msg, messageGeneration);
      break;

    case 'set_over':
      if (chantInProgress) deferredMessages.push(msg);
      else applySetOver(msg);
      break;

    case 'tournament_state':
      // Update round badge silently if visible
      if (phase === 'choosing' || phase === 'result') {
        roundBadge.textContent = `라운드 ${msg.round}`;
        roundBadge.classList.remove('hidden');
      }
      // 세트를 끝내고 기다리는 동안 다른 대진의 실시간 진행 상황을 보여준다.
      renderLiveStatus(msg.activeMatches, msg.waiting);
      break;

    case 'group_scores': {
      // If we're in round_over, update the standings
      if (phase === 'round_over') renderGroupScores(msg.scores, msg.round, msg.yourToken);
      // While waiting between rounds (set just finished / bye), show other pairs' live progress
      renderLiveStatus(msg.activeMatches, msg.waiting);
      break;
    }

    case 'round_over':
      renderGroupScores(null, msg.round, null);
      roundOverTitle.textContent = `라운드 ${msg.round} 종료`;
      if (isHost) {
        nextRoundBtn.classList.remove('hidden');
        endGroupBtn.classList.remove('hidden');
        waitingNextRound.classList.add('hidden');
      } else {
        nextRoundBtn.classList.add('hidden');
        endGroupBtn.classList.add('hidden');
        waitingNextRound.classList.remove('hidden');
      }
      setPhase('round_over');
      break;

    case 'tournament_winner':
      winnerText.textContent = `🏆 ${msg.winnerName} 우승!`;
      winnerSub.textContent = '토너먼트가 종료됐습니다.';
      setPhase('tournament_winner');
      break;

    case 'group_over':
      if (chantInProgress) deferredMessages.push(msg);
      else applyGroupOver(msg);
      break;

    case 'guest_left':
      // 1v1: guest left, room persists, host waits for new player
      roomCode = msg.roomCode ?? roomCode;
      matchWins = { you: 0, opponent: 0 };
      setScore = { you: 0, opponent: 0 };
      roomCodeDisplay.textContent = roomCode;
      roomShare.classList.remove('hidden');
      waitingStatus.textContent = '상대방이 나갔습니다. 새 참가자를 기다리는 중…';
      setPhase('hosting');
      break;

    case 'host_left':
      leftText.textContent = '방장이 나갔습니다. 방이 종료됩니다.';
      newRoomBtn.classList.add('hidden');
      setPhase('opponent-left');
      break;

    case 'opponent_left':
      leftText.textContent = '상대방이 나갔습니다.';
      newRoomBtn.classList.remove('hidden');
      clearSession();
      setPhase('opponent-left');
      break;

    case 'error':
      if (phase === 'reconnecting') {
        showError(msg.message ?? '재연결에 실패했습니다.');
        clearSession();
      } else {
        showEntryError(msg.message ?? '방에 참가할 수 없습니다.');
        socket?.close();
        socket = null;
        // 재입장(rejoin) 시도가 실패한 거라면, 더 이상 유효하지 않은 세션이니 지운다.
        if (pendingAction?.kind === 'rejoin') clearSession();
        setPhase('entry');
      }
      break;

    default:
      break;
  }

  if (myToken && roomCode) saveSession();
}

function renderLiveStatus(
  activeMatches: { p1Name: string; p2Name: string; p1Wins: number; p2Wins: number }[] | undefined,
  waiting: string[] | undefined
) {
  if (roomMode !== 'group' && roomMode !== 'tournament') return;

  const hasActive = Boolean(activeMatches && activeMatches.length);
  const hasWaiting = Boolean(waiting && waiting.length);
  if (!hasActive && !hasWaiting) {
    setOverLiveStatus.classList.add('hidden');
    byeLiveStatus.classList.add('hidden');
    return;
  }

  const rows = [
    ...(activeMatches ?? []).map(
      (m) => `<div class="live-status-row"><span>${m.p1Name} vs ${m.p2Name}</span><span class="live-status-score">${m.p1Wins} : ${m.p2Wins}</span></div>`
    ),
    ...(waiting ?? []).map((name) => `<div class="live-status-row waiting"><span>${name}</span><span class="live-status-score">대기 중</span></div>`),
  ].join('');
  const title = roomMode === 'tournament' ? '다른 대진 진행 현황' : '다른 조 진행 현황';
  const html = `<p class="live-status-title">${title}</p>${rows}`;

  if (phase === 'set_over') {
    setOverLiveStatus.innerHTML = html;
    setOverLiveStatus.classList.remove('hidden');
  } else if (phase === 'bye') {
    byeLiveStatus.innerHTML = html;
    byeLiveStatus.classList.remove('hidden');
  }
}

function renderGroupScores(scores: any[] | null, round: number, yourToken: string | null) {
  roundOverTitle.textContent = `라운드 ${round} 종료`;
  if (scores) {
    roundScores.innerHTML = scores.map((p, i) =>
      `<div class="scores-row${i === 0 ? ' top' : ''}${p.token === yourToken ? ' me' : ''}">
        <span class="rank">${i + 1}위</span><span>${p.name}</span><span>${p.sets}점</span>
      </div>`
    ).join('');
  }
}

// ── Chant animation ───────────────────────────────────────────────
const CHANT_WORDS = ['가위', '바위', '보!!'];
const CHANT_STEP_MS = 420;

function playChantThenReveal(msg: any, gen: number) {
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
    // 애니메이션이 도는 동안 세트 종료/다음 라운드 등 더 최신 메시지가 이미 도착했다면
    // 그쪽 화면을 건드리지 않고 조용히 중단한다.
    if (gen !== messageGeneration) {
      chantText.classList.add('hidden');
      return;
    }
    chantText.textContent = CHANT_WORDS[step];
    chantText.classList.remove('pop');
    void chantText.offsetWidth;
    chantText.classList.add('pop');
    step++;
    if (step < CHANT_WORDS.length) setTimeout(tick, CHANT_STEP_MS);
    else setTimeout(() => {
      chantText.classList.add('hidden');
      if (gen === messageGeneration) renderResult(msg);
    }, CHANT_STEP_MS);
  };
  tick();
}

function renderResult(msg: any) {
  myScoreEl.textContent = String(setScore.you);
  oppScoreEl.textContent = String(setScore.opponent);
  renderPips(myPips, matchWins.you);
  renderPips(oppPips, matchWins.opponent);

  myHandEl.innerHTML = handIcon(msg.you as Choice);
  oppHandEl.innerHTML = handIcon(msg.opponent as Choice);
  myHandEl.className = 'hand-slot mine reveal';
  oppHandEl.className = 'hand-slot theirs reveal';

  const label = msg.outcome === 'win' ? '승리!' : msg.outcome === 'lose' ? '패배' : '무승부';
  outcomeBanner.textContent = `${label} (나: ${CHOICE_LABEL[msg.you as Choice]} / 상대: ${CHOICE_LABEL[msg.opponent as Choice]})`;
  outcomeBanner.className = `outcome-banner ${msg.outcome}`;
  outcomeBanner.classList.remove('hidden');

  choiceRow.classList.add('hidden');
  matchStatus.textContent = '';
  setPhase('result');
  chantInProgress = false;

  if (deferredMessages.length) {
    // 승부가 갈린 마지막 판: 리빌을 잠깐 더 보여준 뒤, 밀려있던 set_over/group_over를 순서대로 처리한다.
    const queue = deferredMessages;
    deferredMessages = [];
    setTimeout(() => processDeferredQueue(queue), REVEAL_HOLD_MS);
    return;
  }

  if (roomMode === '1v1') {
    matchActions.classList.remove('hidden');
  } else {
    // 그룹전/토너먼트는 세트가 끝나지 않은 개별 판마다 "다음 판" 버튼이 없어서,
    // 결과를 잠깐 보여준 뒤 자동으로 다음 판 선택 화면으로 넘어간다.
    // set_over/round_over 등 다른 메시지가 먼저 phase를 바꿔놨다면 되돌리지 않는다.
    if (autoAdvanceTimer) clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = setTimeout(() => {
      autoAdvanceTimer = null;
      if (phase === 'result') {
        resetArena();
        matchStatus.textContent = '낼 것을 골라주세요';
        setPhase('choosing');
      }
    }, AUTO_ADVANCE_MS);
  }
}

function processDeferredQueue(queue: any[]) {
  const [next, ...rest] = queue;
  if (!next) return;
  if (next.type === 'set_over') applySetOver(next);
  else if (next.type === 'group_over') applyGroupOver(next);
  if (rest.length) setTimeout(() => processDeferredQueue(rest), REVEAL_HOLD_MS);
}

function applySetOver(msg: any) {
  setScore = { you: msg.setScore?.you ?? setScore.you, opponent: msg.setScore?.opponent ?? setScore.opponent };
  matchWins = { you: 0, opponent: 0 };
  setOverResult.textContent = msg.youWon ? '🏆 세트 승리!' : '😞 세트 패배';
  setOverResult.className = 'set-over-result ' + (msg.youWon ? 'win' : 'lose');
  setOverScore.textContent = `${myName} ${setScore.you} : ${setScore.opponent} ${opponentName}`;
  // Hide next-set in tournament/group (match_start will come automatically)
  nextSetBtn.classList.toggle('hidden', roomMode !== '1v1');
  setLeaveBtn.classList.toggle('hidden', roomMode !== '1v1');
  panels.setOver.querySelectorAll('.set-over-waiting-note').forEach((el) => el.remove());
  if (roomMode !== '1v1') {
    const waiting = document.createElement('p');
    waiting.className = 'status-text set-over-waiting-note';
    waiting.textContent = '다음 대진을 기다리는 중…';
    panels.setOver.appendChild(waiting);
  }
  setPhase('set_over');
}

function applyGroupOver(msg: any) {
  const s = (msg.scores as any[]).map((p: any, i: number) =>
    `<div class="scores-row${i === 0 ? ' top' : ''}"><span class="rank">${i + 1}위</span><span>${p.name}</span><span>${p.sets}점</span></div>`
  ).join('');
  winnerText.textContent = msg.winnerName ? `🏆 ${msg.winnerName} 우승!` : '🏁 그룹전 종료';
  winnerSub.textContent = '최종 점수';
  panels.winner.querySelector('.scores-list')?.remove();
  const sl = document.createElement('div');
  sl.className = 'scores-list';
  sl.innerHTML = s;
  panels.winner.insertBefore(sl, winnerSub.nextSibling);
  setPhase('group_over');
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
  roomMode = s.mode;
  resumeBanner.classList.add('hidden');
  connect({ kind: 'rejoin' });
});

resumeDismissBtn.addEventListener('click', () => {
  clearSession();
  resumeBanner.classList.add('hidden');
});

createBtn.addEventListener('click', () => {
  if (!requireName()) return;
  const capacity = Math.min(Math.max(Number(capacityInput.value) || 4, 2), 16);
  connect({ kind: 'create', mode: selectedMode, capacity });
});

joinBtn.addEventListener('click', () => {
  if (!requireName()) return;
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) { showEntryError('방 코드를 입력해주세요.'); return; }
  connect({ kind: 'join', roomCode: code });
});

cancelBtn.addEventListener('click', leaveRoom);
lobbyCancelBtn.addEventListener('click', leaveRoom);

copyLinkBtn.addEventListener('click', () => copyLink(roomCode, copyLinkBtn));
lobbyCopyBtn.addEventListener('click', () => copyLink(roomCode, lobbyCopyBtn));

startBtn.addEventListener('click', () => { send({ type: 'start' }); });

choiceButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    if (myChoice) return;
    const choice = btn.dataset.choice as Choice;
    myChoice = choice;
    choiceButtons.forEach(b => { b.disabled = true; b.classList.toggle('selected', b === btn); });
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
setLeaveBtn.addEventListener('click', leaveRoom);

nextSetBtn.addEventListener('click', () => {
  matchWins = { you: 0, opponent: 0 };
  renderPips(myPips, 0);
  renderPips(oppPips, 0);
  resetArena();
  matchStatus.textContent = '낼 것을 골라주세요';
  setPhase('choosing');
});

nextRoundBtn.addEventListener('click', () => { send({ type: 'next_round' }); setPhase('connecting'); waitingStatus.textContent = '다음 라운드 시작 중…'; });
endGroupBtn.addEventListener('click', () => { send({ type: 'end_group' }); });

newRoomBtn.addEventListener('click', () => {
  myToken = null;
  roomCode = '';
  matchWins = { you: 0, opponent: 0 };
  setScore = { you: 0, opponent: 0 };
  clearSession();
  connect({ kind: 'create', mode: '1v1', capacity: 2 });
});

quitBtn.addEventListener('click', () => {
  intentionalClose = true;
  socket?.close();
  socket = null;
  myToken = null;
  roomCode = '';
  clearSession();
  setPhase('entry');
});

winnerQuitBtn.addEventListener('click', () => {
  intentionalClose = true;
  socket?.close();
  socket = null;
  myToken = null;
  roomCode = '';
  clearSession();
  setPhase('entry');
});

retryBtn.addEventListener('click', () => { if (pendingAction) connect(pendingAction); });

// ── Ranking popup ─────────────────────────────────────────────────
const MODE_LABEL: Record<string, string> = { '1v1': '1:1', group: '그룹전', tournament: '토너먼트' };
const RANK_MEDAL: Record<number, string> = { 0: '🥇', 1: '🥈', 2: '🥉' };
let rankingPrevWeek = '';

async function fetchAndShowRanking(weekParam: 'current' | 'prev') {
  rankingOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  rankingBody.innerHTML = '<div class="ranking-loading"><div class="spinner"></div></div>';

  const url = weekParam === 'prev' && rankingPrevWeek
    ? `${RANKING_URL}?week=${encodeURIComponent(rankingPrevWeek)}`
    : RANKING_URL;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: { week: string; entries: any[]; prevWeek: string } = await res.json();

    rankingPrevWeek = data.prevWeek;
    rankingWeekEl.textContent = data.week;

    if (data.entries.length === 0) {
      rankingBody.innerHTML = '<p class="ranking-empty">아직 이번 주 기록이 없어요.</p>';
      return;
    }

    const rows = data.entries.map((e, i) => {
      const medal = RANK_MEDAL[i] ?? `${i + 1}`;
      const breakdown = Object.entries(e.byMode as Record<string, number>)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `<span class="ranking-mode-chip">${MODE_LABEL[k] ?? k} ${v}</span>`)
        .join('');
      return `
        <div class="ranking-row${i < 3 ? ' top' : ''}">
          <span class="ranking-rank">${medal}</span>
          <span class="ranking-name">${e.name}</span>
          <span class="ranking-total">${e.total}점</span>
          <div class="ranking-chips">${breakdown}</div>
        </div>`;
    }).join('');

    rankingBody.innerHTML = rows;
  } catch {
    rankingBody.innerHTML = '<p class="ranking-empty">랭킹을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
  }
}

function closeRanking() {
  rankingOverlay.classList.add('hidden');
  document.body.style.overflow = '';
}

rankingBtnEl.addEventListener('click', () => {
  rankingTabBtns.forEach(b => b.classList.toggle('active', b.dataset.week === 'current'));
  fetchAndShowRanking('current');
});

rankingClose.addEventListener('click', closeRanking);
rankingOverlay.addEventListener('click', (e) => { if (e.target === rankingOverlay) closeRanking(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRanking(); });

rankingTabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    rankingTabBtns.forEach(b => b.classList.toggle('active', b === btn));
    fetchAndShowRanking(btn.dataset.week as 'current' | 'prev');
  });
});

setPhase('entry');
