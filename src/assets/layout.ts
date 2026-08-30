import { createHash } from 'node:crypto';
import { join } from 'node:path';
export function campaignPaths(root: string) {
  return {
    campaign: join(root, 'campaign.yaml'),
    storyboard: join(root, 'storyboard.json'),
    assets: join(root, 'assets'),
    generated: {
      images: join(root, 'generated/images'),
      clips: join(root, 'generated/clips'),
      audio: join(root, 'generated/audio'),
    },
    references: join(root, 'references'),
    imported: join(root, 'assets/imported'),
    renders: join(root, 'renders'),
    inspection: join(root, 'inspection'),
    reports: join(root, 'reports'),
    state: join(root, 'campaign-state.json'),
  };
}
export function assetCacheKey(input: unknown) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 20);
}
export function generatedFilename(
  shotId: string,
  kind: string,
  revision: number,
  extension: string,
) {
  return `${shotId}.${kind}.r${revision}.${extension.replace(/^\./, '')}`;
}
