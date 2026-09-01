import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderCinematicScene } from '../cinematic/blender.js';
import { saveCinematicScene } from '../cinematic/io.js';
import { cinematicSceneSchema } from '../cinematic/model.js';
import {
  createStreetStorageFamily,
  layoutDressingFamily,
  type DressingInstance,
} from '../environments/dressing-family.js';
import { saveGeometry } from '../geometry/io.js';
import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import { validateGeometry } from '../geometry/model.js';
import { boxPart, mergeMeshParts } from '../geometry/primitives.js';
import { createOldCitySurfacePresets } from '../materials/old-city.js';
import { createSlattedStorageCrate, createStorageBarrel } from '../props/street-storage.js';

function material(
  id: string,
  baseColor: [number, number, number, number],
  roughness: number,
  metallic = 0,
): GeometryMaterial {
  return {
    id,
    baseColor,
    roughness,
    metallic,
    emission: [0, 0, 0],
    emissionStrength: 0,
  };
}

function dressingWitness(kind: 'old-city-alley' | 'contemporary-loading-dock'): GeometryAsset {
  const oldCity = new Map(
    createOldCitySurfacePresets().map((preset) => [preset.id, preset.material]),
  );
  const parts =
    kind === 'old-city-alley'
      ? [
          boxPart([-10, -0.16, -9], [10, 0, 6], 0, 'stone-floor'),
          boxPart([-10, 0, 2.8], [10, 7.2, 3.05], 0, 'plaster'),
          boxPart([-10, 0, -9], [-9.7, 7, 3.05], 0, 'brick'),
          boxPart([9.7, 0, -9], [10, 7, 3.05], 0, 'brick'),
          boxPart([-1.3, 0, 2.53], [1.3, 2.75, 2.82], 0, 'dark-opening'),
          boxPart([-1.5, 2.7, 2.48], [1.5, 3.02, 2.84], 0, 'wood-trim'),
        ]
      : [
          boxPart([-11, -0.18, -10], [11, 0, 7], 0, 'concrete-floor'),
          boxPart([-11, 0, 3.2], [11, 8, 3.48], 0, 'concrete-wall'),
          boxPart([-2.25, 0.18, 2.86], [2.25, 3.75, 3.18], 0, 'loading-door'),
          boxPart([-2.55, 0, 2.72], [-2.25, 4.25, 3.22], 0, 'painted-steel'),
          boxPart([2.25, 0, 2.72], [2.55, 4.25, 3.22], 0, 'painted-steel'),
          boxPart([-2.55, 3.75, 2.72], [2.55, 4.08, 3.22], 0, 'painted-steel'),
          boxPart([-10.4, 0, -9.2], [-10, 7.2, 3.1], 0, 'painted-steel'),
          boxPart([10, 0, -9.2], [10.4, 7.2, 3.1], 0, 'painted-steel'),
        ];
  const geometry = mergeMeshParts(
    `environment.${kind}-dressing-witness`,
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.environment-dressing-transfer-witness.v1',
      environmentClass: kind,
      verificationOnly: true,
    },
  );
  geometry.materials =
    kind === 'old-city-alley'
      ? [
          {
            ...material('stone-floor', [0.13, 0.14, 0.15, 1], 0.58),
            surface: oldCity.get('limestone-trim'),
          },
          {
            ...material('plaster', [0.16, 0.16, 0.15, 1], 0.72),
            surface: oldCity.get('rain-aged-plaster'),
          },
          {
            ...material('brick', [0.08, 0.025, 0.012, 1], 0.7),
            surface: oldCity.get('dark-brick'),
          },
          {
            ...material('wood-trim', [0.09, 0.025, 0.008, 1], 0.62),
            surface: oldCity.get('weathered-wood'),
          },
          material('dark-opening', [0.006, 0.008, 0.012, 1], 0.95),
        ]
      : [
          material('concrete-floor', [0.12, 0.13, 0.14, 1], 0.54),
          material('concrete-wall', [0.18, 0.19, 0.2, 1], 0.78),
          material('loading-door', [0.055, 0.07, 0.085, 1], 0.42, 0.35),
          material('painted-steel', [0.028, 0.045, 0.06, 1], 0.32, 0.7),
        ];
  return geometry;
}

