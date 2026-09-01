import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderCinematicScene } from '../cinematic/blender.js';
import { saveCinematicScene } from '../cinematic/io.js';
import { cinematicSceneSchema } from '../cinematic/model.js';
import { saveGeometry } from '../geometry/io.js';
import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import { validateGeometry } from '../geometry/model.js';
import { boxPart, mergeMeshParts } from '../geometry/primitives.js';
import { createOldCitySurfacePresets } from '../materials/old-city.js';
import { createProjectingHangingSign } from '../props/projecting-sign.js';

type HostKind = 'old-city-bookshop' | 'adaptive-reuse-cafe';

function material(
  id: string,
  baseColor: [number, number, number, number],
  roughness: number,
  metallic = 0,
): GeometryMaterial {
  return { id, baseColor, roughness, metallic, emission: [0, 0, 0], emissionStrength: 0 };
}

function signHost(kind: HostKind): GeometryAsset {
  const surfaces = new Map(
    createOldCitySurfacePresets().map((preset) => [preset.id, preset.material]),
  );
  const parts = [
    boxPart([-5, -0.16, -5], [5, 0, 3], 0, 'ground'),
    boxPart([-3.3, 0, 0], [3.3, 5.1, 0.32], 0, 'wall'),
    boxPart([-1.15, 0.08, -0.08], [1.15, 2.55, 0.04], 0, 'door'),
  ];
  if (kind === 'old-city-bookshop') {
    parts.push(
      boxPart([-3.45, 4.72, -0.08], [3.45, 5.08, 0.52], 0, 'timber'),
      boxPart([-2.92, 0.12, -0.06], [-2.73, 4.7, 0.15], 0, 'timber'),
      boxPart([2.72, 0.12, -0.06], [2.91, 4.7, 0.15], 0, 'timber'),
      boxPart([-2.35, 1.25, -0.07], [-1.4, 2.85, 0.03], 0, 'window'),
      boxPart([1.4, 1.25, -0.07], [2.35, 2.85, 0.03], 0, 'window'),
    );
  } else {
    parts.push(
      boxPart([-3.45, 4.68, -0.1], [3.45, 5.12, 0.5], 0, 'steel'),
      boxPart([-3.46, 0, -0.055], [-3.26, 5.12, 0.4], 0, 'steel'),
      boxPart([3.26, 0, -0.055], [3.46, 5.12, 0.4], 0, 'steel'),
      boxPart([-2.45, 1.18, -0.075], [-1.45, 3.15, 0.035], 0, 'window'),
      boxPart([1.45, 1.18, -0.075], [2.45, 3.15, 0.035], 0, 'window'),
      boxPart([-0.36, 2.72, -0.09], [0.36, 3.02, 0.025], 0, 'steel'),
    );
  }
  const geometry = mergeMeshParts(
    `environment.${kind}-projecting-sign-host`,
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.projecting-sign-host-witness.v1',
      environmentClass: kind,
      verificationOnly: true,
      hostContract: {
        kind: 'vertical-facade-mount',
        facadePlaneZ: 0,
        mountHeightMeters: 3.35,
        clearanceVolumeAvailable: true,
      },
    },
  );
  geometry.materials =
    kind === 'old-city-bookshop'
      ? [
          {
            ...material('ground', [0.12, 0.13, 0.14, 1], 0.58),
            surface: surfaces.get('limestone-trim'),
          },
          {
            ...material('wall', [0.17, 0.155, 0.13, 1], 0.75),
            surface: surfaces.get('rain-aged-plaster'),
          },
          {
            ...material('timber', [0.075, 0.021, 0.008, 1], 0.61),
            surface: surfaces.get('weathered-wood'),
          },
          material('door', [0.055, 0.015, 0.006, 1], 0.65),
          material('window', [0.008, 0.014, 0.021, 1], 0.18),
        ]
      : [
          material('ground', [0.105, 0.115, 0.125, 1], 0.53),
          {
            ...material('wall', [0.16, 0.052, 0.026, 1], 0.7),
            surface: surfaces.get('dark-brick'),
          },
          material('steel', [0.025, 0.042, 0.06, 1], 0.31, 0.72),
          material('door', [0.055, 0.07, 0.085, 1], 0.43, 0.34),
          material('window', [0.015, 0.025, 0.037, 1], 0.16),
        ];
  return geometry;
}

