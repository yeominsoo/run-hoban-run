/** 전략윷놀이 보드 토폴로지: 외곽 20칸(그중 4개는 코너) + 코너마다 중앙으로 꺾는 대각선 1칸(diag) + 중앙 1칸.
 * 코너에서만 "그대로 외곽으로" vs "대각선(지름길)으로" 분기가 생기고, 중앙은 들어온 대각선의 반대편
 * 대각선으로 자동으로 빠져나간다(중앙 자체는 플레이어가 고르는 분기가 아니다).
 *
 * src/game/yutnori-board.ts와 로직이 동일해야 한다 — 그래프 규칙을 바꿀 때는 두 파일을 같이 고칠 것. */

export const OUTER_NODE_COUNT = 20;
export const CORNER_COUNT = 4;
export const CORNER_STRIDE = OUTER_NODE_COUNT / CORNER_COUNT; // 5
export const MAX_PLAYERS = CORNER_COUNT;
export const CENTER_NODE_ID = 'center';

export function outerNodeId(index) {
  const normalized = ((index % OUTER_NODE_COUNT) + OUTER_NODE_COUNT) % OUTER_NODE_COUNT;
  return `outer-${normalized}`;
}

export function diagonalNodeId(cornerIndex) {
  const normalized = ((cornerIndex % CORNER_COUNT) + CORNER_COUNT) % CORNER_COUNT;
  return `diag-${normalized}`;
}

export function entryNodeId(playerCornerIndex) {
  return outerNodeId(playerCornerIndex * CORNER_STRIDE);
}

function cornerIndexOfOuter(outerIndex) {
  return outerIndex % CORNER_STRIDE === 0 ? outerIndex / CORNER_STRIDE : null;
}

export function cornerIndexOfDiagonal(diagId) {
  return Number(diagId.replace('diag-', ''));
}

export function getCenterExit(arrivedFromCornerIndex) {
  return diagonalNodeId(arrivedFromCornerIndex + 2);
}

export function buildYutBoardGraph() {
  const graph = {};
  const outerRadius = 5;
  const diagonalRadius = outerRadius * 0.55;

  for (let i = 0; i < OUTER_NODE_COUNT; i += 1) {
    const angle = (i / OUTER_NODE_COUNT) * Math.PI * 2;
    const cornerIndex = cornerIndexOfOuter(i);
    const id = outerNodeId(i);
    graph[id] = {
      id,
      kind: cornerIndex === null ? 'outer' : 'corner',
      gridPos: [Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius],
      next: outerNodeId(i + 1),
      shortcutNext: cornerIndex === null ? undefined : diagonalNodeId(cornerIndex),
    };
  }

  for (let c = 0; c < CORNER_COUNT; c += 1) {
    const id = diagonalNodeId(c);
    const cornerAngle = ((c * CORNER_STRIDE) / OUTER_NODE_COUNT) * Math.PI * 2;
    graph[id] = {
      id,
      kind: 'diagonal',
      gridPos: [Math.cos(cornerAngle) * diagonalRadius, Math.sin(cornerAngle) * diagonalRadius],
      next: CENTER_NODE_ID,
    };
  }

  graph[CENTER_NODE_ID] = {
    id: CENTER_NODE_ID,
    kind: 'center',
    gridPos: [0, 0],
    next: diagonalNodeId(2), // 실사용 안 함 — walkForward가 직전 칸을 보고 getCenterExit()로 계산
  };

  return graph;
}
