import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderCinematicProbe, renderCinematicScene } from '../cinematic/blender.js';
import { saveCinematicScene } from '../cinematic/io.js';
import { cinematicSceneSchema } from '../cinematic/model.js';
import {
  createOldCityWallLanternFixture,
  createOldCityWallLanternGeometry,
} from '../fixtures/wall-lantern.js';
import { savePracticalFixture } from '../fixtures/io.js';
import { saveGeometry } from '../geometry/io.js';
import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import { validateGeometry } from '../geometry/model.js';
import { boxPart, capsuleBetween, mergeMeshParts } from '../geometry/primitives.js';
import { createOldCitySurfacePresets } from '../materials/old-city.js';

const material = (
  id: string,
  baseColor: [number, number, number, number],
  roughness: number,
  metallic = 0,
): GeometryMaterial => ({
  id,
  baseColor,
  roughness,
  metallic,
  emission: [0, 0, 0],
  emissionStrength: 0,
});

export function fixtureWitness(kind: 'facade' | 'warehouse'): GeometryAsset {
  const surfaces = new Map(
    createOldCitySurfacePresets().map((preset) => [preset.id, preset.material]),
  );
  const parts =
    kind === 'facade'
      ? [
          boxPart([-3, -0.09, -3.2], [3, 0, 0.28], 0, 'stone-floor'),
          boxPart([-3, 0, 0.04], [3, 3.6, 0.28], 0, 'plaster-wall'),
          boxPart([-1.05, 0, -0.01], [-0.86, 3.6, 0.08], 0, 'stone-trim'),
          boxPart([0.86, 0, -0.01], [1.05, 3.6, 0.08], 0, 'stone-trim'),
          boxPart([-1.05, 3.2, -0.01], [1.05, 3.42, 0.08], 0, 'stone-trim'),
        ]
      : [
          boxPart([-4.2, -0.12, -4], [4.2, 0, 1], 0, 'warehouse-floor'),
          boxPart([-4.2, 0, 0.42], [4.2, 4.2, 0.68], 0, 'warehouse-wall'),
          boxPart([-3.5, 0, 0.34], [-3.28, 4.2, 0.48], 0, 'steel'),
          boxPart([3.28, 0, 0.34], [3.5, 4.2, 0.48], 0, 'steel'),
          boxPart([-4.2, 3.45, 0.34], [4.2, 3.68, 0.48], 0, 'steel'),
          boxPart([1.35, 0, -0.35], [2.25, 0.68, 0.55], 0, 'crate'),
          boxPart([2.05, 0, -0.12], [2.72, 0.52, 0.55], 0, 'crate'),
        ];
  if (kind === 'warehouse') {
    const pipe = capsuleBetween([-2.8, 0.3, 0.22], [-2.8, 3.55, 0.22], 0.055, 0.055, 0, 0, 3, 12);
    pipe.materialId = 'steel';
    parts.push(pipe);
  }
  const asset = mergeMeshParts(
    `environment.fixture-${kind}-witness`,
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.practical-fixture-witness.v1',
      environmentClass: `${kind}-practical-fixture-witness`,
      verificationOnly: true,
    },
  );
  asset.materials =
    kind === 'facade'
      ? [
          {
            ...material('stone-floor', [0.18, 0.19, 0.2, 1], 0.62),
            surface: surfaces.get('limestone-trim'),
          },
          {
            ...material('plaster-wall', [0.12, 0.13, 0.14, 1], 0.78),
            surface: surfaces.get('rain-aged-plaster'),
          },
          {
            ...material('stone-trim', [0.26, 0.25, 0.23, 1], 0.64),
            surface: surfaces.get('limestone-trim'),
          },
        ]
      : [
          material('warehouse-floor', [0.075, 0.085, 0.095, 1], 0.48),
          {
            ...material('warehouse-wall', [0.13, 0.14, 0.15, 1], 0.82),
            surface: surfaces.get('rain-aged-plaster'),
          },
          material('steel', [0.035, 0.045, 0.055, 1], 0.31, 0.78),
          {
            ...material('crate', [0.13, 0.045, 0.014, 1], 0.66),
            surface: surfaces.get('weathered-wood'),
          },
        ];
  return asset;
}

