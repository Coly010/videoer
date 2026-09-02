import { z } from 'zod';
import { canonicalSha256 } from '../assets/sources/cache.js';
import { geometryAssetSchema, type GeometryAsset, type Vec3 } from '../geometry/model.js';
import { sceneTransformSchema, type SceneTransform } from '../interactions/model.js';

const identifier = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/);
const localIdentifier = z.string().regex(/^[a-z][a-z0-9-]*$/);
const vec2 = z.tuple([z.number().finite(), z.number().finite()]);
const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const surfaceWaterMaterialResponseSchema = z.object({
  targetClass: z.enum(['modeled-unit', 'joint', 'substrate', 'border']),
  absorption: z.object({
    capacityMeters: z.number().nonnegative().max(0.2),
    rateMetersPerSecond: z.number().nonnegative().max(0.01),
    initialSaturation: z.number().min(0).max(1),
  }),
  retention: z.object({
    filmCapacityMeters: z.number().nonnegative().max(0.02),
    edgeCapacityMeters: z.number().nonnegative().max(0.05),
    maximumPuddleDepthMeters: z.number().nonnegative().max(0.25),
  }),
  wetRoughness: z.object({
    dry: z.number().min(0).max(1),
    multiplier: z.number().min(0).max(1),
    floor: z.number().min(0).max(1),
  }),
  splash: z.object({
    minimumFreeWaterDepthMeters: z.number().nonnegative().max(0.02),
    maximumSlopeDegrees: z.number().min(0).max(90),
  }),
});

export const surfaceWaterFieldInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifier,
    receiver: z.object({
      geometry: geometryAssetSchema,
      geometrySha256: sha256,
      transform: sceneTransformSchema,
    }),
    drainage: z.object({
      localDirection: vec2,
      gradientMetersPerMeter: z.number().positive().max(0.5),
      outlets: z
        .array(
          z.object({
            id: localIdentifier,
            worldPosition: vec3,
            radiusMeters: z.number().positive().max(5),
          }),
        )
        .default([]),
    }),
    precipitation: z.object({
      intensityMillimetersPerHour: z.number().nonnegative().max(1_000),
      durationSeconds: z.number().nonnegative().max(604_800),
      windMetersPerSecond: vec2,
      impactSpeedMetersPerSecond: z.number().positive().max(100),
      dropDiameterMillimeters: z.number().positive().max(20),
    }),
    materialResponses: z.record(localIdentifier, surfaceWaterMaterialResponseSchema),
    shelters: z
      .array(
        z.object({
          id: localIdentifier,
          geometry: geometryAssetSchema,
          geometrySha256: sha256,
          transform: sceneTransformSchema,
        }),
      )
      .default([]),
    grid: z.object({
      cellSizeMeters: z.number().positive().max(2),
      supersample: z.union([z.literal(1), z.literal(4), z.literal(9)]).default(4),
      shelterRayMaximumMeters: z.number().positive().max(1_000).default(100),
    }),
    solver: z
      .object({
        edgeHeightThresholdMeters: z.number().nonnegative().max(0.25).default(0.003),
        maximumCellCount: z.number().int().positive().max(1_000_000).default(250_000),
      })
      .default({ edgeHeightThresholdMeters: 0.003, maximumCellCount: 250_000 }),
  })
  .superRefine((input, context) => {
    if (Math.hypot(...input.drainage.localDirection) < 1e-9)
      context.addIssue({
        code: 'custom',
        path: ['drainage', 'localDirection'],
        message: 'drainage direction must be non-zero',
      });
    if (input.receiver.transform.scale.some((value) => Math.abs(value) < 1e-9))
      context.addIssue({
        code: 'custom',
        path: ['receiver', 'transform', 'scale'],
        message: 'surface-water receiver scale must be non-zero',
      });
    const shelterIds = input.shelters.map((shelter) => shelter.id);
    if (new Set(shelterIds).size !== shelterIds.length)
      context.addIssue({
        code: 'custom',
        path: ['shelters'],
        message: 'shelter ids must be unique',
      });
  });

export type SurfaceWaterFieldInput = z.input<typeof surfaceWaterFieldInputSchema>;
type ParsedInput = z.infer<typeof surfaceWaterFieldInputSchema>;
type MaterialResponse = z.infer<typeof surfaceWaterMaterialResponseSchema>;