function sceneForLayout(
  kind: 'old-city-alley' | 'contemporary-loading-dock',
  witnessPath: string,
  barrelPath: string,
  cratePath: string,
  instances: DressingInstance[],
) {
  const geometryPath = (instance: DressingInstance) =>
    instance.geometryAssetId === 'prop.storage-barrel' ? barrelPath : cratePath;
  return cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: `scene.street-storage-${kind}-transfer`,
    durationSeconds: 0.125,
    fps: 24,
    resolution: { width: 720, height: 406, percentage: 100 },
    entities: [
      { id: 'witness-environment', role: 'environment', geometryPath: witnessPath },
      ...instances.map((instance) => ({
        id: instance.id,
        role: 'set-dressing' as const,
        geometryPath: geometryPath(instance),
        transform: instance.transform,
      })),
    ],
    camera: {
      keyframes: [
        {
          time: 0,
          position: kind === 'old-city-alley' ? [6.4, 2.8, -12.2] : [7.1, 3, -13.6],
          target: [0, 0.75, 0.9],
          lensMillimeters: kind === 'old-city-alley' ? 30 : 28,
        },
        {
          time: 0.0625,
          position: kind === 'old-city-alley' ? [0.2, 2.25, -12.8] : [0.1, 2.45, -14.2],
          target: [0, 0.72, 0.7],
          lensMillimeters: kind === 'old-city-alley' ? 31 : 29,
        },
        {
          time: 0.125,
          position: kind === 'old-city-alley' ? [-6.4, 2.8, -12.2] : [-7.1, 3, -13.6],
          target: [0, 0.72, 0.8],
          lensMillimeters: kind === 'old-city-alley' ? 30 : 28,
        },
      ],
    },
    lights: [
      {
        id: 'broad-key',
        type: 'area',
        position: kind === 'old-city-alley' ? [-3.5, 6.5, -4] : [4.5, 7.2, -4.5],
        target: [0, 0.5, 0.5],
        color: kind === 'old-city-alley' ? [0.36, 0.48, 0.72] : [0.54, 0.67, 0.86],
        energy: kind === 'old-city-alley' ? 760 : 980,
        sizeMeters: 5.5,
      },
      {
        id: 'warm-edge',
        type: 'area',
        position: kind === 'old-city-alley' ? [3.8, 3.2, 2.2] : [-4.2, 3.6, 2.6],
        target: [0, 0.8, 0.5],
        color: [1, 0.42, 0.16],
        energy: kind === 'old-city-alley' ? 320 : 410,
        sizeMeters: 2.4,
      },
    ],
    atmosphere: {
      worldColor: kind === 'old-city-alley' ? [0.008, 0.013, 0.024] : [0.018, 0.026, 0.04],
      fogDensity: kind === 'old-city-alley' ? 0.008 : 0.002,
      fogColor: [0.08, 0.11, 0.16],
    },
    renderProfile: {
      engine: 'cycles-cpu',
      samples: 128,
      seed: 1729,
      denoise: true,
      intent: 'deterministic-final',
    },
    renderGates: [
      { id: 'dressing-visible', type: 'frame-visibility', maximumBlackPercentage: 68 },
      { id: 'dressing-highlight-detail', type: 'frame-overexposure', maximumWhitePercentage: 5 },
      {
        id: 'dressing-entity-inspection-coverage',
        type: 'entity-set-coverage',
        entityIds: instances.map((instance) => instance.id),
        minimumScreenHeightPercentage: 5,
        maximumScreenHeightPercentage: 40,
        minimumVisibleAreaPercentage: 98,
        marginPercentage: 1,
      },
    ],
    landmarks: [
      { id: 'right-context', progress: 0, description: 'Right context and edge placement' },
      {
        id: 'frontal-layout',
        progress: 0.5,
        description: 'Frontal family distribution and navigation opening',
      },
      { id: 'left-context', progress: 1, description: 'Left context and cross-variant silhouette' },
    ],
    metadata: {
      verificationPurpose: 'portable-environment-dressing-family-transfer',
      environmentClass: kind,
      familyId: 'environment.street-storage-family',
    },
  });
}

