import { access, copyFile, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  loadAssetMetadata,
  validateLibraryAsset,
  writeHashedAssetMetadata,
  type AssetMetadata,
} from '../assets/library.js';
import { loadGeometry } from '../geometry/io.js';
import { validateGeometry } from '../geometry/model.js';
import { hairAssetDefinitionSchema } from '../hair/model.js';
import { hairCandidateReviewSchema } from '../hair/review.js';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

export function fittedHairRenderPass(report: Record<string, unknown>) {
  const verification = report.verification;
  const frames = report.frames;
  const renderChecks = report.renderChecks;
  return (
    typeof verification === 'object' &&
    verification !== null &&
    'status' in verification &&
    verification.status === 'pass' &&
    Array.isArray(frames) &&
    frames.length === 4 &&
    new Set(
      frames.map((frame) =>
        typeof frame === 'object' && frame !== null && 'id' in frame ? frame.id : undefined,
      ),
    ).size === 4 &&
    ['three-quarter-right', 'front', 'three-quarter-left', 'rear'].every((id) =>
      frames.some(
        (frame) => typeof frame === 'object' && frame !== null && 'id' in frame && frame.id === id,
      ),
    ) &&
    Array.isArray(renderChecks) &&
    renderChecks.length > 0 &&
    renderChecks.every(
      (check) =>
        typeof check === 'object' && check !== null && 'status' in check && check.status === 'pass',
    )
  );
}

function validationPass(report: Record<string, unknown>) {
  return (
    report.valid === true &&
    Array.isArray(report.issues) &&
    report.issues.length === 0 &&
    typeof report.headBone === 'number' &&
    report.headBone >= 0 &&
    typeof report.ownedHeadVertices === 'number' &&
    report.ownedHeadVertices >= 100 &&
    typeof report.targetSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(report.targetSha256)
  );
}

export async function acceptHairCandidate(assetDirectory: string, transferDirectory: string) {
  const directory = resolve(assetDirectory);
  const transfer = resolve(transferDirectory);
  if (directory === transfer)
    throw new Error('Hair acceptance requires a distinct transfer target');
  const asset = await loadAssetMetadata(join(directory, 'asset.yaml'));
  if (asset.type !== 'hair' || asset.status !== 'validated')
    throw new Error('Hair acceptance requires a validated hair candidate');
  const integrity = await validateLibraryAsset(asset);
  if (!integrity.valid)
    throw new Error(`Hair candidate integrity failed: ${integrity.issues.join('; ')}`);

  const [
    review,
    definition,
    transferDefinition,
    geometry,
    transferGeometry,
    primaryValidation,
    transferValidation,
    primaryRender,
    transferRender,
  ] = await Promise.all([
    json(join(directory, 'verification', 'hair-candidate-review.json')).then((value) =>
      hairCandidateReviewSchema.parse(value),
    ),
    json(join(directory, 'hair.json')).then((value) => hairAssetDefinitionSchema.parse(value)),
    json(join(transfer, 'hair.json')).then((value) => hairAssetDefinitionSchema.parse(value)),
    loadGeometry(join(directory, 'geometry.json')),
    loadGeometry(join(transfer, 'geometry.json')),
    json(join(directory, 'validation.json')),
    json(join(transfer, 'validation.json')),
    json(join(directory, 'verification', 'fitted', 'scene-render.json')),
    json(join(transfer, 'verification', 'fitted', 'scene-render.json')),
  ]);
  if (review.assetId !== asset.id || review.decision !== 'accepted')
    throw new Error('Hair review identity or decision does not accept the candidate');
  if (Object.values(review.assessments).some((assessment) => assessment !== 'pass'))
    throw new Error('Hair qualitative assessment contains a failed dimension');
  if (
    definition.id !== asset.id ||
    definition.version !== asset.version ||
    transferDefinition.id !== definition.id ||
    transferDefinition.version !== definition.version ||
    definition.representation !== 'dedicated-scalp-layered-cards' ||
    !definition.cardSystem ||
    definition.cardSystem.cardCount < 48
  )
    throw new Error('Hair definition is not the accepted dedicated scalp/card representation');
  if (!validationPass(primaryValidation) || !validationPass(transferValidation))
    throw new Error('Hair structural validation evidence is incomplete');
  if (primaryValidation.targetSha256 === transferValidation.targetSha256)
    throw new Error('Hair transfer evidence reuses the primary target');
  for (const candidate of [geometry, transferGeometry]) {
    const structural = validateGeometry(candidate);
    const head = candidate.skeleton.findIndex((joint) => joint.id === 'head');
    if (
      !structural.valid ||
      head < 0 ||
      !candidate.skinIndices?.every((indices) => indices[0] === head)
    )
      throw new Error('Hair geometry fails live validation or exclusive head ownership');
  }
  if (!fittedHairRenderPass(primaryRender) || !fittedHairRenderPass(transferRender))
    throw new Error('Hair fitted render evidence is incomplete or failed');
  await Promise.all(review.evidence.map((path) => access(join(directory, path))));

  const transferEvidenceDirectory = join(directory, 'verification', 'transfer');
  await mkdir(transferEvidenceDirectory, { recursive: true });
  const transferArtifacts = [
    ['contact-sheet.png', join(transfer, 'verification', 'fitted', 'contact-sheet.png')],
    ['scene-render.json', join(transfer, 'verification', 'fitted', 'scene-render.json')],
    ['validation.json', join(transfer, 'validation.json')],
  ] as const;
  for (const [name, source] of transferArtifacts)
    await copyFile(source, join(transferEvidenceDirectory, name));

  const evidenceArtifacts: AssetMetadata['artifacts'] = [
    {
      role: 'qualitative-review',
      path: 'verification/hair-candidate-review.json',
      mediaType: 'application/json',
    },
    {
      role: 'transfer-fitted-contact-sheet',
      path: 'verification/transfer/contact-sheet.png',
      mediaType: 'image/png',
    },
    {
      role: 'transfer-render-report',
      path: 'verification/transfer/scene-render.json',
      mediaType: 'application/json',
    },
    {
      role: 'transfer-validation',
      path: 'verification/transfer/validation.json',
      mediaType: 'application/json',
    },
  ];
  const metadata = {
    ...asset,
    status: 'verified' as const,
    description:
      'Separable canonical-humanoid low-bun hair with dedicated fitted scalp topology, continuous crown-to-nape strand-group cards, surface-ribbon bun detail, and UV-directed fiber response.',
    capabilities: [
      ...asset.capabilities.filter((capability) => capability !== 'banded-bun-silhouette'),
      'surface-ribbon-bun-detail',
      'cross-character-head-fit',
      'medium-shot-quality-tier',
    ],
    artifacts: [
      ...asset.artifacts.map(({ role, path, mediaType }) => ({ role, path, mediaType })),
      ...evidenceArtifacts,
    ],
    verification: {
      checks: [
        ...asset.verification.checks.filter((check) => !check.endsWith('-generated-not-accepted')),
        'visual.fitted-canonical-views-accepted',
        'visual.continuous-scalp-and-flow-accepted',
        'visual.unrelated-character-transfer-accepted',
        'hair.medium-shot-distance-accepted',
      ],
      artifacts: [
        'verification/isolated/contact-sheet.png',
        'verification/fitted/contact-sheet.png',
        'verification/fitted/scene-render.json',
        ...evidenceArtifacts.map((artifact) => artifact.path),
      ],
      verifiedAt: review.reviewedAt,
    },
  } satisfies AssetMetadata;
  return writeHashedAssetMetadata(join(directory, 'asset.yaml'), metadata);
}
