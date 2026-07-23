export type ObstacleVisual =
  | 'stump'
  | 'thorn-patch'
  | 'floating-grass-platform'
  | 'honeybee'
  | 'bluebird'
  | 'mossy-rock'
  | 'hanging-vine-snake';

const importedAssets = import.meta.glob(
  '../../../endless-runner/assets/obstacles/*.png',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>;

function assetUrl(name: ObstacleVisual): string {
  const key = `../../../endless-runner/assets/obstacles/${name}.png`;
  const url = importedAssets[key];
  if (!url) throw new Error(`Missing endless-runner obstacle asset: ${key}`);
  return url;
}

export const OBSTACLE_ASSET_URLS: Record<ObstacleVisual, string> = {
  stump: assetUrl('stump'),
  'thorn-patch': assetUrl('thorn-patch'),
  'floating-grass-platform': assetUrl('floating-grass-platform'),
  honeybee: assetUrl('honeybee'),
  bluebird: assetUrl('bluebird'),
  'mossy-rock': assetUrl('mossy-rock'),
  'hanging-vine-snake': assetUrl('hanging-vine-snake')
};
