export interface CombatAssetManifest {
  id: string;
  name: string;
  url: string;
  sourcePage: string;
  sourceModel: string;
  author: string;
  license: "CC0-1.0" | "CC-BY-3.0";
  scale: number;
}

export const HELICOPTER_MODEL = Object.freeze({
  id: "poly-pizza-helicopter-helipad",
  name: "Helicopter and Helipad",
  url: "https://static.poly.pizza/a57d2f32-b663-41ce-9d4a-c7f99fe5df08.glb",
  sourcePage: "https://poly.pizza/m/goudZAiTcJ",
  sourceModel:
    "https://static.poly.pizza/a57d2f32-b663-41ce-9d4a-c7f99fe5df08.glb",
  author: "Arif",
  license: "CC-BY-3.0",
  scale: 4.2,
} satisfies CombatAssetManifest);

export const SNIPER_RIFLE_MODEL = Object.freeze({
  id: "poly-pizza-sniper-rifle-west",
  name: "Sniper Rifle West",
  url: "https://static.poly.pizza/8911738d-1bc6-405d-9345-8c1f7d55bfd6.glb",
  sourcePage: "https://poly.pizza/m/kwJawENuvA",
  sourceModel:
    "https://static.poly.pizza/8911738d-1bc6-405d-9345-8c1f7d55bfd6.glb",
  author: "Pichuliru",
  license: "CC0-1.0",
  scale: 0.48,
} satisfies CombatAssetManifest);
