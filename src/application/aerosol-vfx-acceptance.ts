import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  loadAssetMetadata,
  sha256File,
  writeHashedAssetMetadata,
  type AssetMetadata,
} from '../assets/library.js';
import { loadCinematicScene } from '../cinematic/io.js';
import { loadGeometry } from '../geometry/io.js';
import { createHearthSmokeAndEmbersVfx, resolveAerosolVfx } from '../vfx/aerosol.js';
import { loadAerosolVfx } from '../vfx/io.js';
import { atmosphericVfxCandidateReviewSchema } from '../vfx/review.js';
import { resolveBlenderExecutable } from '../media/blender.js';

const exec = promisify(execFile);

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

function renderEvidencePass(report: Record<string, unknown>) {
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
    )
  );
}

function objectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

async function inspectOpenVdbSequence(directory: string, expectedFrames: number) {
  const blender = await resolveBlenderExecutable();
  const script = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../scripts/blender/inspect_openvdb_sequence.py',
  );
  const { stdout, stderr } = await exec(
    blender,
    ['--background', '--factory-startup', '--python', script, '--', directory],
    { maxBuffer: 20 * 1024 * 1024 },
  );
  const marker = `${stdout}\n${stderr}`
    .split('\n')
    .find((line) => line.startsWith('VIDEOER_OPENVDB_INSPECTION='));
  if (!marker)
    throw new Error(`OpenVDB inspector produced no canonical field report for ${directory}`);
  const report = JSON.parse(marker.slice('VIDEOER_OPENVDB_INSPECTION='.length)) as unknown;
  if (
    !objectRecord(report) ||
    !Array.isArray(report.frames) ||
    report.frames.length !== expectedFrames
  )
    throw new Error(`OpenVDB inspector did not read every frame in ${directory}`);
  const fieldHashes = report.frames.map((frame, index) => {
    if (
      !objectRecord(frame) ||
      typeof frame.file !== 'string' ||
      !frame.file.endsWith(`_${String(index + 1).padStart(4, '0')}.vdb`) ||
      typeof frame.fieldSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(frame.fieldSha256) ||
      !Array.isArray(frame.grids) ||
      frame.grids.length !== 2
    )
      throw new Error(`OpenVDB inspector returned invalid frame ${index + 1} for ${directory}`);
    return frame.fieldSha256;
  });
  return { blenderVersion: report.blenderVersion, fieldHashes };
}

export async function verifySparseSmokeSequence(
  kind: string,
  transfer: string,
  reportLayer: Record<string, unknown>,
  declaredCount: number,
  expectedFrames: number,
) {
  const sequence = reportLayer.volumeSequence;
  if (!objectRecord(sequence)) throw new Error(`${kind} smoke layer lacks an OpenVDB sequence`);
  if (sequence.representation !== 'sparse-openvdb-buoyant-incompressible-v3')
    throw new Error(`${kind} smoke does not use the accepted buoyant OpenVDB backend`);
  if (sequence.sequenceFrames !== expectedFrames)
    throw new Error(`${kind} OpenVDB sequence does not cover every scene frame`);
  if (
    !finiteNumber(sequence.voxelSizeMeters) ||
    sequence.voxelSizeMeters < 0.02 ||
    sequence.voxelSizeMeters > 0.08
  )
    throw new Error(`${kind} OpenVDB voxel size is outside the accepted production range`);
  if (
    !Array.isArray(sequence.gridDimensions) ||
    sequence.gridDimensions.length !== 3 ||
    sequence.gridDimensions.some(
      (dimension) => !Number.isInteger(dimension) || (dimension as number) < 24,
    )
  )
    throw new Error(`${kind} OpenVDB grid dimensions are invalid`);
  if (
    !Number.isInteger(sequence.warmupFrames) ||
    (sequence.warmupFrames as number) < expectedFrames
  )
    throw new Error(`${kind} smoke simulation lacks a complete warmup`);
  if (!Array.isArray(sequence.sourceParcels) || sequence.sourceParcels.length !== declaredCount)
    throw new Error(`${kind} smoke sequence does not retain every declared source parcel`);
  const solver = sequence.solver;
  if (
    !objectRecord(solver) ||
    solver.kind !== 'buoyant-incompressible-grid' ||
    !Number.isInteger(solver.pressureIterations) ||
    (solver.pressureIterations as number) < 8 ||
    !finiteNumber(solver.vorticityConfinement) ||
    solver.vorticityConfinement <= 0 ||
    !finiteNumber(solver.maximumPreProjectionDivergence) ||
    solver.maximumPreProjectionDivergence <= 0 ||
    !finiteNumber(solver.maximumPostProjectionDivergence) ||
    solver.maximumPostProjectionDivergence < 0 ||
    solver.maximumPostProjectionDivergence >= solver.maximumPreProjectionDivergence
  )
    throw new Error(`${kind} smoke solver lacks valid pressure-projection evidence`);
  if (!Array.isArray(sequence.frames) || sequence.frames.length !== expectedFrames)
    throw new Error(`${kind} OpenVDB report lacks every temporal frame`);

  const hashes = new Set<string>();
  const activeVoxelCounts: number[] = [];
  const activeMeans: number[] = [];
  const transferRoot = resolve(transfer);
  for (const [index, value] of sequence.frames.entries()) {
    if (!objectRecord(value) || value.frame !== index + 1 || typeof value.path !== 'string')
      throw new Error(`${kind} OpenVDB frame ledger is not sequential`);
    const framePath = resolve(transferRoot, value.path);
    if (!framePath.startsWith(`${transferRoot}/`))
      throw new Error(`${kind} OpenVDB frame path escapes its transfer directory`);
    if (
      !Number.isInteger(value.densityActiveVoxels) ||
      (value.densityActiveVoxels as number) < 1_000 ||
      !Number.isInteger(value.temperatureActiveVoxels) ||
      (value.temperatureActiveVoxels as number) < 1_000 ||
      !finiteNumber(value.densityMaximum) ||
      value.densityMaximum < 0.05 ||
      value.densityMaximum > 1.5 ||
      !finiteNumber(value.densityMeanActive) ||
      value.densityMeanActive < 0.005 ||
      value.densityMeanActive > 0.5 ||
      typeof value.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.sha256)
    )
      throw new Error(`${kind} OpenVDB frame ${index + 1} has invalid sparse-field evidence`);
    const liveHash = await sha256File(framePath);
    if (liveHash !== value.sha256)
      throw new Error(`${kind} OpenVDB frame ${index + 1} does not match its live file hash`);
    hashes.add(liveHash);
    activeVoxelCounts.push(value.densityActiveVoxels as number);
    activeMeans.push(value.densityMeanActive);
  }
  if (hashes.size !== expectedFrames)
    throw new Error(`${kind} OpenVDB sequence does not change on every frame`);
  const activeVoxelRange = Math.max(...activeVoxelCounts) - Math.min(...activeVoxelCounts);
  if (activeVoxelRange < Math.max(100, Math.min(...activeVoxelCounts) * 0.01))
    throw new Error(`${kind} smoke volume lacks meaningful temporal topology variation`);
  const activeMeanRange = Math.max(...activeMeans) - Math.min(...activeMeans);
  if (activeMeanRange < 0.0001)
    throw new Error(`${kind} smoke density lacks meaningful temporal variation`);
  return {
    representation: sequence.representation,
    voxelSizeMeters: sequence.voxelSizeMeters,
    gridDimensions: sequence.gridDimensions,
    frameCount: expectedFrames,
    distinctFrameHashes: hashes.size,
    frameHashes: [...hashes],
    activeVoxelRange,
    activeMeanRange,
    solver,
  };
}

