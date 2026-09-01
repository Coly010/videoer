import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  assetMetadataSchema,
  loadAssetMetadata,
  sha256File,
  writeHashedAssetMetadata,
  type AssetMetadata,
} from '../assets/library.js';
import { architecturalRainwaterCandidateReviewSchema } from '../environments/architectural-review.js';
import { loadGeometry } from '../geometry/io.js';
import { validateGeometry, type GeometryAsset } from '../geometry/model.js';
import { surfaceMaterialSchema } from '../materials/model.js';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

function renderEvidencePass(report: Record<string, unknown>) {
  const required = new Set([
    'renderer-camera-contract',
    'rainwater-scene-visible',
    'rainwater-highlight-detail',
    'rainwater-framing',
    'rainwater-local-highlight-detail',
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

export function rainwaterTroughIsOpen(geometry: GeometryAsset) {
  const parameters = geometry.metadata.parameters as Record<string, unknown> | undefined;
  if (
    !parameters ||
    typeof parameters.eaveHeight !== 'number' ||
    typeof parameters.gutterRadius !== 'number' ||
    typeof parameters.span !== 'number'
  )
    return false;
  const contract = geometry.metadata.hostContract as Record<string, unknown> | undefined;
  if (!contract || typeof contract.facadePlaneZ !== 'number') return false;
  const eaveHeight = parameters.eaveHeight;
  const gutterRadius = parameters.gutterRadius;
  const centreZ = contract.facadePlaneZ - gutterRadius - 0.055;
  const innerRadius = gutterRadius - Math.max(0.006, gutterRadius * 0.065);
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    const triangle = [
      geometry.positions[geometry.indices[offset]!]!,
      geometry.positions[geometry.indices[offset + 1]!]!,
      geometry.positions[geometry.indices[offset + 2]!]!,
    ];
    if (!triangle.every((position) => Math.abs(position[1] - eaveHeight) < 1e-7)) continue;
    const z = triangle.map((position) => position[2]);
    if (
      Math.min(...z) < centreZ - innerRadius * 0.75 &&
      Math.max(...z) > centreZ + innerRadius * 0.75
    )
      return false;
  }
  return true;
}

async function distinctLandmarkHashes(directory: string) {
  const files = ['000-right-context.png', '050-frontal-system.png', '100-left-context.png'];
  const hashes = await Promise.all(files.map((file) => sha256File(join(directory, file))));
  if (new Set(hashes).size !== files.length)
    throw new Error(
      `Rainwater transfer '${directory}' does not contain three distinct landmark frames`,
    );
  return hashes;
}

export async function acceptArchitecturalRainwaterAsset(outputDirectory: string) {
  const output = resolve(outputDirectory);
  const [asset, geometry, surface, review] = await Promise.all([
    loadAssetMetadata(join(output, 'asset.yaml')),
    loadGeometry(join(output, 'geometry.json')),
    json(join(output, 'surface.json')).then((value) => surfaceMaterialSchema.parse(value)),
    json(join(output, 'verification', 'rainwater-candidate-review.json')).then((value) =>
      architecturalRainwaterCandidateReviewSchema.parse(value),
    ),
  ]);
  if (asset.type !== 'prop' || asset.status !== 'validated')
    throw new Error('Rainwater acceptance requires a validated prop candidate');
  if (review.assetId !== asset.id || review.decision !== 'accepted')
    throw new Error(`Rainwater review does not accept '${asset.id}'`);
  if (geometry.id !== asset.id || !validateGeometry(geometry).valid)
    throw new Error('Rainwater geometry is invalid or does not match asset identity');
  if (!rainwaterTroughIsOpen(geometry))
    throw new Error('Rainwater gutter aperture is bridged or cannot be structurally proven open');
  const embeddedSurface = geometry.materials.find(
    (candidate) => candidate.id === 'patinated-rainwater-metal',
  )?.surface;
  if (!embeddedSurface || JSON.stringify(embeddedSurface) !== JSON.stringify(surface))
    throw new Error(
      'Rainwater geometry does not embed the persisted patinated-metal surface definition',
    );
  if (
    surface.metallic < 0.65 ||
    !surface.weathering?.verticalStreaks ||
    !surface.weathering.surfaceDirt
  )
    throw new Error(
      'Rainwater surface lacks the required metallic and metre-scaled weathering semantics',
    );
  for (const attachment of [
    'eave-left',
    'eave-right',
    'wall-mount-upper',
    'wall-mount-lower',
    'downpipe-outlet',
    'exterior-focus',
  ])
    if (!geometry.attachments[attachment])
      throw new Error(`Rainwater system lacks '${attachment}' attachment`);
  const contract = geometry.metadata.hostContract as Record<string, unknown> | undefined;
  if (
    !contract ||
    contract.kind !== 'facade-eave-span' ||
    contract.requiresContinuousMountingSurface !== true ||
    typeof contract.minimumClearSpanMeters !== 'number' ||
    typeof contract.eaveHeightMeters !== 'number' ||
    typeof contract.facadePlaneZ !== 'number'
  )
    throw new Error('Rainwater system lacks a valid facade/eave host contract');

  const transferSummaries = [];
  for (const kind of ['old-city-plaster', 'contemporary-concrete'] as const) {
    const directory = join(output, 'verification', kind);
    const [report, render, landmarkHashes] = await Promise.all([
      json(join(directory, 'host-contract-report.json')),
      json(join(directory, 'scene-render.json')),
      distinctLandmarkHashes(directory),
    ]);
    const host = report.host as Record<string, unknown> | undefined;
    if (
      report.exactPortableGeometryReused !== true ||
      !host ||
      typeof host.clearSpanMeters !== 'number' ||
      host.clearSpanMeters < contract.minimumClearSpanMeters ||
      host.eaveHeightMeters !== contract.eaveHeightMeters ||
      host.facadePlaneZ !== contract.facadePlaneZ ||
      host.continuousMountingSurface !== true
    )
      throw new Error(`${kind} host does not satisfy the persisted rainwater mounting contract`);
    if (!renderEvidencePass(render))
      throw new Error(`${kind} transfer render fails declared gates`);
    transferSummaries.push({ kind, exactPortableGeometryReused: true, landmarkHashes });
  }
  await Promise.all(review.evidence.map((path) => access(join(output, path))));

  const reviewArtifact: AssetMetadata['artifacts'][number] = {
    role: 'qualitative-review',
    path: 'verification/rainwater-candidate-review.json',
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
        'geometry.open-trough-independently-reverified',
        'visual.old-city-host-transfer-accepted',
        'visual.contemporary-host-transfer-accepted',
        'module.medium-background-shot-distance-accepted',
      ],
      artifacts: [...metadata.verification.artifacts, reviewArtifact.path],
      verifiedAt: review.reviewedAt,
    },
  });
  return { output, metadataPath: result.metadataPath, transferSummaries };
}
