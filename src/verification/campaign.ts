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
    checks.push({
      id: 'campaign.provider.configured',
      status: 'warning',
      actual: provider,
      message: `${capability} provider '${provider}' is selected; availability is checked when that explicit generative operation runs`,
      remediation: 'Register the provider in the application operation before generation',
    });
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
    if (shot.type === 'scene-keyframes') {
      const populated = shot.keyframes.filter((keyframe) => keyframe.assetPath);
      checks.push({
        id: 'scene-keyframes.assets',
        status: populated.length === shot.keyframes.length ? 'pass' : 'warning',
        shotId: shot.id,
        expected: shot.keyframes.length,
        actual: populated.length,
        message:
          populated.length === shot.keyframes.length
            ? 'Every scene keyframe has a persisted asset'
            : 'Some planned scene keyframes still need generation',
        ...(populated.length !== shot.keyframes.length
          ? { remediation: `Run generate-assets for shot ${shot.id}` }
          : {}),
      });
      for (const keyframe of populated) {
        const path = resolve(dirname(campaignFile), keyframe.assetPath!);
        const found = await exists(path);
        checks.push({
          id: 'scene-keyframes.asset.exists',
          status: found ? 'pass' : 'fail',
          shotId: shot.id,
          path,
          expected: true,
          actual: found,
          message: found
            ? `Keyframe '${keyframe.id}' exists`
            : `Keyframe '${keyframe.id}' is missing`,
          ...(!found ? { remediation: `Regenerate ${shot.id}/${keyframe.id}` } : {}),
        });
      }
      const descriptions = new Set(
        shot.keyframes.map((keyframe) => keyframe.description.trim().toLowerCase()),
      );
      checks.push({
        id: 'scene-keyframes.progression',
        status: descriptions.size === shot.keyframes.length ? 'pass' : 'warning',
        shotId: shot.id,
        expected: 'distinct action description per keyframe',
        actual: descriptions.size,
        message:
          descriptions.size === shot.keyframes.length
            ? 'Keyframes specify intra-shot progression'
            : 'Keyframe action descriptions do not express distinct progression',
        ...(descriptions.size !== shot.keyframes.length
          ? { remediation: 'Describe a motivated change in each continuation/reveal keyframe' }
          : {}),
      });
      const enabledLocks = Object.values(shot.continuity).filter(Boolean).length;
      checks.push({
        id: 'scene-keyframes.continuity-plan',
        status: enabledLocks >= 3 ? 'pass' : 'warning',
        shotId: shot.id,
        expected: 'at least 3 explicit continuity locks',
        actual: enabledLocks,
        message:
          enabledLocks >= 3
            ? 'Scene continuity expectations are explicit'
            : 'Scene has weak continuity constraints',
        ...(enabledLocks < 3
          ? {
              remediation: 'Lock background, identity/design, costume, and lighting where relevant',
            }
          : {}),
      });
      checks.push({
        id: 'scene-keyframes.motion',
        status:
          shot.keyframes.length >= 2 && shot.sceneMotion.blendSeconds > 0 ? 'pass' : 'warning',
        shotId: shot.id,
        actual: shot.sceneMotion,
        message: 'Scene shot defines motivated whole-shot camera motion and keyframe blending',
      });
    }
  }
  const ordered = [...storyboard.shots].sort((a, b) => a.startSeconds - b.startSeconds);
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    const overlap = previous.startSeconds + previous.durationSeconds - current.startSeconds;
    checks.push({
      id: 'storyboard.timing.overlap',
      status: overlap <= 0.001 ? 'pass' : 'fail',
      shotId: current.id,
      expected: '<= 0',
      actual: overlap,
      message:
        overlap <= 0.001 ? 'Shot timing does not overlap' : 'Shot overlaps the previous shot',
    });
  }
  const hasCta = storyboard.shots.some((shot) => shot.type === 'cta' && Boolean(shot.text?.trim()));
  checks.push({
    id: 'storyboard.cta',
    status: hasCta ? 'pass' : 'warning',
    expected: campaign.cta,
    actual: hasCta,
    message: hasCta
      ? 'Storyboard includes a visible CTA shot'
      : 'Storyboard has no visible CTA shot',
    ...(!hasCta ? { remediation: 'Add a CTA shot containing the campaign call to action' } : {}),
  });
  const cinematicVisualShots = storyboard.shots.filter((shot) =>
    ['image-motion', 'scene-keyframes', 'image-to-video'].includes(shot.type),
  );
  if (campaign.style === 'cinematic-fantasy' && cinematicVisualShots.length >= 2) {
    const evolvingScenes = cinematicVisualShots.filter(
      (shot) => shot.type === 'scene-keyframes' || shot.type === 'image-to-video',
    ).length;
    checks.push({
      id: 'storyboard.scene-feel',
      status: evolvingScenes > 0 ? 'pass' : 'warning',
      expected: 'at least one evolving cinematic scene',
      actual: evolvingScenes,
      message:
        evolvingScenes > 0
          ? 'Storyboard includes intra-shot scene progression'
          : 'Cinematic storyboard risks slideshow syndrome: every visual shot is a single still',
      ...(evolvingScenes === 0
        ? { remediation: 'Use scene-keyframes for a shot with two or more related action beats' }
        : {}),
    });
  }
  if (/^https?:\/\//.test(campaign.cta)) {
    const cta = storyboard.shots.find((shot) => shot.type === 'cta');
    const destination = String(cta?.metadata.destinationUrl ?? '');
    checks.push({
      id: 'storyboard.cta.destination',
      status: destination === campaign.cta ? 'pass' : 'fail',
      expected: campaign.cta,
      actual: destination,
      message:
        destination === campaign.cta
          ? 'CTA destination matches the campaign canonical URL'
          : 'CTA destination is missing or differs from the campaign canonical URL',
      ...(destination !== campaign.cta
        ? { remediation: 'Set CTA metadata.destinationUrl to the campaign CTA URL' }
        : {}),
    });
  }
  return aggregateChecks(checks);
}
