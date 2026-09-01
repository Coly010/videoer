import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  assetMetadataSchema,
  loadAssetMetadata,
  sha256File,
  writeHashedAssetMetadata,
  type AssetMetadata,
} from '../assets/library.js';
import { projectingCanopyCandidateReviewSchema } from '../environments/architectural-review.js';
import { loadGeometry } from '../geometry/io.js';
import { validateGeometry, type GeometryAsset } from '../geometry/model.js';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

function renderEvidencePass(report: Record<string, unknown>) {
  const required = new Set([
    'renderer-camera-contract',
    'canopy-scene-visible',
    'canopy-highlight-detail',
    'canopy-framing',
    'canopy-local-highlight-detail',
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

export function canopySlateComponentCount(geometry: GeometryAsset) {
  const slateGroups = geometry.materialGroups.filter(
    (group) => group.materialId === 'canopy-slate',
  );
  let componentCount = 0;
  const key = (vertex: number) =>
    geometry.positions[vertex]!.map((value) => value.toFixed(8)).join(',');
  for (const group of slateGroups) {
    const adjacency = new Map<string, Set<string>>();
    for (let offset = group.start; offset < group.start + group.count; offset += 3) {
      const triangle = [
        key(geometry.indices[offset]!),
        key(geometry.indices[offset + 1]!),
        key(geometry.indices[offset + 2]!),
      ];
      for (const vertex of triangle) {
        const neighbours = adjacency.get(vertex) ?? new Set<string>();
        for (const other of triangle) if (other !== vertex) neighbours.add(other);
        adjacency.set(vertex, neighbours);
      }
    }
    const unseen = new Set(adjacency.keys());
    while (unseen.size) {
      const first = unseen.values().next().value as string;
      const stack = [first];
      unseen.delete(first);
      while (stack.length) {
        const vertex = stack.pop()!;
        for (const neighbour of adjacency.get(vertex) ?? [])
          if (unseen.delete(neighbour)) stack.push(neighbour);
      }
      componentCount++;
    }
  }
  return componentCount;
}

async function distinctLandmarkHashes(directory: string) {
  const files = ['000-elevated-roof.png', '050-underside-support.png', '100-left-context.png'];
  const hashes = await Promise.all(files.map((file) => sha256File(join(directory, file))));
  if (new Set(hashes).size !== files.length)
    throw new Error(
      `Projecting-canopy transfer '${directory}' lacks three distinct landmark frames`,
    );
  return hashes;
}

export async function acceptProjectingSupportedCanopy(outputDirectory: string) {
  const output = resolve(outputDirectory);
  const [asset, geometry, persistedConstruction, review] = await Promise.all([
    loadAssetMetadata(join(output, 'asset.yaml')),
    loadGeometry(join(output, 'geometry.json')),
    json(join(output, 'construction-contract.json')),
    json(join(output, 'verification', 'projecting-canopy-candidate-review.json')).then((value) =>
      projectingCanopyCandidateReviewSchema.parse(value),
    ),
  ]);
  if (asset.type !== 'prop' || asset.status !== 'validated')
    throw new Error('Projecting-canopy acceptance requires a validated prop candidate');
  if (review.assetId !== asset.id || review.decision !== 'accepted')
    throw new Error(`Projecting-canopy review does not accept '${asset.id}'`);
  if (geometry.id !== asset.id || !validateGeometry(geometry).valid)
    throw new Error('Projecting-canopy geometry is invalid or does not match asset identity');
  const construction = geometry.metadata.construction as Record<string, unknown> | undefined;
  const drainage = geometry.metadata.roofDrainage as Record<string, unknown> | undefined;
  if (
    !construction ||
    !drainage ||
    JSON.stringify({ roofDrainage: drainage, construction }) !==
      JSON.stringify(persistedConstruction) ||
    construction.layeredRoof !== true ||
    construction.covering !== 'slate' ||
    construction.structuralDeck !== 'timber' ||
    construction.flashing !== 'metal' ||
    typeof construction.roofTileCount !== 'number' ||
    typeof construction.soffitSlatCount !== 'number' ||
    typeof construction.bracketCount !== 'number'
  )
    throw new Error('Projecting canopy lacks a valid persisted layered-construction contract');
  if (canopySlateComponentCount(geometry) < construction.roofTileCount + 1)
    throw new Error(
      'Projecting canopy does not contain the declared independent physical slate inventory plus underlay',
    );
  if (
    drainage.kind !== 'single-fall-projecting-roof' ||
    drainage.dischargeEdge !== 'front' ||
    typeof drainage.fallMeters !== 'number' ||
    typeof drainage.runMeters !== 'number' ||
    typeof drainage.gradient !== 'number' ||
    Math.abs(drainage.gradient - drainage.fallMeters / drainage.runMeters) > 1e-10 ||
    drainage.gradient <= 0
  )
    throw new Error('Projecting canopy has invalid roof-drainage mathematics');
  for (const attachment of [
    'wall-mount-left',
    'wall-mount-centre',
    'wall-mount-right',
    'front-edge-left',
    'front-edge-right',
    'rainwater-mount-left',
    'rainwater-mount-right',
    'underside-practical-left',
    'underside-practical-right',
    'canopy-focus',
  ])
    if (!geometry.attachments[attachment])
      throw new Error(`Projecting canopy lacks '${attachment}' attachment`);
  const hostContract = geometry.metadata.hostContract as Record<string, unknown> | undefined;
  const mountRange = hostContract?.requiredMountHeightMeters as Record<string, unknown> | undefined;
  if (
    !hostContract ||
    hostContract.kind !== 'vertical-facade-canopy-mount' ||
    typeof hostContract.facadePlaneZ !== 'number' ||
    typeof hostContract.requiredClearWallSpanMeters !== 'number' ||
    !mountRange ||
    typeof mountRange.minimum !== 'number' ||
    typeof mountRange.maximum !== 'number' ||
    !hostContract.requiredClearanceVolumeMeters
  )
    throw new Error('Projecting canopy lacks a valid vertical-facade host contract');

  const transferSummaries = [];
  for (const kind of ['old-city-shopfront', 'contemporary-gallery-entrance'] as const) {
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
      typeof host.clearWallSpanMeters !== 'number' ||
      host.clearWallSpanMeters < hostContract.requiredClearWallSpanMeters ||
      typeof host.mountHeightMeters !== 'number' ||
      host.mountHeightMeters < mountRange.minimum ||
      host.mountHeightMeters > mountRange.maximum
    )
      throw new Error(
        `${kind} host does not satisfy canopy span, height, and clearance requirements`,
      );
    if (!renderEvidencePass(render))
      throw new Error(`${kind} transfer render fails declared gates`);
    transferSummaries.push({ kind, exactPortableGeometryReused: true, landmarkHashes: hashes });
  }
  await Promise.all(review.evidence.map((path) => access(join(output, path))));
  const reviewArtifact: AssetMetadata['artifacts'][number] = {
    role: 'qualitative-review',
    path: 'verification/projecting-canopy-candidate-review.json',
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
        'geometry.physical-slate-components-independently-reverified',
        'construction.drainage-mathematics-reverified',
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
