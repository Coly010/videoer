import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { sha256File } from '../assets/library.js';
import { renderCinematicScene } from '../cinematic/blender.js';
import { loadCinematicScene, saveCinematicScene } from '../cinematic/io.js';
import { createDeterministicRenderProfile } from '../cinematic/render-profiles.js';
import { createContactSheet } from '../media/inspection.js';

export async function compareDeterministicRenderProfile(
  sceneFile: string,
  outputDirectory: string,
) {
  const source = resolve(sceneFile);
  const sourceDirectory = dirname(source);
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const original = await loadCinematicScene(source);
  const absolute = {
    ...original,
    entities: original.entities.map((entity) => ({
      ...entity,
      geometryPath: resolve(sourceDirectory, entity.geometryPath),
      ...(entity.motion
        ? { motion: { ...entity.motion, path: resolve(sourceDirectory, entity.motion.path) } }
        : {}),
    })),
    overlays: original.overlays.map((overlay) => ({
      ...overlay,
      imagePath: resolve(sourceDirectory, overlay.imagePath),
    })),
  };
  const baselineScene = await saveCinematicScene(join(output, 'baseline-scene.json'), absolute);
  const candidateProfile = createDeterministicRenderProfile('production-clean');
  const candidateScene = await saveCinematicScene(join(output, 'candidate-scene.json'), {
    ...absolute,
    renderProfile: candidateProfile,
  });
  const baseline = await renderCinematicScene(baselineScene, join(output, 'baseline'));
  const candidateA = await renderCinematicScene(candidateScene, join(output, 'candidate-a'));
  const candidateB = await renderCinematicScene(candidateScene, join(output, 'candidate-b'));
  const [
    baselineVideoSha256,
    candidateVideoSha256,
    rerenderVideoSha256,
    baselineFrameHashes,
    candidateFrameHashes,
    rerenderFrameHashes,
  ] = await Promise.all([
    sha256File(baseline.video),
    sha256File(candidateA.video),
    sha256File(candidateB.video),
    Promise.all(baseline.frames.map((frame) => sha256File(frame.path))),
    Promise.all(candidateA.frames.map((frame) => sha256File(frame.path))),
    Promise.all(candidateB.frames.map((frame) => sha256File(frame.path))),
  ]);
  const deterministic =
    candidateVideoSha256 === rerenderVideoSha256 &&
    candidateFrameHashes.every((hash, index) => hash === rerenderFrameHashes[index]);
  const comparison = join(output, 'baseline-vs-production-clean.png');
  await createContactSheet(
    [
      ...baseline.frames.map((frame) => frame.path),
      ...candidateA.frames.map((frame) => frame.path),
    ],
    comparison,
    Math.max(1, baseline.frames.length),
  );
  const reportFile = join(output, 'render-profile-comparison.json');
  const report = {
    schemaVersion: 1,
    source,
    status: deterministic
      ? 'technically-deterministic-awaiting-visual-review'
      : 'rejected-nondeterministic',
    qualitativeStatus: 'not-accepted',
    baseline: {
      profile: original.renderProfile,
      videoSha256: baselineVideoSha256,
      semanticFrameSha256: baselineFrameHashes,
    },
    candidate: {
      name: 'production-clean',
      profile: candidateProfile,
      videoSha256: candidateVideoSha256,
      semanticFrameSha256: candidateFrameHashes,
      rerenderVideoSha256,
      rerenderSemanticFrameSha256: rerenderFrameHashes,
      deterministic,
    },
    acceptanceRequirements: [
      'byte-identical independent candidate video and semantic frames',
      'visible sampling-grain reduction against the same-scene baseline',
      'no denoiser smearing, temporal instability, lost microdetail, or changed lighting intent',
    ],
  };
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (!deterministic)
    throw new Error(`Production-clean render profile is nondeterministic; evidence: ${reportFile}`);
  return {
    output,
    baseline,
    candidateA,
    candidateB,
    comparison,
    report: reportFile,
    verification: report,
  };
}
