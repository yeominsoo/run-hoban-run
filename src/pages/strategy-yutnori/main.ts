import './strategy-yutnori.css';
import '../../shared/ws-ranking.css';
import { prepareRoomInviteEntry, ROOM_SHARE_RETURN_EVENT, shareRoomLink } from '../../shared/share';
import { setupWsRankingUI } from '../../shared/ws-ranking';
import { showCenterToast } from '../../shared/center-toast';
import { createChatWidget, type ChatWidgetHandle } from '../../shared/chat-widget';
import { buildYutBoardGraph, YUT_START_NODE_ID } from '../../game/yutnori-board';
import { nodeScreenPos, stackOffsetPct, stagingSlotPos, YUT_PLAYER_COLORS } from '../../shared/yutnori-board-2d';
import { handIcon, hiddenHandIcon, CHOICE_LABEL, type Choice } from '../../shared/hand-icons';

type Phase =
  | 'entry' | 'connecting' | 'lobby' | 'deciding'
  | 'playing' | 'game_over'
  | 'reconnecting' | 'error';

const DICE_ROUND_ANIM_MS = 700; // 서버(ws-server/strategy-yutnori.mjs)의 DICE_ROUND_ANIM_MS와 맞춘다

type PendingAction = { kind: 'create' } | { kind: 'join'; roomCode: string } | { kind: 'rejoin' };

