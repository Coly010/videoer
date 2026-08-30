import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { inspectCampaign, verifyCampaign } from '../src/application/campaigns.js';

describe('application operations', () => {
  const campaign = resolve('campaigns/examples/saas-promo/campaign.yaml');
  it('exposes campaign inspection independent of CLI', async () => {
    const result = await inspectCampaign(campaign);
    expect(result.storyboard?.shots).toBeGreaterThan(2);
    expect(result.paths.state).toMatch(/campaign-state\.json$/);
  });
  it('runs deterministic campaign verification', async () => {
    const result = await verifyCampaign(campaign);
    expect(result.status).toBe('pass');
    expect(result.checks.some((check) => check.id === 'campaign.schema')).toBe(true);
  });
});
