import './yutnori.css';
import { shareRoomLink } from '../../shared/share';
import { showCenterToast } from '../../shared/center-toast';
import { createChatWidget, type ChatWidgetHandle } from '../../shared/chat-widget';
import { buildYutBoardGraph, YUT_START_NODE_ID } from '../../game/yutnori-board';
import { nodeScreenPos, stackOffsetPct, stagingSlotPos, YUT_PLAYER_COLORS } from '../../shared/yutnori-board-2d';

type Phase =
  | 'entry' | 'connecting' | 'lobby'
  | 'playing' | 'game_over'
  | 'reconnecting' | 'error';

type PendingAction = { kind: 'create'; capacity: number } | { kind: 'join'; roomCode: string } | { kind: 'rejoin' };

const WS_URL = (() => {
  const c = import.meta.env.VITE_YUTNORI_WS_URL as string | undefined;
  if (c) return c;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8787/yutnori`;
})();

const NAME_KEY = 'run-hoban-run:yutnori-nickname';
const SESSION_KEY = 'run-hoban-run:yutnori-session';
const RECONNECT_RETRY_MS = 2000;
const RECONNECT_MAX = 24;

const THROW_LABEL: Record<string, string> = {
  backdo: '백도(-1)', do: '도(1)', gae: '개(2)', geol: '걸(3)', yut: '윷(4)', mo: '모(5)',
};
const REACTION_OPTIONS = [
  { id: 'tease', emoji: '😜', label: '놀림' },
  { id: 'sad', emoji: '😭', label: '슬픔' },
  { id: 'smug', emoji: '😎', label: '의기양양' },
  { id: 'cheer', emoji: '👏', label: '응원' },
  { id: 'shock', emoji: '😱', label: '충격' },
] as const;

// 각 던지기 결과를 윷가락 4개의 "젖혀진(평평한 배가 위로 온)" 개수로 시각화한다.
// 전통 윷놀이처럼 젖혀진 개수 = 값(도1·개2·걸3·윷4)이며, 모는 4개 모두 엎어진 상태(0개)다.
// 백도는 도와 같이 1개만 젖혀지되 그 가락에 뒷도 표식이 있다.
const YUT_STICK_FLAT_COUNT: Record<string, number> = {
  backdo: 1, do: 1, gae: 2, geol: 3, yut: 4, mo: 0,
};

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

interface BoardPieceEntry { id: string; ownerToken: string; leadId: string; home: boolean; nodeId: string | null; }
interface PlayerEntry { token: string; name: string; connected: boolean; }
interface ThrowResult { kind: string; steps: number; extraTurn: boolean; }
interface PendingThrowEntry { id: string; result: ThrowResult; }
interface ReactionMessage { token: string; name: string; reaction: { id: string; emoji: string; label: string }; sentAt?: number; }

let board: BoardPieceEntry[] = [];
let players: PlayerEntry[] = [];
let teams: string[][] = [];
const playerColorSlots = new Map<string, number>();
let currentTurnToken: string | null = null;
let ynPhase: 'throw' | 'move' = 'throw';
let pendingThrows: PendingThrowEntry[] = [];
let selectedThrowId: string | null = null;
let isTossing = false;
let tossTimer: ReturnType<typeof setTimeout> | null = null;

// ── HTML ──────────────────────────────────────────────────────────
const app = document.getElementById('app')!;
app.innerHTML = `
<div class="yn-shell">
  <div class="yn-top-bar">
    <a class="back-link" href="/">← 게임 선택</a>
  </div>
  <div class="yn-stage">
    <h1 class="yn-title">윷놀이</h1>
    <p class="yn-sub">윷을 던지고 말을 옮겨 4개를 모두 완주시키세요</p>

    <!-- Entry -->
    <div class="yn-panel" id="entry-panel">
      <div class="resume-banner hidden" id="resume-banner">
        <p class="status-text" id="resume-text">이전에 참여하던 방이 있어요.</p>
        <div class="resume-actions">
          <button id="resume-btn" type="button" class="yn-btn primary">재입장하기</button>
          <button id="resume-dismiss-btn" type="button" class="yn-btn secondary">새로 시작</button>
        </div>
      </div>

      <label class="field-label" for="nickname">닉네임</label>
      <input id="nickname" type="text" maxlength="20" placeholder="닉네임을 입력하세요" class="nickname-input" />

      <div class="entry-tabs" role="tablist">
        <button id="tab-create" type="button" class="entry-tab active" role="tab">방 만들기</button>
        <button id="tab-join" type="button" class="entry-tab" role="tab">방 참가하기</button>
      </div>

      <div class="entry-section" id="create-section">
        <label class="field-label" for="capacity-input">인원 수 (2~4)</label>
        <input id="capacity-input" type="number" min="2" max="4" value="4" class="nickname-input capacity-input" />
        <button id="create-btn" type="button" class="yn-btn primary">방 만들기</button>
      </div>

      <div class="entry-section hidden" id="join-section">
        <label class="field-label" for="room-code-input">방 코드</label>
        <input id="room-code-input" type="text" maxlength="6" placeholder="예: 3F9A2C" class="nickname-input room-code-input" />
        <button id="join-btn" type="button" class="yn-btn primary">참가하기</button>
      </div>

      <p class="entry-error hidden" id="entry-error"></p>
    </div>

    <!-- Waiting / reconnecting -->
    <div class="yn-panel hidden" id="waiting-panel">
      <div class="spinner" aria-hidden="true"></div>
      <p class="status-text" id="waiting-status">서버에 연결하는 중…</p>
      <button id="cancel-btn" type="button" class="yn-btn secondary">취소</button>
    </div>

    <!-- Lobby -->
    <div class="yn-panel hidden" id="lobby-panel">
      <div class="room-share" id="lobby-share">
        <span class="room-share-label">방 코드</span>
        <span class="room-code-display" id="lobby-code-display"></span>
        <button id="lobby-copy-btn" type="button" class="yn-btn secondary">공유하기</button>
      </div>
      <div class="lobby-players" id="lobby-players"></div>
      <p class="status-text" id="lobby-status">참가자를 기다리는 중…</p>
      <button id="start-btn" type="button" class="yn-btn primary hidden">게임 시작</button>
      <button id="lobby-cancel-btn" type="button" class="yn-btn secondary">나가기</button>
    </div>

    <!-- Playing -->
    <div class="yn-panel wide hidden" id="playing-panel">
      <p class="status-text" id="yn-turn-status"></p>
      <div class="yn-board-wrap" id="yn-board-wrap">
        <div class="yn-seat seat-tl" id="yn-seat-0">
          <div class="yn-seat-badge" id="yn-seat-badge-0"></div>
          <div class="yn-seat-reaction hidden" id="yn-seat-reaction-0"></div>
        </div>
        <div class="yn-seat seat-tr" id="yn-seat-1">
          <div class="yn-seat-badge" id="yn-seat-badge-1"></div>
          <div class="yn-seat-reaction hidden" id="yn-seat-reaction-1"></div>
        </div>
        <div class="yn-seat seat-br" id="yn-seat-2">
          <div class="yn-seat-badge" id="yn-seat-badge-2"></div>
          <div class="yn-seat-reaction hidden" id="yn-seat-reaction-2"></div>
        </div>
        <div class="yn-seat seat-bl" id="yn-seat-3">
          <div class="yn-seat-badge" id="yn-seat-badge-3"></div>
          <div class="yn-seat-reaction hidden" id="yn-seat-reaction-3"></div>
        </div>
        <div class="yn-board-2d" id="yn-board-2d">
          <svg class="yn-board-svg" viewBox="0 0 100 100" id="yn-board-svg" aria-hidden="true"></svg>
          <div class="yn-board-tokens" id="yn-board-tokens"></div>
        </div>
      </div>

      <div class="yn-controls">
        <button id="throw-btn" type="button" class="yn-btn primary throw-btn" aria-label="윷 던지기" disabled>
          <span class="throw-yut-set" aria-hidden="true">
            <span class="mini-yut-stick round"></span>
            <span class="mini-yut-stick flat"></span>
            <span class="mini-yut-stick round"></span>
            <span class="mini-yut-stick flat"></span>
          </span>
          <span class="throw-btn-text">던지기</span>
        </button>
        <div class="yn-throw-queue hidden" id="yn-throw-queue"></div>
        <div class="yn-piece-picker hidden" id="yn-piece-picker"></div>
      </div>

      <div class="yn-reactions" id="yn-reactions">
        ${REACTION_OPTIONS.map((r) => `<button type="button" class="yn-reaction-btn" data-reaction-id="${r.id}" aria-label="${r.label}">${r.emoji}</button>`).join('')}
      </div>
    </div>

    <!-- Game over -->
    <div class="yn-panel hidden" id="game-over-panel">
      <p class="set-over-result" id="game-over-banner"></p>
      <div class="roles-list" id="final-board"></div>
      <button id="game-over-leave-btn" type="button" class="yn-btn secondary">나가기</button>
    </div>

    <!-- Error -->
    <div class="yn-panel hidden" id="error-panel">
      <p class="status-text" id="error-text">게임 서버에 연결할 수 없습니다.</p>
      <button id="retry-btn" type="button" class="yn-btn primary">다시 시도</button>
    </div>
  </div>
</div>
`;

// ── Refs ──────────────────────────────────────────────────────────
const panels = {
  entry: document.getElementById('entry-panel')!,
  waiting: document.getElementById('waiting-panel')!,
  lobby: document.getElementById('lobby-panel')!,
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

const turnStatus = document.getElementById('yn-turn-status')!;
const boardSvgEl = document.getElementById('yn-board-svg') as unknown as SVGSVGElement;
const boardTokensEl = document.getElementById('yn-board-tokens')!;
const seatBadgeEls = [0, 1, 2, 3].map((i) => document.getElementById(`yn-seat-badge-${i}`)!);
const seatReactionEls = [0, 1, 2, 3].map((i) => document.getElementById(`yn-seat-reaction-${i}`)!);
const seatEls = [0, 1, 2, 3].map((i) => document.getElementById(`yn-seat-${i}`)!);
const seatReactionTimers: (ReturnType<typeof setTimeout> | null)[] = [null, null, null, null];
const throwBtn = document.getElementById('throw-btn') as HTMLButtonElement;
const throwQueueEl = document.getElementById('yn-throw-queue')!;
const piecePickerEl = document.getElementById('yn-piece-picker')!;
const reactionRow = document.getElementById('yn-reactions')!;

const chatWidget: ChatWidgetHandle = createChatWidget({
  channels: [{ id: 'general', label: '채팅' }],
  position: 'right',
  onSend: (_channelId, text) => send({ type: 'submit_chat', text }),
});

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
  phase = next;
  const vis = (el: HTMLElement, show: boolean) => el.classList.toggle('hidden', !show);
  vis(panels.entry, next === 'entry');
  vis(panels.waiting, next === 'connecting' || next === 'reconnecting');
  vis(panels.lobby, next === 'lobby');
  vis(panels.playing, next === 'playing');
  vis(panels.gameOver, next === 'game_over');
  vis(panels.error, next === 'error');
}

function showEntryError(msg: string) { entryError.textContent = msg; entryError.classList.remove('hidden'); }
function hideEntryError() { entryError.classList.add('hidden'); }

async function copyLink(code: string, btn: HTMLButtonElement) {
  const link = `${location.origin}/yutnori/?room=${code}`;
  await shareRoomLink({ url: link, title: '윷놀이 초대', text: `윷놀이 방(${code})에 초대할게요!`, btn });
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
    try { handleServerMessage(JSON.parse(e.data)); } catch { /* ignore malformed frame */ }
  });

  ws.addEventListener('close', () => {
    if (intentionalClose) return;
    const inGame = ['lobby', 'playing', 'reconnecting'].includes(phase);
    if (inGame) beginReconnect();
    else if (phase !== 'entry') showError('서버와의 연결이 끊어졌습니다.');
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
  players = [];
  teams = [];
  playerColorSlots.clear();
  currentTurnToken = null;
  ynPhase = 'throw';
  pendingThrows = [];
  selectedThrowId = null;
  isTossing = false;
  if (tossTimer) { clearTimeout(tossTimer); tossTimer = null; }
  clearAllReactions();
  chatWidget.clearAll();
}

// ── Lobby rendering ───────────────────────────────────────────────
function renderLobbyPlayers(list: { name: string; isHost: boolean; connected: boolean }[]) {
  lobbyPlayers.innerHTML = list.map(p =>
    `<div class="lobby-player${p.connected ? '' : ' disconnected'}">
      <span class="lobby-name">${p.name}</span>
      ${p.isHost ? '<span class="lobby-badge host">호스트</span>' : ''}
      ${!p.connected ? '<span class="lobby-badge offline">연결 끊김</span>' : ''}
    </div>`
  ).join('');
}

function showToast(text: string, kind: 'throw' | 'capture' | 'info') {
  showCenterToast(text, { kind, duration: kind === 'throw' ? 1800 : 3000 });
}

/** 반응 이모지는 보낸 사람의 좌석 배지 옆 말풍선으로 표시한다(어느 위치인지 헷갈리지 않도록). */
function showReaction(msg: ReactionMessage) {
  const slot = stablePlayerIndex(msg.token);
  const el = seatReactionEls[slot];
  if (!el) return;
  if (seatReactionTimers[slot]) clearTimeout(seatReactionTimers[slot]!);
  el.innerHTML = `<span class="yn-seat-reaction-emoji">${escapeHtml(msg.reaction.emoji)}</span>`;
  el.classList.remove('hidden');
  seatReactionTimers[slot] = setTimeout(() => { el.classList.add('hidden'); }, 1600);
}

function clearAllReactions() {
  seatReactionEls.forEach((el, slot) => {
    if (seatReactionTimers[slot]) { clearTimeout(seatReactionTimers[slot]!); seatReactionTimers[slot] = null; }
    el.classList.add('hidden');
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]!);
}

function stablePlayerIndex(token: string): number {
  const existing = playerColorSlots.get(token);
  if (existing !== undefined) return existing;
  const next = playerColorSlots.size;
  playerColorSlots.set(token, next);
  return next;
}

function syncPlayerSlots(list: PlayerEntry[]) {
  list.forEach((p) => stablePlayerIndex(p.token));
}

// ── 윷가락 그래픽 (화면 중앙 토스트) ───────────────────────────────
// 결과는 언제나 서버가 정한다. 여기서는 그 결과의 앞/뒤 배치와 던지는 동안의 흔들림만
// 시각적으로 표현할 뿐, 결과 자체를 클라이언트가 만들지 않는다.
function yutSticksHtml(result: ThrowResult | null, tossing: boolean): string {
  const sticks = [0, 1, 2, 3].map((i) => {
    if (tossing) return '<span class="ct-yut-stick tossing round"></span>';
    const flatCount = result ? (YUT_STICK_FLAT_COUNT[result.kind] ?? 0) : 0;
    const flat = i < flatCount;
    const baekdo = flat && i === 0 && result?.kind === 'backdo';
    return `<span class="ct-yut-stick ${flat ? 'flat' : 'round'}${baekdo ? ' baekdo' : ''}"></span>`;
  }).join('');
  if (tossing || !result) return `<div class="ct-yut-row">${sticks}</div>`;
  const bonus = result.extraTurn ? '<span class="bonus">⭐ 한 번 더</span>' : '';
  return `<div class="ct-yut-row">${sticks}</div><div class="ct-yut-value">${THROW_LABEL[result.kind] ?? result.kind}${bonus}</div>`;
}

/** throw-btn을 누른 직후, 서버 결과가 오기 전까지 보여줄 흔들림 연출을 중앙 토스트로 시작한다. */
function startTossing() {
  if (tossTimer) { clearTimeout(tossTimer); tossTimer = null; }
  isTossing = true;
  showCenterToast(yutSticksHtml(null, true), { kind: 'throw', html: true, duration: 8000 });
}

/** 던지기 결과를 중앙 토스트의 윷가락에 확정 반영한다. */
function settleThrow(result: ThrowResult) {
  if (tossTimer) { clearTimeout(tossTimer); tossTimer = null; }
  isTossing = false;
  showCenterToast(yutSticksHtml(result, false), { kind: 'throw', html: true, duration: 2600 });
}

function playerIndex(token: string): number {
  return stablePlayerIndex(token);
}

function nameOfToken(token: string | null): string {
  if (!token) return '?';
  return players.find((p) => p.token === token)?.name ?? '?';
}

function playerByToken(token: string): PlayerEntry | undefined {
  return players.find((p) => p.token === token);
}

function playerColor(token: string): string {
  const idx = Math.max(0, playerIndex(token));
  return YUT_PLAYER_COLORS[idx % YUT_PLAYER_COLORS.length];
}

function yutMiniPreview(kind: string): string {
  const flatCount = YUT_STICK_FLAT_COUNT[kind] ?? 0;
  const sticks = [0, 1, 2, 3].map((i) => {
    const flat = i < flatCount;
    const baekdo = flat && i === 0 && kind === 'backdo';
    return `<span class="mini-yut-stick ${flat ? 'flat' : 'round'}${baekdo ? ' baekdo' : ''}"></span>`;
  }).join('');
  return `<span class="mini-yut-set" aria-hidden="true">${sticks}</span>`;
}

function renderThrowChip(t: PendingThrowEntry): string {
  const selected = t.id === selectedThrowId;
  return `<button type="button" class="yn-throw-chip${selected ? ' selected' : ''}" data-throw-id="${t.id}">
    ${yutMiniPreview(t.result.kind)}
    <span class="yn-throw-chip-label">${THROW_LABEL[t.result.kind] ?? t.result.kind}</span>
  </button>`;
}

function renderPieceButton(piece: BoardPieceEntry, groupCount: number, split: boolean): string {
  const label = split ? '분리' : groupCount > 1 ? `x${groupCount}` : (piece.nodeId ? '보드' : '출발');
  const title = split ? '1개만' : groupCount > 1 ? '스택' : '말';
  const aria = split
    ? '업힌 말에서 1개만 갈라쳐서 이동'
    : groupCount > 1
      ? `업힌 말 ${groupCount}개 전체 이동`
      : `${piece.nodeId ? '보드 위' : '출발 전'} 말 이동`;
  return `<button type="button" class="yn-piece-btn${split ? ' split' : ''}" data-piece-id="${piece.id}" data-split="${split}" aria-label="${aria}">
    <span class="yn-piece-icon" style="--piece-color: ${playerColor(piece.ownerToken)}" aria-hidden="true">${pieceNumber(piece)}</span>
    <span class="yn-piece-copy">
      <span class="yn-piece-title">${title}</span>
      <span class="yn-piece-meta">${label}</span>
    </span>
  </button>`;
}

/** 자기 말 몇 번인지(1~4) — id가 `${ownerToken}-${index}` 형식인 걸 이용한다. */
function pieceNumber(entry: BoardPieceEntry): number {
  return Number(entry.id.split('-').pop()) + 1;
}

// ── 2D 보드 렌더링 ────────────────────────────────────────────────
const boardGraph = buildYutBoardGraph();
const pieceTokenEls = new Map<string, HTMLDivElement>();
// 이번 이동 단계에서 보드 클릭으로 고를 수 있는 lead 피스들.
const selectablePieceIds = new Set<string>();

/** 보드 트랙(외곽 사각형 + 대각선 지름길) SVG를 한 번만 만든다. 토폴로지가 고정이라 매 프레임 다시 그릴 필요가 없다. */
function buildBoardSvg() {
  const nodes = Object.values(boardGraph);
  const lines: string[] = [];
  for (const node of nodes) {
    const from = nodeScreenPos(node);
    if (node.kind !== 'center') {
      const to = nodeScreenPos(boardGraph[node.next]);
      lines.push(`<line x1="${from.xPct}" y1="${from.yPct}" x2="${to.xPct}" y2="${to.yPct}" class="yn-board-line" />`);
    }
    if (node.shortcutNext) {
      const to = nodeScreenPos(boardGraph[node.shortcutNext]);
      lines.push(`<line x1="${from.xPct}" y1="${from.yPct}" x2="${to.xPct}" y2="${to.yPct}" class="yn-board-line" />`);
    }
  }
  const dots = nodes.map((node) => {
    const { xPct, yPct } = nodeScreenPos(node);
    const big = node.kind === 'corner' || node.kind === 'center';
    return `<circle cx="${xPct}" cy="${yPct}" r="${big ? 4.2 : 2.6}" class="yn-board-dot ${big ? 'corner' : 'outer'}" />`;
  }).join('');
  const start = nodeScreenPos(boardGraph[YUT_START_NODE_ID]);
  const startLabel = `<text x="${start.xPct - 7}" y="${start.yPct - 6}" class="yn-board-start-label" text-anchor="end">출발</text>`;
  // 코너 0(출발점)은 지름길 대각선이 없어 비어 있는 안쪽 공간 — 대기 중인 말을 모아 두는 구역임을 표시.
  const waitingZoneBg = `<rect x="54" y="54" width="32" height="32" rx="6" class="yn-waiting-zone" />`;
  boardSvgEl.innerHTML = `${waitingZoneBg}${lines.join('')}${dots}${startLabel}`;
}
buildBoardSvg();

boardTokensEl.addEventListener('click', (e) => {
  if (currentTurnToken !== myToken || ynPhase !== 'move') return;
  if (!selectedThrowId) return;
  const el = (e.target as HTMLElement).closest('.yn-piece-token') as HTMLElement | null;
  const pieceId = el?.dataset.pieceId;
  if (!pieceId || !selectablePieceIds.has(pieceId)) return;
  // 보드 클릭은 스택 전체 이동만 담당한다. 갈라치기는 하단 텍스트 버튼으로 남겨둔다.
  send({ type: 'submit_move', pieceId, pendingThrowId: selectedThrowId, splitOff: false });
});

/** 잡히거나 업힌 말이 잠깐 통통 튀도록 표시한다. */
function hopPiece(id: string) {
  const el = pieceTokenEls.get(id);
  if (!el) return;
  el.classList.remove('hop');
  void el.offsetWidth;
  el.classList.add('hop');
  setTimeout(() => el.classList.remove('hop'), 520);
}

/** 홈인 시 해당 플레이어 좌석 배지를 잠깐 반짝인다. */
function flashHome(token: string) {
  const badge = seatBadgeEls[Math.max(0, stablePlayerIndex(token))];
  if (!badge) return;
  badge.classList.remove('home-flash');
  void badge.offsetWidth;
  badge.classList.add('home-flash');
  setTimeout(() => badge.classList.remove('home-flash'), 750);
}

/** 완주(home)한 말은 배지 점수에만 반영하고 보드에는 그리지 않는다.
 *  출발 전(nodeId=null) 말은 같은 칸에 여러 명이 몰리지 않도록 플레이어별로 다른 위치에 대기시킨다. */
function syncPieceTokens() {
  const active = board.filter((b) => !b.home);
  const groups = new Map<string, { base: { xPct: number; yPct: number }; entries: BoardPieceEntry[] }>();
  for (const entry of active) {
    const groupKey = entry.nodeId ?? `start:${entry.ownerToken}`;
    let group = groups.get(groupKey);
    if (!group) {
      const base = entry.nodeId
        ? nodeScreenPos(boardGraph[entry.nodeId])
        : stagingSlotPos(stablePlayerIndex(entry.ownerToken));
      group = { base, entries: [] };
      groups.set(groupKey, group);
    }
    group.entries.push(entry);
  }

  const seen = new Set<string>();
  groups.forEach(({ base, entries }) => {
    entries.forEach((entry, i) => {
      seen.add(entry.id);
      const { dx, dy } = stackOffsetPct(i);
      let el = pieceTokenEls.get(entry.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'yn-piece-token';
        el.dataset.pieceId = entry.id;
        el.innerHTML = '<span class="yn-piece-token-num"></span>';
        boardTokensEl.appendChild(el);
        pieceTokenEls.set(entry.id, el);
      }
      el.style.setProperty('--piece-color', playerColor(entry.ownerToken));
      el.style.left = `${base.xPct + dx}%`;
      el.style.top = `${base.yPct + dy}%`;
      el.classList.toggle('selectable', selectablePieceIds.has(entry.id));
      const numEl = el.querySelector('.yn-piece-token-num');
      if (numEl) numEl.textContent = String(pieceNumber(entry));
    });
  });

  for (const [id, el] of [...pieceTokenEls]) {
    if (!seen.has(id)) { el.remove(); pieceTokenEls.delete(id); }
  }
}

// ── 좌석 배지(11/1/5/7시) + 컨트롤 ──────────────────────────────────
/** 좌석 순서는 참가 순서(stablePlayerIndex)로 고정: 1p=11시, 2p=1시, 3p=5시, 4p=7시(시계방향). */
function renderSeats() {
  for (let slot = 0; slot < 4; slot += 1) {
    const seatEl = seatEls[slot];
    const badgeEl = seatBadgeEls[slot];
    const token = players.find((p) => stablePlayerIndex(p.token) === slot)?.token;
    if (!token) {
      seatEl.classList.add('empty');
      badgeEl.innerHTML = '';
      continue;
    }
    seatEl.classList.remove('empty');
    const p = playerByToken(token);
    if (!p) continue;
    const color = playerColor(token);
    const isTurn = token === currentTurnToken;
    const homeCount = board.filter((b) => b.ownerToken === token && b.home).length;
    const teamIdx = teams.findIndex((t) => t.includes(token));
    const teamTag = teamIdx >= 0 ? `<span class="yn-seat-team">팀${teamIdx + 1}</span>` : '';
    badgeEl.innerHTML = `
      <span class="yn-seat-dot" style="background:${color}"></span>
      <span class="yn-seat-name">${escapeHtml(p.name)}${token === myToken ? ' (나)' : ''}</span>
      ${teamTag}
      <span class="yn-seat-score">${homeCount}/4</span>
    `;
    badgeEl.classList.toggle('active-turn', isTurn);
    badgeEl.classList.toggle('disconnected', !p.connected);
  }
}

function renderControls() {
  const myTurn = currentTurnToken === myToken;
  throwBtn.disabled = !myTurn || ynPhase !== 'throw';

  const showMoveUi = myTurn && ynPhase === 'move';
  throwQueueEl.classList.toggle('hidden', !showMoveUi);
  piecePickerEl.classList.toggle('hidden', !showMoveUi);

  selectablePieceIds.clear();
  if (showMoveUi) {
    if (!selectedThrowId || !pendingThrows.some((t) => t.id === selectedThrowId)) {
      selectedThrowId = pendingThrows[0]?.id ?? null;
    }
    const selectedThrow = pendingThrows.find((t) => t.id === selectedThrowId);
    const isBackdo = selectedThrow?.result.kind === 'backdo';
    throwQueueEl.innerHTML = pendingThrows.map(renderThrowChip).join('');

    const myPieces = board.filter((b) => b.ownerToken === myToken && !b.home);
    // 보드 클릭으로 고를 수 있는 건 각 스택의 lead 피스(스택 전체 이동). 백도는 보드 위 말만 가능하다.
    for (const p of myPieces) {
      if (p.leadId === p.id && !(isBackdo && !p.nodeId)) selectablePieceIds.add(p.id);
    }
    const groups = new Map<string, BoardPieceEntry[]>();
    for (const piece of myPieces) {
      const arr = groups.get(piece.leadId) ?? [];
      arr.push(piece);
      groups.set(piece.leadId, arr);
    }
    const buttons: string[] = [];
    groups.forEach((group, leadId) => {
      const lead = group.find((g) => g.id === leadId) ?? group[0];
      if (group.length === 1) {
        buttons.push(renderPieceButton(lead, 1, false));
      } else {
        buttons.push(renderPieceButton(lead, group.length, false));
        group.filter((g) => g.id !== leadId).forEach((g) => {
          buttons.push(renderPieceButton(g, 1, true));
        });
      }
    });
    piecePickerEl.innerHTML = buttons.join('');
  }
}

function renderPlaying() {
  renderSeats();
  renderControls();
  syncPieceTokens();

  if (currentTurnToken === myToken) {
    turnStatus.textContent = ynPhase === 'throw' ? '당신의 차례입니다! 윷을 던지세요' : '보드에서 움직일 말을 클릭하세요';
  } else {
    turnStatus.textContent = currentTurnToken ? `${nameOfToken(currentTurnToken)}님의 차례입니다` : '';
  }
}

// ── Server message handler ────────────────────────────────────────
function applyGamePayload(payload: any) {
  board = payload.board ?? [];
  players = payload.players ?? players;
  syncPlayerSlots(players);
  teams = payload.teams ?? teams;
  currentTurnToken = payload.currentTurnToken ?? null;
  ynPhase = payload.phase === 'move' ? 'move' : 'throw';
  pendingThrows = payload.pendingThrows ?? [];
}

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
      const list = msg.players as { name: string; isHost: boolean; connected: boolean }[];
      const connectedCount = list.filter((p) => p.connected).length;
      renderLobbyPlayers(list);
      if (msg.canStart) {
        startBtn.classList.remove('hidden');
        lobbyStatus.textContent = `${connectedCount}명 입장 — 시작할 준비가 됐어요! (최소 2명, 최대 4명)`;
      } else {
        startBtn.classList.add('hidden');
        lobbyStatus.textContent = isHost
          ? `현재 ${connectedCount}명 입장 중 — 최소 2명이 필요해요…`
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
      applyGamePayload(msg.game);
      setPhase('playing');
      renderPlaying();
      break;
    }

    case 'game_starting':
      setPhase('connecting');
      waitingStatus.textContent = '게임을 시작합니다…';
      break;

    case 'game_update': {
      applyGamePayload(msg);
      if (phase !== 'playing') setPhase('playing');
      renderPlaying();

      const event = msg.event as
        | { kind: 'throw'; token: string; name: string; result: ThrowResult }
        | { kind: 'move' | 'capture'; token: string; name: string; pieceId: string; capturedPieceIds: string[]; joinedPieceIds: string[]; bonusThrow: boolean }
        | { kind: 'turn_skipped'; token: string; name: string }
        | { kind: 'player_left'; name: string }
        | null;

      if (event) {
        if (event.kind === 'throw') {
          if (event.token === myToken && (isTossing || tossTimer)) {
            // 내가 방금 던졌으면 흔들림을 잠깐 더 보여준 뒤 결과를 확정한다.
            const settled = event.result;
            tossTimer = setTimeout(() => settleThrow(settled), 650);
          } else {
            // 상대의 던지기(또는 연출을 놓친 경우)는 결과를 바로 보여준다.
            settleThrow(event.result);
          }
          showToast(`${event.name}님이 ${THROW_LABEL[event.result.kind] ?? event.result.kind}를 던졌어요${event.result.extraTurn ? ' — 한 번 더!' : ''}`, 'throw');
        } else if (event.kind === 'move' || event.kind === 'capture') {
          const movedPiece = board.find((b) => b.id === event.pieceId);
          if (event.capturedPieceIds.length) {
            showToast(`${event.name}님이 상대 말을 잡았어요! 보너스 던지기 획득`, 'capture');
            event.capturedPieceIds.forEach(hopPiece);
          } else if (event.joinedPieceIds.length) {
            showToast(`${event.name}님이 말을 업었어요`, 'throw');
            event.joinedPieceIds.forEach(hopPiece);
            hopPiece(event.pieceId);
          }
          if (movedPiece?.home) flashHome(movedPiece.ownerToken);
        } else if (event.kind === 'turn_skipped') {
          showToast(`${event.name}님이 시간 초과로 차례를 넘겼어요`, 'info');
        } else if (event.kind === 'player_left') {
          showToast(`${event.name}님이 나갔어요`, 'info');
        }
      }
      break;
    }

    case 'chat_message':
      chatWidget.addMessage('general', { name: msg.name, text: msg.text, mine: msg.token === myToken });
      break;

    case 'reaction_message':
      showReaction(msg);
      chatWidget.addMessage('general', {
        name: msg.name,
        text: `${msg.reaction?.emoji ?? ''} ${msg.reaction?.label ?? ''}`.trim(),
        mine: msg.token === myToken,
      });
      break;

    case 'game_over':
      renderGameOver(msg);
      break;

    case 'player_disconnected':
      showToast(`${msg.name}님의 연결이 불안정합니다…`, 'info');
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
  const winnerTeamTokens = (msg.winnerTeamTokens as string[] | undefined) ?? (msg.winnerToken ? [msg.winnerToken] : []);
  const winnerTeamNames = (msg.winnerTeamNames as string[] | undefined) ?? (msg.winnerName ? [msg.winnerName] : []);
  const iWon = !!myToken && winnerTeamTokens.includes(myToken);
  const winnerLabel = winnerTeamNames.length > 1 ? `${winnerTeamNames.join(' · ')} 팀` : (msg.winnerName ?? '');
  gameOverBanner.textContent = winnerLabel
    ? (iWon ? `🏆 승리! ${winnerLabel}이 이겼어요!` : `🏆 ${winnerLabel} 승리!`)
    : '게임이 종료됐습니다.';
  gameOverBanner.className = 'set-over-result ' + (iWon ? 'win' : 'lose');
  const finalBoardData = (msg.board as BoardPieceEntry[]) ?? [];
  const byOwner = new Map<string, number>();
  finalBoardData.forEach((p) => { if (p.home) byOwner.set(p.ownerToken, (byOwner.get(p.ownerToken) ?? 0) + 1); });
  const teamList = teams.length ? teams : players.map((p) => [p.token]);
  finalBoard.innerHTML = teamList.map((team, index) => {
    const total = team.reduce((sum, token) => sum + (byOwner.get(token) ?? 0), 0);
    const names = team.map((token) => nameOfToken(token)).join(' · ');
    const me = !!myToken && team.includes(myToken);
    return `<div class="scores-row${me ? ' me' : ''}"><span>팀 ${index + 1} · ${names}</span><span>${total}/${team.length * 4} 완주</span></div>`;
  }).join('');
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
  const capacity = Math.min(Math.max(Number(capacityInput.value) || 4, 2), 4);
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

throwBtn.addEventListener('click', () => {
  if (throwBtn.disabled) return;
  send({ type: 'submit_throw' });
  // 결과는 서버가 정한다. 도착 전까지 흔들림 연출만 시작한다(장식).
  startTossing();
});

throwQueueEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('[data-throw-id]') as HTMLElement | null;
  if (!btn) return;
  selectedThrowId = btn.dataset.throwId ?? null;
  renderControls();
});

piecePickerEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('[data-piece-id]') as HTMLElement | null;
  if (!btn || !selectedThrowId) return;
  send({
    type: 'submit_move',
    pieceId: btn.dataset.pieceId,
    pendingThrowId: selectedThrowId,
    splitOff: btn.dataset.split === 'true',
  });
});

reactionRow.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('[data-reaction-id]') as HTMLElement | null;
  if (!btn) return;
  send({ type: 'submit_reaction', reactionId: btn.dataset.reactionId });
});

retryBtn.addEventListener('click', () => { if (pendingAction) connect(pendingAction); });

setPhase('entry');
