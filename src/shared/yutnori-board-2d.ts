import type { YutBoardNode } from '../game/yutnori-board';
import { CORNER_STRIDE, CORNER_COUNT, DIAGONAL_NODES_PER_CORNER, cornerIndexOfDiagonal, diagonalStepOf } from '../game/yutnori-board';

/** 윷놀이/전략윷놀이 공용 2D 보드 좌표 변환.
 *  게임 로직(src/game/yutnori-board.ts)의 gridPos는 예전 3D 렌더러 전용 좌표라 재사용하지 않고,
 *  노드 id/kind만으로 화면 퍼센트 좌표(0~100)를 직접 계산한다. */

export const YUT_PLAYER_COLORS = ['#e8543f', '#3d6fd6', '#f6c445', '#4a8f4f'];

/** 코너 인덱스(0=공유 출발/도착점) → 보드 컨테이너 기준 퍼센트 좌표.
 *  0번을 우측 하단에 두고, 외곽 진행 순서(0→1→2→3)가 우측 변을 타고 올라가는
 *  반시계 방향이 되도록 배치한다(전통 윷판 진행 방향과 동일).
 *  정확히 0/100에 두면 코너/외곽 점의 원이 SVG 뷰포트 경계에서 반씩 잘리므로,
 *  점 반지름(최대 4.2)만큼 안쪽으로 들여서(INSET) 배치한다. */
const INSET = 6;
const CORNER_SCREEN_PCT: [number, number][] = [
  [100 - INSET, 100 - INSET], // corner 0: 출발/도착 — 우측 하단
  [100 - INSET, INSET],       // corner 1: 우측 상단
  [INSET, INSET],             // corner 2: 좌측 상단
  [INSET, 100 - INSET],       // corner 3: 좌측 하단
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

/** 출발 전(nodeId=null) 말들을 트랙/출발 코너 위에 겹쳐 두지 않도록, 코너 0(출발점)에는
 *  지름길 대각선이 없어 비어 있는 사분면(대략 x:54~86, y:54~86 — SVG의 yn-waiting-zone
 *  점선 박스와 같은 영역) 안에서 우측 변에 가까운 "우측 날개"와 하단 변에 가까운
 *  "좌측 날개"로 나눠 플레이어별로 배치한다. 이 사분면의 바깥쪽 경계(코너 마커·"출발"
 *  라벨이 있는 x/y 88 이상 구간)와 중앙 근처(다른 코너의 대각선이 모이는 x/y 54 이하
 *  구간)는 피해서, 어떤 트랙 선·라벨과도 겹치지 않는 안쪽 자리만 사용한다. */
const WING_SLOTS: [number, number][] = [
  [78, 58], // slot0: 우측 날개(우측 변 인접) 안쪽
  [58, 78], // slot1: 좌측 날개(하단 변 인접) 안쪽
  [78, 72], // slot2: 우측 날개, 코너에서 더 먼 자리
  [72, 78], // slot3: 좌측 날개, 코너에서 더 먼 자리
];
export function stagingSlotPos(playerSlot: number): ScreenPos {
  const [xPct, yPct] = WING_SLOTS[playerSlot % WING_SLOTS.length];
  return { xPct, yPct };
}

/** 화면상 플레이어 좌석 배치: 1p=11시(좌상단), 2p=1시(우상단), 3p=5시(우하단), 4p=7시(좌하단), 시계방향.
 *  게임판 시작 코너(우측 하단) 배치와는 별개의, 순전히 UI용 좌석 배정이다. */
export const SEAT_CORNER_CLASS = ['seat-tl', 'seat-tr', 'seat-br', 'seat-bl'] as const;
