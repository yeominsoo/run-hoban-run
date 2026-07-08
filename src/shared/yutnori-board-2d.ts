import type { YutBoardNode } from '../game/yutnori-board';
import { CORNER_STRIDE, CORNER_COUNT, DIAGONAL_NODES_PER_CORNER, cornerIndexOfDiagonal, diagonalStepOf } from '../game/yutnori-board';

/** 윷놀이/전략윷놀이 공용 2D 보드 좌표 변환.
 *  게임 로직(src/game/yutnori-board.ts)의 gridPos는 예전 3D 렌더러 전용 좌표라 재사용하지 않고,
 *  노드 id/kind만으로 화면 퍼센트 좌표(0~100)를 직접 계산한다. */

export const YUT_PLAYER_COLORS = ['#e8543f', '#3d6fd6', '#f6c445', '#4a8f4f'];

/** 코너 인덱스(0=공유 출발/도착점) → 보드 컨테이너 기준 퍼센트 좌표.
 *  0번을 우측 하단에 두고, 외곽 진행 순서(0→1→2→3)가 우측 변을 타고 올라가는
 *  반시계 방향이 되도록 배치한다(전통 윷판 진행 방향과 동일). */
const CORNER_SCREEN_PCT: [number, number][] = [
  [100, 100], // corner 0: 출발/도착 — 우측 하단
  [100, 0],   // corner 1: 우측 상단
  [0, 0],     // corner 2: 좌측 상단
  [0, 100],   // corner 3: 좌측 하단
];
const CENTER_SCREEN_PCT: [number, number] = [50, 50];

function lerp2(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export interface ScreenPos { xPct: number; yPct: number; }

export function nodeScreenPos(node: YutBoardNode): ScreenPos {
  if (node.kind === 'center') {
    return { xPct: CENTER_SCREEN_PCT[0], yPct: CENTER_SCREEN_PCT[1] };
  }
  if (node.kind === 'diagonal') {
    const c = cornerIndexOfDiagonal(node.id);
    const step = diagonalStepOf(node.id);
    const [x, y] = lerp2(CORNER_SCREEN_PCT[c], CENTER_SCREEN_PCT, (step + 1) / (DIAGONAL_NODES_PER_CORNER + 1));
    return { xPct: x, yPct: y };
  }
  const outerIndex = Number(node.id.match(/^outer-(\d+)$/)?.[1] ?? 0);
  const sideIndex = Math.floor(outerIndex / CORNER_STRIDE);
  const stepOnSide = outerIndex % CORNER_STRIDE;
  const [x, y] = lerp2(
    CORNER_SCREEN_PCT[sideIndex],
    CORNER_SCREEN_PCT[(sideIndex + 1) % CORNER_COUNT],
    stepOnSide / CORNER_STRIDE,
  );
  return { xPct: x, yPct: y };
}

/** 같은 칸에 여러 말이 겹칠 때(업기/출발 대기) 작게 벌려서 각각 클릭 가능하도록 벌리는 오프셋(퍼센트 포인트). */
const STACK_OFFSETS: [number, number][] = [
  [0, 0],
  [4.2, -4.2],
  [-4.2, 4.2],
  [4.2, 4.2],
];
export function stackOffsetPct(stackIndex: number): { dx: number; dy: number } {
  const [dx, dy] = STACK_OFFSETS[stackIndex % STACK_OFFSETS.length];
  return { dx, dy };
}

/** 출발 전(nodeId=null) 말들이 전부 시작 코너 한 점에 겹치지 않도록, 플레이어 슬롯별로
 *  출발 코너 안쪽에 서로 다른 대기 위치를 배정한다(0~3번 슬롯, 최대 4인).
 *  각 위치는 STACK_OFFSETS(최대 ±4.2)를 더해도 보드 밖(0~100%)으로 나가지 않도록 여유를 둔다. */
const START_LANE_OFFSETS: [number, number][] = [
  [-18, -11],
  [-11, -18],
  [-26, -18],
  [-18, -26],
];
export function stagingLaneOffset(playerSlot: number): { dx: number; dy: number } {
  const [dx, dy] = START_LANE_OFFSETS[playerSlot % START_LANE_OFFSETS.length];
  return { dx, dy };
}

/** 화면상 플레이어 좌석 배치: 1p=11시(좌상단), 2p=1시(우상단), 3p=5시(우하단), 4p=7시(좌하단), 시계방향.
 *  게임판 시작 코너(우측 하단) 배치와는 별개의, 순전히 UI용 좌석 배정이다. */
export const SEAT_CORNER_CLASS = ['seat-tl', 'seat-tr', 'seat-br', 'seat-bl'] as const;
