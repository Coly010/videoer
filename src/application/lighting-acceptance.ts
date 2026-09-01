import { readFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import {
  loadAssetMetadata,
  writeHashedAssetMetadata,
  type AssetMetadata,
} from '../assets/library.js';
import { lightingCandidateReviewSchema } from '../lighting/review.js';
import { adaptLightingRig, verifyLightingRigAdaptation } from '../lighting/adaptation.js';
import { loadLightingRig } from '../lighting/io.js';
import { lightingTransferProbeSchema } from '../lighting/transfer-probe.js';
import { temporalLightingEvidencePass } from '../lighting/temporal-evidence.js';

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

export async function acceptLightingCandidate(assetDirectory: string) {
  const directory = resolve(assetDirectory);
  const asset = await loadAssetMetadata(join(directory, 'asset.yaml'));
  if (asset.type !== 'lighting' || asset.status !== 'validated')
    throw new Error('Lighting acceptance requires a validated first-class lighting candidate');
  const review = lightingCandidateReviewSchema.parse(
    await parseJson(join(directory, 'verification', 'lighting-candidate-review.json')),
  );
  if (review.assetId !== asset.id)
    throw new Error(`Lighting review targets '${review.assetId}', not '${asset.id}'`);
  if (review.decision !== 'accepted') throw new Error(`Lighting review rejected '${asset.id}'`);
  await Promise.all(review.evidence.map((path) => readFile(resolve(directory, path))));
  const sourceEvidence = resolve(directory, review.sourceEvidenceDirectory);
  const transferEvidence = resolve(directory, review.transferEvidenceDirectory);
  const [
    sourceRender,
    transferRender,
    persistedAdaptation,
    sourceRig,
    transferDefinitionValue,
    adaptedRig,
  ] = await Promise.all([
    parseJson(join(sourceEvidence, 'scene-render.json')),
    parseJson(join(transferEvidence, 'scene-render.json')),
    parseJson(join(transferEvidence, 'lighting-adaptation-report.json')),
    loadLightingRig(join(directory, 'lighting-rig.json')),
    parseJson(join(transferEvidence, 'transfer-definition.json')),
    loadLightingRig(join(transferEvidence, 'adapted-lighting-rig.json')),
  ]);
  if (!renderChecksPass(sourceRender))
    throw new Error('Source lighting evidence has a failed render gate');
  if (!renderChecksPass(transferRender))
    throw new Error('Transfer lighting evidence has a failed render gate');
  const transferDefinition = lightingTransferProbeSchema.parse(transferDefinitionValue);
  const declaredSource = resolve(transferEvidence, transferDefinition.sourceRigPath);
  if (declaredSource !== resolve(directory, 'lighting-rig.json'))
    throw new Error('Lighting transfer does not consume the candidate source rig');
  const expectedRig = adaptLightingRig(sourceRig, transferDefinition.adaptation);
  if (JSON.stringify(adaptedRig) !== JSON.stringify(expectedRig))
    throw new Error('Persisted transfer rig does not match the live bounded adaptation');
  const liveAdaptation = verifyLightingRigAdaptation(
    sourceRig,
    adaptedRig,
    transferDefinition.adaptation,
  );
  if (!liveAdaptation.valid) throw new Error('Transfer lighting adaptation is invalid');
  if (JSON.stringify(persistedAdaptation) !== JSON.stringify(liveAdaptation))
    throw new Error('Persisted lighting adaptation report does not match live reconstruction');
  const hasTemporalLighting = sourceRig.lights.some((light) => light.temporalModulation);
  if (hasTemporalLighting) {
    const [sourceTemporal, transferTemporal] = await Promise.all([
      parseJson(join(sourceEvidence, 'lighting-modulation-report.json')),
      parseJson(join(transferEvidence, 'lighting-modulation-report.json')),
    ]);
    if (!temporalLightingEvidencePass(sourceTemporal, sourceRig))
      throw new Error('Source temporal lighting evidence does not match the live rig');
    if (!temporalLightingEvidencePass(transferTemporal, adaptedRig))
      throw new Error('Transfer temporal lighting evidence does not match the adapted rig');
  }
  const transferVideo = resolve(String(transferRender.video ?? ''));
  if (!transferVideo.startsWith(`${transferEvidence}${sep}`))
    throw new Error('Transfer preview must remain inside the declared transfer evidence directory');
  await readFile(transferVideo);
  const artifactPath = (path: string) => relative(directory, path).split(sep).join('/');
  const transferArtifacts: AssetMetadata['artifacts'] = [
    {
      role: 'transfer-definition',
      path: artifactPath(join(transferEvidence, 'transfer-definition.json')),
      mediaType: 'application/vnd.videoer.lighting-transfer-probe+json',
    },
    {
      role: 'transfer-lighting-rig',
      path: artifactPath(join(transferEvidence, 'adapted-lighting-rig.json')),
      mediaType: 'application/vnd.videoer.lighting+json',
    },
    {
      role: 'transfer-adaptation-report',
      path: artifactPath(join(transferEvidence, 'lighting-adaptation-report.json')),
      mediaType: 'application/json',
    },
    {
      role: 'transfer-contact-sheet',
      path: artifactPath(join(transferEvidence, 'contact-sheet.png')),
      mediaType: 'image/png',
    },
    {
      role: 'transfer-preview',
      path: artifactPath(join(transferEvidence, basename(transferVideo))),
      mediaType: 'video/mp4',
    },
    {
      role: 'transfer-scene-render',
      path: artifactPath(join(transferEvidence, 'scene-render.json')),
      mediaType: 'application/json',
    },
    {
      role: 'qualitative-review',
      path: 'verification/lighting-candidate-review.json',
      mediaType: 'application/json',
    },
    ...(hasTemporalLighting
      ? [
          {
            role: 'source-lighting-modulation-report',
            path: artifactPath(join(sourceEvidence, 'lighting-modulation-report.json')),
            mediaType: 'application/json',
          },
          {
            role: 'transfer-lighting-modulation-report',
            path: artifactPath(join(transferEvidence, 'lighting-modulation-report.json')),
            mediaType: 'application/json',
          },
        ]
      : []),
  ];
  const existingArtifactKeys = new Set(
    asset.artifacts.map((artifact) => `${artifact.role}\u0000${artifact.path}`),
  );
  const metadata = {
    ...asset,
    status: 'verified' as const,
    artifacts: [
      ...asset.artifacts.map(({ role, path, mediaType }) => ({ role, path, mediaType })),
      ...transferArtifacts.filter(
        (artifact) => !existingArtifactKeys.has(`${artifact.role}\u0000${artifact.path}`),
      ),
    ],
    compatibility: {
      ...asset.compatibility,
      requires: review.portableWithoutEnvironment ? [] : asset.compatibility.requires,
    },
    verification: {
      checks: [
        ...asset.verification.checks.filter((check) => check !== 'visual.generated-not-accepted'),
        'visual.source-lighting-evidence-accepted',
        'lighting.unrelated-environment-transfer-reconstructed',
        'visual.unrelated-environment-transfer-accepted',
        ...(hasTemporalLighting
          ? [
              'lighting.source-temporal-modulation-reconstructed',
              'lighting.transfer-temporal-modulation-reconstructed',
            ]
          : []),
      ],
      artifacts: [
        ...new Set([
          ...asset.verification.artifacts,
          ...review.evidence,
          artifactPath(join(transferEvidence, 'contact-sheet.png')),
          artifactPath(join(transferEvidence, 'scene-render.json')),
          artifactPath(join(transferEvidence, 'lighting-adaptation-report.json')),
          'verification/lighting-candidate-review.json',
        ]),
      ],
      verifiedAt: review.reviewedAt,
    },
  } satisfies AssetMetadata;
  return writeHashedAssetMetadata(join(directory, 'asset.yaml'), metadata);
}
