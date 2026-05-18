export interface RacerColor {
  base: string;
  dark: string;
  ink: string;
}

export const RACER_COLORS: RacerColor[] = [
  { base: "#f05d5e", dark: "#8f2528", ink: "#ffffff" },
  { base: "#2b9eb3", dark: "#11515d", ink: "#ffffff" },
  { base: "#f4b63f", dark: "#7a4c06", ink: "#21180a" },
  { base: "#7c5cff", dark: "#34208f", ink: "#ffffff" },
  { base: "#2fbf71", dark: "#14633a", ink: "#ffffff" },
  { base: "#ff7f50", dark: "#8e361d", ink: "#ffffff" },
  { base: "#3f88c5", dark: "#1b4a73", ink: "#ffffff" },
  { base: "#d45087", dark: "#76284b", ink: "#ffffff" },
  { base: "#6a994e", dark: "#395a29", ink: "#ffffff" },
  { base: "#f77f00", dark: "#7c4000", ink: "#21180a" },
  { base: "#00a896", dark: "#04584f", ink: "#ffffff" },
  { base: "#9b5de5", dark: "#4d2484", ink: "#ffffff" },
  { base: "#ef476f", dark: "#84213a", ink: "#ffffff" },
  { base: "#118ab2", dark: "#08455a", ink: "#ffffff" },
  { base: "#a7c957", dark: "#4f6420", ink: "#172000" },
  { base: "#ffca3a", dark: "#80620c", ink: "#21180a" },
  { base: "#1982c4", dark: "#0d4366", ink: "#ffffff" },
  { base: "#6f4e37", dark: "#332014", ink: "#ffffff" },
  { base: "#f72585", dark: "#7a1244", ink: "#ffffff" },
  { base: "#4cc9f0", dark: "#16647a", ink: "#072533" },
  { base: "#b5179e", dark: "#5e0b52", ink: "#ffffff" },
  { base: "#7209b7", dark: "#3a075c", ink: "#ffffff" },
  { base: "#4361ee", dark: "#1e2f80", ink: "#ffffff" },
  { base: "#3a0ca3", dark: "#1d0652", ink: "#ffffff" },
  { base: "#06d6a0", dark: "#04765a", ink: "#06261f" },
  { base: "#ffd166", dark: "#8d651d", ink: "#231a08" },
  { base: "#073b4c", dark: "#021c24", ink: "#ffffff" },
  { base: "#ff595e", dark: "#8a2328", ink: "#ffffff" },
  { base: "#ff924c", dark: "#8b3f10", ink: "#21180a" },
  { base: "#c5ca30", dark: "#5d6115", ink: "#1e2105" },
  { base: "#8ac926", dark: "#42630d", ink: "#172000" },
  { base: "#52b788", dark: "#245840", ink: "#ffffff" },
  { base: "#577590", dark: "#263847", ink: "#ffffff" },
  { base: "#f3722c", dark: "#7e3514", ink: "#ffffff" },
  { base: "#90be6d", dark: "#405b2b", ink: "#15210d" },
  { base: "#f94144", dark: "#8a191b", ink: "#ffffff" },
];

export function colorForRacer(id: number): RacerColor {
  return RACER_COLORS[(id - 1) % RACER_COLORS.length];
}
