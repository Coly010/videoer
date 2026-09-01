import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { renderCinematicScene } from '../cinematic/blender.js';
import { saveCinematicScene } from '../cinematic/io.js';
import { cinematicSceneSchema } from '../cinematic/model.js';
import { saveGeometry } from '../geometry/io.js';
import { adaptLightingRig, verifyLightingRigAdaptation } from '../lighting/adaptation.js';
import { loadLightingRig, saveLightingRig } from '../lighting/io.js';
import { lightingTransferProbeSchema } from '../lighting/transfer-probe.js';
import { createInteriorLightingWitness } from '../lighting/witness.js';

export async function createLightingTransferProbe(definitionPath: string, outputDirectory: string) {
  const definitionFile = resolve(definitionPath);
  const definition = lightingTransferProbeSchema.parse(
    JSON.parse(await readFile(definitionFile, 'utf8')),
  );
  const baseDirectory = dirname(definitionFile);
  const sourceRigFile = resolve(baseDirectory, definition.sourceRigPath);
  const sourceRig = await loadLightingRig(sourceRigFile);
  const adaptedRig = adaptLightingRig(sourceRig, definition.adaptation);
  const adaptationReport = verifyLightingRigAdaptation(
    sourceRig,
    adaptedRig,
    definition.adaptation,
  );
  if (!adaptationReport.valid)
    throw new Error(`Lighting transfer adaptation failed: ${adaptationReport.issues.join('; ')}`);
  const output = resolve(outputDirectory);
  const witnessFile = await saveGeometry(
    join(output, 'interior-lighting-witness.json'),
    createInteriorLightingWitness(),
  );
  const adaptedRigFile = await saveLightingRig(
    join(output, 'adapted-lighting-rig.json'),
    adaptedRig,
    { environmentSourceRigPath: sourceRigFile },
  );
  const reportFile = join(output, 'lighting-adaptation-report.json');
  await writeFile(reportFile, `${JSON.stringify(adaptationReport, null, 2)}\n`, 'utf8');
  const lights = adaptedRig.lights.map(({ purpose, ...light }) => {
    void purpose;
    const binding = light.visibleSourceRole
      ? definition.visibleSourceBindings[light.visibleSourceRole]
      : undefined;
    if (light.visibleSourceRole && !binding)
      throw new Error(`Transfer probe lacks visible-source binding '${light.visibleSourceRole}'`);
    return { ...light, ...(binding ? { visibleSourceBinding: binding } : {}) };
  });
  const scene = cinematicSceneSchema.parse({
    schemaVersion: 2,
    id: `scene.${definition.id.replace(/^lighting-probe\./u, '')}`,
    durationSeconds: 0.5,
    fps: 24,
    resolution: definition.resolution,
    ...(definition.renderProfile ? { renderProfile: definition.renderProfile } : {}),
    entities: [
      {
        id: 'transfer-environment',
        role: 'environment',
        geometryPath: resolve(baseDirectory, definition.environmentGeometryPath),
      },
      {
        id: 'interior-lighting-witness',
        role: 'prop',
        geometryPath: witnessFile,
        transform: definition.witnessTransform,
      },
    ],
    camera: {
      keyframes: [
        { time: 0, ...definition.camera.start },
        { time: 0.5, ...definition.camera.end },
      ],
    },
    lightingRigPath: 'adapted-lighting-rig.json',
    lights,
    atmosphere: {
      worldColor: adaptedRig.worldColor,
      fogDensity: definition.fogDensity,
      rain: { enabled: false },
    },
    landmarks: [
      {
        id: 'transfer-start',
        progress: 0,
        description: 'Transferred rig establishes the unrelated environment and witness',
      },
      {
        id: 'transfer-mid',
        progress: 0.5,
        description: 'Key, fill, rim, and material response remain legible during camera movement',
      },
      {
        id: 'transfer-end',
        progress: 1,
        description: 'Transferred exposure and material separation remain coherent',
      },
    ],
    renderGates: [
      {
        id: 'transfer-frame-visible',
        type: 'frame-visibility',
        maximumBlackPercentage: 72,
        blackThreshold: 28,
      },
      {
        id: 'transfer-highlight-detail',
        type: 'frame-overexposure',
        maximumWhitePercentage: 10,
        whiteThreshold: 245,
      },
      {
        id: 'transfer-witness-tonal-balance',
        type: 'region-exposure',
        region: {
          x: definition.exposureRegion.x,
          y: definition.exposureRegion.y,
          width: definition.exposureRegion.width,
          height: definition.exposureRegion.height,
        },
        maximumBlackPercentage: definition.exposureRegion.maximumBlackPercentage,
        maximumWhitePercentage: definition.exposureRegion.maximumWhitePercentage,
        minimumMidtonePercentage: definition.exposureRegion.minimumMidtonePercentage,
        blackThreshold: 28,
        whiteThreshold: 245,
      },
      ...(definition.minimumSpatialColorVariationEntropy === undefined
        ? []
        : [
            {
              id: 'transfer-spatial-color-variation',
              type: 'region-spatial-color-variation' as const,
              region: {
                x: definition.exposureRegion.x,
                y: definition.exposureRegion.y,
                width: definition.exposureRegion.width,
                height: definition.exposureRegion.height,
              },
              minimumMeanNormalizedColorEntropy: definition.minimumSpatialColorVariationEntropy,
            },
          ]),
    ],
    metadata: {
      ...definition.metadata,
      sourceLightingRig: sourceRig.id,
      adaptedLightingRig: adaptedRig.id,
      transferProbe: definition.id,
      motionDependency: 'none',
    },
  });
  const sceneFile = await saveCinematicScene(join(output, 'scene.json'), scene);
  const render = await renderCinematicScene(sceneFile, output);
  return {
    output,
    definitionFile,
    sourceRig: sourceRig.id,
    adaptedRig: adaptedRig.id,
    adaptedRigFile,
    adaptationReport: reportFile,
    sceneFile,
    render,
  };
}
