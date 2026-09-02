import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * A real client project stores its campaign workspace in `source/` and its
 * delivery files in the sibling `output/` directory. The project marker keeps
 * this opt-in so ordinary campaigns retain their established layout.
 */
function projectOutputDirectory(root: string) {
  const projectRoot = dirname(root);
  return basename(root) === 'source' && existsSync(join(projectRoot, 'project.yaml'))
    ? join(projectRoot, 'output')
    : join(root, 'renders');
}

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
    renders: projectOutputDirectory(root),
    inspection: join(root, 'inspection'),
    reports: join(root, 'reports'),
    productionPlan: join(root, 'production-plan.yaml'),
    assetManifest: join(root, 'asset-manifest.yaml'),
    work: join(root, 'work'),
    verification: join(root, 'verification'),
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
