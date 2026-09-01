import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderCinematicScene } from '../cinematic/blender.js';
import { saveCinematicScene } from '../cinematic/io.js';
import { cinematicSceneSchema } from '../cinematic/model.js';
import {
  cinematicLights,
  createDuskExteriorLightingRig,
  createWarmInteriorLightingRig,
} from '../lighting/bookshop.js';
import { saveLightingRig } from '../lighting/io.js';
import type { LightingRig } from '../lighting/model.js';
import { createInteriorLightingWitness } from '../lighting/witness.js';
import { saveGeometry } from '../geometry/io.js';

async function buildRigAsset(
  rig: LightingRig,
  environmentGeometry: string,
  characterGeometry: string,
  outputDirectory: string,
  kind: 'exterior' | 'interior',
) {
  const output = resolve(outputDirectory);
  const verification = join(output, 'verification');
  await mkdir(verification, { recursive: true });
  const rigFile = await saveLightingRig(join(output, 'lighting-rig.json'), rig);
  const interior = kind === 'interior';
  // Keep the parameter for CLI compatibility with earlier invocations, but do
  // not let an unfinished character or walk become a lighting prerequisite.
  void characterGeometry;
  const witnessFile = interior
    ? await saveGeometry(
        join(verification, 'interior-lighting-witness.json'),
        createInteriorLightingWitness(),
      )
    : undefined;
  const scene = cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: `scene.${kind}-lighting-probe`,
    durationSeconds: 12 / 24,
    fps: 24,
    resolution: { width: 360, height: 640, percentage: 100 },
    entities: [
      { id: 'bookshop-set', role: 'environment', geometryPath: resolve(environmentGeometry) },
      ...(interior
        ? [
            {
              id: 'interior-lighting-witness',
              role: 'prop' as const,
              geometryPath: witnessFile!,
              transform: { position: [0.45, 0, 2.4], rotation: [0, Math.PI, 0], scale: [1, 1, 1] },
            },
          ]
        : []),
    ],
    camera: {
      keyframes: interior
        ? [
            {
              time: 0,
              position: [-0.95, 1.5, 4.2],
              target: [0.45, 0.88, 2.42],
              lensMillimeters: 38,
            },
            {
              time: 12 / 24,
              position: [-0.83, 1.5, 4.02],
              target: [0.45, 0.9, 2.45],
              lensMillimeters: 42,
            },
          ]
        : [
            {
              time: 0,
              position: [7.8, 3.25, -2.7],
              target: [0.15, 1.5, -0.72],
              lensMillimeters: 48,
            },
            {
              time: 12 / 24,
              position: [7.45, 3.18, -2.68],
              target: [-0.25, 1.47, -0.67],
              lensMillimeters: 50,
            },
          ],
    },
    lights: cinematicLights(rig),
    atmosphere: {
      worldColor: rig.worldColor,
      fogDensity: interior ? 0.004 : 0.002,
      rain: { enabled: false },
    },
    landmarks: [
      {
        id: 'exposure-start',
        progress: 0,
        description: 'Rig establishes controlled exposure and color contrast',
      },
      {
        id: 'exposure-mid',
        progress: 0.5,
        description: interior
          ? 'Warm portrait key remains readable against cool fill on the static material witness'
          : 'Warm practicals separate from cool dusk key',
      },
      {
        id: 'exposure-end',
        progress: 1,
        description: 'Exposure remains coherent through camera movement',
      },
    ],
    renderGates: [
      {
        id: `${kind}-frame-visible`,
        type: 'frame-visibility',
        maximumBlackPercentage: interior ? 78 : 68,
        blackThreshold: 28,
      },
      {
        id: `${kind}-highlight-detail`,
        type: 'frame-overexposure',
        maximumWhitePercentage: interior ? 12 : 9,
        whiteThreshold: 245,
      },
      {
        id: `${kind}-regional-tonal-balance`,
        type: 'region-exposure',
        region: interior
          ? { x: 0.18, y: 0.14, width: 0.64, height: 0.68 }
          : { x: 0.02, y: 0.04, width: 0.7, height: 0.52 },
        maximumBlackPercentage: interior ? 55 : 48,
        maximumWhitePercentage: interior ? 10 : 7,
        minimumMidtonePercentage: interior ? 38 : 45,
        blackThreshold: 28,
        whiteThreshold: 245,
      },
    ],
    metadata: {
      sourceLightingRig: rig.id,
      verificationPurpose: kind,
      ...(interior
        ? { witness: 'static-portrait-and-material-response-v1', motionDependency: 'none' }
        : {}),
    },
  });
  const sceneFile = await saveCinematicScene(join(verification, 'scene.json'), scene);
  const probe = await renderCinematicScene(sceneFile, verification);
  const capabilities = interior
    ? ['reusable-rig', 'face-key', 'coherent-exposure']
    : ['reusable-rig', 'coherent-exposure'];
  const metadata = assetMetadataSchema.parse({
    schemaVersion: 1,
    id: rig.id,
    version: '0.1.0',
    type: 'lighting',
    title: interior ? 'Warm bookshop interior lighting rig' : 'Overcast dusk exterior lighting rig',
    description: interior
      ? 'Reusable warm bookshop interior rig with a readable face key, cool window fill, shelf rim, and coherent AgX exposure.'
      : 'Reusable overcast dusk exterior rig with cool environmental key, warm bookshop practicals, threshold rim, and coherent AgX exposure.',
    status: 'validated',
    tags: interior
      ? ['lighting-rig', 'warm-interior', 'cool-fill']
      : ['lighting-rig', 'dusk', 'warm-practicals'],
    capabilities,
    source: {
      kind: 'procedural',
      generator: interior ? 'videoer.bookshop-lighting-rig.v4' : 'videoer.bookshop-lighting-rig.v3',
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
        path: 'lighting-rig.json',
        mediaType: 'application/vnd.videoer.lighting+json',
      },
      { role: 'preview', path: `verification/${kind}-lighting-probe.mp4`, mediaType: 'video/mp4' },
      {
        role: 'blender-source',
        path: `verification/${kind}-lighting-probe.blend`,
        mediaType: 'application/x-blender',
      },
      ...(interior
        ? [
            {
              role: 'verification-lighting-witness',
              path: 'verification/interior-lighting-witness.json',
              mediaType: 'application/vnd.videoer.geometry+json',
            },
          ]
        : []),
    ],
    compatibility: {
      coordinateSystem: 'right-handed-y-up-forward-negative-z-metres',
      renderers: ['blender-headless'],
      requires: [{ id: 'environment.old-city-bookshop', version: '0.2.1' }],
    },
    verification: {
      checks: [
        'lighting.reusable-rig-schema',
        'lighting.agx-coherent-exposure',
        `lighting.${kind}-frame-visible`,
        `lighting.${kind}-highlight-detail`,
        `lighting.${kind}-regional-tonal-balance`,
        interior
          ? 'lighting.static-portrait-material-witness'
          : 'lighting.warm-practical-cool-dusk-separation',
        'visual.camera-movement-exposure-continuity',
        'visual.generated-not-accepted',
      ],
      artifacts: [
        'verification/contact-sheet.png',
        `verification/${kind}-lighting-probe.mp4`,
        'verification/scene-render.json',
      ],
      verifiedAt: new Date().toISOString(),
    },
  });
  await writeHashedAssetMetadata(join(output, 'asset.yaml'), metadata);
  return { output, rigFile, sceneFile, probe };
}

export async function createBookshopLightingAssets(
  environmentGeometry: string,
  characterGeometry: string,
  outputRoot: string,
  only?: 'exterior' | 'interior',
) {
  const root = resolve(outputRoot);
  const exterior =
    only === 'interior'
      ? undefined
      : await buildRigAsset(
          createDuskExteriorLightingRig(),
          environmentGeometry,
          characterGeometry,
          join(root, 'dusk-exterior'),
          'exterior',
        );
  const interior =
    only === 'exterior'
      ? undefined
      : await buildRigAsset(
          createWarmInteriorLightingRig(),
          environmentGeometry,
          characterGeometry,
          join(root, 'warm-interior'),
          'interior',
        );
  return { root, exterior, interior };
}
