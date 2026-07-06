import './yutnori.css';
import * as THREE from 'three';
import { shareRoomLink } from '../../shared/share';
import { buildYutBoardGraph, entryNodeId } from '../../game/yutnori-board';
import { buildYutnoriBoardScene, nodeWorldPosition } from '../../render/yutnori-board';
import { createYutPieceMesh, YUT_PLAYER_COLORS } from '../../render/yutnori-piece';

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
let toastTimer: ReturnType<typeof setTimeout> | null = null;

interface BoardPieceEntry { id: string; ownerToken: string; leadId: string; home: boolean; nodeId: string | null; }
interface PlayerEntry { token: string; name: string; connected: boolean; }
interface ThrowResult { kind: string; steps: number; extraTurn: boolean; }
interface PendingThrowEntry { id: string; result: ThrowResult; }
interface BranchInfo { pieceId: string; cornerId: string; remainingSteps: number; pendingThrowId: string; }

let board: BoardPieceEntry[] = [];
let players: PlayerEntry[] = [];
let currentTurnToken: string | null = null;
let ynPhase: 'throw' | 'move' = 'throw';
let pendingThrows: PendingThrowEntry[] = [];
let pendingBranch: BranchInfo | null = null;
let selectedThrowId: string | null = null;

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
      <div class="yn-players" id="yn-players"></div>
      <p class="status-text" id="yn-turn-status"></p>
      <div class="yn-toast hidden" id="yn-toast"></div>
      <div class="yn-canvas-wrap" id="yn-canvas-wrap"></div>

      <div class="yn-controls">
        <button id="throw-btn" type="button" class="yn-btn primary throw-btn" disabled>🎲 윷 던지기</button>
        <div class="yn-throw-queue hidden" id="yn-throw-queue"></div>
        <div class="yn-piece-picker hidden" id="yn-piece-picker"></div>
        <div class="yn-branch-picker hidden" id="yn-branch-picker">
          <button type="button" class="yn-branch-btn" id="branch-straight-btn">➡️ 그대로 외곽으로</button>
          <button type="button" class="yn-branch-btn" id="branch-shortcut-btn">↗️ 지름길(대각선)로</button>
        </div>
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

const ynPlayersEl = document.getElementById('yn-players')!;
const turnStatus = document.getElementById('yn-turn-status')!;
const ynToast = document.getElementById('yn-toast')!;
const canvasWrap = document.getElementById('yn-canvas-wrap')!;
const throwBtn = document.getElementById('throw-btn') as HTMLButtonElement;
const throwQueueEl = document.getElementById('yn-throw-queue')!;
const piecePickerEl = document.getElementById('yn-piece-picker')!;
const branchPickerEl = document.getElementById('yn-branch-picker')!;
const branchStraightBtn = document.getElementById('branch-straight-btn') as HTMLButtonElement;
const branchShortcutBtn = document.getElementById('branch-shortcut-btn') as HTMLButtonElement;

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
  if (next === 'playing') ensureScene();
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
  currentTurnToken = null;
  ynPhase = 'throw';
  pendingThrows = [];
  pendingBranch = null;
  selectedThrowId = null;
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
  if (toastTimer) clearTimeout(toastTimer);
  ynToast.textContent = text;
  ynToast.className = `yn-toast ${kind}`;
  ynToast.classList.remove('hidden');
  toastTimer = setTimeout(() => { ynToast.classList.add('hidden'); }, kind === 'throw' ? 1800 : 3000);
}

function playerIndex(token: string): number {
  return players.findIndex((p) => p.token === token);
}

function nameOfToken(token: string | null): string {
  if (!token) return '?';
  return players.find((p) => p.token === token)?.name ?? '?';
}

// ── Three.js scene ────────────────────────────────────────────────
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let clock: THREE.Clock | null = null;
let animating = false;
const boardGraph = buildYutBoardGraph();
const pieceMeshes = new Map<string, THREE.Group>();
const pieceTargets = new Map<string, THREE.Vector3>();

function stagingPosition(cornerIndex: number, outward: number, stackIndex: number): THREE.Vector3 {
  const startNode = boardGraph[entryNodeId(0)];
  const dir = new THREE.Vector2(startNode.gridPos[0], startNode.gridPos[1]).normalize();
  const tangent = new THREE.Vector2(-dir.y, dir.x);
  const laneOffset = cornerIndex - (players.length - 1) / 2;
  const base = nodeWorldPosition(startNode.gridPos).add(
    new THREE.Vector3(dir.x, 0, dir.y).multiplyScalar(outward),
  );
  base.x += tangent.x * laneOffset * 0.58 + (stackIndex % 2) * 0.24 - 0.12;
  base.z += tangent.y * laneOffset * 0.58 + Math.floor(stackIndex / 2) * 0.36;
  return base;
}

