import {
  buildYutBoardGraph,
  CENTER_NODE_ID,
  cornerIndexOfDiagonal,
  entryNodeId,
  getCenterPassThroughExit,
  getCenterRestExit,
  getDiagonalOuterNext,
  diagonalStepOf,
  type YutBoardGraph,
} from './yutnori-board';

const CENTER_REST_EXIT_ID = getCenterRestExit();

/**
 * "전략윷놀이" — tvN <더 지니어스> 데스매치에서 쓰인 2:2 윷놀이 변형.
 * 표준 윷놀이(yutnori-rules.ts)와 보드는 동일하지만, 던지기 방식과 승패 단위가 다르다:
 *
 *  - 무작위로 4개 막대를 던지는 대신, 4명이 각자 자기 몫의 막대 1개를 앞면/뒷면 중 골라
 *    "비공개로 동시 제출"한다. 전원 제출이 끝나면 일반 윷놀이처럼 앞면 개수를 세어 도개걸윷모를 정한다.
 *  - 원 방송 규칙("도가 나오면 전부 뒷도로 간주") — 이 구현에서도 일반 윷셈의 도(앞면 1개)가
 *    나오면 항상 "백도"(후진 1칸)로 강제 치환한다.
 *  - 4명이 제출한 값은 현재 순서 플레이어 한 명의 이동값이다. 이동이 끝나면 다음 플레이어 차례로
 *    넘어가며, 윷/모 또는 잡기에는 같은 플레이어가 한 번 더 던진다.
 *  - 4명은 서로 다른 개인(2명씩 팀을 이루지만 팀원끼리도 서로 잡을 수 있다 — 배신 가능).
 *  - 인당 말은 2개뿐이고, 승패는 "그 라운드에 자기 말 2개를 먼저 완주시킨 사람"이 결정한다
 *    (파트너의 말 상태와 무관 — 개인 승리).
 *  - 원작의 가넷 보상/탈락후보 서바이벌 설정은 이 구현에서 의도적으로 뺐다(사용자 확인).
 */

export type FaceChoice = 'front' | 'back';
export type ThrowKind = 'backdo' | 'do' | 'gae' | 'geol' | 'yut' | 'mo';

export interface ThrowResult {
  kind: ThrowKind;
  steps: number;
  frontCount: number;
  backCount: number;
  faces: Record<string, FaceChoice>;
}

const KIND_BY_FRONT_COUNT: Record<number, { kind: ThrowKind; steps: number }> = {
  0: { kind: 'mo', steps: 5 },
  1: { kind: 'do', steps: 1 },
  2: { kind: 'gae', steps: 2 },
  3: { kind: 'geol', steps: 3 },
  4: { kind: 'yut', steps: 4 },
};

export function resolveThrow(faces: Record<string, FaceChoice>): ThrowResult {
  const values = Object.values(faces);
  if (values.length !== 4) throw new Error('strategy yutnori requires exactly 4 face submissions per round');
  const frontCount = values.filter((f) => f === 'front').length;
  const backCount = values.filter((f) => f === 'back').length;
  if (frontCount === 1) return { kind: 'backdo', steps: 1, frontCount, backCount, faces: { ...faces } };
  const base = KIND_BY_FRONT_COUNT[frontCount];
  return { kind: base.kind, steps: base.steps, frontCount, backCount, faces: { ...faces } };
}

export const PIECES_PER_PLAYER = 2;
export const PLAYERS_REQUIRED = 4;

export interface Piece {
  id: string;
  ownerToken: string;
  leadId: string;
  path: string[];
  home: boolean;
}

export interface GameState {
  graph: YutBoardGraph;
  tokens: string[]; // 길이 4, join 순서 = 이동 순서/팀 편성 기준
  teams: [[string, string], [string, string]]; // (0,1)조 / (2,3)조 — 팀원끼리도 서로 잡을 수 있다
  pieces: Piece[];
  moveOrder: string[]; // 플레이어 턴 순서
  moveIndex: number;
  phase: 'collecting' | 'moving';
  faces: Record<string, FaceChoice>;
  lastThrow: ThrowResult | null;
  round: number;
  winner: string | null;
}

export function createStrategyYutGame(tokens: string[]): GameState {
  if (tokens.length !== PLAYERS_REQUIRED) {
    throw new Error(`strategy yutnori requires exactly ${PLAYERS_REQUIRED} players, got ${tokens.length}`);
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
    teams: [[tokens[0], tokens[1]], [tokens[2], tokens[3]]],
    pieces,
    moveOrder: [...tokens],
    moveIndex: 0,
    phase: 'collecting',
    faces: {},
    lastThrow: null,
    round: 1,
    winner: null,
  };
}

export function partnerOf(state: GameState, token: string): string {
  const pair = state.teams.find((t) => t.includes(token));
  if (!pair) throw new Error(`unknown token ${token}`);
  return pair[0] === token ? pair[1] : pair[0];
}

