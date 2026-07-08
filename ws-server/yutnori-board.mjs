/** 윷놀이 보드 토폴로지: 외곽 20칸 + 대각선 8칸 + 중앙 1칸.
 * outer-0은 모든 플레이어가 공유하는 시작/도착 모서리다. 출발 전 말은 이 모서리를 칸으로 세지
 * 않고, 도(1칸)를 내면 outer-1에 놓인다. 나머지 코너에서만 "그대로 외곽으로" vs
 * "대각선(지름길)으로" 분기가 생긴다. 중앙은 들어온 대각선의 반대편 대각선으로 자동으로 빠져나간다.
 *
 * src/game/yutnori-board.ts와 로직이 동일해야 한다 — 그래프 규칙을 바꿀 때는 두 파일을 같이 고칠 것. */

export const OUTER_NODE_COUNT = 20;
export const CORNER_COUNT = 4;
export const CORNER_STRIDE = OUTER_NODE_COUNT / CORNER_COUNT; // 5
export const DIAGONAL_NODES_PER_CORNER = 2;
export const MAX_PLAYERS = CORNER_COUNT;
export const CENTER_NODE_ID = 'center';

export function outerNodeId(index) {
  const normalized = ((index % OUTER_NODE_COUNT) + OUTER_NODE_COUNT) % OUTER_NODE_COUNT;
  return `outer-${normalized}`;
}

export function diagonalNodeId(cornerIndex, stepIndex = 0) {
  const normalized = ((cornerIndex % CORNER_COUNT) + CORNER_COUNT) % CORNER_COUNT;
  const step = Math.min(Math.max(Math.trunc(stepIndex), 0), DIAGONAL_NODES_PER_CORNER - 1);
  return `diag-${normalized}-${step}`;
}

export const YUT_START_NODE_ID = outerNodeId(0);

export function cornerNodeId(cornerIndex) {
  return outerNodeId(cornerIndex * CORNER_STRIDE);
}

export function entryNodeId(playerCornerIndex) {
  void playerCornerIndex;
  return YUT_START_NODE_ID;
}

function cornerIndexOfOuter(outerIndex) {
  return outerIndex % CORNER_STRIDE === 0 ? outerIndex / CORNER_STRIDE : null;
}

export function cornerIndexOfDiagonal(diagId) {
  return Number(diagId.match(/^diag-(\d+)-\d+$/)?.[1] ?? 0);
}

export function diagonalStepOf(diagId) {
  return Number(diagId.match(/^diag-\d+-(\d+)$/)?.[1] ?? 0);
}

/** 한 던지기 도중 중앙을 그냥 지나치는 중이면(멈추지 않고 통과), 들어온 대각선의
 *  반대편 대각선으로 직진해서 빠져나간다. */
export function getCenterPassThroughExit(arrivedFromCornerIndex) {
  return diagonalNodeId(arrivedFromCornerIndex + 2, 1);
}

/** 중앙에 정확히 멈춰 있다가(직전 턴에 도착) 새 던지기를 시작하는 경우에는 어느 대각선으로
 *  들어왔었는지와 무관하게 항상 공유 출발점(코너 0) 방향 대각선으로 빠져나간다. */
export function getCenterRestExit() {
  return diagonalNodeId(0, 1);
}

export function getDiagonalOuterNext(diagId) {
  const cornerIndex = cornerIndexOfDiagonal(diagId);
  const step = diagonalStepOf(diagId);
  return step <= 0 ? cornerNodeId(cornerIndex) : diagonalNodeId(cornerIndex, step - 1);
}

export function buildYutBoardGraph() {
  const graph = {};
  const cornerPositions = [
    [-5, -5],
    [-5, 5],
    [5, 5],
    [5, -5],
  ];
  const interpolate = (from, to, t) => [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
  ];

  for (let i = 0; i < OUTER_NODE_COUNT; i += 1) {
    const sideIndex = Math.floor(i / CORNER_STRIDE);
    const stepOnSide = i % CORNER_STRIDE;
    const from = cornerPositions[sideIndex];
    const to = cornerPositions[(sideIndex + 1) % CORNER_COUNT];
    const cornerIndex = cornerIndexOfOuter(i);
    const id = outerNodeId(i);
    graph[id] = {
      id,
      kind: cornerIndex === null ? 'outer' : 'corner',
      gridPos: interpolate(from, to, stepOnSide / CORNER_STRIDE),
      next: outerNodeId(i + 1),
      shortcutNext: cornerIndex === null || cornerIndex === 0 ? undefined : diagonalNodeId(cornerIndex, 0),
    };
  }

  for (let c = 0; c < CORNER_COUNT; c += 1) {
    for (let step = 0; step < DIAGONAL_NODES_PER_CORNER; step += 1) {
      const id = diagonalNodeId(c, step);
      graph[id] = {
        id,
        kind: 'diagonal',
        gridPos: interpolate(cornerPositions[c], [0, 0], (step + 1) / (DIAGONAL_NODES_PER_CORNER + 1)),
        next: step === DIAGONAL_NODES_PER_CORNER - 1 ? CENTER_NODE_ID : diagonalNodeId(c, step + 1),
      };
    }
  }

  graph[CENTER_NODE_ID] = {
    id: CENTER_NODE_ID,
    kind: 'center',
    gridPos: [0, 0],
    next: diagonalNodeId(2, 1), // 실사용 안 함 — walkForward가 직전 칸을 보고 getCenterExit()로 계산
  };

  return graph;
}
