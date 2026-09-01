import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderCinematicScene } from '../cinematic/blender.js';
import { saveCinematicScene } from '../cinematic/io.js';
import { cinematicSceneSchema } from '../cinematic/model.js';
import {
  createPottedVegetationFamily,
  layoutDressingFamily,
  type DressingInstance,
} from '../environments/dressing-family.js';
import { createTriangleSurfaceQuery } from '../environments/surface-query.js';
import { saveGeometry } from '../geometry/io.js';
import type { GeometryAsset, GeometryMaterial, Vec3 } from '../geometry/model.js';
import { validateGeometry } from '../geometry/model.js';
import { boxPart, mergeMeshParts, type MeshPart } from '../geometry/primitives.js';
import { createPottedFern, createPottedShrub } from '../props/potted-vegetation.js';

type HostKind = 'historic-courtyard' | 'contemporary-rooftop';

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

function surfacePart(points: [Vec3, Vec3, Vec3, Vec3], materialId: string): MeshPart {
  const [a, b, c, d] = points;
  const edge1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const edge2: Vec3 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  const raw: Vec3 = [
    edge1[1] * edge2[2] - edge1[2] * edge2[1],
    edge1[2] * edge2[0] - edge1[0] * edge2[2],
    edge1[0] * edge2[1] - edge1[1] * edge2[0],
  ];
  const length = Math.hypot(...raw);
  const normal: Vec3 =
    raw[1] < 0
      ? (raw.map((value) => -value / length) as Vec3)
      : (raw.map((value) => value / length) as Vec3);
  return {
    positions: [a, b, c, d],
    normals: [normal, normal, normal, normal],
    uvs: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    indices: [0, 1, 2, 0, 2, 3],
    skinIndices: [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    skinWeights: [
      [1, 0, 0, 0],
      [1, 0, 0, 0],
      [1, 0, 0, 0],
      [1, 0, 0, 0],
    ],
    materialId,
  };
}

function hostSurface(kind: HostKind): GeometryAsset {
  const points: [Vec3, Vec3, Vec3, Vec3] =
    kind === 'historic-courtyard'
      ? [
          [-6, -0.36, -4.5],
          [6, 0.36, -4.5],
          [6, 0.36, 4.5],
          [-6, -0.36, 4.5],
        ]
      : [
          [-6, 0.27, -4.5],
          [6, 0.27, -4.5],
          [6, -0.27, 4.5],
          [-6, -0.27, 4.5],
        ];
  const geometry = mergeMeshParts(
    `environment.${kind}-planting-surface`,
    [surfacePart(points, kind === 'historic-courtyard' ? 'courtyard-stone' : 'rooftop-concrete')],
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.vegetation-surface-witness.v1',
      verificationOnly: true,
      surfaceQueryTarget: true,
    },
  );
  geometry.materials = [
    kind === 'historic-courtyard'
      ? material('courtyard-stone', [0.16, 0.14, 0.115, 1], 0.72)
      : material('rooftop-concrete', [0.19, 0.205, 0.215, 1], 0.68),
  ];
  return geometry;
}

