import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createContactSheet, extractVideoFrame, inspectVideo } from '../media/inspection.js';
import { resolveBlenderExecutable } from '../media/blender.js';
import type { InteractionDefinition, SceneTransform } from './model.js';

const exec = promisify(execFile);

export interface InteractionProbeInput {
  actorGeometry: string;
  actorMotion: string;
  actorTransform: SceneTransform;
  targetGeometry: string;
  targetMotion?: string;
  targetTransform: SceneTransform;
  definition: InteractionDefinition;
  qualityGates: Record<string, unknown>;
}

export async function renderInteractionProbe(
  input: InteractionProbeInput,
  outputDirectory: string,
) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const manifest = join(output, 'interaction-manifest.json');
  const manifestData = {
    ...input,
    actorGeometry: resolve(input.actorGeometry),
    actorMotion: resolve(input.actorMotion),
    targetGeometry: resolve(input.targetGeometry),
    ...(input.targetMotion ? { targetMotion: resolve(input.targetMotion) } : {}),
  };
  await writeFile(manifest, `${JSON.stringify(manifestData, null, 2)}\n`, 'utf8');
  const script = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../scripts/blender/render_interaction_probe.py',
  );
  const blender = await resolveBlenderExecutable();
  const { stdout, stderr } = await exec(
    blender,
    ['--background', '--factory-startup', '--python', script, '--', manifest, output],
    { maxBuffer: 20 * 1024 * 1024 },
  );
  const video = join(output, 'interaction.mp4');
  const oppositeVideo = join(output, 'interaction-opposite.mp4');
  const [media, oppositeMedia] = await Promise.all([
    inspectVideo(video),
    inspectVideo(oppositeVideo),
  ]);
  const duration = Number((media.format as { duration?: string } | undefined)?.duration);
  const landmarks = input.definition.phases.map((phase) => ({
    id: phase.id,
    progress: phase.start,
  }));
  landmarks.push({ id: 'complete', progress: 1 });
  const capture = async (source: string, prefix: string) =>
    Promise.all(
      landmarks.map(async ({ id, progress }) => {
        const path = join(
          output,
          `${prefix}-${String(Math.round(progress * 100)).padStart(3, '0')}-${id}.png`,
        );
        await extractVideoFrame(
          source,
          Math.min(duration * progress, Math.max(0, duration - 0.05)),
          path,
        );
        return path;
      }),
    );
  const frames = await capture(video, 'interaction');
  const oppositeFrames = await capture(oppositeVideo, 'interaction-opposite');
  const contactSheet = join(output, 'contact-sheet.png');
  const oppositeContactSheet = join(output, 'contact-sheet-opposite.png');
  await Promise.all([
    createContactSheet(frames, contactSheet, 4),
    createContactSheet(oppositeFrames, oppositeContactSheet, 4),
  ]);
  const report = join(output, 'interaction-probe.json');
  await writeFile(
    report,
    `${JSON.stringify({ schemaVersion: 1, manifest, video, oppositeVideo, frames, oppositeFrames, contactSheet, oppositeContactSheet, media: { primary: media, opposite: oppositeMedia }, qualityGates: input.qualityGates, blender: { stdout, stderr } }, null, 2)}\n`,
    'utf8',
  );
  return {
    output,
    manifest,
    video,
    oppositeVideo,
    frames,
    oppositeFrames,
    contactSheet,
    oppositeContactSheet,
    report,
    media: { primary: media, opposite: oppositeMedia },
  };
}
