import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  assetMetadataSchema,
  loadAssetMetadata,
  sha256File,
  writeHashedAssetMetadata,
  type AssetMetadata,
} from '../assets/library.js';
import { projectingSignCandidateReviewSchema } from '../environments/architectural-review.js';
import { loadGeometry } from '../geometry/io.js';
import { validateGeometry, type GeometryAsset } from '../geometry/model.js';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

function renderEvidencePass(report: Record<string, unknown>) {
  const required = new Set([
    'renderer-camera-contract',
    'sign-scene-visible',
    'sign-highlight-detail',
    'sign-framing',
    'sign-local-highlight-detail',
  ]);
  if (
    typeof report.verification !== 'object' ||
    report.verification === null ||
    !('status' in report.verification) ||
    report.verification.status !== 'pass' ||
    !Array.isArray(report.frames) ||
    report.frames.length !== 3 ||
    !Array.isArray(report.renderChecks)
  )
    return false;
  for (const check of report.renderChecks) {
    if (
      typeof check !== 'object' ||
      check === null ||
      !('id' in check) ||
      typeof check.id !== 'string' ||
      !('status' in check) ||
      check.status !== 'pass'
    )
      return false;
    required.delete(check.id);
  }
  return required.size === 0;
}

export function projectingSignHasTwoPhysicalContentFaces(geometry: GeometryAsset) {
  const groups = geometry.materialGroups.filter((group) => group.materialId === 'sign-emblem-page');
  if (groups.length !== 2) return false;
  const faceX: number[] = [];
  for (const group of groups) {
    const vertices = new Set<number>();
    for (let offset = group.start; offset < group.start + group.count; offset++)
      vertices.add(geometry.indices[offset]!);
    if (vertices.size < 8) return false;
    const positions = [...vertices].map((vertex) => geometry.positions[vertex]!);
    const xs = positions.map((position) => position[0]);
    if (Math.max(...xs) - Math.min(...xs) > 1e-7) return false;
    if (
      Math.min(...positions.map((position) => position[1])) < -0.71 ||
      Math.max(...positions.map((position) => position[1])) > -0.38 ||
      Math.min(...positions.map((position) => position[2])) < -0.88 ||
      Math.max(...positions.map((position) => position[2])) > -0.48
    )
      return false;
    faceX.push(xs[0]!);
  }
  return faceX.some((x) => x < -0.035) && faceX.some((x) => x > 0.035);
}

async function distinctLandmarkHashes(directory: string) {
  const files = ['000-front-face.png', '050-mount-context.png', '100-back-face.png'];
  const hashes = await Promise.all(files.map((file) => sha256File(join(directory, file))));
  if (new Set(hashes).size !== files.length)
    throw new Error(`Projecting-sign transfer '${directory}' lacks three distinct landmark frames`);
  return hashes;
}

