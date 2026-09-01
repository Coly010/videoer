import { boxPart, capsuleBetween, type MeshPart } from '../geometry/primitives.js';

export interface InsetWindowOptions {
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
  facadeFrontZ: number;
  facadeBackZ: number;
  frameMaterialId: string;
  glassMaterialId: string;
  interiorMaterialId: string;
  glazingThicknessMeters?: number;
  mullions?: 'cross' | 'vertical' | 'none';
  includeInteriorBacking?: boolean;
}

export interface WallOpening {
  id: string;
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
}

export interface WallWithOpeningsOptions {
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
  frontZ: number;
  backZ: number;
  materialId: string;
  openings: WallOpening[];
}

/**
 * Partitions a wall into non-overlapping rectangular solids around declared
 * apertures. This is a host-geometry operation: window and door modules do not
 * pretend an opaque wall behind them has been cut.
 */
export function wallWithRectangularOpeningsParts(options: WallWithOpeningsOptions): MeshPart[] {
  const { minimumX, maximumX, minimumY, maximumY, frontZ, backZ, materialId, openings } = options;
  if (maximumX <= minimumX || maximumY <= minimumY || backZ <= frontZ)
    throw new Error('Wall bounds must have positive extent');
  const ids = new Set<string>();
  for (const [index, opening] of openings.entries()) {
    if (!/^[a-z][a-z0-9-]*$/.test(opening.id) || ids.has(opening.id))
      throw new Error(`Wall opening ${index} requires a unique identifier`);
    ids.add(opening.id);
    if (
      opening.maximumX <= opening.minimumX ||
      opening.maximumY <= opening.minimumY ||
      opening.minimumX <= minimumX ||
      opening.maximumX >= maximumX ||
      opening.minimumY < minimumY ||
      opening.maximumY >= maximumY
    )
      throw new Error(
        `Wall opening '${opening.id}' must have positive extent strictly inside the wall`,
      );
  }
  for (let first = 0; first < openings.length; first++)
    for (let second = first + 1; second < openings.length; second++) {
      const a = openings[first]!;
      const b = openings[second]!;
      if (
        a.minimumX < b.maximumX &&
        a.maximumX > b.minimumX &&
        a.minimumY < b.maximumY &&
        a.maximumY > b.minimumY
      )
        throw new Error(`Wall openings '${a.id}' and '${b.id}' overlap`);
    }
  const xBreaks = [
    ...new Set([
      minimumX,
      maximumX,
      ...openings.flatMap((opening) => [opening.minimumX, opening.maximumX]),
    ]),
  ].sort((a, b) => a - b);
  const parts: MeshPart[] = [];
  for (let column = 0; column < xBreaks.length - 1; column++) {
    const columnMinimumX = xBreaks[column]!;
    const columnMaximumX = xBreaks[column + 1]!;
    const centreX = (columnMinimumX + columnMaximumX) * 0.5;
    const blocked = openings
      .filter((opening) => centreX > opening.minimumX && centreX < opening.maximumX)
      .map((opening) => [opening.minimumY, opening.maximumY] as const)
      .sort((a, b) => a[0] - b[0]);
    let cursorY = minimumY;
    for (const [blockedMinimumY, blockedMaximumY] of blocked) {
      if (blockedMinimumY > cursorY)
        parts.push(
          boxPart(
            [columnMinimumX, cursorY, frontZ],
            [columnMaximumX, blockedMinimumY, backZ],
            0,
            materialId,
          ),
        );
      cursorY = Math.max(cursorY, blockedMaximumY);
    }
    if (cursorY < maximumY)
      parts.push(
        boxPart(
          [columnMinimumX, cursorY, frontZ],
          [columnMaximumX, maximumY, backZ],
          0,
          materialId,
        ),
      );
  }
  return parts;
}

/**
 * Builds the reveal, glazing, frame, sill, and dim interior witness for a real
 * opening left by the caller's wall grammar. It deliberately does not place an
 * opaque facade card behind the opening.
 */