export async function acceptSourceBoundAerosolVfxAsset(assetDirectory: string) {
  const directory = resolve(assetDirectory);
  const [asset, vfx, review] = await Promise.all([
    loadAssetMetadata(join(directory, 'asset.yaml')),
    loadAerosolVfx(join(directory, 'vfx.json')),
    json(join(directory, 'verification', 'vfx-candidate-review.json')).then((value) =>
      atmosphericVfxCandidateReviewSchema.parse(value),
    ),
  ]);
  if (asset.type !== 'vfx' || asset.status !== 'validated')
    throw new Error('Aerosol VFX acceptance requires a validated VFX candidate');
  if (asset.id !== vfx.id || review.assetId !== vfx.id)
    throw new Error('Aerosol VFX asset, definition and review identities do not match');
  if (review.decision !== 'accepted') throw new Error(`Aerosol review rejected '${vfx.id}'`);
  if (JSON.stringify(vfx) !== JSON.stringify(createHearthSmokeAndEmbersVfx()))
    throw new Error('Persisted aerosol definition does not match deterministic regeneration');
  await Promise.all(review.evidence.map((path) => access(join(directory, path))));

  const transferSummaries = [];
  const sourceGeometryIds = new Set<string>();
  for (const kind of ['historic-forge', 'contemporary-metal-shop'] as const) {
    const transfer = join(directory, 'verification', kind);
    const [scene, sourceGeometry, render, aerosolReport, landmarkHashes] = await Promise.all([
      loadCinematicScene(join(transfer, 'scene.json')),
      loadGeometry(join(transfer, 'source-geometry.json')),
      json(join(transfer, 'scene-render.json')),
      json(join(transfer, 'aerosol-report.json')),
      Promise.all(
        ['000-right-context.png', '050-frontal-plume.png', '100-left-context.png'].map((file) =>
          sha256File(join(transfer, file)),
        ),
      ),
    ]);
    if (sourceGeometryIds.has(sourceGeometry.id))
      throw new Error('Aerosol transfer evidence reuses the same source geometry identity');
    sourceGeometryIds.add(sourceGeometry.id);
    const sourceEntity = scene.entities.find((entity) => entity.id === 'aerosol-source');
    if (!sourceEntity || sourceEntity.geometryPath !== join(transfer, 'source-geometry.json'))
      throw new Error(`${kind} scene does not bind its declared source geometry`);
    const expected = resolveAerosolVfx(vfx, {
      entityId: sourceEntity.id,
      geometry: sourceGeometry,
      attachmentId: 'aerosol-origin',
      transform: sourceEntity.transform,
    });
    if (JSON.stringify(expected) !== JSON.stringify(scene.atmosphere.aerosols))
      throw new Error(
        `${kind} persisted aerosol placement does not match live attachment resolution`,
      );
    if (new Set(landmarkHashes).size !== 3)
      throw new Error(`${kind} aerosol evidence does not contain three distinct landmark frames`);
    if (!renderEvidencePass(render)) throw new Error(`${kind} aerosol render fails declared gates`);
    if (!Array.isArray(aerosolReport.layers) || aerosolReport.layers.length !== vfx.layers.length)
      throw new Error(`${kind} aerosol backend report lacks every declared layer`);
    let smokeSequenceSummary: Awaited<ReturnType<typeof verifySparseSmokeSequence>> | undefined;
    for (const layer of vfx.layers) {
      const reportLayer = aerosolReport.layers.find(
        (value) =>
          typeof value === 'object' &&
          value !== null &&
          'layerId' in value &&
          value.layerId === layer.id,
      );
      if (
        !reportLayer ||
        !('kind' in reportLayer) ||
        reportLayer.kind !== layer.kind ||
        !('seed' in reportLayer) ||
        reportLayer.seed !== layer.seed ||
        !('generatedCount' in reportLayer) ||
        reportLayer.generatedCount !== layer.count ||
        !('declaredCount' in reportLayer) ||
        reportLayer.declaredCount !== layer.count ||
        !('particles' in reportLayer) ||
        !Array.isArray(reportLayer.particles) ||
        reportLayer.particles.length !== layer.count
      )
        throw new Error(`${kind} backend report does not reproduce aerosol layer '${layer.id}'`);
      if (layer.kind === 'smoke-volume')
        smokeSequenceSummary = await verifySparseSmokeSequence(
          kind,
          transfer,
          reportLayer as Record<string, unknown>,
          layer.count,
          Math.round(scene.durationSeconds * scene.fps),
        );
    }
    if (!smokeSequenceSummary) throw new Error(`${kind} backend report lacks smoke evidence`);
    const liveFieldInspection = await inspectOpenVdbSequence(
      join(transfer, 'aerosol-vdb', 'smoke-body'),
      Math.round(scene.durationSeconds * scene.fps),
    );
    transferSummaries.push({
      kind,
      sceneId: scene.id,
      sourceGeometryAssetId: sourceGeometry.id,
      landmarkHashes,
      layerCounts: Object.fromEntries(vfx.layers.map((layer) => [layer.id, layer.count])),
      smokeSequence: smokeSequenceSummary,
      liveFieldInspection,
    });
  }
  const [historicTransfer, contemporaryTransfer] = transferSummaries;
  if (
    !historicTransfer ||
    !contemporaryTransfer ||
    JSON.stringify(historicTransfer.liveFieldInspection.fieldHashes) !==
      JSON.stringify(contemporaryTransfer.liveFieldInspection.fieldHashes)
  )
    throw new Error('Aerosol transfer hosts do not reproduce the same deterministic VDB fields');

  const evidenceArtifacts: AssetMetadata['artifacts'] = [
    ...(['historic-forge', 'contemporary-metal-shop'] as const).flatMap((kind) => [
      {
        role: `${kind}-accepted-contact-sheet`,
        path: `verification/${kind}/contact-sheet.png`,
        mediaType: 'image/png',
      },
      {
        role: `${kind}-accepted-render-report`,
        path: `verification/${kind}/scene-render.json`,
        mediaType: 'application/json',
      },
      {
        role: `${kind}-accepted-aerosol-report`,
        path: `verification/${kind}/aerosol-report.json`,
        mediaType: 'application/json',
      },
    ]),
    {
      role: 'qualitative-review',
      path: 'verification/vfx-candidate-review.json',
      mediaType: 'application/json',
    },
  ];
  const metadata: AssetMetadata = {
    ...asset,
    status: 'verified',
    artifacts: [
      ...asset.artifacts.map(({ role, path, mediaType }) => ({ role, path, mediaType })),
      ...evidenceArtifacts,
    ],
    verification: {
      checks: [
        ...asset.verification.checks.filter((check) => !check.endsWith('-generated-not-accepted')),
        'vfx.live-source-attachment-regeneration-accepted',
        'vfx.backend-layer-count-and-seed-accepted',
        'vfx.sparse-openvdb-buoyant-incompressible-sequence-accepted',
        'vfx.openvdb-live-frame-hashes-and-temporal-variation-accepted',
        'vfx.openvdb-cross-host-sequence-identity-accepted',
        'vfx.openvdb-live-canonical-field-inspection-accepted',
        'visual.historic-forge-world-space-volume-accepted',
        'visual.contemporary-metal-shop-world-space-volume-accepted',
        'visual.medium-shot-aerosol-quality-tier-accepted',
      ],
      artifacts: evidenceArtifacts.map((artifact) => artifact.path),
      verifiedAt: review.reviewedAt,
    },
  };
  const accepted = await writeHashedAssetMetadata(join(directory, 'asset.yaml'), metadata);
  return { output: directory, metadata: accepted, transferSummaries };
}
