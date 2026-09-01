import { join } from 'node:path';
import {
  dressingLayoutRequestSchema,
  layoutDressingFamily,
} from '../environments/dressing-family.js';
import { createTriangleSurfaceQuery } from '../environments/surface-query.js';
import { loadGeometry } from '../geometry/io.js';
import {
  dressingRenderEvidencePass,
  verifyDistinctDressingLandmarkPixels,
} from './environment-dressing-acceptance.js';
import {
  loadDressingAcceptanceCandidate,
  promoteAcceptedDressingCandidate,
  readJsonRecord,
  type DressingTransferPublication,
} from './dressing-family-acceptance-core.js';

export async function acceptPottedVegetationDressingFamily(outputDirectory: string) {
  const candidate = await loadDressingAcceptanceCandidate(outputDirectory, [
    {
      directoryName: 'potted-fern',
      attachments: ['ground-origin', 'pot-rim', 'foliage-crown'],
      materialGroups: ['weathered-terracotta', 'dark-soil', 'fern-stem', 'fern-dark', 'fern-light'],
      metadata: { livingAsset: true },
    },
    {
      directoryName: 'potted-shrub',
      attachments: ['ground-origin', 'pot-rim', 'foliage-crown'],
      materialGroups: [
        'galvanized-zinc',
        'dark-soil',
        'shrub-branch',
        'shrub-dark',
        'shrub-mid',
        'shrub-light',
      ],
      metadata: { livingAsset: true },
    },
  ]);
  const transfers: DressingTransferPublication[] = [];
  for (const kind of ['historic-courtyard', 'contemporary-rooftop'] as const) {
    const directory = join(candidate.familyDirectory, 'verification', kind);
    const [requestValue, persistedLayout, surface, render, landmarkHashes] = await Promise.all([
      readJsonRecord(join(directory, 'layout-request.json')),
      readJsonRecord(join(directory, 'layout-report.json')),
      loadGeometry(join(directory, 'surface-geometry.json')),
      readJsonRecord(join(directory, 'scene-render.json')),
      verifyDistinctDressingLandmarkPixels(directory),
    ]);
    const request = dressingLayoutRequestSchema.parse(requestValue);
    if (request.surfaceQuery.kind !== 'triangle-mesh')
      throw new Error(`${kind} vegetation transfer does not declare a triangle-mesh surface`);
    const surfaceContract = request.surfaceQuery;
    if (surfaceContract.geometryAssetId !== surface.id)
      throw new Error(`${kind} vegetation transfer surface identity does not match live geometry`);
    const recomputed = layoutDressingFamily(candidate.family, request, {
      surfaceQuery: createTriangleSurfaceQuery(surface),
    });
    if (JSON.stringify(recomputed) !== JSON.stringify(persistedLayout))
      throw new Error(
        `Persisted ${kind} vegetation layout does not match live-surface regeneration`,
      );
    if (!recomputed.verification.allRequiredVariantsPresent)
      throw new Error(`${kind} vegetation transfer omits a required family silhouette`);
    if (
      recomputed.instances.some(
        (instance) =>
          !instance.surface ||
          instance.surface.geometryAssetId !== surface.id ||
          instance.surface.slopeDegrees <= 0.25 ||
          instance.surface.slopeDegrees > surfaceContract.maximumSlopeDegrees,
      )
    )
      throw new Error(`${kind} vegetation transfer lacks valid non-flat support evidence`);
    if (!dressingRenderEvidencePass(render, 'vegetation-entity-inspection-coverage'))
      throw new Error(`${kind} vegetation transfer render fails declared gates`);
    transfers.push({
      kind,
      summary: { kind, requestId: request.id, surfaceAssetId: surface.id, landmarkHashes },
      familyCheck: `visual.${kind}-accepted`,
      memberCheck: `visual.${kind}-family-transfer-accepted`,
    });
  }
  const promoted = await promoteAcceptedDressingCandidate({
    candidate,
    transfers,
    familyCapabilities: ['medium-background-quality-tier'],
    familyChecks: [
      'layout.live-triangle-surface-regeneration-accepted',
      'layout.required-variant-coverage-accepted',
      'layout.every-entity-inspectable',
      'family.medium-background-shot-distance-accepted',
    ],
    memberChecks: [
      'prop.non-flat-placement-accepted',
      'prop.medium-background-shot-distance-accepted',
    ],
  });
  return {
    output: candidate.output,
    ...promoted,
    transferSummaries: transfers.map(({ summary }) => summary),
  };
}
