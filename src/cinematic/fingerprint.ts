import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadCinematicScene } from './io.js';

async function fileSha256(path: string) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Hashes the renderer-independent scene contract and every external artifact it consumes.
 * This is deliberately independent of Blender outputs so it can decide whether an existing
 * render is safe to reuse before invoking a renderer.
 */
export async function fingerprintCinematicScene(sceneFile: string) {
  const source = resolve(sceneFile);
  const directory = dirname(source);
  const scene = await loadCinematicScene(source);
  const dependencies = [
    ...scene.entities.flatMap((entity) => [
      { role: `geometry:${entity.id}`, path: resolve(directory, entity.geometryPath) },
      ...(entity.productionRigProfilePath
        ? [
            {
              role: `production-rig-profile:${entity.id}`,
              path: resolve(directory, entity.productionRigProfilePath),
            },
          ]
        : []),
      ...(entity.motion
        ? [{ role: `motion:${entity.id}`, path: resolve(directory, entity.motion.path) }]
        : []),
    ]),
    ...scene.overlays.map((overlay, index) => ({
      role: `overlay:${index}`,
      path: resolve(directory, overlay.imagePath),
    })),
    ...(scene.finishProfilePath
      ? [{ role: 'finish-profile', path: resolve(directory, scene.finishProfilePath) }]
      : []),
  ];
  const artifacts = await Promise.all(
    dependencies.map(async (dependency) => ({
      role: dependency.role,
      path: dependency.path,
      sha256: await fileSha256(dependency.path),
    })),
  );
  artifacts.sort((a, b) => a.role.localeCompare(b.role) || a.path.localeCompare(b.path));
  const sceneSha256 = await fileSha256(source);
  const artifactIdentities = artifacts.map(({ role, sha256 }) => ({ role, sha256 }));
  const renderInputs = {
    schemaVersion: scene.schemaVersion,
    id: scene.id,
    durationSeconds: scene.durationSeconds,
    fps: scene.fps,
    resolution: scene.resolution,
    renderProfile: scene.renderProfile,
    entities: scene.entities.map((entity) => ({
      ...entity,
      geometryPath: `artifact:geometry:${entity.id}`,
      ...(entity.productionRigProfilePath
        ? { productionRigProfilePath: `artifact:production-rig-profile:${entity.id}` }
        : {}),
      ...(entity.motion
        ? {
            motion: {
              ...entity.motion,
              path: `artifact:motion:${entity.id}`,
            },
          }
        : {}),
    })),
    camera: scene.camera,
    lights: scene.lights,
    atmosphere: scene.atmosphere,
    overlays: scene.overlays.map((overlay, index) => ({
      imagePath: `artifact:overlay:${index}`,
      startSeconds: overlay.startSeconds,
      endSeconds: overlay.endSeconds,
      opacity: overlay.opacity,
      fadeInSeconds: overlay.fadeInSeconds,
      fadeOutSeconds: overlay.fadeOutSeconds,
    })),
    ...(scene.finishProfilePath ? { finishProfilePath: 'artifact:finish-profile' } : {}),
  };
  return {
    schemaVersion: 1 as const,
    sceneId: scene.id,
    sceneFile: source,
    sceneSha256,
    artifacts,
    renderSha256: digest({ renderInputs, artifacts: artifactIdentities }),
    sha256: digest({ scene, artifacts: artifactIdentities }),
  };
}

export async function fingerprintEditInputs(editPlanFile: string, soundtrackPath: string) {
  const plan = resolve(editPlanFile);
  const soundtrack = resolve(soundtrackPath);
  const editPlanSha256 = await fileSha256(plan);
  const soundtrackSha256 = await fileSha256(soundtrack);
  return {
    schemaVersion: 1 as const,
    editPlanFile: plan,
    editPlanSha256,
    soundtrackPath: soundtrack,
    soundtrackSha256,
    sha256: digest({ editPlanSha256, soundtrackSha256 }),
  };
}
