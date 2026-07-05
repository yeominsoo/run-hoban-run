import './mafia.css';
import { shareRoomLink } from '../../shared/share';

type Phase =
  | 'entry' | 'connecting' | 'lobby'
  | 'night' | 'day' | 'day_revote'
  | 'game_over'
  | 'reconnecting' | 'error';

type Role = 'mafia' | 'police' | 'doctor' | 'citizen';
type PendingAction = { kind: 'create'; capacity: number } | { kind: 'join'; roomCode: string } | { kind: 'rejoin' };

const WS_URL = (() => {
  const c = import.meta.env.VITE_MAFIA_WS_URL as string | undefined;
  if (c) return c;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8787/mafia`;
})();

const NAME_KEY = 'run-hoban-run:mafia-nickname';
const SESSION_KEY = 'run-hoban-run:mafia-session';
const RECONNECT_RETRY_MS = 2000;
const RECONNECT_MAX = 24;

const ROLE_LABEL: Record<Role, string> = { mafia: '마피아', police: '경찰', doctor: '의사', citizen: '시민' };

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
let messageGeneration = 0;

type AliveEntry = { token: string; name: string };

let myRole: Role | null = null;
let teammates: AliveEntry[] = [];
let isAlive = true;
let round = 0;
let alivePlayers: AliveEntry[] = [];
let myActionSubmitted = false;
let myVoteSubmitted: string | null = null;
let policeHistory: { round: number; targetName: string; isMafia: boolean }[] = [];
let chatLog: { token: string; name: string; text: string }[] = [];

// ── HTML ──────────────────────────────────────────────────────────
const app = document.getElementById('app')!;
app.innerHTML = `
<div class="mafia-shell">
  <div class="mafia-top-bar">
    <a class="back-link" href="/">← 게임 선택</a>
  </div>
  <div class="mafia-stage">
    <h1 class="mafia-title">마피아게임</h1>
    <p class="mafia-sub">밤에는 은밀히 행동하고, 낮에는 토론과 투표로 마피아를 찾아내세요</p>

    <!-- Entry -->
    <div class="mafia-panel" id="entry-panel">
      <div class="resume-banner hidden" id="resume-banner">
        <p class="status-text" id="resume-text">이전에 참여하던 방이 있어요.</p>
        <div class="resume-actions">
          <button id="resume-btn" type="button" class="mafia-btn primary">재입장하기</button>
          <button id="resume-dismiss-btn" type="button" class="mafia-btn secondary">새로 시작</button>
        </div>
      </div>

      <label class="field-label" for="nickname">닉네임</label>
      <input id="nickname" type="text" maxlength="20" placeholder="닉네임을 입력하세요" class="nickname-input" />

      <div class="entry-tabs" role="tablist">
        <button id="tab-create" type="button" class="entry-tab active" role="tab">방 만들기</button>
        <button id="tab-join" type="button" class="entry-tab" role="tab">방 참가하기</button>
      </div>

      <div class="entry-section" id="create-section">
        <label class="field-label" for="capacity-input">인원 수 (4~12)</label>
        <input id="capacity-input" type="number" min="4" max="12" value="8" class="nickname-input capacity-input" />
        <button id="create-btn" type="button" class="mafia-btn primary">방 만들기</button>
      </div>

      <div class="entry-section hidden" id="join-section">
        <label class="field-label" for="room-code-input">방 코드</label>
        <input id="room-code-input" type="text" maxlength="6" placeholder="예: 3F9A2C" class="nickname-input room-code-input" />
        <button id="join-btn" type="button" class="mafia-btn primary">참가하기</button>
      </div>

      <p class="entry-error hidden" id="entry-error"></p>
    </div>

    <!-- Waiting / reconnecting -->
    <div class="mafia-panel hidden" id="waiting-panel">
      <div class="spinner" aria-hidden="true"></div>
      <p class="status-text" id="waiting-status">서버에 연결하는 중…</p>
      <button id="cancel-btn" type="button" class="mafia-btn secondary">취소</button>
    </div>

    <!-- Lobby -->
    <div class="mafia-panel hidden" id="lobby-panel">
      <div class="room-share" id="lobby-share">
        <span class="room-share-label">방 코드</span>
        <span class="room-code-display" id="lobby-code-display"></span>
        <button id="lobby-copy-btn" type="button" class="mafia-btn secondary">공유하기</button>
      </div>
      <div class="lobby-players" id="lobby-players"></div>
      <p class="status-text" id="lobby-status">참가자를 기다리는 중…</p>
      <button id="start-btn" type="button" class="mafia-btn primary hidden">게임 시작</button>
      <button id="lobby-cancel-btn" type="button" class="mafia-btn secondary">나가기</button>
    </div>

    <!-- Night -->
    <div class="mafia-panel hidden" id="night-panel">
      <div class="role-card" id="night-role-card"></div>
      <p class="status-text" id="night-status"></p>
      <div class="target-row hidden" id="night-target-row"></div>
      <p class="status-text muted hidden" id="night-progress-text"></p>
    </div>

    <!-- Day -->
    <div class="mafia-panel hidden" id="day-panel">
      <p class="field-label" id="day-title">낮이 밝았습니다</p>
      <p class="status-text" id="day-death-announce"></p>
      <div class="chat-log" id="chat-log"></div>
      <div class="chat-input-row" id="chat-input-row">
        <input id="chat-input" type="text" maxlength="120" placeholder="채팅을 입력하세요" class="nickname-input" />
        <button id="chat-send-btn" type="button" class="mafia-btn primary">전송</button>
      </div>
      <p class="field-label" id="vote-label">처형할 사람에게 투표하세요</p>
      <div class="target-row" id="day-vote-targets"></div>
      <p class="status-text muted" id="day-vote-progress-text"></p>
    </div>

    <!-- Game over -->
    <div class="mafia-panel hidden" id="game-over-panel">
      <p class="set-over-result" id="game-over-banner"></p>
      <div class="roles-list" id="roles-list"></div>
      <button id="game-over-leave-btn" type="button" class="mafia-btn secondary">나가기</button>
    </div>

    <!-- Error -->
    <div class="mafia-panel hidden" id="error-panel">
      <p class="status-text" id="error-text">게임 서버에 연결할 수 없습니다.</p>
      <button id="retry-btn" type="button" class="mafia-btn primary">다시 시도</button>
    </div>
  </div>
</div>
`;

// ── Refs ──────────────────────────────────────────────────────────
const panels = {
  entry: document.getElementById('entry-panel')!,
  waiting: document.getElementById('waiting-panel')!,
  lobby: document.getElementById('lobby-panel')!,
  night: document.getElementById('night-panel')!,
  day: document.getElementById('day-panel')!,
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

const nightRoleCard = document.getElementById('night-role-card')!;
const nightStatus = document.getElementById('night-status')!;
const nightTargetRow = document.getElementById('night-target-row')!;
const nightProgressText = document.getElementById('night-progress-text')!;

const dayTitle = document.getElementById('day-title')!;
const dayDeathAnnounce = document.getElementById('day-death-announce')!;
const chatLogEl = document.getElementById('chat-log')!;
const chatInputRow = document.getElementById('chat-input-row')!;
const chatInput = document.getElementById('chat-input') as HTMLInputElement;
const chatSendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement;
const voteLabel = document.getElementById('vote-label')!;
const dayVoteTargets = document.getElementById('day-vote-targets')!;
const dayVoteProgressText = document.getElementById('day-vote-progress-text')!;

const gameOverBanner = document.getElementById('game-over-banner')!;
const rolesList = document.getElementById('roles-list')!;
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
  vis(panels.night, next === 'night');
  vis(panels.day, next === 'day' || next === 'day_revote');
  vis(panels.gameOver, next === 'game_over');
  vis(panels.error, next === 'error');
}

function showEntryError(msg: string) { entryError.textContent = msg; entryError.classList.remove('hidden'); }
function hideEntryError() { entryError.classList.add('hidden'); }

async function copyLink(code: string, btn: HTMLButtonElement) {
  const link = `${location.origin}/mafia/?room=${code}`;
  await shareRoomLink({ url: link, title: '마피아게임 초대', text: `마피아게임 방(${code})에 초대할게요!`, btn });
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
    const inGame = ['lobby', 'night', 'day', 'day_revote', 'reconnecting'].includes(phase);
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
  teammates = [];
  isAlive = true;
  round = 0;
  alivePlayers = [];
  myActionSubmitted = false;
  myVoteSubmitted = null;
  policeHistory = [];
  chatLog = [];
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

function renderRoleCard() {
  const cls = myRole === 'mafia' ? 'mafia' : myRole === 'police' ? 'police' : myRole === 'doctor' ? 'doctor' : 'citizen';
  nightRoleCard.className = 'role-card ' + cls;
  const badge = `${myRole ? ROLE_LABEL[myRole] : '?'}${!isAlive ? ' (사망)' : ''}`;
  let extra = '';
  if (myRole === 'mafia') {
    const names = teammates.map(t => t.name).join(', ') || '(없음)';
    extra = `<p class="role-card-detail">동료 마피아: <strong>${names}</strong></p>`;
  } else if (myRole === 'police' && policeHistory.length) {
    const rows = policeHistory.map(h => `${h.round}일차: ${h.targetName} → ${h.isMafia ? '마피아!' : '무고함'}`).join('<br/>');
    extra = `<p class="role-card-detail">조사 기록<br/>${rows}</p>`;
  }
  nightRoleCard.innerHTML = `<p class="role-card-badge">${badge}</p>${extra}`;
}

function renderTargetButtons(row: HTMLElement, entries: AliveEntry[], onPick: (targetToken: string) => void, excludeSelf: boolean) {
  const candidates = excludeSelf ? entries.filter(e => e.token !== myToken) : entries;
  row.innerHTML = candidates.map(e => `<button type="button" class="target-btn" data-token="${e.token}">${e.name}</button>`).join('');
  Array.from(row.querySelectorAll<HTMLButtonElement>('.target-btn')).forEach(btn => {
    btn.addEventListener('click', () => onPick(btn.dataset.token!));
  });
}

function renderChatLog() {
  chatLogEl.innerHTML = chatLog.map(c =>
    `<div class="chat-row"><span class="chat-name">${c.name}</span><span class="chat-text">${c.text}</span></div>`
  ).join('');
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
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
        lobbyStatus.textContent = `${connectedCount}명 입장 — 시작할 준비가 됐어요! (최소 4명)`;
      } else {
        startBtn.classList.add('hidden');
        lobbyStatus.textContent = isHost
          ? `현재 ${connectedCount}명 입장 중 — 최소 4명이 필요해요…`
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
      const game = msg.game;
      myRole = game.role;
      teammates = game.teammates ?? [];
      isAlive = game.isAlive;
      round = game.round;
      alivePlayers = game.alive ?? [];
      policeHistory = game.policeHistory ?? [];
      chatLog = game.chatLog ?? [];
      if (game.phase === 'night') {
        enterNight({ round, alive: alivePlayers, yourActionRequired: isAlive && myRole !== 'citizen' });
      } else {
        enterDay({ round, alive: alivePlayers, deaths: [] });
      }
      break;
    }

    case 'game_starting':
      setPhase('connecting');
      waitingStatus.textContent = '게임을 시작합니다…';
      break;

    case 'role_assigned':
      myRole = msg.role;
      teammates = msg.teammates ?? [];
      isAlive = true;
      break;

    case 'night_start':
      round = msg.round;
      alivePlayers = msg.alive;
      enterNight(msg);
      break;

    case 'night_action_progress':
      if (phase === 'night' && !myActionSubmitted) {
        nightProgressText.textContent = `${msg.actedCount}/${msg.totalCount}명 행동 완료`;
        nightProgressText.classList.remove('hidden');
      }
      break;

    case 'police_result': {
      policeHistory.push({ round, targetName: msg.targetName, isMafia: msg.isMafia });
      if (phase === 'night') renderRoleCard();
      break;
    }

    case 'day_start':
      round = msg.round;
      alivePlayers = msg.alive;
      if ((msg.deaths as any[]).some((d: any) => d.token === myToken)) isAlive = false;
      enterDay(msg);
      break;

    case 'chat_message':
      chatLog.push({ token: msg.token, name: msg.name, text: msg.text });
      renderChatLog();
      break;

    case 'day_vote_progress':
      dayVoteProgressText.textContent = `${msg.votedCount}/${msg.totalCount}명 투표 완료`;
      break;

    case 'day_revote_start':
      myVoteSubmitted = null;
      voteLabel.textContent = '⚖️ 동률입니다! 다시 투표해주세요';
      renderTargetButtons(dayVoteTargets, msg.tiedCandidates, submitDayVote, true);
      setPhase('day_revote');
      break;

    case 'day_vote_reveal': {
      const summary = msg.noExecution
        ? (msg.isTie ? '⚖️ 동률로 처형이 무산됐습니다.' : '아무도 투표하지 않아 처형이 무산됐습니다.')
        : `⚖️ ${msg.executedName}님이 처형됐습니다.`;
      dayDeathAnnounce.textContent = summary;
      dayVoteTargets.innerHTML = '';
      chatInputRow.classList.add('hidden');
      voteLabel.classList.add('hidden');
      break;
    }

    case 'round_aborted':
      resetGameState();
      lobbyStatus.textContent = '인원이 부족해 로비로 돌아왔어요.';
      setPhase('lobby');
      break;

    case 'game_over':
      renderGameOver(msg);
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

function enterNight(msg: { round: number; alive: AliveEntry[]; yourActionRequired: boolean }) {
  myActionSubmitted = false;
  renderRoleCard();
  nightProgressText.classList.add('hidden');

  if (!isAlive) {
    nightStatus.textContent = `${msg.round}일차 밤 — 당신은 사망했습니다. 관전 중입니다.`;
    nightTargetRow.classList.add('hidden');
  } else if (msg.yourActionRequired && myRole) {
    const actionLabel = myRole === 'mafia' ? '살해할 대상을' : myRole === 'police' ? '조사할 대상을' : '보호할 대상을';
    nightStatus.textContent = `${msg.round}일차 밤 — ${actionLabel} 선택하세요`;
    nightTargetRow.classList.remove('hidden');
    renderTargetButtons(nightTargetRow, msg.alive, submitNightAction, myRole !== 'doctor');
  } else {
    nightStatus.textContent = `${msg.round}일차 밤 — 다른 사람들이 행동하는 중입니다…`;
    nightTargetRow.classList.add('hidden');
  }
  setPhase('night');
}

function submitNightAction(targetToken: string) {
  if (myActionSubmitted) return;
  myActionSubmitted = true;
  nightTargetRow.classList.add('hidden');
  nightStatus.textContent = '선택완료! 다른 사람을 기다리는 중…';
  send({ type: 'submit_night_action', targetToken });
}

function enterDay(msg: { round: number; alive: AliveEntry[]; deaths: { token: string; name: string }[] }) {
  myVoteSubmitted = null;
  dayTitle.textContent = `${msg.round}일차 낮`;
  const deaths = msg.deaths ?? [];
  dayDeathAnnounce.textContent = deaths.length
    ? `${deaths.map(d => d.name).join(', ')}님이 밤 사이 사망했습니다.`
    : '지난 밤에는 아무도 죽지 않았습니다.';
  renderChatLog();
  voteLabel.classList.remove('hidden');
  voteLabel.textContent = '처형할 사람에게 투표하세요';
  dayVoteProgressText.textContent = '';

  if (!isAlive) {
    chatInputRow.classList.add('hidden');
    dayVoteTargets.innerHTML = '';
    voteLabel.textContent = '당신은 사망했습니다. 관전 중입니다.';
  } else {
    chatInputRow.classList.remove('hidden');
    renderTargetButtons(dayVoteTargets, msg.alive, submitDayVote, true);
  }
  setPhase('day');
}

function submitDayVote(targetToken: string) {
  if (myVoteSubmitted) return;
  myVoteSubmitted = targetToken;
  Array.from(dayVoteTargets.querySelectorAll<HTMLButtonElement>('.target-btn')).forEach(b => { b.disabled = true; });
  dayVoteProgressText.textContent = '투표완료! 다른 사람을 기다리는 중…';
  send({ type: 'submit_day_vote', targetToken });
}

function renderGameOver(msg: any) {
  const won = msg.winner === 'mafia' ? '마피아' : '시민';
  gameOverBanner.textContent = `🏆 ${won} 승리!`;
  gameOverBanner.className = 'set-over-result ' + (msg.winner === 'mafia' ? 'lose' : 'win');
  rolesList.innerHTML = (msg.roles as { name: string; role: Role }[])
    .map(r => `<div class="scores-row${r.name === myName ? ' me' : ''}"><span>${r.name}</span><span>${ROLE_LABEL[r.role] ?? r.role}</span></div>`)
    .join('');
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
  const capacity = Math.min(Math.max(Number(capacityInput.value) || 8, 4), 12);
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

chatSendBtn.addEventListener('click', () => {
  const text = chatInput.value.trim().slice(0, 120);
  if (!text) return;
  chatInput.value = '';
  send({ type: 'submit_chat', text });
});
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') chatSendBtn.click(); });

retryBtn.addEventListener('click', () => { if (pendingAction) connect(pendingAction); });

setPhase('entry');
