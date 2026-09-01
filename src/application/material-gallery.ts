import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { renderCinematicScene } from '../cinematic/blender.js';
import { saveCinematicScene } from '../cinematic/io.js';
import { cinematicSceneSchema } from '../cinematic/model.js';
import { wallWithRectangularOpeningsParts } from '../environments/architectural-modules.js';
import { saveGeometry } from '../geometry/io.js';
import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import { boxPart, mergeMeshParts, type MeshPart } from '../geometry/primitives.js';
import { createOldCitySurfacePresets } from '../materials/old-city.js';
import type { SurfaceMaterial } from '../materials/model.js';
import { createInsetArchitecturalWindow } from '../props/inset-window.js';

function renderMaterial(id: string, surface: SurfaceMaterial): GeometryMaterial {
  const average = surface.baseColor.colors
    .reduce(
      (sum, color) =>
        sum.map((value, index) => value + color[index]!) as [number, number, number, number],
      [0, 0, 0, 0] as [number, number, number, number],
    )
    .map((value) => value / surface.baseColor.colors.length) as [number, number, number, number];
  return {
    id,
    baseColor: average,
    roughness: (surface.roughness.minimum + surface.roughness.maximum) * 0.5,
    metallic: surface.metallic,
    emission: [0, 0, 0],
    emissionStrength: 0,
    surface,
  };
}

function surfaceAsset(id: string, parts: MeshPart[], surface: SurfaceMaterial): GeometryAsset {
  const geometry = mergeMeshParts(
    id,
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.environmental-surface-gallery.v1',
      verificationOnly: true,
      surfaceId: surface.id,
    },
  );
  geometry.materials = [renderMaterial('surface', surface)];
  return geometry;
}

function presets() {
  return new Map(createOldCitySurfacePresets().map((preset) => [preset.id, preset.material]));
}

async function saveExteriorWitness(directory: string) {
  const surfaces = presets();
  const opening = { id: 'window', minimumX: -0.64, maximumX: 0.64, minimumY: 1.42, maximumY: 2.38 };
  const assets = {
    'facade-plaster': surfaceAsset(
      'environment.material-gallery-exterior-plaster',
      wallWithRectangularOpeningsParts({
        minimumX: -3.2,
        maximumX: 3.2,
        minimumY: 0,
        maximumY: 4.15,
        frontZ: 0,
        backZ: 0.3,
        materialId: 'surface',
        openings: [opening],
      }),
      surfaces.get('rain-aged-plaster')!,
    ),
    'brick-plinth': surfaceAsset(
      'environment.material-gallery-brick-plinth',
      [
        boxPart([-3.2, 0, -0.055], [-0.82, 0.86, 0.36], 0, 'surface'),
        boxPart([0.82, 0, -0.055], [3.2, 0.86, 0.36], 0, 'surface'),
      ],
      surfaces.get('dark-brick')!,
    ),
    'limestone-trim': surfaceAsset(
      'environment.material-gallery-limestone-trim',
      [
        boxPart([-3.26, 0.82, -0.09], [3.26, 0.98, 0.39], 0, 'surface'),
        boxPart([-0.79, 1.31, -0.1], [0.79, 1.42, 0.39], 0, 'surface'),
      ],
      surfaces.get('limestone-trim')!,
    ),
    'exterior-timber': surfaceAsset(
      'environment.material-gallery-exterior-timber',
      [
        boxPart([-2.82, 0.94, -0.09], [-2.62, 4.12, 0.4], 0, 'surface'),
        boxPart([2.62, 0.94, -0.09], [2.82, 4.12, 0.4], 0, 'surface'),
        boxPart([-3.15, 3.58, -0.09], [3.15, 3.82, 0.4], 0, 'surface'),
      ],
      surfaces.get('weathered-wood')!,
    ),
    'interior-plaster': surfaceAsset(
      'environment.material-gallery-interior-plaster',
      [boxPart([-2.75, 0.9, 2.42], [2.75, 3.45, 2.62], 0, 'surface')],
      surfaces.get('warm-interior-plaster')!,
    ),
    'interior-wood': surfaceAsset(
      'environment.material-gallery-interior-wood',
      [
        boxPart([-2.25, 0.9, 2.05], [-1.42, 3.16, 2.38], 0, 'surface'),
        boxPart([1.42, 0.9, 2.05], [2.25, 3.16, 2.38], 0, 'surface'),
        boxPart([-1.28, 1.05, 1.88], [1.28, 1.17, 2.38], 0, 'surface'),
      ],
      surfaces.get('oiled-shelf-wood')!,
    ),
  };
  const paths: Record<string, string> = {};
  for (const [id, asset] of Object.entries(assets))
    paths[id] = await saveGeometry(join(directory, `${id}.json`), asset);
  paths.window = await saveGeometry(
    join(directory, 'window.json'),
    createInsetArchitecturalWindow(),
  );
  return paths;
}

