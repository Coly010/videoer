import { dirname, join, resolve } from 'node:path';
import { loadCampaign, loadStoryboard } from '../domain/io.js';
import { loadCampaignState } from '../domain/state.js';
import { campaignPaths } from '../assets/layout.js';
import { resolveTemplate } from '../templates/index.js';
import { verifyCampaign as runVerification } from '../verification/campaign.js';

export async function validateCampaign(campaignFile: string) {
  const campaign = await loadCampaign(campaignFile);
  return {
    campaignId: campaign.id,
    title: campaign.title,
    schemaVersion: campaign.schemaVersion,
    durationSeconds: campaign.durationSeconds,
  };
}

export async function validateStoryboard(storyboardFile: string) {
  const storyboard = await loadStoryboard(storyboardFile);
  return {
    campaignId: storyboard.campaignId,
    title: storyboard.title,
    schemaVersion: storyboard.schemaVersion,
    shots: storyboard.shots.length,
    durationSeconds: storyboard.durationSeconds,
  };
}

export async function inspectCampaign(campaignFile: string) {
  const absolute = resolve(campaignFile);
  const root = dirname(absolute);
  const campaign = await loadCampaign(absolute);
  let storyboard;
  try {
    storyboard = await loadStoryboard(join(root, 'storyboard.json'));
  } catch {
    storyboard = undefined;
  }
  const state = await loadCampaignState(campaignPaths(root).state);
  return {
    campaign,
    template: resolveTemplate(campaign.style),
    storyboard: storyboard
      ? {
          path: join(root, 'storyboard.json'),
          shots: storyboard.shots.length,
          durationSeconds: storyboard.durationSeconds,
        }
      : null,
    state: {
      generatedAssets: state.generatedAssets.length,
      renders: state.renders.length,
      inspections: state.inspections.length,
      verificationReports: state.verificationReports.length,
    },
    paths: campaignPaths(root),
  };
}

export async function verifyCampaign(campaignFile: string) {
  const absolute = resolve(campaignFile);
  const campaign = await loadCampaign(absolute);
  let storyboard;
  try {
    storyboard = await loadStoryboard(join(dirname(absolute), 'storyboard.json'));
  } catch {
    storyboard = undefined;
  }
  return runVerification(campaign, absolute, storyboard);
}