export function fixtureProbeScene(
  id: string,
  witnessPath: string,
  geometryPath: string,
  fixturePath: string,
  kind: 'facade' | 'warehouse',
  entityId = 'portable-lantern',
  focusDepth = -0.4,
  focusHeight = 2.23,
  cameraDistanceMultiplier = 1,
  maximumScreenHeightPercentage = 38,
) {
  const mount: [number, number, number] = kind === 'facade' ? [0, 2.65, 0] : [-1.15, 2.7, 0.38];
  const scaledCamera = (
    position: [number, number, number],
    target: [number, number, number],
  ): [number, number, number] => [
    target[0] + (position[0] - target[0]) * cameraDistanceMultiplier,
    target[1] + (position[1] - target[1]) * cameraDistanceMultiplier,
    target[2] + (position[2] - target[2]) * cameraDistanceMultiplier,
  ];
  return cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: `scene.${id}`,
    durationSeconds: 0.5,
    fps: 24,
    resolution: { width: 540, height: 540, percentage: 100 },
    entities: [
      { id: 'witness-set', role: 'environment', geometryPath: witnessPath },
      {
        id: entityId,
        role: 'prop',
        geometryPath,
        fixturePath,
        transform: { position: mount, rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    ],
    camera: {
      keyframes:
        kind === 'facade'
          ? [
              {
                time: 0,
                position: scaledCamera([2.35, 2.45, -3.75], [0, focusHeight, focusDepth]),
                target: [0, focusHeight, focusDepth],
                lensMillimeters: 58,
              },
              {
                time: 0.25,
                position: scaledCamera([0.15, 2.22, -4.15], [0, focusHeight, focusDepth]),
                target: [0, focusHeight, focusDepth],
                lensMillimeters: 58,
              },
              {
                time: 0.5,
                position: scaledCamera([-2.05, 2.34, -3.55], [0, focusHeight, focusDepth]),
                target: [0, focusHeight, focusDepth],
                lensMillimeters: 58,
              },
            ]
          : [
              {
                time: 0,
                position: scaledCamera([2.55, 2.28, -3.75], [-0.9, focusHeight, focusDepth]),
                target: [-0.9, focusHeight, focusDepth],
                lensMillimeters: 52,
              },
              {
                time: 0.25,
                position: scaledCamera([0.25, 2.06, -3.15], [-1.15, focusHeight, focusDepth]),
                target: [-1.15, focusHeight, focusDepth],
                lensMillimeters: 58,
              },
              {
                time: 0.5,
                position: scaledCamera([-2.95, 2.18, -3.65], [-1.15, focusHeight, focusDepth]),
                target: [-1.15, focusHeight, focusDepth],
                lensMillimeters: 54,
              },
            ],
    },
    lights: [
      {
        id: 'restrained-cool-fill',
        type: 'area',
        position: kind === 'facade' ? [2.6, 4.2, -2.4] : [2.8, 4.4, -3.2],
        target: kind === 'facade' ? [0, 2.1, 0] : [-1, 1.8, 0],
        color: [0.22, 0.34, 0.62],
        energy: kind === 'facade' ? 96 : 235,
        sizeMeters: 3.2,
      },
    ],
    atmosphere: {
      worldColor: kind === 'facade' ? [0.009, 0.015, 0.026] : [0.006, 0.012, 0.022],
      fogDensity: kind === 'facade' ? 0.003 : 0.0015,
      fogColor: [0.08, 0.12, 0.18],
    },
    renderGates: [
      { id: 'fixture-visible', type: 'frame-visibility', maximumBlackPercentage: 72 },
      {
        id: 'fixture-highlight-detail',
        type: 'frame-overexposure',
        maximumWhitePercentage: 7,
      },
      {
        id: 'fixture-framing',
        type: 'subject-framing',
        entityId,
        minimumScreenHeightPercentage: kind === 'facade' ? 12 : 12,
        maximumScreenHeightPercentage,
        marginPercentage: 2,
      },
    ],
    landmarks: [
      {
        id: 'right-three-quarter',
        progress: 0,
        description: 'Bracket and glazing read from right',
      },
      {
        id: 'frontal',
        progress: 0.5,
        description: 'Fixture silhouette and local pool read frontally',
      },
      {
        id: 'left-three-quarter',
        progress: 1,
        description: 'Glancing glass and mount read from left',
      },
    ],
    metadata: {
      verificationPurpose: 'portable-practical-fixture-geometry-and-light-transfer',
      fixtureKind: kind,
    },
  });
}

