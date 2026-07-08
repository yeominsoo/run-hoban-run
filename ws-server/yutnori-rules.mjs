/** 윷놀이 순수 규칙 엔진(서버 권위). src/game/yutnori-rules.ts와 로직이 동일해야 한다 —
 * 규칙을 바꿀 때는 두 파일을 같이 고칠 것. 상태는 halligalli.mjs의 room 패턴처럼 직접 변형(mutate)한다. */
import {
  buildYutBoardGraph,
  CENTER_NODE_ID,
  cornerIndexOfDiagonal,
  entryNodeId,
  getCenterExit,
  getDiagonalOuterNext,
  diagonalStepOf,
  MAX_PLAYERS,
} from './yutnori-board.mjs';

export { MAX_PLAYERS };

const CENTER_EXIT_ID = getCenterExit();

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

export function buildYutTeams(tokens) {
  if (tokens.length === 2) return [[tokens[0]], [tokens[1]]];
  if (tokens.length === 3) return [[tokens[0]], [tokens[1], tokens[2]]];
  if (tokens.length === 4) return [[tokens[0], tokens[1]], [tokens[2], tokens[3]]];
  return tokens.map((token) => [token]);
}

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
    teams: buildYutTeams(tokens),
    pieces,
    turnOrder: [...tokens],
    turnIndex: 0,
    pendingThrows: [],
    phase: 'throw',
    captureBonusOwed: 0,
    winner: null,
    rng: seedRng,
    throwSeq: 0,
  };
}

export function currentToken(state) {
  return state.turnOrder[state.turnIndex];
}

export function teamOf(state, token) {
  if (!token) return [];
  return state.teams.find((team) => team.includes(token)) ?? [token];
}

export function isSameTeam(state, a, b) {
  return teamOf(state, a).includes(b);
}

export function activeTeams(state) {
  return state.teams
    .map((team) => team.filter((token) => state.turnOrder.includes(token)))
    .filter((team) => team.length > 0);
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

function walkForward(graph, startPath, ownCornerId, steps) {
  const path = [...startPath];
  let remaining = steps;

  while (remaining > 0) {
    const currentId = path.length === 0 ? 'start' : path[path.length - 1];
    let nextId;

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
        // 중앙에서는 항상 공유 출발점 방향 대각선으로 빠져나간다(선택 없음).
        nextId = CENTER_EXIT_ID;
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

function walkBackward(graph, startPath, ownCornerId) {
  if (startPath.length === 1 && startPath[0] === graph[ownCornerId].next) {
    return { status: 'finished', path: [ownCornerId] };
  }
  return { status: 'finished', path: startPath.slice(0, -1) };
}

/** submit_move: 대기 중인 던지기 하나를 소비해 말을 옮긴다. */
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
  const outcome =
    pendingThrow.result.kind === 'backdo'
      ? walkBackward(state.graph, movingLead.path, ownCornerId)
      : walkForward(state.graph, movingLead.path, ownCornerId, pendingThrow.result.steps);

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
    // 업혀서 함께 움직이는 말들(followers)도 리더와 같은 칸으로 위치를 갱신해야
    // 스택 전체가 같이 이동한다 — 리더만 갱신하면 업힌 말은 화면에서 그 자리에 남는다.
    followersOf(state, movingLead.id).forEach((f) => { f.path = [...outcome.path]; });
    const arrivalNodeId = outcome.path[outcome.path.length - 1];
    const others = state.pieces.filter(
      (p) => p.leadId === p.id && !movedIds.includes(p.id) && !p.home && currentPosition(p) === arrivalNodeId,
    );
    for (const other of others) {
      if (isSameTeam(state, other.ownerToken, token)) {
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
  if (bonusFromCapture) state.captureBonusOwed += 1;

  let grantedBonusThrow = false;
  if (!gameOver) {
    if (state.pendingThrows.length === 0) {
      if (state.captureBonusOwed > 0) {
        state.captureBonusOwed -= 1;
        state.phase = 'throw';
        grantedBonusThrow = true;
      } else {
        advanceTurn(state);
      }
    }
    // pendingThrows에 남은 게 있으면 phase는 'move'로 유지 — 이어서 다음 말/던지기를 소비해야 한다.
    // 그 사이에도 captureBonusOwed는 남아있다가 큐가 다 빌 때 지급된다(모+개처럼 이미 던진 뒤 잡아도 보너스를 잃지 않음).
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
    bonusThrow: grantedBonusThrow,
    gameOver,
  };
}

function advanceTurn(state) {
  state.turnIndex = (state.turnIndex + 1) % state.turnOrder.length;
  state.phase = 'throw';
  state.pendingThrows = [];
  state.captureBonusOwed = 0;
}

/** 시간 초과로 차례를 강제로 넘길 때 서버(ws-server)가 호출한다. */
export function skipTurn(state) {
  advanceTurn(state);
}

export function getAutoMoveRequest(state) {
  if (state.winner || state.phase !== 'move') return null;

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
  state.teams = state.teams
    .map((team) => team.filter((t) => t !== token))
    .filter((team) => team.length > 0);
  if (leavingIndex !== -1 && leavingIndex < state.turnIndex) {
    state.turnIndex -= 1;
  }
  if (state.turnOrder.length > 0) {
    state.turnIndex = state.turnIndex % state.turnOrder.length;
  }
  state.phase = 'throw';
  state.pendingThrows = [];
  state.captureBonusOwed = 0;
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
