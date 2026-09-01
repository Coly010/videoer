import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderCinematicScene } from '../cinematic/blender.js';
import { saveCinematicScene } from '../cinematic/io.js';
import { cinematicSceneSchema } from '../cinematic/model.js';
import { wallWithRectangularOpeningsParts } from '../environments/architectural-modules.js';
import { saveGeometry } from '../geometry/io.js';
import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import { validateGeometry } from '../geometry/model.js';
import { boxPart, mergeMeshParts } from '../geometry/primitives.js';
import { createOldCitySurfacePresets } from '../materials/old-city.js';
import { createInsetArchitecturalWindow, insetWindowOpening } from '../props/inset-window.js';

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

function windowHostWitness(kind: 'old-city-brick' | 'contemporary-plaster'): GeometryAsset {
  const openingMinimumY = 1.42;
  const openingMaximumY = openingMinimumY + insetWindowOpening.heightMeters;
  const wallThickness = kind === 'old-city-brick' ? 0.3 : 0.26;
  const surfaces = new Map(
    createOldCitySurfacePresets().map((preset) => [preset.id, preset.material]),
  );
  const parts = [
    boxPart([-4.8, -0.14, -4], [4.8, 0, 2.8], 0, 'floor'),
    ...wallWithRectangularOpeningsParts({
      minimumX: -3.2,
      maximumX: 3.2,
      minimumY: 0,
      maximumY: 4.1,
      frontZ: 0,
      backZ: wallThickness,
      materialId: 'host-wall',
      openings: [
        {
          id: 'window-aperture',
          minimumX: -insetWindowOpening.widthMeters * 0.5,
          maximumX: insetWindowOpening.widthMeters * 0.5,
          minimumY: openingMinimumY,
          maximumY: openingMaximumY,
        },
      ],
    }),
    // A real room witness remains behind the aperture rather than occupying the wall plane.
    boxPart([-3.2, 0, 2.55], [3.2, 4.1, 2.75], 0, 'interior-wall'),
    boxPart([-3.2, 0, wallThickness], [-3, 4.1, 2.75], 0, 'interior-wall'),
    boxPart([3, 0, wallThickness], [3.2, 4.1, 2.75], 0, 'interior-wall'),
  ];
  if (kind === 'contemporary-plaster') {
    parts.push(
      boxPart([-3.45, 0, -0.05], [-3.18, 4.35, 0.35], 0, 'painted-steel'),
      boxPart([3.18, 0, -0.05], [3.45, 4.35, 0.35], 0, 'painted-steel'),
      boxPart([-3.45, 4.08, -0.05], [3.45, 4.35, 0.35], 0, 'painted-steel'),
      boxPart([0.24, 0.45, 2.08], [0.34, 3.55, 2.48], 0, 'painted-steel'),
      boxPart([-1.2, 1.72, 2.08], [1.2, 1.82, 2.48], 0, 'painted-steel'),
    );
  } else {
    parts.push(
      boxPart([-0.28, 0.45, 2.08], [-0.16, 3.55, 2.48], 0, 'interior-timber'),
      boxPart([-1.2, 1.66, 2.08], [1.2, 1.78, 2.48], 0, 'interior-timber'),
    );
  }
  const geometry = mergeMeshParts(
    `environment.${kind}-window-host-witness`,
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.architectural-window-host-witness.v1',
      environmentClass: kind,
      verificationOnly: true,
      wallThicknessMeters: wallThickness,
      opening: {
        minimumX: -insetWindowOpening.widthMeters * 0.5,
        maximumX: insetWindowOpening.widthMeters * 0.5,
        minimumY: openingMinimumY,
        maximumY: openingMaximumY,
      },
    },
  );
  geometry.materials =
    kind === 'old-city-brick'
      ? [
          {
            ...material('floor', [0.12, 0.13, 0.14, 1], 0.58),
            surface: surfaces.get('limestone-trim'),
          },
          {
            ...material('host-wall', [0.11, 0.035, 0.018, 1], 0.74),
            surface: surfaces.get('dark-brick'),
          },
          {
            ...material('interior-wall', [0.24, 0.12, 0.055, 1], 0.76),
            surface: surfaces.get('warm-interior-plaster'),
          },
          {
            ...material('interior-timber', [0.09, 0.025, 0.008, 1], 0.6),
            surface: surfaces.get('weathered-wood'),
          },
        ]
      : [
          material('floor', [0.11, 0.12, 0.13, 1], 0.48),
          {
            ...material('host-wall', [0.22, 0.23, 0.24, 1], 0.72),
            surface: surfaces.get('rain-aged-plaster'),
          },
          material('interior-wall', [0.17, 0.18, 0.2, 1], 0.8),
          material('painted-steel', [0.025, 0.04, 0.055, 1], 0.31, 0.74),
        ];
  return geometry;
}

