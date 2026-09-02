import { z } from 'zod';
import { canonicalSha256 } from '../assets/sources/cache.js';
import {
  surfaceWaterFieldSchema,
  surfaceWaterFieldV2Schema,
  surfaceWaterMaterialResponseSchema,
  verifyStaticSurfaceWaterField,
  verifyStaticSurfaceWaterFieldV2,
  type SurfaceWaterField,
  type SurfaceWaterFieldV2,
} from './surface-water.js';

const identifier = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/u);
const localIdentifier = z.string().regex(/^[a-z][a-z0-9-]*$/u);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

const receiverAppearanceCellSchema = z.object({
  index: z.number().int().nonnegative(),
  materialId: localIdentifier,
  coverage: z.number().min(0).max(1),
  porousDampness: z.number().min(0).max(1),
  baseColorMultiplier: z.number().min(0.5).max(1),
  roughnessMultiplier: z.number().nonnegative().max(4),
  coherentFilmCoverage: z.number().min(0).max(1),
  interfaceRoughness: z.number().min(0.005).max(0.3),
});

const receiverAppearanceReportSchema = z.object({
  activeCellCount: z.number().int().nonnegative(),
  dampCellCount: z.number().int().nonnegative(),
  coherentFilmCellCount: z.number().int().nonnegative(),
  porousDampAreaSquareMeters: z.number().nonnegative(),
  coherentFilmAreaSquareMeters: z.number().nonnegative(),
  absorbedOnlyCoherentFilmCellCount: z.literal(0),
  belowAsperityCoherentFilmCellCount: z.literal(0),
  puddleOverlapCoherentFilmCellCount: z.literal(0),
  sceneGlobalNormalizationUsed: z.literal(false),
  minimumBaseColorMultiplier: z.number().min(0.5).max(1),
  maximumBaseColorMultiplier: z.number().min(0.5).max(1),
  minimumRoughnessMultiplier: z.number().nonnegative().max(4),
  maximumRoughnessMultiplier: z.number().nonnegative().max(4),
  maximumCoherentFilmCoverage: z.number().min(0).max(1),
});

export const surfaceWaterReceiverAppearanceSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  generator: z.literal('videoer.surface-water-receiver-appearance.v1'),
  sourceFieldId: identifier,
  sourceFieldSha256: sha256,
  receiver: z.object({
    geometryId: identifier,
    geometrySha256: sha256,
    geometrySemanticSha256: sha256,
    transformSha256: sha256,
  }),
  materialResponsesSha256: sha256,
  materialResponses: z.record(localIdentifier, surfaceWaterMaterialResponseSchema),
  appearanceSha256: sha256,
  cells: z.array(receiverAppearanceCellSchema),
  report: receiverAppearanceReportSchema,
});

export type SurfaceWaterReceiverAppearance = z.infer<typeof surfaceWaterReceiverAppearanceSchema>;
type OpticalSourceWaterField = SurfaceWaterField | SurfaceWaterFieldV2;
type MaterialResponses = z.infer<typeof surfaceWaterReceiverAppearanceSchema>['materialResponses'];

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number) {
  const amount = clamp01(value);
  return amount * amount * (3 - 2 * amount);
}

