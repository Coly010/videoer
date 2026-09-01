import type { GeometryMaterial } from '../geometry/model.js';
import {
  boxPart,
  mergeMeshParts,
  roundedBoxPart,
  surfaceOfRevolutionPart,
  sweptTubePart,
  type MeshPart,
} from '../geometry/primitives.js';
import { createOldCitySurfacePresets } from '../materials/old-city.js';

function material(
  id: string,
  baseColor: [number, number, number, number],
  roughness: number,
  metallic = 0,
): GeometryMaterial {
  return { id, baseColor, roughness, metallic, emission: [0, 0, 0], emissionStrength: 0 };
}

function host(parts: MeshPart[], id: string, hostClass: string) {
  return mergeMeshParts(id, parts, [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }], {
    generator: 'videoer.lighting-hosts.v1',
    purpose: 'lighting-transfer-evidence-only',
    hostClass,
    motionDependency: 'none',
  });
}

export function createMoonlitCourtyardHost() {
  const parts: MeshPart[] = [
    boxPart([-5.2, -0.16, -3.4], [5.2, 0, 4.4], 0, 'wet-stone'),
    boxPart([-5.2, 0, 3.95], [1.75, 3.65, 4.25], 0, 'aged-plaster'),
    boxPart([3.55, 0, 3.95], [5.2, 3.65, 4.25], 0, 'aged-plaster'),
    boxPart([1.75, 0, 3.95], [3.55, 0.92, 4.25], 0, 'aged-plaster'),
    boxPart([1.75, 2.62, 3.95], [3.55, 3.65, 4.25], 0, 'aged-plaster'),
    boxPart([-5.2, 0, -1.2], [-4.9, 3.3, 4.25], 0, 'dark-brick'),
    boxPart([4.9, 0, -1.2], [5.2, 3.3, 4.25], 0, 'dark-brick'),
    boxPart([-3.75, 0, 2.85], [-3.42, 3.05, 3.18], 0, 'limestone'),
    boxPart([-2.95, 0, 2.85], [-2.62, 3.05, 3.18], 0, 'limestone'),
    boxPart([-3.82, 2.82, 2.78], [-2.55, 3.12, 3.25], 0, 'limestone'),
    roundedBoxPart([-0.875, 0, 0.655], [0.875, 0.68, 1.705], 0.12, 0, 'limestone', 4),
    boxPart([1.87, 1.02, 3.78], [3.43, 2.52, 3.93], 0, 'dark-glazing'),
    boxPart([1.9, 1.05, 4.03], [3.4, 2.49, 4.07], 0, 'warm-aperture'),
    boxPart([1.73, 0.9, 3.72], [1.87, 2.65, 4.02], 0, 'weathered-wood'),
    boxPart([3.43, 0.9, 3.72], [3.57, 2.65, 4.02], 0, 'weathered-wood'),
    boxPart([1.73, 2.52, 3.72], [3.57, 2.66, 4.02], 0, 'weathered-wood'),
  ];
  const geometry = host(parts, 'lighting-host.moonlit-historic-courtyard', 'historic-courtyard');
  const presets = new Map(
    createOldCitySurfacePresets().map((preset) => [preset.id, preset.material]),
  );
  geometry.materials = [
    {
      ...material('wet-stone', [0.055, 0.065, 0.075, 1], 0.22),
      surface: presets.get('limestone-trim'),
    },
    {
      ...material('aged-plaster', [0.19, 0.17, 0.14, 1], 0.78),
      surface: presets.get('rain-aged-plaster'),
    },
    {
      ...material('dark-brick', [0.05, 0.018, 0.012, 1], 0.7),
      surface: presets.get('dark-brick'),
    },
    {
      ...material('limestone', [0.26, 0.25, 0.22, 1], 0.58),
      surface: presets.get('limestone-trim'),
    },
    {
      ...material('weathered-wood', [0.055, 0.018, 0.006, 1], 0.52),
      surface: presets.get('weathered-wood'),
    },
    {
      ...material('dark-glazing', [0.16, 0.2, 0.24, 1], 0.08),
      surface: presets.get('old-window-glazing'),
    },
    {
      ...material('warm-aperture', [0.18, 0.035, 0.008, 1], 0.6),
      emission: [1, 0.16, 0.035],
      emissionStrength: 2.2,
    },
  ];
  return geometry;
}