function windowTransferScene(
  kind: 'old-city-brick' | 'contemporary-plaster',
  witnessPath: string,
  windowPath: string,
) {
  return cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: `scene.inset-window-${kind}-transfer`,
    durationSeconds: 0.125,
    fps: 24,
    resolution: { width: 720, height: 480, percentage: 100 },
    entities: [
      { id: 'host-wall', role: 'environment', geometryPath: witnessPath },
      {
        id: 'inset-window',
        role: 'prop',
        geometryPath: windowPath,
        transform: { position: [0, 1.42, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    ],
    camera: {
      keyframes: [
        {
          time: 0,
          position: [2.65, 2.25, -4.5],
          target: [0, 1.92, 0.08],
          lensMillimeters: 58,
        },
        {
          time: 0.0625,
          position: [0, 2.02, -4.2],
          target: [0, 1.92, 0.1],
          lensMillimeters: 62,
        },
        {
          time: 0.125,
          position: [-2.65, 2.25, -4.5],
          target: [0, 1.92, 0.08],
          lensMillimeters: 58,
        },
      ],
    },
    lights: [
      {
        id: 'cool-exterior-key',
        type: 'area',
        position: kind === 'old-city-brick' ? [0, 4.8, -3.2] : [0, 5.1, -3.4],
        target: [0, 1.9, 0],
        color: kind === 'old-city-brick' ? [0.3, 0.44, 0.7] : [0.48, 0.62, 0.82],
        energy: kind === 'old-city-brick' ? 520 : 680,
        sizeMeters: 3.4,
      },
      {
        id: 'interior-warmth',
        type: 'point',
        position: [1.65, 3.15, 1.85],
        color: [1, 0.35, 0.1],
        energy: kind === 'old-city-brick' ? 125 : 95,
        sizeMeters: 0.12,
      },
    ],
    atmosphere: {
      worldColor: kind === 'old-city-brick' ? [0.008, 0.014, 0.026] : [0.016, 0.025, 0.04],
      fogDensity: kind === 'old-city-brick' ? 0.004 : 0.001,
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
      { id: 'window-scene-visible', type: 'frame-visibility', maximumBlackPercentage: 62 },
      { id: 'window-highlight-detail', type: 'frame-overexposure', maximumWhitePercentage: 5 },
      {
        id: 'window-framing',
        type: 'subject-framing',
        entityId: 'inset-window',
        minimumScreenHeightPercentage: 50,
        maximumScreenHeightPercentage: 80,
        marginPercentage: 3,
      },
      {
        id: 'window-local-highlight-detail',
        type: 'subject-overexposure',
        entityId: 'inset-window',
        maximumWhitePercentage: 4,
      },
    ],
    landmarks: [
      {
        id: 'right-glancing',
        progress: 0,
        description: 'Reveal, sill projection and right glancing reflection',
      },
      {
        id: 'frontal',
        progress: 0.5,
        description: 'True aperture, cross mullions and retained interior witness',
      },
      {
        id: 'left-glancing',
        progress: 1,
        description: 'Opposite reveal and angle-varying glazing response',
      },
    ],
    metadata: {
      verificationPurpose: 'portable-window-module-host-aperture-and-material-transfer',
      hostClass: kind,
      requiredCutout: true,
    },
  });
}

export async function createInsetArchitecturalWindowAsset(outputDirectory: string) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const window = createInsetArchitecturalWindow();
  const validation = validateGeometry(window);
  if (!validation.valid)
    throw new Error(
      `Inset window failed geometry validation: ${validation.issues.map((issue) => issue.code).join(', ')}`,
    );
  const geometryFile = await saveGeometry(join(output, 'geometry.json'), window);
  await writeFile(
    join(output, 'validation.json'),
    `${JSON.stringify(validation, null, 2)}\n`,
    'utf8',
  );
  const transfers = [];
  for (const kind of ['old-city-brick', 'contemporary-plaster'] as const) {
    const directory = join(output, 'verification', kind);
    await mkdir(directory, { recursive: true });
    const witness = windowHostWitness(kind);
    const witnessFile = await saveGeometry(join(directory, 'witness-geometry.json'), witness);
    const sceneFile = await saveCinematicScene(
      join(directory, 'scene.json'),
      windowTransferScene(kind, witnessFile, geometryFile),
    );
    await writeFile(
      join(directory, 'host-opening-report.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind,
          wallThicknessMeters: witness.metadata.wallThicknessMeters,
          opening: witness.metadata.opening,
          moduleHostContract: window.metadata.hostContract,
          cutoutGeneratedBy: 'wallWithRectangularOpeningsParts',
        },
        null,
        2,
      )}\n`,
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
      id: window.id,
      version: '0.1.0',
      type: 'prop',
      title: 'Inset architectural cross window',
      description:
        'Project-owned wall-opening module with projecting sill, deep reveal, painted timber frame, cross mullions, physical 8 mm glazing, dim interior witness and an explicit host cutout contract.',
      status: 'validated',
      tags: ['window', 'architecture', 'wall-opening', 'glazing', 'portable-set-dressing'],
      capabilities: [
        'portable-geometry',
        'rectangular-host-cutout-contract',
        'physical-eight-millimetre-glazing',
        'deep-wall-reveal',
        'named-wall-mount-and-focus-points',
        'cross-environment-transfer',
      ],
      source: {
        kind: 'procedural',
        generator: 'videoer.inset-architectural-window.v1',
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
            role: `${transfer.kind}-host-opening-report`,
            path: `verification/${transfer.kind}/host-opening-report.json`,
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
          'module.host-cutout-required',
          'module.host-wall-thickness-compatible',
          'material.physical-eight-millimetre-glazing',
          'visual.old-city-host-generated-not-accepted',
          'visual.contemporary-host-generated-not-accepted',
        ],
        artifacts: transfers.flatMap((transfer) => [
          `verification/${transfer.kind}/contact-sheet.png`,
          `verification/${transfer.kind}/scene-render.json`,
          `verification/${transfer.kind}/host-opening-report.json`,
        ]),
        verifiedAt: new Date().toISOString(),
      },
    }),
  );
  return { output, geometryFile, metadataFile, validation, transfers };
}
