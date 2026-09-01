import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderCinematicScene } from '../cinematic/blender.js';
import { saveCinematicScene } from '../cinematic/io.js';
import { cinematicSceneSchema } from '../cinematic/model.js';
import { saveGeometry } from '../geometry/io.js';
import { createContemporaryRooftopHost, createMoonlitCourtyardHost } from '../lighting/hosts.js';
import { saveLightingRig } from '../lighting/io.js';
import { createMoonlitExteriorLightingRig } from '../lighting/moonlit.js';
import { lightingTransferProbeSchema } from '../lighting/transfer-probe.js';
import { createInteriorLightingWitness } from '../lighting/witness.js';
import { createLightingTransferProbe } from './lighting-transfer.js';

function withoutPurpose(rig: ReturnType<typeof createMoonlitExteriorLightingRig>) {
  return rig.lights.map(({ purpose, ...light }) => {
    void purpose;
    return light;
  });
}

export async function createMoonlitExteriorLightingAsset(outputDirectory: string) {
  const output = resolve(outputDirectory);
  const sourceDirectory = join(output, 'verification', 'source', 'courtyard');
  const transferDirectory = join(output, 'verification', 'transfer', 'rooftop');
  await Promise.all([
    mkdir(sourceDirectory, { recursive: true }),
    mkdir(transferDirectory, { recursive: true }),
  ]);

  const rig = createMoonlitExteriorLightingRig();
  const rigFile = await saveLightingRig(join(output, 'lighting-rig.json'), rig);
  const sourceHostFile = await saveGeometry(
    join(sourceDirectory, 'courtyard-host.json'),
    createMoonlitCourtyardHost(),
  );
  const sourceWitnessFile = await saveGeometry(
    join(sourceDirectory, 'lighting-witness.json'),
    createInteriorLightingWitness(),
  );
  const sourceScene = cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: 'scene.moonlit-courtyard-lighting-probe',
    durationSeconds: 0.5,
    fps: 24,
    resolution: { width: 480, height: 480, percentage: 100 },
    entities: [
      { id: 'historic-courtyard', role: 'environment', geometryPath: sourceHostFile },
      {
        id: 'lighting-witness',
        role: 'prop',
        geometryPath: sourceWitnessFile,
        transform: { position: [0, 0.68, 1.18], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    ],
    camera: {
      keyframes: [
        { time: 0, position: [5.7, 2.55, -6.9], target: [0, 1.38, 1.3], lensMillimeters: 43 },
        {
          time: 0.5,
          position: [-5.15, 2.42, -6.65],
          target: [0.1, 1.34, 1.35],
          lensMillimeters: 46,
        },
      ],
    },
    lights: withoutPurpose(rig),
    atmosphere: { worldColor: rig.worldColor, fogDensity: 0.0035, rain: { enabled: false } },
    landmarks: [
      {
        id: 'courtyard-start',
        progress: 0,
        description: 'Cool moon key models courtyard architecture and the static material witness',
      },
      {
        id: 'courtyard-mid',
        progress: 0.5,
        description:
          'Warm aperture, cool fill, rim, and wet-stone response remain spatially distinct',
      },
      {
        id: 'courtyard-end',
        progress: 1,
        description: 'Directional moonlight remains coherent from the opposed camera angle',
      },
    ],
    renderGates: [
      {
        id: 'moonlit-source-frame-visible',
        type: 'frame-visibility',
        maximumBlackPercentage: 74,
        blackThreshold: 24,
      },
      {
        id: 'moonlit-source-highlight-detail',
        type: 'frame-overexposure',
        maximumWhitePercentage: 6,
        whiteThreshold: 245,
      },
      {
        id: 'moonlit-source-witness-tonal-balance',
        type: 'region-exposure',
        region: { x: 0.28, y: 0.22, width: 0.44, height: 0.62 },
        maximumBlackPercentage: 62,
        maximumWhitePercentage: 5,
        minimumMidtonePercentage: 28,
        blackThreshold: 24,
        whiteThreshold: 245,
      },
    ],
    metadata: {
      sourceLightingRig: rig.id,
      verificationPurpose: 'moonlit-historic-courtyard-source',
      witness: 'static-portrait-and-material-response-v1',
      motionDependency: 'none',
    },
  });
  const sourceSceneFile = await saveCinematicScene(
    join(sourceDirectory, 'scene.json'),
    sourceScene,
  );
  const sourceRender = await renderCinematicScene(sourceSceneFile, sourceDirectory);

  const transferHostFile = await saveGeometry(
    join(transferDirectory, 'rooftop-host.json'),
    createContemporaryRooftopHost(),
  );
  const transferDefinition = lightingTransferProbeSchema.parse({
    schemaVersion: 1,
    id: 'lighting-probe.moonlit-contemporary-rooftop',
    sourceRigPath: '../../../lighting-rig.json',
    environmentGeometryPath: 'rooftop-host.json',
    adaptation: {
      kind: 'lighting-rig-transform-v1',
      assetId: 'lighting.moonlit-exterior.rooftop-transfer',
      transform: { translation: [0, 0.75, 0.2], yawRadians: 0.12, uniformScale: 1 },
      energyScale: 0.94,
      purposeEnergyScale: { key: 1, fill: 1.12, rim: 0.92, practical: 0.88, environment: 1.08 },
      colorMultiply: [0.94, 0.98, 1],
      worldColor: [0.001, 0.003, 0.01],
      metadata: {
        context: 'unrelated-contemporary-rooftop-transfer',
        sourceCandidate: 'lighting.moonlit-exterior@0.1.0',
      },
    },
    witnessTransform: { position: [0, 0.84, 1], rotation: [0, 0, 0], scale: [1, 1, 1] },
    camera: {
      start: { position: [5.2, 2.8, -6.5], target: [0, 1.52, 1.05], lensMillimeters: 45 },
      end: { position: [-4.9, 2.65, -6.25], target: [0, 1.5, 1.1], lensMillimeters: 47 },
    },
    resolution: { width: 480, height: 480, percentage: 100 },
    exposureRegion: {
      x: 0.28,
      y: 0.2,
      width: 0.44,
      height: 0.64,
      maximumBlackPercentage: 62,
      maximumWhitePercentage: 5,
      minimumMidtonePercentage: 28,
    },
    metadata: {
      campaignClass: 'lighting-transfer-conformance',
      environmentFamily: 'contemporary-rooftop',
      sourceEnvironmentFamily: 'historic-courtyard',
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
    title: 'Moonlit exterior lighting rig',
    description:
      'Reusable moonlit exterior rig with directional cool key, broad night-sky fill, silver edge separation, restrained ground bounce, and a motivated warm aperture.',
    status: 'validated',
    tags: ['lighting-rig', 'moonlight', 'night-exterior', 'warm-practical', 'cinematic'],
    capabilities: [
      'reusable-rig',
      'coherent-exposure',
      'directional-moon-key',
      'night-sky-fill',
      'warm-aperture-depth-cue',
      'background-medium-shot-lighting',
      'renderer-independent',
    ],
    source: {
      kind: 'procedural',
      generator: 'videoer.moonlit-exterior-lighting.v1',
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
        path: 'verification/source/courtyard/courtyard-host.json',
        mediaType: 'application/vnd.videoer.geometry+json',
      },
      {
        role: 'source-witness',
        path: 'verification/source/courtyard/lighting-witness.json',
        mediaType: 'application/vnd.videoer.geometry+json',
      },
      {
        role: 'source-preview',
        path: `verification/source/courtyard/${basename(sourceRender.video)}`,
        mediaType: 'video/mp4',
      },
      {
        role: 'source-blender',
        path: `verification/source/courtyard/${basename(sourceRender.blend)}`,
        mediaType: 'application/x-blender',
      },
      {
        role: 'transfer-host',
        path: 'verification/transfer/rooftop/rooftop-host.json',
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
        'lighting.moonlit-source-frame-visible',
        'lighting.moonlit-source-highlight-detail',
        'lighting.moonlit-source-witness-tonal-balance',
        'lighting.bounded-unrelated-rooftop-transfer-generated',
        'visual.generated-not-accepted',
      ],
      artifacts: [
        'verification/source/courtyard/contact-sheet.png',
        'verification/source/courtyard/scene-render.json',
        'verification/transfer/rooftop/contact-sheet.png',
        'verification/transfer/rooftop/scene-render.json',
        'verification/transfer/rooftop/lighting-adaptation-report.json',
      ],
      verifiedAt: new Date().toISOString(),
    },
  });
  const assetFile = await writeHashedAssetMetadata(join(output, 'asset.yaml'), metadata);
  return {
    output,
    rigFile,
    sourceSceneFile,
    sourceRender,
    transferDefinitionFile,
    transferRender,
    assetFile,
    transferHostFile,
  };
}