const surfaceWaterCellSchema = z.object({
  index: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  row: z.number().int().nonnegative(),
  worldPosition: vec3,
  normal: vec3,
  triangleIndex: z.number().int().nonnegative(),
  materialId: localIdentifier,
  targetClass: surfaceWaterMaterialResponseSchema.shape.targetClass,
  coverage: z.number().min(0).max(1),
  exposure: z.number().min(0).max(1),
  slopeDegrees: z.number().min(0).max(90),
  filmDepthMeters: z.number().nonnegative(),
  absorbedDepthMeters: z.number().nonnegative(),
  runoffDepthMeters: z.number().nonnegative(),
  edgeAccumulationDepthMeters: z.number().nonnegative(),
  puddleDepthMeters: z.number().nonnegative(),
  effectiveRoughness: z.number().min(0).max(1),
  splashEligible: z.boolean(),
});

export const surfaceWaterFieldSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  generator: z.literal('videoer.static-surface-water.v1'),
  inputSha256: sha256,
  fieldSha256: sha256,
  receiver: z.object({
    geometryId: identifier,
    geometrySha256: sha256,
    geometrySemanticSha256: sha256,
    transform: sceneTransformSchema,
    transformSha256: sha256,
  }),
  grid: z.object({
    worldOriginXZ: vec2,
    cellSizeMeters: z.number().positive(),
    columns: z.number().int().positive(),
    rows: z.number().int().positive(),
    supersample: z.union([z.literal(1), z.literal(4), z.literal(9)]),
    activeCellCount: z.number().int().nonnegative(),
  }),
  precipitation: surfaceWaterFieldInputSchema.shape.precipitation,
  drainage: z.object({
    worldDirection: vec2,
    gradientMetersPerMeter: z.number().positive(),
    outletIds: z.array(localIdentifier),
  }),
  shelters: z.array(
    z.object({
      id: localIdentifier,
      geometrySha256: sha256,
      geometrySemanticSha256: sha256,
      transformSha256: sha256,
    }),
  ),
  materialResponsesSha256: sha256,
  cells: z.array(surfaceWaterCellSchema),
  massBalance: z.object({
    incidentCubicMeters: z.number().nonnegative(),
    absorbedCubicMeters: z.number().nonnegative(),
    filmCubicMeters: z.number().nonnegative(),
    edgeCubicMeters: z.number().nonnegative(),
    puddleCubicMeters: z.number().nonnegative(),
    dischargedCubicMeters: z.number().nonnegative(),
    errorCubicMeters: z.number(),
  }),
});

export type SurfaceWaterField = z.infer<typeof surfaceWaterFieldSchema>;

export function verifyStaticSurfaceWaterField(value: unknown) {
  const field = surfaceWaterFieldSchema.parse(value);
  const { fieldSha256, ...withoutHash } = field;
  const issues: string[] = [];
  const expectedFieldSha256 = canonicalSha256(withoutHash);
  if (fieldSha256 !== expectedFieldSha256)
    issues.push(
      `surface-water field hash mismatch: expected ${expectedFieldSha256}, got ${fieldSha256}`,
    );
  const accounted =
    field.massBalance.absorbedCubicMeters +
    field.massBalance.filmCubicMeters +
    field.massBalance.edgeCubicMeters +
    field.massBalance.puddleCubicMeters +
    field.massBalance.dischargedCubicMeters;
  const error = field.massBalance.incidentCubicMeters - accounted;
  const tolerance = Math.max(1e-12, field.massBalance.incidentCubicMeters * 1e-10);
  if (
    Math.abs(error) > tolerance ||
    Math.abs(error - field.massBalance.errorCubicMeters) > tolerance
  )
    issues.push(`surface-water mass balance is invalid by ${error} cubic metres`);
  return { valid: issues.length === 0, issues, field, expectedFieldSha256 };
}

interface Triangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  normal: Vec3;
  index: number;
  materialId?: string;
}

interface Hit {
  position: Vec3;
  normal: Vec3;
  triangleIndex: number;
  materialId?: string;
}

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (value: Vec3): Vec3 => {
  const length = Math.hypot(...value);
  return length > 1e-12 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 1, 0];
};

