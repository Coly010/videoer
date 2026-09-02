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

const surfaceWaterOpticalSurfaceOptionsV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  contourDepthMeters: z.number().nonnegative().max(0.02).default(0.000_01),
  opticalOffsetMeters: z.number().nonnegative().max(0.02).default(0.000_2),
  maximumVolumeCorrectionFactor: z.number().min(1).max(100).default(20),
});

export const thinDielectricWaterAppearanceSchema = z.object({
  model: z.literal('thin-dielectric-water-v1'),
  ior: z.number().min(1.3).max(1.36).default(1.333),
  roughness: z.number().min(0.005).max(0.2).default(0.035),
  absorptionColorLinear: z
    .tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])
    .default([0.72, 0.9, 0.95]),
  absorptionDistanceMeters: z.number().min(0.05).max(100).default(4),
});

const surfaceWaterOpticalSurfaceOptionsV2Schema = z.object({
  schemaVersion: z.literal(2),
  id: identifier,
  contourDepthMeters: z.number().nonnegative().max(0.02).default(0.000_01),
  opticalOffsetMeters: z.number().nonnegative().max(0.02).default(0.000_2),
  maximumVolumeCorrectionFactor: z.number().min(1).max(100).default(20),
  subcellDivisions: z.number().int().min(2).max(8).default(4),
  appearance: thinDielectricWaterAppearanceSchema.default({
    model: 'thin-dielectric-water-v1',
    ior: 1.333,
    roughness: 0.035,
    absorptionColorLinear: [0.72, 0.9, 0.95],
    absorptionDistanceMeters: 4,
  }),
});

export const surfaceWaterOpticalSurfaceOptionsSchema = z.discriminatedUnion('schemaVersion', [
  surfaceWaterOpticalSurfaceOptionsV1Schema,
  surfaceWaterOpticalSurfaceOptionsV2Schema,
]);

export type SurfaceWaterOpticalSurfaceOptions = z.input<
  typeof surfaceWaterOpticalSurfaceOptionsSchema
>;

const reconstructionReportV1Schema = z.object({
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

const reconstructionReportV2Schema = reconstructionReportV1Schema.extend({
  boundaryEdgeCount: z.number().int().nonnegative(),
  boundaryPerimeterMeters: z.number().nonnegative(),
  axisAlignedBoundaryLengthRatio: z.number().min(0).max(1),
  maximumAxisAlignedBoundaryRunMeters: z.number().nonnegative(),
  refinedCellSizeMeters: z.number().positive(),
});

const surfaceWaterOpticalSurfaceV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  generator: z.literal('videoer.surface-water-optical-surface.v1'),
  sourceFieldId: identifier,
  sourceFieldSha256: sha256,
  reconstructionSha256: sha256,
  options: surfaceWaterOpticalSurfaceOptionsV1Schema.omit({ schemaVersion: true, id: true }),
  positions: z.array(vec3),
  groundHeightsMeters: z.array(z.number().finite()),
  depthsMeters: z.array(z.number().nonnegative()),
  indices: z.array(z.number().int().nonnegative()),
  report: reconstructionReportV1Schema,
});

const surfaceWaterOpticalSurfaceV2Schema = z.object({
  schemaVersion: z.literal(2),
  id: identifier,
  generator: z.literal('videoer.surface-water-optical-surface.v2'),
  sourceFieldId: identifier,
  sourceFieldSha256: sha256,
  reconstructionSha256: sha256,
  options: surfaceWaterOpticalSurfaceOptionsV2Schema.omit({
    schemaVersion: true,
    id: true,
    appearance: true,
  }),
  appearance: thinDielectricWaterAppearanceSchema,
  positions: z.array(vec3),
  groundHeightsMeters: z.array(z.number().finite()),
  depthsMeters: z.array(z.number().nonnegative()),
  indices: z.array(z.number().int().nonnegative()),
  report: reconstructionReportV2Schema,
});

export const surfaceWaterOpticalSurfaceSchema = z.discriminatedUnion('schemaVersion', [
  surfaceWaterOpticalSurfaceV1Schema,
  surfaceWaterOpticalSurfaceV2Schema,
]);

export type SurfaceWaterOpticalSurface = z.infer<typeof surfaceWaterOpticalSurfaceSchema>;
type SurfaceWaterOpticalSurfaceV1 = z.infer<typeof surfaceWaterOpticalSurfaceV1Schema>;
type SurfaceWaterOpticalSurfaceV2 = z.infer<typeof surfaceWaterOpticalSurfaceV2Schema>;
type SurfaceWaterOpticalSurfaceOptionsV1 = z.input<
  typeof surfaceWaterOpticalSurfaceOptionsV1Schema
>;
type SurfaceWaterOpticalSurfaceOptionsV2 = z.input<
  typeof surfaceWaterOpticalSurfaceOptionsV2Schema
>;

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
      (area *
        (depths[indices[offset]!]! +
          depths[indices[offset + 1]!]! +
          depths[indices[offset + 2]!]!)) /
      3;
  }
  return volume;
}

