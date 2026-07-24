export type RunnerPixelBounds = readonly [left: number, top: number, right: number, bottom: number];

export interface RunnerWorldRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function unionPixelBounds(bounds: readonly RunnerPixelBounds[]): RunnerPixelBounds {
  if (bounds.length === 0) {
    throw new Error('At least one pixel bounds entry is required');
  }
  return [
    Math.min(...bounds.map((entry) => entry[0])),
    Math.min(...bounds.map((entry) => entry[1])),
    Math.max(...bounds.map((entry) => entry[2])),
    Math.max(...bounds.map((entry) => entry[3]))
  ];
}

export function pixelBoundsToWorldRect(
  bounds: RunnerPixelBounds,
  anchorX: number,
  anchorY: number,
  visualSize: number,
  canvasWidth: number,
  canvasHeight: number,
  pivotX: number,
  pivotY: number
): RunnerWorldRect {
  const scaleX = visualSize / canvasWidth;
  const scaleY = visualSize / canvasHeight;
  const canvasLeft = anchorX - pivotX * scaleX;
  const canvasTop = anchorY - pivotY * scaleY;
  return {
    left: canvasLeft + bounds[0] * scaleX,
    top: canvasTop + bounds[1] * scaleY,
    width: (bounds[2] - bounds[0]) * scaleX,
    height: (bounds[3] - bounds[1]) * scaleY
  };
}

export function circleOverlapsWorldRect(
  centerX: number,
  centerY: number,
  radius: number,
  rect: RunnerWorldRect
): boolean {
  const closestX = Math.max(rect.left, Math.min(centerX, rect.left + rect.width));
  const closestY = Math.max(rect.top, Math.min(centerY, rect.top + rect.height));
  const deltaX = centerX - closestX;
  const deltaY = centerY - closestY;
  return deltaX * deltaX + deltaY * deltaY <= radius * radius;
}
