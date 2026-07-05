/** 전략윷놀이 보드 토폴로지: 외곽 20칸(그중 4개는 코너) + 코너마다 중앙으로 꺾는 대각선 1칸(diag) + 중앙 1칸.
 * 코너에서만 "그대로 외곽으로" vs "대각선(지름길)으로" 분기가 생기고, 중앙은 들어온 대각선의 반대편
 * 대각선으로 자동으로 빠져나간다(중앙 자체는 플레이어가 고르는 분기가 아니다). */

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
export const MAX_PLAYERS = CORNER_COUNT;

export function outerNodeId(index: number): string {
  const normalized = ((index % OUTER_NODE_COUNT) + OUTER_NODE_COUNT) % OUTER_NODE_COUNT;
  return `outer-${normalized}`;
}

export function diagonalNodeId(cornerIndex: number): string {
  const normalized = ((cornerIndex % CORNER_COUNT) + CORNER_COUNT) % CORNER_COUNT;
  return `diag-${normalized}`;
}

export const CENTER_NODE_ID = 'center';

/** 플레이어(진입 코너) 인덱스 0..3 → 그 플레이어의 입구 겸 완주 지점 칸 id. */
export function entryNodeId(playerCornerIndex: number): string {
  return outerNodeId(playerCornerIndex * CORNER_STRIDE);
}

function cornerIndexOfOuter(outerIndex: number): number | null {
  return outerIndex % CORNER_STRIDE === 0 ? outerIndex / CORNER_STRIDE : null;
}

/** diag-N 칸의 id로부터 그 대각선이 속한 코너 인덱스(N)를 되돌려준다. */
export function cornerIndexOfDiagonal(diagId: string): number {
  return Number(diagId.replace('diag-', ''));
}

/** 중앙에 대각선 diag-arrivedFromCornerIndex 쪽에서 진입했을 때, 계속 전진 시 빠져나가는 반대편 대각선. */
export function getCenterExit(arrivedFromCornerIndex: number): string {
  return diagonalNodeId(arrivedFromCornerIndex + 2);
}

export type YutBoardGraph = Record<string, YutBoardNode>;

export function buildYutBoardGraph(): YutBoardGraph {
  const graph: YutBoardGraph = {};
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
      // diag의 next는 항상 center. (center 이후 어디로 빠지는지는 getCenterExit()로 별도 계산)
      next: CENTER_NODE_ID,
    };
  }

  graph[CENTER_NODE_ID] = {
    id: CENTER_NODE_ID,
    kind: 'center',
    gridPos: [0, 0],
    // center의 next는 "어느 대각선에서 들어왔는지"에 따라 달라져서 그래프 필드로는 못 박을 수 없다.
    // walkForward()가 직전 칸을 보고 getCenterExit()로 계산한다. 여기 값은 실사용되지 않는 placeholder.
    next: diagonalNodeId(2),
  };

  return graph;
}