function hostContext(kind: HostKind): GeometryAsset {
  const parts =
    kind === 'historic-courtyard'
      ? [
          boxPart([-6.2, -0.5, 4.5], [6.2, 4.4, 4.78], 0, 'aged-plaster'),
          boxPart([-6.2, -0.5, -4.78], [-5.92, 4.2, 4.78], 0, 'old-brick'),
          boxPart([5.92, -0.5, -4.78], [6.2, 4.2, 4.78], 0, 'old-brick'),
          boxPart([-1.2, -0.3, 4.18], [1.2, 2.5, 4.5], 0, 'dark-door'),
          boxPart([-1.45, 2.45, 4.12], [1.45, 2.72, 4.55], 0, 'stone-trim'),
          boxPart([-4.8, 0.1, 3.9], [-3.1, 0.56, 4.26], 0, 'stone-bench'),
        ]
      : [
          boxPart([-6.25, -0.5, 4.5], [6.25, 1.1, 4.78], 0, 'parapet'),
          boxPart([-6.25, -0.5, -4.78], [-5.98, 1.1, 4.78], 0, 'parapet'),
          boxPart([5.98, -0.5, -4.78], [6.25, 1.1, 4.78], 0, 'parapet'),
          boxPart([-1.1, 0.1, 3.9], [1.1, 2.5, 4.42], 0, 'service-core'),
          boxPart([-4.8, 0.05, 3.75], [-2.8, 0.55, 4.18], 0, 'steel-bench'),
          boxPart([2.8, 0.05, 3.75], [4.8, 0.55, 4.18], 0, 'steel-bench'),
          boxPart([-9.5, -0.5, 7.2], [-4.8, 3.2, 10], 0, 'distant-building'),
          boxPart([-3.9, -0.5, 7.8], [1.1, 5.1, 10.6], 0, 'distant-building'),
          boxPart([2.1, -0.5, 7.4], [8.7, 3.9, 10.2], 0, 'distant-building'),
        ];
  const geometry = mergeMeshParts(
    `environment.${kind}-vegetation-context`,
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    { generator: 'videoer.vegetation-host-context.v1', verificationOnly: true },
  );
  geometry.materials =
    kind === 'historic-courtyard'
      ? [
          material('aged-plaster', [0.2, 0.16, 0.12, 1], 0.8),
          material('old-brick', [0.12, 0.035, 0.018, 1], 0.76),
          material('dark-door', [0.035, 0.018, 0.009, 1], 0.68),
          material('stone-trim', [0.28, 0.25, 0.2, 1], 0.7),
          material('stone-bench', [0.23, 0.21, 0.18, 1], 0.74),
        ]
      : [
          material('parapet', [0.11, 0.13, 0.15, 1], 0.72),
          material('service-core', [0.055, 0.075, 0.09, 1], 0.48, 0.52),
          material('steel-bench', [0.05, 0.065, 0.075, 1], 0.34, 0.78),
          material('distant-building', [0.018, 0.03, 0.05, 1], 0.82),
        ];
  return geometry;
}

function vegetationScene(
  kind: HostKind,
  surfacePath: string,
  contextPath: string,
  fernPath: string,
  shrubPath: string,
  instances: DressingInstance[],
) {
  return cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: `scene.potted-vegetation-${kind}-transfer`,
    durationSeconds: 0.125,
    fps: 24,
    resolution: { width: 720, height: 406, percentage: 100 },
    entities: [
      { id: 'queried-ground-surface', role: 'environment', geometryPath: surfacePath },
      { id: 'host-context', role: 'environment', geometryPath: contextPath },
      ...instances.map((instance) => ({
        id: instance.id,
        role: 'set-dressing' as const,
        geometryPath: instance.geometryAssetId === 'prop.potted-fern' ? fernPath : shrubPath,
        transform: instance.transform,
      })),
    ],
    camera: {
      keyframes: [
        {
          time: 0,
          position: kind === 'historic-courtyard' ? [7.8, 3.2, -10.8] : [8.2, 3.4, -11.4],
          target: [0, 0.72, 0.8],
          lensMillimeters: 34,
        },
        {
          time: 0.0625,
          position: [0.2, 2.65, -11.8],
          target: [0, 0.68, 0.7],
          lensMillimeters: 36,
        },
        {
          time: 0.125,
          position: kind === 'historic-courtyard' ? [-7.5, 3.1, -10.5] : [-8, 3.3, -11.2],
          target: [0, 0.7, 0.8],
          lensMillimeters: 34,
        },
      ],
    },
    lights: [
      {
        id: 'soft-sky-key',
        type: 'area',
        position: kind === 'historic-courtyard' ? [-3.8, 7.2, -3.5] : [4.5, 7.8, -4],
        target: [0, 0.75, 0.5],
        color: kind === 'historic-courtyard' ? [0.48, 0.58, 0.75] : [0.56, 0.68, 0.88],
        energy: kind === 'historic-courtyard' ? 820 : 1050,
        sizeMeters: 5.5,
      },
      {
        id: 'warm-leaf-edge',
        type: 'area',
        position: kind === 'historic-courtyard' ? [4, 3.7, 3.1] : [-4.2, 4, 3],
        target: [0, 0.9, 0.5],
        color: [1, 0.46, 0.2],
        energy: kind === 'historic-courtyard' ? 360 : 440,
        sizeMeters: 2.8,
      },
    ],
    atmosphere: {
      worldColor: kind === 'historic-courtyard' ? [0.012, 0.018, 0.03] : [0.02, 0.03, 0.05],
      fogDensity: kind === 'historic-courtyard' ? 0.004 : 0.001,
      fogColor: [0.09, 0.12, 0.16],
    },
    renderProfile: {
      engine: 'cycles-cpu',
      samples: 128,
      seed: 1729,
      denoise: true,
      intent: 'deterministic-final',
    },
    renderGates: [
      { id: 'vegetation-visible', type: 'frame-visibility', maximumBlackPercentage: 72 },
      { id: 'vegetation-highlight-detail', type: 'frame-overexposure', maximumWhitePercentage: 5 },
      {
        id: 'vegetation-entity-inspection-coverage',
        type: 'entity-set-coverage',
        entityIds: instances.map((instance) => instance.id),
        minimumScreenHeightPercentage: 6,
        maximumScreenHeightPercentage: 42,
        minimumVisibleAreaPercentage: 96,
        marginPercentage: 1,
      },
    ],
    landmarks: [
      { id: 'right-context', progress: 0, description: 'Right host context and sloped placement' },
      {
        id: 'frontal-layout',
        progress: 0.5,
        description: 'Family silhouettes and clear circulation',
      },
      {
        id: 'left-context',
        progress: 1,
        description: 'Left host context and cross-variant material response',
      },
    ],
    metadata: {
      verificationPurpose: 'surface-bound-potted-vegetation-family-transfer',
      environmentClass: kind,
      familyId: 'environment.potted-vegetation-family',
    },
  });
}

