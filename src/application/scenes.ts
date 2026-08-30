import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { campaignPaths } from '../assets/layout.js';
import { loadCampaign, loadStoryboard } from '../domain/io.js';
import { numericDepth, sceneItemOrder } from '../scene/model.js';
import { validateStoryboardScenes } from '../scene/validation.js';
import { createRenderPlan, render } from '../renderer/index.js';
import { createContactSheet, extractVideoFrame, inspectVideo } from '../media/inspection.js';

export async function inspectScenes(campaignFile: string) {
  const absolute = resolve(campaignFile);
  const storyboard = await loadStoryboard(campaignPaths(dirname(absolute)).storyboard);
  const validation = await validateStoryboardScenes(storyboard, absolute);
  return {
    ...validation,
    shots: storyboard.shots
      .filter((shot) => shot.type === 'scene')
      .map((shot) => ({
        id: shot.id,
        durationSeconds: shot.durationSeconds,
        camera: shot.scene.camera,
        layers: [...shot.scene.layers]
          .sort((a, b) => sceneItemOrder(a) - sceneItemOrder(b))
          .map((layer) => ({
            id: layer.id,
            type: layer.type,
            depth: numericDepth(layer.depth),
            start: layer.start,
            end: layer.end,
          })),
        effects: shot.scene.effects.map((effect) => ({
          id: effect.id,
          type: effect.type,
          depth: numericDepth(effect.depth),
          start: effect.start,
          end: effect.end,
        })),
      })),
  };
}

export async function renderShot(
  campaignFile: string,
  shotId: string,
  options: { preview?: boolean; from?: number; to?: number; output?: string } = {},
) {
  const absolute = resolve(campaignFile);
  const root = dirname(absolute);
  const [campaign, storyboard] = await Promise.all([
    loadCampaign(absolute),
    loadStoryboard(campaignPaths(root).storyboard),
  ]);
  const shot = storyboard.shots.find((candidate) => candidate.id === shotId);
  if (!shot) throw new Error(`Shot '${shotId}' does not exist`);
  const from = options.from ?? 0;
  const to = options.to ?? shot.durationSeconds;
  if (from < 0 || to <= from || to > shot.durationSeconds)
    throw new Error(`Shot range must satisfy 0 <= from < to <= ${shot.durationSeconds}`);
  const output = resolve(
    options.output ??
      join(root, 'inspection', 'shots', `${shotId}-${options.preview ? 'preview' : 'render'}.mp4`),
  );
  await mkdir(dirname(output), { recursive: true });
  const fps = campaign.output.fps;
  const frameRange: [number, number] = [
    Math.round((shot.startSeconds + from) * fps),
    Math.max(
      Math.round((shot.startSeconds + from) * fps),
      Math.round((shot.startSeconds + to) * fps) - 1,
    ),
  ];
  const rendered = await render(createRenderPlan(campaign, storyboard, absolute), {
    outputPath: output,
    draft: options.preview ?? false,
    frameRange,
  });
  return { ...rendered, shotId, from, to };
}

export async function inspectShotVideo(videoPath: string, outputDirectory?: string) {
  const video = resolve(videoPath);
  const metadata = await inspectVideo(video);
  const format = metadata.format as { duration?: string } | undefined;
  const duration = Number(format?.duration);
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error(`Could not determine duration for ${video}`);
  const output = resolve(outputDirectory ?? join(dirname(video), 'verification'));
  const samples = [0, 0.25, 0.5, 0.75, 1];
  const frames = await Promise.all(
    samples.map(async (sample) => {
      const name = `${String(Math.round(sample * 100)).padStart(3, '0')}.png`;
      const path = join(output, name);
      const safeEnd = Math.max(0, duration - Math.min(0.1, duration / 2));
      await extractVideoFrame(video, Math.min(duration * sample, safeEnd), path);
      return path;
    }),
  );
  const contactSheet = join(output, 'contact-sheet.png');
  await createContactSheet(frames, contactSheet, 3);
  return { video, output, duration, frames, contactSheet };
}