export async function acceptProjectingHangingSign(outputDirectory: string) {
  const output = resolve(outputDirectory);
  const [asset, geometry, persistedContent, review] = await Promise.all([
    loadAssetMetadata(join(output, 'asset.yaml')),
    loadGeometry(join(output, 'geometry.json')),
    json(join(output, 'content-contract.json')),
    json(join(output, 'verification', 'projecting-sign-candidate-review.json')).then((value) =>
      projectingSignCandidateReviewSchema.parse(value),
    ),
  ]);
  if (asset.type !== 'prop' || asset.status !== 'validated')
    throw new Error('Projecting-sign acceptance requires a validated prop candidate');
  if (review.assetId !== asset.id || review.decision !== 'accepted')
    throw new Error(`Projecting-sign review does not accept '${asset.id}'`);
  if (geometry.id !== asset.id || !validateGeometry(geometry).valid)
    throw new Error('Projecting-sign geometry is invalid or does not match asset identity');
  if (!projectingSignHasTwoPhysicalContentFaces(geometry))
    throw new Error(
      'Projecting sign does not contain bounded physical content geometry on both faces',
    );
  const content = geometry.metadata.contentContract as Record<string, unknown> | undefined;
  if (
    !content ||
    JSON.stringify(content) !== JSON.stringify(persistedContent) ||
    content.kind !== 'replaceable-two-sided-sign-face' ||
    content.campaignMayReplaceFaceTreatment !== true ||
    content.hardwareMustRemainIndependent !== true
  )
    throw new Error('Projecting sign lacks a valid persisted replaceable-content contract');
  for (const attachment of [
    'wall-mount',
    'wall-mount-upper',
    'wall-mount-lower',
    'hanging-pivot-left',
    'hanging-pivot-right',
    'sign-face-front',
    'sign-face-back',
    'content-centre',
    'sign-focus',
  ])
    if (!geometry.attachments[attachment])
      throw new Error(`Projecting sign lacks '${attachment}' attachment`);
  const front = geometry.attachments['sign-face-front']!;
  const back = geometry.attachments['sign-face-back']!;
  if (!(
    front.position[0] < 0 &&
    back.position[0] > 0 &&
    Math.abs(front.position[0] + back.position[0]) < 1e-8
  ))
    throw new Error('Projecting-sign face attachments are not physically opposed');
  const hostContract = geometry.metadata.hostContract as Record<string, unknown> | undefined;
  const mountRange = hostContract?.requiredMountHeightMeters as Record<string, unknown> | undefined;
  if (
    !hostContract ||
    hostContract.kind !== 'vertical-facade-mount' ||
    typeof hostContract.facadePlaneZ !== 'number' ||
    !mountRange ||
    typeof mountRange.minimum !== 'number' ||
    typeof mountRange.maximum !== 'number' ||
    !hostContract.requiredClearanceVolumeMeters
  )
    throw new Error('Projecting sign lacks a valid vertical-facade host contract');

  const transferSummaries = [];
  for (const kind of ['old-city-bookshop', 'adaptive-reuse-cafe'] as const) {
    const directory = join(output, 'verification', kind);
    const [report, render, hashes] = await Promise.all([
      json(join(directory, 'host-contract-report.json')),
      json(join(directory, 'scene-render.json')),
      distinctLandmarkHashes(directory),
    ]);
    const host = report.host as Record<string, unknown> | undefined;
    if (
      report.exactPortableGeometryReused !== true ||
      !host ||
      host.kind !== hostContract.kind ||
      host.facadePlaneZ !== hostContract.facadePlaneZ ||
      host.clearanceVolumeAvailable !== true ||
      typeof host.mountHeightMeters !== 'number' ||
      host.mountHeightMeters < mountRange.minimum ||
      host.mountHeightMeters > mountRange.maximum
    )
      throw new Error(`${kind} host does not satisfy the sign's mounting and clearance contract`);
    if (!renderEvidencePass(render))
      throw new Error(`${kind} transfer render fails declared gates`);
    transferSummaries.push({ kind, exactPortableGeometryReused: true, landmarkHashes: hashes });
  }
  await Promise.all(review.evidence.map((path) => access(join(output, path))));

  const reviewArtifact: AssetMetadata['artifacts'][number] = {
    role: 'qualitative-review',
    path: 'verification/projecting-sign-candidate-review.json',
    mediaType: 'application/json',
  };
  const metadata = assetMetadataSchema.parse(asset);
  const result = await writeHashedAssetMetadata(join(output, 'asset.yaml'), {
    ...metadata,
    status: 'verified',
    artifacts: [
      ...metadata.artifacts.map(({ role, path, mediaType }) => ({ role, path, mediaType })),
      reviewArtifact,
    ],
    capabilities: [...metadata.capabilities, 'medium-background-quality-tier'],
    verification: {
      checks: [
        ...metadata.verification.checks.filter(
          (check) => !check.endsWith('-generated-not-accepted'),
        ),
        'geometry.two-physical-content-faces-independently-reverified',
        'visual.old-city-host-transfer-accepted',
        'visual.adaptive-reuse-host-transfer-accepted',
        'module.medium-background-shot-distance-accepted',
      ],
      artifacts: [...metadata.verification.artifacts, reviewArtifact.path],
      verifiedAt: review.reviewedAt,
    },
  });
  return { output, metadataPath: result.metadataPath, transferSummaries };
}
