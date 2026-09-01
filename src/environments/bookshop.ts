import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import { boxPart, mergeMeshParts } from '../geometry/primitives.js';
import { createOldCitySurfacePresets } from '../materials/old-city.js';
import { wetCobbleGeometryMaterials } from '../materials/wet-cobble.js';
import {
  insetWindowParts,
  projectingEaveParts,
  wallWithRectangularOpeningsParts,
} from './architectural-modules.js';
import { createOldCityDressing } from './dressing.js';

const material = (
  id: string,
  baseColor: [number, number, number, number],
  roughness: number,
  metallic = 0,
): GeometryMaterial => ({
  id,
  baseColor,
  roughness,
  metallic,
  emission: [0, 0, 0],
  emissionStrength: 0,
});

function bookcaseParts(minX: number, maxX: number, minZ: number, maxZ: number) {
  const side = 0.075;
  const plank = 0.065;
  return [
    boxPart([minX, 0.12, minZ], [minX + side, 3.25, maxZ], 0, 'shelf-wood'),
    boxPart([maxX - side, 0.12, minZ], [maxX, 3.25, maxZ], 0, 'shelf-wood'),
    ...[0.12, 0.82, 1.52, 2.22, 3.18].map((height) =>
      boxPart([minX, height, minZ], [maxX, height + plank, maxZ], 0, 'shelf-wood'),
    ),
  ];
}

function deterministicRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function cobbleParts(seed: number) {
  const random = deterministicRandom(seed);
  const parts = [];
  const rowDepth = 0.46;
  const stoneWidth = 0.42;
  for (let row = 0; row < 11; row++) {
    const minZ = -5.22 + row * rowDepth;
    const offset = row % 2 ? stoneWidth * 0.5 : 0;
    for (let column = -22; column <= 22; column++) {
      const centerX = column * stoneWidth + offset;
      if (centerX < -8.8 || centerX > 8.8) continue;
      const inset = 0.018 + random() * 0.018;
      const halfWidth = stoneWidth * (0.43 + random() * 0.035);
      const height = -0.006 + random() * 0.009;
      const materialId = `wet-cobble-${1 + Math.floor(random() * 3)}`;
      parts.push(
        boxPart(
          [centerX - halfWidth, -0.022, minZ + inset],
          [centerX + halfWidth, height, minZ + rowDepth - inset],
          0,
          materialId,
        ),
      );
    }
  }
  return parts;
}

