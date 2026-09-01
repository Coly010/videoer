import { z } from 'zod';
import { canonicalSha256 } from '../assets/sources/cache.js';
import {
  surfaceWaterFieldSchema,
  verifyStaticSurfaceWaterField,
  type SurfaceWaterField,
} from './surface-water.js';

const identifier = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/);
const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const surfaceWaterOpticalSurfaceOptionsSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  contourDepthMeters: z.number().nonnegative().max(0.02).default(0.000_01),
  opticalOffsetMeters: z.number().nonnegative().max(0.02).default(0.000_2),
  maximumVolumeCorrectionFactor: z.number().min(1).max(100).default(20),
});

export type SurfaceWaterOpticalSurfaceOptions = z.input<
  typeof surfaceWaterOpticalSurfaceOptionsSchema
>;

const reconstructionReportSchema = z.object({
  sourceWetCellCount: z.number().int().nonnegative(),
  vertexCount: z.number().int().nonnegative(),
  triangleCount: z.number().int().nonnegative(),
  boundaryVertexCount: z.number().int().nonnegative(),
  nonGridAlignedBoundaryVertexCount: z.number().int().nonnegative(),
  sourcePuddleVolumeCubicMeters: z.number().nonnegative(),
  rawReconstructedVolumeCubicMeters: z.number().nonnegative(),
  reconstructedVolumeCubicMeters: z.number().nonnegative(),
  volumeCorrectionFactor: z.number().positive(),
  volumeErrorCubicMeters: z.number(),
  maximumSourcePuddleDepthMeters: z.number().nonnegative(),
  maximumReconstructedDepthMeters: z.number().nonnegative(),
});

export const surfaceWaterOpticalSurfaceSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  generator: z.literal('videoer.surface-water-optical-surface.v1'),
  sourceFieldId: identifier,
  sourceFieldSha256: sha256,
  reconstructionSha256: sha256,
  options: surfaceWaterOpticalSurfaceOptionsSchema.omit({ schemaVersion: true, id: true }),
  positions: z.array(vec3),
  groundHeightsMeters: z.array(z.number().finite()),
  depthsMeters: z.array(z.number().nonnegative()),
  indices: z.array(z.number().int().nonnegative()),
  report: reconstructionReportSchema,
});

export type SurfaceWaterOpticalSurface = z.infer<typeof surfaceWaterOpticalSurfaceSchema>;

interface ScalarVertex {
  key: string;
  x: number;
  z: number;
  groundY: number;
  sourceDepth: number;
  rawDepth: number;
}

function projectedTriangleArea(
  positions: Array<[number, number, number]>,
  indices: number[],
  offset: number,
) {
  const a = positions[indices[offset]!]!;
  const b = positions[indices[offset + 1]!]!;
  const c = positions[indices[offset + 2]!]!;
  return Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) * 0.5;
}

function reconstructedVolume(
  positions: Array<[number, number, number]>,
  depths: number[],
  indices: number[],
) {
  let volume = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const area = projectedTriangleArea(positions, indices, offset);
    volume +=
      area *
      (depths[indices[offset]!]! +
        depths[indices[offset + 1]!]! +
        depths[indices[offset + 2]!]!) /
      3;
  }
  return volume;
}

function edgeVertex(
  first: ScalarVertex,
  second: ScalarVertex,
  contourDepth: number,
): ScalarVertex {
  const denominator = second.sourceDepth - first.sourceDepth;
  const amount = denominator === 0 ? 0.5 : (contourDepth - first.sourceDepth) / denominator;
  const [left, right] = first.key < second.key ? [first.key, second.key] : [second.key, first.key];
  return {
    key: `edge:${left}:${right}`,
    x: first.x + (second.x - first.x) * amount,
    z: first.z + (second.z - first.z) * amount,
    groundY: first.groundY + (second.groundY - first.groundY) * amount,
    sourceDepth: contourDepth,
    rawDepth: 0,
  };
}

function clipTriangle(vertices: ScalarVertex[], contourDepth: number) {
  const output: ScalarVertex[] = [];
  for (let index = 0; index < vertices.length; index++) {
    const current = vertices[index]!;
    const next = vertices[(index + 1) % vertices.length]!;
    const currentInside = current.sourceDepth > contourDepth;
    const nextInside = next.sourceDepth > contourDepth;
    if (currentInside)
      output.push({ ...current, rawDepth: current.sourceDepth - contourDepth });
    if (currentInside !== nextInside) output.push(edgeVertex(current, next, contourDepth));
  }
  return output;
}

function gridAligned(value: number, origin: number, cellSize: number) {
  return Math.abs((value - origin) / cellSize - Math.round((value - origin) / cellSize)) < 1e-8;
}

