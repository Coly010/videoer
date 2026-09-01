import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderCinematicProbe, renderCinematicScene } from '../cinematic/blender.js';
import { saveCinematicScene } from '../cinematic/io.js';
import { cinematicSceneSchema } from '../cinematic/model.js';
import { saveGeometry } from '../geometry/io.js';
import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import { validateGeometry } from '../geometry/model.js';
import {
  boxPart,
  mergeMeshParts,
  surfaceOfRevolutionPart,
  type MeshPart,
} from '../geometry/primitives.js';
import { createHearthSmokeAndEmbersVfx, resolveAerosolVfx } from '../vfx/aerosol.js';
import { saveAerosolVfx } from '../vfx/io.js';

type AerosolHost = 'historic-forge' | 'contemporary-metal-shop';

const rootSkeleton: GeometryAsset['skeleton'] = [
  { id: 'root', restPosition: [0, 0, 0], constraints: {} },
];

const material = (
  id: string,
  color: [number, number, number, number],
  roughness: number,
  metallic = 0,
  emission: [number, number, number] = [0, 0, 0],
  emissionStrength = 0,
): GeometryMaterial => ({
  id,
  baseColor: color,
  roughness,
  metallic,
  emission,
  emissionStrength,
});

function aerosolSource(kind: AerosolHost): GeometryAsset {
  const historic = kind === 'historic-forge';
  const parts: MeshPart[] = historic
    ? [
        boxPart([-0.72, 0, -0.48], [0.72, 0.42, 0.48], 0, 'forge-stone'),
        boxPart([-0.55, 0.39, -0.38], [0.55, 0.51, 0.38], 0, 'forge-iron'),
        surfaceOfRevolutionPart(
          [
            { radius: 0.34, y: 0.49 },
            { radius: 0.42, y: 0.56 },
            { radius: 0.38, y: 0.66 },
          ],
          24,
          0,
          'forge-iron',
          true,
        ),
        surfaceOfRevolutionPart(
          [
            { radius: 0.29, y: 0.655 },
            { radius: 0.3, y: 0.68 },
          ],
          20,
          0,
          'hot-coals',
          true,
        ),
      ]
    : [
        boxPart([-0.68, 0, -0.5], [0.68, 0.82, 0.5], 0, 'machine-steel'),
        boxPart([-0.5, 0.78, -0.42], [0.5, 1.04, 0.42], 0, 'heat-chamber'),
        surfaceOfRevolutionPart(
          [
            { radius: 0.31, y: 1.03 },
            { radius: 0.31, y: 1.18 },
            { radius: 0.24, y: 1.31 },
          ],
          24,
          0,
          'machine-steel',
          false,
        ),
        boxPart([-0.38, 0.86, -0.515], [0.38, 0.95, -0.49], 0, 'hot-slot'),
      ];
  const geometry = mergeMeshParts(`prop.${kind}-aerosol-source`, parts, rootSkeleton, {
    generator: 'videoer.aerosol-source-witness.v1',
    verificationOnly: true,
    sourceKind: historic ? 'open-forge-brazier' : 'metal-shop-heat-exhaust',
  });
  geometry.materials = historic
    ? [
        material('forge-stone', [0.12, 0.085, 0.055, 1], 0.82),
        material('forge-iron', [0.035, 0.042, 0.045, 1], 0.38, 0.82),
        material('hot-coals', [0.13, 0.008, 0.001, 1], 0.5, 0, [1, 0.04, 0.002], 3.8),
      ]
    : [
        material('machine-steel', [0.045, 0.065, 0.075, 1], 0.32, 0.78),
        material('heat-chamber', [0.024, 0.029, 0.031, 1], 0.46, 0.66),
        material('hot-slot', [0.14, 0.006, 0.001, 1], 0.38, 0, [1, 0.035, 0.002], 4.2),
      ];
  geometry.attachments = {
    'ground-origin': { position: [0, 0, 0], rotation: [0, 0, 0] },
    'aerosol-origin': {
      position: historic ? [0, 0.68, 0] : [0, 1.31, 0],
      rotation: [0, 0, 0],
    },
  };
  return geometry;
}

