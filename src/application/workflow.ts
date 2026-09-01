import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { campaignPaths } from '../assets/layout.js';
import { loadCampaign, loadStoryboard, saveStoryboard } from '../domain/io.js';
import {
  loadCampaignState,
  nextRenderRevision,
  saveCampaignState,
  type RenderRevision,
} from '../domain/state.js';
import type { MotionPreset } from '../domain/motion.js';
import { createContactSheet, extractVideoFrame, inspectVideo } from '../media/inspection.js';
import { createRenderPlan, render } from '../renderer/index.js';
import { verifyVideo } from '../verification/video.js';

function context(campaignFile: string) {
  const campaign = resolve(campaignFile);
  const root = dirname(campaign);
  return { campaignFile: campaign, root, paths: campaignPaths(root) };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function renderCampaign(
  campaignFile: string,
  options: { kind: 'draft' | 'final'; changes?: string[] },
) {
  const ctx = context(campaignFile);
  const [campaign, storyboard, state] = await Promise.all([
    loadCampaign(ctx.campaignFile),
    loadStoryboard(ctx.paths.storyboard),
    loadCampaignState(ctx.paths.state),
  ]);
  const revision = nextRenderRevision(state, {
    kind: options.kind,
    path: '',
    changes: options.changes ?? [],
  });
  const outputPath = join(ctx.paths.renders, `${revision.id}.mp4`);
  revision.path = relative(ctx.root, outputPath);
  await mkdir(ctx.paths.renders, { recursive: true });
  const output = await render(createRenderPlan(campaign, storyboard, ctx.campaignFile), {
    outputPath,
    draft: options.kind === 'draft',
  });
  if (options.kind === 'final') await copyFile(outputPath, join(ctx.paths.renders, 'final.mp4'));
  await saveCampaignState(ctx.paths.state, { ...state, renders: [...state.renders, revision] });
  return { revision, output };
}

function findRevision(renders: RenderRevision[], requested = 'latest') {
  const revision =
    requested === 'latest' ? renders.at(-1) : renders.find((item) => item.id === requested);
  if (!revision)
    throw new Error(
      requested === 'latest' ? 'Campaign has no renders' : `Render '${requested}' does not exist`,
    );
  return revision;
}

export async function inspectRender(campaignFile: string, requested = 'latest') {
  const ctx = context(campaignFile);
  const [storyboard, state] = await Promise.all([
    loadStoryboard(ctx.paths.storyboard),
    loadCampaignState(ctx.paths.state),
  ]);
  const revision = findRevision(state.renders, requested);
  const renderPath = resolve(ctx.root, revision.path);
  const output = join(ctx.paths.inspection, 'renders', revision.id);
  const frames = await Promise.all(
    storyboard.shots.map(async (shot) => {
      const path = join(output, 'shots', `${shot.id}-middle.jpg`);
      await extractVideoFrame(renderPath, shot.startSeconds + shot.durationSeconds / 2, path);
      return path;
    }),
  );
  const contactSheet = join(output, 'contact-sheet.jpg');
  await createContactSheet(frames, contactSheet, Math.min(3, frames.length));
  const metadata = await inspectVideo(renderPath);
  const metadataPath = join(output, 'metadata.json');
  await writeJson(metadataPath, { revision, renderPath, frames, contactSheet, media: metadata });
  const inspectionRef = relative(ctx.root, metadataPath);
  if (!state.inspections.includes(inspectionRef))
    await saveCampaignState(ctx.paths.state, {
      ...state,
      inspections: [...state.inspections, inspectionRef],
    });
  return { revision, renderPath, metadataPath, contactSheet, frames, metadata };
}

export async function verifyRender(campaignFile: string, requested = 'latest') {
  const ctx = context(campaignFile);
  const [campaign, state] = await Promise.all([
    loadCampaign(ctx.campaignFile),
    loadCampaignState(ctx.paths.state),
  ]);
  const revision = findRevision(state.renders, requested);
  const renderPath = resolve(ctx.root, revision.path);
  const result = await verifyVideo(renderPath, campaign, revision);
  const reportPath = join(ctx.paths.reports, `${revision.id}.json`);
  await writeJson(reportPath, {
    schemaVersion: 1,
    render: revision,
    result,
    createdAt: new Date().toISOString(),
  });
  const reportRef = relative(ctx.root, reportPath);
  if (!state.verificationReports.includes(reportRef))
    await saveCampaignState(ctx.paths.state, {
      ...state,
      verificationReports: [...state.verificationReports, reportRef],
    });
  return { revision, reportPath, ...result };
}

export async function reviseShot(
  campaignFile: string,
  shotId: string,
  change: { text?: string; caption?: string; motion?: MotionPreset },
) {
  const ctx = context(campaignFile);
  const storyboard = await loadStoryboard(ctx.paths.storyboard);
  const index = storyboard.shots.findIndex((shot) => shot.id === shotId);
  if (index < 0) throw new Error(`Shot '${shotId}' does not exist`);
  if (!change.text && !change.caption && !change.motion)
    throw new Error('A shot revision requires text, caption, or motion');
  const shots = [...storyboard.shots];
  const current = shots[index]!;
  shots[index] = {
    ...current,
    ...change,
    generation: {
      ...current.generation,
      revision: current.generation.revision + 1,
      stale: current.sources.some((source) => source.kind === 'generated'),
    },
  };
  await saveStoryboard(ctx.paths.storyboard, { ...storyboard, shots });
  return {
    shotId,
    revision: shots[index]!.generation.revision,
    staleGeneratedAssets: shots[index]!.generation.stale,
    changed: Object.keys(change),
  };
}
