/** "전략윷놀이"(더 지니어스 데스매치 2:2 변형) 순수 규칙 엔진(서버 권위).
 * src/game/strategy-yutnori-rules.ts와 로직이 동일해야 한다 — 규칙을 바꿀 때는 두 파일을 같이 고칠 것.
 * 보드 토폴로지는 yutnori-board.mjs를 그대로 재사용한다(일반 윷놀이와 같은 보드). */
import {
  buildYutBoardGraph,
  CENTER_NODE_ID,
  cornerIndexOfDiagonal,
  cornerNodeId,
  entryNodeId,
  getCenterExit,
} from './yutnori-board.mjs';

const KIND_BY_BACK_COUNT = {
  0: { kind: 'mo', steps: 5 },
  1: { kind: 'do', steps: 1 },
  2: { kind: 'gae', steps: 2 },
  3: { kind: 'geol', steps: 3 },
  4: { kind: 'yut', steps: 4 },
};

export function resolveThrow(faces) {
  const values = Object.values(faces);
  if (values.length !== 4) throw new Error('strategy yutnori requires exactly 4 face submissions per round');
  const backCount = values.filter((f) => f === 'back').length;
  if (backCount === 1) return { kind: 'backdo', steps: 1, backCount, faces: { ...faces } };
  const base = KIND_BY_BACK_COUNT[backCount];
  return { kind: base.kind, steps: base.steps, backCount, faces: { ...faces } };
}

export const PIECES_PER_PLAYER = 2;
export const PLAYERS_REQUIRED = 4;

export function createStrategyYutGame(tokens) {
  if (tokens.length !== PLAYERS_REQUIRED) {
    throw new Error(`strategy yutnori requires exactly ${PLAYERS_REQUIRED} players, got ${tokens.length}`);
  }
  const pieces = [];
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
    awaitingBranch: null,
    round: 1,
    winner: null,
  };
}

export function partnerOf(state, token) {
  const pair = state.teams.find((t) => t.includes(token));
  if (!pair) throw new Error(`unknown token ${token}`);
  return pair[0] === token ? pair[1] : pair[0];
}

export function currentMover(state) {
  if (state.winner) return null;
  return state.moveOrder[state.moveIndex] ?? null;
}

function findPiece(state, pieceId) {
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece) throw new Error(`unknown piece ${pieceId}`);
  return piece;
}
function leadOf(state, piece) {
  return piece.leadId === piece.id ? piece : findPiece(state, piece.leadId);
}
function followersOf(state, leadId) {
  return state.pieces.filter((p) => p.leadId === leadId && p.id !== leadId);
}
function currentPosition(piece) {
  return piece.path.length === 0 ? 'start' : piece.path[piece.path.length - 1];
}
function progressFromStart(piece) {
  return piece.path.length;
}

export function submitFace(state, token, face) {
  if (state.winner) throw new Error('game already over');
  if (state.phase !== 'collecting') throw new Error('not collecting faces this round');
  if (!state.tokens.includes(token)) throw new Error('unknown token');
  if (state.faces[token]) throw new Error('already submitted this round');

  state.faces[token] = face;
  if (Object.keys(state.faces).length < PLAYERS_REQUIRED) return null;

  const result = resolveThrow(state.faces);
  state.lastThrow = result;
  state.phase = 'moving';
  if (!isEligibleMover(state, currentMover(state))) advanceTurn(state);
  return result;
}

function isEligibleMover(state, token) {
  if (!state.lastThrow) return false;
  const ownPieces = state.pieces.filter((p) => p.ownerToken === token && !p.home && p.leadId === p.id);
  if (state.lastThrow.kind === 'backdo') return ownPieces.some((p) => p.path.length > 0);
  return ownPieces.length > 0;
}

function startNextThrow(state) {
  state.phase = 'collecting';
  state.faces = {};
  state.lastThrow = null;
  state.awaitingBranch = null;
  state.round += 1;
}

function advanceTurn(state) {
  state.moveIndex = (state.moveIndex + 1) % state.moveOrder.length;
  startNextThrow(state);
}

function walkForward(graph, startPath, ownCornerId, steps, branchChoiceFor) {
  const path = [...startPath];
  const justPlaced = startPath.length === 0;
  let remaining = steps;
  let hopIndex = 0;

  while (remaining > 0) {
    const currentId = path.length === 0 ? 'start' : path[path.length - 1];
    let nextId;

    if (currentId === 'start') {
      nextId = ownCornerId;
    } else {
      const node = graph[currentId];
      if (node.kind === 'corner' && node.shortcutNext) {
        const choice = branchChoiceFor(currentId);
        if (choice === undefined) {
          return { status: 'awaiting-branch', path, cornerId: currentId, remainingSteps: remaining };
        }
        nextId = choice === 'shortcut' ? node.shortcutNext : node.next;
      } else if (node.kind === 'center') {
        const prevId = path.length >= 2 ? path[path.length - 2] : undefined;
        const fromCornerIndex = prevId ? cornerIndexOfDiagonal(prevId) : 0;
        nextId = getCenterExit(fromCornerIndex);
      } else if (node.kind === 'diagonal' && path[path.length - 2] === CENTER_NODE_ID) {
        nextId = cornerNodeId(cornerIndexOfDiagonal(currentId));
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

function walkBackward(startPath) {
  return { status: 'finished', path: startPath.slice(0, -1) };
}

export function submitMove(state, token, req) {
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
  const branchChoiceFor = (cornerId) => {
    if (state.awaitingBranch && state.awaitingBranch.cornerId === cornerId && req.branch) return req.branch;
    return undefined;
  };

  const outcome =
    state.lastThrow.kind === 'backdo'
      ? walkBackward(movingLead.path)
      : walkForward(state.graph, movingLead.path, ownCornerId, state.lastThrow.steps, branchChoiceFor);

  if (outcome.status === 'awaiting-branch') {
    state.awaitingBranch = { pieceId: movingLead.id, cornerId: outcome.cornerId, remainingSteps: outcome.remainingSteps };
    return { status: 'awaiting-branch', cornerId: outcome.cornerId, remainingSteps: outcome.remainingSteps };
  }
  state.awaitingBranch = null;

  const capturedPieceIds = [];
  const joinedPieceIds = [];

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

/** 4인 고정 게임이라 한 명이라도 중도 이탈하면 계속 진행이 불가능 — 즉시 종료 처리한다. */
export function abandonGame(state, leavingToken) {
  state.winner = state.tokens.find((t) => t !== leavingToken) ?? null;
}

export function getAutoMoveRequest(state, token) {
  if (state.winner || state.phase !== 'moving' || currentMover(state) !== token || !state.lastThrow) return null;

  if (state.awaitingBranch) {
    return { pieceId: state.awaitingBranch.pieceId, branch: 'straight' };
  }

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

export function buildBoardSnapshot(state) {
  return state.pieces.map((p) => ({
    id: p.id,
    ownerToken: p.ownerToken,
    leadId: p.leadId,
    home: p.home,
    nodeId: p.path.length ? p.path[p.path.length - 1] : null,
  }));
}
