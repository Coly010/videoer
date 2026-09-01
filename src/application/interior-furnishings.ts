import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderCinematicScene } from '../cinematic/blender.js';
import { saveCinematicScene } from '../cinematic/io.js';
import { cinematicSceneSchema } from '../cinematic/model.js';
import { renderGeometryProbe } from '../geometry/blender.js';
import { saveGeometry } from '../geometry/io.js';
import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import { boxPart, mergeMeshParts } from '../geometry/primitives.js';
import {
  createDecorativeVesselSet,
  createPedestalSideTable,
  createUpholsteredReadingChair,
} from '../props/interior-furnishings.js';
import {
  createInteriorFurnishingFamily,
  layoutDressingFamily,
  type DressingInstance,
} from '../environments/dressing-family.js';
import {
  adaptLightingRig,
  lightingRigAdaptationSchema,
  verifyLightingRigAdaptation,
} from '../lighting/adaptation.js';
import { createWarmInteriorLightingRig } from '../lighting/bookshop.js';
import { saveLightingRig } from '../lighting/io.js';
import { writeDressingMemberCandidate } from './dressing-family-creation-core.js';

type InteriorHost = 'historic-library-chamber' | 'contemporary-reading-loft';

const hostMaterial = (
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

function hostGeometry(kind: InteriorHost): GeometryAsset {
  const historic = kind === 'historic-library-chamber';
  const parts = historic
    ? [
        boxPart([-6.8, -0.16, -4.5], [6.8, 0, 4.5], 0, 'chamber-floor'),
        boxPart([-6.8, 0, 4.2], [6.8, 4.1, 4.5], 0, 'chamber-plaster'),
        boxPart([-6.8, 0, -4.5], [-6.48, 4.1, 4.5], 0, 'chamber-plaster'),
        boxPart([6.48, 0, -4.5], [6.8, 4.1, 4.5], 0, 'chamber-plaster'),
        boxPart([-5.9, 0, 3.55], [-3.35, 3.2, 4.2], 0, 'chamber-walnut'),
        boxPart([3.35, 0, 3.55], [5.9, 3.2, 4.2], 0, 'chamber-walnut'),
        boxPart([-1.55, 0, 3.45], [1.55, 1.35, 4.19], 0, 'chamber-stone'),
        boxPart([-1.12, 0.18, 3.25], [1.12, 1.03, 3.46], 0, 'chamber-hearth'),
        boxPart([-1.82, 1.32, 3.38], [1.82, 1.5, 4.18], 0, 'chamber-stone'),
        ...[-5.55, -4.95, -4.35, -3.75, 3.75, 4.35, 4.95, 5.55].flatMap((x) =>
          [0.48, 0.86, 1.24, 1.62, 2, 2.38].map((y) =>
            boxPart([x - 0.23, y, 3.18], [x + 0.23, y + 0.29, 3.54], 0, 'chamber-book'),
          ),
        ),
      ]
    : [
        boxPart([-6.8, -0.12, -4.5], [6.8, 0, 4.5], 0, 'loft-floor'),
        boxPart([-6.8, 0, 4.25], [6.8, 3.65, 4.5], 0, 'loft-concrete'),
        boxPart([-6.8, 0, -4.5], [-6.52, 3.65, 4.5], 0, 'loft-concrete'),
        boxPart([6.52, 0, -4.5], [6.8, 3.65, 4.5], 0, 'loft-concrete'),
        boxPart([-2.85, 0.85, 4.02], [2.85, 3.35, 4.24], 0, 'loft-window'),
        boxPart([-6.15, 0, 3.76], [-3.45, 2.65, 4.24], 0, 'loft-shelving'),
        boxPart([3.45, 0, 3.76], [6.15, 2.65, 4.24], 0, 'loft-shelving'),
        ...[0.56, 1.18, 1.8, 2.42].flatMap((y) => [
          boxPart([-6.05, y, 3.5], [-3.55, y + 0.08, 3.75], 0, 'loft-metal'),
          boxPart([3.55, y, 3.5], [6.05, y + 0.08, 3.75], 0, 'loft-metal'),
        ]),
        boxPart([-5.7, 0.01, -1.1], [-3.35, 0.13, 1.1], 0, 'loft-rug'),
      ];
  const geometry = mergeMeshParts(
    `environment.${kind}-host`,
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    { generator: 'videoer.interior-furnishing-host-witness.v1', verificationOnly: true },
  );
  geometry.materials = historic
    ? [
        hostMaterial('chamber-floor', [0.12, 0.07, 0.035, 1], 0.75),
        hostMaterial('chamber-plaster', [0.31, 0.22, 0.14, 1], 0.84),
        hostMaterial('chamber-walnut', [0.07, 0.018, 0.004, 1], 0.66),
        hostMaterial('chamber-stone', [0.2, 0.16, 0.11, 1], 0.82),
        hostMaterial('chamber-hearth', [0.012, 0.005, 0.002, 1], 0.94),
        hostMaterial('chamber-book', [0.22, 0.055, 0.012, 1], 0.72),
      ]
    : [
        hostMaterial('loft-floor', [0.16, 0.17, 0.18, 1], 0.58),
        hostMaterial('loft-concrete', [0.27, 0.29, 0.3, 1], 0.8),
        hostMaterial('loft-window', [0.045, 0.13, 0.19, 1], 0.24, 0.08),
        hostMaterial('loft-shelving', [0.045, 0.055, 0.06, 1], 0.46, 0.55),
        hostMaterial('loft-metal', [0.11, 0.13, 0.14, 1], 0.32, 0.72),
        hostMaterial('loft-rug', [0.08, 0.17, 0.18, 1], 0.92),
      ];
  return geometry;
}

function hostLighting(kind: InteriorHost, focus: [number, number]) {
  const historic = kind === 'historic-library-chamber';
  const base = createWarmInteriorLightingRig();
  const yawRadians = historic ? -0.18 : 0.24;
  const uniformScale = historic ? 1.2 : 1.32;
  const sourceAnchor = base.lights[0]!.target!;
  const scaledX = sourceAnchor[0] * uniformScale;
  const scaledZ = sourceAnchor[2] * uniformScale;
  const transformedAnchorX = scaledX * Math.cos(yawRadians) + scaledZ * Math.sin(yawRadians);
  const transformedAnchorZ = -scaledX * Math.sin(yawRadians) + scaledZ * Math.cos(yawRadians);
  const adaptation = lightingRigAdaptationSchema.parse({
    kind: 'lighting-rig-transform-v1' as const,
    assetId: `lighting.${kind}-reading-corner`,
    transform: {
      translation: [
        focus[0] - transformedAnchorX,
        historic ? 0.05 : 0.18,
        focus[1] - transformedAnchorZ,
      ],
      yawRadians,
      uniformScale,
    },
    energyScale: historic ? 1.3 : 1.6,
    purposeEnergyScale: {
      key: historic ? 1.25 : 1.15,
      fill: historic ? 0.85 : 1.55,
      rim: historic ? 1.18 : 1.25,
      practical: 1,
      environment: 1,
    },
    colorMultiply: historic ? [1, 0.82, 0.62] : [0.92, 0.98, 1.05],
    worldColor: historic ? [0.015, 0.008, 0.004] : [0.025, 0.04, 0.055],
    metadata: {
      context: kind,
      purpose: 'portable-furnishing-silhouette-and-surface-separation',
      layoutFocus: focus,
    },
  });
  const rig = adaptLightingRig(base, adaptation);
  return { base, adaptation, rig, report: verifyLightingRigAdaptation(base, rig, adaptation) };
}

function transferScene(
  kind: InteriorHost,
  hostPath: string,
  paths: Record<string, string>,
  instances: DressingInstance[],
  lights: ReturnType<typeof hostLighting>['rig'],
) {
  const historic = kind === 'historic-library-chamber';
  const focusX =
    instances.reduce((sum, instance) => sum + instance.transform.position[0], 0) / instances.length;
  const focusZ =
    instances.reduce((sum, instance) => sum + instance.transform.position[2], 0) / instances.length;
  const rightCameraX = Math.min(6.05, focusX + 4.5);
  const leftCameraX = Math.max(-6.05, focusX - 4.5);
  return cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: `scene.interior-furnishing-${kind}-transfer`,
    durationSeconds: 0.125,
    fps: 24,
    resolution: { width: 720, height: 406, percentage: 100 },
    entities: [
      { id: 'interior-host', role: 'environment', geometryPath: hostPath },
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
          position: [rightCameraX, historic ? 2.25 : 2.4, focusZ - 6.2],
          target: [focusX, 0.9, focusZ],
          lensMillimeters: 47,
        },
        {
          time: 0.0625,
          position: [focusX, historic ? 2.02 : 2.18, focusZ - 6.65],
          target: [focusX, 0.88, focusZ],
          lensMillimeters: 52,
        },
        {
          time: 0.125,
          position: [leftCameraX, historic ? 2.28 : 2.42, focusZ - 6.15],
          target: [focusX, 0.9, focusZ],
          lensMillimeters: 47,
        },
      ],
    },
    lights: lights.lights.map(({ purpose, ...light }) => {
      void purpose;
      return light;
    }),
    atmosphere: { worldColor: lights.worldColor, fogDensity: historic ? 0.002 : 0.0009 },
    qualityGates: [
      {
        id: 'camera-remains-inside-host-shell',
        type: 'camera-path-clearance',
        obstacleEntityIds: ['interior-host'],
        sampleCount: 25,
        minimumCameraClearanceMeters: 0.12,
        targetOcclusionToleranceMeters: 0.18,
      },
    ],
    renderProfile: {
      engine: 'cycles-cpu',
      samples: 128,
      seed: 9431,
      denoise: true,
      intent: 'deterministic-final',
    },
    renderGates: [
      { id: 'interior-visible', type: 'frame-visibility', maximumBlackPercentage: 55 },
      { id: 'interior-highlight-detail', type: 'frame-overexposure', maximumWhitePercentage: 4 },
      {
        id: 'interior-furnishing-inspection-coverage',
        type: 'entity-set-coverage',
        entityIds: instances.map((instance) => instance.id),
        minimumScreenHeightPercentage: 7,
        maximumScreenHeightPercentage: 68,
        minimumVisibleAreaPercentage: 94,
        marginPercentage: 1,
      },
    ],
    landmarks: [
      { id: 'right-context', progress: 0, description: 'Right host and furniture silhouette' },
      {
        id: 'frontal-reading-corner',
        progress: 0.5,
        description: 'Table support, vessels, seating and circulation',
      },
      { id: 'left-context', progress: 1, description: 'Left host and material separation' },
    ],
    metadata: {
      verificationPurpose: 'portable-cross-era-interior-furnishing-transfer',
      environmentClass: kind,
      familyId: 'environment.interior-furnishing-family',
      sourceLightingRig: 'lighting.bookshop-warm-interior',
      adaptedLightingRig: lights.id,
    },
  });
}

