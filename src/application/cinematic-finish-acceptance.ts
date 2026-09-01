import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assetMetadataSchema,
  loadAssetMetadata,
  writeHashedAssetMetadata,
} from '../assets/library.js';
import { loadCinematicFinishProfile } from '../finishing/io.js';
import { cinematicFinishFilter, renderCinematicFinish } from '../finishing/render.js';
import { cinematicFinishCandidateReviewSchema } from '../finishing/review.js';

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

export async function acceptCinematicFinishAsset(outputDirectory: string) {
  const output = resolve(outputDirectory);
  const verification = join(output, 'verification');
  const [asset, profile, review, warmReport, coolReport] = await Promise.all([
    loadAssetMetadata(join(output, 'asset.yaml')),
    loadCinematicFinishProfile(join(output, 'finish-profile.json')),
    readJson(join(verification, 'finish-candidate-review.json')).then((value) =>
      cinematicFinishCandidateReviewSchema.parse(value),
    ),
    readJson(join(verification, 'warm-interior', 'finish-report.json')),
    readJson(join(verification, 'cool-interior', 'finish-report.json')),
  ]);
  if (asset.status !== 'validated')
    throw new Error('Cinematic finish acceptance requires a validated candidate');
  if (asset.id !== profile.id || review.assetId !== profile.id)
    throw new Error('Cinematic finish profile, asset and review identities do not match');
  if (review.decision !== 'accepted')
    throw new Error(`Cinematic finish review rejected '${profile.id}'`);
  for (const path of review.evidence) await readFile(join(output, path));
  if (
    (warmReport.source as { asset?: string }).asset ===
    (coolReport.source as { asset?: string }).asset
  )
    throw new Error('Cinematic finish evidence reuses the same source asset identity');
  if (
    (warmReport.source as { sha256?: string }).sha256 ===
    (coolReport.source as { sha256?: string }).sha256
  )
    throw new Error('Cinematic finish evidence reuses the same source pixels');
  const expectedFilter = cinematicFinishFilter(profile);
  const temp = await mkdtemp(join(tmpdir(), 'videoer-cinematic-finish-'));
  try {
    for (const [kind, report] of [
      ['warm-interior', warmReport],
      ['cool-interior', coolReport],
    ] as const) {
      const source = report.source as { path?: string; sha256?: string; asset?: string };
      const outputEvidence = report.output as { path?: string; sha256?: string };
      const verificationRecord = report.verification as Record<string, unknown> | undefined;
      if (
        !source.path ||
        !source.sha256 ||
        !source.asset ||
        !outputEvidence.path ||
        !outputEvidence.sha256
      )
        throw new Error(`${kind} finish report is incomplete`);
      if (sha256(await readFile(source.path)) !== source.sha256)
        throw new Error(`${kind} finish source changed after evidence generation`);
      if (sha256(await readFile(outputEvidence.path)) !== outputEvidence.sha256)
        throw new Error(`${kind} persisted finished preview changed after evidence generation`);
      if (report.profileId !== profile.id || report.filter !== expectedFilter)
        throw new Error(`${kind} finish report does not match the live profile semantics`);
      if (
        !verificationRecord?.deliveryTopologyPreserved ||
        !verificationRecord.pixelsChanged ||
        !verificationRecord.blackCoveragePreserved ||
        !verificationRecord.highlightDetailPreserved
      )
        throw new Error(`${kind} finish report lacks required quantitative gates`);
      const rerender = await renderCinematicFinish(source.path, join(temp, `${kind}.mp4`), profile);
      if (rerender.sha256 !== outputEvidence.sha256)
        throw new Error(`${kind} finish is not byte-identical under independent rerender`);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  const metadata = assetMetadataSchema.parse(asset);
  const reviewArtifact = {
    role: 'qualitative-review',
    path: 'verification/finish-candidate-review.json',
    mediaType: 'application/json',
  };
  const promoted = await writeHashedAssetMetadata(join(output, 'asset.yaml'), {
    ...metadata,
    status: 'verified',
    artifacts: [
      ...metadata.artifacts.map(({ role, path, mediaType }) => ({ role, path, mediaType })),
      reviewArtifact,
    ],
    verification: {
      checks: [
        ...metadata.verification.checks.filter(
          (check) =>
            !check.endsWith('-generated-not-accepted') &&
            check !== 'finish.independent-rerender-pending-acceptance',
        ),
        'finish.warm-cool-transfer-accepted',
        'finish.independent-byte-identical-rerender',
        'finish.qualitative-restraint-accepted',
      ],
      artifacts: [...metadata.verification.artifacts, reviewArtifact.path],
      verifiedAt: review.reviewedAt,
    },
  });
  return { output, metadata: promoted, profileId: profile.id };
}
