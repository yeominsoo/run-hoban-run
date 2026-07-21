const importedAssets = import.meta.glob(
  '../../../endless-runner/assets/terrain/*.png',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>;

function assetUrl(name: string): string {
  const key = `../../../endless-runner/assets/terrain/${name}.png`;
  const url = importedAssets[key];
  if (!url) throw new Error(`Missing endless-runner terrain asset: ${key}`);
  return url;
}

export const TERRAIN_ASSET_URLS = {
  meadowGround: assetUrl('meadow-ground')
} as const;
