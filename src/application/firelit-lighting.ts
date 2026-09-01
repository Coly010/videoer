import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderCinematicScene } from '../cinematic/blender.js';
import { saveCinematicScene } from '../cinematic/io.js';
import { cinematicSceneSchema } from '../cinematic/model.js';
import { saveGeometry } from '../geometry/io.js';
import { createFirelitInteriorLightingRig } from '../lighting/firelit.js';
import { createContemporaryFireLoungeHost, createFirelitChamberHost } from '../lighting/hosts.js';
import { saveLightingRig } from '../lighting/io.js';
import { lightingTransferProbeSchema } from '../lighting/transfer-probe.js';
import { createInteriorLightingWitness } from '../lighting/witness.js';
import { createLightingTransferProbe } from './lighting-transfer.js';

function sourceLights(rig: ReturnType<typeof createFirelitInteriorLightingRig>) {
  return rig.lights.map(({ purpose, ...light }) => {
    void purpose;
    return {
      ...light,
      ...(light.visibleSourceRole
        ? {
            visibleSourceBinding: {
              entityId: 'firelit-chamber',
              materialId: 'hearth-embers',
            },
          }
        : {}),
    };
  });
}

export async function createFirelitInteriorLightingAsset(outputDirectory: string) {
  const output = resolve(outputDirectory);
  const sourceDirectory = join(output, 'verification', 'source', 'stone-chamber');
  const transferDirectory = join(output, 'verification', 'transfer', 'contemporary-lounge');
  await Promise.all([
    mkdir(sourceDirectory, { recursive: true }),
    mkdir(transferDirectory, { recursive: true }),
  ]);
  const rig = createFirelitInteriorLightingRig();
  const rigFile = await saveLightingRig(join(output, 'lighting-rig.json'), rig);
  const sourceHostFile = await saveGeometry(
    join(sourceDirectory, 'stone-chamber-host.json'),
    createFirelitChamberHost(),
  );
  const sourceWitnessFile = await saveGeometry(
    join(sourceDirectory, 'lighting-witness.json'),
    createInteriorLightingWitness(),
  );
  const scene = cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: 'scene.firelit-stone-chamber-probe',
    durationSeconds: 0.5,
    fps: 24,
    resolution: { width: 480, height: 480, percentage: 100 },
    entities: [
      { id: 'firelit-chamber', role: 'environment', geometryPath: sourceHostFile },
      {
        id: 'lighting-witness',
        role: 'prop',
        geometryPath: sourceWitnessFile,
        transform: { position: [1.72, 0.62, 2.02], rotation: [0, -0.18, 0], scale: [1, 1, 1] },
      },
    ],
    camera: {
      keyframes: [
        { time: 0, position: [5.35, 2.45, -5.85], target: [0.25, 1.25, 2.55], lensMillimeters: 42 },
        {
          time: 0.5,
          position: [-4.75, 2.38, -5.6],
          target: [0.15, 1.22, 2.52],
          lensMillimeters: 45,
        },
      ],
    },
    lights: sourceLights(rig),
    atmosphere: { worldColor: rig.worldColor, fogDensity: 0.005, rain: { enabled: false } },
    landmarks: [
      {
        id: 'firelit-start',
        progress: 0,
        description: 'Hearth source, correlated low key and cool separation establish the chamber',
      },
      {
        id: 'firelit-mid',
        progress: 0.5,
        description:
          'Fire signal changes intensity and colour while preserving material readability',
      },
      {
        id: 'firelit-end',
        progress: 1,
        description: 'Opposed view retains motivated fire direction, rim and cool background depth',
      },
    ],
    renderGates: [
      {
        id: 'firelit-source-frame-visible',
        type: 'frame-visibility',
        maximumBlackPercentage: 76,
        blackThreshold: 24,
      },
      {
        id: 'firelit-source-highlight-detail',
        type: 'frame-overexposure',
        maximumWhitePercentage: 6,
        whiteThreshold: 245,
      },
      {
        id: 'firelit-source-witness-tonal-balance',
        type: 'region-exposure',
        region: { x: 0.42, y: 0.2, width: 0.42, height: 0.66 },
        maximumBlackPercentage: 64,
        maximumWhitePercentage: 5,
        minimumMidtonePercentage: 28,
        blackThreshold: 24,
        whiteThreshold: 245,
      },
    ],
    metadata: {
      sourceLightingRig: rig.id,
      verificationPurpose: 'firelit-stone-chamber-source',
      witness: 'static-portrait-and-material-response-v1',
      visibleSourceBinding: 'primary-fire->firelit-chamber/hearth-embers',
      motionDependency: 'none',
    },
  });
  const sourceSceneFile = await saveCinematicScene(join(sourceDirectory, 'scene.json'), scene);
  const sourceRender = await renderCinematicScene(sourceSceneFile, sourceDirectory);

  await saveGeometry(
    join(transferDirectory, 'contemporary-lounge-host.json'),
    createContemporaryFireLoungeHost(),
  );
  const transferDefinition = lightingTransferProbeSchema.parse({
    schemaVersion: 1,
    id: 'lighting-probe.firelit-contemporary-lounge',
    sourceRigPath: '../../../lighting-rig.json',
    environmentGeometryPath: 'contemporary-lounge-host.json',
    visibleSourceBindings: {
      'primary-fire': { entityId: 'transfer-environment', materialId: 'hearth-embers' },
    },
    adaptation: {
      kind: 'lighting-rig-transform-v1',
      assetId: 'lighting.firelit-interior.contemporary-lounge-transfer',
      transform: { translation: [0, 0.08, 0], yawRadians: 0.04, uniformScale: 1 },
      energyScale: 0.9,
      purposeEnergyScale: { key: 1.04, fill: 1.08, rim: 0.92, practical: 0.94, environment: 1.15 },
      colorMultiply: [0.98, 0.98, 1],
      worldColor: [0.0025, 0.002, 0.0025],
      metadata: {
        context: 'unrelated-contemporary-fire-lounge-transfer',
        sourceCandidate: 'lighting.firelit-interior@0.1.0',
      },
    },
    witnessTransform: { position: [1.72, 0.54, 2.02], rotation: [0, -0.1, 0], scale: [1, 1, 1] },
    camera: {
      start: { position: [5.2, 2.5, -5.75], target: [0.2, 1.2, 2.52], lensMillimeters: 43 },
      end: { position: [-4.85, 2.42, -5.55], target: [0.15, 1.18, 2.5], lensMillimeters: 46 },
    },
    resolution: { width: 480, height: 480, percentage: 100 },
    exposureRegion: {
      x: 0.4,
      y: 0.2,
      width: 0.44,
      height: 0.66,
      maximumBlackPercentage: 64,
      maximumWhitePercentage: 5,
      minimumMidtonePercentage: 28,
    },
    metadata: {
      campaignClass: 'temporal-lighting-transfer-conformance',
      environmentFamily: 'contemporary-fire-lounge',
      sourceEnvironmentFamily: 'historic-stone-chamber',
    },
  });
  const transferDefinitionFile = join(transferDirectory, 'transfer-definition.json');
  await writeFile(
    transferDefinitionFile,
    `${JSON.stringify(transferDefinition, null, 2)}\n`,
    'utf8',
  );
  const transferRender = await createLightingTransferProbe(
    transferDefinitionFile,
    transferDirectory,
  );

  const metadata = assetMetadataSchema.parse({
    schemaVersion: 1,
    id: rig.id,
    version: '0.1.0',
    type: 'lighting',
    title: 'Firelit interior lighting rig',
    description:
      'Reusable firelit interior rig with one correlated seeded signal driving the visible hearth, low warm key, ground bounce and edge rim against restrained cool environmental separation.',
    status: 'validated',
    tags: ['lighting-rig', 'firelight', 'warm-interior', 'temporal-lighting', 'cinematic'],
    capabilities: [
      'reusable-rig',
      'coherent-exposure',
      'correlated-seeded-fire-signal',
      'visible-source-synchronization',
      'warm-fire-cool-environment-separation',
      'background-medium-shot-lighting',
      'renderer-independent',
    ],
    source: {
      kind: 'procedural',
      generator: 'videoer.firelit-interior-lighting.v1',
      references: [],
      licence: {
        spdx: 'LicenseRef-Videoer-Project',
        name: 'Videoer project-owned production asset',
        commercialUse: 'allowed',
        attributionRequired: false,
      },
      clearance: 'approved',
    },
    artifacts: [
      {
        role: 'lighting-rig',
        path: basename(rigFile),
        mediaType: 'application/vnd.videoer.lighting+json',
      },
      {
        role: 'source-host',
        path: 'verification/source/stone-chamber/stone-chamber-host.json',
        mediaType: 'application/vnd.videoer.geometry+json',
      },
      {
        role: 'source-witness',
        path: 'verification/source/stone-chamber/lighting-witness.json',
        mediaType: 'application/vnd.videoer.geometry+json',
      },
      {
        role: 'source-preview',
        path: `verification/source/stone-chamber/${basename(sourceRender.video)}`,
        mediaType: 'video/mp4',
      },
      {
        role: 'source-blender',
        path: `verification/source/stone-chamber/${basename(sourceRender.blend)}`,
        mediaType: 'application/x-blender',
      },
      {
        role: 'source-lighting-modulation-report',
        path: 'verification/source/stone-chamber/lighting-modulation-report.json',
        mediaType: 'application/json',
      },
      {
        role: 'transfer-host',
        path: 'verification/transfer/contemporary-lounge/contemporary-lounge-host.json',
        mediaType: 'application/vnd.videoer.geometry+json',
      },
    ],
    compatibility: {
      coordinateSystem: 'right-handed-y-up-forward-negative-z-metres',
      renderers: ['blender-headless'],
      requires: [],
    },
    verification: {
      checks: [
        'lighting.reusable-rig-schema',
        'lighting.agx-coherent-exposure',
        'lighting.firelit-source-frame-visible',
        'lighting.firelit-source-highlight-detail',
        'lighting.firelit-source-witness-tonal-balance',
        'lighting.correlated-temporal-signal-generated',
        'lighting.visible-source-shared-signal-generated',
        'lighting.bounded-unrelated-lounge-transfer-generated',
        'visual.generated-not-accepted',
      ],
      artifacts: [
        'verification/source/stone-chamber/contact-sheet.png',
        'verification/source/stone-chamber/scene-render.json',
        'verification/source/stone-chamber/lighting-modulation-report.json',
        'verification/transfer/contemporary-lounge/contact-sheet.png',
        'verification/transfer/contemporary-lounge/scene-render.json',
        'verification/transfer/contemporary-lounge/lighting-adaptation-report.json',
        'verification/transfer/contemporary-lounge/lighting-modulation-report.json',
      ],
      verifiedAt: new Date().toISOString(),
    },
  });
  const assetFile = await writeHashedAssetMetadata(join(output, 'asset.yaml'), metadata);
  return { output, rigFile, sourceSceneFile, sourceRender, transferRender, assetFile };
}
