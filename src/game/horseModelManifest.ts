export type HorseAnimationKey = "idle" | "walk" | "gallop" | "jump" | "brake";

export interface HorseModelManifest {
  id: string;
  name: string;
  url: string;
  sourcePage: string;
  sourceModel: string;
  author: string;
  license: "CC0-1.0";
  scale: number;
  rotationY: number;
  clips: Record<HorseAnimationKey, string>;
}

export const QUATERNIUS_HORSE_MODEL = Object.freeze({
  id: "quaternius-poly-pizza-horse",
  name: "Horse by Quaternius",
  url: "https://static.poly.pizza/d37dbc87-ca61-4b2c-a2da-d2f0c4240bef.glb",
  sourcePage: "https://poly.pizza/m/qvTrSG9pZF",
  sourceModel:
    "https://static.poly.pizza/d37dbc87-ca61-4b2c-a2da-d2f0c4240bef.glb",
  author: "Quaternius",
  license: "CC0-1.0",
  scale: 1.02,
  rotationY: Math.PI / 2,
  clips: {
    idle: "Idle",
    walk: "Walk",
    gallop: "Gallop",
    jump: "Gallop_Jump",
    brake: "Idle_HitReact_Left",
  },
} satisfies HorseModelManifest);
