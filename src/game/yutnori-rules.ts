import {
  buildYutBoardGraph,
  cornerIndexOfDiagonal,
  entryNodeId,
  getCenterExit,
  MAX_PLAYERS,
  type YutBoardGraph,
} from './yutnori-board';

export type ThrowKind = 'backdo' | 'do' | 'gae' | 'geol' | 'yut' | 'mo';

export interface ThrowResult {
  kind: ThrowKind;
  /** 항상 양수 크기. backdo는 kind로 방향(후진)을 구분하고 steps는 1로 고정. */
  steps: number;
  extraTurn: boolean;
}

// 실제 윷가락 확률의 단순화 근사치. 백도는 특수 표시된 가락 조합에서만 드물게 나온다는 점만 반영.
const THROW_TABLE: { kind: ThrowKind; steps: number; weight: number }[] = [
  { kind: 'backdo', steps: 1, weight: 3 },
  { kind: 'do', steps: 1, weight: 32 },
  { kind: 'gae', steps: 2, weight: 35 },
  { kind: 'geol', steps: 3, weight: 18 },
  { kind: 'yut', steps: 4, weight: 7 },
  { kind: 'mo', steps: 5, weight: 5 },
];
const THROW_TOTAL_WEIGHT = THROW_TABLE.reduce((sum, entry) => sum + entry.weight, 0);

export function rollYutThrow(rng: () => number): ThrowResult {
  let roll = rng() * THROW_TOTAL_WEIGHT;
  for (const entry of THROW_TABLE) {
    if (roll < entry.weight) {
      return { kind: entry.kind, steps: entry.steps, extraTurn: entry.kind === 'yut' || entry.kind === 'mo' };
    }
    roll -= entry.weight;
  }
  const fallback = THROW_TABLE[0];
  return { kind: fallback.kind, steps: fallback.steps, extraTurn: false };
}

export function mulberry32(seed: number): () => number {
  return function rng() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PIECES_PER_PLAYER = 4;

export interface Piece {
  id: string;
  ownerToken: string;
  /** 자기 자신이면 단독/업기 스택의 선두. 다른 말의 id면 그 말의 스택에 업혀있는 상태. */
  leadId: string;
  /** 선두 말일 때만 의미 있음: 지금까지 지나온 칸 id들(출발 전이면 빈 배열). 마지막 원소가 현재 위치. */
  path: string[];
  home: boolean;
}

export interface PendingThrow {
  id: string;
  result: ThrowResult;
}

export interface BranchChoice {
  pieceId: string;
  cornerId: string;
  remainingSteps: number;
  pendingThrowId: string;
}

export type YutEvent =
  | { kind: 'throw'; token: string; result: ThrowResult }
  | { kind: 'move'; token: string; pieceId: string; path: string[]; capturedPieceIds: string[]; joinedPieceIds: string[] }
  | { kind: 'reach-home'; token: string; pieceId: string; homeCount: number }
  | { kind: 'bonus-throw'; token: string; reason: 'capture' | 'yut-or-mo' }
  | { kind: 'turn-advance'; token: string };

export interface GameState {
  graph: YutBoardGraph;
  tokens: string[];
  pieces: Piece[];
  turnOrder: string[];
  turnIndex: number;
  pendingThrows: PendingThrow[];
  phase: 'throw' | 'move';
  awaitingBranch: BranchChoice | null;
  winner: string | null;
  rng: () => number;
  throwSeq: number;
}

export function createYutGame(tokens: string[], seed: number): GameState {
  if (tokens.length < 2 || tokens.length > MAX_PLAYERS) {
    throw new Error(`yutnori supports 2-${MAX_PLAYERS} players, got ${tokens.length}`);
  }
  const pieces: Piece[] = [];
  tokens.forEach((token) => {
    for (let i = 0; i < PIECES_PER_PLAYER; i += 1) {
      const id = `${token}-${i}`;
      pieces.push({ id, ownerToken: token, leadId: id, path: [], home: false });
    }
  });
  return {
    graph: buildYutBoardGraph(),
    tokens,
    pieces,
    turnOrder: [...tokens],
    turnIndex: 0,
    pendingThrows: [],
    phase: 'throw',
    awaitingBranch: null,
    winner: null,
    rng: mulberry32(seed),
    throwSeq: 0,
  };
}

export function currentToken(state: GameState): string {
  return state.turnOrder[state.turnIndex];
}

function cornerIndexOfToken(state: GameState, token: string): number {
  return state.tokens.indexOf(token);
}

function findPiece(state: GameState, pieceId: string): Piece {
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece) throw new Error(`unknown piece ${pieceId}`);
  return piece;
}

function leadOf(state: GameState, piece: Piece): Piece {
  return piece.leadId === piece.id ? piece : findPiece(state, piece.leadId);
}

function followersOf(state: GameState, leadId: string): Piece[] {
  return state.pieces.filter((p) => p.leadId === leadId && p.id !== leadId);
}