export function createContemporaryRooftopHost() {
  const parts: MeshPart[] = [
    boxPart([-5.5, -0.18, -3.8], [5.5, 0, 4.6], 0, 'roof-concrete'),
    boxPart([-5.5, 0, 4.25], [5.5, 1.05, 4.6], 0, 'roof-concrete'),
    boxPart([-5.5, 0, -3.8], [-5.15, 1.05, 4.6], 0, 'roof-concrete'),
    boxPart([5.15, 0, -3.8], [5.5, 1.05, 4.6], 0, 'roof-concrete'),
    boxPart([2.0, 0, 2.85], [2.18, 2.8, 3.22], 0, 'service-cladding'),
    boxPart([3.62, 0, 2.85], [3.8, 2.8, 3.22], 0, 'service-cladding'),
    boxPart([2.18, 0, 2.85], [3.62, 0.18, 3.22], 0, 'service-cladding'),
    boxPart([2.18, 2.28, 2.85], [3.62, 2.8, 3.22], 0, 'service-cladding'),
    boxPart([2.18, 0.18, 2.62], [3.62, 2.28, 2.78], 0, 'dark-glazing'),
    boxPart([2.22, 0.22, 3.16], [3.58, 2.24, 3.2], 0, 'warm-aperture'),
    boxPart([-3.8, 0, 2.7], [-3.5, 3.1, 3.0], 0, 'painted-steel'),
    boxPart([-1.8, 0, 2.7], [-1.5, 3.1, 3.0], 0, 'painted-steel'),
    boxPart([-3.95, 2.86, 2.62], [-1.35, 3.14, 3.08], 0, 'painted-steel'),
    roundedBoxPart([-0.95, 0, 0.35], [0.95, 0.84, 1.65], 0.16, 0, 'roof-concrete', 5),
  ];
  const geometry = host(parts, 'lighting-host.contemporary-rooftop', 'contemporary-rooftop');
  geometry.materials = [
    material('roof-concrete', [0.14, 0.155, 0.17, 1], 0.74),
    material('service-cladding', [0.055, 0.065, 0.075, 1], 0.38, 0.75),
    material('painted-steel', [0.02, 0.025, 0.032, 1], 0.3, 0.7),
    material('dark-glazing', [0.055, 0.095, 0.14, 1], 0.1),
    {
      ...material('warm-aperture', [0.12, 0.025, 0.006, 1], 0.58),
      emission: [1, 0.14, 0.025],
      emissionStrength: 1.15,
    },
  ];
  return geometry;
}

function hearthEmberParts(
  centerX: number,
  centerY: number,
  centerZ: number,
  width: number,
): MeshPart[] {
  const parts: MeshPart[] = [];
  for (let index = 0; index < 28; index++) {
    const unitX = (Math.sin(index * 12.9898 + 0.71) + 1) * 0.5;
    const unitZ = (Math.sin(index * 7.113 + 2.31) + 1) * 0.5;
    const x = centerX - width * 0.47 + unitX * width * 0.94;
    const y = centerY + 0.015 + Math.sin(index * 1.73) * 0.022;
    const z = centerZ - 0.17 + unitZ * 0.29;
    const radius = 0.035 + ((index * 17) % 7) * 0.004;
    parts.push(
      roundedBoxPart(
        [x - radius * 1.35, y - radius * 0.62, z - radius],
        [x + radius * 1.35, y + radius * 0.62, z + radius],
        radius * 0.45,
        0,
        'hearth-embers',
        3,
      ),
    );
  }
  for (let index = 0; index < 7; index++) {
    const x = centerX + (index / 6 - 0.5) * width * 0.72;
    const z = centerZ - 0.035 + Math.sin(index * 1.91) * 0.075;
    const height = 0.2 + ((index * 11) % 5) * 0.045;
    const tongue = surfaceOfRevolutionPart(
      [
        { radius: 0.055, y: centerY + 0.035 },
        { radius: 0.085, y: centerY + height * 0.28 },
        { radius: 0.05, y: centerY + height * 0.68 },
        { radius: 0.012, y: centerY + height },
      ],
      9,
      0,
      'hearth-embers',
    );
    tongue.positions = tongue.positions.map(([px, py, pz]) => [px + x, py, pz + z]);
    parts.push(tongue);
  }
  parts.push(
    sweptTubePart({
      points: [
        [centerX - width * 0.42, centerY + 0.08, centerZ - 0.03],
        [centerX + width * 0.42, centerY + 0.15, centerZ + 0.02],
      ],
      radius: 0.07,
      radialSegments: 10,
      bone: 0,
      materialId: 'charred-log',
    }),
    sweptTubePart({
      points: [
        [centerX - width * 0.38, centerY + 0.16, centerZ + 0.05],
        [centerX + width * 0.36, centerY + 0.08, centerZ - 0.04],
      ],
      radius: 0.065,
      radialSegments: 10,
      bone: 0,
      materialId: 'charred-log',
    }),
  );
  return parts;
}