function aerosolContext(kind: AerosolHost): GeometryAsset {
  const historic = kind === 'historic-forge';
  const parts: MeshPart[] = historic
    ? [
        boxPart([-4.5, -0.18, -3.7], [4.5, 0, 3.7], 0, 'stone-floor'),
        boxPart([-4.5, 0, 3.35], [4.5, 4.6, 3.68], 0, 'soot-brick'),
        boxPart([-1.3, 0, 2.76], [-0.76, 2.55, 3.35], 0, 'forge-stone'),
        boxPart([0.76, 0, 2.76], [1.3, 2.55, 3.35], 0, 'forge-stone'),
        boxPart([-1.3, 2.2, 2.76], [1.3, 2.62, 3.35], 0, 'forge-stone'),
        boxPart([-3.6, 0.05, 2.7], [-2.15, 0.74, 3.2], 0, 'workbench'),
        boxPart([2.15, 0.05, 2.7], [3.6, 0.74, 3.2], 0, 'workbench'),
      ]
    : [
        boxPart([-4.8, -0.16, -3.9], [4.8, 0, 3.9], 0, 'shop-floor'),
        boxPart([-4.8, 0, 3.5], [4.8, 4.2, 3.82], 0, 'shop-wall'),
        boxPart([-1.55, 1.8, 2.82], [1.55, 2.08, 3.48], 0, 'extraction-hood'),
        boxPart([-1.7, 1.55, 3.08], [-1.42, 3.8, 3.48], 0, 'shop-steel'),
        boxPart([1.42, 1.55, 3.08], [1.7, 3.8, 3.48], 0, 'shop-steel'),
        boxPart([-4.15, 0.06, 2.72], [-2.25, 0.82, 3.3], 0, 'tool-cabinet'),
        boxPart([2.25, 0.06, 2.72], [4.15, 0.82, 3.3], 0, 'tool-cabinet'),
      ];
  const geometry = mergeMeshParts(`environment.${kind}-aerosol-context`, parts, rootSkeleton, {
    generator: 'videoer.aerosol-host-witness.v1',
    verificationOnly: true,
  });
  geometry.materials = historic
    ? [
        material('stone-floor', [0.14, 0.115, 0.085, 1], 0.8),
        material('soot-brick', [0.075, 0.028, 0.015, 1], 0.84),
        material('forge-stone', [0.16, 0.12, 0.085, 1], 0.82),
        material('workbench', [0.14, 0.048, 0.012, 1], 0.66),
      ]
    : [
        material('shop-floor', [0.13, 0.145, 0.15, 1], 0.58),
        material('shop-wall', [0.055, 0.075, 0.09, 1], 0.62, 0.18),
        material('extraction-hood', [0.065, 0.085, 0.095, 1], 0.28, 0.84),
        material('shop-steel', [0.035, 0.052, 0.064, 1], 0.32, 0.76),
        material('tool-cabinet', [0.11, 0.025, 0.012, 1], 0.46, 0.52),
      ];
  return geometry;
}