export function insetWindowParts(options: InsetWindowOptions): MeshPart[] {
  const {
    minimumX,
    maximumX,
    minimumY,
    maximumY,
    facadeFrontZ,
    facadeBackZ,
    frameMaterialId,
    glassMaterialId,
    interiorMaterialId,
    glazingThicknessMeters = 0.008,
    mullions = 'cross',
    includeInteriorBacking = true,
  } = options;
  if (maximumX <= minimumX || maximumY <= minimumY || facadeBackZ <= facadeFrontZ)
    throw new Error('Inset window dimensions must have positive extent');
  if (glazingThicknessMeters <= 0 || glazingThicknessMeters > 0.03)
    throw new Error('Inset window glazing thickness must be between 0 and 0.03 metres');
  const width = maximumX - minimumX;
  const height = maximumY - minimumY;
  const frame = Math.min(0.085, width * 0.09, height * 0.11);
  const front = facadeFrontZ - 0.045;
  const frameBack = facadeFrontZ + 0.075;
  const glassFront = facadeFrontZ + 0.085;
  const glassBack = glassFront + glazingThicknessMeters;
  const parts = [
    ...(includeInteriorBacking
      ? [
          // Optional witness backing is useful for isolated generators. Portable
          // production modules disable it so the actual host interior remains visible.
          boxPart(
            [minimumX + frame, minimumY + frame, facadeBackZ + 0.055],
            [maximumX - frame, maximumY - frame, facadeBackZ + 0.08],
            0,
            interiorMaterialId,
          ),
        ]
      : []),
    boxPart(
      [minimumX + frame, minimumY + frame, glassFront],
      [maximumX - frame, maximumY - frame, glassBack],
      0,
      glassMaterialId,
    ),
    boxPart(
      [minimumX - frame, minimumY - frame, front],
      [minimumX, maximumY + frame, frameBack],
      0,
      frameMaterialId,
    ),
    boxPart(
      [maximumX, minimumY - frame, front],
      [maximumX + frame, maximumY + frame, frameBack],
      0,
      frameMaterialId,
    ),
    boxPart(
      [minimumX, minimumY - frame, front],
      [maximumX, minimumY, frameBack],
      0,
      frameMaterialId,
    ),
    boxPart(
      [minimumX, maximumY, front],
      [maximumX, maximumY + frame, frameBack],
      0,
      frameMaterialId,
    ),
    // Projecting sill catches rain highlights and prevents a pasted-on read.
    boxPart(
      [minimumX - frame * 1.35, minimumY - frame * 1.45, facadeFrontZ - 0.11],
      [maximumX + frame * 1.35, minimumY - frame * 0.72, facadeBackZ + 0.02],
      0,
      frameMaterialId,
    ),
  ];
  if (mullions === 'cross' || mullions === 'vertical') {
    const centreX = (minimumX + maximumX) * 0.5;
    parts.push(
      boxPart(
        [centreX - frame * 0.32, minimumY, front - 0.006],
        [centreX + frame * 0.32, maximumY, glassFront],
        0,
        frameMaterialId,
      ),
    );
  }
  if (mullions === 'cross') {
    const centreY = (minimumY + maximumY) * 0.5;
    parts.push(
      boxPart(
        [minimumX, centreY - frame * 0.32, front - 0.006],
        [maximumX, centreY + frame * 0.32, glassFront],
        0,
        frameMaterialId,
      ),
    );
  }
  return parts;
}

export function projectingEaveParts(
  minimumX: number,
  maximumX: number,
  height: number,
  facadeZ: number,
  materialId: string,
): MeshPart[] {
  if (maximumX <= minimumX) throw new Error('Eave width must have positive extent');
  const parts = [
    boxPart(
      [minimumX, height, facadeZ - 0.22],
      [maximumX, height + 0.16, facadeZ + 0.34],
      0,
      materialId,
    ),
  ];
  const span = maximumX - minimumX;
  for (let index = 1; index < 5; index++) {
    const x = minimumX + (span * index) / 5;
    const brace = capsuleBetween(
      [x, height - 0.18, facadeZ + 0.05],
      [x, height - 0.015, facadeZ - 0.16],
      0.026,
      0.026,
      0,
      0,
      2,
      8,
    );
    brace.materialId = materialId;
    parts.push(brace);
  }
  return parts;
}