async function writePropCandidate(
  directory: string,
  geometry: GeometryAsset,
  title: string,
  description: string,
) {
  await mkdir(directory, { recursive: true });
  const validation = validateGeometry(geometry);
  if (!validation.valid)
    throw new Error(
      `${geometry.id} failed geometry validation: ${validation.issues.map((issue) => issue.code).join(', ')}`,
    );
  await saveGeometry(join(directory, 'geometry.json'), geometry);
  await writeFile(
    join(directory, 'validation.json'),
    `${JSON.stringify(validation, null, 2)}\n`,
    'utf8',
  );
  return writeHashedAssetMetadata(
    join(directory, 'asset.yaml'),
    assetMetadataSchema.parse({
      schemaVersion: 1,
      id: geometry.id,
      version: '0.1.0',
      type: 'prop',
      title,
      description,
      status: 'validated',
      tags: ['set-dressing', 'storage', 'portable', 'inhabited-environment'],
      capabilities: [
        'portable-geometry',
        'ground-placement',
        'named-stack-attachment',
        'medium-background-quality-tier',
      ],
      source: {
        kind: 'procedural',
        generator: 'videoer.street-storage-props.v1',
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
        { role: 'validation', path: 'validation.json', mediaType: 'application/json' },
      ],
      compatibility: {
        coordinateSystem: 'right-handed-y-up-forward-negative-z-metres',
        renderers: ['three-3d', 'blender-headless'],
        requires: [],
      },
      verification: {
        checks: [
          'geometry.topology',
          'geometry.material-groups',
          'attachments.ground-and-stack',
          'visual.cross-environment-generated-not-accepted',
        ],
        artifacts: ['validation.json'],
        verifiedAt: new Date().toISOString(),
      },
    }),
  );
}

