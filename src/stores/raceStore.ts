import { create } from "zustand";
import {
  DEFAULT_LAP_COUNT,
  RACE_DURATION_SECONDS,
  RACE_GROUP_SIZE,
  TRACK_TYPES,
  createSampleParticipants,
  createSeed,
  getRaceDisplayDurationSeconds,
  normalizeRaceGroupSize,
  simulateRace,
} from "../game/raceEngine";
import type { RaceResult, TrackId } from "../game/raceEngine";

export type LayerPanel = "settings" | "results" | null;

interface RaceStore {
  participantText: string;
  passStart: number;
  passEnd: number;
  selectedTrackId: TrackId;
  lapCount: number;
  groupSize: number;
  seed: string;
  speed: number;
  selectedRacerId: number | null;
  race: RaceResult | null;
  playbackTime: number;
  isRunning: boolean;
  startedAt: number | null;
  status: string;
  isError: boolean;
  openPanel: LayerPanel;
  setParticipantText: (value: string) => void;
  setPassRange: (start: number, end: number) => void;
  setTrack: (trackId: TrackId) => void;
  setLapCount: (lapCount: number) => void;
  setGroupSize: (groupSize: number) => void;
  setSpeed: (speed: number) => void;
  setSelectedRacer: (racerId: number | null) => void;
  setPanel: (panel: LayerPanel) => void;
  generateSample: (count: number) => void;
  prepareRace: () => void;
  startRace: (now: number) => void;
  resetRace: () => void;
  stopRace: () => void;
  setPlaybackFromClock: (now: number) => void;
}

const DEFAULT_SAMPLE_COUNT = 10;
const DEFAULT_PASS_START = 1;
const DEFAULT_PASS_END = 5;
const DEFAULT_SPEED = 2;

export const PLAYBACK_SPEED_OPTIONS = Object.freeze([1, 2, 4]);

export const useRaceStore = create<RaceStore>((set, get) => ({
  participantText: createSampleParticipants(DEFAULT_SAMPLE_COUNT).join("\n"),
  passStart: DEFAULT_PASS_START,
  passEnd: DEFAULT_PASS_END,
  selectedTrackId: TRACK_TYPES[0].id,
  lapCount: DEFAULT_LAP_COUNT,
  groupSize: RACE_GROUP_SIZE,
  seed: createSeed(),
  speed: DEFAULT_SPEED,
  selectedRacerId: null,
  race: null,
  playbackTime: 0,
  isRunning: false,
  startedAt: null,
  status: "준비 중",
  isError: false,
  openPanel: null,

  setParticipantText: (value) => {
    set({ participantText: value });
  },

  setPassRange: (start, end) => {
    set({ passStart: start, passEnd: end });
  },

  setTrack: (trackId) => {
    set({ selectedTrackId: trackId });
    get().prepareRace();
  },

  setLapCount: (lapCount) => {
    set({ lapCount });
    get().prepareRace();
  },

  setGroupSize: (groupSize) => {
    set({ groupSize: normalizeRaceGroupSize(groupSize) });
  },

  setSpeed: (speed) => {
    set({ speed: normalizePlaybackSpeed(speed) });
  },

  setSelectedRacer: (racerId) => {
    set({ selectedRacerId: racerId });
  },

  setPanel: (panel) => {
    set({ openPanel: panel });
  },

  generateSample: (count) => {
    const nextParticipants = createSampleParticipants(count).join("\n");
    const currentEnd = Number.isFinite(get().passEnd) ? get().passEnd : 1;
    const endRank = Math.min(count, Math.max(1, currentEnd));
    const startRank = Math.min(endRank, Math.max(1, get().passStart));
    set({
      participantText: nextParticipants,
      passStart: startRank,
      passEnd: endRank,
    });
    get().prepareRace();
  },

  prepareRace: () => {
    const state = get();

    try {
      const race = simulateRace({
        participantNames: state.participantText,
        trackId: state.selectedTrackId,
        lapCount: state.lapCount,
        passStart: state.passStart,
        passEnd: state.passEnd,
        seed: state.seed || createSeed(),
      });
      set({
        race,
        playbackTime: 0,
        isRunning: false,
        startedAt: null,
        selectedRacerId: null,
        status: "레이스 준비 완료",
        isError: false,
      });
    } catch (error) {
      set({
        race: null,
        isRunning: false,
        startedAt: null,
        status:
          error instanceof Error
            ? error.message
            : "레이스 준비 중 오류가 발생했습니다.",
        isError: true,
      });
    }
  },

  startRace: (now) => {
    if (!get().race) {
      get().prepareRace();
    }

    if (!get().race) {
      return;
    }

    const { playbackTime, speed } = get();
    set({
      isRunning: true,
      startedAt: now - (playbackTime * 1000) / speed,
      status: "레이스 진행 중",
      isError: false,
      openPanel: null,
    });
  },

  resetRace: () => {
    set({
      seed: createSeed(),
      playbackTime: 0,
      isRunning: false,
      startedAt: null,
      selectedRacerId: null,
      openPanel: null,
    });
    get().prepareRace();
  },

  stopRace: () => {
    set({ isRunning: false, startedAt: null });
  },

  setPlaybackFromClock: (now) => {
    const { race, startedAt, speed } = get();

    if (startedAt === null) {
      return;
    }

    const playbackDuration = race
      ? getRaceDisplayDurationSeconds(race.participants.length, get().groupSize)
      : RACE_DURATION_SECONDS;
    const playbackTime = Math.min(
      playbackDuration,
      ((now - startedAt) / 1000) * speed,
    );

    if (playbackTime >= playbackDuration) {
      set({
        playbackTime,
        isRunning: false,
        startedAt: null,
        openPanel: "results",
        status: "레이스 종료",
        isError: false,
      });
      return;
    }

    set({ playbackTime });
  },
}));

export function participantCountFromText(value: string): number {
  return value
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean).length;
}

function normalizePlaybackSpeed(speed: number): number {
  const requestedSpeed = Number.isFinite(speed) ? speed : DEFAULT_SPEED;

  return PLAYBACK_SPEED_OPTIONS.reduce((nearest, option) => {
    return Math.abs(option - requestedSpeed) <
      Math.abs(nearest - requestedSpeed)
      ? option
      : nearest;
  }, PLAYBACK_SPEED_OPTIONS[0]);
}