function transformPoint(point: Vec3, transform: SceneTransform): Vec3 {
  let [x, y, z] = point.map((value, index) => value * transform.scale[index]!) as Vec3;
  const [rx, ry, rz] = transform.rotation;
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return [x + transform.position[0], y + transform.position[1], z + transform.position[2]];
}

function triangleMaterial(geometry: GeometryAsset, indexOffset: number) {
  return geometry.materialGroups.find(
    (group) => indexOffset >= group.start && indexOffset < group.start + group.count,
  )?.materialId;
}

function triangles(geometry: GeometryAsset, transform: SceneTransform): Triangle[] {
  const positions = geometry.positions.map((point) => transformPoint(point, transform));
  const output: Triangle[] = [];
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    const a = positions[geometry.indices[offset]!]!;
    const b = positions[geometry.indices[offset + 1]!]!;
    const c = positions[geometry.indices[offset + 2]!]!;
    const materialId = triangleMaterial(geometry, offset);
    output.push({
      a,
      b,
      c,
      normal: normalize(cross(subtract(b, a), subtract(c, a))),
      index: offset / 3,
      ...(materialId ? { materialId } : {}),
    });
  }
  return output;
}

function highestHit(surface: Triangle[], x: number, z: number): Hit | undefined {
  let best: Hit | undefined;
  for (const triangle of surface) {
    let normal = triangle.normal;
    if (normal[1] < 0) normal = [-normal[0], -normal[1], -normal[2]];
    if (normal[1] < 1e-7) continue;
    const { a, b, c } = triangle;
    const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(denominator) < 1e-12) continue;
    const first = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator;
    const second = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
    const third = 1 - first - second;
    if (first < -1e-8 || second < -1e-8 || third < -1e-8) continue;
    const y = a[1] * first + b[1] * second + c[1] * third;
    if (!best || y > best.position[1])
      best = {
        position: [x, y, z],
        normal,
        triangleIndex: triangle.index,
        ...(triangle.materialId ? { materialId: triangle.materialId } : {}),
      };
  }
  return best;
}

function rayTriangle(origin: Vec3, direction: Vec3, triangle: Triangle, maximum: number) {
  const edge1 = subtract(triangle.b, triangle.a);
  const edge2 = subtract(triangle.c, triangle.a);
  const p = cross(direction, edge2);
  const determinant = dot(edge1, p);
  if (Math.abs(determinant) < 1e-10) return false;
  const inverse = 1 / determinant;
  const t = subtract(origin, triangle.a);
  const u = dot(t, p) * inverse;
  if (u < 0 || u > 1) return false;
  const q = cross(t, edge1);
  const v = dot(direction, q) * inverse;
  if (v < 0 || u + v > 1) return false;
  const distance = dot(edge2, q) * inverse;
  return distance > 1e-5 && distance <= maximum;
}

function isSheltered(
  hit: Hit,
  directionToSky: Vec3,
  shelterTriangles: Triangle[],
  maximum: number,
) {
  const origin: Vec3 = [
    hit.position[0] + directionToSky[0] * 1e-5,
    hit.position[1] + directionToSky[1] * 1e-5,
    hit.position[2] + directionToSky[2] * 1e-5,
  ];
  return shelterTriangles.some((triangle) =>
    rayTriangle(origin, directionToSky, triangle, maximum),
  );
}

class MinimumHeap {
  private readonly values: Array<{ key: number; index: number }> = [];
  push(value: { key: number; index: number }) {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const left = this.values[parent]!;
      if (left.key < value.key || (left.key === value.key && left.index < value.index)) break;
      this.values[index] = left;
      index = parent;
    }
    this.values[index] = value;
  }
  pop() {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last || this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      if (leftIndex >= this.values.length) break;
      let childIndex = leftIndex;
      const left = this.values[leftIndex]!;
      const right = this.values[rightIndex];
      if (right && (right.key < left.key || (right.key === left.key && right.index < left.index)))
        childIndex = rightIndex;
      const child = this.values[childIndex]!;
      if (last.key < child.key || (last.key === child.key && last.index < child.index)) break;
      this.values[index] = child;
      index = childIndex;
    }
    this.values[index] = last;
    return first;
  }
  get size() {
    return this.values.length;
  }
}

