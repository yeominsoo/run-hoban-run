import polyGoogleHorseAssetUrl from './racers/poly-google-bridle-horse.glb?url';
import eclairSittingRiderAssetUrl from './racers/eclair-male-sitting-rider.glb?url';

export const RACER_HORSE_ASSET_URL = polyGoogleHorseAssetUrl;
export const RACER_RIDER_ASSET_URL = eclairSittingRiderAssetUrl;

export const RACER_ASSET_SOURCES = {
  horse: {
    name: 'Poly by Google Horse',
    license: 'CC-BY-3.0',
    pageUrl: 'https://poly.pizza/m/f0_m8hH9BI9',
    downloadUrl: 'https://static.poly.pizza/660ab29d-a30f-40cf-b35d-16365666fd9f.glb'
  },
  rider: {
    name: 'Eclair Assets Background Posed Humans - Male Sitting',
    license: 'CC0-1.0',
    pageUrl: 'https://eclair-assets.itch.io/background-posed-humans-glb-pack-28-free-cc0-3d-models',
    downloadUrl: 'https://eclair-assets.itch.io/background-posed-humans-glb-pack-28-free-cc0-3d-models'
  }
} as const;
