import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderCinematicScene } from '../cinematic/blender.js';
import { saveCinematicScene } from '../cinematic/io.js';
import { cinematicSceneSchema } from '../cinematic/model.js';
import {
  createWorkshopWorldFamily,
  layoutDressingFamily,
  type DressingInstance,
} from '../environments/dressing-family.js';
import { saveGeometry } from '../geometry/io.js';
import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import { boxPart, mergeMeshParts } from '../geometry/primitives.js';
import {
  adaptLightingRig,
  lightingRigAdaptationSchema,
  verifyLightingRigAdaptation,
} from '../lighting/adaptation.js';
import { createWarmInteriorLightingRig } from '../lighting/bookshop.js';
import { saveLightingRig } from '../lighting/io.js';
import {
  createFreestandingToolBoard,
  createJoinersWorkbench,
  createRollingPartsCabinet,
} from '../props/workshop.js';
import { writeDressingMemberCandidate } from './dressing-family-creation-core.js';

type WorkshopHost = 'historic-forge-workroom' | 'contemporary-maker-lab';

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

function workshopHostGeometry(kind: WorkshopHost): GeometryAsset {
  const historic = kind === 'historic-forge-workroom';
  const parts = historic
    ? [
        boxPart([-7.2, -0.16, -4.9], [7.2, 0, 4.9], 0, 'forge-floor'),
        boxPart([-7.2, 0, 4.55], [7.2, 4.35, 4.9], 0, 'forge-stone'),
        boxPart([-7.2, 0, -4.9], [-6.86, 4.35, 4.9], 0, 'forge-stone'),
        boxPart([6.86, 0, -4.9], [7.2, 4.35, 4.9], 0, 'forge-stone'),
        boxPart([-6.8, 3.65, -4.55], [6.8, 3.9, 4.55], 0, 'forge-beam'),
        boxPart([-4.8, 0, 4.08], [-2.8, 1.45, 4.55], 0, 'forge-hearth'),
        boxPart([-4.5, 0.2, 3.75], [-3.1, 1.14, 4.1], 0, 'forge-dark'),
        boxPart([2.9, 0, 4.12], [5.7, 0.5, 4.5], 0, 'forge-stone'),
      ]
    : [
        boxPart([-7.2, -0.12, -4.9], [7.2, 0, 4.9], 0, 'lab-floor'),
        boxPart([-7.2, 0, 4.65], [7.2, 3.75, 4.9], 0, 'lab-wall'),
        boxPart([-7.2, 0, -4.9], [-6.92, 3.75, 4.9], 0, 'lab-wall'),
        boxPart([6.92, 0, -4.9], [7.2, 3.75, 4.9], 0, 'lab-wall'),
        boxPart([-6.6, 2.9, 4.35], [6.6, 3.12, 4.64], 0, 'lab-rail'),
        boxPart([-5.9, 0.15, 4.22], [-3.2, 1.05, 4.62], 0, 'lab-storage'),
        boxPart([3.15, 0.15, 4.22], [5.85, 1.05, 4.62], 0, 'lab-storage'),
        boxPart([-1.7, 1.35, 4.28], [1.7, 3.25, 4.61], 0, 'lab-window'),
      ];
  const geometry = mergeMeshParts(
    `environment.${kind}-host`,
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    { generator: 'videoer.workshop-host-witness.v1', verificationOnly: true },
  );
  geometry.materials = historic
    ? [
        material('forge-floor', [0.12, 0.095, 0.07, 1], 0.86),
        material('forge-stone', [0.18, 0.13, 0.085, 1], 0.82),
        material('forge-beam', [0.085, 0.025, 0.007, 1], 0.72),
        material('forge-hearth', [0.17, 0.055, 0.02, 1], 0.78),
        material('forge-dark', [0.008, 0.004, 0.002, 1], 0.96),
      ]
    : [
        material('lab-floor', [0.17, 0.18, 0.19, 1], 0.58),
        material('lab-wall', [0.19, 0.23, 0.26, 1], 0.72),
        material('lab-rail', [0.055, 0.07, 0.08, 1], 0.34, 0.68),
        material('lab-storage', [0.04, 0.09, 0.12, 1], 0.42, 0.48),
        material('lab-window', [0.055, 0.16, 0.22, 1], 0.22, 0.12),
      ];
  return geometry;
}