function currentPosition(piece: Piece): string {
  return piece.path.length === 0 ? 'start' : piece.path[piece.path.length - 1];
}

/** submit_throw: 현재 턴 플레이어가 윷을 던진다. throw 단계에서만 허용된다. */
export function submitThrow(state: GameState): ThrowResult {
  if (state.winner) throw new Error('game already over');
  if (state.phase !== 'throw') throw new Error('not in throw phase');
  if (state.awaitingBranch) throw new Error('awaiting branch choice');

  const result = rollYutThrow(state.rng);
  state.throwSeq += 1;
  state.pendingThrows.push({ id: `throw-${state.throwSeq}`, result });
  if (!result.extraTurn) state.phase = 'move';
  return result;
}

/** 이 던지기 결과로 옮길 수 있는 말이 하나라도 있는지(백도인데 보드 위 말이 없는 경우 등을 걸러낸다). */
export function hasLegalMove(state: GameState, token: string, pendingThrow: PendingThrow): boolean {
  const ownPieces = state.pieces.filter((p) => p.ownerToken === token && !p.home && p.leadId === p.id);
  if (pendingThrow.result.kind === 'backdo') {
    return ownPieces.some((p) => p.path.length > 0);
  }
  return ownPieces.length > 0;
}

/** 지금 던지기 대기열 중 실제로 쓸 수 있는(=옮길 말이 있는) 항목만 골라 자동 폐기하고 남은 것을 반환한다. */
export function discardDeadThrows(state: GameState): void {
  const token = currentToken(state);
  state.pendingThrows = state.pendingThrows.filter((pt) => hasLegalMove(state, token, pt));
}

interface WalkOutcome {
  status: 'finished' | 'home' | 'awaiting-branch';
  path: string[];
  cornerId?: string;
  remainingSteps?: number;
}

function walkForward(
  graph: YutBoardGraph,
  startPath: string[],
  ownCornerId: string,
  steps: number,
  branchChoiceFor: (cornerId: string) => 'straight' | 'shortcut' | undefined,
): WalkOutcome {
  const path = [...startPath];
  const justPlaced = startPath.length === 0;
  let remaining = steps;
  let hopIndex = 0;

  while (remaining > 0) {
    const currentId = path.length === 0 ? 'start' : path[path.length - 1];
    let nextId: string;

    if (currentId === 'start') {
      nextId = ownCornerId;
    } else {
      const node = graph[currentId];
      if (node.kind === 'corner') {
        const choice = branchChoiceFor(currentId);
        if (choice === undefined) {
          return { status: 'awaiting-branch', path, cornerId: currentId, remainingSteps: remaining };
        }
        nextId = choice === 'shortcut' ? node.shortcutNext! : node.next;
      } else if (node.kind === 'center') {
        const prevId = path.length >= 2 ? path[path.length - 2] : undefined;
        const fromCornerIndex = prevId ? cornerIndexOfDiagonal(prevId) : 0;
        nextId = getCenterExit(fromCornerIndex);
      } else {
        nextId = node.next;
      }
    }

    path.push(nextId);
    remaining -= 1;

    const isHome = nextId === ownCornerId && !(hopIndex === 0 && justPlaced);
    if (isHome) return { status: 'home', path };
    hopIndex += 1;
  }

  return { status: 'finished', path };
}

function walkBackward(startPath: string[]): WalkOutcome {
  return { status: 'finished', path: startPath.slice(0, -1) };
}

export interface MoveRequest {
  pieceId: string;
  pendingThrowId: string;
  /** 스택에 업혀있는 말을 갈라쳐서 이 말 하나만 움직이고 싶을 때 true. */
  splitOff?: boolean;
  branch?: 'straight' | 'shortcut';
}

export type MoveOutcome =
  | { status: 'awaiting-branch'; branch: BranchChoice }
  | { status: 'applied'; event: Extract<YutEvent, { kind: 'move' }>; bonusThrow: boolean; gameOver: boolean };

/** submit_move: 대기 중인 던지기 하나를 소비해 말을 옮긴다. 지름길 분기가 필요하면 상태를 바꾸지 않고
 * 'awaiting-branch'를 반환하며, 호출자는 branch를 채워 다시 호출해야 한다. */