function ensureScene() {
  if (scene) { onResize(); return; }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xfff9ef);
  scene.fog = new THREE.Fog(0xfff9ef, 28, 58);

  camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
  camera.position.set(0, 23, 18);
  camera.lookAt(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xfff3d6, 0xf7d8c9, 1.05);
  scene!.add(hemi);
  const dir = new THREE.DirectionalLight(0xffe9bd, 1.0);
  dir.position.set(7, 12, 6);
  dir.castShadow = true;
  scene!.add(dir);

  scene!.add(buildYutnoriBoardScene(boardGraph));

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  } catch {
    canvasWrap.textContent = '이 브라우저에서는 3D 렌더링을 사용할 수 없어요.';
    return;
  }
  renderer.shadowMap.enabled = true;
  canvasWrap.innerHTML = '';
  canvasWrap.appendChild(renderer.domElement);
  clock = new THREE.Clock();
  onResize();
  window.addEventListener('resize', onResize);

  if (!animating) {
    animating = true;
    requestAnimationFrame(animate);
  }
}

function onResize() {
  if (!renderer || !camera) return;
  const w = canvasWrap.clientWidth || 1;
  const h = canvasWrap.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  if (!renderer || !scene || !camera || !clock) return;
  const delta = Math.min(clock.getDelta(), 0.1);
  const lerpAlpha = 1 - Math.pow(0.001, delta);

  pieceMeshes.forEach((mesh, id) => {
    const target = pieceTargets.get(id);
    if (target) mesh.position.lerp(target, lerpAlpha);
  });

  renderer.render(scene, camera);
}

function syncPieceMeshes() {
  if (!scene) return;

  const seen = new Set<string>();
  for (const entry of board) {
    seen.add(entry.id);
    let mesh = pieceMeshes.get(entry.id);
    if (!mesh) {
      mesh = createYutPieceMesh(playerIndex(entry.ownerToken));
      pieceMeshes.set(entry.id, mesh);
      scene.add(mesh);
    }

    const idx = Number(entry.id.split('-').pop());
    const cornerIndex = Math.max(0, playerIndex(entry.ownerToken));
    let target: THREE.Vector3;
    if (entry.home) {
      target = stagingPosition(cornerIndex, 2.4, idx);
    } else if (!entry.nodeId) {
      target = stagingPosition(cornerIndex, 1.35, idx);
    } else {
      const node = boardGraph[entry.nodeId];
      target = nodeWorldPosition(node.gridPos);
      target.y = 0.15;
      const sameNode = board.filter((b) => b.nodeId === entry.nodeId && !b.home);
      const stackPos = sameNode.findIndex((b) => b.id === entry.id);
      target.y += stackPos * 0.32;
    }
    pieceTargets.set(entry.id, target);
  }

  for (const id of [...pieceMeshes.keys()]) {
    if (!seen.has(id)) {
      const mesh = pieceMeshes.get(id)!;
      scene.remove(mesh);
      pieceMeshes.delete(id);
      pieceTargets.delete(id);
    }
  }
}

// ── Player pips + controls ────────────────────────────────────────
function renderPlayerPips() {
  ynPlayersEl.innerHTML = players.map((p, i) => {
    const color = `#${YUT_PLAYER_COLORS[i % YUT_PLAYER_COLORS.length].toString(16).padStart(6, '0')}`;
    const isTurn = p.token === currentTurnToken;
    const homeCount = board.filter((b) => b.ownerToken === p.token && b.home).length;
    return `<div class="yn-player-pip${isTurn ? ' active-turn' : ''}${p.connected ? '' : ' disconnected'}">
      <span class="yn-pip-dot" style="background:${color}"></span>
      <span>${p.name}${p.token === myToken ? ' (나)' : ''} · ${homeCount}/4</span>
    </div>`;
  }).join('');
}

function renderControls() {
  const myTurn = currentTurnToken === myToken;
  throwBtn.disabled = !myTurn || ynPhase !== 'throw' || !!pendingBranch;
  throwBtn.classList.toggle('hidden', !!pendingBranch);

  branchPickerEl.classList.toggle('hidden', !pendingBranch || !myTurn);

  const showMoveUi = myTurn && ynPhase === 'move' && !pendingBranch;
  throwQueueEl.classList.toggle('hidden', !showMoveUi);
  piecePickerEl.classList.toggle('hidden', !showMoveUi);

  if (showMoveUi) {
    if (!selectedThrowId || !pendingThrows.some((t) => t.id === selectedThrowId)) {
      selectedThrowId = pendingThrows[0]?.id ?? null;
    }
    throwQueueEl.innerHTML = pendingThrows.map((t) =>
      `<button type="button" class="yn-throw-chip" data-throw-id="${t.id}" style="${t.id === selectedThrowId ? 'outline:2px solid #f6c445;' : ''}">${THROW_LABEL[t.result.kind] ?? t.result.kind}</button>`
    ).join('');

    const myPieces = board.filter((b) => b.ownerToken === myToken && !b.home);
    const groups = new Map<string, BoardPieceEntry[]>();
    for (const piece of myPieces) {
      const arr = groups.get(piece.leadId) ?? [];
      arr.push(piece);
      groups.set(piece.leadId, arr);
    }
    const buttons: string[] = [];
    groups.forEach((group, leadId) => {
      const lead = group.find((g) => g.id === leadId) ?? group[0];
      const label = lead.nodeId ? '보드 위' : '출발 전';
      if (group.length === 1) {
        buttons.push(`<button type="button" class="yn-piece-btn" data-piece-id="${lead.id}" data-split="false">말 이동 (${label})</button>`);
      } else {
        buttons.push(`<button type="button" class="yn-piece-btn" data-piece-id="${leadId}" data-split="false">업힌 말 ${group.length}개 전체 이동</button>`);
        group.filter((g) => g.id !== leadId).forEach((g) => {
          buttons.push(`<button type="button" class="yn-piece-btn split" data-piece-id="${g.id}" data-split="true">갈라쳐서 1개만 이동</button>`);
        });
      }
    });
    piecePickerEl.innerHTML = buttons.join('');
  }
}

