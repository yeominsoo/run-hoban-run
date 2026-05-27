import quaterniusHorseAssetUrl from './racers/quaternius-horse.gltf?url';
import quaterniusMonkRiderAssetUrl from './racers/quaternius-monk-rider.gltf?url';

export const QUATERNIUS_HORSE_ASSET_URL = quaterniusHorseAssetUrl;
export const QUATERNIUS_MONK_RIDER_ASSET_URL = quaterniusMonkRiderAssetUrl;

export const RACER_ASSET_SOURCES = {
  horse: {
    name: 'Quaternius Ultimate Animated Animal Pack - Horse',
    license: 'CC0-1.0',
    pageUrl: 'https://quaternius.com/packs/ultimateanimatedanimals.html',
    downloadUrl: 'https://drive.google.com/drive/folders/1uJ3N5HfB7jKTseJUNQr3N4YaN0UuEtHk?usp=sharing'
  },
  rider: {
    name: 'Quaternius RPG Character Pack - Monk',
    license: 'CC0-1.0',
    pageUrl: 'https://quaternius.com/packs/rpgcharacters.html',
    downloadUrl: 'https://drive.google.com/drive/folders/1MIRQXLfTd21HMI5rwOb6Xy0rv0xv1m8b?usp=sharing'
  }
} as const;
