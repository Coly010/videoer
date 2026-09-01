import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderCinematicScene } from '../cinematic/blender.js';
import { saveCinematicScene } from '../cinematic/io.js';
import { cinematicSceneSchema } from '../cinematic/model.js';
import {
  createMarketWorldFamily,
  layoutDressingFamily,
  type DressingInstance,
} from '../environments/dressing-family.js';
import { saveGeometry } from '../geometry/io.js';
import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import { validateGeometry } from '../geometry/model.js';
import { boxPart, mergeMeshParts } from '../geometry/primitives.js';
import {
  createModularMarketStall,
  createProduceBasket,
  createTiedProvisionSack,
} from '../props/market-stall.js';

type MarketHost = 'historic-market-square' | 'contemporary-pop-up';

const material = (
  id: string,
  color: [number, number, number, number],
  roughness: number,
  metallic = 0,
): GeometryMaterial => ({
  id,
  baseColor: color,
  roughness,
  metallic,
  emission: [0, 0, 0],
  emissionStrength: 0,
});

function marketHostGeometry(kind: MarketHost): GeometryAsset {
  const historic = kind === 'historic-market-square';
  const parts = historic
    ? [
        boxPart([-8, -0.22, -5.6], [8, 0, 5.6], 0, 'square-stone'),
        boxPart([-8.2, 0, 4.8], [8.2, 5.2, 5.25], 0, 'warm-plaster'),
        boxPart([-8.2, 0, -5.25], [-7.75, 4.4, 5.25], 0, 'old-brick'),
        boxPart([7.75, 0, -5.25], [8.2, 4.4, 5.25], 0, 'old-brick'),
        boxPart([-1.1, 0, 4.4], [1.1, 2.65, 4.85], 0, 'dark-arch'),
        boxPart([-5.8, 0.1, 4.25], [-3.5, 0.62, 4.62], 0, 'stone-bench'),
      ]
    : [
        boxPart([-8, -0.18, -5.6], [8, 0, 5.6], 0, 'urban-paving'),
        boxPart([-8.25, 0, 4.9], [8.25, 3.7, 5.3], 0, 'glass-hall'),
        boxPart([-8.25, 0, -5.3], [-7.85, 2.6, 5.3], 0, 'painted-steel'),
        boxPart([7.85, 0, -5.3], [8.25, 2.6, 5.3], 0, 'painted-steel'),
        boxPart([-1.5, 0, 4.42], [1.5, 2.55, 4.92], 0, 'hall-opening'),
        boxPart([-6.2, 0.04, 4.16], [-3.2, 0.5, 4.5], 0, 'urban-bench'),
        boxPart([3.2, 0.04, 4.16], [6.2, 0.5, 4.5], 0, 'urban-bench'),
      ];
  const geometry = mergeMeshParts(
    `environment.${kind}-market-host`,
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    { generator: 'videoer.market-host-witness.v1', verificationOnly: true },
  );
  geometry.materials = historic
    ? [
        material('square-stone', [0.19, 0.16, 0.12, 1], 0.76),
        material('warm-plaster', [0.24, 0.17, 0.11, 1], 0.82),
        material('old-brick', [0.13, 0.035, 0.016, 1], 0.74),
        material('dark-arch', [0.014, 0.009, 0.006, 1], 0.92),
        material('stone-bench', [0.28, 0.25, 0.2, 1], 0.7),
      ]
    : [
        material('urban-paving', [0.16, 0.17, 0.18, 1], 0.66),
        material('glass-hall', [0.045, 0.09, 0.13, 1], 0.26, 0.18),
        material('painted-steel', [0.035, 0.055, 0.075, 1], 0.34, 0.68),
        material('hall-opening', [0.006, 0.012, 0.019, 1], 0.88),
        material('urban-bench', [0.09, 0.12, 0.14, 1], 0.4, 0.56),
      ];
  return geometry;
}

