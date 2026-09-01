import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { assetMetadataSchema, sha256File, writeHashedAssetMetadata } from '../assets/library.js';
import { renderCinematicScene } from '../cinematic/blender.js';
import { saveCinematicScene } from '../cinematic/io.js';
import { cinematicSceneSchema } from '../cinematic/model.js';
import { renderGeometryProbe } from '../geometry/blender.js';
import { loadGeometry, saveGeometry } from '../geometry/io.js';
import { createPulledBackHair } from '../hair/pulled-back.js';

export async function createPulledBackHairAsset(
  targetGeometryFile: string,
  outputDirectory: string,
) {
  const targetPath = resolve(targetGeometryFile);
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const target = await loadGeometry(targetPath);
  const created = createPulledBackHair(target);
  const definitionFile = join(output, 'hair.json');
  const geometryFile = await saveGeometry(join(output, 'geometry.json'), created.geometry);
  const validationFile = join(output, 'validation.json');
  await writeFile(definitionFile, `${JSON.stringify(created.definition, null, 2)}\n`, 'utf8');
  await writeFile(
    validationFile,
    `${JSON.stringify({ ...created.validation, headBone: created.headBone, ownedHeadVertices: created.ownedHeadVertices, targetSha256: await sha256File(targetPath) }, null, 2)}\n`,
    'utf8',
  );
  const isolated = await renderGeometryProbe(
    geometryFile,
    join(output, 'verification', 'isolated'),
  );
  const scene = cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: 'scene.pulled-back-hair-fit-probe',
    durationSeconds: 0.375,
    fps: 24,
    resolution: { width: 512, height: 512, percentage: 100 },
    entities: [
      { id: 'target-human', role: 'character', geometryPath: targetPath },
      { id: 'hair-style', role: 'character', geometryPath: geometryFile },
    ],
    camera: {
      keyframes: [
        { time: 0, position: [0.46, 1.64, -1.18], target: [0, 1.58, -0.03], lensMillimeters: 72 },
        { time: 0.125, position: [0, 1.68, -1.24], target: [0, 1.59, -0.02], lensMillimeters: 78 },
        {
          time: 0.25,
          position: [-0.48, 1.63, -1.16],
          target: [0, 1.57, -0.01],
          lensMillimeters: 72,
        },
        { time: 0.375, position: [0.18, 1.65, 1.2], target: [0, 1.58, 0.01], lensMillimeters: 74 },
      ],
    },
    lights: [
      {
        id: 'hair-key',
        type: 'area',
        position: [-1.2, 2.4, -1.4],
        target: [0, 1.58, 0],
        color: [0.72, 0.84, 1],
        energy: 210,
        sizeMeters: 1.2,
      },
      {
        id: 'hair-rim',
        type: 'area',
        position: [1.1, 2.0, 0.7],
        target: [0, 1.58, 0.04],
        color: [1, 0.46, 0.2],
        energy: 290,
        sizeMeters: 0.8,
      },
      {
        id: 'hair-fill',
        type: 'area',
        position: [0.4, 1.7, -0.9],
        target: [0, 1.57, 0],
        color: [0.9, 0.92, 1],
        energy: 42,
        sizeMeters: 1.4,
      },
    ],
    landmarks: [
      { id: 'three-quarter-right', progress: 0, description: 'Right hairline, crown, and bun fit' },
      {
        id: 'front',
        progress: 0.333333,
        description: 'Front hairline symmetry and face clearance',
      },
      {
        id: 'three-quarter-left',
        progress: 0.666667,
        description: 'Left hairline, crown, and bun fit',
      },
      { id: 'rear', progress: 1, description: 'Rear scalp continuity and low-bun integration' },
    ],
    metadata: {
      verificationPurpose: 'modular-hair-target-fit-and-material-response',
      sourceHair: created.definition.id,
    },
  });
  const sceneFile = await saveCinematicScene(
    join(output, 'verification', 'fitted', 'scene.json'),
    scene,
  );
  const fitted = await renderCinematicScene(sceneFile, join(output, 'verification', 'fitted'));
  const metadata = assetMetadataSchema.parse({
    schemaVersion: 1,
    id: created.definition.id,
    version: created.definition.version,
    type: 'hair',
    title: 'Pulled-back low bun',
    description:
      'Separable canonical-humanoid hair with dedicated continuous scalp topology, crown-to-nape strand-group cards, a surface-detailed low bun, and UV-directed anisotropic fiber response.',
    status: 'validated',
    tags: ['hair', 'pulled-back', 'low-bun', 'mesh-hair', 'canonical-humanoid'],
    capabilities: [
      'separable-hair-geometry',
      'canonical-head-anchor',
      'target-fit-profile',
      'dedicated-scalp-topology',
      'layered-flow-cards',
      'surface-ribbon-bun-detail',
      'anisotropic-material',
      'renderer-independent',
    ],
    source: {
      kind: 'procedural',
      generator: 'videoer.layered-mesh-hair.v7',
      sourceAsset: target.id,
      references: [],
      licence: {
        spdx: 'CC0-1.0',
        name: 'CC0-compatible procedural derivative',
        commercialUse: 'allowed',
        attributionRequired: false,
      },
      clearance: 'approved',
    },
    artifacts: [
      {
        role: 'definition',
        path: basename(definitionFile),
        mediaType: 'application/vnd.videoer.hair+json',
      },
      {
        role: 'geometry',
        path: basename(geometryFile),
        mediaType: 'application/vnd.videoer.geometry+json',
      },
      { role: 'validation', path: basename(validationFile), mediaType: 'application/json' },
      {
        role: 'isolated-turntable',
        path: 'verification/isolated/turntable.mp4',
        mediaType: 'video/mp4',
      },
      {
        role: 'fitted-preview',
        path: `verification/fitted/${basename(fitted.video)}`,
        mediaType: 'video/mp4',
      },
      {
        role: 'fitted-contact-sheet',
        path: 'verification/fitted/contact-sheet.png',
        mediaType: 'image/png',
      },
      {
        role: 'blender-source',
        path: `verification/fitted/${basename(fitted.blend)}`,
        mediaType: 'application/x-blender',
      },
    ],
    compatibility: {
      coordinateSystem: 'right-handed-y-up-forward-negative-z-metres',
      skeleton: 'canonical-humanoid-v1',
      renderers: ['three-3d', 'blender-headless'],
      requires: [],
    },
    verification: {
      checks: [
        'hair.geometry-schema',
        'hair.head-bone-ownership',
        'hair.target-fit-profile',
        'hair.separate-from-character-topology',
        'visual.fitted-canonical-views-generated-not-accepted',
        'visual.material-response-generated-not-accepted',
      ],
      artifacts: [
        'verification/isolated/contact-sheet.png',
        'verification/fitted/contact-sheet.png',
        'verification/fitted/scene-render.json',
      ],
      verifiedAt: new Date().toISOString(),
    },
  });
  const assetFile = await writeHashedAssetMetadata(join(output, 'asset.yaml'), metadata);
  return {
    output,
    definitionFile,
    geometryFile,
    validationFile,
    isolated,
    sceneFile,
    fitted,
    assetFile,
  };
}