function workshopLighting(kind: WorkshopHost) {
  const historic = kind === 'historic-forge-workroom';
  const base = createWarmInteriorLightingRig();
  const adaptation = lightingRigAdaptationSchema.parse({
    kind: 'lighting-rig-transform-v1' as const,
    assetId: `lighting.${kind}-workstation`,
    transform: {
      translation: historic ? [0.15, 0.15, -2.15] : [2.9, 0.2, -2.0],
      yawRadians: historic ? -0.16 : 0.18,
      uniformScale: historic ? 1.28 : 1.38,
    },
    energyScale: historic ? 1.22 : 1.42,
    purposeEnergyScale: {
      key: historic ? 1.25 : 1.08,
      fill: historic ? 0.72 : 1.28,
      rim: historic ? 1.18 : 0.92,
      practical: 1,
      environment: 1,
    },
    colorMultiply: historic ? [1, 0.82, 0.64] : [0.82, 0.94, 1.12],
    worldColor: historic ? [0.012, 0.006, 0.003] : [0.014, 0.022, 0.032],
    metadata: {
      context: kind,
      purpose: 'portable-workstation-material-and-silhouette-separation',
    },
  });
  const rig = adaptLightingRig(base, adaptation);
  return { base, adaptation, rig, report: verifyLightingRigAdaptation(base, rig, adaptation) };
}

function workshopScene(
  kind: WorkshopHost,
  hostPath: string,
  paths: Record<string, string>,
  instances: DressingInstance[],
  lights: ReturnType<typeof workshopLighting>['rig'],
) {
  const historic = kind === 'historic-forge-workroom';
  const focusX =
    instances.reduce((sum, instance) => sum + instance.transform.position[0], 0) / instances.length;
  const focusZ =
    instances.reduce((sum, instance) => sum + instance.transform.position[2], 0) / instances.length;
  const rightCameraX = Math.min(6.35, focusX + 6.35);
  const leftCameraX = Math.max(-6.35, focusX - 6.35);
  return cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: `scene.workshop-world-${kind}-transfer`,
    durationSeconds: 0.125,
    fps: 24,
    resolution: { width: 720, height: 406, percentage: 100 },
    entities: [
      { id: 'workshop-host', role: 'environment', geometryPath: hostPath },
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
          position: [rightCameraX, historic ? 2.65 : 2.82, focusZ - 8.15],
          target: [focusX, 1.12, focusZ],
          lensMillimeters: 42,
        },
        {
          time: 0.0625,
          position: [focusX, historic ? 2.42 : 2.58, focusZ - 8.55],
          target: [focusX, 1.08, focusZ],
          lensMillimeters: 46,
        },
        {
          time: 0.125,
          position: [leftCameraX, historic ? 2.68 : 2.84, focusZ - 8.1],
          target: [focusX, 1.1, focusZ],
          lensMillimeters: 42,
        },
      ],
    },
    lights: lights.lights.map(({ purpose, ...light }) => {
      void purpose;
      return light;
    }),
    atmosphere: {
      worldColor: lights.worldColor,
      fogDensity: historic ? 0.0028 : 0.0012,
    },
    renderProfile: {
      engine: 'cycles-cpu',
      samples: 128,
      seed: 1729,
      denoise: true,
      intent: 'deterministic-final',
    },
    renderGates: [
      { id: 'workshop-visible', type: 'frame-visibility', maximumBlackPercentage: 70 },
      { id: 'workshop-highlight-detail', type: 'frame-overexposure', maximumWhitePercentage: 5 },
      {
        id: 'workshop-entity-inspection-coverage',
        type: 'entity-set-coverage',
        entityIds: instances.map((instance) => instance.id),
        minimumScreenHeightPercentage: 8,
        maximumScreenHeightPercentage: 62,
        minimumVisibleAreaPercentage: 94,
        marginPercentage: 1,
      },
    ],
    landmarks: [
      { id: 'right-context', progress: 0, description: 'Right host and workstation silhouette' },
      {
        id: 'frontal-workstations',
        progress: 0.5,
        description: 'Complete bench, tool display, storage and circulation',
      },
      { id: 'left-context', progress: 1, description: 'Left host and material separation' },
    ],
    metadata: {
      verificationPurpose: 'portable-physical-workshop-family-transfer',
      environmentClass: kind,
      familyId: 'environment.workshop-world-family',
      sourceLightingRig: 'lighting.bookshop-warm-interior',
      adaptedLightingRig: lights.id,
    },
  });
}