function edgeVertex(first: ScalarVertex, second: ScalarVertex, contourDepth: number): ScalarVertex {
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
    if (currentInside) output.push({ ...current, rawDepth: current.sourceDepth - contourDepth });
    if (currentInside !== nextInside) output.push(edgeVertex(current, next, contourDepth));
  }
  return output;
}

function gridAligned(value: number, origin: number, cellSize: number) {
  return Math.abs((value - origin) / cellSize - Math.round((value - origin) / cellSize)) < 1e-8;
}

interface BoundaryShapeMetrics {
  boundaryEdgeCount: number;
  boundaryPerimeterMeters: number;
  axisAlignedBoundaryLengthRatio: number;
  maximumAxisAlignedBoundaryRunMeters: number;
}

function boundaryShapeMetrics(
  positions: Array<[number, number, number]>,
  indices: number[],
): BoundaryShapeMetrics {
  const edges = new Map<string, { first: number; second: number; count: number }>();
  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = [indices[offset]!, indices[offset + 1]!, indices[offset + 2]!];
    for (let edge = 0; edge < 3; edge++) {
      const first = triangle[edge]!;
      const second = triangle[(edge + 1) % 3]!;
      const key = first < second ? `${first}:${second}` : `${second}:${first}`;
      const existing = edges.get(key);
      if (existing) existing.count += 1;
      else edges.set(key, { first, second, count: 1 });
    }
  }
  const boundaryEdges = [...edges.values()].filter((edge) => edge.count === 1);
  let perimeter = 0;
  let axisAlignedLength = 0;
  const horizontalIntervals = new Map<string, Array<[number, number]>>();
  const verticalIntervals = new Map<string, Array<[number, number]>>();
  for (const edge of boundaryEdges) {
    const first = positions[edge.first]!;
    const second = positions[edge.second]!;
    const dx = second[0] - first[0];
    const dz = second[2] - first[2];
    const length = Math.hypot(dx, dz);
    perimeter += length;
    if (Math.abs(dz) <= 1e-9) {
      axisAlignedLength += length;
      const key = ((first[2] + second[2]) * 0.5).toFixed(9);
      const intervals = horizontalIntervals.get(key) ?? [];
      intervals.push([Math.min(first[0], second[0]), Math.max(first[0], second[0])]);
      horizontalIntervals.set(key, intervals);
    } else if (Math.abs(dx) <= 1e-9) {
      axisAlignedLength += length;
      const key = ((first[0] + second[0]) * 0.5).toFixed(9);
      const intervals = verticalIntervals.get(key) ?? [];
      intervals.push([Math.min(first[2], second[2]), Math.max(first[2], second[2])]);
      verticalIntervals.set(key, intervals);
    }
  }
  let maximumRun = 0;
  for (const intervals of [...horizontalIntervals.values(), ...verticalIntervals.values()]) {
    intervals.sort((left, right) => left[0] - right[0]);
    let start = intervals[0]?.[0] ?? 0;
    let end = intervals[0]?.[1] ?? 0;
    for (const interval of intervals.slice(1)) {
      if (interval[0] <= end + 1e-9) end = Math.max(end, interval[1]);
      else {
        maximumRun = Math.max(maximumRun, end - start);
        [start, end] = interval;
      }
    }
    maximumRun = Math.max(maximumRun, end - start);
  }
  return {
    boundaryEdgeCount: boundaryEdges.length,
    boundaryPerimeterMeters: perimeter,
    axisAlignedBoundaryLengthRatio: perimeter > 0 ? axisAlignedLength / perimeter : 0,
    maximumAxisAlignedBoundaryRunMeters: maximumRun,
  };
}