async function saveInteriorWitness(directory: string) {
  const surfaces = presets();
  const assets = {
    'warm-wall': surfaceAsset(
      'environment.material-gallery-warm-wall',
      [
        boxPart([-3.1, 0, 1.9], [3.1, 3.45, 2.12], 0, 'surface'),
        boxPart([-3.1, 0, -1.9], [-2.88, 3.45, 2.12], 0, 'surface'),
        boxPart([2.88, 0, -1.9], [3.1, 3.45, 2.12], 0, 'surface'),
      ],
      surfaces.get('warm-interior-plaster')!,
    ),
    'shelf-wood': surfaceAsset(
      'environment.material-gallery-shelf-wood',
      [
        ...[-2.5, 1.3].flatMap((minimumX) => [
          boxPart([minimumX, 0.18, 1.52], [minimumX + 0.12, 3.08, 1.9], 0, 'surface'),
          boxPart([minimumX + 1.08, 0.18, 1.52], [minimumX + 1.2, 3.08, 1.9], 0, 'surface'),
          ...[0.18, 0.86, 1.54, 2.22, 2.96].map((y) =>
            boxPart([minimumX, y, 1.46], [minimumX + 1.2, y + 0.11, 1.94], 0, 'surface'),
          ),
        ]),
        boxPart([-0.92, 0.22, 0.25], [0.92, 0.33, 1.2], 0, 'surface'),
        boxPart([-0.92, 0.99, 0.25], [0.92, 1.1, 1.2], 0, 'surface'),
        boxPart([-0.92, 0.33, 0.25], [-0.8, 0.99, 1.2], 0, 'surface'),
        boxPart([0.8, 0.33, 0.25], [0.92, 0.99, 1.2], 0, 'surface'),
        boxPart([-0.08, 0.33, 0.25], [0.08, 0.99, 1.2], 0, 'surface'),
      ],
      surfaces.get('oiled-shelf-wood')!,
    ),
    'stone-floor': surfaceAsset(
      'environment.material-gallery-stone-floor',
      [boxPart([-3.1, -0.12, -1.9], [3.1, 0, 2.12], 0, 'surface')],
      surfaces.get('limestone-trim')!,
    ),
  };
  const paths: Record<string, string> = {};
  for (const [id, asset] of Object.entries(assets))
    paths[id] = await saveGeometry(join(directory, `${id}.json`), asset);
  return paths;
}

function exteriorScene(paths: Record<string, string>) {
  const entityIds = [
    'facade-plaster',
    'brick-plinth',
    'limestone-trim',
    'exterior-timber',
    'window',
  ];
  return cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: 'scene.environmental-surface-gallery-exterior',
    durationSeconds: 0.125,
    fps: 24,
    resolution: { width: 720, height: 480, percentage: 100 },
    entities: [
      ...Object.entries(paths).map(([id, geometryPath]) => ({
        id,
        role: id === 'window' ? 'prop' : 'environment',
        geometryPath,
        ...(id === 'window'
          ? { transform: { position: [0, 1.42, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }
          : {}),
      })),
    ],
    camera: {
      keyframes: [
        { time: 0, position: [3.85, 2.45, -5.65], target: [0, 1.92, 0.22], lensMillimeters: 52 },
        { time: 0.0625, position: [0, 2.2, -5.5], target: [0, 1.92, 0.32], lensMillimeters: 56 },
        {
          time: 0.125,
          position: [-3.85, 2.45, -5.65],
          target: [0, 1.92, 0.22],
          lensMillimeters: 52,
        },
      ],
    },
    lights: [
      {
        id: 'overcast-key',
        type: 'area',
        position: [-2.8, 5.6, -3.4],
        target: [0, 1.8, 0],
        color: [0.68, 0.74, 0.86],
        energy: 760,
        sizeMeters: 4.2,
      },
      {
        id: 'warm-room',
        type: 'point',
        position: [0.8, 2.9, 1.75],
        color: [1, 0.38, 0.12],
        energy: 115,
        sizeMeters: 0.1,
      },
    ],
    atmosphere: {
      worldColor: [0.022, 0.028, 0.04],
      fogDensity: 0.001,
      fogColor: [0.08, 0.1, 0.14],
    },
    renderProfile: {
      engine: 'cycles-cpu',
      samples: 128,
      seed: 2718,
      denoise: true,
      intent: 'deterministic-final',
    },
    renderGates: [
      { id: 'gallery-visible', type: 'frame-visibility', maximumBlackPercentage: 55 },
      { id: 'gallery-highlight-detail', type: 'frame-overexposure', maximumWhitePercentage: 4 },
      {
        id: 'gallery-material-presence',
        type: 'entity-set-frame-presence',
        entityIds,
        minimumVisibleFrameAreaPercentage: 2.5,
        maximumVisibleFrameAreaPercentage: 96,
        marginPercentage: 1,
      },
    ],
    landmarks: [
      {
        id: 'right-raking',
        progress: 0,
        description: 'Raking weathering, reveal depth and material separation from right',
      },
      {
        id: 'frontal',
        progress: 0.5,
        description: 'Facade hierarchy, real aperture and warm interior transmission',
      },
      {
        id: 'left-raking',
        progress: 1,
        description: 'Opposite raking response and object-space material continuity',
      },
    ],
    metadata: {
      verificationPurpose: 'environmental-surface-architectural-transfer',
      materialSystemVersion: 3,
    },
  });
}

