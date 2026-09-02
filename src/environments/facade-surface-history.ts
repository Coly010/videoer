import { z } from 'zod';
import type { GeometryAsset } from '../geometry/model.js';
import { facadeSurfaceHistoryAttributeNames } from '../materials/model.js';
import type { FacadeDirtReceiverZone } from './facade-construction-detail.js';

export const facadeSurfaceHistoryAttributes = facadeSurfaceHistoryAttributeNames;

const channelReportSchema = z.object({
  attribute: z.string(),
  nonzeroVertexCount: z.number().int().nonnegative(),
  maximum: z.number().min(0).max(1),
});

export const facadeSurfaceHistoryMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  generator: z.literal('videoer.facade-surface-history.v1'),
  receiverMaterialIds: z.array(z.string()).min(1),
  receiverVertexCount: z.number().int().positive(),
  maximumFinishIrregularityMeters: z.number().nonnegative().max(0.01),
  displacedExteriorVertexCount: z.number().int().nonnegative(),
  maximumObservedAbsoluteDisplacementMeters: z.number().nonnegative().max(0.01),
  channels: z.object({
    lowerDamp: channelReportSchema,
    openingRunoff: channelReportSchema,
    cornerWeathering: channelReportSchema,
    parapetRunoff: channelReportSchema,
    repairInfluence: channelReportSchema,
  }),
});

export type FacadeSurfaceHistoryReport = z.infer<typeof facadeSurfaceHistoryMetadataSchema>;