const WS_URL = (() => {
  const c = import.meta.env.VITE_STRATEGY_YUTNORI_WS_URL as string | undefined;
  if (c) return c;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8787/strategy-yutnori`;
})();

const NAME_KEY = 'run-hoban-run:strategy-yutnori-nickname';
const SESSION_KEY = 'run-hoban-run:strategy-yutnori-session';
const RECONNECT_RETRY_MS = 2000;
const RECONNECT_MAX = 24;

const THROW_LABEL: Record<string, string> = {
  backdo: '백도(-1)', do: '도(1)', gae: '개(2)', geol: '걸(3)', yut: '윷(4)', mo: '모(5)',
};
const SIGNAL_LABEL: Record<string, string> = { front: '앞면 내줘', back: '뒷면 내줘', free: '자유롭게' };
const REACTION_OPTIONS = [
  { id: 'tease', emoji: '😜', label: '놀림' },
  { id: 'sad', emoji: '😭', label: '슬픔' },
  { id: 'smug', emoji: '😎', label: '의기양양' },
  { id: 'cheer', emoji: '👏', label: '응원' },
  { id: 'shock', emoji: '😱', label: '충격' },
] as const;

interface SavedSession { roomCode: string; token: string; name: string; }

function saveSession() {
  if (!myToken || !roomCode) return;
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode, token: myToken, name: myName })); } catch { /* ignore */ }
}
function loadSession(): SavedSession | null {
  try { const raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
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
let signalTimer: ReturnType<typeof setTimeout> | null = null;

interface BoardPieceEntry { id: string; ownerToken: string; leadId: string; home: boolean; nodeId: string | null; }
interface PlayerEntry { token: string; name: string; connected: boolean; }
interface ThrowResult { kind: string; steps: number; frontCount?: number; backCount: number; faces: Record<string, string> }
interface ReactionMessage { token: string; name: string; reaction: { id: string; emoji: string; label: string }; sentAt?: number; }

let board: BoardPieceEntry[] = [];
let players: PlayerEntry[] = [];
let teams: [string, string][] = [];
const playerColorSlots = new Map<string, number>();
let moveOrder: string[] = [];
let currentMoverToken: string | null = null;
let syPhase: 'collecting' | 'moving' = 'collecting';
let submittedTokens: string[] = [];
let lastThrow: ThrowResult | null = null;
let round = 1;
let mySubmittedThisRound = false;
let lastSignal: { fromName: string; suggestion: string } | null = null;

// ── 선공 결정전(팀 주사위 대표선출 + 가위바위보) 상태 ────────────────
let decideRepAToken = '';
let decideRepAName = '';
let decideRepBToken = '';
let decideRepBName = '';
let myDecideChoice: Choice | null = null;

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

<div class="yn-shell">
  <div class="yn-top-bar">
    <a class="back-link" href="/">← 게임 선택</a>
    <button class="ws-ranking-btn" id="ws-ranking-btn" type="button">🏆 이번 주 랭킹</button>
  </div>
  <div class="yn-stage">
    <h1 class="yn-title">전략윷놀이</h1>
    <p class="yn-sub">2:2로 짝을 이루지만, 파트너도 믿을 순 없어요 — 앞면/뒷면을 비공개로 골라 던지세요</p>

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
        <p class="status-text">정확히 4명이 모여야 시작할 수 있어요 (2:2 팀전).</p>
        <button id="create-btn" type="button" class="yn-btn primary">방 만들기</button>
      </div>

      <div class="entry-section hidden" id="join-section">
        <label class="field-label" for="room-code-input">방 코드</label>
        <input id="room-code-input" type="text" maxlength="6" placeholder="예: 3F9A2C" class="nickname-input room-code-input" />
        <button id="join-btn" type="button" class="yn-btn primary">참가하기</button>
      </div>

      <p class="entry-error hidden" id="entry-error"></p>
    </div>

    <!-- Waiting -->
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
      <div class="how-to-play">
        <p class="how-to-play-title">🎮 게임 방법</p>
        <ul class="how-to-play-list">
          <li>시작 전 각 팀이 주사위로 대표를 뽑고, 대표끼리 가위바위보(단판)로 선공 팀을 정해요.</li>
          <li>4명이 2:2 팀으로 진행해요. 매 턴 앞면/뒷면 중 하나를 비공개로 골라 동시에 제출하면 던지기 값이 정해져요.</li>
          <li>짝에게만 보이는 시그널 카드로 몰래 신호를 주고받을 수 있어요(배신도 가능!).</li>
          <li>내 말 2개를 먼저 완주시키면 승리 — 팀원 상태와 무관하게 개인 우승이에요.</li>
        </ul>
      </div>
      <p class="status-text" id="lobby-status">참가자를 기다리는 중… (정확히 4명 필요)</p>
      <button id="start-btn" type="button" class="yn-btn primary hidden">게임 시작</button>
      <button id="lobby-cancel-btn" type="button" class="yn-btn secondary">나가기</button>
    </div>

    <!-- 선공 결정전 -->
    <div class="yn-panel hidden" id="deciding-panel">
      <p class="status-text">선공(첫 차례)을 가리는 중이에요!</p>
      <div class="dice-off-row hidden" id="dice-off-row"></div>
      <div class="decide-names hidden" id="decide-names-row">
        <span class="decide-name" id="decide-a-name"></span>
        <span class="vs-mark">VS</span>
        <span class="decide-name" id="decide-b-name"></span>
      </div>
      <div class="decide-hands hidden" id="decide-hands-row">
        <div class="hand-slot mine" id="decide-my-hand"></div>
        <div class="hand-slot theirs" id="decide-opp-hand"></div>
      </div>
      <p class="decide-status" id="decide-status">대표를 뽑는 중…</p>
      <div class="decide-choice-row hidden" id="decide-choice-row">
        <button class="decide-choice-btn" data-choice="rock" type="button">${handIcon('rock', true)}<span>${CHOICE_LABEL.rock}</span></button>
        <button class="decide-choice-btn" data-choice="scissors" type="button">${handIcon('scissors', true)}<span>${CHOICE_LABEL.scissors}</span></button>
        <button class="decide-choice-btn" data-choice="paper" type="button">${handIcon('paper', true)}<span>${CHOICE_LABEL.paper}</span></button>
      </div>
    </div>

    <!-- Playing -->
    <div class="yn-panel wide hidden" id="playing-panel">
      <p class="status-text" id="sy-turn-status"></p>
      <div class="sy-revealed-faces hidden" id="sy-revealed-faces"></div>
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
        <div class="sy-face-picker hidden" id="sy-face-picker">
          <button type="button" class="sy-face-btn front" id="face-front-btn">
            <span class="sy-face-stick flat" aria-hidden="true"></span>
            <span class="sy-face-text">앞면</span>
          </button>
          <button type="button" class="sy-face-btn back" id="face-back-btn">
            <span class="sy-face-stick round" aria-hidden="true"></span>
            <span class="sy-face-text">뒷면</span>
          </button>
        </div>
        <div class="sy-signal-row hidden" id="sy-signal-row">
          <span class="sy-signal-label">파트너에게 신호 보내기</span>
          <div class="sy-signal-cards">
            <button type="button" class="sy-signal-btn" data-suggestion="front">앞면 내</button>
            <button type="button" class="sy-signal-btn" data-suggestion="back">뒷면 내</button>
            <button type="button" class="sy-signal-btn" data-suggestion="free">자유롭게</button>
          </div>
        </div>
        <div class="sy-signal-received hidden" id="sy-signal-received"></div>
      </div>

      <div class="yn-choice-overlay hidden" id="yn-choice-overlay">
        <div class="yn-choice-backdrop"></div>
        <div class="yn-choice-sheet">
          <div class="yn-choice-title">움직일 말을 선택하세요</div>
          <div class="yn-piece-picker" id="yn-piece-picker"></div>
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
setupWsRankingUI({
  gameKey: 'strategy-yutnori',
  gameTitle: '전략윷놀이',
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
  deciding: document.getElementById('deciding-panel')!,
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
const lobbyPlayers = document.getElementById('lobby-players')!;
const lobbyStatus = document.getElementById('lobby-status')!;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;

const diceOffRow = document.getElementById('dice-off-row')!;
const decideNamesRow = document.getElementById('decide-names-row')!;
const decideANameEl = document.getElementById('decide-a-name')!;
const decideBNameEl = document.getElementById('decide-b-name')!;
const decideHandsRow = document.getElementById('decide-hands-row')!;
const decideMyHand = document.getElementById('decide-my-hand')!;
const decideOppHand = document.getElementById('decide-opp-hand')!;
const decideStatus = document.getElementById('decide-status')!;
const decideChoiceRow = document.getElementById('decide-choice-row')!;
const decideChoiceBtns = Array.from(decideChoiceRow.querySelectorAll<HTMLButtonElement>('.decide-choice-btn'));
const lobbyCancelBtn = document.getElementById('lobby-cancel-btn') as HTMLButtonElement;

const turnStatus = document.getElementById('sy-turn-status')!;
const revealedFacesEl = document.getElementById('sy-revealed-faces')!;
const boardSvgEl = document.getElementById('yn-board-svg') as unknown as SVGSVGElement;
const boardTokensEl = document.getElementById('yn-board-tokens')!;
const seatBadgeEls = [0, 1, 2, 3].map((i) => document.getElementById(`yn-seat-badge-${i}`)!);
const seatReactionEls = [0, 1, 2, 3].map((i) => document.getElementById(`yn-seat-reaction-${i}`)!);
const seatEls = [0, 1, 2, 3].map((i) => document.getElementById(`yn-seat-${i}`)!);
const seatReactionTimers: (ReturnType<typeof setTimeout> | null)[] = [null, null, null, null];
const facePickerEl = document.getElementById('sy-face-picker')!;
const faceFrontBtn = document.getElementById('face-front-btn') as HTMLButtonElement;
const faceBackBtn = document.getElementById('face-back-btn') as HTMLButtonElement;
const signalRowEl = document.getElementById('sy-signal-row')!;
const signalReceivedEl = document.getElementById('sy-signal-received')!;
const choiceOverlayEl = document.getElementById('yn-choice-overlay')!;
const piecePickerEl = document.getElementById('yn-piece-picker')!;

const chatWidget: ChatWidgetHandle = createChatWidget({
  channels: [
    { id: 'general', label: '전체' },
    { id: 'team', label: '팀' },
  ],
  position: 'right',
  onSend: (channelId, text) => {
    send({ type: channelId === 'team' ? 'submit_team_chat' : 'submit_chat', text });
  },
  reactions: REACTION_OPTIONS,
  onReact: (reactionId) => send({ type: 'submit_reaction', reactionId }),
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
  prepareRoomInviteEntry(roomCodeInput, joinBtn, roomFromUrl);
}

const resumableSession = loadSession();
if (resumableSession) {
  resumeText.textContent = `"${resumableSession.name}"님으로 참여하던 방(${resumableSession.roomCode})이 있어요. 다시 들어가시겠어요?`;
  resumeBanner.classList.remove('hidden');
}

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
  vis(panels.deciding, next === 'deciding');
  vis(panels.playing, next === 'playing');
  vis(panels.gameOver, next === 'game_over');
  vis(panels.error, next === 'error');
}

function showEntryError(msg: string) { entryError.textContent = msg; entryError.classList.remove('hidden'); }
function hideEntryError() { entryError.classList.add('hidden'); }

// ── 선공 결정전(팀 주사위 대표선출 + 가위바위보) ─────────────────────
function setDecideButtonsEnabled(enabled: boolean) {
  decideChoiceBtns.forEach((btn) => { btn.disabled = !enabled; });
}
decideChoiceBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (phase !== 'deciding' || myDecideChoice) return;
    const choice = btn.dataset.choice as Choice;
    myDecideChoice = choice;
    setDecideButtonsEnabled(false);
    decideMyHand.innerHTML = handIcon(choice, true);
    decideStatus.textContent = '선택 완료! 상대를 기다리는 중…';
    send({ type: 'decide_choice', choice });
  });
});

function renderDiceOffSide(members: { token: string; name: string }[], rounds: Record<string, number>[], repToken: string): HTMLElement {
  const group = document.createElement('div');
  group.className = 'dice-off-group';
  const cardByToken = new Map<string, HTMLElement>();
  for (const m of members) {
    const card = document.createElement('div');
    card.className = 'dice-off-player';
    card.innerHTML = `<span class="dice-off-name">${m.name}</span><span class="dice-off-face rolling">?</span>`;
    group.appendChild(card);
    cardByToken.set(m.token, card);
  }
  let i = 0;
  const tick = () => {
    const round = rounds[i];
    for (const [token, val] of Object.entries(round)) {
      const card = cardByToken.get(token);
      const face = card?.querySelector('.dice-off-face');
      if (face) face.textContent = String(val);
    }
    i += 1;
    if (i < rounds.length) {
      setTimeout(tick, DICE_ROUND_ANIM_MS);
    } else {
      cardByToken.forEach((card, token) => {
        card.querySelector('.dice-off-face')?.classList.remove('rolling');
        card.classList.toggle('winner', token === repToken);
      });
    }
  };
  if (rounds.length > 0) tick();
  return group;
}

function renderDeciding(msg: any) {
  diceOffRow.innerHTML = '';
  const sideA = msg.sideA as { token: string; name: string }[];
  const sideB = msg.sideB as { token: string; name: string }[];
  const diceRoundsA = msg.diceRoundsA as Record<string, number>[];
  const diceRoundsB = msg.diceRoundsB as Record<string, number>[];

  const needsDiceUi = diceRoundsA.length > 0 || diceRoundsB.length > 0;
  diceOffRow.classList.toggle('hidden', !needsDiceUi);
  if (diceRoundsA.length > 0) diceOffRow.appendChild(renderDiceOffSide(sideA, diceRoundsA, msg.repAToken));
  if (diceRoundsB.length > 0) diceOffRow.appendChild(renderDiceOffSide(sideB, diceRoundsB, msg.repBToken));

  decideNamesRow.classList.add('hidden');
  decideHandsRow.classList.add('hidden');
  decideChoiceRow.classList.add('hidden');
  decideStatus.textContent = needsDiceUi ? '주사위로 팀 대표를 뽑는 중…' : '대표가 정해졌어요…';
}

function renderDecideRpsReady(msg: any) {
  decideRepAToken = msg.repAToken;
  decideRepAName = msg.repAName;
  decideRepBToken = msg.repBToken;
  decideRepBName = msg.repBName;
  myDecideChoice = null;

  diceOffRow.classList.add('hidden');
  decideANameEl.textContent = decideRepAName;
  decideBNameEl.textContent = decideRepBName;
  decideNamesRow.classList.remove('hidden');
  decideHandsRow.classList.remove('hidden');
  decideMyHand.innerHTML = hiddenHandIcon();
  decideOppHand.innerHTML = hiddenHandIcon();

  const amRep = myToken === decideRepAToken || myToken === decideRepBToken;
  decideChoiceRow.classList.toggle('hidden', !amRep);
  setDecideButtonsEnabled(amRep);
  decideStatus.textContent = amRep
    ? '가위바위보를 선택하세요!'
    : `${decideRepAName}님과 ${decideRepBName}님이 가위바위보로 선공을 정하는 중…`;
}

async function copyLink(code: string, btn: HTMLButtonElement) {
  const link = `${location.origin}/strategy-yutnori/?room=${code}`;
  await shareRoomLink({ url: link, title: '전략윷놀이 초대', text: `전략윷놀이 방(${code})에 초대할게요! (정확히 4명 필요)`, btn });
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
    try { handleServerMessage(JSON.parse(e.data)); } catch { /* ignore malformed frame */ }
  });

  ws.addEventListener('close', () => {
    if (intentionalClose) return;
    const inGame = ['lobby', 'deciding', 'playing', 'reconnecting'].includes(phase);
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
  chatWidget.clearAll();
  playerColorSlots.clear();
  moveOrder = [];
  currentMoverToken = null;
  syPhase = 'collecting';
  submittedTokens = [];
  lastThrow = null;
  round = 1;
  mySubmittedThisRound = false;
  lastSignal = null;
  clearAllReactions();
}

function renderLobbyPlayers(list: { name: string; isHost: boolean; connected: boolean }[]) {
  lobbyPlayers.innerHTML = list.map((p) =>
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

/** 라운드 확정 시 4명이 제출한 앞/뒤를 윷가락으로 그려 중앙 토스트에 띄운다. */
function throwToastHtml(result: ThrowResult): string {
  const sticks = Object.values(result.faces).map((face) =>
    `<span class="ct-yut-stick ${face === 'back' ? 'round' : 'flat'}"></span>`,
  ).join('');
  const bonus = (result.kind === 'yut' || result.kind === 'mo') ? '<span class="bonus">⭐ 한 번 더</span>' : '';
  return `<div class="ct-yut-row">${sticks}</div><div class="ct-yut-value">${THROW_LABEL[result.kind] ?? result.kind}${bonus}</div>`;
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

function nameOfToken(token: string | null): string {
  if (!token) return '?';
  return players.find((p) => p.token === token)?.name ?? '?';
}
function playerColor(token: string): string {
  const idx = Math.max(0, stablePlayerIndex(token));
  return YUT_PLAYER_COLORS[idx % YUT_PLAYER_COLORS.length];
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

/** 자기 말 몇 번인지(1~2) — id가 `${ownerToken}-${index}` 형식인 걸 이용한다. */
function pieceNumber(entry: BoardPieceEntry): number {
  return Number(entry.id.split('-').pop()) + 1;
}

// ── 2D 보드 렌더링 (yutnori와 동일한 공용 좌표 모듈 재사용) ────────
const boardGraph = buildYutBoardGraph();
const pieceTokenEls = new Map<string, HTMLDivElement>();
// 이번 이동 단계에서 보드 클릭으로 고를 수 있는 lead 피스들.
const selectablePieceIds = new Set<string>();

/** 보드 트랙(외곽 사각형 + 대각선 지름길) SVG를 한 번만 만든다. */
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
  if (currentMoverToken !== myToken || syPhase !== 'moving') return;
  const el = (e.target as HTMLElement).closest('.yn-piece-token') as HTMLElement | null;
  const pieceId = el?.dataset.pieceId;
  if (!pieceId || !selectablePieceIds.has(pieceId)) return;
  // 보드 클릭은 스택 전체 이동만 담당한다. 갈라치기는 하단 텍스트 버튼으로 남겨둔다.
  send({ type: 'submit_move', pieceId, splitOff: false });
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
/** 좌석 순서는 참가 순서(stablePlayerIndex)로 고정: 1p=11시, 2p=1시, 3p=5시, 4p=7시(시계방향).
 *  파트너 페어링(0,1)/(2,3)이 각각 상단/하단 두 좌석으로 자연스럽게 짝지어진다. */
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
    const p = players.find((pl) => pl.token === token);
    if (!p) continue;
    const color = playerColor(token);
    const isTurn = token === currentMoverToken;
    const homeCount = board.filter((b) => b.ownerToken === token && b.home).length;
    const teamIdx = teams.findIndex((t) => t.includes(token));
    const teamTag = teamIdx >= 0 ? `<span class="yn-seat-team">팀${teamIdx + 1}</span>` : '';
    const hasSubmitted = submittedTokens.includes(token);
    badgeEl.innerHTML = `
      <span class="yn-seat-dot" style="background:${color}"></span>
      <span class="yn-seat-name">${escapeHtml(p.name)}${token === myToken ? ' (나)' : ''}</span>
      ${teamTag}
      <span class="yn-seat-score">${homeCount}/2</span>
    `;
    badgeEl.classList.toggle('active-turn', isTurn);
    badgeEl.classList.toggle('disconnected', !p.connected);
    badgeEl.classList.toggle('submitted', syPhase === 'collecting' && hasSubmitted);
  }
}

function renderRevealedFaces() {
  if (!lastThrow) { revealedFacesEl.classList.add('hidden'); return; }
  revealedFacesEl.classList.remove('hidden');
  // 4명이 비공개 제출한 앞/뒤를 윷가락 4개로 시각화한다. front=젖혀짐(밝은 배), back=엎어짐(어두운 등).
  // 각 가락에 제출자 색/이름을 붙여 "누가 앞/뒤를 냈는지"(배신 요소)를 드러낸다.
  const sticks = Object.entries(lastThrow.faces).map(([token, face]) => {
    const color = playerColor(token);
    return `<div class="sy-yut-stick ${face === 'back' ? 'round' : 'flat'}">
      <span class="sy-stick-bar"></span>
      <span class="sy-stick-tag"><span class="sy-stick-owner" style="background:${color}"></span>${nameOfToken(token)}</span>
    </div>`;
  }).join('');
  revealedFacesEl.innerHTML =
    `<div class="sy-stick-row">${sticks}</div>` +
    `<div class="sy-throw-value${lastThrow.kind === 'backdo' ? ' backdo' : ''}">${THROW_LABEL[lastThrow.kind] ?? lastThrow.kind}${(lastThrow.kind === 'yut' || lastThrow.kind === 'mo') ? ' ⭐ 한 번 더' : ''}</div>`;
}

function renderControls() {
  const showFacePicker = syPhase === 'collecting' && !mySubmittedThisRound;
  facePickerEl.classList.toggle('hidden', !showFacePicker);
  signalRowEl.classList.toggle('hidden', !showFacePicker);
  signalReceivedEl.classList.toggle('hidden', !lastSignal);
  if (lastSignal) signalReceivedEl.textContent = `${lastSignal.fromName}님의 신호: "${SIGNAL_LABEL[lastSignal.suggestion] ?? lastSignal.suggestion}"`;

  const myTurn = currentMoverToken === myToken;

  const showMoveUi = myTurn && syPhase === 'moving';
  choiceOverlayEl.classList.toggle('hidden', !showMoveUi);

  selectablePieceIds.clear();
  if (showMoveUi) {
    const isBackdo = lastThrow?.kind === 'backdo';
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
  renderRevealedFaces();

  if (syPhase === 'collecting') {
    const activeName = currentMoverToken ? nameOfToken(currentMoverToken) : '현재 플레이어';
    turnStatus.textContent = mySubmittedThisRound
      ? `${activeName}님의 던지기 — 제출 완료 (${submittedTokens.length}/4)`
      : `${activeName}님의 던지기 — 앞면/뒷면 중 하나를 비공개로 제출하세요`;
  } else if (currentMoverToken === myToken) {
    turnStatus.textContent = `${THROW_LABEL[lastThrow?.kind ?? ''] ?? ''} — 보드에서 움직일 말을 클릭하세요`;
  } else {
    turnStatus.textContent = currentMoverToken ? `${nameOfToken(currentMoverToken)}님이 이동 중…` : '';
  }
}

// ── Server message handler ────────────────────────────────────────
function applyGamePayload(payload: any) {
  board = payload.board ?? [];
  players = payload.players ?? players;
  syncPlayerSlots(players);
  teams = payload.teams ?? teams;
  moveOrder = payload.moveOrder ?? moveOrder;
  currentMoverToken = payload.currentMoverToken ?? null;
  syPhase = payload.phase === 'moving' ? 'moving' : 'collecting';
  submittedTokens = payload.submittedTokens ?? [];
  lastThrow = payload.lastThrow ?? null;
  round = payload.round ?? round;
  mySubmittedThisRound = !!myToken && submittedTokens.includes(myToken);
  if (syPhase === 'collecting' && !lastThrow) lastSignal = null;
}

function handleServerMessage(msg: any) {
  switch (msg.type) {

    case 'room_created':
      myToken = msg.token;
      roomCode = msg.roomCode;
      isHost = true;
      reconnectAttempts = 0;
      lobbyCodeDisplay.textContent = roomCode;
      lobbyStatus.textContent = '참가자를 기다리는 중… (정확히 4명 필요)';
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
        lobbyStatus.textContent = '4명 입장 완료 — 시작할 준비가 됐어요!';
      } else {
        startBtn.classList.add('hidden');
        lobbyStatus.textContent = isHost
          ? `현재 ${connectedCount}/4명 — 정확히 4명이 필요해요…`
          : `현재 ${connectedCount}/4명 — 호스트가 시작하기를 기다리는 중…`;
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

    case 'decide_start':
      setPhase('deciding');
      renderDeciding(msg);
      break;

    case 'decide_rps_ready':
      renderDecideRpsReady(msg);
      break;

    case 'decide_tie': {
      const myChoice = myToken === decideRepAToken ? msg.choiceA : msg.choiceB;
      const oppChoice = myToken === decideRepAToken ? msg.choiceB : msg.choiceA;
      decideMyHand.innerHTML = handIcon(myChoice, true);
      decideOppHand.innerHTML = handIcon(oppChoice, true);
      decideStatus.textContent = '비겼어요! 다시 선택하세요.';
      setTimeout(() => {
        if (phase !== 'deciding') return;
        myDecideChoice = null;
        decideMyHand.innerHTML = hiddenHandIcon();
        decideOppHand.innerHTML = hiddenHandIcon();
        const amRep = myToken === decideRepAToken || myToken === decideRepBToken;
        decideStatus.textContent = amRep
          ? '가위바위보를 선택하세요!'
          : `${decideRepAName}님과 ${decideRepBName}님이 가위바위보로 선공을 정하는 중…`;
        setDecideButtonsEnabled(amRep);
      }, 900);
      break;
    }

    case 'decide_result': {
      const myChoice = myToken === decideRepAToken ? msg.choiceA : msg.choiceB;
      const oppChoice = myToken === decideRepAToken ? msg.choiceB : msg.choiceA;
      decideMyHand.innerHTML = handIcon(myChoice, true);
      decideOppHand.innerHTML = handIcon(oppChoice, true);
      decideStatus.textContent = `🏆 ${msg.winnerName}님 팀이 선공이에요!`;
      setDecideButtonsEnabled(false);
      break;
    }

    case 'decide_aborted':
      setPhase('lobby');
      lobbyStatus.textContent = msg.reason ?? '선공 결정이 취소됐어요. 다시 시작해주세요.';
      break;

    case 'game_update': {
      applyGamePayload(msg);
      if (phase !== 'playing') setPhase('playing');

      const event = msg.event as
        | { kind: 'face_submitted'; token: string; name: string }
        | { kind: 'round_resolved'; throw: ThrowResult; timedOut?: boolean }
        | { kind: 'move' | 'capture'; token: string; name: string; pieceId: string; capturedPieceIds: string[]; joinedPieceIds: string[]; bonusThrow?: boolean; roundOver: boolean; timedOut?: boolean }
        | { kind: 'player_left'; name: string }
        | null;

      if (event) {
        if (event.kind === 'face_submitted') {
          showToast(`${event.name}님이 제출을 마쳤어요`, 'info');
        } else if (event.kind === 'round_resolved') {
          showCenterToast(throwToastHtml(event.throw), { kind: 'throw', html: true, duration: 2600 });
          if (event.timedOut) showToast('시간초과로 일부 자동제출됐어요', 'info');
        } else if (event.kind === 'move' || event.kind === 'capture') {
          if (event.capturedPieceIds.length) {
            const captureNames = event.capturedPieceIds.map((id) => nameOfToken(board.find((b) => b.id === id)?.ownerToken ?? null));
            showToast(`${event.name}님이 ${captureNames.join(', ')}님의 말을 잡았어요!${event.timedOut ? ' (시간초과 자동이동)' : ''}`, 'capture');
          } else if (event.joinedPieceIds.length) {
            showToast(`${event.name}님이 말을 업었어요`, 'throw');
          }
          if (event.bonusThrow) {
            showToast(`${event.name}님이 한 번 더 던집니다`, 'throw');
          }
        } else if (event.kind === 'player_left') {
          showToast(`${event.name}님이 나갔어요`, 'info');
        }
      }
      renderPlaying();
      if (event && (event.kind === 'move' || event.kind === 'capture')) {
        const movedPiece = board.find((b) => b.id === event.pieceId);
        if (event.capturedPieceIds.length) {
          event.capturedPieceIds.forEach(hopPiece);
        } else if (event.joinedPieceIds.length) {
          event.joinedPieceIds.forEach(hopPiece);
          hopPiece(event.pieceId);
        }
        if (movedPiece?.home) flashHome(movedPiece.ownerToken);
      }
      break;
    }

    case 'chat_message':
      chatWidget.addMessage('general', { name: msg.name, text: msg.text, mine: msg.token === myToken });
      break;

    case 'team_chat_message':
      chatWidget.addMessage('team', { name: msg.name, text: msg.text, mine: msg.token === myToken });
      break;

    case 'reaction_message':
      showReaction(msg);
      chatWidget.addMessage('general', {
        name: msg.name,
        text: `${msg.reaction?.emoji ?? ''} ${msg.reaction?.label ?? ''}`.trim(),
        mine: msg.token === myToken,
      });
      break;

    case 'signal_received':
      lastSignal = { fromName: msg.fromName, suggestion: msg.suggestion };
      if (signalTimer) clearTimeout(signalTimer);
      renderControls();
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
  const iAmPartner = msg.partnerToken === myToken;
  gameOverBanner.textContent = msg.winnerName
    ? (iWon ? `🏆 승리! 말 2개를 전부 완주시켰어요!` : iAmPartner ? `🏆 파트너 ${msg.winnerName}님 승리! (같이 이겼어요)` : `🏆 ${msg.winnerName}님 승리!`)
    : '게임이 종료됐습니다.';
  gameOverBanner.className = 'set-over-result ' + (iWon || iAmPartner ? 'win' : 'lose');
  const finalBoardData = (msg.board as BoardPieceEntry[]) ?? [];
  const byOwner = new Map<string, number>();
  finalBoardData.forEach((p) => { if (p.home) byOwner.set(p.ownerToken, (byOwner.get(p.ownerToken) ?? 0) + 1); });
  finalBoard.innerHTML = players
    .slice()
    .sort((a, b) => (byOwner.get(b.token) ?? 0) - (byOwner.get(a.token) ?? 0))
    .map((p) => `<div class="scores-row${p.token === myToken ? ' me' : ''}"><span>${p.name}</span><span>${byOwner.get(p.token) ?? 0}/2 완주</span></div>`)
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
  connect({ kind: 'create' });
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

window.addEventListener(ROOM_SHARE_RETURN_EVENT, () => {
  if (!myToken || !roomCode || intentionalClose || reconnectTimer) return;
  if (socket?.readyState === WebSocket.OPEN) {
    socket.close(4000, 'resume-after-share');
  } else if (socket?.readyState !== WebSocket.CONNECTING) {
    beginReconnect();
  }
});

startBtn.addEventListener('click', () => { send({ type: 'start' }); });

faceFrontBtn.addEventListener('click', () => { send({ type: 'submit_face', face: 'front' }); mySubmittedThisRound = true; renderControls(); });
faceBackBtn.addEventListener('click', () => { send({ type: 'submit_face', face: 'back' }); mySubmittedThisRound = true; renderControls(); });

signalRowEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('[data-suggestion]') as HTMLElement | null;
  if (!btn) return;
  send({ type: 'submit_signal', suggestion: btn.dataset.suggestion });
});

piecePickerEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('[data-piece-id]') as HTMLElement | null;
  if (!btn) return;
  send({ type: 'submit_move', pieceId: btn.dataset.pieceId, splitOff: btn.dataset.split === 'true' });
});

retryBtn.addEventListener('click', () => { if (pendingAction) connect(pendingAction); });

setPhase('entry');