function interiorScene(paths: Record<string, string>) {
  const entityIds = Object.keys(paths);
  return cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: 'scene.environmental-surface-gallery-interior',
    durationSeconds: 0.125,
    fps: 24,
    resolution: { width: 720, height: 480, percentage: 100 },
    entities: Object.entries(paths).map(([id, geometryPath]) => ({
      id,
      role: 'environment',
      geometryPath,
    })),
    camera: {
      keyframes: [
        { time: 0, position: [2.35, 1.78, -3.55], target: [0, 1.42, 1.3], lensMillimeters: 48 },
        { time: 0.0625, position: [0, 1.72, -3.4], target: [0, 1.38, 1.3], lensMillimeters: 52 },
        {
          time: 0.125,
          position: [-2.35, 1.78, -3.55],
          target: [0, 1.42, 1.3],
          lensMillimeters: 48,
        },
      ],
    },
    lights: [
      {
        id: 'warm-reading-key',
        type: 'area',
        position: [-1.8, 3.35, -1],
        target: [0, 1.4, 1.35],
        color: [1, 0.74, 0.58],
        energy: 300,
        sizeMeters: 1.5,
      },
      {
        id: 'cool-window-fill',
        type: 'area',
        position: [2.35, 2.55, -0.65],
        target: [0, 1.35, 1.4],
        color: [0.4, 0.58, 1],
        energy: 265,
        sizeMeters: 3,
      },
      {
        id: 'shelf-rim',
        type: 'spot',
        position: [0.8, 3, 1.05],
        target: [0, 1.35, 1.65],
        color: [1, 0.65, 0.4],
        energy: 155,
        angleDegrees: 48,
      },
    ],
    atmosphere: { worldColor: [0.014, 0.018, 0.028], fogDensity: 0, fogColor: [0.08, 0.1, 0.14] },
    renderProfile: {
      engine: 'cycles-cpu',
      samples: 128,
      seed: 2718,
      denoise: true,
      intent: 'deterministic-final',
    },
    renderGates: [
      { id: 'interior-visible', type: 'frame-visibility', maximumBlackPercentage: 42 },
      { id: 'interior-highlight-detail', type: 'frame-overexposure', maximumWhitePercentage: 4 },
      {
        id: 'interior-material-presence',
        type: 'entity-set-frame-presence',
        entityIds,
        minimumVisibleFrameAreaPercentage: 4,
        maximumVisibleFrameAreaPercentage: 98,
        marginPercentage: 1,
      },
    ],
    landmarks: [
      {
        id: 'right-response',
        progress: 0,
        description: 'Warm plaster, oiled wood and limestone under opposing light',
      },
      {
        id: 'frontal',
        progress: 0.5,
        description: 'Interior material hierarchy and broad tonal movement',
      },
      {
        id: 'left-response',
        progress: 1,
        description: 'Opposite material response without baked lighting',
      },
    ],
    metadata: {
      verificationPurpose: 'environmental-surface-interior-transfer',
      materialSystemVersion: 3,
    },
  });
}

export async function createEnvironmentalSurfaceGallery(
  outputDirectory: string,
  only?: 'exterior' | 'interior',
) {
  const output = resolve(outputDirectory);
  const exterior = join(output, 'exterior');
  const interior = join(output, 'interior');
  await Promise.all([mkdir(exterior, { recursive: true }), mkdir(interior, { recursive: true })]);
  const [exteriorPaths, interiorPaths] = await Promise.all([
    saveExteriorWitness(exterior),
    saveInteriorWitness(interior),
  ]);
  const [exteriorSceneFile, interiorSceneFile] = await Promise.all([
    saveCinematicScene(join(exterior, 'scene.json'), exteriorScene(exteriorPaths)),
    saveCinematicScene(join(interior, 'scene.json'), interiorScene(interiorPaths)),
  ]);
  const exteriorRender =
    only === 'interior' ? undefined : await renderCinematicScene(exteriorSceneFile, exterior);
  const interiorRender =
    only === 'exterior' ? undefined : await renderCinematicScene(interiorSceneFile, interior);
  return {
    output,
    exterior: { sceneFile: exteriorSceneFile, render: exteriorRender },
    interior: { sceneFile: interiorSceneFile, render: interiorRender },
  };
}