function marketScene(
  kind: MarketHost,
  hostPath: string,
  paths: Record<string, string>,
  instances: DressingInstance[],
) {
  const historic = kind === 'historic-market-square';
  return cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: `scene.market-world-${kind}-transfer`,
    durationSeconds: 0.125,
    fps: 24,
    resolution: { width: 720, height: 406, percentage: 100 },
    entities: [
      { id: 'market-host', role: 'environment', geometryPath: hostPath },
      ...instances.map((instance) => ({
        id: instance.id,
        role: 'set-dressing' as const,
        geometryPath: paths[instance.geometryAssetId]!,
        transform: instance.transform,
      })),
    ],
    camera: {
      keyframes: [
        {
          time: 0,
          position: historic ? [8.4, 3.35, -12.8] : [9, 3.6, -13.6],
          target: [0, 1.12, 0.55],
          lensMillimeters: 32,
        },
        {
          time: 0.0625,
          position: [0.15, 2.95, -13.4],
          target: [0, 1.08, 0.55],
          lensMillimeters: 34,
        },
        {
          time: 0.125,
          position: historic ? [-8.2, 3.3, -12.5] : [-8.8, 3.55, -13.3],
          target: [0, 1.1, 0.55],
          lensMillimeters: 32,
        },
      ],
    },
    lights: [
      {
        id: 'market-sky-key',
        type: 'area',
        position: historic ? [-4.5, 8.2, -4.2] : [4.8, 8.4, -4.5],
        target: [0, 1, 0.4],
        color: historic ? [0.48, 0.57, 0.76] : [0.6, 0.72, 0.92],
        energy: historic ? 980 : 1180,
        sizeMeters: 6.2,
      },
      {
        id: 'merchandise-warm-edge',
        type: 'area',
        position: historic ? [4.2, 4.1, 2.8] : [-4.4, 4.3, 2.8],
        target: [0, 1.05, 0],
        color: [1, 0.45, 0.17],
        energy: historic ? 510 : 570,
        sizeMeters: 3,
      },
    ],
    atmosphere: {
      worldColor: historic ? [0.012, 0.018, 0.032] : [0.022, 0.032, 0.052],
      fogDensity: historic ? 0.003 : 0.001,
      fogColor: [0.09, 0.12, 0.17],
    },
    renderProfile: {
      engine: 'cycles-cpu',
      samples: 128,
      seed: 1729,
      denoise: true,
      intent: 'deterministic-final',
    },
    renderGates: [
      { id: 'market-visible', type: 'frame-visibility', maximumBlackPercentage: 70 },
      { id: 'market-highlight-detail', type: 'frame-overexposure', maximumWhitePercentage: 5 },
      {
        id: 'market-entity-inspection-coverage',
        type: 'entity-set-coverage',
        entityIds: instances.map((instance) => instance.id),
        minimumScreenHeightPercentage: 4,
        maximumScreenHeightPercentage: 58,
        minimumVisibleAreaPercentage: 96,
        marginPercentage: 1,
      },
    ],
    landmarks: [
      { id: 'right-context', progress: 0, description: 'Right host and market silhouette' },
      {
        id: 'frontal-layout',
        progress: 0.5,
        description: 'Canopy, display inventory and circulation',
      },
      { id: 'left-context', progress: 1, description: 'Left host and material separation' },
    ],
    metadata: {
      verificationPurpose: 'portable-physical-market-family-transfer',
      environmentClass: kind,
      familyId: 'environment.market-world-family',
    },
  });
}

async function writeMarketCandidate(
  directory: string,
  geometry: GeometryAsset,
  title: string,
  description: string,
  tags: string[],
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
      tags: [...tags, 'market', 'portable', 'inhabited-environment'],
      capabilities: [
        'portable-geometry',
        'ground-placement',
        'named-merchandising-attachments',
        'medium-background-quality-tier',
      ],
      source: {
        kind: 'procedural',
        generator: 'videoer.market-world-assets.v1',
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
          'attachments.market-semantic',
          'visual.cross-environment-generated-not-accepted',
        ],
        artifacts: ['validation.json'],
        verifiedAt: new Date().toISOString(),
      },
    }),
  );
}

