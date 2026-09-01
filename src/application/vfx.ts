import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderCinematicProbe, renderCinematicScene } from '../cinematic/blender.js';
import { loadCinematicScene, saveCinematicScene } from '../cinematic/io.js';
import { cinematicSceneSchema } from '../cinematic/model.js';
import { adaptAtmosphericVfx, verifyAtmosphericVfxAdaptation } from '../vfx/adaptation.js';
import { loadAtmosphericVfx, saveAtmosphericVfx } from '../vfx/io.js';
import { createRainyDuskVfx, toCinematicAtmosphere } from '../vfx/rainy-dusk.js';
import type { AtmosphericVfx } from '../vfx/model.js';

export function createAtmosphericGroundResponseScene(
  environmentGeometryFile: string,
  vfx: AtmosphericVfx,
) {
  const splashes = vfx.rain.groundSplashes;
  if (!splashes?.enabled || splashes.count <= 0)
    throw new Error('Ground-response verification requires enabled non-empty splashes');
  return cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: 'scene.atmospheric-ground-response-probe',
    durationSeconds: 12 / 24,
    fps: 24,
    resolution: { width: 640, height: 360, percentage: 100 },
    entities: [
      {
        id: 'receiver-environment',
        role: 'environment',
        geometryPath: resolve(environmentGeometryFile),
      },
    ],
    camera: {
      keyframes: [
        {
          time: 0,
          position: [1.02, 0.38, -0.42],
          target: [1.28, 0.025, -1.78],
          lensMillimeters: 72,
        },
        {
          time: 12 / 24,
          position: [1.82, 0.34, -0.5],
          target: [1.58, 0.025, -1.92],
          lensMillimeters: 76,
        },
      ],
    },
    lights: [
      {
        id: 'cool-raking-ground-key',
        type: 'area',
        position: [2.8, 2.4, -0.35],
        target: [1.4, 0, -1.8],
        color: [0.34, 0.54, 1],
        energy: 540,
        sizeMeters: 1.8,
      },
      {
        id: 'warm-glancing-response',
        type: 'area',
        position: [-0.6, 1.1, -2.8],
        target: [1.3, 0, -1.8],
        color: [1, 0.35, 0.1],
        energy: 190,
        sizeMeters: 1.2,
      },
      {
        id: 'water-normal-verification-strip',
        type: 'area',
        position: [1.5, 0.62, -3.05],
        target: [1.45, 0, -1.72],
        color: [0.42, 0.68, 1],
        energy: 2.5,
        sizeMeters: 0.72,
      },
    ],
    atmosphere: toCinematicAtmosphere(vfx),
    renderGates: [
      { id: 'ground-response-visible', type: 'frame-visibility', maximumBlackPercentage: 72 },
      {
        id: 'ground-response-highlight-detail',
        type: 'frame-overexposure',
        maximumWhitePercentage: 4,
      },
    ],
    landmarks: [
      { id: 'impact-start', progress: 0, description: 'Initial deterministic impact phase' },
      { id: 'impact-quarter', progress: 0.25, description: 'Early expansion and crown response' },
      { id: 'impact-middle', progress: 0.5, description: 'Mixed ripple phases across receiver' },
      { id: 'impact-three-quarter', progress: 0.75, description: 'Late collapse and new impacts' },
      { id: 'impact-end', progress: 1, description: 'Temporal cycle remains spatially grounded' },
    ],
    metadata: {
      sourceVfx: vfx.id,
      verificationPurpose: 'close-range-world-space-ground-response',
      preservesDeclaredSplashDensity: true,
      receiverBounds: {
        minimum: splashes.boundsMinimum,
        maximum: splashes.boundsMaximum,
      },
    },
  });
}