export function submitMove(state: GameState, req: MoveRequest): MoveOutcome {
  if (state.winner) throw new Error('game already over');
  if (state.phase !== 'move') throw new Error('not in move phase');

  const token = currentToken(state);
  const pendingThrow = state.pendingThrows.find((pt) => pt.id === req.pendingThrowId);
  if (!pendingThrow) throw new Error('unknown pendingThrowId');

  let piece = findPiece(state, req.pieceId);
  if (piece.ownerToken !== token) throw new Error('not your piece');

  let movingLead = leadOf(state, piece);
  let movedIds = [movingLead.id, ...followersOf(state, movingLead.id).map((p) => p.id)];

  if (req.splitOff && piece.id !== movingLead.id) {
    // 갈라치기: 이 말만 떼어내 독립된 선두로 만들고, 지금 위치에서부터 이 말 하나만 움직인다.
    piece.leadId = piece.id;
    piece.path = [...movingLead.path];
    movingLead = piece;
    movedIds = [piece.id];
  }

  if (pendingThrow.result.kind === 'backdo' && movingLead.path.length === 0) {
    throw new Error('cannot backdo a piece still at start');
  }

  const ownCornerId = entryNodeId(cornerIndexOfToken(state, token));
  const branchChoiceFor = (cornerId: string) => {
    if (state.awaitingBranch && state.awaitingBranch.cornerId === cornerId && req.branch) return req.branch;
    return undefined;
  };

  const outcome =
    pendingThrow.result.kind === 'backdo'
      ? walkBackward(movingLead.path)
      : walkForward(state.graph, movingLead.path, ownCornerId, pendingThrow.result.steps, branchChoiceFor);

  if (outcome.status === 'awaiting-branch') {
    const branch: BranchChoice = {
      pieceId: movingLead.id,
      cornerId: outcome.cornerId!,
      remainingSteps: outcome.remainingSteps!,
      pendingThrowId: pendingThrow.id,
    };
    state.awaitingBranch = branch;
    return { status: 'awaiting-branch', branch };
  }
  state.awaitingBranch = null;

  const capturedPieceIds: string[] = [];
  const joinedPieceIds: string[] = [];

  if (outcome.status === 'home') {
    movingLead.home = true;
    movingLead.path = [];
    const followers = followersOf(state, movingLead.id);
    followers.forEach((f) => {
      f.home = true;
      f.path = [];
      f.leadId = f.id;
    });
    joinedPieceIds.push(...followers.map((f) => f.id));
  } else {
    movingLead.path = outcome.path;
    const arrivalNodeId = outcome.path[outcome.path.length - 1];
    const others = state.pieces.filter(
      (p) => p.leadId === p.id && !movedIds.includes(p.id) && !p.home && currentPosition(p) === arrivalNodeId,
    );
    for (const other of others) {
      if (other.ownerToken === token) {
        other.leadId = movingLead.id;
        joinedPieceIds.push(other.id);
      } else {
        const capturedStack = [other.id, ...followersOf(state, other.id).map((f) => f.id)];
        capturedStack.forEach((id) => {
          const captured = findPiece(state, id);
          captured.leadId = captured.id;
          captured.path = [];
        });
        capturedPieceIds.push(...capturedStack);
      }
    }
  }

  state.pendingThrows = state.pendingThrows.filter((pt) => pt.id !== pendingThrow.id);
  discardDeadThrows(state);

  const homeCountForToken = state.pieces.filter((p) => p.ownerToken === token && p.home).length;
  const gameOver = homeCountForToken === PIECES_PER_PLAYER;
  if (gameOver) state.winner = token;

  const bonusFromCapture = capturedPieceIds.length > 0;

  if (!gameOver) {
    if (state.pendingThrows.length === 0) {
      if (bonusFromCapture) {
        state.phase = 'throw';
      } else {
        advanceTurn(state);
      }
    }
    // pendingThrows에 남은 게 있으면 phase는 'move'로 유지 — 이어서 다음 말/던지기를 소비해야 한다.
  }

  return {
    status: 'applied',
    event: {
      kind: 'move',
      token,
      pieceId: movingLead.id,
      path: outcome.path,
      capturedPieceIds,
      joinedPieceIds,
    },
    bonusThrow: !gameOver && bonusFromCapture && state.pendingThrows.length === 0,
    gameOver,
  };
}

function advanceTurn(state: GameState): void {
  state.turnIndex = (state.turnIndex + 1) % state.turnOrder.length;
  state.phase = 'throw';
  state.pendingThrows = [];
  state.awaitingBranch = null;
}

/** 게임 도중 이탈: 해당 플레이어의 말을 전부 보드에서 제거하고 순번에서 뺀다. */
export function removePlayer(state: GameState, token: string): void {
  const leavingIndex = state.turnOrder.indexOf(token);
  state.pieces = state.pieces.filter((p) => p.ownerToken !== token);
  // 남아있던 말 중 방금 나간 플레이어를 leadId로 참조하던 업힌 말이 있다면 독립시킨다.
  state.pieces.forEach((p) => {
    if (!state.pieces.some((lead) => lead.id === p.leadId)) {
      p.leadId = p.id;
    }
  });
  state.turnOrder = state.turnOrder.filter((t) => t !== token);
  state.tokens = state.tokens.filter((t) => t !== token);
  if (leavingIndex !== -1 && leavingIndex < state.turnIndex) {
    state.turnIndex -= 1;
  }
  if (state.turnOrder.length > 0) {
    state.turnIndex = state.turnIndex % state.turnOrder.length;
  }
  state.phase = 'throw';
  state.pendingThrows = [];
  state.awaitingBranch = null;
}
