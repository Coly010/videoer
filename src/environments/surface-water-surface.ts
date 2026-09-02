import { z } from 'zod';
import { canonicalSha256 } from '../assets/sources/cache.js';
import {
  surfaceWaterFieldSchema,
  surfaceWaterFieldV2Schema,
  verifyStaticSurfaceWaterField,
  verifyStaticSurfaceWaterFieldV2,
  type SurfaceWaterField,
  type SurfaceWaterFieldV2,
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

const surfaceWaterOpticalSurfaceOptionsV3Schema = z.object({
  schemaVersion: z.literal(3),
  id: identifier,
  opticalOffsetMeters: z.number().nonnegative().max(0.02).default(0.000_2),
  maximumVolumeCorrectionFactor: z.number().min(1).max(100).default(20),
  subcellDivisions: z.number().int().min(4).max(16).default(8),
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
  surfaceWaterOpticalSurfaceOptionsV3Schema,
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

const reconstructionReportV3Schema = reconstructionReportV2Schema.extend({
  sourceSupportAreaSquareMeters: z.number().nonnegative(),
  projectedAreaSquareMeters: z.number().nonnegative(),
  projectedAreaErrorSquareMeters: z.number(),
  projectedAreaRatio: z.number().nonnegative(),
  sourceMeanPuddleDepthMeters: z.number().nonnegative(),
  supportContourThreshold: z.number().nonnegative(),
  receiverContourThreshold: z.number().positive(),
  depthCorrectionFactor: z.number().positive(),
  maximumAllowedReconstructedDepthMeters: z.number().nonnegative(),
  receiverCoverageModel: z.literal('legacy-full-wet-cell-kernel-mask-v1'),
  receiverEscapeAreaSquareMeters: z.literal(0),
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

const surfaceWaterOpticalSurfaceV3Schema = z.object({
  schemaVersion: z.literal(3),
  id: identifier,
  generator: z.literal('videoer.surface-water-optical-surface.v3'),
  supportModel: z.literal('wendland-c2-area-calibrated-v1'),
  sourceFieldId: identifier,
  sourceFieldSha256: sha256,
  reconstructionSha256: sha256,
  options: surfaceWaterOpticalSurfaceOptionsV3Schema.omit({
    schemaVersion: true,
    id: true,
    appearance: true,
  }),
  appearance: thinDielectricWaterAppearanceSchema,
  positions: z.array(vec3),
  groundHeightsMeters: z.array(z.number().finite()),
  depthsMeters: z.array(z.number().nonnegative()),
  indices: z.array(z.number().int().nonnegative()),
  report: reconstructionReportV3Schema,
});

export const surfaceWaterOpticalSurfaceSchema = z.discriminatedUnion('schemaVersion', [
  surfaceWaterOpticalSurfaceV1Schema,
  surfaceWaterOpticalSurfaceV2Schema,
  surfaceWaterOpticalSurfaceV3Schema,
]);

export type SurfaceWaterOpticalSurface = z.infer<typeof surfaceWaterOpticalSurfaceSchema>;
type SurfaceWaterOpticalSurfaceV1 = z.infer<typeof surfaceWaterOpticalSurfaceV1Schema>;
type SurfaceWaterOpticalSurfaceV2 = z.infer<typeof surfaceWaterOpticalSurfaceV2Schema>;
type SurfaceWaterOpticalSurfaceV3 = z.infer<typeof surfaceWaterOpticalSurfaceV3Schema>;
type SurfaceWaterOpticalSurfaceOptionsV1 = z.input<
  typeof surfaceWaterOpticalSurfaceOptionsV1Schema
>;
type SurfaceWaterOpticalSurfaceOptionsV2 = z.input<
  typeof surfaceWaterOpticalSurfaceOptionsV2Schema
>;
type SurfaceWaterOpticalSurfaceOptionsV3 = z.input<
  typeof surfaceWaterOpticalSurfaceOptionsV3Schema
>;
type OpticalSourceWaterField = SurfaceWaterField | SurfaceWaterFieldV2;

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

interface SupportVertex {
  key: string;
  x: number;
  z: number;
  groundY: number;
  support: number;
  moment: number;
  receiverSupport: number;
  boundary: boolean;
}

const V3_KERNEL_RADIUS_CELLS = 1.5;
const V3_AREA_RELATIVE_TOLERANCE = 1e-4;
const V3_AREA_ABSOLUTE_TOLERANCE = 1e-8;

function wendlandC2(distanceInRadius: number) {
  if (distanceInRadius >= 1) return 0;
  const remaining = 1 - distanceInRadius;
  return remaining ** 4 * (4 * distanceInRadius + 1);
}

function interpolateSupportVertex(
  first: SupportVertex,
  second: SupportVertex,
  amount: number,
  prefix: string,
): SupportVertex {
  const [left, right] = first.key < second.key ? [first.key, second.key] : [second.key, first.key];
  const interpolate = (a: number, b: number) => a + (b - a) * amount;
  return {
    key: `${prefix}:${left}:${right}`,
    x: interpolate(first.x, second.x),
    z: interpolate(first.z, second.z),
    groundY: interpolate(first.groundY, second.groundY),
    support: interpolate(first.support, second.support),
    moment: interpolate(first.moment, second.moment),
    receiverSupport: interpolate(first.receiverSupport, second.receiverSupport),
    boundary: true,
  };
}

function clipSupportPolygon(
  vertices: SupportVertex[],
  property: 'support' | 'receiverSupport',
  threshold: number,
  prefix: string,
) {
  const output: SupportVertex[] = [];
  for (let index = 0; index < vertices.length; index++) {
    const current = vertices[index]!;
    const next = vertices[(index + 1) % vertices.length]!;
    const currentInside = current[property] > threshold;
    const nextInside = next[property] > threshold;
    if (currentInside) output.push(current);
    if (currentInside !== nextInside) {
      const denominator = next[property] - current[property];
      const amount = denominator === 0 ? 0.5 : (threshold - current[property]) / denominator;
      output.push(interpolateSupportVertex(current, next, amount, prefix));
    }
  }
  return output;
}

function polygonProjectedArea(vertices: SupportVertex[]) {
  if (vertices.length < 3) return 0;
  let twiceArea = 0;
  for (let index = 0; index < vertices.length; index++) {
    const current = vertices[index]!;
    const next = vertices[(index + 1) % vertices.length]!;
    twiceArea += current.x * next.z - next.x * current.z;
  }
  return Math.abs(twiceArea) * 0.5;
}

function solveAreaContour(
  targetArea: number,
  maximumScalar: number,
  measureArea: (threshold: number) => number,
  label: string,
) {
  const maximumArea = measureArea(0);
  const tolerance = Math.max(V3_AREA_ABSOLUTE_TOLERANCE, targetArea * V3_AREA_RELATIVE_TOLERANCE);
  if (maximumArea + tolerance < targetArea)
    throw new Error(`${label} support cannot represent its declared source area`);
  let lower = 0;
  let upper = maximumScalar;
  for (let iteration = 0; iteration < 64; iteration++) {
    const midpoint = (lower + upper) * 0.5;
    if (measureArea(midpoint) > targetArea) lower = midpoint;
    else upper = midpoint;
  }
  const threshold = (lower + upper) * 0.5;
  const area = measureArea(threshold);
  if (Math.abs(area - targetArea) > tolerance)
    throw new Error(`${label} support area solve exceeds tolerance`);
  return { threshold, area };
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

function meshBoundaryVertexIndices(indices: number[]) {
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
  return new Set(
    [...edges.values()]
      .filter((edge) => edge.count === 1)
      .flatMap((edge) => [edge.first, edge.second]),
  );
}

function reconstructSurfaceWaterOpticalSurfaceV3(
  field: OpticalSourceWaterField,
  options: z.infer<typeof surfaceWaterOpticalSurfaceOptionsV3Schema>,
): SurfaceWaterOpticalSurfaceV3 {
  const { columns, rows, cellSizeMeters, worldOriginXZ } = field.grid;
  const wetCells = field.cells.filter((cell) => cell.puddleDepthMeters > 0);
  const partialWetCell = wetCells.find((cell) => Math.abs(cell.coverage - 1) > 1e-12);
  if (partialWetCell)
    throw new Error(
      `surface-water optical v3 cannot locate partial wet-cell coverage at cell ${partialWetCell.index}; a persisted subcell receiver mask is required`,
    );
  const cellArea = cellSizeMeters * cellSizeMeters;
  const sourceSupportArea = wetCells.reduce((sum, cell) => sum + cell.coverage * cellArea, 0);
  const receiverSupportArea = field.cells.reduce((sum, cell) => sum + cell.coverage * cellArea, 0);
  const sourceVolume = field.massBalance.puddleCubicMeters;
  const maximumSourceDepth = Math.max(0, ...wetCells.map((cell) => cell.puddleDepthMeters));
  const cellByIndex = new Map(field.cells.map((cell) => [cell.index, cell]));
  const divisions = options.subcellDivisions;
  const margin = Math.ceil(V3_KERNEL_RADIUS_CELLS * divisions);
  const minimumRefinedColumn = -margin;
  const maximumRefinedColumn = (columns - 1) * divisions + margin;
  const minimumRefinedRow = -margin;
  const maximumRefinedRow = (rows - 1) * divisions + margin;
  const samples = new Map<string, SupportVertex>();
  let maximumSupport = 0;
  let maximumReceiverSupport = 0;
  const sampleAt = (refinedColumn: number, refinedRow: number) => {
    const key = `${refinedColumn}:${refinedRow}`;
    const existing = samples.get(key);
    if (existing) return existing;
    const gridColumn = refinedColumn / divisions;
    const gridRow = refinedRow / divisions;
    let support = 0;
    let moment = 0;
    let receiverSupport = 0;
    let groundMoment = 0;
    for (
      let row = Math.floor(gridRow - V3_KERNEL_RADIUS_CELLS);
      row <= Math.ceil(gridRow + V3_KERNEL_RADIUS_CELLS);
      row++
    )
      for (
        let column = Math.floor(gridColumn - V3_KERNEL_RADIUS_CELLS);
        column <= Math.ceil(gridColumn + V3_KERNEL_RADIUS_CELLS);
        column++
      ) {
        if (column < 0 || column >= columns || row < 0 || row >= rows) continue;
        const cell = cellByIndex.get(row * columns + column);
        if (!cell) continue;
        const distance = Math.hypot(gridColumn - column, gridRow - row);
        const kernel = wendlandC2(distance / V3_KERNEL_RADIUS_CELLS);
        if (kernel <= 0) continue;
        const receiverWeight = kernel * cell.coverage;
        receiverSupport += receiverWeight;
        groundMoment += receiverWeight * cell.worldPosition[1];
        if (cell.puddleDepthMeters > 0) {
          support += receiverWeight;
          moment += receiverWeight * cell.puddleDepthMeters;
        }
      }
    const vertex: SupportVertex = {
      key: `sample:${key}`,
      x: worldOriginXZ[0] + (gridColumn + 0.5) * cellSizeMeters,
      z: worldOriginXZ[1] + (gridRow + 0.5) * cellSizeMeters,
      groundY: receiverSupport > 0 ? groundMoment / receiverSupport : 0,
      support,
      moment,
      receiverSupport,
      boundary: false,
    };
    maximumSupport = Math.max(maximumSupport, support);
    maximumReceiverSupport = Math.max(maximumReceiverSupport, receiverSupport);
    samples.set(key, vertex);
    return vertex;
  };

  const triangles: SupportVertex[][] = [];
  for (let row = minimumRefinedRow; row < maximumRefinedRow; row++)
    for (let column = minimumRefinedColumn; column < maximumRefinedColumn; column++) {
      const topLeft = sampleAt(column, row);
      const topRight = sampleAt(column + 1, row);
      const bottomLeft = sampleAt(column, row + 1);
      const bottomRight = sampleAt(column + 1, row + 1);
      if (((row + column) & 1) === 0) {
        triangles.push([topLeft, bottomLeft, bottomRight], [topLeft, bottomRight, topRight]);
      } else {
        triangles.push([topLeft, bottomLeft, topRight], [topRight, bottomLeft, bottomRight]);
      }
    }

  const receiverAreaAt = (threshold: number) =>
    triangles.reduce(
      (sum, triangle) =>
        sum +
        polygonProjectedArea(
          clipSupportPolygon(triangle, 'receiverSupport', threshold, 'receiver-edge'),
        ),
      0,
    );
  const receiverContour = solveAreaContour(
    receiverSupportArea,
    maximumReceiverSupport,
    receiverAreaAt,
    'receiver',
  );
  const clipReceiver = (triangle: SupportVertex[]) =>
    clipSupportPolygon(triangle, 'receiverSupport', receiverContour.threshold, 'receiver-edge');
  const wetAreaAt = (threshold: number) =>
    triangles.reduce(
      (sum, triangle) =>
        sum +
        polygonProjectedArea(
          clipSupportPolygon(clipReceiver(triangle), 'support', threshold, 'support-edge'),
        ),
      0,
    );
  const wetContour =
    sourceSupportArea > 0
      ? solveAreaContour(sourceSupportArea, maximumSupport, wetAreaAt, 'puddle')
      : { threshold: 0, area: 0 };

  const vertexByKey = new Map<string, number>();
  const vertices: SupportVertex[] = [];
  const indices: number[] = [];
  const vertexIndex = (vertex: SupportVertex) => {
    const coordinateKey = `${vertex.x.toFixed(9)}:${vertex.z.toFixed(9)}`;
    const existing = vertexByKey.get(coordinateKey);
    if (existing !== undefined) return existing;
    const index = vertices.length;
    vertices.push(vertex);
    vertexByKey.set(coordinateKey, index);
    return index;
  };
  if (sourceSupportArea > 0)
    for (const triangle of triangles) {
      const polygon = clipSupportPolygon(
        clipReceiver(triangle),
        'support',
        wetContour.threshold,
        'support-edge',
      );
      if (polygon.length < 3) continue;
      const first = vertexIndex(polygon[0]!);
      for (let index = 1; index < polygon.length - 1; index++) {
        const second = vertexIndex(polygon[index]!);
        const third = vertexIndex(polygon[index + 1]!);
        const a = vertices[first]!;
        const b = vertices[second]!;
        const c = vertices[third]!;
        const signedTwiceArea = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
        if (Math.abs(signedTwiceArea) <= 1e-12) continue;
        if (signedTwiceArea < 0) indices.push(first, second, third);
        else indices.push(first, third, second);
      }
    }

  const groundHeightsMeters = vertices.map((vertex) => vertex.groundY);
  const planarPositions = vertices.map(
    (vertex) => [vertex.x, vertex.groundY, vertex.z] as [number, number, number],
  );
  const rawDepths = vertices.map((vertex) =>
    vertex.support > 0 ? vertex.moment / vertex.support : 0,
  );
  const rawVolume = reconstructedVolume(planarPositions, rawDepths, indices);
  const correctedVolume = (factor: number) =>
    reconstructedVolume(
      planarPositions,
      rawDepths.map((depth) => Math.min(maximumSourceDepth, depth * factor)),
      indices,
    );
  const volumeTolerance = Math.max(1e-12, sourceVolume * 1e-9);
  let correctionFactor = 1;
  if (sourceVolume > 0) {
    let lower = 0;
    let upper = 1;
    while (
      correctedVolume(upper) < sourceVolume - volumeTolerance &&
      upper < options.maximumVolumeCorrectionFactor
    )
      upper = Math.min(options.maximumVolumeCorrectionFactor, upper * 2);
    if (correctedVolume(upper) < sourceVolume - volumeTolerance)
      throw new Error(
        'surface-water optical v3 cannot conserve volume without exceeding the maximum source depth',
      );
    for (let iteration = 0; iteration < 64; iteration++) {
      const midpoint = (lower + upper) * 0.5;
      if (correctedVolume(midpoint) < sourceVolume) lower = midpoint;
      else upper = midpoint;
    }
    correctionFactor = (lower + upper) * 0.5;
    if (
      correctionFactor > options.maximumVolumeCorrectionFactor ||
      correctionFactor < 1 / options.maximumVolumeCorrectionFactor
    )
      throw new Error(
        `puddle reconstruction volume correction ${correctionFactor} exceeds declared bound`,
      );
  }
  const depthsMeters = rawDepths.map((depth) =>
    Math.min(maximumSourceDepth, depth * correctionFactor),
  );
  const positions = vertices.map(
    (vertex, index) =>
      [vertex.x, vertex.groundY + options.opticalOffsetMeters + depthsMeters[index]!, vertex.z] as [
        number,
        number,
        number,
      ],
  );
  const reconstructedVolumeCubicMeters = reconstructedVolume(positions, depthsMeters, indices);
  if (Math.abs(sourceVolume - reconstructedVolumeCubicMeters) > volumeTolerance)
    throw new Error('surface-water optical v3 volume solve exceeds tolerance');
  const projectedArea = indices.reduce(
    (sum, _index, offset) =>
      offset % 3 === 0 ? sum + projectedTriangleArea(positions, indices, offset) : sum,
    0,
  );
  const areaTolerance = Math.max(
    V3_AREA_ABSOLUTE_TOLERANCE,
    sourceSupportArea * V3_AREA_RELATIVE_TOLERANCE,
  );
  if (Math.abs(projectedArea - sourceSupportArea) > areaTolerance)
    throw new Error('surface-water optical v3 projected area exceeds source-support tolerance');
  const boundaryVertexIndices = meshBoundaryVertexIndices(indices);
  const commonReport = {
    sourceWetCellCount: wetCells.length,
    vertexCount: positions.length,
    triangleCount: indices.length / 3,
    boundaryVertexCount: boundaryVertexIndices.size,
    nonGridAlignedBoundaryVertexCount: [...boundaryVertexIndices].filter((index) => {
      const vertex = vertices[index]!;
      return (
        !gridAligned(vertex.x, worldOriginXZ[0], cellSizeMeters) ||
        !gridAligned(vertex.z, worldOriginXZ[1], cellSizeMeters)
      );
    }).length,
    sourcePuddleVolumeCubicMeters: sourceVolume,
    rawReconstructedVolumeCubicMeters: rawVolume,
    reconstructedVolumeCubicMeters,
    volumeCorrectionFactor: correctionFactor,
    volumeErrorCubicMeters: sourceVolume - reconstructedVolumeCubicMeters,
    maximumSourcePuddleDepthMeters: maximumSourceDepth,
    maximumReconstructedDepthMeters: Math.max(0, ...depthsMeters),
    ...boundaryShapeMetrics(positions, indices),
    refinedCellSizeMeters: cellSizeMeters / divisions,
    sourceSupportAreaSquareMeters: sourceSupportArea,
    projectedAreaSquareMeters: projectedArea,
    projectedAreaErrorSquareMeters: projectedArea - sourceSupportArea,
    projectedAreaRatio: sourceSupportArea > 0 ? projectedArea / sourceSupportArea : 0,
    sourceMeanPuddleDepthMeters: sourceSupportArea > 0 ? sourceVolume / sourceSupportArea : 0,
    supportContourThreshold: wetContour.threshold,
    receiverContourThreshold: receiverContour.threshold,
    depthCorrectionFactor: correctionFactor,
    maximumAllowedReconstructedDepthMeters: maximumSourceDepth,
    receiverCoverageModel: 'legacy-full-wet-cell-kernel-mask-v1' as const,
    receiverEscapeAreaSquareMeters: 0 as const,
  };
  const withoutHash = {
    schemaVersion: 3 as const,
    id: options.id,
    generator: 'videoer.surface-water-optical-surface.v3' as const,
    supportModel: 'wendland-c2-area-calibrated-v1' as const,
    sourceFieldId: field.id,
    sourceFieldSha256: field.fieldSha256,
    options: {
      opticalOffsetMeters: options.opticalOffsetMeters,
      maximumVolumeCorrectionFactor: options.maximumVolumeCorrectionFactor,
      subcellDivisions: options.subcellDivisions,
    },
    appearance: options.appearance,
    positions,
    groundHeightsMeters,
    depthsMeters,
    indices,
    report: commonReport,
  };
  return surfaceWaterOpticalSurfaceV3Schema.parse({
    ...withoutHash,
    reconstructionSha256: canonicalSha256(withoutHash),
  });
}

export function reconstructSurfaceWaterOpticalSurface(
  fieldValue: OpticalSourceWaterField,
  optionsValue: SurfaceWaterOpticalSurfaceOptionsV1,
): SurfaceWaterOpticalSurfaceV1;
export function reconstructSurfaceWaterOpticalSurface(
  fieldValue: OpticalSourceWaterField,
  optionsValue: SurfaceWaterOpticalSurfaceOptionsV2,
): SurfaceWaterOpticalSurfaceV2;
export function reconstructSurfaceWaterOpticalSurface(
  fieldValue: OpticalSourceWaterField,
  optionsValue: SurfaceWaterOpticalSurfaceOptionsV3,
): SurfaceWaterOpticalSurfaceV3;
export function reconstructSurfaceWaterOpticalSurface(
  fieldValue: OpticalSourceWaterField,
  optionsValue: SurfaceWaterOpticalSurfaceOptions,
): SurfaceWaterOpticalSurface;
export function reconstructSurfaceWaterOpticalSurface(
  fieldValue: OpticalSourceWaterField,
  optionsValue: SurfaceWaterOpticalSurfaceOptions,
): SurfaceWaterOpticalSurface {
  const field =
    fieldValue.schemaVersion === 2
      ? surfaceWaterFieldV2Schema.parse(fieldValue)
      : surfaceWaterFieldSchema.parse(fieldValue);
  const fieldVerification =
    field.schemaVersion === 2
      ? verifyStaticSurfaceWaterFieldV2(field)
      : verifyStaticSurfaceWaterField(field);
  if (!fieldVerification.valid)
    throw new Error(
      `cannot reconstruct invalid surface-water field: ${fieldVerification.issues.join('; ')}`,
    );
  const options = surfaceWaterOpticalSurfaceOptionsSchema.parse(optionsValue);
  if (options.schemaVersion === 3) return reconstructSurfaceWaterOpticalSurfaceV3(field, options);
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
      .filter((cell): cell is OpticalSourceWaterField['cells'][number] => Boolean(cell));
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
  const measuredBoundaryVertexCount =
    surface.schemaVersion === 3
      ? meshBoundaryVertexIndices(surface.indices).size
      : surface.depthsMeters.filter((depth) => depth === 0).length;
  if (surface.report.boundaryVertexCount !== measuredBoundaryVertexCount)
    issues.push('surface-water optical boundary count differs from the mesh');
  if (surface.schemaVersion === 2 || surface.schemaVersion === 3) {
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
  const projectedArea = surface.indices.reduce(
    (sum, _index, offset) =>
      offset % 3 === 0
        ? sum + projectedTriangleArea(surface.positions, surface.indices, offset)
        : sum,
    0,
  );
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
  if (surface.schemaVersion === 3) {
    const areaTolerance = Math.max(
      V3_AREA_ABSOLUTE_TOLERANCE,
      surface.report.sourceSupportAreaSquareMeters * V3_AREA_RELATIVE_TOLERANCE,
    );
    if (
      Math.abs(projectedArea - surface.report.projectedAreaSquareMeters) > areaTolerance ||
      Math.abs(projectedArea - surface.report.sourceSupportAreaSquareMeters) > areaTolerance ||
      Math.abs(
        surface.report.projectedAreaErrorSquareMeters -
          (projectedArea - surface.report.sourceSupportAreaSquareMeters),
      ) > areaTolerance
    )
      issues.push('surface-water optical projected area differs from source wet support');
    const expectedAreaRatio =
      surface.report.sourceSupportAreaSquareMeters > 0
        ? projectedArea / surface.report.sourceSupportAreaSquareMeters
        : 0;
    if (Math.abs(surface.report.projectedAreaRatio - expectedAreaRatio) > 1e-9)
      issues.push('surface-water optical projected area ratio differs from the mesh');
    const expectedMeanDepth =
      surface.report.sourceSupportAreaSquareMeters > 0
        ? surface.report.sourcePuddleVolumeCubicMeters /
          surface.report.sourceSupportAreaSquareMeters
        : 0;
    if (Math.abs(surface.report.sourceMeanPuddleDepthMeters - expectedMeanDepth) > 1e-12)
      issues.push('surface-water optical source mean depth is inconsistent');
    if (
      surface.report.maximumAllowedReconstructedDepthMeters !==
        surface.report.maximumSourcePuddleDepthMeters ||
      surface.report.maximumReconstructedDepthMeters >
        surface.report.maximumAllowedReconstructedDepthMeters + 1e-12 ||
      Math.max(0, ...surface.depthsMeters) >
        surface.report.maximumAllowedReconstructedDepthMeters + 1e-12
    )
      issues.push('surface-water optical reconstruction exceeds the source maximum depth');
    if (
      Math.abs(surface.report.depthCorrectionFactor - surface.report.volumeCorrectionFactor) > 1e-12
    )
      issues.push('surface-water optical depth correction differs from volume correction');
    if (surface.report.receiverEscapeAreaSquareMeters !== 0)
      issues.push('surface-water optical reconstruction escapes receiver support');
  }
  return { valid: issues.length === 0, issues, surface, expectedSha256 };
}
