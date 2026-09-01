import { boxPart, capsuleBetween, gableRoofPart, type MeshPart } from '../geometry/primitives.js';

function deterministicRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function lanternParts(x: number, y: number, z: number): MeshPart[] {
  const parts = [
    capsuleBetween([x, y + 0.28, z + 0.16], [x, y + 0.28, z - 0.22], 0.018, 0.018, 0, 0, 3, 10),
    capsuleBetween([x, y + 0.28, z - 0.2], [x, y + 0.08, z - 0.34], 0.014, 0.014, 0, 0, 3, 10),
    boxPart([x - 0.115, y - 0.13, z - 0.41], [x + 0.115, y + 0.08, z - 0.25], 0, 'lantern-glass'),
    boxPart([x - 0.14, y - 0.17, z - 0.44], [x + 0.14, y - 0.13, z - 0.22], 0, 'aged-iron'),
    boxPart([x - 0.14, y + 0.08, z - 0.44], [x + 0.14, y + 0.12, z - 0.22], 0, 'aged-iron'),
  ];
  for (const offset of [-0.105, 0.105]) {
    parts.push(
      capsuleBetween(
        [x + offset, y - 0.13, z - 0.41],
        [x + offset, y + 0.08, z - 0.25],
        0.011,
        0.011,
        0,
        0,
        2,
        8,
      ),
    );
    parts.at(-1)!.materialId = 'aged-iron';
  }
  for (const part of parts.slice(0, 2)) part.materialId = 'aged-iron';
  return parts;
}

function drainpipeParts(x: number, height: number, z: number): MeshPart[] {
  const vertical = capsuleBetween([x, 0.18, z], [x, height, z], 0.038, 0.038, 0, 0, 3, 12);
  vertical.materialId = 'aged-copper';
  const outlet = capsuleBetween([x, 0.18, z], [x, 0.1, z - 0.18], 0.042, 0.042, 0, 0, 3, 12);
  outlet.materialId = 'aged-copper';
  return [vertical, outlet];
}

function facadeTimberParts(): MeshPart[] {
  const parts: MeshPart[] = [];
  const addFrame = (minX: number, maxX: number, height: number, z: number) => {
    parts.push(
      boxPart([minX, 0.12, z], [minX + 0.12, height, z + 0.09], 0, 'facade-timber'),
      boxPart([maxX - 0.12, 0.12, z], [maxX, height, z + 0.09], 0, 'facade-timber'),
      boxPart([minX, 2.35, z], [maxX, 2.49, z + 0.1], 0, 'facade-timber'),
      boxPart([minX, height - 0.28, z], [maxX, height - 0.12, z + 0.11], 0, 'facade-timber'),
    );
  };
  addFrame(-5.92, -3.8, 4.7, -0.2);
  addFrame(3.8, 5.92, 5.1, -0.2);
  for (const x of [-5.35, -4.55, 4.42, 5.18])
    parts.push(boxPart([x, 2.42, -0.205], [x + 0.09, 4.7, -0.1], 0, 'facade-timber'));
  // Opposing-facade cornices and pilasters establish depth at the end of the street canyon.
  for (const [minX, maxX, height] of [
    [-8.9, -3.25, 5.65],
    [-3, 2.85, 4.75],
    [3.1, 8.9, 6.05],
  ] as const) {
    parts.push(
      boxPart([minX, height, -5.03], [maxX, height + 0.18, -4.86], 0, 'limestone-trim'),
      boxPart([minX, 0.18, -5.03], [minX + 0.13, height, -4.91], 0, 'limestone-trim'),
      boxPart([maxX - 0.13, 0.18, -5.03], [maxX, height, -4.91], 0, 'limestone-trim'),
    );
  }
  return parts;
}

function skylineParts(): MeshPart[] {
  const parts = [
    gableRoofPart([-6.12, 4.72, -0.28], [-3.62, 5.68, 2.92], 'x', 0, 'roof-slate'),
    gableRoofPart([3.62, 5.08, -0.28], [6.12, 6.08, 2.62], 'x', 0, 'roof-slate'),
    gableRoofPart([-3.72, 4.02, -0.38], [3.72, 5.05, 2.72], 'x', 0, 'roof-slate'),
    // A real continuation/intersection supplies converging architecture and
    // atmospheric depth. The rejected v4 experiment placed a facade directly
    // across x=-9 and merely exchanged a black void for an obvious flat card.
    boxPart([-18, -0.12, -5.02], [-9, -0.015, -0.14], 0, 'wet-cobble'),
    // Leave a two-metre cross-street opening after the original canyon rather
    // than beginning the next facade at the same depth plane.
    boxPart([-14.1, 0, -5.38], [-11.05, 5.35, -5.04], 0, 'end-facade'),
    boxPart([-14.1, 0, -0.18], [-11.05, 4.65, 0.12], 0, 'end-facade'),
    gableRoofPart([-14.25, 5.32, -5.5], [-10.95, 6.25, -4.92], 'x', 0, 'roof-slate'),
    gableRoofPart([-14.25, 4.62, -0.3], [-10.95, 5.48, 0.25], 'x', 0, 'roof-slate'),
    // Do not close the axis with a frontal facade. Converging side masses,
    // world atmosphere, and the off-axis landmark create the distant layers.
  ];
  for (const [x, z] of [
    [-12.9, -5.035],
    [-11.75, -5.035],
    [-12.55, -0.185],
    [-11.45, -0.185],
  ] as const) {
    parts.push(
      boxPart([x, 1.18, z], [x + 0.72, 2.12, z + 0.055], 0, 'dark-window'),
      boxPart([x, 3.16, z], [x + 0.72, 4.08, z + 0.055], 0, 'warm-window'),
    );
  }
  return parts;
}

