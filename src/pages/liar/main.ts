import './liar.css';
import '../../shared/ws-ranking.css';
import { shareRoomLink } from '../../shared/share';
import { createChatWidget } from '../../shared/chat-widget';
import { setupWsRankingUI } from '../../shared/ws-ranking';

type Phase =
  | 'entry' | 'connecting' | 'lobby'
  | 'describe' | 'vote' | 'revote'
  | 'liar_guess' | 'waiting_guess' | 'round_result'
  | 'reconnecting' | 'error';

type PendingAction = { kind: 'create'; capacity: number } | { kind: 'join'; roomCode: string } | { kind: 'rejoin' };

const WS_URL = (() => {
  const c = import.meta.env.VITE_LIAR_WS_URL as string | undefined;
  if (c) return c;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8787/liar`;
})();

const NAME_KEY = 'run-hoban-run:liar-nickname';
const SESSION_KEY = 'run-hoban-run:liar-session';
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
let isHost = false;
let pendingAction: PendingAction | null = null;
let intentionalClose = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const chatWidget = createChatWidget({
  channels: [{ id: 'general', label: '채팅' }],
  position: 'right',
  onSend: (_channelId, text) => send({ type: 'submit_chat', text }),
});
// setPhase가 호출될 때마다 증가하는 세대 번호. 재접속/타이머 등 비동기 콜백이 실행되는
// 시점에 화면이 이미 다른 곳으로 넘어갔으면(세대 번호가 달라졌으면) 조용히 무시한다.
let messageGeneration = 0;

let myRole: 'citizen' | 'liar' | null = null;
let category = '';
let word = ''; // 라이어에게는 서버가 애초에 안 보내므로 클라 상태도 항상 빈 값
let turnOrder: { token: string; name: string }[] = [];
let currentTurnToken: string | null = null;
let transcript: { token: string; name: string; text: string }[] = [];
let votedFor: string | null = null;

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

<div class="liar-shell">
  <div class="liar-top-bar">
    <a class="back-link" href="/">← 게임 선택</a>
    <button class="ws-ranking-btn" id="ws-ranking-btn" type="button">🏆 이번 주 랭킹</button>
  </div>
  <div class="liar-stage">
    <h1 class="liar-title">라이어게임</h1>
    <p class="liar-sub" id="liar-sub">라이어만 제시어를 모릅니다. 눈치껏 설명하고, 투표로 찾아내세요</p>

    <!-- Entry -->
    <div class="liar-panel" id="entry-panel">
      <div class="resume-banner hidden" id="resume-banner">
        <p class="status-text" id="resume-text">이전에 참여하던 방이 있어요.</p>
        <div class="resume-actions">
          <button id="resume-btn" type="button" class="liar-btn primary">재입장하기</button>
          <button id="resume-dismiss-btn" type="button" class="liar-btn secondary">새로 시작</button>
        </div>
      </div>

      <label class="field-label" for="nickname">닉네임</label>
      <input id="nickname" type="text" maxlength="20" placeholder="닉네임을 입력하세요" class="nickname-input" />

      <div class="entry-tabs" role="tablist">
        <button id="tab-create" type="button" class="entry-tab active" role="tab">방 만들기</button>
        <button id="tab-join" type="button" class="entry-tab" role="tab">방 참가하기</button>
      </div>

      <div class="entry-section" id="create-section">
        <label class="field-label" for="capacity-input">인원 수 (3~12)</label>
        <input id="capacity-input" type="number" min="3" max="12" value="6" class="nickname-input capacity-input" />
        <button id="create-btn" type="button" class="liar-btn primary">방 만들기</button>
      </div>

      <div class="entry-section hidden" id="join-section">
        <label class="field-label" for="room-code-input">방 코드</label>
        <input id="room-code-input" type="text" maxlength="6" placeholder="예: 3F9A2C" class="nickname-input room-code-input" />
        <button id="join-btn" type="button" class="liar-btn primary">참가하기</button>
      </div>

      <p class="entry-error hidden" id="entry-error"></p>
    </div>

    <!-- Waiting / reconnecting -->
    <div class="liar-panel hidden" id="waiting-panel">
      <div class="spinner" aria-hidden="true"></div>
      <p class="status-text" id="waiting-status">서버에 연결하는 중…</p>
      <button id="cancel-btn" type="button" class="liar-btn secondary">취소</button>
    </div>

    <!-- Lobby -->
    <div class="liar-panel hidden" id="lobby-panel">
      <div class="room-share" id="lobby-share">
        <span class="room-share-label">방 코드</span>
        <span class="room-code-display" id="lobby-code-display"></span>
        <button id="lobby-copy-btn" type="button" class="liar-btn secondary">공유하기</button>
      </div>
      <div class="lobby-players" id="lobby-players"></div>
      <div class="how-to-play">
        <p class="how-to-play-title">🎮 게임 방법</p>
        <ul class="how-to-play-list">
          <li>라이어 한 명만 제시어를 모른 채 카테고리만 알아요. 나머지는 제시어를 알고 있어요.</li>
          <li>순서대로 한마디씩 설명한 뒤, 투표로 라이어를 찾아내세요.</li>
          <li>라이어가 걸려도 제시어를 맞히면 라이어가 역전승해요!</li>
        </ul>
      </div>
      <p class="status-text" id="lobby-status">참가자를 기다리는 중…</p>
      <button id="start-btn" type="button" class="liar-btn primary hidden">게임 시작</button>
      <button id="lobby-cancel-btn" type="button" class="liar-btn secondary">나가기</button>
    </div>

    <!-- Describe -->
    <div class="liar-panel hidden" id="describe-panel">
      <div class="role-card" id="role-card"></div>
      <div class="transcript" id="describe-transcript"></div>
      <p class="status-text" id="describe-status"></p>
      <div class="describe-input-row hidden" id="describe-input-row">
        <input id="describe-input" type="text" maxlength="80" placeholder="제시어에 대한 한마디 설명" class="nickname-input" />
        <button id="describe-submit-btn" type="button" class="liar-btn primary">제출</button>
      </div>
    </div>

    <!-- Vote / revote -->
    <div class="liar-panel hidden" id="vote-panel">
      <div class="role-card" id="vote-role-card"></div>
      <p class="status-text" id="vote-banner"></p>
      <div class="transcript compact" id="vote-transcript"></div>
      <p class="field-label">라이어로 의심되는 사람에게 투표하세요</p>
      <div class="vote-targets" id="vote-targets"></div>
      <p class="status-text" id="vote-progress-text"></p>
    </div>

    <!-- Liar guess (라이어 전용) -->
    <div class="liar-panel hidden" id="liar-guess-panel">
      <p class="set-over-result">😳 지목당했습니다!</p>
      <p class="status-text" id="liar-guess-category"></p>
      <p class="field-label">마지막 기회 — 제시어를 맞혀보세요</p>
      <div class="describe-input-row">
        <input id="liar-guess-input" type="text" maxlength="40" placeholder="제시어 입력" class="nickname-input" />
        <button id="liar-guess-submit-btn" type="button" class="liar-btn primary">제출</button>
      </div>
    </div>

    <!-- Waiting for liar's guess -->
    <div class="liar-panel hidden" id="waiting-guess-panel">
      <div class="spinner" aria-hidden="true"></div>
      <p class="status-text">라이어가 제시어를 맞히는 중…</p>
    </div>

    <!-- Round result -->
    <div class="liar-panel hidden" id="round-result-panel">
      <p class="set-over-result" id="result-banner"></p>
      <p class="status-text" id="result-detail"></p>
      <div class="result-answer" id="result-answer"></div>
      <button id="next-round-btn" type="button" class="liar-btn primary hidden">다음 라운드</button>
      <p class="status-text hidden" id="waiting-next-round">호스트가 다음 라운드를 시작하기를 기다리는 중…</p>
      <button id="result-leave-btn" type="button" class="liar-btn secondary">나가기</button>
    </div>

    <!-- Error -->
    <div class="liar-panel hidden" id="error-panel">
      <p class="status-text" id="error-text">게임 서버에 연결할 수 없습니다.</p>
      <button id="retry-btn" type="button" class="liar-btn primary">다시 시도</button>
    </div>
  </div>
</div>
`;

// ── Refs ──────────────────────────────────────────────────────────
setupWsRankingUI({
  gameKey: 'liar',
  gameTitle: '라이어게임',
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
  describe: document.getElementById('describe-panel')!,
  vote: document.getElementById('vote-panel')!,
  liarGuess: document.getElementById('liar-guess-panel')!,
  waitingGuess: document.getElementById('waiting-guess-panel')!,
  roundResult: document.getElementById('round-result-panel')!,
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

const roleCard = document.getElementById('role-card')!;
const describeTranscript = document.getElementById('describe-transcript')!;
const describeStatus = document.getElementById('describe-status')!;
const describeInputRow = document.getElementById('describe-input-row')!;
const describeInput = document.getElementById('describe-input') as HTMLInputElement;
const describeSubmitBtn = document.getElementById('describe-submit-btn') as HTMLButtonElement;

const voteRoleCard = document.getElementById('vote-role-card')!;
const voteBanner = document.getElementById('vote-banner')!;
const voteTranscript = document.getElementById('vote-transcript')!;
const voteTargets = document.getElementById('vote-targets')!;
const voteProgressText = document.getElementById('vote-progress-text')!;

const liarGuessCategory = document.getElementById('liar-guess-category')!;
const liarGuessInput = document.getElementById('liar-guess-input') as HTMLInputElement;
const liarGuessSubmitBtn = document.getElementById('liar-guess-submit-btn') as HTMLButtonElement;

const resultBanner = document.getElementById('result-banner')!;
const resultDetail = document.getElementById('result-detail')!;
const resultAnswer = document.getElementById('result-answer')!;
const nextRoundBtn = document.getElementById('next-round-btn') as HTMLButtonElement;
const waitingNextRound = document.getElementById('waiting-next-round')!;
const resultLeaveBtn = document.getElementById('result-leave-btn') as HTMLButtonElement;

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

function setPhase(next: Phase) {
  messageGeneration++;
  phase = next;
  const vis = (el: HTMLElement, show: boolean) => el.classList.toggle('hidden', !show);
  vis(panels.entry, next === 'entry');
  vis(panels.waiting, next === 'connecting' || next === 'reconnecting');
  vis(panels.lobby, next === 'lobby');
  vis(panels.describe, next === 'describe');
  vis(panels.vote, next === 'vote' || next === 'revote');
  vis(panels.liarGuess, next === 'liar_guess');
  vis(panels.waitingGuess, next === 'waiting_guess');
  vis(panels.roundResult, next === 'round_result');
  vis(panels.error, next === 'error');
}

function showEntryError(msg: string) { entryError.textContent = msg; entryError.classList.remove('hidden'); }
function hideEntryError() { entryError.classList.add('hidden'); }

async function copyLink(code: string, btn: HTMLButtonElement) {
  const link = `${location.origin}/liar/?room=${code}`;
  await shareRoomLink({ url: link, title: '라이어게임 초대', text: `라이어게임 방(${code})에 초대할게요!`, btn });
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
    const inGame = ['lobby', 'describe', 'vote', 'revote', 'liar_guess', 'waiting_guess', 'round_result', 'reconnecting'].includes(phase);
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
  myRole = null;
  category = '';
  word = '';
  turnOrder = [];
  currentTurnToken = null;
  transcript = [];
  votedFor = null;
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

function renderRoleCard(el: HTMLElement) {
  if (myRole === 'liar') {
    el.className = 'role-card liar';
    el.innerHTML = `
      <p class="role-card-badge">🎭 당신은 라이어입니다</p>
      <p class="role-card-category">카테고리: <strong>${category}</strong></p>
      <p class="role-card-hint">제시어는 비공개예요. 눈치껏 설명해서 들키지 마세요!</p>`;
  } else {
    el.className = 'role-card citizen';
    el.innerHTML = `
      <p class="role-card-badge">🙂 당신은 시민입니다</p>
      <p class="role-card-category">카테고리: <strong>${category}</strong></p>
      <p class="role-card-word">제시어: <strong>${word}</strong></p>`;
  }
}

function renderTranscript(el: HTMLElement) {
  el.innerHTML = transcript.map(t =>
    `<div class="transcript-row"><span class="transcript-name">${t.name}</span><span class="transcript-text">${t.text}</span></div>`
  ).join('');
  el.scrollTop = el.scrollHeight;
}

function renderVoteTargets(players: { token: string; name: string }[]) {
  voteTargets.innerHTML = players
    .filter(p => p.token !== myToken)
    .map(p => `<button type="button" class="vote-target-btn" data-token="${p.token}">${p.name}</button>`)
    .join('');
  Array.from(voteTargets.querySelectorAll<HTMLButtonElement>('.vote-target-btn')).forEach(btn => {
    btn.addEventListener('click', () => {
      if (votedFor) return;
      votedFor = btn.dataset.token!;
      Array.from(voteTargets.querySelectorAll<HTMLButtonElement>('.vote-target-btn')).forEach(b => {
        b.disabled = true;
        b.classList.toggle('selected', b === btn);
      });
      voteProgressText.textContent = '투표완료! 다른 사람을 기다리는 중…';
      send({ type: 'submit_vote', targetToken: votedFor });
    });
  });
}

// ── Server message handler ────────────────────────────────────────
function handleServerMessage(msg: any) {
  switch (msg.type) {

    case 'room_created':
      myToken = msg.token;
      roomCode = msg.roomCode;
      isHost = true;
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
      const players = msg.players as { name: string; isHost: boolean; connected: boolean }[];
      const connectedCount = players.filter(p => p.connected).length;
      renderLobbyPlayers(players);
      if (msg.canStart) {
        startBtn.classList.remove('hidden');
        lobbyStatus.textContent = `${connectedCount}명 입장 — 시작할 준비가 됐어요! (최소 3명)`;
      } else {
        startBtn.classList.add('hidden');
        lobbyStatus.textContent = isHost
          ? `현재 ${connectedCount}명 입장 중 — 최소 3명이 필요해요…`
          : `현재 ${connectedCount}명 입장 중 — 호스트가 시작하기를 기다리는 중…`;
      }
      break;
    }

    case 'rejoined': {
      reconnectAttempts = 0;
      myToken = msg.token ?? myToken;
      roomCode = msg.roomCode ?? roomCode;
      isHost = (msg.players as any[])?.find((p: any) => p.name === myName)?.isHost ?? isHost;
      if (!msg.started || msg.phase === 'lobby') {
        lobbyCodeDisplay.textContent = roomCode;
        renderLobbyPlayers(msg.players ?? []);
        setPhase('lobby');
        break;
      }
      const round = msg.round;
      myRole = round.role;
      category = round.category;
      word = round.word ?? '';
      turnOrder = round.turnOrder ?? [];
      currentTurnToken = round.currentTurnToken;
      transcript = round.transcript ?? [];
      if (round.phase === 'describe' || msg.phase === 'describe') {
        enterDescribePhase();
      } else if (round.phase === 'vote' || round.phase === 'revote' || msg.phase === 'vote' || msg.phase === 'revote') {
        votedFor = round.voteStatus?.yourVote ?? null;
        enterVotePhase(turnOrder, msg.phase === 'revote');
      } else {
        setPhase('reconnecting'); // 알 수 없는 중간 상태 — 다음 서버 메시지를 기다린다
      }
      break;
    }

    case 'round_starting':
      setPhase('connecting');
      waitingStatus.textContent = '게임을 시작합니다…';
      break;

    case 'role_assigned':
      myRole = msg.role;
      category = msg.category;
      word = msg.word ?? '';
      break;

    case 'turn_order':
      turnOrder = msg.order;
      currentTurnToken = msg.currentTurnToken;
      transcript = [];
      votedFor = null;
      enterDescribePhase();
      break;

    case 'description_submitted':
      transcript.push({ token: msg.token, name: msg.name, text: msg.text });
      renderTranscript(describeTranscript);
      break;

    case 'next_turn':
      currentTurnToken = msg.currentTurnToken;
      updateDescribeTurnUI();
      break;

    case 'vote_phase_start':
      votedFor = null;
      enterVotePhase(msg.players, false);
      break;

    case 'vote_progress':
      if (!votedFor) voteProgressText.textContent = `${msg.votedCount}/${msg.totalCount}명 투표 완료 — 아직 투표하지 않으셨어요`;
      else voteProgressText.textContent = `${msg.votedCount}/${msg.totalCount}명 투표 완료`;
      break;

    case 'revote_start':
      votedFor = null;
      voteBanner.textContent = '⚖️ 동률입니다! 다시 투표해주세요';
      enterVotePhase(turnOrder, true);
      break;

    case 'vote_reveal':
      // 결과는 곧이어 오는 liar_guess_start/waiting_for_liar_guess/round_result가 화면을 이어받는다.
      break;

    case 'liar_guess_start':
      liarGuessCategory.textContent = `카테고리: ${msg.category}`;
      liarGuessInput.value = '';
      setPhase('liar_guess');
      break;

    case 'waiting_for_liar_guess':
      setPhase('waiting_guess');
      break;

    case 'round_aborted':
      resetGameState();
      lobbyStatus.textContent = '인원이 부족해 로비로 돌아왔어요.';
      setPhase('lobby');
      break;

    case 'chat_message':
      chatWidget.addMessage('general', { name: msg.name, text: msg.text, mine: msg.token === myToken });
      break;

    case 'round_result':
      renderRoundResult(msg);
      break;

    case 'player_disconnected':
      lobbyStatus.textContent = `${msg.name}님의 연결이 불안정합니다…`;
      break;

    case 'player_reconnected':
      break;

    case 'host_left':
      showError('방장이 나가 방이 종료됐습니다.');
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

function enterDescribePhase() {
  renderRoleCard(roleCard);
  renderTranscript(describeTranscript);
  updateDescribeTurnUI();
  setPhase('describe');
}

function updateDescribeTurnUI() {
  const myTurn = currentTurnToken === myToken;
  describeInputRow.classList.toggle('hidden', !myTurn);
  if (myTurn) {
    describeStatus.textContent = '당신의 차례입니다! 한마디 설명을 입력하세요';
    describeInput.value = '';
    describeInput.disabled = false;
    describeSubmitBtn.disabled = false;
    describeInput.focus();
  } else {
    const currentName = turnOrder.find(t => t.token === currentTurnToken)?.name ?? '?';
    describeStatus.textContent = `${currentName}님의 차례를 기다리는 중…`;
  }
}

function enterVotePhase(players: { token: string; name: string }[], isRevote: boolean) {
  renderRoleCard(voteRoleCard);
  renderTranscript(voteTranscript);
  renderVoteTargets(players);
  if (!isRevote) voteBanner.textContent = '전원이 설명을 마쳤습니다. 라이어를 지목하세요';
  voteProgressText.textContent = votedFor ? '투표완료! 다른 사람을 기다리는 중…' : '';
  setPhase(isRevote ? 'revote' : 'vote');
}

function renderRoundResult(msg: any) {
  const won = msg.winner === 'liar' ? '라이어' : msg.winner === 'citizens' ? '시민' : '무승부';
  resultBanner.textContent = msg.winner === 'draw' ? '🤝 무승부' : `🏆 ${won} 승리!`;
  resultBanner.className = 'set-over-result ' + (msg.winner === 'liar' ? 'lose' : msg.winner === 'citizens' ? 'win' : '');

  const reasonText: Record<string, string> = {
    not_accused: `${msg.accusedName}님이 지목됐지만 라이어가 아니었어요.`,
    liar_guess: msg.guessCorrect ? `라이어가 제시어("${msg.guess}")를 맞혔어요!` : `라이어가 제시어를 맞히지 못했어요. (입력: "${msg.guess || '(없음)'}")`,
    tie_twice: '재투표에서도 동률이 나와 승부를 가리지 못했어요.',
    liar_left: '라이어가 방을 나가 시민 승리로 처리됐어요.',
  };
  resultDetail.textContent = reasonText[msg.reason] ?? '';
  resultAnswer.innerHTML = `<div class="scores-row"><span>카테고리</span><span>${msg.category}</span></div>
    <div class="scores-row"><span>제시어</span><span>${msg.word}</span></div>
    <div class="scores-row"><span>라이어</span><span>${msg.liarName}</span></div>`;

  nextRoundBtn.classList.toggle('hidden', !isHost);
  waitingNextRound.classList.toggle('hidden', isHost);
  resetGameState();
  setPhase('round_result');
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
  const capacity = Math.min(Math.max(Number(capacityInput.value) || 6, 3), 12);
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
resultLeaveBtn.addEventListener('click', leaveRoom);

lobbyCopyBtn.addEventListener('click', () => copyLink(roomCode, lobbyCopyBtn));

startBtn.addEventListener('click', () => { send({ type: 'start' }); });

describeSubmitBtn.addEventListener('click', () => {
  const text = describeInput.value.trim().slice(0, 80);
  if (!text) return;
  describeInputRow.classList.add('hidden');
  describeStatus.textContent = '제출했습니다. 다른 사람의 차례를 기다리는 중…';
  send({ type: 'submit_description', text });
});
describeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') describeSubmitBtn.click(); });

liarGuessSubmitBtn.addEventListener('click', () => {
  const guess = liarGuessInput.value.trim().slice(0, 40);
  if (!guess) return;
  liarGuessSubmitBtn.disabled = true;
  send({ type: 'submit_guess', guess });
});
liarGuessInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') liarGuessSubmitBtn.click(); });

nextRoundBtn.addEventListener('click', () => {
  send({ type: 'start' });
  setPhase('connecting');
  waitingStatus.textContent = '다음 라운드 시작 중…';
});

retryBtn.addEventListener('click', () => { if (pendingAction) connect(pendingAction); });

setPhase('entry');
