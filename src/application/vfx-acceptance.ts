import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  loadAssetMetadata,
  writeHashedAssetMetadata,
  type AssetMetadata,
} from '../assets/library.js';
import { atmosphericVfxCandidateReviewSchema } from '../vfx/review.js';

function parseJson(path: string) {
  return readFile(path, 'utf8').then((value) => JSON.parse(value) as Record<string, unknown>);
}

function renderChecksPass(report: Record<string, unknown>) {
  const checks = report.renderChecks;
  return (
    Array.isArray(checks) &&
    checks.length > 0 &&
    checks.every(
      (check) =>
        typeof check === 'object' && check !== null && 'status' in check && check.status === 'pass',
    )
  );
}

function probeEvidencePass(report: Record<string, unknown>) {
  const verification = report.verification;
  const frames = report.frames;
  return (
    typeof verification === 'object' &&
    verification !== null &&
    'status' in verification &&
    verification.status === 'pass' &&
    Array.isArray(frames) &&
    frames.length >= 3 &&
    frames.every(
      (frame) =>
        typeof frame === 'object' &&
        frame !== null &&
        'blackPercentage' in frame &&
        typeof frame.blackPercentage === 'number' &&
        frame.blackPercentage <= 40 &&
        'whitePercentage' in frame &&
        typeof frame.whitePercentage === 'number' &&
        frame.whitePercentage <= 4,
    )
  );
}

export async function acceptAtmosphericVfxCandidate(assetDirectory: string) {
  const directory = resolve(assetDirectory);
  const asset = await loadAssetMetadata(join(directory, 'asset.yaml'));
  if (asset.type !== 'vfx' || asset.status !== 'validated')
    throw new Error('Atmospheric VFX acceptance requires a validated VFX candidate');
  const review = atmosphericVfxCandidateReviewSchema.parse(
    await parseJson(join(directory, 'verification', 'vfx-candidate-review.json')),
  );
  if (review.assetId !== asset.id)
    throw new Error(`VFX review targets '${review.assetId}', not '${asset.id}'`);
  if (review.decision !== 'accepted') throw new Error(`VFX review rejected '${asset.id}'`);
  await Promise.all(review.evidence.map((path) => access(join(directory, path))));

  const [groundRender, oldCityTransfer, transitTransfer, transitAdaptation] = await Promise.all([
    parseJson(join(directory, 'verification', 'ground-response-final', 'scene-render.json')),
    parseJson(
      join(
        directory,
        'verification',
        'transfer',
        'old-city-water-final',
        'verification',
        'scene-probe.json',
      ),
    ),
    parseJson(
      join(
        directory,
        'verification',
        'transfer',
        'night-transit-water-final',
        'verification',
        'scene-probe.json',
      ),
    ),
    parseJson(
      join(
        directory,
        'verification',
        'transfer',
        'night-transit-water-final',
        'adaptation-report.json',
      ),
    ),
  ]);
  if (!renderChecksPass(groundRender))
    throw new Error('Complete temporal ground-response evidence has a failed render gate');
  if (!probeEvidencePass(oldCityTransfer))
    throw new Error('Old-city intended-camera transfer evidence fails visibility/highlight limits');
  if (!probeEvidencePass(transitTransfer))
    throw new Error('Night-transit transfer evidence fails visibility/highlight limits');
  if (transitAdaptation.valid !== true)
    throw new Error('Night-transit receiver adaptation is invalid');

  const evidenceArtifacts: AssetMetadata['artifacts'] = [
    {
      role: 'ground-response-contact-sheet',
      path: 'verification/ground-response-final/contact-sheet.png',
      mediaType: 'image/png',
    },
    {
      role: 'ground-response-preview',
      path: 'verification/ground-response-final/atmospheric-ground-response-probe.mp4',
      mediaType: 'video/mp4',
    },
    {
      role: 'ground-response-render-report',
      path: 'verification/ground-response-final/scene-render.json',
      mediaType: 'application/json',
    },
    {
      role: 'old-city-transfer-contact-sheet',
      path: 'verification/transfer/old-city-water-final/verification/contact-sheet.png',
      mediaType: 'image/png',
    },
    {
      role: 'old-city-transfer-report',
      path: 'verification/transfer/old-city-water-final/verification/scene-probe.json',
      mediaType: 'application/json',
    },
    {
      role: 'night-transit-transfer-contact-sheet',
      path: 'verification/transfer/night-transit-water-final/verification/contact-sheet.png',
      mediaType: 'image/png',
    },
    {
      role: 'night-transit-transfer-report',
      path: 'verification/transfer/night-transit-water-final/verification/scene-probe.json',
      mediaType: 'application/json',
    },
    {
      role: 'night-transit-receiver-adaptation',
      path: 'verification/transfer/night-transit-water-final/adaptation-report.json',
      mediaType: 'application/json',
    },
    {
      role: 'qualitative-review',
      path: 'verification/vfx-candidate-review.json',
      mediaType: 'application/json',
    },
  ];
  const metadata = {
    ...asset,
    status: 'verified' as const,
    artifacts: [
      ...asset.artifacts.map(({ role, path, mediaType }) => ({ role, path, mediaType })),
      ...evidenceArtifacts,
    ],
    verification: {
      checks: [
        ...asset.verification.checks.filter((check) => !check.endsWith('-generated-not-accepted')),
        'visual.depth-separated-rain-and-restrained-fog-accepted',
        'visual.close-ground-response-accepted',
        'vfx.complete-temporal-ground-response',
        'visual.old-city-intended-camera-transfer-accepted',
        'vfx.receiver-bounds-only-adaptation',
        'visual.night-transit-transfer-accepted',
      ],
      artifacts: evidenceArtifacts.map((artifact) => artifact.path),
      verifiedAt: review.reviewedAt,
    },
  } satisfies AssetMetadata;
  return writeHashedAssetMetadata(join(directory, 'asset.yaml'), metadata);
}