export async function createPortableWallLanternAsset(outputDirectory: string) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const geometry = createOldCityWallLanternGeometry();
  const validation = validateGeometry(geometry);
  if (!validation.valid)
    throw new Error(
      `Wall lantern geometry failed: ${validation.issues.map((issue) => issue.code).join(', ')}`,
    );
  const geometryFile = await saveGeometry(join(output, 'geometry.json'), geometry);
  const fixtureFile = await savePracticalFixture(
    join(output, 'fixture.json'),
    createOldCityWallLanternFixture(),
  );
  await writeFile(
    join(output, 'validation.json'),
    `${JSON.stringify(validation, null, 2)}\n`,
    'utf8',
  );
  const probes = [];
  for (const kind of ['facade', 'warehouse'] as const) {
    const directory = join(output, 'verification', kind);
    await mkdir(directory, { recursive: true });
    const witnessFile = await saveGeometry(
      join(directory, 'witness-geometry.json'),
      fixtureWitness(kind),
    );
    const sceneFile = await saveCinematicScene(
      join(directory, 'scene.json'),
      fixtureProbeScene(`wall-lantern-${kind}-probe`, witnessFile, geometryFile, fixtureFile, kind),
    );
    probes.push({
      kind,
      sceneFile,
      render:
        kind === 'facade'
          ? await renderCinematicScene(sceneFile, directory)
          : await renderCinematicProbe(sceneFile, directory),
    });
  }
  const metadata = assetMetadataSchema.parse({
    schemaVersion: 1,
    id: geometry.id,
    version: '0.5.0',
    type: 'prop',
    title: 'Portable old-city wall lantern practical',
    description:
      'Project-owned wall-mounted lantern with separate 8 mm glazing, metal frame and bracket, candle/flame source, named mount, and renderer-independent local practical emitter.',
    status: 'validated',
    tags: ['lantern', 'wall-light', 'practical', 'old-city', 'portable-set-dressing'],
    capabilities: [
      'portable-geometry',
      'named-wall-mount',
      'physical-glazing',
      'local-practical-emitter',
      'inverse-square-falloff',
      'cross-environment-transfer',
      'seeded-temporal-flicker',
      'visible-source-emission-binding',
    ],
    source: {
      kind: 'procedural',
      generator: 'videoer.portable-wall-lantern.v5',
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
        role: 'geometry',
        path: 'geometry.json',
        mediaType: 'application/vnd.videoer.geometry+json',
      },
      {
        role: 'practical-fixture',
        path: 'fixture.json',
        mediaType: 'application/vnd.videoer.practical-fixture+json',
      },
      { role: 'validation', path: 'validation.json', mediaType: 'application/json' },
      {
        role: 'blender-source',
        path: 'verification/facade/wall-lantern-facade-probe.blend',
        mediaType: 'application/x-blender',
      },
      {
        role: 'temporal-preview',
        path: 'verification/facade/wall-lantern-facade-probe.mp4',
        mediaType: 'video/mp4',
      },
      {
        role: 'temporal-render-report',
        path: 'verification/facade/scene-render.json',
        mediaType: 'application/json',
      },
      {
        role: 'fixture-modulation-report',
        path: 'verification/facade/fixture-modulation-report.json',
        mediaType: 'application/json',
      },
      {
        role: 'transfer-blender-source',
        path: 'verification/warehouse/wall-lantern-warehouse-probe.blend',
        mediaType: 'application/x-blender',
      },
    ],
    compatibility: {
      coordinateSystem: 'right-handed-y-up-forward-negative-z-metres',
      renderers: ['blender-headless'],
      requires: [],
    },
    verification: {
      checks: [
        'geometry.topology',
        'fixture.geometry-binding',
        'fixture.mount-attachment',
        'fixture.local-emitter-schema',
        'fixture.inverse-square-falloff',
        'fixture.seeded-temporal-modulation',
        'fixture.visible-source-and-useful-light-shared-signal',
        'visual.facade-landmarks-generated-not-accepted',
        'visual.warehouse-transfer-generated-not-accepted',
      ],
      artifacts: [
        'verification/facade/contact-sheet.png',
        'verification/facade/scene-render.json',
        'verification/facade/wall-lantern-facade-probe.mp4',
        'verification/facade/fixture-modulation-report.json',
        'verification/warehouse/contact-sheet.png',
        'verification/warehouse/scene-probe.json',
      ],
      verifiedAt: new Date().toISOString(),
    },
  });
  const metadataFile = await writeHashedAssetMetadata(join(output, 'asset.yaml'), metadata);
  return { output, geometryFile, fixtureFile, metadataFile, validation, probes };
}