function aerosolScene(
  kind: AerosolHost,
  sourcePath: string,
  contextPath: string,
  sourceGeometry: GeometryAsset,
) {
  const historic = kind === 'historic-forge';
  const transform = {
    position: (historic ? [0.15, 0, 0.9] : [-0.2, 0, 0.75]) as [number, number, number],
    rotation: [0, historic ? -0.12 : 0.18, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
  };
  const vfx = createHearthSmokeAndEmbersVfx();
  const aerosols = resolveAerosolVfx(vfx, {
    entityId: 'aerosol-source',
    geometry: sourceGeometry,
    attachmentId: 'aerosol-origin',
    transform,
  });
  return cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: `scene.${kind}-source-bound-aerosol-transfer`,
    durationSeconds: 12 / 24,
    fps: 24,
    resolution: { width: 640, height: 400, percentage: 100 },
    entities: [
      { id: 'host-context', role: 'environment', geometryPath: contextPath },
      {
        id: 'aerosol-source',
        role: 'prop',
        geometryPath: sourcePath,
        transform,
      },
    ],
    camera: {
      keyframes: [
        {
          time: 0,
          position: historic ? [5.7, 2.35, -7.7] : [7, 2.7, -9.6],
          target: [0, 1.25, 0.85],
          lensMillimeters: 48,
        },
        {
          time: 0.25,
          position: historic ? [0.2, 2.15, -8.35] : [0.2, 2.35, -10.45],
          target: [0, 1.35, 0.85],
          lensMillimeters: 52,
        },
        {
          time: 0.5,
          position: historic ? [-5.5, 2.3, -7.5] : [-6.8, 2.65, -9.4],
          target: [0, 1.3, 0.85],
          lensMillimeters: 48,
        },
      ],
    },
    lights: [
      {
        id: 'cool-workspace-key',
        type: 'area',
        position: historic ? [-3.5, 6.2, -3.2] : [3.8, 6.5, -3.4],
        target: [0, 1, 0.8],
        color: historic ? [0.34, 0.45, 0.7] : [0.46, 0.62, 0.9],
        energy: historic ? 760 : 980,
        sizeMeters: 4.2,
      },
      {
        id: 'source-fire-light',
        type: 'point',
        position: historic ? [0.15, 0.9, 0.55] : [-0.2, 1.2, 0.35],
        color: [1, 0.16, 0.015],
        energy: historic ? 310 : 390,
        sizeMeters: 0.34,
      },
      {
        id: 'smoke-rim',
        type: 'area',
        position: historic ? [3.2, 4.4, 1.6] : [-3.4, 4.6, 1.8],
        target: [0, 1.7, 0.9],
        color: [0.7, 0.82, 1],
        energy: historic ? 330 : 410,
        sizeMeters: 2.3,
      },
      {
        id: 'smoke-backlight',
        type: 'area',
        position: historic ? [0.4, 3.5, 2.75] : [-0.4, 3.7, 2.9],
        target: [0, 1.65, -0.9],
        color: historic ? [0.5, 0.63, 0.9] : [0.58, 0.74, 1],
        energy: historic ? 320 : 410,
        sizeMeters: 1.3,
      },
    ],
    atmosphere: {
      worldColor: historic ? [0.006, 0.009, 0.015] : [0.012, 0.02, 0.032],
      fogDensity: historic ? 0.0015 : 0.0008,
      fogColor: [0.08, 0.1, 0.13],
      aerosols,
    },
    renderProfile: {
      engine: 'cycles-cpu',
      samples: 128,
      seed: 1729,
      denoise: true,
      intent: 'deterministic-final',
    },
    renderGates: [
      { id: 'aerosol-scene-visible', type: 'frame-visibility', maximumBlackPercentage: 66 },
      { id: 'aerosol-highlight-detail', type: 'frame-overexposure', maximumWhitePercentage: 3 },
      {
        id: 'aerosol-source-framed',
        type: 'subject-framing',
        entityId: 'aerosol-source',
        minimumScreenHeightPercentage: 8,
        maximumScreenHeightPercentage: 30,
        marginPercentage: 1,
      },
    ],
    landmarks: [
      { id: 'right-context', progress: 0, description: 'Right view of source-attached plume' },
      {
        id: 'frontal-plume',
        progress: 0.5,
        description: 'Frontal smoke volume and ember separation',
      },
      { id: 'left-context', progress: 1, description: 'Left view proving 3D depth and occlusion' },
    ],
    metadata: {
      verificationPurpose: 'source-bound-world-space-aerosol-transfer',
      hostClass: kind,
      sourceVfx: vfx.id,
      requiredAerosolKinds: ['smoke-volume', 'ember-particles'],
    },
  });
}