export async function createRainyDuskVfxAsset(
  environmentGeometryFile: string,
  outputDirectory: string,
) {
  const output = resolve(outputDirectory);
  const verification = join(output, 'verification');
  await mkdir(verification, { recursive: true });
  const vfx = createRainyDuskVfx();
  const vfxFile = await saveAtmosphericVfx(join(output, 'vfx.json'), vfx);
  const scene = cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: 'scene.rainy-dusk-vfx-probe',
    durationSeconds: 12 / 24,
    fps: 24,
    resolution: { width: 360, height: 640, percentage: 100 },
    entities: [
      {
        id: 'bookshop-set',
        role: 'environment',
        geometryPath: resolve(environmentGeometryFile),
      },
    ],
    camera: {
      keyframes: [
        { time: 0, position: [7.8, 3.25, -2.7], target: [-1.8, 1.45, -2.1], lensMillimeters: 48 },
        {
          time: 12 / 24,
          position: [7.45, 3.18, -2.68],
          target: [-2.05, 1.43, -2.08],
          lensMillimeters: 50,
        },
      ],
    },
    lights: [
      {
        id: 'cool-overcast-key',
        type: 'area',
        position: [-2.4, 3.8, -2.8],
        target: [0, 1, -0.2],
        color: [0.35, 0.55, 1],
        energy: 850,
        sizeMeters: 3.2,
      },
      {
        id: 'warm-window-practical',
        type: 'area',
        position: [0.2, 2.5, 2.2],
        target: [0, 1, 0],
        color: [1, 0.43, 0.16],
        energy: 1250,
        sizeMeters: 2.4,
      },
    ],
    atmosphere: toCinematicAtmosphere(vfx),
    landmarks: [
      {
        id: 'layered-rain-start',
        progress: 0,
        description: 'Three depth bands begin in deterministic state',
      },
      {
        id: 'layered-rain-mid',
        progress: 0.5,
        description: 'Foreground streak scale separates from distant rain',
      },
      {
        id: 'layered-rain-end',
        progress: 1,
        description: 'Camera-relative rain remains filled during movement',
      },
    ],
    metadata: { sourceVfx: vfx.id, verificationPurpose: 'camera-depth-and-atmospheric-separation' },
  });
  const sceneFile = await saveCinematicScene(join(verification, 'scene.json'), scene);
  const probe = await renderCinematicScene(sceneFile, verification);
  const metadata = assetMetadataSchema.parse({
    schemaVersion: 1,
    id: vfx.id,
    version: '0.2.0',
    type: 'vfx',
    title: 'Camera-depth rainy dusk atmosphere',
    description:
      'Deterministic wind-driven camera-depth rain, varied drop motion, world-space ground splashes, and restrained volumetric dusk fog.',
    status: 'validated',
    tags: ['rain', 'fog', 'dusk', 'wind', 'ground-splashes'],
    capabilities: [
      'camera-depth',
      'deterministic-seed',
      'foreground-background',
      'wind-driven-streaks',
      'world-space-surface-response',
    ],
    source: {
      kind: 'procedural',
      generator: 'videoer.camera-depth-rain.v1',
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
      { role: 'preview', path: 'verification/rainy-dusk-vfx-probe.mp4', mediaType: 'video/mp4' },
      {
        role: 'blender-source',
        path: 'verification/rainy-dusk-vfx-probe.blend',
        mediaType: 'application/x-blender',
      },
    ],
    compatibility: {
      coordinateSystem: 'camera-relative-right-handed-metres',
      renderers: ['blender-headless'],
      requires: [],
    },
    verification: {
      checks: [
        'vfx.three-depth-bands',
        'vfx.non-overlapping-depth-intervals',
        'vfx.unique-deterministic-seeds',
        'vfx.camera-relative-continuity',
        'vfx.bounded-length-and-speed-variation',
        'vfx.world-space-ground-splash-bounds',
        'visual.foreground-background-scale-separation-generated-not-accepted',
        'visual.restrained-volumetric-fog-generated-not-accepted',
        'visual.ground-contact-generated-not-accepted',
      ],
      artifacts: [
        'verification/contact-sheet.png',
        'verification/rainy-dusk-vfx-probe.mp4',
        'verification/scene-render.json',
      ],
      verifiedAt: new Date().toISOString(),
    },
  });
  await writeHashedAssetMetadata(join(output, 'asset.yaml'), metadata);
  return { output, vfxFile, sceneFile, probe };
}

