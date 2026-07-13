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