function renderPlaying() {
  renderPlayerPips();
  syncPieceMeshes();
  renderControls();

  if (pendingBranch && currentTurnToken === myToken) {
    turnStatus.textContent = `말이 코너에 도착했어요 — 남은 ${pendingBranch.remainingSteps}칸을 어떻게 갈까요?`;
  } else if (currentTurnToken === myToken) {
    turnStatus.textContent = ynPhase === 'throw' ? '당신의 차례입니다! 윷을 던지세요' : '이동할 말을 골라주세요';
  } else {
    turnStatus.textContent = currentTurnToken ? `${nameOfToken(currentTurnToken)}님의 차례입니다` : '';
  }
}

// ── Server message handler ────────────────────────────────────────
function applyGamePayload(payload: any) {
  board = payload.board ?? [];
  players = payload.players ?? players;
  currentTurnToken = payload.currentTurnToken ?? null;
  ynPhase = payload.phase === 'move' ? 'move' : 'throw';
  pendingThrows = payload.pendingThrows ?? [];
  if (!payload.awaitingBranch) pendingBranch = null;
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
          showToast(`${event.name}님이 ${THROW_LABEL[event.result.kind] ?? event.result.kind}를 던졌어요${event.result.extraTurn ? ' — 한 번 더!' : ''}`, 'throw');
        } else if (event.kind === 'move' || event.kind === 'capture') {
          if (event.capturedPieceIds.length) {
            showToast(`${event.name}님이 상대 말을 잡았어요! 보너스 던지기 획득`, 'capture');
          } else if (event.joinedPieceIds.length) {
            showToast(`${event.name}님이 말을 업었어요`, 'throw');
          }
        } else if (event.kind === 'turn_skipped') {
          showToast(`${event.name}님이 시간 초과로 차례를 넘겼어요`, 'info');
        } else if (event.kind === 'player_left') {
          showToast(`${event.name}님이 나갔어요`, 'info');
        }
      }
      break;
    }

    case 'await_branch':
      pendingBranch = { pieceId: msg.pieceId, cornerId: msg.cornerId, remainingSteps: msg.remainingSteps, pendingThrowId: msg.pendingThrowId };
      renderPlaying();
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
  const iWon = msg.winnerToken === myToken;
  gameOverBanner.textContent = msg.winnerName
    ? (iWon ? `🏆 승리! 말 4개를 전부 완주시켰어요!` : `🏆 ${msg.winnerName}님 승리!`)
    : '게임이 종료됐습니다.';
  gameOverBanner.className = 'set-over-result ' + (iWon ? 'win' : 'lose');
  const finalBoardData = (msg.board as BoardPieceEntry[]) ?? [];
  const byOwner = new Map<string, number>();
  finalBoardData.forEach((p) => { if (p.home) byOwner.set(p.ownerToken, (byOwner.get(p.ownerToken) ?? 0) + 1); });
  finalBoard.innerHTML = players
    .slice()
    .sort((a, b) => (byOwner.get(b.token) ?? 0) - (byOwner.get(a.token) ?? 0))
    .map((p) => `<div class="scores-row${p.token === myToken ? ' me' : ''}"><span>${p.name}</span><span>${byOwner.get(p.token) ?? 0}/4 완주</span></div>`)
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

branchStraightBtn.addEventListener('click', () => {
  if (!pendingBranch) return;
  send({ type: 'submit_move', pieceId: pendingBranch.pieceId, pendingThrowId: pendingBranch.pendingThrowId, branch: 'straight' });
});
branchShortcutBtn.addEventListener('click', () => {
  if (!pendingBranch) return;
  send({ type: 'submit_move', pieceId: pendingBranch.pieceId, pendingThrowId: pendingBranch.pendingThrowId, branch: 'shortcut' });
});

retryBtn.addEventListener('click', () => { if (pendingAction) connect(pendingAction); });

setPhase('entry');