export interface ApplyFacadeSurfaceHistoryOptions {
  geometry: GeometryAsset;
  seed: number;
  receiverMaterialIds: string[];
  receiverFrontZByMaterialId: Record<string, number>;
  zones: FacadeDirtReceiverZone[];
  maximumFinishIrregularityMeters: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function pointOnSegment(point: [number, number], start: [number, number], end: [number, number]) {
  const cross =
    (point[0] - start[0]) * (end[1] - start[1]) - (point[1] - start[1]) * (end[0] - start[0]);
  if (Math.abs(cross) > 1e-8) return false;
  const dot =
    (point[0] - start[0]) * (end[0] - start[0]) + (point[1] - start[1]) * (end[1] - start[1]);
  const lengthSquared = (end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2;
  return dot >= -1e-8 && dot <= lengthSquared + 1e-8;
}

function pointInPolygon(point: [number, number], polygon: Array<[number, number]>) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    if (pointOnSegment(point, a, b)) return true;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

function zoneValue(zone: FacadeDirtReceiverZone, x: number, y: number) {
  const [minimumX, minimumY] = zone.minimum;
  const [maximumX, maximumY] = zone.maximum;
  if (x < minimumX - 1e-8 || x > maximumX + 1e-8 || y < minimumY - 1e-8 || y > maximumY + 1e-8)
    return 0;
  if (zone.role === 'repair-influence')
    return zone.polygonXY && pointInPolygon([x, y], zone.polygonXY) ? zone.intensity : 0;
  const height = maximumY - minimumY;
  if (height <= 1e-9) return 0;
  if (zone.role === 'lower-damp') return clamp01((maximumY - y) / height) * zone.intensity;
  if (zone.role === 'opening-runoff') return clamp01((y - minimumY) / height) * zone.intensity;
  if (zone.role === 'parapet-runoff') return clamp01((y - minimumY) / height) * zone.intensity;
  const facadeCentreX = (minimumX + maximumX) * 0.5;
  const width = maximumX - minimumX;
  if (width <= 1e-9) return 0;
  return (
    (facadeCentreX < 0 ? clamp01((maximumX - x) / width) : clamp01((x - minimumX) / width)) *
    zone.intensity
  );
}

function signedVertexNoise(seed: number, x: number, y: number) {
  let state =
    (seed ^ (Math.round(x * 1000) * 0x45d9f3b) ^ (Math.round(y * 1000) * 0x119de1f3)) >>> 0;
  state ^= state >>> 16;
  state = Math.imul(state, 0x7feb352d) >>> 0;
  state ^= state >>> 15;
  state = Math.imul(state, 0x846ca68b) >>> 0;
  state ^= state >>> 16;
  return (state / 0xffffffff) * 2 - 1;
}

export function applyFacadeSurfaceHistory(options: ApplyFacadeSurfaceHistoryOptions): {
  geometry: GeometryAsset;
  report: FacadeSurfaceHistoryReport;
} {
  if (options.receiverMaterialIds.length === 0)
    throw new Error('Facade surface history requires at least one receiver material');
  if (new Set(options.receiverMaterialIds).size !== options.receiverMaterialIds.length)
    throw new Error('Facade surface history receiver materials must be unique');
  if (
    !Number.isFinite(options.maximumFinishIrregularityMeters) ||
    options.maximumFinishIrregularityMeters < 0 ||
    options.maximumFinishIrregularityMeters > 0.01
  )
    throw new Error('Facade finish irregularity must remain within [0, 0.01] metres');
  const output = structuredClone(options.geometry);
  // Mesh primitives may reuse immutable coordinate tuples across duplicated
  // face vertices. Derivations that move vertices must materialise each tuple
  // first or one logical coordinate can be displaced multiple times.
  output.positions = output.positions.map((position) => [...position]);
  const receiverIds = new Set(options.receiverMaterialIds);
  const activeVertices = new Set<number>();
  for (const group of output.materialGroups) {
    if (!receiverIds.has(group.materialId)) continue;
    for (let offset = group.start; offset < group.start + group.count; offset++)
      activeVertices.add(output.indices[offset]!);
  }
  if (activeVertices.size === 0)
    throw new Error(`Facade history receivers have no live vertices in '${output.id}'`);
  for (const materialId of receiverIds) {
    if (!output.materials.some((material) => material.id === materialId))
      throw new Error(`Facade history receiver '${materialId}' is absent from '${output.id}'`);
    if (options.receiverFrontZByMaterialId[materialId] === undefined)
      throw new Error(`Facade history receiver '${materialId}' has no exterior-front depth`);
  }

  const values = Object.fromEntries(
    Object.entries(facadeSurfaceHistoryAttributes).map(([key]) => [
      key,
      output.positions.map(() => 0),
    ]),
  ) as Record<keyof typeof facadeSurfaceHistoryAttributes, number[]>;
  const vertexMaterials = new Map<number, string>();
  for (const group of output.materialGroups) {
    if (!receiverIds.has(group.materialId)) continue;
    for (let offset = group.start; offset < group.start + group.count; offset++)
      vertexMaterials.set(output.indices[offset]!, group.materialId);
  }
  let displacedExteriorVertexCount = 0;
  let maximumObservedAbsoluteDisplacementMeters = 0;
  for (const vertex of activeVertices) {
    const position = output.positions[vertex]!;
    for (const zone of options.zones) {
      const value = zoneValue(zone, position[0], position[1]);
      const key =
        zone.role === 'lower-damp'
          ? 'lowerDamp'
          : zone.role === 'opening-runoff'
            ? 'openingRunoff'
            : zone.role === 'corner-weathering'
              ? 'cornerWeathering'
              : zone.role === 'parapet-runoff'
                ? 'parapetRunoff'
                : 'repairInfluence';
      values[key][vertex] = Math.max(values[key][vertex]!, value);
    }
    const materialId = vertexMaterials.get(vertex)!;
    const receiverFront = options.receiverFrontZByMaterialId[materialId]!;
    if (Math.abs(position[2] - receiverFront) <= 1e-7) {
      const displacement =
        signedVertexNoise(options.seed, position[0], position[1]) *
        options.maximumFinishIrregularityMeters;
      position[2] += displacement;
      displacedExteriorVertexCount += 1;
      maximumObservedAbsoluteDisplacementMeters = Math.max(
        maximumObservedAbsoluteDisplacementMeters,
        Math.abs(displacement),
      );
    }
  }
  output.attributes = {
    ...output.attributes,
    ...Object.fromEntries(
      Object.entries(facadeSurfaceHistoryAttributes).map(([key, attribute]) => [
        attribute,
        {
          dataType: 'float' as const,
          interpolation: 'vertex' as const,
          values: values[key as keyof typeof values],
        },
      ]),
    ),
  };
  const channelReport = (key: keyof typeof facadeSurfaceHistoryAttributes) => ({
    attribute: facadeSurfaceHistoryAttributes[key],
    nonzeroVertexCount: values[key].filter((value) => value > 0).length,
    maximum: Math.max(...values[key]),
  });
  const report = facadeSurfaceHistoryMetadataSchema.parse({
    schemaVersion: 1,
    generator: 'videoer.facade-surface-history.v1',
    receiverMaterialIds: [...receiverIds].sort(),
    receiverVertexCount: activeVertices.size,
    maximumFinishIrregularityMeters: options.maximumFinishIrregularityMeters,
    displacedExteriorVertexCount,
    maximumObservedAbsoluteDisplacementMeters,
    channels: {
      lowerDamp: channelReport('lowerDamp'),
      openingRunoff: channelReport('openingRunoff'),
      cornerWeathering: channelReport('cornerWeathering'),
      parapetRunoff: channelReport('parapetRunoff'),
      repairInfluence: channelReport('repairInfluence'),
    },
  });
  output.metadata.facadeSurfaceHistory = report;
  return { geometry: output, report };
}