export function reconstructSurfaceWaterOpticalSurface(
  fieldValue: SurfaceWaterField,
  optionsValue: SurfaceWaterOpticalSurfaceOptions,
): SurfaceWaterOpticalSurface {
  const field = surfaceWaterFieldSchema.parse(fieldValue);
  const fieldVerification = verifyStaticSurfaceWaterField(field);
  if (!fieldVerification.valid)
    throw new Error(`cannot reconstruct invalid surface-water field: ${fieldVerification.issues.join('; ')}`);
  const options = surfaceWaterOpticalSurfaceOptionsSchema.parse(optionsValue);
  const sourceVolume = field.massBalance.puddleCubicMeters;
  const sourceWetCells = field.cells.filter((cell) => cell.puddleDepthMeters > 0);
  const cellByIndex = new Map(field.cells.map((cell) => [cell.index, cell]));
  const { columns, rows, cellSizeMeters, worldOriginXZ } = field.grid;
  const lattice = new Map<string, ScalarVertex>();
  const at = (column: number, row: number) => {
    const key = `${column}:${row}`;
    const existing = lattice.get(key);
    if (existing) return existing;
    const adjacent = [
      [column - 1, row - 1],
      [column, row - 1],
      [column - 1, row],
      [column, row],
    ]
      .filter(
        ([cellColumn, cellRow]) =>
          cellColumn! >= 0 && cellColumn! < columns && cellRow! >= 0 && cellRow! < rows,
      )
      .map(([cellColumn, cellRow]) => cellByIndex.get(cellRow! * columns + cellColumn!))
      .filter((cell): cell is SurfaceWaterField['cells'][number] => Boolean(cell));
    const groundY = adjacent.length
      ? adjacent.reduce((sum, cell) => sum + cell.worldPosition[1], 0) / adjacent.length
      : 0;
    // Missing or partially covered solver cells contribute dry area. Dividing by four makes the
    // scalar field taper at receiver and puddle boundaries instead of extruding solver-cell tiles.
    const sourceDepth =
      adjacent.reduce((sum, cell) => sum + cell.puddleDepthMeters * cell.coverage, 0) / 4;
    const vertex: ScalarVertex = {
      key: `lattice:${key}`,
      x: worldOriginXZ[0] + column * cellSizeMeters,
      z: worldOriginXZ[1] + row * cellSizeMeters,
      groundY,
      sourceDepth,
      rawDepth: Math.max(0, sourceDepth - options.contourDepthMeters),
    };
    lattice.set(key, vertex);
    return vertex;
  };

  const vertexByKey = new Map<string, number>();
  const scalarVertices: ScalarVertex[] = [];
  const indices: number[] = [];
  const vertexIndex = (vertex: ScalarVertex) => {
    const existing = vertexByKey.get(vertex.key);
    if (existing !== undefined) return existing;
    const index = scalarVertices.length;
    scalarVertices.push(vertex);
    vertexByKey.set(vertex.key, index);
    return index;
  };
  const emit = (triangle: ScalarVertex[]) => {
    const clipped = clipTriangle(triangle, options.contourDepthMeters);
    if (clipped.length < 3) return;
    const first = vertexIndex(clipped[0]!);
    for (let index = 1; index < clipped.length - 1; index++) {
      const second = vertexIndex(clipped[index]!);
      const third = vertexIndex(clipped[index + 1]!);
      const a = scalarVertices[first]!;
      const b = scalarVertices[second]!;
      const c = scalarVertices[third]!;
      const twiceArea = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
      if (twiceArea > 1e-12) indices.push(first, second, third);
    }
  };
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const topLeft = at(column, row);
      const topRight = at(column + 1, row);
      const bottomLeft = at(column, row + 1);
      const bottomRight = at(column + 1, row + 1);
      if (row % 2 === column % 2) {
        emit([topLeft, bottomLeft, bottomRight]);
        emit([topLeft, bottomRight, topRight]);
      } else {
        emit([topLeft, bottomLeft, topRight]);
        emit([topRight, bottomLeft, bottomRight]);
      }
    }

  const rawPositions = scalarVertices.map(
    (vertex) => [vertex.x, vertex.groundY, vertex.z] as [number, number, number],
  );
  const rawDepths = scalarVertices.map((vertex) => vertex.rawDepth);
  const rawVolume = reconstructedVolume(rawPositions, rawDepths, indices);
  if (sourceVolume > 0 && rawVolume <= 1e-15)
    throw new Error('puddle contour removed all conserved water volume');
  const correctionFactor = sourceVolume > 0 ? sourceVolume / rawVolume : 1;
  if (
    sourceVolume > 0 &&
    (correctionFactor > options.maximumVolumeCorrectionFactor ||
      correctionFactor < 1 / options.maximumVolumeCorrectionFactor)
  )
    throw new Error(
      `puddle reconstruction volume correction ${correctionFactor} exceeds declared bound`,
    );
  const depthsMeters = rawDepths.map((depth) => depth * correctionFactor);
  const groundHeightsMeters = scalarVertices.map((vertex) => vertex.groundY);
  const positions = scalarVertices.map(
    (vertex, index) =>
      [
        vertex.x,
        vertex.groundY + options.opticalOffsetMeters + depthsMeters[index]!,
        vertex.z,
      ] as [number, number, number],
  );
  const reconstructedVolumeCubicMeters = reconstructedVolume(positions, depthsMeters, indices);
  const volumeErrorCubicMeters = sourceVolume - reconstructedVolumeCubicMeters;
  const boundaryVertices = scalarVertices.filter((vertex) => vertex.rawDepth === 0);
  const nonGridAlignedBoundaryVertexCount = boundaryVertices.filter(
    (vertex) =>
      !gridAligned(vertex.x, worldOriginXZ[0], cellSizeMeters) ||
      !gridAligned(vertex.z, worldOriginXZ[1], cellSizeMeters),
  ).length;
  const withoutHash = {
    schemaVersion: 1 as const,
    id: options.id,
    generator: 'videoer.surface-water-optical-surface.v1' as const,
    sourceFieldId: field.id,
    sourceFieldSha256: field.fieldSha256,
    options: {
      contourDepthMeters: options.contourDepthMeters,
      opticalOffsetMeters: options.opticalOffsetMeters,
      maximumVolumeCorrectionFactor: options.maximumVolumeCorrectionFactor,
    },
    positions,
    groundHeightsMeters,
    depthsMeters,
    indices,
    report: {
      sourceWetCellCount: sourceWetCells.length,
      vertexCount: positions.length,
      triangleCount: indices.length / 3,
      boundaryVertexCount: boundaryVertices.length,
      nonGridAlignedBoundaryVertexCount,
      sourcePuddleVolumeCubicMeters: sourceVolume,
      rawReconstructedVolumeCubicMeters: rawVolume,
      reconstructedVolumeCubicMeters,
      volumeCorrectionFactor: correctionFactor,
      volumeErrorCubicMeters,
      maximumSourcePuddleDepthMeters: Math.max(
        0,
        ...field.cells.map((cell) => cell.puddleDepthMeters),
      ),
      maximumReconstructedDepthMeters: Math.max(0, ...depthsMeters),
    },
  };
  return surfaceWaterOpticalSurfaceSchema.parse({
    ...withoutHash,
    reconstructionSha256: canonicalSha256(withoutHash),
  });
}

