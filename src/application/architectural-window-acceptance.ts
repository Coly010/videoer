import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  assetMetadataSchema,
  loadAssetMetadata,
  sha256File,
  writeHashedAssetMetadata,
  type AssetMetadata,
} from '../assets/library.js';
import { architecturalWindowCandidateReviewSchema } from '../environments/architectural-review.js';
import { loadGeometry } from '../geometry/io.js';
import { validateGeometry, type GeometryAsset } from '../geometry/model.js';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

function renderEvidencePass(report: Record<string, unknown>) {
  const required = new Set([
    'renderer-camera-contract',
    'window-scene-visible',
    'window-highlight-detail',
    'window-framing',
    'window-local-highlight-detail',
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

function triangleIntersectsZSegment(
  originX: number,
  originY: number,
  minimumZ: number,
  maximumZ: number,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
) {
  const edge1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
  const edge2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
  const p = [-edge2[1], edge2[0], 0] as const;
  const determinant = edge1[0] * p[0] + edge1[1] * p[1] + edge1[2] * p[2];
  if (Math.abs(determinant) < 1e-10) return false;
  const inverse = 1 / determinant;
  const t = [originX - a[0], originY - a[1], minimumZ - a[2]] as const;
  const u = (t[0] * p[0] + t[1] * p[1] + t[2] * p[2]) * inverse;
  if (u < 0 || u > 1) return false;
  const q = [
    t[1] * edge1[2] - t[2] * edge1[1],
    t[2] * edge1[0] - t[0] * edge1[2],
    t[0] * edge1[1] - t[1] * edge1[0],
  ] as const;
  const v = q[2] * inverse;
  if (v < 0 || u + v > 1) return false;
  const distance = (edge2[0] * q[0] + edge2[1] * q[1] + edge2[2] * q[2]) * inverse;
  return distance >= -1e-8 && minimumZ + distance <= maximumZ + 1e-8;
}

export function hostWallApertureIsOpen(
  geometry: GeometryAsset,
  opening: { minimumX: number; maximumX: number; minimumY: number; maximumY: number },
  wallThicknessMeters: number,
) {
  const group = geometry.materialGroups.find((candidate) => candidate.materialId === 'host-wall');
  if (!group) return false;
  const x = (opening.minimumX + opening.maximumX) * 0.5;
  const y = (opening.minimumY + opening.maximumY) * 0.5;
  for (let offset = group.start; offset < group.start + group.count; offset += 3) {
    const a = geometry.positions[geometry.indices[offset]!]!;
    const b = geometry.positions[geometry.indices[offset + 1]!]!;
    const c = geometry.positions[geometry.indices[offset + 2]!]!;
    if (triangleIntersectsZSegment(x, y, -0.02, wallThicknessMeters + 0.02, a, b, c)) return false;
  }
  return true;
}

async function distinctLandmarkHashes(directory: string) {
  const files = ['000-right-glancing.png', '050-frontal.png', '100-left-glancing.png'];
  const hashes = await Promise.all(files.map((file) => sha256File(join(directory, file))));
  if (new Set(hashes).size !== files.length)
    throw new Error(
      `Window transfer '${directory}' does not contain three distinct landmark frames`,
    );
  return hashes;
}

export async function acceptInsetArchitecturalWindow(outputDirectory: string) {
  const output = resolve(outputDirectory);
  const [asset, geometry, review] = await Promise.all([
    loadAssetMetadata(join(output, 'asset.yaml')),
    loadGeometry(join(output, 'geometry.json')),
    json(join(output, 'verification', 'window-candidate-review.json')).then((value) =>
      architecturalWindowCandidateReviewSchema.parse(value),
    ),
  ]);
  if (asset.type !== 'prop' || asset.status !== 'validated')
    throw new Error('Window acceptance requires a validated prop candidate');
  if (review.assetId !== asset.id || review.decision !== 'accepted')
    throw new Error(`Window review does not accept '${asset.id}'`);
  if (geometry.id !== asset.id || !validateGeometry(geometry).valid)
    throw new Error('Window geometry is invalid or does not match asset identity');
  for (const attachment of [
    'wall-mount',
    'opening-centre',
    'exterior-focus',
    'interior-focus',
    'sill-top',
  ])
    if (!geometry.attachments[attachment])
      throw new Error(`Window lacks '${attachment}' attachment`);
  const hostContract = geometry.metadata.hostContract as Record<string, unknown> | undefined;
  if (
    !hostContract ||
    hostContract.kind !== 'rectangular-wall-opening' ||
    hostContract.cutoutRequired !== true ||
    typeof hostContract.openingWidthMeters !== 'number' ||
    typeof hostContract.openingHeightMeters !== 'number'
  )
    throw new Error('Window lacks a valid mandatory host-cutout contract');
  if (geometry.metadata.glazingThicknessMeters !== 0.008)
    throw new Error('Window glazing must retain the declared physical 8 mm thickness');

  const transferSummaries = [];
  for (const kind of ['old-city-brick', 'contemporary-plaster'] as const) {
    const directory = join(output, 'verification', kind);
    const [witness, openingReport, render, landmarkHashes] = await Promise.all([
      loadGeometry(join(directory, 'witness-geometry.json')),
      json(join(directory, 'host-opening-report.json')),
      json(join(directory, 'scene-render.json')),
      distinctLandmarkHashes(directory),
    ]);
    const opening = openingReport.opening as {
      minimumX: number;
      maximumX: number;
      minimumY: number;
      maximumY: number;
    };
    const wallThicknessMeters = openingReport.wallThicknessMeters;
    if (
      !opening ||
      typeof wallThicknessMeters !== 'number' ||
      openingReport.cutoutGeneratedBy !== 'wallWithRectangularOpeningsParts' ||
      Math.abs(opening.maximumX - opening.minimumX - (hostContract.openingWidthMeters as number)) >
        1e-8 ||
      Math.abs(opening.maximumY - opening.minimumY - (hostContract.openingHeightMeters as number)) >
        1e-8 ||
      !hostWallApertureIsOpen(witness, opening, wallThicknessMeters)
    )
      throw new Error(`${kind} witness does not contain the required real host aperture`);
    const supported = hostContract.supportedWallThicknessMeters as
      Record<string, unknown> | undefined;
    if (
      !supported ||
      typeof supported.minimum !== 'number' ||
      typeof supported.maximum !== 'number' ||
      wallThicknessMeters < supported.minimum ||
      wallThicknessMeters > supported.maximum
    )
      throw new Error(`${kind} wall thickness is outside the module's supported range`);
    if (!renderEvidencePass(render))
      throw new Error(`${kind} transfer render fails declared gates`);
    transferSummaries.push({ kind, wallThicknessMeters, landmarkHashes, apertureRayClear: true });
  }
  await Promise.all(review.evidence.map((path) => access(join(output, path))));

  const evidenceArtifacts: AssetMetadata['artifacts'] = [
    {
      role: 'qualitative-review',
      path: 'verification/window-candidate-review.json',
      mediaType: 'application/json',
    },
  ];
  const metadata = assetMetadataSchema.parse(asset);
  const result = await writeHashedAssetMetadata(join(output, 'asset.yaml'), {
    ...metadata,
    status: 'verified',
    artifacts: [
      ...metadata.artifacts.map(({ role, path, mediaType }) => ({ role, path, mediaType })),
      ...evidenceArtifacts,
    ],
    capabilities: [...metadata.capabilities, 'medium-background-quality-tier'],
    verification: {
      checks: [
        ...metadata.verification.checks.filter(
          (check) => !check.endsWith('-generated-not-accepted'),
        ),
        'geometry.real-host-aperture-ray-clear',
        'visual.old-city-host-transfer-accepted',
        'visual.contemporary-host-transfer-accepted',
        'module.medium-background-shot-distance-accepted',
      ],
      artifacts: [...metadata.verification.artifacts, 'verification/window-candidate-review.json'],
      verifiedAt: review.reviewedAt,
    },
  });
  return { output, metadataPath: result.metadataPath, transferSummaries };
}