export async function createMarketWorldDressingFamily(outputDirectory: string) {
  const output = resolve(outputDirectory);
  const propRoot = join(output, 'props');
  const candidates = [
    {
      directoryName: 'modular-market-stall',
      geometry: createModularMarketStall(),
      title: 'Modular striped-canopy market stall',
      description:
        'Project-owned timber market structure with physical striped canopy, counter, stock shelf and named display/hanging anchors.',
      tags: ['stall', 'structure', 'canopy'],
    },
    {
      directoryName: 'produce-basket',
      geometry: createProduceBasket(),
      title: 'Handled produce display basket',
      description:
        'Project-owned willow basket with physical rim, handle and individually modelled mixed produce inventory.',
      tags: ['basket', 'produce', 'merchandise'],
    },
    {
      directoryName: 'tied-provision-sack',
      geometry: createTiedProvisionSack(),
      title: 'Tied provision sack',
      description:
        'Project-owned weighted burlap provision sack with gathered neck, physical tie and named carry/stack anchors.',
      tags: ['sack', 'provisions', 'merchandise'],
    },
  ];
  const metadata = await Promise.all(
    candidates.map((candidate) =>
      writeMarketCandidate(
        join(propRoot, candidate.directoryName),
        candidate.geometry,
        candidate.title,
        candidate.description,
        candidate.tags,
      ),
    ),
  );
  const paths = Object.fromEntries(
    candidates.map((candidate) => [
      candidate.geometry.id,
      join(propRoot, candidate.directoryName, 'geometry.json'),
    ]),
  );
  const family = createMarketWorldFamily();
  const familyDirectory = join(output, 'family');
  await mkdir(familyDirectory, { recursive: true });
  const familyFile = join(familyDirectory, 'family.json');
  await writeFile(familyFile, `${JSON.stringify(family, null, 2)}\n`, 'utf8');

  const transfers = [];
  for (const [index, kind] of (
    ['historic-market-square', 'contemporary-pop-up'] as const
  ).entries()) {
    const directory = join(familyDirectory, 'verification', kind);
    await mkdir(directory, { recursive: true });
    const request = {
      schemaVersion: 1 as const,
      id: `layout.${kind}-market-world`,
      familyId: family.id,
      seed: [7719, 10_381][index]!,
      clusterCount: 3,
      requiredVariantIds: ['market-stall', 'produce-basket', 'provision-sack'],
      zone: {
        minimum: [-6.4, -4.1] as [number, number],
        maximum: [6.4, 3.7] as [number, number],
        groundY: 0,
      },
      exclusions: [
        {
          id: 'customer-and-camera-circulation',
          kind: 'corridor' as const,
          start: [-6, -1.25] as [number, number],
          end: [6, -1.25] as [number, number],
          halfWidthMeters: 0.74,
          clearanceMeters: 0.15,
        },
        {
          id: 'primary-entrance-clearance',
          kind: 'rectangle' as const,
          minimum: [-1.75, 2.45] as [number, number],
          maximum: [1.75, 4.1] as [number, number],
          clearanceMeters: 0.2,
        },
      ],
      maximumAttemptsPerInstance: 1200,
    };
    const layout = layoutDressingFamily(family, request);
    const requestFile = join(directory, 'layout-request.json');
    const layoutFile = join(directory, 'layout-report.json');
    await writeFile(requestFile, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
    await writeFile(layoutFile, `${JSON.stringify(layout, null, 2)}\n`, 'utf8');
    const hostPath = await saveGeometry(
      join(directory, 'host-geometry.json'),
      marketHostGeometry(kind),
    );
    const sceneFile = await saveCinematicScene(
      join(directory, 'scene.json'),
      marketScene(kind, hostPath, paths, layout.instances),
    );
    transfers.push({
      kind,
      directory,
      requestFile,
      layoutFile,
      hostPath,
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
        'Renderer-independent market-world family combining a reusable structural stall with physical merchandise inventory and authored merchandising clusters across unrelated hosts.',
      status: 'validated',
      tags: family.tags,
      capabilities: [
        'portable-set-dressing-family',
        'explicit-member-versions',
        'deterministic-seeded-layout',
        'authored-physical-merchandising',
        'navigation-clearance-preservation',
        'cross-environment-transfer',
      ],
      source: {
        kind: 'procedural',
        generator: 'videoer.market-world-family.v1',
        sourceAssets: candidates.map((candidate) => `${candidate.geometry.id}@0.1.0`),
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
            role: `${transfer.kind}-host`,
            path: artifact(transfer.hostPath),
            mediaType: 'application/vnd.videoer.geometry+json',
          },
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
        requires: candidates.map((candidate) => ({ id: candidate.geometry.id, version: '0.1.0' })),
      },
      verification: {
        checks: [
          'family.schema-and-explicit-versions',
          'layout.deterministic-seed',
          'layout.required-variant-coverage',
          'layout.navigation-clearance',
          'merchandising.physical-inventory',
          'visual.historic-market-square-generated-not-accepted',
          'visual.contemporary-pop-up-generated-not-accepted',
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
  return { output, metadata, familyMetadata, familyFile, transfers };
}
