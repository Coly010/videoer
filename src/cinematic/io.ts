import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { cinematicSceneSchema, type CinematicScene } from './model.js';

export async function loadCinematicScene(path: string) {
  return cinematicSceneSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
}

export async function saveCinematicScene(path: string, scene: CinematicScene) {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify(cinematicSceneSchema.parse(scene), null, 2)}\n`,
    'utf8',
  );
  return output;
}

export function portableCinematicDependencyPath(scenePath: string, dependencyPath: string) {
  const portable = relative(dirname(resolve(scenePath)), resolve(dependencyPath));
  if (!portable)
    throw new Error('Cinematic scene dependency may not resolve to the scene file itself');
  return portable;
}

/** Preserves every relative dependency when a cinematic scene is derived into another directory. */
export function rebaseCinematicSceneDependencies(
  scene: CinematicScene,
  sourceScenePath: string,
  outputScenePath: string,
) {
  const sourceDirectory = dirname(resolve(sourceScenePath));
  const rebase = (path: string) =>
    portableCinematicDependencyPath(outputScenePath, resolve(sourceDirectory, path));
  const rebased = structuredClone(scene);
  for (const entity of rebased.entities) {
    entity.geometryPath = rebase(entity.geometryPath);
    if (entity.productionRigProfilePath)
      entity.productionRigProfilePath = rebase(entity.productionRigProfilePath);
    if (entity.productionCharacterBindingPath)
      entity.productionCharacterBindingPath = rebase(entity.productionCharacterBindingPath);
    if (entity.surfaceWaterFieldPath)
      entity.surfaceWaterFieldPath = rebase(entity.surfaceWaterFieldPath);
    if (entity.surfaceHistoryFieldPath)
      entity.surfaceHistoryFieldPath = rebase(entity.surfaceHistoryFieldPath);
    if (entity.surfaceWaterOpticalSurfacePath)
      entity.surfaceWaterOpticalSurfacePath = rebase(entity.surfaceWaterOpticalSurfacePath);
    if (entity.fixturePath) entity.fixturePath = rebase(entity.fixturePath);
    if (entity.motion) entity.motion.path = rebase(entity.motion.path);
  }
  if (rebased.lightingRigPath) rebased.lightingRigPath = rebase(rebased.lightingRigPath);
  if (rebased.finishProfilePath) rebased.finishProfilePath = rebase(rebased.finishProfilePath);
  for (const overlay of rebased.overlays) overlay.imagePath = rebase(overlay.imagePath);
  return cinematicSceneSchema.parse(rebased);
}