function shopSignParts(): MeshPart[] {
  const parts = [boxPart([3.36, 2.58, -0.63], [3.42, 2.98, -0.34], 0, 'sign-wood')];
  for (const x of [3.347, 3.421]) {
    parts.push(
      boxPart([x, 2.605, -0.605], [x + 0.012, 2.635, -0.365], 0, 'sign-gold'),
      boxPart([x, 2.925, -0.605], [x + 0.012, 2.955, -0.365], 0, 'sign-gold'),
      boxPart([x, 2.635, -0.605], [x + 0.012, 2.925, -0.575], 0, 'sign-gold'),
      boxPart([x, 2.635, -0.395], [x + 0.012, 2.925, -0.365], 0, 'sign-gold'),
      boxPart([x, 2.75, -0.5], [x + 0.012, 2.81, -0.47], 0, 'sign-gold'),
    );
  }
  for (const y of [2.68, 2.9]) {
    const bracket = capsuleBetween([3.4, y, -0.24], [3.4, y, -0.5], 0.018, 0.018, 0, 0, 3, 10);
    bracket.materialId = 'aged-iron';
    parts.push(bracket);
  }
  return parts;
}

function streetFurnitureParts(): MeshPart[] {
  const parts: MeshPart[] = [];
  for (const [x, z] of [
    [-5.35, -0.62],
    [5.25, -0.72],
    [-6.8, -4.72],
  ] as const) {
    const bollard = capsuleBetween([x, 0.06, z], [x, 0.72, z], 0.09, 0.09, 0, 0, 4, 12);
    bollard.materialId = 'aged-iron';
    parts.push(bollard);
  }
  // Reusable crate clusters sit out of the character path while supplying near-wall scale cues.
  for (const [x, y, z, size] of [
    [-5.55, 0.12, -0.45, 0.52],
    [-5.08, 0.12, -0.4, 0.4],
    [5.38, 0.12, -0.48, 0.46],
  ] as const) {
    parts.push(
      boxPart(
        [x - size / 2, y, z - size / 2],
        [x + size / 2, y + size, z + size / 2],
        0,
        'crate-wood',
      ),
      boxPart(
        [x - size / 2 - 0.025, y + size * 0.18, z - size / 2 - 0.025],
        [x + size / 2 + 0.025, y + size * 0.25, z + size / 2 + 0.025],
        0,
        'aged-iron',
      ),
      boxPart(
        [x - size / 2 - 0.025, y + size * 0.72, z - size / 2 - 0.025],
        [x + size / 2 + 0.025, y + size * 0.79, z + size / 2 + 0.025],
        0,
        'aged-iron',
      ),
    );
  }
  return parts;
}

function interiorBookParts(seed: number): MeshPart[] {
  const random = deterministicRandom(seed);
  const parts: MeshPart[] = [];
  const palettes = ['book-burgundy', 'book-forest', 'book-indigo', 'book-ochre', 'book-charcoal'];
  const rows = [0.19, 0.89, 1.59, 2.29];
  const fillShelf = (minX: number, maxX: number, frontZ: number) => {
    for (const shelfY of rows) {
      let x = minX + 0.07;
      while (x < maxX - 0.08) {
        const width = 0.045 + random() * 0.035;
        const height = 0.38 + random() * 0.18;
        const depth = 0.14 + random() * 0.08;
        parts.push(
          boxPart(
            [x, shelfY + 0.065, frontZ - depth],
            [Math.min(maxX - 0.06, x + width), shelfY + 0.065 + height, frontZ],
            0,
            palettes[Math.floor(random() * palettes.length)]!,
          ),
        );
        x += width + 0.012 + random() * 0.014;
      }
    }
  };
  fillShelf(-3.25, -2.27, 4.0);
  fillShelf(2.27, 3.25, 4.0);
  fillShelf(-1.62, 1.62, 4.48);
  // A small window-display still life makes the exterior glazing reveal an inhabited shop.
  for (let index = 0; index < 7; index++) {
    const width = 0.075 + random() * 0.035;
    const x = 1.38 + index * 0.18;
    parts.push(
      boxPart(
        [x, 0.82, 0.02],
        [x + width, 1.12 + random() * 0.22, 0.18],
        0,
        palettes[index % palettes.length]!,
      ),
    );
  }
  return parts;
}

export function createOldCityDressing(seed = 1847) {
  const groups = {
    facadeTimber: facadeTimberParts(),
    skyline: skylineParts(),
    shopSign: shopSignParts(),
    lanterns: [
      ...lanternParts(-0.95, 2.55, -0.08),
      ...lanternParts(3.95, 2.8, -0.08),
      ...lanternParts(-4.35, 2.7, -0.08),
    ],
    drainage: [
      ...drainpipeParts(-3.46, 3.95, -0.34),
      ...drainpipeParts(3.48, 3.95, -0.34),
      ...drainpipeParts(-5.82, 4.62, -0.27),
      ...drainpipeParts(5.82, 4.95, -0.27),
    ],
    streetFurniture: streetFurnitureParts(),
    books: interiorBookParts(seed + 41),
  };
  return {
    parts: Object.values(groups).flat(),
    counts: Object.fromEntries(Object.entries(groups).map(([id, parts]) => [id, parts.length])),
  };
}
