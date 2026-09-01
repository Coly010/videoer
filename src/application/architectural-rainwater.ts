import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderCinematicScene } from '../cinematic/blender.js';
import { saveCinematicScene } from '../cinematic/io.js';
import { cinematicSceneSchema } from '../cinematic/model.js';
import { saveGeometry } from '../geometry/io.js';
import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import { validateGeometry } from '../geometry/model.js';
import { boxPart, gableRoofPart, mergeMeshParts } from '../geometry/primitives.js';
import { createOldCitySurfacePresets } from '../materials/old-city.js';
import {
  canonicalRainwaterSystem,
  createArchitecturalRainwaterSystem,
  patinatedRainwaterSurface,
} from '../props/rainwater-system.js';

type HostKind = 'old-city-plaster' | 'contemporary-concrete';

function material(
  id: string,
  baseColor: [number, number, number, number],
  roughness: number,
  metallic = 0,
): GeometryMaterial {
  return { id, baseColor, roughness, metallic, emission: [0, 0, 0], emissionStrength: 0 };
}

function rainwaterHost(kind: HostKind): GeometryAsset {
  const surfaces = new Map(
    createOldCitySurfacePresets().map((preset) => [preset.id, preset.material]),
  );
  const eaveHeight = canonicalRainwaterSystem.eaveHeightMeters;
  const parts = [
    boxPart([-4.5, -0.16, -4], [4.5, 0, 2.6], 0, 'ground'),
    boxPart([-3.4, 0, 0], [3.4, eaveHeight + 0.6, 0.3], 0, 'wall'),
  ];
  if (kind === 'old-city-plaster') {
    parts.push(
      boxPart([-3.55, eaveHeight + 0.02, -0.1], [3.55, eaveHeight + 0.26, 0.58], 0, 'timber'),
      gableRoofPart(
        [-3.75, eaveHeight + 0.24, -0.05],
        [3.75, eaveHeight + 1.2, 2.15],
        'x',
        0,
        'roof',
      ),
      boxPart([-2.95, 0.12, -0.08], [-2.75, eaveHeight - 0.35, 0.12], 0, 'timber'),
      boxPart([2.7, 0.12, -0.08], [2.9, eaveHeight - 0.35, 0.12], 0, 'timber'),
      boxPart([-1.1, 1.15, -0.09], [1.1, 3.05, 0.02], 0, 'dark-window'),
    );
  } else {
    parts.push(
      boxPart([-3.65, eaveHeight + 0.02, -0.08], [3.65, eaveHeight + 0.28, 0.52], 0, 'steel'),
      boxPart([-3.48, eaveHeight + 0.28, 0.08], [3.48, eaveHeight + 0.76, 1.7], 0, 'concrete'),
      boxPart([-3.55, 0, -0.06], [-3.35, eaveHeight + 0.78, 0.38], 0, 'steel'),
      boxPart([3.35, 0, -0.06], [3.55, eaveHeight + 0.78, 0.38], 0, 'steel'),
      boxPart([-1.55, 0.18, -0.08], [1.55, 3.25, 0.04], 0, 'loading-door'),
    );
  }
  const geometry = mergeMeshParts(
    `environment.${kind}-rainwater-host-witness`,
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.rainwater-host-witness.v1',
      environmentClass: kind,
      verificationOnly: true,
      hostContract: {
        facadePlaneZ: 0,
        clearSpanMeters: 6.8,
        eaveHeightMeters: eaveHeight,
        continuousMountingSurface: true,
      },
    },
  );
  geometry.materials =
    kind === 'old-city-plaster'
      ? [
          {
            ...material('ground', [0.13, 0.14, 0.15, 1], 0.58),
            surface: surfaces.get('limestone-trim'),
          },
          {
            ...material('wall', [0.18, 0.17, 0.145, 1], 0.76),
            surface: surfaces.get('rain-aged-plaster'),
          },
          {
            ...material('timber', [0.075, 0.025, 0.012, 1], 0.62),
            surface: surfaces.get('weathered-wood'),
          },
          material('roof', [0.045, 0.055, 0.07, 1], 0.61),
          material('dark-window', [0.006, 0.01, 0.014, 1], 0.9),
        ]
      : [
          material('ground', [0.105, 0.115, 0.125, 1], 0.55),
          material('wall', [0.23, 0.24, 0.25, 1], 0.8),
          material('concrete', [0.15, 0.17, 0.19, 1], 0.74),
          material('steel', [0.025, 0.045, 0.065, 1], 0.3, 0.72),
          material('loading-door', [0.055, 0.07, 0.085, 1], 0.44, 0.34),
        ];
  return geometry;
}

