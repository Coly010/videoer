import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolveBlenderExecutable } from '../media/blender.js';
import { createContactSheet, extractVideoFrame, inspectVideo } from '../media/inspection.js';

const exec = promisify(execFile);

export async function renderMotionProbe(
  geometryFile: string,
  motionFile: string,
  outputDirectory: string,
  qualityGates: Record<string, unknown> = {},
  options: {
    baseName?: string;
    landmarks?: Array<{ id: string; phase: number }>;
  } = {},
) {
  const geometry = resolve(geometryFile);
  const motion = resolve(motionFile);
  const output = resolve(outputDirectory);
  const script = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../scripts/blender/render_motion_probe.py',
  );
  const blender = await resolveBlenderExecutable();
  await mkdir(output, { recursive: true });
  const baseName = options.baseName ?? 'walk';
  const { stdout, stderr } = await exec(
    blender,
    [
      '--background',
      '--factory-startup',
      '--python',
      script,
      '--',
      geometry,
      motion,
      output,
      baseName,
    ],
    { maxBuffer: 20 * 1024 * 1024 },
  );
  const video = join(output, `${baseName}.mp4`);
  const threeQuarterVideo = join(output, `${baseName}-three-quarter.mp4`);
  const frontVideo = join(output, `${baseName}-front.mp4`);
  const [media, threeQuarterMedia, frontMedia] = await Promise.all([
    inspectVideo(video),
    inspectVideo(threeQuarterVideo),
    inspectVideo(frontVideo),
  ]);
  const duration = Number((media.format as { duration?: string } | undefined)?.duration);
  const phases = options.landmarks ?? [
    { id: 'initial-contact', phase: 0 },
    { id: 'loading-response', phase: 0.07 },
    { id: 'mid-stance', phase: 0.21 },
    { id: 'terminal-stance', phase: 0.4 },
    { id: 'pre-swing', phase: 0.55 },
    { id: 'initial-swing', phase: 0.665 },
    { id: 'mid-swing', phase: 0.8 },
    { id: 'terminal-swing', phase: 0.935 },
  ];
  const frames = await Promise.all(
    phases.map(async ({ id, phase }) => {
      const path = join(
        output,
        `${baseName}-${String(Math.round(phase * 100)).padStart(3, '0')}-${id}.png`,
      );
      await extractVideoFrame(
        video,
        Math.min(duration * phase, Math.max(0, duration - 0.05)),
        path,
      );
      return { id, phase, path };
    }),
  );
  const contactSheet = join(output, 'contact-sheet.png');
  await createContactSheet(
    frames.map((frame) => frame.path),
    contactSheet,
    4,
  );
  const threeQuarterFrames = await Promise.all(
    phases.map(async ({ id, phase }) => {
      const path = join(
        output,
        `${baseName}-three-quarter-${String(Math.round(phase * 100)).padStart(3, '0')}-${id}.png`,
      );
      await extractVideoFrame(
        threeQuarterVideo,
        Math.min(duration * phase, Math.max(0, duration - 0.05)),
        path,
      );
      return { id, phase, path };
    }),
  );
  const threeQuarterContactSheet = join(output, 'contact-sheet-three-quarter.png');
  await createContactSheet(
    threeQuarterFrames.map((frame) => frame.path),
    threeQuarterContactSheet,
    4,
  );
  const frontFrames = await Promise.all(
    phases.map(async ({ id, phase }) => {
      const path = join(
        output,
        `${baseName}-front-${String(Math.round(phase * 100)).padStart(3, '0')}-${id}.png`,
      );
      await extractVideoFrame(
        frontVideo,
        Math.min(duration * phase, Math.max(0, duration - 0.05)),
        path,
      );
      return { id, phase, path };
    }),
  );
  const frontContactSheet = join(output, 'contact-sheet-front.png');
  await createContactSheet(
    frontFrames.map((frame) => frame.path),
    frontContactSheet,
    4,
  );
  const detailProbes = await Promise.all(
    [
      { id: 'left-hand-detail', video: join(output, `${baseName}-left-hand-detail.mp4`) },
      { id: 'feet-detail', video: join(output, `${baseName}-feet-detail.mp4`) },
    ].map(async ({ id, video: detailVideo }) => {
      const detailMedia = await inspectVideo(detailVideo);
      const detailFrames = await Promise.all(
        phases.map(async ({ id: phaseId, phase }) => {
          const path = join(
            output,
            `${baseName}-${id}-${String(Math.round(phase * 100)).padStart(3, '0')}-${phaseId}.png`,
          );
          await extractVideoFrame(
            detailVideo,
            Math.min(duration * phase, Math.max(0, duration - 0.05)),
            path,
          );
          return { id: phaseId, phase, path };
        }),
      );
      const detailContactSheet = join(output, `contact-sheet-${id}.png`);
      await createContactSheet(
        detailFrames.map((frame) => frame.path),
        detailContactSheet,
        4,
      );
      return {
        id,
        video: detailVideo,
        frames: detailFrames,
        contactSheet: detailContactSheet,
        media: detailMedia,
      };
    }),
  );
  const report = join(output, 'motion-probe.json');
  await writeFile(
    report,
    `${JSON.stringify({ schemaVersion: 1, geometry, motion, phases, video, frames, contactSheet, threeQuarterVideo, threeQuarterFrames, threeQuarterContactSheet, frontVideo, frontFrames, frontContactSheet, detailProbes, qualityGates, media: { side: media, threeQuarter: threeQuarterMedia, front: frontMedia }, blender: { stdout, stderr } }, null, 2)}\n`,
    'utf8',
  );
  return {
    geometry,
    motion,
    output,
    video,
    frames,
    contactSheet,
    threeQuarterVideo,
    threeQuarterFrames,
    threeQuarterContactSheet,
    frontVideo,
    frontFrames,
    frontContactSheet,
    detailProbes,
    phases,
    report,
    media: { side: media, threeQuarter: threeQuarterMedia, front: frontMedia },
  };
}