export function currentMover(state: GameState): string | null {
  if (state.winner) return null;
  return state.moveOrder[state.moveIndex] ?? null;
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
function progressFromStart(piece: Piece): number {
  return piece.path.length;
}

/** submit_face: 라운드마다 4명 전원이 한 번씩 호출. 4명 다 제출되면 자동으로 던지기가 확정된다. */
export function submitFace(state: GameState, token: string, face: FaceChoice): ThrowResult | null {
  if (state.winner) throw new Error('game already over');
  if (state.phase !== 'collecting') throw new Error('not collecting faces this round');
  if (!state.tokens.includes(token)) throw new Error('unknown token');
  if (state.faces[token]) throw new Error('already submitted this round');

  state.faces[token] = face;
  if (Object.keys(state.faces).length < PLAYERS_REQUIRED) return null;

  const result = resolveThrow(state.faces);
  state.lastThrow = result;
  state.phase = 'moving';
  if (!isEligibleMover(state, currentMover(state)!)) advanceTurn(state);
  return result;
}

function isEligibleMover(state: GameState, token: string): boolean {
  if (!state.lastThrow) return false;
  const ownPieces = state.pieces.filter((p) => p.ownerToken === token && !p.home && p.leadId === p.id);
  if (state.lastThrow.kind === 'backdo') return ownPieces.some((p) => p.path.length > 0);
  return ownPieces.length > 0;
}

function startNextThrow(state: GameState) {
  state.phase = 'collecting';
  state.faces = {};
  state.lastThrow = null;
  state.round += 1;
}

function advanceTurn(state: GameState) {
  state.moveIndex = (state.moveIndex + 1) % state.moveOrder.length;
  startNextThrow(state);
}

interface WalkOutcome {
  status: 'finished' | 'home';
  path: string[];
}

function walkForward(
  graph: YutBoardGraph,
  startPath: string[],
  ownCornerId: string,
  steps: number,
): WalkOutcome {
  const path = [...startPath];
  let remaining = steps;

  while (remaining > 0) {
    const currentId = path.length === 0 ? 'start' : path[path.length - 1];
    let nextId: string;

    if (currentId === 'start') {
      nextId = graph[ownCornerId].next;
    } else if (currentId === ownCornerId) {
      return { status: 'home', path };
    } else {
      const node = graph[currentId];
      if (node.kind === 'corner' && node.shortcutNext) {
        // 이번 이동을 시작하기 전부터 이미 이 코너에 서 있었다면 선택 없이 무조건 지름길로 들어간다.
        // 이번 던지기 도중 지나가는 중이라면 무조건 외곽으로 계속 간다.
        const restingHere = path.length === startPath.length;
        nextId = restingHere ? node.shortcutNext : node.next;
      } else if (node.kind === 'center') {
        // 중앙에 정확히 멈춰 있다가 새 던지기를 시작하는 경우에만 도착지(공유 출발점) 방향으로.
        // 이번 던지기 도중 중앙을 그냥 지나치는 중이면, 들어온 대각선 반대편으로 직진한다.
        const restingHere = path.length === startPath.length;
        if (restingHere) {
          nextId = CENTER_REST_EXIT_ID;
        } else {
          const prevId = path.length >= 2 ? path[path.length - 2] : undefined;
          const fromCornerIndex = prevId ? cornerIndexOfDiagonal(prevId) : 0;
          nextId = getCenterPassThroughExit(fromCornerIndex);
        }
      } else if (node.kind === 'diagonal') {
        // 직전 칸으로 "중앙에서 되돌아 나오는 중"인지 판정한다. path 전체에 center가 있었는지로 보면
        // 중앙을 한 번 지난 말이 이후 지름길을 다시 탈 때 안쪽으로 못 가고 코너로 튕겨 나간다.
        const prevId = path.length >= 2 ? path[path.length - 2] : undefined;
        const returningFromCenter =
          prevId === CENTER_NODE_ID ||
          (prevId !== undefined &&
            graph[prevId]?.kind === 'diagonal' &&
            cornerIndexOfDiagonal(prevId) === cornerIndexOfDiagonal(currentId) &&
            diagonalStepOf(prevId) > diagonalStepOf(currentId));
        nextId = returningFromCenter ? getDiagonalOuterNext(currentId) : node.next;
      } else {
        nextId = node.next;
      }
    }

    path.push(nextId);
    remaining -= 1;
  }

  return { status: 'finished', path };
}

function walkBackward(graph: YutBoardGraph, startPath: string[], ownCornerId: string): WalkOutcome {
  if (startPath.length === 1 && startPath[0] === graph[ownCornerId].next) {
    return { status: 'finished', path: [ownCornerId] };
  }
  return { status: 'finished', path: startPath.slice(0, -1) };
}

export interface MoveRequest {
  pieceId: string;
  splitOff?: boolean;
}

export type MoveOutcome =
  {
    status: 'applied';
    token: string;
    pieceId: string;
    path: string[];
    capturedPieceIds: string[];
    joinedPieceIds: string[];
    bonusThrow: boolean;
    gameOver: boolean;
    roundOver: boolean;
  };

/** submit_move: 이번 라운드 이동 순서상 현재 차례인 사람만 호출할 수 있다. */
export function submitMove(state: GameState, token: string, req: MoveRequest): MoveOutcome {
  if (state.winner) throw new Error('game already over');
  if (currentMover(state) !== token) throw new Error('not your move in this round');
  if (!state.lastThrow) throw new Error('no throw resolved yet');

  let piece = findPiece(state, req.pieceId);
  if (piece.ownerToken !== token) throw new Error('not your piece');

  let movingLead = leadOf(state, piece);
  let movedIds = [movingLead.id, ...followersOf(state, movingLead.id).map((p) => p.id)];

  if (req.splitOff && piece.id !== movingLead.id) {
    piece.leadId = piece.id;
    piece.path = [...movingLead.path];
    movingLead = piece;
    movedIds = [piece.id];
  }

  if (state.lastThrow.kind === 'backdo' && movingLead.path.length === 0) {
    throw new Error('cannot backdo a piece still at start');
  }

  const ownCornerId = entryNodeId(0);
  const outcome =
    state.lastThrow.kind === 'backdo'
      ? walkBackward(state.graph, movingLead.path, ownCornerId)
      : walkForward(state.graph, movingLead.path, ownCornerId, state.lastThrow.steps);

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
    // 업혀서 함께 움직이는 말들(followers)도 리더와 같은 칸으로 위치를 갱신해야
    // 스택 전체가 같이 이동한다 — 리더만 갱신하면 업힌 말은 화면에서 그 자리에 남는다.
    followersOf(state, movingLead.id).forEach((f) => { f.path = [...outcome.path]; });
    const arrivalNodeId = outcome.path[outcome.path.length - 1];
    // 팀 상관없이 도착한 칸의 다른 모든 말과 상호작용한다(파트너도 예외 없음 — 배신 가능).
    const others = state.pieces.filter(
      (p) => p.leadId === p.id && !movedIds.includes(p.id) && !p.home && currentPosition(p) === arrivalNodeId,
    );
    for (const other of others) {
      if (other.ownerToken === token) {
        // 업기는 "같은 개인 소유" 말끼리만 — 파트너의 말과는 업을 수 없다(개인전이므로).
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

  const homeCountForToken = state.pieces.filter((p) => p.ownerToken === token && p.home).length;
  const gameOver = homeCountForToken === PIECES_PER_PLAYER;
  if (gameOver) state.winner = token;

  const bonusThrow = !gameOver && (capturedPieceIds.length > 0 || state.lastThrow.kind === 'yut' || state.lastThrow.kind === 'mo');

  let roundOver = false;
  if (!gameOver) {
    if (bonusThrow) {
      startNextThrow(state);
    } else {
      advanceTurn(state);
    }
    roundOver = state.phase === 'collecting';
  } else {
    roundOver = true;
  }

  return {
    status: 'applied',
    token,
    pieceId: movingLead.id,
    path: outcome.path,
    capturedPieceIds,
    joinedPieceIds,
    bonusThrow,
    gameOver,
    roundOver,
  };
}

/** 게임 도중 이탈: 4인 고정 인원 게임이라 한 명이라도 빠지면 계속 진행이 불가능 — 즉시 종료 처리한다. */
export function abandonGame(state: GameState, leavingToken: string): void {
  state.winner = state.tokens.find((t) => t !== leavingToken) ?? null;
}

export function getAutoMoveRequest(state: GameState, token: string): MoveRequest | null {
  if (state.winner || state.phase !== 'moving' || currentMover(state) !== token || !state.lastThrow) return null;

  const leadPieces = state.pieces
    .filter((p) => p.ownerToken === token && !p.home && p.leadId === p.id)
    .sort((a, b) => progressFromStart(a) - progressFromStart(b) || a.id.localeCompare(b.id));
  if (state.lastThrow.kind !== 'backdo') {
    const freshPiece = leadPieces.find((p) => p.path.length === 0);
    if (freshPiece) return { pieceId: freshPiece.id };
  }

  const candidate = state.lastThrow.kind === 'backdo'
    ? leadPieces.find((p) => p.path.length > 0)
    : leadPieces[0];
  return candidate ? { pieceId: candidate.id } : null;
}

export function buildBoardSnapshot(state: GameState) {
  return state.pieces.map((p) => ({
    id: p.id,
    ownerToken: p.ownerToken,
    leadId: p.leadId,
    home: p.home,
    nodeId: p.path.length ? p.path[p.path.length - 1] : null,
  }));
}
