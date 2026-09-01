import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  loadAssetMetadata,
  writeHashedAssetMetadata,
  type AssetMetadata,
} from '../assets/library.js';
import { loadPracticalFixture } from '../fixtures/io.js';
import { portableFixtureCandidateReviewSchema } from '../fixtures/review.js';
import { loadGeometry } from '../geometry/io.js';

function parseJson(path: string) {
  return readFile(path, 'utf8').then((value) => JSON.parse(value) as Record<string, unknown>);
}

export function probeEvidencePass(report: Record<string, unknown>) {
  const verification = report.verification;
  const frames = report.frames;
  const landmarkProbePass =
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
        frame.blackPercentage <= 72 &&
        'whitePercentage' in frame &&
        typeof frame.whitePercentage === 'number' &&
        frame.whitePercentage <= 7,
    );
  const renderChecks = report.renderChecks;
  const temporalRenderPass =
    typeof verification === 'object' &&
    verification !== null &&
    'status' in verification &&
    verification.status === 'pass' &&
    Array.isArray(frames) &&
    frames.length >= 3 &&
    Array.isArray(renderChecks) &&
    renderChecks.length >= 3 &&
    renderChecks.every(
      (check) =>
        typeof check === 'object' && check !== null && 'status' in check && check.status === 'pass',
    );
  return landmarkProbePass || temporalRenderPass;
}

type FixtureEmitter = Awaited<ReturnType<typeof loadPracticalFixture>>['emitters'][number];

export function temporalModulationEvidencePass(
  report: Record<string, unknown>,
  emitter: FixtureEmitter,
) {
  const modulation = emitter.temporalModulation;
  if (!modulation) return false;
  if (report.schemaVersion !== 1 || !Number.isInteger(report.frameCount)) return false;
  const frameCount = report.frameCount as number;
  if (frameCount < 12 || !Array.isArray(report.emitters)) return false;
  const evidence = report.emitters.find(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      'emitterId' in value &&
      value.emitterId === emitter.id,
  );
  if (!evidence || typeof evidence !== 'object') return false;
  const value = evidence as Record<string, unknown>;
  if (
    value.kind !== modulation.kind ||
    value.seed !== modulation.seed ||
    value.frequencyHz !== modulation.frequencyHz ||
    (modulation.kind === 'seeded-electrical-instability' &&
      value.dropoutProbability !== modulation.dropoutProbability) ||
    (value.visibleSourceMaterialId ?? undefined) !== emitter.visibleSourceMaterialId ||
    !Array.isArray(value.samples) ||
    value.samples.length !== frameCount
  )
    return false;

  let sourceRatio: number | undefined;
  let minimumMultiplier = Infinity;
  let maximumMultiplier = -Infinity;
  for (const [index, sample] of value.samples.entries()) {
    if (typeof sample !== 'object' || sample === null) return false;
    const row = sample as Record<string, unknown>;
    const multiplier = row.intensityMultiplier;
    const power = row.powerWatts;
    const kelvin = row.colorTemperatureKelvin;
    const source = row.sourceEmissionStrength;
    const lightColor = row.lightColor;
    if (
      row.frame !== index + 1 ||
      typeof multiplier !== 'number' ||
      typeof power !== 'number' ||
      (modulation.kind === 'seeded-flicker' && typeof kelvin !== 'number') ||
      (emitter.visibleSourceMaterialId !== undefined && typeof source !== 'number') ||
      (emitter.visibleSourceMaterialId === undefined && source !== null) ||
      !Number.isFinite(multiplier) ||
      !Number.isFinite(power) ||
      (typeof kelvin === 'number' && !Number.isFinite(kelvin)) ||
      (typeof source === 'number' && !Number.isFinite(source)) ||
      (modulation.kind === 'seeded-electrical-instability' &&
        (!Array.isArray(lightColor) ||
          lightColor.length !== 3 ||
          lightColor.some(
            (channel, channelIndex) =>
              typeof channel !== 'number' ||
              Math.abs(channel - emitter.color[channelIndex]!) > 1e-6,
          ))) ||
      multiplier < modulation.intensityMinimumMultiplier - 1e-6 ||
      multiplier > modulation.intensityMaximumMultiplier + 1e-6 ||
      (modulation.kind === 'seeded-flicker' &&
        (kelvin as number) < modulation.colorTemperatureMinimumKelvin - 1e-6) ||
      (modulation.kind === 'seeded-flicker' &&
        (kelvin as number) > modulation.colorTemperatureMaximumKelvin + 1e-6) ||
      Math.abs(power - emitter.powerWatts * multiplier) > 1e-3
    )
      return false;
    if (typeof source === 'number') {
      const ratio = source / multiplier;
      if (sourceRatio === undefined) sourceRatio = ratio;
      else if (Math.abs(ratio - sourceRatio) > 1e-5) return false;
    }
    minimumMultiplier = Math.min(minimumMultiplier, multiplier);
    maximumMultiplier = Math.max(maximumMultiplier, multiplier);
  }
  return maximumMultiplier - minimumMultiplier >= 0.05;
}