async function writePlantCandidate(
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
      tags: ['vegetation', 'planter', 'set-dressing', 'portable', 'inhabited-environment'],
      capabilities: [
        'portable-geometry',
        'ground-placement',
        'surface-normal-alignment',
        'named-foliage-anchor',
        'medium-background-quality-tier',
      ],
      source: {
        kind: 'procedural',
        generator: 'videoer.potted-vegetation.v1',
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
          'attachments.ground-pot-and-foliage',
          'visual.cross-environment-generated-not-accepted',
        ],
        artifacts: ['validation.json'],
        verifiedAt: new Date().toISOString(),
      },
    }),
  );
}

export async function createPottedVegetationDressingFamily(outputDirectory: string) {
  const output = resolve(outputDirectory);
  const fernDirectory = join(output, 'props', 'potted-fern');
  const shrubDirectory = join(output, 'props', 'potted-shrub');
  const [fernMetadata, shrubMetadata] = await Promise.all([
    writePlantCandidate(
      fernDirectory,
      createPottedFern(),
      'Weathered terracotta potted fern',
      'Project-owned broad fern silhouette with swept stems, paired leaflets, soil, weathered terracotta planter and named placement/foliage anchors.',
    ),
    writePlantCandidate(
      shrubDirectory,
      createPottedShrub(),
      'Galvanized potted branching shrub',
      'Project-owned upright branching shrub with three-tone foliage, visible branches, soil, galvanized planter and named placement/foliage anchors.',
    ),
  ]);
  const fernPath = join(fernDirectory, 'geometry.json');
  const shrubPath = join(shrubDirectory, 'geometry.json');
  const family = createPottedVegetationFamily();
  const familyDirectory = join(output, 'family');
  await mkdir(familyDirectory, { recursive: true });
  const familyFile = join(familyDirectory, 'family.json');
  await writeFile(familyFile, `${JSON.stringify(family, null, 2)}\n`, 'utf8');

  const transfers = [];
  for (const [index, kind] of (['historic-courtyard', 'contemporary-rooftop'] as const).entries()) {
    const directory = join(familyDirectory, 'verification', kind);
    await mkdir(directory, { recursive: true });
    const surface = hostSurface(kind);
    const context = hostContext(kind);
    const surfacePath = await saveGeometry(join(directory, 'surface-geometry.json'), surface);
    const contextPath = await saveGeometry(join(directory, 'context-geometry.json'), context);
    const request = {
      schemaVersion: 1 as const,
      id: `layout.${kind}-potted-vegetation`,
      familyId: family.id,
      seed: [12_720, 14_932][index]!,
      clusterCount: 3,
      requiredVariantIds: ['potted-fern', 'potted-shrub'],
      zone: {
        minimum: [-4.7, -3.1] as [number, number],
        maximum: [4.7, 3.1] as [number, number],
        groundY: 0,
      },
      surfaceQuery: {
        kind: 'triangle-mesh' as const,
        geometryAssetId: surface.id,
        maximumSlopeDegrees: 8,
        alignToSurfaceNormal: true,
        verticalOffsetMeters: 0.008,
      },
      exclusions: [
        {
          id: 'primary-circulation',
          kind: 'corridor' as const,
          start: [-4.6, -0.4] as [number, number],
          end: [4.6, -0.4] as [number, number],
          halfWidthMeters: 0.72,
          clearanceMeters: 0.18,
        },
        {
          id: 'door-or-service-clearance',
          kind: 'rectangle' as const,
          minimum: [-1.55, 1.7] as [number, number],
          maximum: [1.55, 3.2] as [number, number],
          clearanceMeters: 0.2,
        },
      ],
      maximumAttemptsPerInstance: 900,
    };
    const layout = layoutDressingFamily(family, request, {
      surfaceQuery: createTriangleSurfaceQuery(surface),
    });
    const requestFile = join(directory, 'layout-request.json');
    const layoutFile = join(directory, 'layout-report.json');
    await writeFile(requestFile, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
    await writeFile(layoutFile, `${JSON.stringify(layout, null, 2)}\n`, 'utf8');
    const sceneFile = await saveCinematicScene(
      join(directory, 'scene.json'),
      vegetationScene(kind, surfacePath, contextPath, fernPath, shrubPath, layout.instances),
    );
    transfers.push({
      kind,
      directory,
      requestFile,
      layoutFile,
      surfacePath,
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
        'Renderer-independent explicit-version planted dressing family with authored clusters, navigation clearance, live triangle height/slope queries, surface-normal alignment and cross-host evidence.',
      status: 'validated',
      tags: family.tags,
      capabilities: [
        'portable-set-dressing-family',
        'explicit-member-versions',
        'deterministic-seeded-layout',
        'authored-vegetation-clusters',
        'navigation-clearance-preservation',
        'geometry-bound-surface-placement',
        'surface-normal-alignment',
        'cross-environment-transfer',
      ],
      source: {
        kind: 'procedural',
        generator: 'videoer.potted-vegetation-family.v1',
        sourceAssets: ['prop.potted-fern@0.1.0', 'prop.potted-shrub@0.1.0'],
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
            role: `${transfer.kind}-surface`,
            path: artifact(transfer.surfacePath),
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
        requires: [
          { id: 'prop.potted-fern', version: '0.1.0' },
          { id: 'prop.potted-shrub', version: '0.1.0' },
        ],
      },
      verification: {
        checks: [
          'family.schema-and-explicit-versions',
          'layout.deterministic-seed',
          'layout.overlap-free',
          'layout.navigation-clearance',
          'layout.live-triangle-surface-evidence',
          'layout.surface-normal-alignment',
          'visual.historic-courtyard-generated-not-accepted',
          'visual.contemporary-rooftop-generated-not-accepted',
        ],
        artifacts: transfers.flatMap((transfer) => [
          artifact(transfer.surfacePath),
          artifact(transfer.layoutFile),
          artifact(join(transfer.directory, 'contact-sheet.png')),
          artifact(join(transfer.directory, 'scene-render.json')),
        ]),
        verifiedAt: new Date().toISOString(),
      },
    }),
  );
  return { output, fernMetadata, shrubMetadata, familyMetadata, familyFile, transfers };
}