function transferScene(kind: HostKind, hostPath: string, rainwaterPath: string) {
  return cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: `scene.architectural-rainwater-${kind}-transfer`,
    durationSeconds: 0.125,
    fps: 24,
    resolution: { width: 720, height: 480, percentage: 100 },
    entities: [
      { id: 'host', role: 'environment', geometryPath: hostPath },
      { id: 'rainwater-system', role: 'prop', geometryPath: rainwaterPath },
    ],
    camera: {
      keyframes: [
        { time: 0, position: [6.2, 7.4, -12.8], target: [0, 3.35, -0.18], lensMillimeters: 44 },
        { time: 0.0625, position: [0, 2.85, -12.4], target: [0, 2.3, -0.12], lensMillimeters: 52 },
        {
          time: 0.125,
          position: [-6.6, 3.35, -12.2],
          target: [0, 2.35, -0.12],
          lensMillimeters: 50,
        },
      ],
    },
    lights: [
      {
        id: 'broad-cool-key',
        type: 'area',
        position: kind === 'old-city-plaster' ? [-3.8, 7.4, -4.6] : [4.2, 7.8, -4.2],
        target: [0, 2.2, -0.15],
        color: kind === 'old-city-plaster' ? [0.38, 0.51, 0.74] : [0.52, 0.66, 0.86],
        energy: kind === 'old-city-plaster' ? 820 : 1020,
        sizeMeters: 5.2,
      },
      {
        id: 'warm-metal-edge',
        type: 'area',
        position: kind === 'old-city-plaster' ? [4.4, 4.5, -2] : [-4.2, 4.8, -2.4],
        target: [1.6, 2.2, -0.18],
        color: [1, 0.43, 0.17],
        energy: kind === 'old-city-plaster' ? 330 : 390,
        sizeMeters: 2.2,
      },
    ],
    atmosphere: {
      worldColor: kind === 'old-city-plaster' ? [0.009, 0.014, 0.025] : [0.018, 0.028, 0.043],
      fogDensity: kind === 'old-city-plaster' ? 0.003 : 0.001,
      fogColor: [0.075, 0.105, 0.16],
    },
    renderProfile: {
      engine: 'cycles-cpu',
      samples: 128,
      seed: 1729,
      denoise: true,
      intent: 'deterministic-final',
    },
    renderGates: [
      { id: 'rainwater-scene-visible', type: 'frame-visibility', maximumBlackPercentage: 62 },
      { id: 'rainwater-highlight-detail', type: 'frame-overexposure', maximumWhitePercentage: 4 },
      {
        id: 'rainwater-framing',
        type: 'subject-framing',
        entityId: 'rainwater-system',
        minimumScreenHeightPercentage: 42,
        maximumScreenHeightPercentage: 82,
        marginPercentage: 2,
      },
      {
        id: 'rainwater-local-highlight-detail',
        type: 'subject-overexposure',
        entityId: 'rainwater-system',
        maximumWhitePercentage: 4,
      },
    ],
    landmarks: [
      {
        id: 'right-context',
        progress: 0,
        description:
          'Elevated right angle proving the open trough, rolled lips and host attachment',
      },
      {
        id: 'frontal-system',
        progress: 0.5,
        description: 'Complete span, brackets, hopper, pipe clips and discharge shoe',
      },
      {
        id: 'left-context',
        progress: 1,
        description: 'Opposite angle, open trough lips and facade integration',
      },
    ],
    metadata: {
      verificationPurpose: 'portable-open-gutter-downpipe-cross-environment-transfer',
      hostClass: kind,
      exactPortableGeometryReused: true,
    },
  });
}

