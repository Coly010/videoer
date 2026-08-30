import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadCampaign, loadStoryboard } from '../src/domain/io.js';
describe('examples', () => {
  it.each(['cinematic-book', 'saas-promo'])('loads %s', async (name) => {
    const root = resolve('campaigns/examples', name);
    expect((await loadCampaign(resolve(root, 'campaign.yaml'))).schemaVersion).toBe(1);
    expect((await loadStoryboard(resolve(root, 'storyboard.json'))).shots.length).toBeGreaterThan(
      2,
    );
  });
});