function sortedMaterialResponses(value: MaterialResponses): MaterialResponses {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function reportFor(
  field: OpticalSourceWaterField,
  materialResponses: MaterialResponses,
  cells: z.infer<typeof receiverAppearanceCellSchema>[],
) {
  const cellArea = field.grid.cellSizeMeters ** 2;
  const dampCells = cells.filter((cell) => cell.porousDampness > 0);
  const coherentCells = cells.filter((cell) => cell.coherentFilmCoverage > 0);
  const fieldByIndex = new Map(field.cells.map((cell) => [cell.index, cell]));
  const values = <K extends keyof z.infer<typeof receiverAppearanceCellSchema>>(property: K) =>
    cells.map((cell) => cell[property] as number);
  return receiverAppearanceReportSchema.parse({
    activeCellCount: cells.length,
    dampCellCount: dampCells.length,
    coherentFilmCellCount: coherentCells.length,
    porousDampAreaSquareMeters: dampCells.reduce((sum, cell) => sum + cell.coverage * cellArea, 0),
    coherentFilmAreaSquareMeters: coherentCells.reduce(
      (sum, cell) => sum + cell.coverage * cellArea * cell.coherentFilmCoverage,
      0,
    ),
    absorbedOnlyCoherentFilmCellCount: coherentCells.filter((cell) => {
      const source = fieldByIndex.get(cell.index)!;
      return (
        source.absorbedDepthMeters > 0 &&
        source.filmDepthMeters === 0 &&
        source.edgeAccumulationDepthMeters === 0 &&
        source.puddleDepthMeters === 0
      );
    }).length,
    belowAsperityCoherentFilmCellCount: coherentCells.filter((cell) => {
      const source = fieldByIndex.get(cell.index)!;
      return (
        source.filmDepthMeters <=
        materialResponses[cell.materialId]!.receiverAppearance!.asperityEnvelopeMeters
      );
    }).length,
    puddleOverlapCoherentFilmCellCount: coherentCells.filter(
      (cell) => fieldByIndex.get(cell.index)!.puddleDepthMeters > 0,
    ).length,
    sceneGlobalNormalizationUsed: false,
    minimumBaseColorMultiplier: Math.min(1, ...values('baseColorMultiplier')),
    maximumBaseColorMultiplier: Math.max(1, ...values('baseColorMultiplier')),
    minimumRoughnessMultiplier: Math.min(1, ...values('roughnessMultiplier')),
    maximumRoughnessMultiplier: Math.max(1, ...values('roughnessMultiplier')),
    maximumCoherentFilmCoverage: Math.max(0, ...values('coherentFilmCoverage')),
  });
}

export function compileSurfaceWaterReceiverAppearance(
  fieldValue: OpticalSourceWaterField,
  materialResponsesValue: MaterialResponses,
  id: string,
): SurfaceWaterReceiverAppearance {
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
      `cannot compile receiver appearance from invalid surface-water field: ${fieldVerification.issues.join('; ')}`,
    );
  const materialResponses = sortedMaterialResponses(
    z.record(localIdentifier, surfaceWaterMaterialResponseSchema).parse(materialResponsesValue),
  );
  const materialResponsesSha256 = canonicalSha256(materialResponses);
  if (materialResponsesSha256 !== field.materialResponsesSha256)
    throw new Error(
      `receiver appearance material-response hash mismatch: expected ${field.materialResponsesSha256}, got ${materialResponsesSha256}`,
    );
  const cells = field.cells.map((cell) => {
    const response = materialResponses[cell.materialId];
    const appearance = response?.receiverAppearance;
    if (!response || !appearance)
      throw new Error(
        `surface-water material '${cell.materialId}' lacks a receiver-appearance calibration`,
      );
    const absorptionSaturation =
      response.absorption.capacityMeters > 0
        ? clamp01(
            response.absorption.initialSaturation +
              cell.absorbedDepthMeters / response.absorption.capacityMeters,
          )
        : 0;
    const filmSaturation =
      response.retention.filmCapacityMeters > 0
        ? clamp01(cell.filmDepthMeters / response.retention.filmCapacityMeters)
        : 0;
    const edgeSaturation =
      response.retention.edgeCapacityMeters > 0
        ? clamp01(cell.edgeAccumulationDepthMeters / response.retention.edgeCapacityMeters)
        : 0;
    const porousDampness =
      1 - (1 - absorptionSaturation) * (1 - filmSaturation) * (1 - edgeSaturation);
    const coherentFilmCoverage =
      cell.puddleDepthMeters > 0
        ? 0
        : appearance.maximumCoherentFilmCoverage *
          smoothstep(
            (cell.filmDepthMeters - appearance.asperityEnvelopeMeters) /
              appearance.coherenceTransitionMeters,
          );
    return receiverAppearanceCellSchema.parse({
      index: cell.index,
      materialId: cell.materialId,
      coverage: cell.coverage,
      porousDampness,
      baseColorMultiplier: 1 + (appearance.saturatedBaseColorMultiplier - 1) * porousDampness,
      roughnessMultiplier: 1 + (appearance.saturatedRoughnessMultiplier - 1) * porousDampness,
      coherentFilmCoverage,
      interfaceRoughness: appearance.interfaceRoughness,
    });
  });
  const withoutHash = {
    schemaVersion: 1 as const,
    id: identifier.parse(id),
    generator: 'videoer.surface-water-receiver-appearance.v1' as const,
    sourceFieldId: field.id,
    sourceFieldSha256: field.fieldSha256,
    receiver: {
      geometryId: field.receiver.geometryId,
      geometrySha256: field.receiver.geometrySha256,
      geometrySemanticSha256: field.receiver.geometrySemanticSha256,
      transformSha256: field.receiver.transformSha256,
    },
    materialResponsesSha256,
    materialResponses,
    cells,
    report: reportFor(field, materialResponses, cells),
  };
  return surfaceWaterReceiverAppearanceSchema.parse({
    ...withoutHash,
    appearanceSha256: canonicalSha256(withoutHash),
  });
}

export function verifySurfaceWaterReceiverAppearance(
  value: unknown,
  fieldValue?: OpticalSourceWaterField,
) {
  const appearance = surfaceWaterReceiverAppearanceSchema.parse(value);
  const { appearanceSha256, ...withoutHash } = appearance;
  const issues: string[] = [];
  const expectedSha256 = canonicalSha256(withoutHash);
  if (appearanceSha256 !== expectedSha256)
    issues.push(
      `surface-water receiver appearance hash mismatch: expected ${expectedSha256}, got ${appearanceSha256}`,
    );
  const expectedMaterialResponsesSha256 = canonicalSha256(appearance.materialResponses);
  if (appearance.materialResponsesSha256 !== expectedMaterialResponsesSha256)
    issues.push('surface-water receiver appearance material-response hash is stale');
  if (appearance.report.activeCellCount !== appearance.cells.length)
    issues.push('surface-water receiver appearance cell count differs from its report');
  let expected: SurfaceWaterReceiverAppearance | undefined;
  if (fieldValue) {
    expected = compileSurfaceWaterReceiverAppearance(
      fieldValue,
      appearance.materialResponses,
      appearance.id,
    );
    if (
      appearance.sourceFieldId !== expected.sourceFieldId ||
      appearance.sourceFieldSha256 !== expected.sourceFieldSha256 ||
      appearance.appearanceSha256 !== expected.appearanceSha256
    )
      issues.push('surface-water receiver appearance differs from exact field reconstruction');
  }
  return { valid: issues.length === 0, issues, appearance, expected, expectedSha256 };
}