export async function createWorkshopWorldDressingFamily(outputDirectory: string) {
  const output = resolve(outputDirectory);
  const propRoot = join(output, 'props');
  const candidates = [
    {
      directoryName: 'joiners-workbench',
      geometry: createJoinersWorkbench(),
      title: "Joiner's workbench with physical vise",
      description:
        'Project-owned timber trestle workbench with a physical front vise, bench dogs, loose hammer and named work/interaction anchors.',
      tags: ['workbench', 'vise', 'craft'],
      checks: ['attachments.workbench-semantic', 'prop.physical-vise-and-work-surface'],
    },
    {
      directoryName: 'freestanding-tool-board',
      geometry: createFreestandingToolBoard(),
      title: 'Freestanding populated tool board',
      description:
        'Project-owned freestanding tool board with physical peg pattern, shelves and distinct hammer, square, tongs and handled-tool silhouettes.',
      tags: ['tool-board', 'tools', 'storage'],
      checks: ['attachments.tool-display-semantic', 'prop.physical-tool-silhouettes'],
    },
    {
      directoryName: 'rolling-parts-cabinet',
      geometry: createRollingPartsCabinet(),
      title: 'Rolling workshop parts cabinet',
      description:
        'Project-owned five-drawer parts cabinet with physical handles, castors, push handle, hardwood top and loose parts.',
      tags: ['cabinet', 'drawers', 'rolling-storage'],
      checks: ['attachments.parts-storage-semantic', 'prop.physical-drawers-and-castors'],
    },
  ];
  const metadata = await Promise.all(
    candidates.map((candidate) =>
      writeDressingMemberCandidate({
        directory: join(propRoot, candidate.directoryName),
        geometry: candidate.geometry,
        title: candidate.title,
        description: candidate.description,
        tags: candidate.tags,
        familyTag: 'workshop',
        generator: 'videoer.workshop-assets.v1',
        capabilities: [
          'portable-geometry',
          'ground-placement',
          'named-workstation-attachments',
          'medium-background-quality-tier',
        ],
        verificationChecks: candidate.checks,
      }),
    ),
  );
  const paths = Object.fromEntries(
    candidates.map((candidate) => [
      candidate.geometry.id,
      join(propRoot, candidate.directoryName, 'geometry.json'),
    ]),
  );
  const family = createWorkshopWorldFamily();
  const familyDirectory = join(output, 'family');
  await mkdir(familyDirectory, { recursive: true });
  const familyFile = join(familyDirectory, 'family.json');
  await writeFile(familyFile, `${JSON.stringify(family, null, 2)}\n`, 'utf8');

  const transfers = [];
  for (const [index, kind] of (
    ['historic-forge-workroom', 'contemporary-maker-lab'] as const
  ).entries()) {
    const directory = join(familyDirectory, 'verification', kind);
    await mkdir(directory, { recursive: true });
    const request = {
      schemaVersion: 1 as const,
      id: `layout.${kind}-workshop-world`,
      familyId: family.id,
      seed: [8819, 12_187][index]!,
      clusterCount: 1,
      requiredVariantIds: ['joiners-workbench', 'freestanding-tool-board', 'rolling-parts-cabinet'],
      requiredRecipeIds: ['complete-craft-workstation'],
      zone: {
        minimum: [-5.75, -3.6] as [number, number],
        maximum: [5.75, 3.6] as [number, number],
        groundY: 0,
      },
      exclusions: [
        {
          id: 'operator-and-camera-circulation',
          kind: 'corridor' as const,
          start: [-5.5, -2.2] as [number, number],
          end: [5.5, -2.2] as [number, number],
          halfWidthMeters: 0.55,
          clearanceMeters: 0.14,
        },
      ],
      maximumAttemptsPerInstance: 1400,
    };
    const layout = layoutDressingFamily(family, request);
    const requestFile = join(directory, 'layout-request.json');
    const layoutFile = join(directory, 'layout-report.json');
    await writeFile(requestFile, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
    await writeFile(layoutFile, `${JSON.stringify(layout, null, 2)}\n`, 'utf8');
    const hostPath = await saveGeometry(
      join(directory, 'host-geometry.json'),
      workshopHostGeometry(kind),
    );
    const lighting = workshopLighting(kind);
    if (!lighting.report.valid)
      throw new Error(`${kind} lighting adaptation invalid: ${lighting.report.issues.join('; ')}`);
    const lightingFile = await saveLightingRig(
      join(directory, 'adapted-lighting-rig.json'),
      lighting.rig,
    );
    const lightingReportFile = join(directory, 'lighting-adaptation-report.json');
    await writeFile(lightingReportFile, `${JSON.stringify(lighting.report, null, 2)}\n`, 'utf8');
    const sceneFile = await saveCinematicScene(
      join(directory, 'scene.json'),
      workshopScene(kind, hostPath, paths, layout.instances, lighting.rig),
    );
    transfers.push({
      kind,
      directory,
      requestFile,
      layoutFile,
      hostPath,
      lightingFile,
      lightingReportFile,
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
        'Renderer-independent workshop family combining a portable interaction-ready bench, populated physical tool display and rolling parts storage into authored workstations across unrelated interiors.',
      status: 'validated',
      tags: family.tags,
      capabilities: [
        'portable-set-dressing-family',
        'explicit-member-versions',
        'deterministic-seeded-layout',
        'authored-physical-workstations',
        'navigation-clearance-preservation',
        'cross-environment-transfer',
        'verified-lighting-rig-reuse',
      ],
      source: {
        kind: 'procedural',
        generator: 'videoer.workshop-world-family.v1',
        sourceAssets: [
          ...candidates.map((candidate) => `${candidate.geometry.id}@0.1.0`),
          'lighting.bookshop-warm-interior@0.1.0',
        ],
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
            role: `${transfer.kind}-lighting-rig`,
            path: artifact(transfer.lightingFile),
            mediaType: 'application/vnd.videoer.lighting+json',
          },
          {
            role: `${transfer.kind}-lighting-report`,
            path: artifact(transfer.lightingReportFile),
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
          'workstation.complete-physical-inventory',
          'lighting.verified-parent-bounded-adaptation',
          'visual.historic-forge-workroom-generated-not-accepted',
          'visual.contemporary-maker-lab-generated-not-accepted',
        ],
        artifacts: transfers.flatMap((transfer) => [
          artifact(transfer.layoutFile),
          artifact(transfer.lightingReportFile),
          artifact(join(transfer.directory, 'contact-sheet.png')),
          artifact(join(transfer.directory, 'scene-render.json')),
        ]),
        verifiedAt: new Date().toISOString(),
      },
    }),
  );
  return { output, metadata, familyMetadata, familyFile, transfers };
}
