/** 윷놀이 순수 규칙 엔진(서버 권위). src/game/yutnori-rules.ts와 로직이 동일해야 한다 —
 * 규칙을 바꿀 때는 두 파일을 같이 고칠 것. 상태는 halligalli.mjs의 room 패턴처럼 직접 변형(mutate)한다. */
import {
  buildYutBoardGraph,
  CENTER_NODE_ID,
  cornerIndexOfDiagonal,
  cornerNodeId,
  entryNodeId,
  getCenterExit,
  MAX_PLAYERS,
} from './yutnori-board.mjs';

export { MAX_PLAYERS };

// 실제 윷가락 확률의 단순화 근사치. 백도는 특수 표시된 가락 조합에서만 드물게 나온다는 점만 반영.
const THROW_TABLE = [
  { kind: 'backdo', steps: 1, weight: 3 },
  { kind: 'do', steps: 1, weight: 32 },
  { kind: 'gae', steps: 2, weight: 35 },
  { kind: 'geol', steps: 3, weight: 18 },
  { kind: 'yut', steps: 4, weight: 7 },
  { kind: 'mo', steps: 5, weight: 5 },
];
const THROW_TOTAL_WEIGHT = THROW_TABLE.reduce((sum, entry) => sum + entry.weight, 0);

export function rollYutThrow(rng) {
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

export const PIECES_PER_PLAYER = 4;

export function createYutGame(tokens, seedRng) {
  if (tokens.length < 2 || tokens.length > MAX_PLAYERS) {
    throw new Error(`yutnori supports 2-${MAX_PLAYERS} players, got ${tokens.length}`);
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
    pieces,
    turnOrder: [...tokens],
    turnIndex: 0,
    pendingThrows: [],
    phase: 'throw',
    awaitingBranch: null,
    winner: null,
    rng: seedRng,
    throwSeq: 0,
  };
}

export function currentToken(state) {
  return state.turnOrder[state.turnIndex];
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

export function submitThrow(state) {
  if (state.winner) throw new Error('game already over');
  if (state.phase !== 'throw') throw new Error('not in throw phase');
  if (state.awaitingBranch) throw new Error('awaiting branch choice');

  const result = rollYutThrow(state.rng);
  state.throwSeq += 1;
  state.pendingThrows.push({ id: `throw-${state.throwSeq}`, result });
  if (!result.extraTurn) {
    state.phase = 'move';
    discardDeadThrows(state);
    if (state.pendingThrows.length === 0) advanceTurn(state);
  }
  return result;
}

export function hasLegalMove(state, token, pendingThrow) {
  const ownPieces = state.pieces.filter((p) => p.ownerToken === token && !p.home && p.leadId === p.id);
  if (pendingThrow.result.kind === 'backdo') {
    return ownPieces.some((p) => p.path.length > 0);
  }
  return ownPieces.length > 0;
}

export function discardDeadThrows(state) {
  const token = currentToken(state);
  state.pendingThrows = state.pendingThrows.filter((pt) => hasLegalMove(state, token, pt));
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

/** submit_move: 대기 중인 던지기 하나를 소비해 말을 옮긴다. 지름길 분기가 필요하면 상태를 바꾸지 않고
 * 'awaiting-branch'를 반환하며, 호출자는 branch를 채워 다시 호출해야 한다. */
export function submitMove(state, req) {
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
    piece.leadId = piece.id;
    piece.path = [...movingLead.path];
    movingLead = piece;
    movedIds = [piece.id];
  }

  if (pendingThrow.result.kind === 'backdo' && movingLead.path.length === 0) {
    throw new Error('cannot backdo a piece still at start');
  }

  const ownCornerId = entryNodeId(0);
  const branchChoiceFor = (cornerId) => {
    if (state.awaitingBranch && state.awaitingBranch.cornerId === cornerId && req.branch) return req.branch;
    return undefined;
  };

  const outcome =
    pendingThrow.result.kind === 'backdo'
      ? walkBackward(movingLead.path)
      : walkForward(state.graph, movingLead.path, ownCornerId, pendingThrow.result.steps, branchChoiceFor);

  if (outcome.status === 'awaiting-branch') {
    const branch = {
      pieceId: movingLead.id,
      cornerId: outcome.cornerId,
      remainingSteps: outcome.remainingSteps,
      pendingThrowId: pendingThrow.id,
    };
    state.awaitingBranch = branch;
    return { status: 'awaiting-branch', branch };
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

function advanceTurn(state) {
  state.turnIndex = (state.turnIndex + 1) % state.turnOrder.length;
  state.phase = 'throw';
  state.pendingThrows = [];
  state.awaitingBranch = null;
}

/** 시간 초과로 차례를 강제로 넘길 때 서버(ws-server)가 호출한다. */
export function skipTurn(state) {
  advanceTurn(state);
}

export function getAutoMoveRequest(state) {
  if (state.winner || state.phase !== 'move') return null;

  if (state.awaitingBranch) {
    return {
      pieceId: state.awaitingBranch.pieceId,
      pendingThrowId: state.awaitingBranch.pendingThrowId,
      branch: 'straight',
    };
  }

  discardDeadThrows(state);
  if (state.pendingThrows.length === 0) {
    advanceTurn(state);
    return null;
  }

  const token = currentToken(state);
  const leadPieces = state.pieces
    .filter((p) => p.ownerToken === token && !p.home && p.leadId === p.id)
    .sort((a, b) => progressFromStart(a) - progressFromStart(b) || a.id.localeCompare(b.id));
  const freshPiece = leadPieces.find((p) => p.path.length === 0);
  const forwardThrow = state.pendingThrows.find((pt) => pt.result.kind !== 'backdo' && freshPiece);
  if (forwardThrow && freshPiece) {
    return { pieceId: freshPiece.id, pendingThrowId: forwardThrow.id };
  }

  for (const pendingThrow of state.pendingThrows) {
    const candidate = pendingThrow.result.kind === 'backdo'
      ? leadPieces.find((p) => p.path.length > 0)
      : leadPieces[0];
    if (candidate) {
      return { pieceId: candidate.id, pendingThrowId: pendingThrow.id };
    }
  }

  advanceTurn(state);
  return null;
}

/** 게임 도중 이탈: 해당 플레이어의 말을 전부 보드에서 제거하고 순번에서 뺀다. */
export function removePlayer(state, token) {
  const leavingIndex = state.turnOrder.indexOf(token);
  state.pieces = state.pieces.filter((p) => p.ownerToken !== token);
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

export function buildBoardSnapshot(state) {
  return state.pieces.map((p) => ({
    id: p.id,
    ownerToken: p.ownerToken,
    leadId: p.leadId,
    home: p.home,
    nodeId: p.path.length ? p.path[p.path.length - 1] : null,
  }));
}
