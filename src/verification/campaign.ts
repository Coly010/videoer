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
  for (const [capability, provider] of Object.entries(campaign.providers)) {
    if (!provider) continue;
    checks.push({ id: 'campaign.provider.configured', status: 'warning', actual: provider, message: `${capability} provider '${provider}' is selected; availability is checked when that explicit generative operation runs`, remediation: 'Register the provider in the application operation before generation' });
  }
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
  const ordered = [...storyboard.shots].sort((a, b) => a.startSeconds - b.startSeconds);
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    const overlap = previous.startSeconds + previous.durationSeconds - current.startSeconds;
    checks.push({ id: 'storyboard.timing.overlap', status: overlap <= .001 ? 'pass' : 'fail', shotId: current.id, expected: '<= 0', actual: overlap, message: overlap <= .001 ? 'Shot timing does not overlap' : 'Shot overlaps the previous shot' });
  }
  const hasCta = storyboard.shots.some((shot) => shot.type === 'cta' && Boolean(shot.text?.trim()));
  checks.push({ id: 'storyboard.cta', status: hasCta ? 'pass' : 'warning', expected: campaign.cta, actual: hasCta, message: hasCta ? 'Storyboard includes a visible CTA shot' : 'Storyboard has no visible CTA shot', ...(!hasCta ? { remediation: 'Add a CTA shot containing the campaign call to action' } : {}) });
  return aggregateChecks(checks);
}
