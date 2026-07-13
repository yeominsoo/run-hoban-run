export interface PointerPos {
  x: number;
  y: number;
}

export function getPointerPos(e: PointerEvent, target: Element): PointerPos {
  const rect = target.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

/** 마우스 좌클릭/터치/펜 입력을 Pointer Events로 통합 처리한다. 해제 함수를 반환한다. */
export function onTap(el: HTMLElement, cb: (pos: PointerPos, ev: PointerEvent) => void): () => void {
  const handler = (ev: PointerEvent) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    cb(getPointerPos(ev, el), ev);
  };
  el.addEventListener('pointerdown', handler);
  return () => el.removeEventListener('pointerdown', handler);
}

export interface DragHandlers {
  onMove: (pos: PointerPos, ev: PointerEvent) => void;
  onStart?: (pos: PointerPos, ev: PointerEvent) => void;
  onEnd?: (ev: PointerEvent) => void;
}

/** 누르고 있는 동안만 좌표를 계속 보고하는 드래그 인터랙션. 손을 떼면 멈춘다. 해제 함수를 반환한다. */
export function onDrag(el: HTMLElement, handlers: DragHandlers): () => void {
  let dragging = false;

  const down = (ev: PointerEvent) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    dragging = true;
    el.setPointerCapture(ev.pointerId);
    const pos = getPointerPos(ev, el);
    handlers.onStart?.(pos, ev);
    handlers.onMove(pos, ev);
  };
  const move = (ev: PointerEvent) => {
    if (!dragging) return;
    handlers.onMove(getPointerPos(ev, el), ev);
  };
  const up = (ev: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    handlers.onEnd?.(ev);
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);

  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
}

export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

/** 눌렀다 뗀 지점 사이의 이동량으로 스와이프 방향을 판정한다(대각선은 더 큰 축으로 판정). */
export function onSwipe(el: HTMLElement, cb: (dir: SwipeDirection) => void, minDistancePx = 24): () => void {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  const down = (ev: PointerEvent) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    tracking = true;
    startX = ev.clientX;
    startY = ev.clientY;
  };
  const up = (ev: PointerEvent) => {
    if (!tracking) return;
    tracking = false;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (Math.hypot(dx, dy) < minDistancePx) return;
    cb(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  };
  const cancel = () => {
    tracking = false;
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);

  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
  };
}