function fireHostMaterials(contemporary = false): GeometryMaterial[] {
  return [
    material('floor', contemporary ? [0.09, 0.1, 0.11, 1] : [0.1, 0.075, 0.055, 1], 0.64),
    material('wall', contemporary ? [0.18, 0.19, 0.2, 1] : [0.2, 0.13, 0.075, 1], 0.8),
    material('hearth-stone', contemporary ? [0.055, 0.06, 0.065, 1] : [0.16, 0.13, 0.1, 1], 0.52),
    material('hearth-recess', [0.004, 0.003, 0.002, 1], 0.95),
    material('charred-log', [0.012, 0.004, 0.0015, 1], 0.86),
    {
      ...material('hearth-embers', [0.35, 0.025, 0.002, 1], 0.42),
      emission: [1, 0.035, 0.003],
      emissionStrength: contemporary ? 2.1 : 2.5,
    },
    material('dark-metal', [0.018, 0.021, 0.025, 1], 0.28, 0.88),
  ];
}

export function createFirelitChamberHost() {
  const parts: MeshPart[] = [
    boxPart([-4.4, -0.16, -3.2], [4.4, 0, 4.2], 0, 'floor'),
    boxPart([-4.4, 0, 3.86], [4.4, 3.65, 4.16], 0, 'wall'),
    boxPart([-4.4, 0, -1.2], [-4.1, 3.4, 4.16], 0, 'wall'),
    boxPart([4.1, 0, -1.2], [4.4, 3.4, 4.16], 0, 'wall'),
    boxPart([-4.4, 3.4, -3.2], [4.4, 3.62, 4.16], 0, 'wall'),
    boxPart([-2.9, 0, 3.48], [-0.7, 0.28, 3.88], 0, 'hearth-stone'),
    boxPart([-2.9, 2.05, 3.48], [-0.7, 2.34, 3.88], 0, 'hearth-stone'),
    boxPart([-2.9, 0.28, 3.48], [-2.58, 2.05, 3.88], 0, 'hearth-stone'),
    boxPart([-1.02, 0.28, 3.48], [-0.7, 2.05, 3.88], 0, 'hearth-stone'),
    boxPart([-2.58, 0.28, 3.72], [-1.02, 2.05, 3.84], 0, 'hearth-recess'),
    boxPart([-3.15, 2.3, 3.42], [-0.45, 2.48, 3.94], 0, 'dark-metal'),
    ...hearthEmberParts(-1.8, 0.42, 3.42, 1.28),
    roundedBoxPart([1.05, 0, 1.5], [2.8, 0.62, 2.55], 0.11, 0, 'hearth-stone', 4),
  ];
  const geometry = host(parts, 'lighting-host.firelit-stone-chamber', 'historic-firelit-chamber');
  geometry.materials = fireHostMaterials(false);
  return geometry;
}

export function createContemporaryFireLoungeHost() {
  const parts: MeshPart[] = [
    boxPart([-4.8, -0.16, -3.3], [4.8, 0, 4.3], 0, 'floor'),
    boxPart([-4.8, 0, 3.95], [4.8, 3.45, 4.25], 0, 'wall'),
    boxPart([-4.8, 0, -0.8], [-4.5, 3.2, 4.25], 0, 'wall'),
    boxPart([4.5, 0, -0.8], [4.8, 3.2, 4.25], 0, 'wall'),
    boxPart([-4.8, 3.2, -3.3], [4.8, 3.42, 4.25], 0, 'wall'),
    boxPart([-2.85, 0.18, 3.52], [2.85, 1.22, 3.88], 0, 'hearth-stone'),
    boxPart([-2.5, 0.38, 3.3], [2.5, 1.02, 3.5], 0, 'hearth-recess'),
    ...hearthEmberParts(0, 0.48, 3.25, 3.8),
    roundedBoxPart([-1.0, 0, 1.05], [1.0, 0.54, 2.4], 0.13, 0, 'hearth-stone', 5),
    boxPart([-3.8, 0, 1.0], [-3.48, 2.85, 1.32], 0, 'dark-metal'),
    boxPart([3.48, 0, 1.0], [3.8, 2.85, 1.32], 0, 'dark-metal'),
    boxPart([-3.95, 2.62, 0.92], [3.95, 2.92, 1.4], 0, 'dark-metal'),
  ];
  const geometry = host(
    parts,
    'lighting-host.contemporary-fire-lounge',
    'contemporary-fire-lounge',
  );
  geometry.materials = fireHostMaterials(true);
  return geometry;
}