export async function writeRainyDuskVfxDefinition(outputFile: string) {
  const vfx = createRainyDuskVfx();
  const vfxFile = await saveAtmosphericVfx(outputFile, vfx);
  return { vfxFile, vfx };
}

export async function createAtmosphericGroundResponseProbe(
  vfxFile: string,
  environmentGeometryFile: string,
  outputDirectory: string,
) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const vfx = await loadAtmosphericVfx(vfxFile);
  const scene = createAtmosphericGroundResponseScene(environmentGeometryFile, vfx);
  const sceneFile = await saveCinematicScene(join(output, 'scene.json'), scene);
  const render = await renderCinematicScene(sceneFile, output);
  return { output, sourceVfxFile: resolve(vfxFile), sceneFile, render };
}

export async function createAtmosphericVfxTransferProbe(
  vfxFile: string,
  sourceSceneFile: string,
  outputDirectory: string,
  options: {
    groundSplashBounds?: {
      minimum: [number, number, number];
      maximum: [number, number, number];
    };
  } = {},
) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const baseVfx = await loadAtmosphericVfx(vfxFile);
  const vfx = options.groundSplashBounds
    ? adaptAtmosphericVfx(baseVfx, {
        assetId: `${baseVfx.id}.receiver-transfer`,
        rain: {
          groundSplashes: {
            boundsMinimum: options.groundSplashBounds.minimum,
            boundsMaximum: options.groundSplashBounds.maximum,
          },
        },
        metadata: { receiverAdaptation: 'explicit-world-space-bounds' },
      })
    : baseVfx;
  const adaptation = vfx === baseVfx ? null : verifyAtmosphericVfxAdaptation(baseVfx, vfx);
  if (adaptation && !adaptation.valid)
    throw new Error(`VFX receiver adaptation failed: ${adaptation.issues.join('; ')}`);
  const adaptationReportFile = adaptation ? join(output, 'adaptation-report.json') : null;
  if (adaptationReportFile)
    await writeFile(adaptationReportFile, `${JSON.stringify(adaptation, null, 2)}\n`, 'utf8');
  const appliedVfxFile = await saveAtmosphericVfx(join(output, 'applied-vfx.json'), vfx);
  const source = resolve(sourceSceneFile);
  const sourceDirectory = dirname(source);
  const sourceScene = await loadCinematicScene(source);
  const scene = cinematicSceneSchema.parse({
    ...sourceScene,
    id: `scene.${sourceScene.id.replace(/^scene\./u, '').replace(/\./gu, '-')}-vfx-transfer`,
    entities: sourceScene.entities.map((entity) => ({
      ...entity,
      geometryPath: resolve(sourceDirectory, entity.geometryPath),
      ...(entity.motion
        ? { motion: { ...entity.motion, path: resolve(sourceDirectory, entity.motion.path) } }
        : {}),
    })),
    overlays: sourceScene.overlays.map((overlay) => ({
      ...overlay,
      imagePath: resolve(sourceDirectory, overlay.imagePath),
    })),
    atmosphere: toCinematicAtmosphere(vfx),
    metadata: {
      ...sourceScene.metadata,
      sourceVfx: vfx.id,
      transferSourceScene: sourceScene.id,
      verificationPurpose: 'intended-camera-atmospheric-transfer',
    },
  });
  const sceneFile = await saveCinematicScene(join(output, 'scene.json'), scene);
  const probe = await renderCinematicProbe(sceneFile, join(output, 'verification'));
  return {
    output,
    sourceVfxFile: resolve(vfxFile),
    appliedVfxFile,
    adaptation,
    adaptationReportFile,
    sourceSceneFile: source,
    sceneFile,
    probe,
  };
}
