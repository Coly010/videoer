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
import { createProjectingSupportedCanopy } from '../props/projecting-canopy.js';

type HostKind = 'old-city-shopfront' | 'contemporary-gallery-entrance';

function material(
  id: string,
  color: [number, number, number, number],
  roughness: number,
  metallic = 0,
): GeometryMaterial {
  return { id, baseColor: color, roughness, metallic, emission: [0, 0, 0], emissionStrength: 0 };
}

function canopyHost(kind: HostKind): GeometryAsset {
  const surfaces = new Map(
    createOldCitySurfacePresets().map((preset) => [preset.id, preset.material]),
  );
  const parts = [
    boxPart([-5.5, -0.16, -5], [5.5, 0, 3], 0, 'ground'),
    boxPart([-3.65, 0, 0], [3.65, 5.4, 0.34], 0, 'wall'),
    boxPart([-1.35, 0.08, -0.07], [1.35, 2.85, 0.04], 0, 'door'),
  ];
  if (kind === 'old-city-shopfront') {
    parts.push(
      boxPart([-3.55, 0.12, -0.055], [-3.35, 5.2, 0.16], 0, 'timber'),
      boxPart([3.35, 0.12, -0.055], [3.55, 5.2, 0.16], 0, 'timber'),
      boxPart([-3.55, 4.8, -0.06], [3.55, 5.08, 0.5], 0, 'timber'),
      boxPart([-2.75, 1.1, -0.065], [-1.6, 3.12, 0.025], 0, 'window'),
      boxPart([1.6, 1.1, -0.065], [2.75, 3.12, 0.025], 0, 'window'),
    );
  } else {
    parts.push(
      boxPart([-3.76, 0, -0.06], [-3.56, 5.42, 0.42], 0, 'steel'),
      boxPart([3.56, 0, -0.06], [3.76, 5.42, 0.42], 0, 'steel'),
      boxPart([-3.76, 4.95, -0.07], [3.76, 5.35, 0.46], 0, 'steel'),
      boxPart([-2.8, 0.95, -0.075], [-1.58, 3.3, 0.03], 0, 'window'),
      boxPart([1.58, 0.95, -0.075], [2.8, 3.3, 0.03], 0, 'window'),
      boxPart([-0.45, 3.02, -0.085], [0.45, 3.28, 0.025], 0, 'steel'),
    );
  }
  const geometry = mergeMeshParts(
    `environment.${kind}-canopy-host`,
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.projecting-canopy-host-witness.v1',
      environmentClass: kind,
      verificationOnly: true,
      hostContract: {
        kind: 'vertical-facade-canopy-mount',
        facadePlaneZ: 0,
        mountHeightMeters: 4.05,
        clearWallSpanMeters: 7.3,
        clearanceVolumeAvailable: true,
      },
    },
  );
  geometry.materials =
    kind === 'old-city-shopfront'
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
          material('door', [0.055, 0.015, 0.006, 1], 0.66),
          material('window', [0.008, 0.014, 0.021, 1], 0.18),
        ]
      : [
          material('ground', [0.105, 0.115, 0.125, 1], 0.53),
          material('wall', [0.21, 0.22, 0.23, 1], 0.79),
          material('steel', [0.024, 0.041, 0.058, 1], 0.31, 0.72),
          material('door', [0.052, 0.068, 0.082, 1], 0.43, 0.34),
          material('window', [0.014, 0.024, 0.036, 1], 0.16),
        ];
  return geometry;
}