function transferScene(kind: HostKind, hostPath: string, signPath: string) {
  const mountHeight = 3.35;
  return cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: `scene.projecting-sign-${kind}-transfer`,
    durationSeconds: 0.125,
    fps: 24,
    resolution: { width: 720, height: 480, percentage: 100 },
    entities: [
      { id: 'host', role: 'environment', geometryPath: hostPath },
      {
        id: 'projecting-sign',
        role: 'prop',
        geometryPath: signPath,
        transform: { position: [0, mountHeight, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    ],
    camera: {
      keyframes: [
        { time: 0, position: [5.25, 3.25, -4.9], target: [0, 2.78, -0.66], lensMillimeters: 62 },
        {
          time: 0.0625,
          position: [3.5, 3.65, -6.2],
          target: [0, 3.02, -0.58],
          lensMillimeters: 58,
        },
        {
          time: 0.125,
          position: [-5.25, 3.25, -4.9],
          target: [0, 2.78, -0.66],
          lensMillimeters: 62,
        },
      ],
    },
    lights: [
      {
        id: 'cool-facade-key',
        type: 'area',
        position: kind === 'old-city-bookshop' ? [-3.8, 6.4, -3.8] : [4.2, 6.8, -3.6],
        target: [0, 2.8, -0.6],
        color: kind === 'old-city-bookshop' ? [0.35, 0.48, 0.72] : [0.5, 0.64, 0.86],
        energy: kind === 'old-city-bookshop' ? 720 : 900,
        sizeMeters: 4.4,
      },
      {
        id: 'warm-sign-edge',
        type: 'area',
        position: kind === 'old-city-bookshop' ? [3.6, 4.3, -2.4] : [-3.5, 4.5, -2.5],
        target: [0, 2.75, -0.7],
        color: [1, 0.4, 0.14],
        energy: kind === 'old-city-bookshop' ? 280 : 340,
        sizeMeters: 1.8,
      },
    ],
    atmosphere: {
      worldColor: kind === 'old-city-bookshop' ? [0.008, 0.013, 0.024] : [0.017, 0.027, 0.043],
      fogDensity: kind === 'old-city-bookshop' ? 0.003 : 0.001,
      fogColor: [0.07, 0.1, 0.16],
    },
    renderProfile: {
      engine: 'cycles-cpu',
      samples: 128,
      seed: 1729,
      denoise: true,
      intent: 'deterministic-final',
    },
    renderGates: [
      { id: 'sign-scene-visible', type: 'frame-visibility', maximumBlackPercentage: 62 },
      { id: 'sign-highlight-detail', type: 'frame-overexposure', maximumWhitePercentage: 4 },
      {
        id: 'sign-framing',
        type: 'subject-framing',
        entityId: 'projecting-sign',
        minimumScreenHeightPercentage: 34,
        maximumScreenHeightPercentage: 76,
        marginPercentage: 3,
      },
      {
        id: 'sign-local-highlight-detail',
        type: 'subject-overexposure',
        entityId: 'projecting-sign',
        maximumWhitePercentage: 4,
      },
    ],
    landmarks: [
      {
        id: 'front-face',
        progress: 0,
        description: 'Front sign face, emblem, frame and chain silhouette',
      },
      {
        id: 'mount-context',
        progress: 0.5,
        description: 'Facade plate, smooth bracket load path and projecting clearance',
      },
      {
        id: 'back-face',
        progress: 1,
        description: 'Opposite sign face and two-sided content treatment',
      },
    ],
    metadata: {
      verificationPurpose: 'portable-two-sided-projecting-sign-cross-environment-transfer',
      hostClass: kind,
      exactPortableGeometryReused: true,
      mountHeightMeters: mountHeight,
    },
  });
}

export async function createProjectingHangingSignAsset(outputDirectory: string) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const geometry = createProjectingHangingSign();
  const validation = validateGeometry(geometry);
  if (!validation.valid)
    throw new Error(
      `Projecting sign failed geometry validation: ${validation.issues.map((issue) => issue.code).join(', ')}`,
    );
  const geometryFile = await saveGeometry(join(output, 'geometry.json'), geometry);
  await writeFile(
    join(output, 'validation.json'),
    `${JSON.stringify(validation, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(output, 'content-contract.json'),
    `${JSON.stringify(geometry.metadata.contentContract, null, 2)}\n`,
    'utf8',
  );
  const transfers = [];
  for (const kind of ['old-city-bookshop', 'adaptive-reuse-cafe'] as const) {
    const directory = join(output, 'verification', kind);
    await mkdir(directory, { recursive: true });
    const host = signHost(kind);
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
      title: 'Projecting two-sided hanging sign',
      description:
        'Project-owned facade sign with smooth forged bracket, alternating chain links, framed two-sided weathered board, replaceable content contract and neutral embossed book emblem.',
      status: 'validated',
      tags: ['signage', 'shop-sign', 'facade', 'wayfinding', 'portable-set-dressing'],
      capabilities: [
        'portable-geometry',
        'vertical-facade-host-contract',
        'two-sided-sign-face',
        'replaceable-campaign-content-slot',
        'smooth-swept-bracket-hardware',
        'explicit-chain-link-geometry',
        'named-mount-pivot-and-face-attachments',
        'cross-environment-transfer',
      ],
      source: {
        kind: 'procedural',
        generator: 'videoer.projecting-hanging-sign.v1',
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
        { role: 'content-contract', path: 'content-contract.json', mediaType: 'application/json' },
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
          'geometry.swept-bracket-and-closed-chain-links',
          'module.vertical-facade-host-compatible',
          'module.two-sided-content-contract',
          'visual.old-city-host-generated-not-accepted',
          'visual.adaptive-reuse-host-generated-not-accepted',
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