function sortedRecord<T>(record: Record<string, T>) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function transformedDrainageDirection(input: ParsedInput): [number, number] {
  const [x, z] = input.drainage.localDirection;
  const origin = transformPoint([0, 0, 0], input.receiver.transform);
  const point = transformPoint([x, 0, z], input.receiver.transform);
  const length = Math.hypot(point[0] - origin[0], point[2] - origin[2]);
  if (length < 1e-9) throw new Error('receiver transform collapses drainage direction');
  return [(point[0] - origin[0]) / length, (point[2] - origin[2]) / length];
}

function sampleOffsets(count: 1 | 4 | 9) {
  const width = Math.sqrt(count);
  return Array.from(
    { length: count },
    (_, index) =>
      [((index % width) + 0.5) / width, (Math.floor(index / width) + 0.5) / width] as const,
  );
}

export function compileStaticSurfaceWater(inputValue: SurfaceWaterFieldInput): SurfaceWaterField {
  const input = surfaceWaterFieldInputSchema.parse(inputValue);
  const receiverTriangles = triangles(input.receiver.geometry, input.receiver.transform);
  const shelterEvidence = [...input.shelters]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((shelter) => ({
      id: shelter.id,
      geometrySha256: shelter.geometrySha256,
      geometrySemanticSha256: canonicalSha256(shelter.geometry),
      transformSha256: canonicalSha256(shelter.transform),
      triangles: triangles(shelter.geometry, shelter.transform),
    }));
  const shelterTriangles = shelterEvidence.flatMap((shelter) => shelter.triangles);
  const geometrySha256 = input.receiver.geometrySha256;
  const geometrySemanticSha256 = canonicalSha256(input.receiver.geometry);
  const transformSha256 = canonicalSha256(input.receiver.transform);
  const materialResponses = sortedRecord(input.materialResponses);
  const materialResponsesSha256 = canonicalSha256(materialResponses);
  const canonicalInput = {
    ...input,
    materialResponses,
    shelters: [...input.shelters].sort((left, right) => left.id.localeCompare(right.id)),
  };
  const inputSha256 = canonicalSha256(canonicalInput);
  let minimumX = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let minimumZ = Number.POSITIVE_INFINITY;
  let maximumZ = Number.NEGATIVE_INFINITY;
  for (const triangle of receiverTriangles)
    for (const point of [triangle.a, triangle.b, triangle.c]) {
      minimumX = Math.min(minimumX, point[0]);
      maximumX = Math.max(maximumX, point[0]);
      minimumZ = Math.min(minimumZ, point[2]);
      maximumZ = Math.max(maximumZ, point[2]);
    }
  if (![minimumX, maximumX, minimumZ, maximumZ].every(Number.isFinite))
    throw new Error('surface-water receiver has no finite triangle bounds');
  const columns = Math.max(1, Math.ceil((maximumX - minimumX) / input.grid.cellSizeMeters));
  const rows = Math.max(1, Math.ceil((maximumZ - minimumZ) / input.grid.cellSizeMeters));
  if (columns * rows > input.solver.maximumCellCount)
    throw new Error(
      `surface-water grid requires ${columns * rows} cells, above maximum ${input.solver.maximumCellCount}`,
    );
  const fallVelocity = normalize([
    input.precipitation.windMetersPerSecond[0],
    -input.precipitation.impactSpeedMetersPerSecond,
    input.precipitation.windMetersPerSecond[1],
  ]);
  const directionToSky: Vec3 = [-fallVelocity[0], -fallVelocity[1], -fallVelocity[2]];
  const offsets = sampleOffsets(input.grid.supersample);
  const drainageDirection = transformedDrainageDirection(input);
  const originX = (minimumX + maximumX) * 0.5;
  const originZ = (minimumZ + maximumZ) * 0.5;
  const rainfallDepthMeters =
    (input.precipitation.intensityMillimetersPerHour / 1_000 / 3_600) *
    input.precipitation.durationSeconds;
  const cellArea = input.grid.cellSizeMeters ** 2;
  const working: Array<{
    cell: z.infer<typeof surfaceWaterCellSchema>;
    response: MaterialResponse;
    area: number;
    freeVolume: number;
    absorptionCapacityVolume: number;
    filmCapacityVolume: number;
    edgeCapacityVolume: number;
    effectiveElevation: number;
    spillElevation: number;
    parent?: number;
  }> = [];
  const byGridIndex = new Map<number, number>();
  let incidentCubicMeters = 0;
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const gridIndex = row * columns + column;
      const hits = offsets
        .map(([u, v]) =>
          highestHit(
            receiverTriangles,
            minimumX + (column + u) * input.grid.cellSizeMeters,
            minimumZ + (row + v) * input.grid.cellSizeMeters,
          ),
        )
        .filter((hit): hit is Hit => Boolean(hit));
      if (!hits.length) continue;
      const counts = new Map<string, number>();
      for (const hit of hits) {
        if (!hit.materialId)
          throw new Error(`receiver triangle ${hit.triangleIndex} has no material group`);
        counts.set(hit.materialId, (counts.get(hit.materialId) ?? 0) + 1);
      }
      const materialId = [...counts].sort(
        ([leftId, leftCount], [rightId, rightCount]) =>
          rightCount - leftCount || leftId.localeCompare(rightId),
      )[0]![0];
      const representative = hits.find((hit) => hit.materialId === materialId)!;
      const response = materialResponses[materialId];
      if (!response) throw new Error(`surface-water response is missing for '${materialId}'`);
      const exposedHits = hits.filter(
        (hit) =>
          !isSheltered(hit, directionToSky, shelterTriangles, input.grid.shelterRayMaximumMeters),
      ).length;
      const coverage = hits.length / offsets.length;
      const exposure = exposedHits / hits.length;
      const area = cellArea * coverage;
      const incidentVolume = rainfallDepthMeters * area * exposure;
      incidentCubicMeters += incidentVolume;
      const availableAbsorptionDepth = Math.min(
        response.absorption.capacityMeters * (1 - response.absorption.initialSaturation),
        response.absorption.rateMetersPerSecond * input.precipitation.durationSeconds,
      );
      const absorptionCapacityVolume = availableAbsorptionDepth * area;
      const absorbedVolume = Math.min(incidentVolume, absorptionCapacityVolume);
      let freeVolume = incidentVolume - absorbedVolume;
      const filmCapacityVolume = response.retention.filmCapacityMeters * area;
      const filmVolume = Math.min(freeVolume, filmCapacityVolume);
      freeVolume -= filmVolume;
      const slopeDegrees =
        (Math.acos(Math.max(-1, Math.min(1, representative.normal[1]))) * 180) / Math.PI;
      const wetFraction =
        response.retention.filmCapacityMeters > 0
          ? Math.min(1, filmVolume / (response.retention.filmCapacityMeters * area))
          : 0;
      const wetTarget = Math.max(
        response.wetRoughness.floor,
        response.wetRoughness.dry * response.wetRoughness.multiplier,
      );
      const index = working.length;
      const effectiveElevation =
        representative.position[1] -
        input.drainage.gradientMetersPerMeter *
          ((representative.position[0] - originX) * drainageDirection[0] +
            (representative.position[2] - originZ) * drainageDirection[1]);
      working.push({
        cell: {
          index: gridIndex,
          column,
          row,
          worldPosition: representative.position,
          normal: representative.normal,
          triangleIndex: representative.triangleIndex,
          materialId,
          targetClass: response.targetClass,
          coverage,
          exposure,
          slopeDegrees,
          filmDepthMeters: area > 0 ? filmVolume / area : 0,
          absorbedDepthMeters: area > 0 ? absorbedVolume / area : 0,
          runoffDepthMeters: 0,
          edgeAccumulationDepthMeters: 0,
          puddleDepthMeters: 0,
          effectiveRoughness:
            response.wetRoughness.dry + (wetTarget - response.wetRoughness.dry) * wetFraction,
          splashEligible: false,
        },
        response,
        area,
        freeVolume,
        absorptionCapacityVolume,
        filmCapacityVolume,
        edgeCapacityVolume: 0,
        effectiveElevation,
        spillElevation: effectiveElevation,
      });
      byGridIndex.set(gridIndex, index);
    }

  const neighbourIndices = (cell: z.infer<typeof surfaceWaterCellSchema>) => [
    cell.column > 0 ? cell.index - 1 : -1,
    cell.column + 1 < columns ? cell.index + 1 : -1,
    cell.row > 0 ? cell.index - columns : -1,
    cell.row + 1 < rows ? cell.index + columns : -1,
  ];
  for (const item of working) {
    const edgeCount = neighbourIndices(item.cell).filter((gridIndex) => {
      const neighbour = byGridIndex.get(gridIndex);
      if (neighbour === undefined) return false;
      const other = working[neighbour]!;
      return (
        other.cell.materialId !== item.cell.materialId ||
        Math.abs(other.cell.worldPosition[1] - item.cell.worldPosition[1]) >=
          input.solver.edgeHeightThresholdMeters
      );
    }).length;
    const edgeCapacity = item.response.retention.edgeCapacityMeters * item.area * (edgeCount / 4);
    item.edgeCapacityVolume = edgeCapacity;
    const stored = Math.min(item.freeVolume, edgeCapacity);
    item.cell.edgeAccumulationDepthMeters = item.area > 0 ? stored / item.area : 0;
    item.freeVolume -= stored;
  }

  const outletSeeds = new Set<number>();
  for (const [index, item] of working.entries()) {
    const boundary = neighbourIndices(item.cell).some((gridIndex) => !byGridIndex.has(gridIndex));
    const outlet = input.drainage.outlets.some(
      (candidate) =>
        Math.hypot(
          item.cell.worldPosition[0] - candidate.worldPosition[0],
          item.cell.worldPosition[2] - candidate.worldPosition[2],
        ) <= candidate.radiusMeters,
    );
    if (boundary || outlet) outletSeeds.add(index);
  }
  if (working.length && !outletSeeds.size)
    throw new Error('surface-water receiver has no open boundary or declared outlet');
  const heap = new MinimumHeap();
  const visited = new Set<number>();
  for (const index of [...outletSeeds].sort((left, right) => left - right)) {
    visited.add(index);
    heap.push({ key: working[index]!.effectiveElevation, index });
  }
  const floodOrder: number[] = [];
  while (heap.size) {
    const currentEntry = heap.pop()!;
    const current = working[currentEntry.index]!;
    floodOrder.push(currentEntry.index);
    for (const gridIndex of neighbourIndices(current.cell)) {
      const neighbourIndex = byGridIndex.get(gridIndex);
      if (neighbourIndex === undefined || visited.has(neighbourIndex)) continue;
      visited.add(neighbourIndex);
      const neighbour = working[neighbourIndex]!;
      neighbour.spillElevation = Math.max(neighbour.effectiveElevation, current.spillElevation);
      neighbour.parent = currentEntry.index;
      heap.push({ key: neighbour.spillElevation, index: neighbourIndex });
    }
  }
  if (visited.size !== working.length)
    throw new Error('surface-water receiver contains cells disconnected from every outlet');

  let dischargedCubicMeters = 0;
  for (const index of [...floodOrder].reverse()) {
    const item = working[index]!;
    const fillStorage = (
      field: 'absorbedDepthMeters' | 'filmDepthMeters' | 'edgeAccumulationDepthMeters',
      capacityVolume: number,
    ) => {
      const storedVolume = item.cell[field] * item.area;
      const added = Math.min(item.freeVolume, Math.max(0, capacityVolume - storedVolume));
      item.cell[field] = item.area > 0 ? (storedVolume + added) / item.area : 0;
      item.freeVolume -= added;
    };
    fillStorage('absorbedDepthMeters', item.absorptionCapacityVolume);
    fillStorage('filmDepthMeters', item.filmCapacityVolume);
    fillStorage('edgeAccumulationDepthMeters', item.edgeCapacityVolume);
    const depressionDepth = Math.min(
      item.response.retention.maximumPuddleDepthMeters,
      Math.max(0, item.spillElevation - item.effectiveElevation),
    );
    const puddleVolume = Math.min(item.freeVolume, depressionDepth * item.area);
    item.cell.puddleDepthMeters = item.area > 0 ? puddleVolume / item.area : 0;
    item.freeVolume -= puddleVolume;
    item.cell.runoffDepthMeters = item.area > 0 ? item.freeVolume / item.area : 0;
    if (item.parent === undefined) dischargedCubicMeters += item.freeVolume;
    else working[item.parent]!.freeVolume += item.freeVolume;
    item.freeVolume = 0;
  }

  for (const item of working) {
    const freeWaterDepth =
      item.cell.filmDepthMeters +
      item.cell.edgeAccumulationDepthMeters +
      item.cell.puddleDepthMeters;
    item.cell.splashEligible =
      item.cell.exposure > 0 &&
      input.precipitation.intensityMillimetersPerHour > 0 &&
      input.precipitation.dropDiameterMillimeters > 0 &&
      input.precipitation.impactSpeedMetersPerSecond > 0 &&
      freeWaterDepth >= item.response.splash.minimumFreeWaterDepthMeters &&
      item.cell.slopeDegrees <= item.response.splash.maximumSlopeDegrees;
    const wetFraction =
      item.response.retention.filmCapacityMeters > 0
        ? Math.min(1, item.cell.filmDepthMeters / item.response.retention.filmCapacityMeters)
        : 0;
    const wetTarget = Math.max(
      item.response.wetRoughness.floor,
      item.response.wetRoughness.dry * item.response.wetRoughness.multiplier,
    );
    item.cell.effectiveRoughness =
      item.response.wetRoughness.dry + (wetTarget - item.response.wetRoughness.dry) * wetFraction;
  }
  const volumeFor = (
    field:
      | 'absorbedDepthMeters'
      | 'filmDepthMeters'
      | 'edgeAccumulationDepthMeters'
      | 'puddleDepthMeters',
  ) => working.reduce((sum, item) => sum + item.cell[field] * item.area, 0);
  const absorbedCubicMeters = volumeFor('absorbedDepthMeters');
  const filmCubicMeters = volumeFor('filmDepthMeters');
  const edgeCubicMeters = volumeFor('edgeAccumulationDepthMeters');
  const puddleCubicMeters = volumeFor('puddleDepthMeters');
  const accounted =
    absorbedCubicMeters +
    filmCubicMeters +
    edgeCubicMeters +
    puddleCubicMeters +
    dischargedCubicMeters;
  const errorCubicMeters = incidentCubicMeters - accounted;
  const tolerance = Math.max(1e-12, incidentCubicMeters * 1e-10);
  if (Math.abs(errorCubicMeters) > tolerance)
    throw new Error(
      `surface-water mass balance error ${errorCubicMeters} exceeds tolerance ${tolerance}`,
    );
  const fieldWithoutHash = {
    schemaVersion: 1 as const,
    id: input.id,
    generator: 'videoer.static-surface-water.v1' as const,
    inputSha256,
    receiver: {
      geometryId: input.receiver.geometry.id,
      geometrySha256,
      geometrySemanticSha256,
      transform: input.receiver.transform,
      transformSha256,
    },
    grid: {
      worldOriginXZ: [minimumX, minimumZ] as [number, number],
      cellSizeMeters: input.grid.cellSizeMeters,
      columns,
      rows,
      supersample: input.grid.supersample,
      activeCellCount: working.length,
    },
    precipitation: input.precipitation,
    drainage: {
      worldDirection: drainageDirection,
      gradientMetersPerMeter: input.drainage.gradientMetersPerMeter,
      outletIds: input.drainage.outlets.map((outlet) => outlet.id).sort(),
    },
    shelters: shelterEvidence.map(
      ({
        id,
        geometrySha256: geometryHash,
        geometrySemanticSha256,
        transformSha256: transformHash,
      }) => ({
        id,
        geometrySha256: geometryHash,
        geometrySemanticSha256,
        transformSha256: transformHash,
      }),
    ),
    materialResponsesSha256,
    cells: working.map((item) => item.cell),
    massBalance: {
      incidentCubicMeters,
      absorbedCubicMeters,
      filmCubicMeters,
      edgeCubicMeters,
      puddleCubicMeters,
      dischargedCubicMeters,
      errorCubicMeters,
    },
  };
  return surfaceWaterFieldSchema.parse({
    ...fieldWithoutHash,
    fieldSha256: canonicalSha256(fieldWithoutHash),
  });
}