function transferScene(kind: HostKind, hostPath: string, canopyPath: string) {
  const mountHeight = 4.05;
  return cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: `scene.projecting-canopy-${kind}-transfer`,
    durationSeconds: 0.125,
    fps: 24,
    resolution: { width: 720, height: 480, percentage: 100 },
    entities: [
      { id: 'host', role: 'environment', geometryPath: hostPath },
      {
        id: 'projecting-canopy',
        role: 'prop',
        geometryPath: canopyPath,
        transform: { position: [0, mountHeight, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    ],
    camera: {
      keyframes: [
        { time: 0, position: [5.4, 5.45, -7.3], target: [0, 4.0, -0.5], lensMillimeters: 54 },
        { time: 0.0625, position: [0, 3.05, -8.6], target: [0, 3.86, -0.52], lensMillimeters: 48 },
        { time: 0.125, position: [-5.4, 4.25, -7.3], target: [0, 3.96, -0.5], lensMillimeters: 54 },
      ],
    },
    lights: [
      {
        id: 'cool-roof-key',
        type: 'area',
        position: kind === 'old-city-shopfront' ? [-3.8, 7.6, -4.5] : [4.4, 8, -4.2],
        target: [0, 4, -0.5],
        color: kind === 'old-city-shopfront' ? [0.35, 0.48, 0.72] : [0.5, 0.65, 0.87],
        energy: kind === 'old-city-shopfront' ? 780 : 980,
        sizeMeters: 4.8,
      },
      {
        id: 'warm-soffit-edge',
        type: 'area',
        position: kind === 'old-city-shopfront' ? [3.8, 3.4, -2.5] : [-4, 3.5, -2.7],
        target: [0, 3.75, -0.55],
        color: [1, 0.4, 0.14],
        energy: kind === 'old-city-shopfront' ? 330 : 390,
        sizeMeters: 2.1,
      },
    ],
    atmosphere: {
      worldColor: kind === 'old-city-shopfront' ? [0.008, 0.013, 0.024] : [0.017, 0.027, 0.043],
      fogDensity: kind === 'old-city-shopfront' ? 0.003 : 0.001,
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
      { id: 'canopy-scene-visible', type: 'frame-visibility', maximumBlackPercentage: 62 },
      { id: 'canopy-highlight-detail', type: 'frame-overexposure', maximumWhitePercentage: 4 },
      {
        id: 'canopy-framing',
        type: 'subject-framing',
        entityId: 'projecting-canopy',
        minimumScreenHeightPercentage: 12,
        maximumScreenHeightPercentage: 46,
        marginPercentage: 3,
      },
      {
        id: 'canopy-local-highlight-detail',
        type: 'subject-overexposure',
        entityId: 'projecting-canopy',
        maximumWhitePercentage: 4,
      },
    ],
    landmarks: [
      {
        id: 'elevated-roof',
        progress: 0,
        description: 'Layered sloped covering, flashing and front drainage edge',
      },
      {
        id: 'underside-support',
        progress: 0.5,
        description: 'Seven soffit boards and complete three-bracket load paths',
      },
      {
        id: 'left-context',
        progress: 1,
        description: 'Opposite facade integration, fascia and material separation',
      },
    ],
    metadata: {
      verificationPurpose: 'portable-layered-supported-canopy-cross-environment-transfer',
      hostClass: kind,
      exactPortableGeometryReused: true,
      mountHeightMeters: mountHeight,
    },
  });
}

export async function createProjectingSupportedCanopyAsset(outputDirectory: string) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const geometry = createProjectingSupportedCanopy();
  const validation = validateGeometry(geometry);
  if (!validation.valid)
    throw new Error(
      `Projecting canopy failed geometry validation: ${validation.issues.map((issue) => issue.code).join(', ')}`,
    );
  const geometryFile = await saveGeometry(join(output, 'geometry.json'), geometry);
  await writeFile(
    join(output, 'validation.json'),
    `${JSON.stringify(validation, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(output, 'construction-contract.json'),
    `${JSON.stringify({ roofDrainage: geometry.metadata.roofDrainage, construction: geometry.metadata.construction }, null, 2)}\n`,
    'utf8',
  );
  const transfers = [];
  for (const kind of ['old-city-shopfront', 'contemporary-gallery-entrance'] as const) {
    const directory = join(output, 'verification', kind);
    await mkdir(directory, { recursive: true });
    const host = canopyHost(kind);
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
      title: 'Layered projecting supported canopy',
      description:
        'Project-owned sloped facade canopy with slate covering, structural timber deck, seven-board soffit, metal flashing, fascia, three double-rail iron brackets, rainwater mounts and practical-light anchors.',
      status: 'validated',
      tags: ['architecture', 'canopy', 'eave', 'shopfront', 'facade', 'portable-set-dressing'],
      capabilities: [
        'portable-geometry',
        'vertical-facade-canopy-host-contract',
        'physical-single-fall-roof',
        'layered-slate-timber-flashing-construction',
        'visible-three-bracket-load-path',
        'named-rainwater-mounts',
        'named-underside-practical-anchors',
        'cross-environment-transfer',
      ],
      source: {
        kind: 'procedural',
        generator: 'videoer.projecting-supported-canopy.v1',
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
          role: 'construction-contract',
          path: 'construction-contract.json',
          mediaType: 'application/json',
        },
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
          'construction.layered-single-fall-roof',
          'construction.soffit-and-bracket-counts',
          'module.vertical-facade-host-compatible',
          'module.rainwater-and-practical-anchors',
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