export async function createInteriorFurnishingCandidates(outputDirectory: string) {
  const output = resolve(outputDirectory);
  const propRoot = join(output, 'props');
  await mkdir(output, { recursive: true });
  const candidates = [
    {
      directoryName: 'upholstered-reading-chair',
      geometry: createUpholsteredReadingChair(),
      title: 'Upholstered reading chair',
      description:
        'Project-owned timber-frame reading chair with physical upholstery, arm rests, tufting and named occupant/side-table anchors.',
      tags: ['chair', 'seating', 'upholstery'],
      capabilities: ['physical-seating-silhouette', 'occupant-anchor', 'side-table-anchors'],
      checks: ['attachments.seating-semantic', 'prop.physical-frame-and-upholstery'],
    },
    {
      directoryName: 'pedestal-side-table',
      geometry: createPedestalSideTable(),
      title: 'Pedestal side table',
      description:
        'Project-owned walnut pedestal table with a physical support surface, named tabletop anchors and brushed-brass inlay.',
      tags: ['table', 'pedestal', 'interaction-surface'],
      capabilities: ['physical-tabletop', 'tabletop-anchors', 'cross-era-furnishing'],
      checks: ['attachments.tabletop-semantic', 'prop.physical-tabletop-and-pedestal'],
    },
    {
      directoryName: 'decorative-vessel-set',
      geometry: createDecorativeVesselSet(),
      title: 'Decorative vessel and tray set',
      description:
        'Project-owned three-vessel tabletop set with physical tray, reactive glazed ceramic, aged brass and support/carry anchors.',
      tags: ['vessels', 'ceramic', 'tabletop'],
      capabilities: ['tabletop-inventory', 'physical-vessels', 'tabletop-support-anchor'],
      checks: ['attachments.tabletop-inventory-semantic', 'prop.physical-tray-and-vessels'],
    },
  ];

  const members = [];
  for (const candidate of candidates) {
    const directory = join(propRoot, candidate.directoryName);
    const metadata = await writeDressingMemberCandidate({
      directory,
      geometry: candidate.geometry,
      title: candidate.title,
      description: candidate.description,
      tags: candidate.tags,
      familyTag: 'interior-furnishing',
      generator: 'videoer.interior-furnishings.v1',
      capabilities: candidate.capabilities,
      verificationChecks: candidate.checks,
    });
    const probe = await renderGeometryProbe(
      join(directory, 'geometry.json'),
      join(directory, 'verification'),
    );
    members.push({ id: candidate.geometry.id, directory, metadata, probe });
  }

  const family = createInteriorFurnishingFamily();
  const familyDirectory = join(output, 'family');
  await mkdir(familyDirectory, { recursive: true });
  const familyFile = join(familyDirectory, 'family.json');
  await writeFile(familyFile, `${JSON.stringify(family, null, 2)}\n`, 'utf8');
  const paths = Object.fromEntries(
    candidates.map((candidate) => [
      candidate.geometry.id,
      join(propRoot, candidate.directoryName, 'geometry.json'),
    ]),
  );

  const transfers = [];
  for (const [index, kind] of (
    ['historic-library-chamber', 'contemporary-reading-loft'] as const
  ).entries()) {
    const directory = join(familyDirectory, 'verification', kind);
    await mkdir(directory, { recursive: true });
    const request = {
      schemaVersion: 1 as const,
      id: `layout.${kind}-interior-furnishing`,
      familyId: family.id,
      seed: [9431, 12_691][index]!,
      clusterCount: 1,
      requiredVariantIds: ['reading-chair', 'pedestal-table', 'vessel-set'],
      requiredRecipeIds: ['complete-reading-corner'],
      zone: {
        minimum: [-5.3, -3.35] as [number, number],
        maximum: [5.3, 3.35] as [number, number],
        groundY: 0,
      },
      exclusions: [
        {
          id: 'central-reading-circulation',
          kind: 'corridor' as const,
          start: [-5, -2.35] as [number, number],
          end: [5, -2.35] as [number, number],
          halfWidthMeters: 0.52,
          clearanceMeters: 0.16,
        },
      ],
      maximumAttemptsPerInstance: 1800,
    };
    const layout = layoutDressingFamily(family, request);
    const requestFile = join(directory, 'layout-request.json');
    const layoutFile = join(directory, 'layout-report.json');
    await writeFile(requestFile, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
    await writeFile(layoutFile, `${JSON.stringify(layout, null, 2)}\n`, 'utf8');
    const hostPath = await saveGeometry(join(directory, 'host-geometry.json'), hostGeometry(kind));
    const layoutFocus: [number, number] = [
      layout.instances.reduce((sum, instance) => sum + instance.transform.position[0], 0) /
        layout.instances.length,
      layout.instances.reduce((sum, instance) => sum + instance.transform.position[2], 0) /
        layout.instances.length,
    ];
    const lighting = hostLighting(kind, layoutFocus);
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
      transferScene(kind, hostPath, paths, layout.instances, lighting.rig),
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
        'Renderer-independent cross-era interior furnishing family combining interaction-ready seating, a physical support table and supported decorative inventory into authored inhabited-room vignettes.',
      status: 'validated',
      tags: family.tags,
      capabilities: [
        'portable-set-dressing-family',
        'explicit-member-versions',
        'deterministic-seeded-layout',
        'authored-furniture-recipes',
        'navigation-clearance-preservation',
        'tabletop-support-semantics',
        'cross-era-transfer',
        'verified-lighting-rig-reuse',
      ],
      source: {
        kind: 'procedural',
        generator: 'videoer.interior-furnishing-family.v1',
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
          'furnishing.tabletop-support-semantics',
          'lighting.verified-parent-bounded-adaptation',
          'visual.historic-library-chamber-generated-not-accepted',
          'visual.contemporary-reading-loft-generated-not-accepted',
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
  return { output, familyFile, members, familyMetadata, transfers };
}