export async function createSourceBoundAerosolVfxAsset(
  outputDirectory: string,
  options: { renderMode?: 'probe' | 'full' } = {},
) {
  const output = resolve(outputDirectory);
  const verification = join(output, 'verification');
  await mkdir(verification, { recursive: true });
  const vfx = createHearthSmokeAndEmbersVfx();
  const vfxFile = await saveAerosolVfx(join(output, 'vfx.json'), vfx);
  const transfers = [];
  for (const kind of ['historic-forge', 'contemporary-metal-shop'] as const) {
    const directory = join(verification, kind);
    await mkdir(directory, { recursive: true });
    const source = aerosolSource(kind);
    const context = aerosolContext(kind);
    for (const geometry of [source, context]) {
      const validation = validateGeometry(geometry);
      if (!validation.valid)
        throw new Error(
          `${geometry.id} failed validation: ${validation.issues.map((issue) => issue.code).join(', ')}`,
        );
    }
    const sourcePath = await saveGeometry(join(directory, 'source-geometry.json'), source);
    const contextPath = await saveGeometry(join(directory, 'context-geometry.json'), context);
    const sceneFile = await saveCinematicScene(
      join(directory, 'scene.json'),
      aerosolScene(kind, sourcePath, contextPath, source),
    );
    const renderMode = options.renderMode ?? 'full';
    transfers.push({
      kind,
      directory,
      sourcePath,
      contextPath,
      sceneFile,
      render:
        renderMode === 'probe'
          ? await renderCinematicProbe(sceneFile, directory)
          : await renderCinematicScene(sceneFile, directory),
      renderMode,
    });
  }
  const artifact = (path: string) => relative(output, path);
  const metadata = await writeHashedAssetMetadata(
    join(output, 'asset.yaml'),
    assetMetadataSchema.parse({
      schemaVersion: 1,
      id: vfx.id,
      version: '0.1.0',
      type: 'vfx',
      title: 'Source-bound volumetric smoke and rising embers',
      description:
        'Renderer-independent source-relative aerosol system with true world-space noisy smoke volumes, emissive rising embers, deterministic turbulence and attachment-bound transfer.',
      status: 'validated',
      tags: ['smoke', 'embers', 'aerosol', 'volumetric', 'source-bound', 'world-space'],
      capabilities: [
        'source-relative-placement',
        'true-world-space-volume',
        'geometry-depth-occlusion',
        'deterministic-particles',
        'temporal-rise-and-turbulence',
        'cross-environment-transfer',
      ],
      source: {
        kind: 'procedural',
        generator: 'videoer.source-bound-aerosol.v1',
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
        { role: 'vfx', path: 'vfx.json', mediaType: 'application/vnd.videoer.vfx+json' },
        ...transfers.flatMap((transfer) => [
          {
            role: `${transfer.kind}-source`,
            path: artifact(transfer.sourcePath),
            mediaType: 'application/vnd.videoer.geometry+json',
          },
          {
            role: `${transfer.kind}-scene`,
            path: artifact(transfer.sceneFile),
            mediaType: 'application/vnd.videoer.cinematic-scene+json',
          },
          {
            role: `${transfer.kind}-contact-sheet`,
            path: artifact(join(transfer.directory, 'contact-sheet.png')),
            mediaType: 'image/png',
          },
          {
            role: `${transfer.kind}-${transfer.renderMode}-report`,
            path: artifact(
              join(
                transfer.directory,
                transfer.renderMode === 'probe' ? 'scene-probe.json' : 'scene-render.json',
              ),
            ),
            mediaType: 'application/json',
          },
          {
            role: `${transfer.kind}-aerosol-report`,
            path: artifact(join(transfer.directory, 'aerosol-report.json')),
            mediaType: 'application/json',
          },
        ]),
      ],
      compatibility: {
        coordinateSystem: 'source-relative-right-handed-y-up-metres',
        renderers: ['blender-headless'],
        requires: [],
      },
      verification: {
        checks: [
          'vfx.unique-layer-ids-and-seeds',
          'vfx.source-attachment-resolution',
          'vfx.declared-generated-count-equality',
          'vfx.world-space-volume-and-particles',
          'vfx.temporal-rise-and-turbulence',
          'visual.historic-forge-generated-not-accepted',
          'visual.contemporary-metal-shop-generated-not-accepted',
        ],
        artifacts: transfers.flatMap((transfer) => [
          artifact(join(transfer.directory, 'contact-sheet.png')),
          artifact(
            join(
              transfer.directory,
              transfer.renderMode === 'probe' ? 'scene-probe.json' : 'scene-render.json',
            ),
          ),
          artifact(join(transfer.directory, 'aerosol-report.json')),
        ]),
        verifiedAt: new Date().toISOString(),
      },
    }),
  );
  await writeFile(
    join(verification, 'transfer-summary.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        assetId: vfx.id,
        transfers: transfers.map(({ kind, sceneFile }) => ({
          kind,
          sceneFile: artifact(sceneFile),
        })),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return { output, vfxFile, metadata, transfers };
}