export async function createArchitecturalRainwaterAsset(outputDirectory: string) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const geometry = createArchitecturalRainwaterSystem();
  const validation = validateGeometry(geometry);
  if (!validation.valid)
    throw new Error(
      `Rainwater system failed geometry validation: ${validation.issues.map((issue) => issue.code).join(', ')}`,
    );
  const geometryFile = await saveGeometry(join(output, 'geometry.json'), geometry);
  await writeFile(
    join(output, 'validation.json'),
    `${JSON.stringify(validation, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(output, 'surface.json'),
    `${JSON.stringify(patinatedRainwaterSurface, null, 2)}\n`,
    'utf8',
  );

  const transfers = [];
  for (const kind of ['old-city-plaster', 'contemporary-concrete'] as const) {
    const directory = join(output, 'verification', kind);
    await mkdir(directory, { recursive: true });
    const host = rainwaterHost(kind);
    const hostFile = await saveGeometry(join(directory, 'host-geometry.json'), host);
    const sceneFile = await saveCinematicScene(
      join(directory, 'scene.json'),
      transferScene(kind, hostFile, geometryFile),
    );
    await writeFile(
      join(directory, 'host-contract-report.json'),
      `${JSON.stringify({ schemaVersion: 1, kind, host: host.metadata.hostContract, asset: geometry.metadata.hostContract, exactPortableGeometryReused: true }, null, 2)}\n`,
      'utf8',
    );
    transfers.push({
      kind,
      directory,
      sceneFile,
      render: await renderCinematicScene(sceneFile, directory),
    });
  }

  const metadataFile = await writeHashedAssetMetadata(
    join(output, 'asset.yaml'),
    assetMetadataSchema.parse({
      schemaVersion: 1,
      id: geometry.id,
      version: '0.1.0',
      type: 'prop',
      title: 'Architectural half-round rainwater system',
      description:
        'Project-owned portable open half-round gutter, visible eave brackets, hopper, wall-clipped downpipe and discharge shoe with configurable handedness and an explicit facade/eave host contract.',
      status: 'validated',
      tags: ['architecture', 'gutter', 'downpipe', 'rainwater', 'facade', 'portable-set-dressing'],
      capabilities: [
        'portable-geometry',
        'physically-open-gutter-trough',
        'configurable-left-right-outlet',
        'facade-eave-host-contract',
        'visible-eave-and-wall-mounts',
        'named-water-discharge-attachment',
        'metre-scaled-patinated-metal',
        'cross-environment-transfer',
      ],
      source: {
        kind: 'procedural',
        generator: 'videoer.architectural-rainwater-system.v1',
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
        { role: 'surface-definition', path: 'surface.json', mediaType: 'application/json' },
        { role: 'validation', path: 'validation.json', mediaType: 'application/json' },
        ...transfers.flatMap((transfer) => [
          {
            role: `${transfer.kind}-contact-sheet`,
            path: `verification/${transfer.kind}/contact-sheet.png`,
            mediaType: 'image/png',
          },
          {
            role: `${transfer.kind}-render-report`,
            path: `verification/${transfer.kind}/scene-render.json`,
            mediaType: 'application/json',
          },
          {
            role: `${transfer.kind}-host-contract-report`,
            path: `verification/${transfer.kind}/host-contract-report.json`,
            mediaType: 'application/json',
          },
        ]),
      ],
      compatibility: {
        coordinateSystem: 'right-handed-y-up-forward-negative-z-metres',
        renderers: ['three-3d', 'blender-headless'],
        requires: [],
      },
      verification: {
        checks: [
          'geometry.topology',
          'geometry.open-trough-aperture',
          'module.facade-eave-host-compatible',
          'module.mounts-and-discharge-explicit',
          'material.metre-scaled-patinated-metal',
          'visual.old-city-host-generated-not-accepted',
          'visual.contemporary-host-generated-not-accepted',
        ],
        artifacts: transfers.flatMap((transfer) => [
          `verification/${transfer.kind}/contact-sheet.png`,
          `verification/${transfer.kind}/scene-render.json`,
          `verification/${transfer.kind}/host-contract-report.json`,
        ]),
        verifiedAt: new Date().toISOString(),
      },
    }),
  );
  return { output, geometryFile, metadataFile, validation, transfers };
}