export function verifySurfaceWaterOpticalSurface(value: unknown) {
  const surface = surfaceWaterOpticalSurfaceSchema.parse(value);
  const { reconstructionSha256, ...withoutHash } = surface;
  const issues: string[] = [];
  const expectedSha256 = canonicalSha256(withoutHash);
  if (reconstructionSha256 !== expectedSha256)
    issues.push(
      `surface-water optical reconstruction hash mismatch: expected ${expectedSha256}, got ${reconstructionSha256}`,
    );
  if (
    surface.positions.length !== surface.depthsMeters.length ||
    surface.positions.length !== surface.groundHeightsMeters.length
  )
    issues.push('surface-water optical vertex attribute lengths differ');
  if (surface.indices.length % 3 !== 0)
    issues.push('surface-water optical indices do not describe triangles');
  if (surface.indices.some((index) => index >= surface.positions.length))
    issues.push('surface-water optical index is outside the vertex array');
  if (
    surface.report.vertexCount !== surface.positions.length ||
    surface.report.triangleCount !== surface.indices.length / 3
  )
    issues.push('surface-water optical report topology counts differ from the mesh');
  if (
    surface.report.boundaryVertexCount !==
    surface.depthsMeters.filter((depth) => depth === 0).length
  )
    issues.push('surface-water optical boundary count differs from zero-depth vertices');
  for (const [index, position] of surface.positions.entries()) {
    const expectedY =
      surface.groundHeightsMeters[index]! +
      surface.options.opticalOffsetMeters +
      surface.depthsMeters[index]!;
    if (Math.abs(position[1] - expectedY) > 1e-10)
      issues.push(`surface-water optical vertex ${index} violates depth/ground semantics`);
  }
  const volume = reconstructedVolume(surface.positions, surface.depthsMeters, surface.indices);
  for (let offset = 0; offset < surface.indices.length; offset += 3)
    if (projectedTriangleArea(surface.positions, surface.indices, offset) <= 1e-12) {
      issues.push(`surface-water optical triangle ${offset / 3} is degenerate in receiver space`);
      break;
    }
  const tolerance = Math.max(1e-12, surface.report.sourcePuddleVolumeCubicMeters * 1e-9);
  if (
    Math.abs(volume - surface.report.reconstructedVolumeCubicMeters) > tolerance ||
    Math.abs(volume - surface.report.sourcePuddleVolumeCubicMeters) > tolerance
  )
    issues.push('surface-water optical reconstruction does not conserve puddle volume');
  return { valid: issues.length === 0, issues, surface, expectedSha256 };
}