export function reconstructSurfaceWaterOpticalSurface(
  fieldValue: SurfaceWaterField,
  optionsValue: SurfaceWaterOpticalSurfaceOptionsV1,
): SurfaceWaterOpticalSurfaceV1;
export function reconstructSurfaceWaterOpticalSurface(
  fieldValue: SurfaceWaterField,
  optionsValue: SurfaceWaterOpticalSurfaceOptionsV2,
): SurfaceWaterOpticalSurfaceV2;
export function reconstructSurfaceWaterOpticalSurface(
  fieldValue: SurfaceWaterField,
  optionsValue: SurfaceWaterOpticalSurfaceOptions,
): SurfaceWaterOpticalSurface;
export function reconstructSurfaceWaterOpticalSurface(
  fieldValue: SurfaceWaterField,
  optionsValue: SurfaceWaterOpticalSurfaceOptions,
): SurfaceWaterOpticalSurface {
  const field = surfaceWaterFieldSchema.parse(fieldValue);
  const fieldVerification = verifyStaticSurfaceWaterField(field);
  if (!fieldVerification.valid)
    throw new Error(
      `cannot reconstruct invalid surface-water field: ${fieldVerification.issues.join('; ')}`,
    );
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
  const subcellDivisions = options.schemaVersion === 2 ? options.subcellDivisions : 1;
  const refinedLattice = new Map<string, ScalarVertex>();
  const refinedAt = (refinedColumn: number, refinedRow: number) => {
    if (subcellDivisions === 1) return at(refinedColumn, refinedRow);
    const key = `${refinedColumn}:${refinedRow}`;
    const existing = refinedLattice.get(key);
    if (existing) return existing;
    const gridColumn = refinedColumn / subcellDivisions;
    const gridRow = refinedRow / subcellDivisions;
    const column = Math.min(columns - 1, Math.floor(gridColumn));
    const row = Math.min(rows - 1, Math.floor(gridRow));
    const amountX = gridColumn - column;
    const amountZ = gridRow - row;
    const topLeft = at(column, row);
    const topRight = at(column + 1, row);
    const bottomLeft = at(column, row + 1);
    const bottomRight = at(column + 1, row + 1);
    const bilinear = (property: 'groundY' | 'sourceDepth') =>
      topLeft[property] * (1 - amountX) * (1 - amountZ) +
      topRight[property] * amountX * (1 - amountZ) +
      bottomLeft[property] * (1 - amountX) * amountZ +
      bottomRight[property] * amountX * amountZ;
    const sourceDepth = bilinear('sourceDepth');
    const vertex: ScalarVertex = {
      key: `refined:${key}`,
      x: worldOriginXZ[0] + gridColumn * cellSizeMeters,
      z: worldOriginXZ[1] + gridRow * cellSizeMeters,
      groundY: bilinear('groundY'),
      sourceDepth,
      rawDepth: Math.max(0, sourceDepth - options.contourDepthMeters),
    };
    refinedLattice.set(key, vertex);
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
  for (let row = 0; row < rows * subcellDivisions; row++)
    for (let column = 0; column < columns * subcellDivisions; column++) {
      const topLeft = refinedAt(column, row);
      const topRight = refinedAt(column + 1, row);
      const bottomLeft = refinedAt(column, row + 1);
      const bottomRight = refinedAt(column + 1, row + 1);
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
      [vertex.x, vertex.groundY + options.opticalOffsetMeters + depthsMeters[index]!, vertex.z] as [
        number,
        number,
        number,
      ],
  );
  const reconstructedVolumeCubicMeters = reconstructedVolume(positions, depthsMeters, indices);
  const volumeErrorCubicMeters = sourceVolume - reconstructedVolumeCubicMeters;
  const boundaryVertices = scalarVertices.filter((vertex) => vertex.rawDepth === 0);
  const nonGridAlignedBoundaryVertexCount = boundaryVertices.filter(
    (vertex) =>
      !gridAligned(vertex.x, worldOriginXZ[0], cellSizeMeters) ||
      !gridAligned(vertex.z, worldOriginXZ[1], cellSizeMeters),
  ).length;
  const commonReport = {
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
  };
  const withoutHash =
    options.schemaVersion === 1
      ? {
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
          report: commonReport,
        }
      : {
          schemaVersion: 2 as const,
          id: options.id,
          generator: 'videoer.surface-water-optical-surface.v2' as const,
          sourceFieldId: field.id,
          sourceFieldSha256: field.fieldSha256,
          options: {
            contourDepthMeters: options.contourDepthMeters,
            opticalOffsetMeters: options.opticalOffsetMeters,
            maximumVolumeCorrectionFactor: options.maximumVolumeCorrectionFactor,
            subcellDivisions: options.subcellDivisions,
          },
          appearance: options.appearance,
          positions,
          groundHeightsMeters,
          depthsMeters,
          indices,
          report: {
            ...commonReport,
            ...boundaryShapeMetrics(positions, indices),
            refinedCellSizeMeters: cellSizeMeters / options.subcellDivisions,
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
  if (surface.schemaVersion === 2) {
    const measured = boundaryShapeMetrics(surface.positions, surface.indices);
    const tolerance = 1e-9;
    if (surface.report.boundaryEdgeCount !== measured.boundaryEdgeCount)
      issues.push('surface-water optical boundary edge count differs from the mesh');
    if (
      Math.abs(surface.report.boundaryPerimeterMeters - measured.boundaryPerimeterMeters) >
      tolerance
    )
      issues.push('surface-water optical boundary perimeter differs from the mesh');
    if (
      Math.abs(
        surface.report.axisAlignedBoundaryLengthRatio - measured.axisAlignedBoundaryLengthRatio,
      ) > tolerance
    )
      issues.push('surface-water optical axis-aligned boundary ratio differs from the mesh');
    if (
      Math.abs(
        surface.report.maximumAxisAlignedBoundaryRunMeters -
          measured.maximumAxisAlignedBoundaryRunMeters,
      ) > tolerance
    )
      issues.push('surface-water optical maximum axis-aligned boundary run differs from the mesh');
    if (surface.report.refinedCellSizeMeters <= 0)
      issues.push('surface-water optical refined cell size is not positive');
  }
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
  if (
    surface.report.volumeCorrectionFactor > surface.options.maximumVolumeCorrectionFactor ||
    surface.report.volumeCorrectionFactor < 1 / surface.options.maximumVolumeCorrectionFactor
  )
    issues.push(
      'surface-water optical reconstruction exceeds its declared volume-correction bound',
    );
  return { valid: issues.length === 0, issues, surface, expectedSha256 };
}
