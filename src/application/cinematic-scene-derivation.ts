import { resolve } from 'node:path';
import { sha256File } from '../assets/library.js';
import {
  loadCinematicScene,
  portableCinematicDependencyPath,
  rebaseCinematicSceneDependencies,
  saveCinematicScene,
} from '../cinematic/io.js';
import { loadGeometry } from '../geometry/io.js';

export async function rebindCinematicEntityGeometry(options: {
  sourceScenePath: string;
  entityId: string;
  geometryPath: string;
  outputScenePath: string;
  sceneId: string;
}) {
  const sourceScenePath = resolve(options.sourceScenePath);
  const geometryPath = resolve(options.geometryPath);
  const outputScenePath = resolve(options.outputScenePath);
  const loadedScene = await loadCinematicScene(sourceScenePath);
  const scene = rebaseCinematicSceneDependencies(loadedScene, sourceScenePath, outputScenePath);
  const matches = scene.entities.filter((entity) => entity.id === options.entityId);
  if (matches.length !== 1)
    throw new Error(
      `Cinematic scene geometry rebind requires exactly one entity '${options.entityId}'; found ${matches.length}`,
    );
  const entity = matches[0]!;
  if (
    entity.surfaceWaterFieldPath ||
    entity.surfaceWaterReceiverAppearancePath ||
    entity.surfaceHistoryFieldPath ||
    entity.surfaceWaterOpticalSurfacePath
  )
    throw new Error(
      `Cinematic entity '${entity.id}' has receiver-bound water/history evidence; use the exact surface-water receiver rebind operation`,
    );
  const geometry = await loadGeometry(geometryPath);
  entity.geometryPath = portableCinematicDependencyPath(outputScenePath, geometryPath);
  scene.id = options.sceneId;
  scene.metadata = {
    ...scene.metadata,
    derivationGenerator: 'videoer.cinematic-entity-geometry-rebind.v1',
    sourceSceneId: loadedScene.id,
    sourceSceneSha256: await sha256File(sourceScenePath),
    reboundEntityId: entity.id,
    reboundGeometryId: geometry.id,
    reboundGeometrySha256: await sha256File(geometryPath),
  };
  const path = await saveCinematicScene(outputScenePath, scene);
  return { path, scene, entityId: entity.id, geometryId: geometry.id };
}