export async function acceptPortableFixtureCandidate(assetDirectory: string) {
  const directory = resolve(assetDirectory);
  const asset = await loadAssetMetadata(join(directory, 'asset.yaml'));
  if (asset.type !== 'prop' || asset.status !== 'validated')
    throw new Error('Fixture acceptance requires a validated prop candidate');
  const [review, fixture, geometry, facade, warehouse, modulation] = await Promise.all([
    parseJson(join(directory, 'verification', 'fixture-candidate-review.json')).then((value) =>
      portableFixtureCandidateReviewSchema.parse(value),
    ),
    loadPracticalFixture(join(directory, 'fixture.json')),
    loadGeometry(join(directory, 'geometry.json')),
    parseJson(join(directory, 'verification', 'facade', 'scene-render.json')),
    parseJson(join(directory, 'verification', 'warehouse', 'scene-probe.json')),
    parseJson(join(directory, 'verification', 'facade', 'fixture-modulation-report.json')),
  ]);
  if (review.assetId !== asset.id || review.fixtureId !== fixture.id)
    throw new Error('Fixture review identity does not match the candidate');
  if (review.decision !== 'accepted') throw new Error(`Fixture review rejected '${asset.id}'`);
  if (fixture.geometryAssetId !== geometry.id || fixture.mountAttachmentId === '')
    throw new Error('Fixture geometry or mount binding is invalid');
  if (!geometry.attachments?.[fixture.mountAttachmentId])
    throw new Error(`Fixture mount '${fixture.mountAttachmentId}' is absent from geometry`);
  if (!probeEvidencePass(facade)) throw new Error('Facade fixture probe fails visual limits');
  if (!probeEvidencePass(warehouse)) throw new Error('Warehouse fixture probe fails visual limits');
  const modulatedEmitters = fixture.emitters.filter((emitter) => emitter.temporalModulation);
  if (
    modulatedEmitters.length === 0 ||
    modulatedEmitters.some((emitter) => !temporalModulationEvidencePass(modulation, emitter))
  )
    throw new Error('Fixture temporal modulation evidence is invalid');
  await Promise.all(review.evidence.map((path) => access(join(directory, path))));

  const evidenceArtifacts: AssetMetadata['artifacts'] = [
    {
      role: 'facade-contact-sheet',
      path: 'verification/facade/contact-sheet.png',
      mediaType: 'image/png',
    },
    {
      role: 'facade-temporal-render-report',
      path: 'verification/facade/scene-render.json',
      mediaType: 'application/json',
    },
    {
      role: 'facade-temporal-preview',
      path:
        asset.artifacts.find((artifact) => artifact.role === 'temporal-preview')?.path ??
        'verification/facade/wall-lantern-facade-probe.mp4',
      mediaType: 'video/mp4',
    },
    {
      role: 'fixture-modulation-report',
      path: 'verification/facade/fixture-modulation-report.json',
      mediaType: 'application/json',
    },
    {
      role: 'warehouse-transfer-contact-sheet',
      path: 'verification/warehouse/contact-sheet.png',
      mediaType: 'image/png',
    },
    {
      role: 'warehouse-transfer-probe-report',
      path: 'verification/warehouse/scene-probe.json',
      mediaType: 'application/json',
    },
    {
      role: 'qualitative-review',
      path: 'verification/fixture-candidate-review.json',
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
    capabilities: [...asset.capabilities, 'medium-background-quality-tier'],
    verification: {
      checks: [
        ...asset.verification.checks.filter((check) => !check.endsWith('-generated-not-accepted')),
        'visual.facade-geometry-light-pool-accepted',
        'visual.unrelated-warehouse-transfer-accepted',
        'fixture.medium-background-shot-distance-accepted',
        'fixture.seeded-temporal-modulation-accepted',
        'fixture.visible-source-and-useful-light-shared-signal-accepted',
      ],
      artifacts: evidenceArtifacts.map((artifact) => artifact.path),
      verifiedAt: review.reviewedAt,
    },
  } satisfies AssetMetadata;
  return writeHashedAssetMetadata(join(directory, 'asset.yaml'), metadata);
}