export async function createStreetStorageDressingFamily(outputDirectory: string) {
  const output = resolve(outputDirectory);
  const propRoot = join(output, 'props');
  const barrelDirectory = join(propRoot, 'storage-barrel');
  const crateDirectory = join(propRoot, 'slatted-storage-crate');
  const [barrelMetadata, crateMetadata] = await Promise.all([
    writePropCandidate(
      barrelDirectory,
      createStorageBarrel(),
      'Weathered storage barrel',
      'Project-owned medium/background barrel with curved stave silhouette, raised head, aged iron hoops, procedural wood and named placement/stack attachments.',
    ),
    writePropCandidate(
      crateDirectory,
      createSlattedStorageCrate(),
      'Slatted storage crate',
      'Project-owned medium/background crate with separated boards, interior depth, corner reinforcement, procedural wood and named grip/stack attachments.',
    ),
  ]);
  const barrelPath = join(barrelDirectory, 'geometry.json');
  const cratePath = join(crateDirectory, 'geometry.json');
  const family = createStreetStorageFamily();
  const familyDirectory = join(output, 'family');
  await mkdir(familyDirectory, { recursive: true });
  const familyFile = join(familyDirectory, 'family.json');
  await writeFile(familyFile, `${JSON.stringify(family, null, 2)}\n`, 'utf8');

  const transfers = [];
  for (const [index, kind] of (
    ['old-city-alley', 'contemporary-loading-dock'] as const
  ).entries()) {
    const directory = join(familyDirectory, 'verification', kind);
    await mkdir(directory, { recursive: true });
    const request = {
      schemaVersion: 1 as const,
      id: `layout.${kind}-street-storage`,
      familyId: family.id,
      seed: 9381 + index * 1741,
      clusterCount: kind === 'old-city-alley' ? 5 : 6,
      zone: {
        minimum: (kind === 'old-city-alley' ? [-5.2, -3.6] : [-5.8, -4.1]) as [number, number],
        maximum: (kind === 'old-city-alley' ? [5.2, 2.2] : [5.8, 2.5]) as [number, number],
        groundY: 0,
      },
      exclusions: [
        {
          id: 'actor-and-camera-path',
          kind: 'corridor' as const,
          start: (kind === 'old-city-alley' ? [-5, -0.5] : [-5.5, -0.4]) as [number, number],
          end: (kind === 'old-city-alley' ? [5, -0.5] : [5.5, -0.4]) as [number, number],
          halfWidthMeters: kind === 'old-city-alley' ? 0.82 : 1.05,
          clearanceMeters: 0.22,
        },
        {
          id: 'primary-door-clearance',
          kind: 'rectangle' as const,
          minimum: [-1.8, 1.35] as [number, number],
          maximum: [1.8, 2.7] as [number, number],
          clearanceMeters: 0.25,
        },
      ],
      maximumAttemptsPerInstance: 700,
    };
    const layout = layoutDressingFamily(family, request);
    const requestFile = join(directory, 'layout-request.json');
    const layoutFile = join(directory, 'layout-report.json');
    await writeFile(requestFile, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
    await writeFile(layoutFile, `${JSON.stringify(layout, null, 2)}\n`, 'utf8');
    const witnessFile = await saveGeometry(
      join(directory, 'witness-geometry.json'),
      dressingWitness(kind),
    );
    const sceneFile = await saveCinematicScene(
      join(directory, 'scene.json'),
      sceneForLayout(kind, witnessFile, barrelPath, cratePath, layout.instances),
    );
    transfers.push({
      kind,
      directory,
      requestFile,
      layoutFile,
      sceneFile,
      render: await renderCinematicScene(sceneFile, directory),
    });
  }

  const artifact = (path: string) => relative(familyDirectory, path);
  const familyMetadata = await writeHashedAssetMetadata(
    join(familyDirectory, 'asset.yaml'),
    assetMetadataSchema.parse({
      schemaVersion: 1,
      id: family.id,
      version: '0.1.0',
      type: 'environment',
      title: family.title,
      description:
        'Renderer-independent explicit-version set-dressing family with deterministic weighted variation, edge-aware placement, overlap rejection, and mandatory actor/camera navigation clearance.',
      status: 'validated',
      tags: family.tags,
      capabilities: [
        'portable-set-dressing-family',
        'explicit-member-versions',
        'deterministic-seeded-layout',
        'weighted-variation',
        'overlap-free-placement',
        'navigation-clearance-preservation',
        'cross-environment-transfer',
      ],
      source: {
        kind: 'procedural',
        generator: 'videoer.environment-dressing-family.v1',
        sourceAssets: ['prop.storage-barrel@0.1.0', 'prop.slatted-storage-crate@0.1.0'],
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
        { role: 'dressing-family', path: 'family.json', mediaType: 'application/json' },
        ...transfers.flatMap((transfer) => [
          {
            role: `${transfer.kind}-layout-request`,
            path: artifact(transfer.requestFile),
            mediaType: 'application/json',
          },
          {
            role: `${transfer.kind}-layout-report`,
            path: artifact(transfer.layoutFile),
            mediaType: 'application/json',
          },
          {
            role: `${transfer.kind}-contact-sheet`,
            path: artifact(join(transfer.directory, 'contact-sheet.png')),
            mediaType: 'image/png',
          },
          {
            role: `${transfer.kind}-render-report`,
            path: artifact(join(transfer.directory, 'scene-render.json')),
            mediaType: 'application/json',
          },
        ]),
      ],
      compatibility: {
        coordinateSystem: 'right-handed-y-up-forward-negative-z-metres',
        renderers: ['three-3d', 'blender-headless'],
        requires: [
          { id: 'prop.storage-barrel', version: '0.1.0' },
          { id: 'prop.slatted-storage-crate', version: '0.1.0' },
        ],
      },
      verification: {
        checks: [
          'family.schema-and-explicit-versions',
          'layout.deterministic-seed',
          'layout.overlap-free',
          'layout.navigation-clearance',
          'visual.old-city-transfer-generated-not-accepted',
          'visual.contemporary-transfer-generated-not-accepted',
        ],
        artifacts: transfers.flatMap((transfer) => [
          artifact(transfer.layoutFile),
          artifact(join(transfer.directory, 'contact-sheet.png')),
          artifact(join(transfer.directory, 'scene-render.json')),
        ]),
        verifiedAt: new Date().toISOString(),
      },
    }),
  );
  return { output, barrelMetadata, crateMetadata, familyMetadata, familyFile, transfers };
}
