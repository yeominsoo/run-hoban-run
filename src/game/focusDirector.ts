import type { RankedFrameRacer } from "./raceEngine";

export const MIN_CAMERA_FOCUS_SECONDS = 4;

export type FocusReason = "selected" | "skill";

export interface CameraFocusState {
  racerId: number | null;
  reason: FocusReason | null;
  lockedUntil: number;
}

interface FocusCandidate {
  racerId: number;
  reason: FocusReason;
  priority: number;
  rank: number;
}

interface ChooseCameraFocusOptions {
  racers: RankedFrameRacer[];
  selectedRacerId: number | null;
  nowSeconds: number;
  current: CameraFocusState;
}

export function createEmptyCameraFocus(nowSeconds = 0): CameraFocusState {
  return {
    racerId: null,
    reason: null,
    lockedUntil: nowSeconds,
  };
}

export function chooseCameraFocus({
  racers,
  selectedRacerId,
  nowSeconds,
  current,
}: ChooseCameraFocusOptions): CameraFocusState {
  const currentRacer =
    current.racerId !== null
      ? racers.find((racer) => racer.id === current.racerId)
      : null;

  if (currentRacer && nowSeconds < current.lockedUntil) {
    return current;
  }

  const preferred = getPreferredCandidate(racers, selectedRacerId);

  if (!preferred) {
    return currentRacer && nowSeconds < current.lockedUntil
      ? current
      : createEmptyCameraFocus(nowSeconds);
  }

  if (
    current.racerId === preferred.racerId &&
    current.reason === preferred.reason
  ) {
    return current;
  }

  return {
    racerId: preferred.racerId,
    reason: preferred.reason,
    lockedUntil: nowSeconds + MIN_CAMERA_FOCUS_SECONDS,
  };
}

export function getFocusedRacer(
  racers: RankedFrameRacer[],
  focus: CameraFocusState,
): RankedFrameRacer | null {
  if (focus.racerId === null) {
    return null;
  }

  return racers.find((racer) => racer.id === focus.racerId) ?? null;
}

function getPreferredCandidate(
  racers: RankedFrameRacer[],
  selectedRacerId: number | null,
): FocusCandidate | null {
  const candidates: FocusCandidate[] = [];

  racers.forEach((racer) => {
    if (racer.id === selectedRacerId) {
      candidates.push({
        racerId: racer.id,
        reason: "selected",
        priority: 2,
        rank: racer.rank,
      });
    }

    if (racer.skillActive) {
      candidates.push({
        racerId: racer.id,
        reason: "skill",
        priority: 1,
        rank: racer.rank,
      });
    }
  });

  return (
    candidates.sort((a, b) => b.priority - a.priority || a.rank - b.rank)[0] ??
    null
  );
}
