import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Campaign, Storyboard } from '../domain/schemas.js';
import { resolveTemplate } from '../templates/index.js';
import { aggregateChecks, type VerificationCheck, type VerificationResult } from './model.js';

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function verifyCampaign(
  campaign: Campaign,
  campaignFile: string,
  storyboard?: Storyboard,
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];
  checks.push({ id: 'campaign.schema', status: 'pass', message: 'Campaign schema is valid' });
  try {
    resolveTemplate(campaign.style);
    checks.push({
      id: 'campaign.template',
      status: 'pass',
      message: `Template '${campaign.style}' exists`,
    });
  } catch {
    checks.push({
      id: 'campaign.template',
      status: 'fail',
      message: `Template '${campaign.style}' does not exist`,
    });
  }
  for (const [name, relativePath] of Object.entries(campaign.assets)) {
    const path = resolve(dirname(campaignFile), relativePath);
    const found = await exists(path);
    checks.push({
      id: 'campaign.asset.exists',
      status: found ? 'pass' : 'fail',
      path,
      message: found ? `Asset '${name}' exists` : `Asset '${name}' is missing`,
      expected: true,
      actual: found,
      ...(!found ? { remediation: `Restore or import ${relativePath}` } : {}),
    });
  }
  if (!storyboard) {
    checks.push({
      id: 'campaign.storyboard',
      status: 'warning',
      message: 'No storyboard was supplied for cross-checking',
    });
    return aggregateChecks(checks);
  }
  checks.push({
    id: 'campaign.storyboard.id',
    status: storyboard.campaignId === campaign.id ? 'pass' : 'fail',
    expected: campaign.id,
    actual: storyboard.campaignId,
    message:
      storyboard.campaignId === campaign.id
        ? 'Storyboard belongs to campaign'
        : 'Storyboard campaign ID does not match',
  });
  checks.push({
    id: 'campaign.storyboard.duration',
    status:
      Math.abs(storyboard.durationSeconds - campaign.durationSeconds) <= 0.001 ? 'pass' : 'fail',
    expected: campaign.durationSeconds,
    actual: storyboard.durationSeconds,
    message: 'Storyboard duration matches campaign duration',
  });
  for (const shot of storyboard.shots) {
    for (const source of shot.sources.filter((s) => s.kind === 'supplied' && s.path)) {
      const path = resolve(dirname(campaignFile), source.path!);
      const found = await exists(path);
      checks.push({
        id: 'storyboard.source.exists',
        status: found ? 'pass' : 'fail',
        path,
        shotId: shot.id,
        message: found ? 'Shot source exists' : 'Shot source is missing',
        expected: true,
        actual: found,
      });
    }
  }
  return aggregateChecks(checks);
}
