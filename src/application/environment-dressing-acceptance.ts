import { join } from 'node:path';
import { sha256File } from '../assets/library.js';
import {
  dressingLayoutRequestSchema,
  layoutDressingFamily,
} from '../environments/dressing-family.js';
import {
  loadDressingAcceptanceCandidate,
  promoteAcceptedDressingCandidate,
  readJsonRecord,
  type DressingTransferPublication,
} from './dressing-family-acceptance-core.js';

export function dressingRenderEvidencePass(
  report: Record<string, unknown>,
  coverageGateId = 'dressing-entity-inspection-coverage',
) {
  return (
    typeof report.verification === 'object' &&
    report.verification !== null &&
    'status' in report.verification &&
    report.verification.status === 'pass' &&
    Array.isArray(report.frames) &&
    report.frames.length === 3 &&
    Array.isArray(report.renderChecks) &&
    report.renderChecks.length >= 4 &&
    report.renderChecks.every(
      (check) =>
        typeof check === 'object' && check !== null && 'status' in check && check.status === 'pass',
    ) &&
    report.renderChecks.some(
      (check) =>
        typeof check === 'object' &&
        check !== null &&
        'id' in check &&
        check.id === coverageGateId &&
        'measurements' in check &&
        typeof check.measurements === 'object' &&
        check.measurements !== null &&
        'uncoveredEntityIds' in check.measurements &&
        Array.isArray(check.measurements.uncoveredEntityIds) &&
        check.measurements.uncoveredEntityIds.length === 0,
    )
  );
}

export async function verifyDistinctDressingLandmarkPixels(
  directory: string,
  files = ['000-right-context.png', '050-frontal-layout.png', '100-left-context.png'],
) {
  if (files.length < 3)
    throw new Error(`Transfer evidence in '${directory}' requires at least three landmarks`);
  const hashes = await Promise.all(files.map((file) => sha256File(join(directory, file))));
  if (new Set(hashes).size !== files.length)
    throw new Error(
      `Transfer evidence in '${directory}' does not contain three distinct landmark frames`,
    );
  return hashes;
}

export async function acceptStreetStorageDressingFamily(outputDirectory: string) {
  const candidate = await loadDressingAcceptanceCandidate(outputDirectory, [
    {
      directoryName: 'storage-barrel',
      attachments: ['ground-origin', 'stack-top'],
      materialGroups: ['weathered-storage-wood', 'aged-hoop-iron'],
    },
    {
      directoryName: 'slatted-storage-crate',
      attachments: ['ground-origin', 'stack-top'],
      materialGroups: ['weathered-storage-wood', 'aged-hoop-iron'],
    },
  ]);
  const transfers: DressingTransferPublication[] = [];
  for (const kind of ['old-city-alley', 'contemporary-loading-dock'] as const) {
    const directory = join(candidate.familyDirectory, 'verification', kind);
    const [requestValue, persistedLayout, render, landmarkHashes] = await Promise.all([
      readJsonRecord(join(directory, 'layout-request.json')),
      readJsonRecord(join(directory, 'layout-report.json')),
      readJsonRecord(join(directory, 'scene-render.json')),
      verifyDistinctDressingLandmarkPixels(directory),
    ]);
    const request = dressingLayoutRequestSchema.parse(requestValue);
    const recomputed = layoutDressingFamily(candidate.family, request);
    if (JSON.stringify(recomputed) !== JSON.stringify(persistedLayout))
      throw new Error(`Persisted ${kind} layout does not match deterministic regeneration`);
    if (!dressingRenderEvidencePass(render))
      throw new Error(`${kind} transfer render fails declared gates`);
    transfers.push({
      kind,
      summary: { kind, requestId: request.id, landmarkHashes },
      familyCheck: `visual.${kind}-accepted`,
      memberCheck: `visual.${kind}-family-transfer-accepted`,
    });
  }
  const promoted = await promoteAcceptedDressingCandidate({
    candidate,
    transfers,
    familyCapabilities: ['medium-background-quality-tier'],
    familyChecks: [
      'layout.every-entity-inspectable',
      'family.medium-background-shot-distance-accepted',
    ],
    memberChecks: ['prop.medium-background-shot-distance-accepted'],
  });
  return {
    output: candidate.output,
    ...promoted,
    transferSummaries: transfers.map(({ summary }) => summary),
  };
}