export function createOldCityBookshop(): GeometryAsset {
  const root = [
    { id: 'root', restPosition: [0, 0, 0] as [number, number, number], constraints: {} },
  ];
  const dressing = createOldCityDressing(1847);
  const parts = [
    // Wet street and raised pavements establish one continuous exterior coordinate system.
    boxPart([-9, -0.12, -5.4], [9, -0.025, -0.35], 0, 'wet-cobble'),
    ...cobbleParts(1847),
    boxPart([-9, -0.02, -0.35], [9, 0.12, 0], 0, 'stone'),
    // The reusable host-wall grammar leaves real apertures for every module.
    ...wallWithRectangularOpeningsParts({
      minimumX: -3.6,
      maximumX: 3.6,
      minimumY: 0,
      maximumY: 4.1,
      frontZ: -0.18,
      backZ: 0.12,
      materialId: 'dark-brick',
      openings: [
        { id: 'door', minimumX: -0.61, maximumX: 0.59, minimumY: 0, maximumY: 2.16 },
        {
          id: 'display-window',
          minimumX: 1.12,
          maximumX: 3.18,
          minimumY: 0.72,
          maximumY: 3.02,
        },
        {
          id: 'upper-left-window',
          minimumX: -2.95,
          maximumX: -1.72,
          minimumY: 2.85,
          maximumY: 3.78,
        },
        {
          id: 'upper-right-window',
          minimumX: 1.5,
          maximumX: 2.78,
          minimumY: 3.2,
          maximumY: 3.84,
        },
      ],
    }),
    // Window, trim, sill, door surround, and warm interior reveal.
    // Eight-millimetre glazing remains a distinct transmissive layer; the
    // real bookshop interior behind it supplies the visible warm witness.
    boxPart([1.18, 0.78, -0.08], [3.12, 2.96, -0.072], 0, 'glass'),
    boxPart([1.08, 0.68, -0.14], [3.22, 0.78, 0.05], 0, 'wood'),
    boxPart([1.08, 2.96, -0.14], [3.22, 3.06, 0.05], 0, 'wood'),
    boxPart([1.08, 0.68, -0.14], [1.18, 3.06, 0.05], 0, 'wood'),
    boxPart([3.12, 0.68, -0.14], [3.22, 3.06, 0.05], 0, 'wood'),
    boxPart([2.1, 0.68, -0.145], [2.2, 3.06, -0.02], 0, 'wood'),
    boxPart([1.08, 1.82, -0.145], [3.22, 1.92, -0.02], 0, 'wood'),
    boxPart([-0.67, 0, -0.22], [-0.59, 2.2, 0.14], 0, 'wood'),
    boxPart([0.59, 0, -0.22], [0.67, 2.2, 0.14], 0, 'wood'),
    boxPart([-0.67, 2.12, -0.22], [0.67, 2.2, 0.14], 0, 'wood'),
    ...insetWindowParts({
      minimumX: -2.95,
      maximumX: -1.72,
      minimumY: 2.85,
      maximumY: 3.78,
      facadeFrontZ: -0.18,
      facadeBackZ: 0.12,
      frameMaterialId: 'window-frame-painted',
      glassMaterialId: 'glass',
      interiorMaterialId: 'window-interior-dim',
      mullions: 'cross',
    }),
    ...insetWindowParts({
      minimumX: 1.5,
      maximumX: 2.78,
      minimumY: 3.2,
      maximumY: 3.84,
      facadeFrontZ: -0.18,
      facadeBackZ: 0.12,
      frameMaterialId: 'window-frame-painted',
      glassMaterialId: 'glass',
      interiorMaterialId: 'window-interior-dim',
      mullions: 'vertical',
    }),
    ...projectingEaveParts(-3.82, 3.82, 4.04, -0.18, 'facade-timber'),
    // Interior shell continues behind the same facade rather than becoming a separate set.
    boxPart([-3.55, -0.1, 0.12], [3.55, 0, 5.1], 0, 'interior-floor'),
    boxPart([-3.6, 0, 5.0], [3.6, 4.1, 5.12], 0, 'warm-plaster'),
    boxPart([-3.6, 0, 0.12], [-3.48, 4.1, 5.12], 0, 'warm-plaster'),
    boxPart([3.48, 0, 0.12], [3.6, 4.1, 5.12], 0, 'warm-plaster'),
    // Open production ceiling preserves the spatial shell while allowing cinematic cameras and rigs.
    // Project-owned open-backed shelves and counter establish scale and useful interior blocking.
    ...bookcaseParts(-3.32, -2.2, 3.9, 4.72),
    ...bookcaseParts(2.2, 3.32, 3.9, 4.72),
    ...bookcaseParts(-1.7, 1.7, 4.42, 4.82),
    boxPart([1.45, 0.12, 1.35], [2.75, 1.02, 2.05], 0, 'counter-wood'),
    // Neighbouring facades give the street view real depth and a narrow old-city silhouette.
    boxPart([-6, 0, -0.05], [-3.72, 4.8, 2.8], 0, 'neighbour-plaster'),
    boxPart([3.72, 0, -0.05], [6, 5.2, 2.5], 0, 'neighbour-plaster'),
    // Opposing facades create a narrow street canyon and parallax for tracking/establishing shots.
    boxPart([-9, 0, -5.38], [-3.2, 5.8, -5.04], 0, 'opposite-stone'),
    boxPart([-3.05, 0, -5.38], [2.9, 4.9, -5.04], 0, 'opposite-plaster'),
    boxPart([3.05, 0, -5.38], [9, 6.2, -5.04], 0, 'opposite-stone'),
    ...[-7.5, -5.8, -4.1, -1.9, -0.2, 1.5, 4.1, 5.9, 7.6].flatMap((x, index) =>
      [1.25, 3.25].map((y) =>
        boxPart(
          [x, y, -5.035],
          [x + 0.88, y + 1.15, -4.98],
          0,
          index % 3 === 0 ? 'warm-window' : 'dark-window',
        ),
      ),
    ),
    // Facade articulation and practicals prevent the street from reading as unbroken boxes.
    ...[-5.15, 4.55].map((x) =>
      boxPart([x, 0.8, -0.16], [x + 0.86, 2.05, -0.08], 0, 'dark-window'),
    ),
    ...[-5.7, -4.15, 4.05, 5.35].map((x) =>
      boxPart([x, 2.75, -0.16], [x + 0.72, 3.72, -0.08], 0, 'dark-window'),
    ),
    ...[-0.95, 0.82, 3.45, -3.55].map((x) =>
      boxPart([x, 2.35, -0.28], [x + 0.12, 2.53, -0.04], 0, 'warm-practical'),
    ),
    // A stepped project-owned tower anchors the true far skyline. Earlier
    // candidates placed it at x=-9, where the establishing camera read it as
    // a near black wall rather than a landmark.
    boxPart([-15.35, 0, -5.02], [-13.75, 7.1, -3.82], 0, 'tower-stone'),
    boxPart([-15.17, 7.1, -4.88], [-13.93, 8.35, -3.96], 0, 'tower-stone'),
    boxPart([-14.95, 8.35, -4.72], [-14.15, 9.4, -4.12], 0, 'tower-roof'),
    ...[1.45, 3.25, 5.05].map((y) =>
      boxPart([-14.82, y, -3.81], [-14.28, y + 0.82, -3.73], 0, 'warm-window'),
    ),
    ...[1.6, 3.4, 5.2].map((y) =>
      boxPart([-13.74, y, -4.76], [-13.66, y + 0.78, -4.12], 0, 'warm-window'),
    ),
    ...dressing.parts,
  ];
  const asset = mergeMeshParts('environment.old-city-bookshop', parts, root, {
    generator: 'videoer.old-city-bookshop.v5',
    parameters: { width: 18, exteriorDepth: 5.4, interiorDepth: 5.1, height: 9.4 },
    environmentClass: 'continuous-exterior-interior-bookshop',
    deterministicSeed: 1847,
    productionFeatures: [
      'staggered-cobble-relief',
      'wet-roughness-variation',
      'opposing-street-facades',
      'warm-practicals',
      'distant-stepped-tower',
      'modular-facade-dressing',
      'inset-upper-window-modules',
      'projecting-eave-and-brackets',
      'wall-lantern-practicals',
      'drainage-and-street-furniture',
      'populated-bookshop-shelves',
      'physical-eight-millimetre-window-glazing',
    ],
    dressingInventory: dressing.counts,
  });
  const surfaces = new Map(
    createOldCitySurfacePresets().map((preset) => [preset.id, preset.material]),
  );
  asset.materials = [
    {
      ...material('wet-cobble', [0.055, 0.07, 0.085, 1], 0.18, 0.05),
      surface: wetCobbleGeometryMaterials()[0]!.surface,
    },
    ...wetCobbleGeometryMaterials(),
    { ...material('stone', [0.2, 0.21, 0.22, 1], 0.64), surface: surfaces.get('limestone-trim') },
    {
      ...material('dark-brick', [0.14, 0.075, 0.055, 1], 0.78),
      surface: surfaces.get('dark-brick'),
    },
    {
      ...material('glass', [0.72, 0.82, 0.84, 1], 0.08),
      surface: surfaces.get('old-window-glazing'),
    },
    material('window-frame-painted', [0.24, 0.075, 0.022, 1], 0.48),
    {
      ...material('window-interior-dim', [0.18, 0.07, 0.025, 1], 0.48),
      emission: [0.72, 0.19, 0.045],
      emissionStrength: 0.42,
    },
    { ...material('wood', [0.19, 0.07, 0.03, 1], 0.56), surface: surfaces.get('weathered-wood') },
    material('interior-floor', [0.2, 0.11, 0.055, 1], 0.48),
    {
      ...material('warm-plaster', [0.48, 0.29, 0.16, 1], 0.82),
      surface: surfaces.get('warm-interior-plaster'),
    },
    {
      ...material('shelf-wood', [0.095, 0.035, 0.018, 1], 0.62),
      surface: surfaces.get('oiled-shelf-wood'),
    },
    {
      ...material('counter-wood', [0.16, 0.055, 0.025, 1], 0.5),
      surface: surfaces.get('oiled-shelf-wood'),
    },
    {
      ...material('neighbour-plaster', [0.12, 0.11, 0.12, 1], 0.86),
      surface: surfaces.get('rain-aged-plaster'),
    },
    {
      ...material('opposite-stone', [0.075, 0.082, 0.095, 1], 0.84),
      surface: surfaces.get('limestone-trim'),
    },
    {
      ...material('opposite-plaster', [0.115, 0.085, 0.075, 1], 0.79),
      surface: surfaces.get('rain-aged-plaster'),
    },
    material('dark-window', [0.018, 0.028, 0.045, 1], 0.22),
    {
      ...material('warm-window', [0.34, 0.12, 0.035, 1], 0.28),
      emission: [1, 0.24, 0.045],
      emissionStrength: 2.2,
    },
    {
      ...material('warm-practical', [0.5, 0.16, 0.035, 1], 0.24),
      emission: [1, 0.18, 0.025],
      emissionStrength: 4,
    },
    {
      ...material('tower-stone', [0.068, 0.064, 0.072, 1], 0.9),
      surface: surfaces.get('limestone-trim'),
    },
    material('tower-roof', [0.035, 0.04, 0.055, 1], 0.74),
    material('roof-slate', [0.025, 0.035, 0.05, 1], 0.46),
    {
      ...material('end-facade', [0.1, 0.08, 0.075, 1], 0.76),
      surface: surfaces.get('rain-aged-plaster'),
    },
    material('dark-passage', [0.004, 0.006, 0.01, 1], 0.92),
    {
      ...material('facade-timber', [0.07, 0.018, 0.007, 1], 0.58),
      surface: surfaces.get('weathered-wood'),
    },
    material('sign-wood', [0.32, 0.09, 0.025, 1], 0.5),
    material('sign-gold', [0.62, 0.3, 0.055, 1], 0.25, 0.78),
    material('aged-iron', [0.025, 0.03, 0.035, 1], 0.32, 0.72),
    material('aged-copper', [0.045, 0.105, 0.08, 1], 0.48, 0.5),
    {
      ...material('limestone-trim', [0.25, 0.24, 0.22, 1], 0.62),
      surface: surfaces.get('limestone-trim'),
    },
    {
      ...material('crate-wood', [0.13, 0.045, 0.015, 1], 0.66),
      surface: surfaces.get('weathered-wood'),
    },
    {
      ...material('lantern-glass', [0.45, 0.16, 0.035, 0.82], 0.18),
      emission: [1, 0.2, 0.025],
      emissionStrength: 6,
    },
    material('book-burgundy', [0.18, 0.025, 0.025, 1], 0.58),
    material('book-forest', [0.025, 0.12, 0.07, 1], 0.62),
    material('book-indigo', [0.035, 0.045, 0.16, 1], 0.56),
    material('book-ochre', [0.3, 0.12, 0.025, 1], 0.6),
    material('book-charcoal', [0.035, 0.032, 0.03, 1], 0.7),
  ];
  asset.attachments = {
    'door-anchor': { position: [0, 0, 0], rotation: [0, 0, 0], bone: 'root' },
    'window-gaze-target': { position: [2.15, 1.72, -0.04], rotation: [0, 0, 0], bone: 'root' },
    'street-path-start': {
      position: [-3.2, 0.12, -1.3],
      rotation: [0, Math.PI / 2, 0],
      bone: 'root',
    },
    'street-path-end': { position: [2.8, 0.12, -1.3], rotation: [0, Math.PI / 2, 0], bone: 'root' },
    'door-approach': { position: [0.1, 0.12, -0.82], rotation: [0, 0, 0], bone: 'root' },
    'threshold-interior': { position: [0, 0.12, 0.55], rotation: [0, 0, 0], bone: 'root' },
    'reading-position': { position: [0.45, 0, 2.25], rotation: [0, Math.PI, 0], bone: 'root' },
    'interior-camera': { position: [-1.6, 1.45, 1.25], rotation: [0, -0.55, 0], bone: 'root' },
  };
  return asset;
}
