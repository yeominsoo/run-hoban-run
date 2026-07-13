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
