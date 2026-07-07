/** 윷놀이 보드 토폴로지: 외곽 20칸 + 대각선 8칸 + 중앙 1칸.
 * outer-0은 모든 플레이어가 공유하는 시작/도착 모서리다. 출발 전 말은 이 모서리를 칸으로 세지
 * 않고, 도(1칸)를 내면 outer-1에 놓인다. 나머지 코너에서만 "그대로 외곽으로" vs
 * "대각선(지름길)으로" 분기가 생긴다. 중앙은 들어온 대각선의 반대편 대각선으로 자동으로 빠져나간다. */

export type YutNodeKind = 'outer' | 'corner' | 'diagonal' | 'center';

export interface YutBoardNode {
  id: string;
  kind: YutNodeKind;
  /** 3D 렌더링에 쓸 2D 배치 좌표(x, z). y는 항상 0. */
  gridPos: [number, number];
  /** 이 칸에서 분기 없이 한 칸 전진했을 때 도착하는 다음 칸. */
  next: string;
  /** 코너 칸에서만 존재: 대각선(지름길)으로 들어갈 때의 다음 칸. */
  shortcutNext?: string;
}

export const OUTER_NODE_COUNT = 20;
export const CORNER_COUNT = 4;
export const CORNER_STRIDE = OUTER_NODE_COUNT / CORNER_COUNT; // 5
export const DIAGONAL_NODES_PER_CORNER = 2;
export const MAX_PLAYERS = CORNER_COUNT;
export const YUT_START_NODE_ID = outerNodeId(0);

export function outerNodeId(index: number): string {
  const normalized = ((index % OUTER_NODE_COUNT) + OUTER_NODE_COUNT) % OUTER_NODE_COUNT;
  return `outer-${normalized}`;
}

export function diagonalNodeId(cornerIndex: number, stepIndex = 0): string {
  const normalized = ((cornerIndex % CORNER_COUNT) + CORNER_COUNT) % CORNER_COUNT;
  const step = Math.min(Math.max(Math.trunc(stepIndex), 0), DIAGONAL_NODES_PER_CORNER - 1);
  return `diag-${normalized}-${step}`;
}

export const CENTER_NODE_ID = 'center';

/** 코너 인덱스 0..3 → 해당 외곽 코너 칸 id. */
export function cornerNodeId(cornerIndex: number): string {
  return outerNodeId(cornerIndex * CORNER_STRIDE);
}

/** 모든 플레이어가 공유하는 입구 겸 완주 지점 칸 id. 인자는 기존 호출부 호환용으로만 받는다. */
export function entryNodeId(playerCornerIndex: number): string {
  void playerCornerIndex;
  return YUT_START_NODE_ID;
}

function cornerIndexOfOuter(outerIndex: number): number | null {
  return outerIndex % CORNER_STRIDE === 0 ? outerIndex / CORNER_STRIDE : null;
}

/** diag-N-S 칸의 id로부터 그 대각선이 속한 코너 인덱스(N)를 되돌려준다. */
export function cornerIndexOfDiagonal(diagId: string): number {
  return Number(diagId.match(/^diag-(\d+)-\d+$/)?.[1] ?? 0);
}

/** diag-N-S 칸의 id로부터 코너에서 중앙 방향으로 몇 번째 칸인지(S)를 되돌려준다. */
export function diagonalStepOf(diagId: string): number {
  return Number(diagId.match(/^diag-\d+-(\d+)$/)?.[1] ?? 0);
}

/** 중앙에 대각선 diag-arrivedFromCornerIndex 쪽에서 진입했을 때, 계속 전진 시 빠져나가는 반대편 대각선. */
export function getCenterExit(arrivedFromCornerIndex: number): string {
  return diagonalNodeId(arrivedFromCornerIndex + 2, 1);
}

/** 중앙에서 빠져나온 뒤 같은 대각선을 따라 바깥 코너로 향할 때의 다음 칸. */
export function getDiagonalOuterNext(diagId: string): string {
  const cornerIndex = cornerIndexOfDiagonal(diagId);
  const step = diagonalStepOf(diagId);
  return step <= 0 ? cornerNodeId(cornerIndex) : diagonalNodeId(cornerIndex, step - 1);
}

export type YutBoardGraph = Record<string, YutBoardNode>;

export function buildYutBoardGraph(): YutBoardGraph {
  const graph: YutBoardGraph = {};
  const cornerPositions: [number, number][] = [
    [-5, -5],
    [-5, 5],
    [5, 5],
    [5, -5],
  ];
  const interpolate = (from: [number, number], to: [number, number], t: number): [number, number] => [
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
        // 중앙에서 나온 뒤에는 walkForward()가 직전 칸을 보고 바깥쪽 방향을 별도 계산한다.
        next: step === DIAGONAL_NODES_PER_CORNER - 1 ? CENTER_NODE_ID : diagonalNodeId(c, step + 1),
      };
    }
  }

  graph[CENTER_NODE_ID] = {
    id: CENTER_NODE_ID,
    kind: 'center',
    gridPos: [0, 0],
    // center의 next는 "어느 대각선에서 들어왔는지"에 따라 달라져서 그래프 필드로는 못 박을 수 없다.
    // walkForward()가 직전 칸을 보고 getCenterExit()로 계산한다. 여기 값은 실사용되지 않는 placeholder.
    next: diagonalNodeId(2, 1),
  };

  return graph;
}
