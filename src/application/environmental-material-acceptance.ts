import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  assetMetadataSchema,
  loadAssetMetadata,
  sha256File,
  writeHashedAssetMetadata,
  type AssetMetadata,
} from '../assets/library.js';
import { loadGeometry } from '../geometry/io.js';
import { validateGeometry } from '../geometry/model.js';
import { loadSurfaceMaterial } from '../materials/io.js';
import { createOldCitySurfacePresets } from '../materials/old-city.js';
import { environmentalSurfaceSuiteReviewSchema } from '../materials/review.js';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

function renderPassesAndCovers(report: Record<string, unknown>, entityId: string) {
  if (
    typeof report.verification !== 'object' ||
    report.verification === null ||
    !('status' in report.verification) ||
    report.verification.status !== 'pass' ||
    !Array.isArray(report.renderChecks) ||
    !report.renderChecks.every(
      (check) =>
        typeof check === 'object' && check !== null && 'status' in check && check.status === 'pass',
    )
  )
    return false;
  return report.renderChecks.some((check) => {
    if (
      typeof check !== 'object' ||
      check === null ||
      !('measurements' in check) ||
      typeof check.measurements !== 'object' ||
      check.measurements === null ||
      !('entities' in check.measurements) ||
      !Array.isArray(check.measurements.entities)
    )
      return false;
    return check.measurements.entities.some(
      (entity: unknown) =>
        typeof entity === 'object' &&
        entity !== null &&
        'entityId' in entity &&
        entity.entityId === entityId &&
        'covered' in entity &&
        entity.covered === true,
    );
  });
}

async function distinctFrames(directory: string, names: string[]) {
  const hashes = await Promise.all(names.map((name) => sha256File(join(directory, name))));
  if (new Set(hashes).size !== names.length)
    throw new Error(`Material gallery '${directory}' does not contain distinct landmark frames`);
  return hashes;
}

export async function acceptEnvironmentalSurfaceSuite(
  suiteDirectory: string,
  exteriorGalleryDirectory: string,
  interiorGalleryDirectory: string,
) {
  const suite = resolve(suiteDirectory);
  const exterior = resolve(exteriorGalleryDirectory);
  const interior = resolve(interiorGalleryDirectory);
  const review = environmentalSurfaceSuiteReviewSchema.parse(
    await json(join(suite, 'verification', 'surface-suite-review.json')),
  );
  if (review.decision !== 'accepted')
    throw new Error('Environmental surface suite review is rejected');
  const [exteriorReport, interiorReport, exteriorHashes, interiorHashes] = await Promise.all([
    json(join(exterior, 'scene-render.json')),
    json(join(interior, 'scene-render.json')),
    distinctFrames(exterior, ['000-right-raking.png', '050-frontal.png', '100-left-raking.png']),
    distinctFrames(interior, [
      '000-right-response.png',
      '050-frontal.png',
      '100-left-response.png',
    ]),
  ]);
  const coverage = new Map<string, { report: Record<string, unknown>; entityId: string }>([
    ['material.old-city-dark-brick', { report: exteriorReport, entityId: 'brick-plinth' }],
    ['material.rain-aged-mineral-plaster', { report: exteriorReport, entityId: 'facade-plaster' }],
    [
      'material.weathered-dark-exterior-wood',
      { report: exteriorReport, entityId: 'exterior-timber' },
    ],
    ['material.aged-limestone-trim', { report: exteriorReport, entityId: 'limestone-trim' }],
    ['material.old-city-window-glazing', { report: exteriorReport, entityId: 'window' }],
    ['material.warm-lime-plaster-interior', { report: interiorReport, entityId: 'warm-wall' }],
    ['material.oiled-dark-bookshop-wood', { report: interiorReport, entityId: 'shelf-wood' }],
  ]);
  const expectedIds = createOldCitySurfacePresets()
    .map((preset) => preset.material.id)
    .sort();
  if (JSON.stringify([...review.materialAssetIds].sort()) !== JSON.stringify(expectedIds))
    throw new Error(
      'Surface-suite review identities do not match the complete material preset set',
    );

  const sharedVerification = join(suite, 'verification');
  await mkdir(sharedVerification, { recursive: true });
  for (const [sourceDirectory, prefix] of [
    [exterior, 'exterior'],
    [interior, 'interior'],
  ] as const) {
    for (const file of ['contact-sheet.png', 'scene-render.json'])
      await copyFile(join(sourceDirectory, file), join(sharedVerification, `${prefix}-${file}`));
  }

  const accepted = [];
  for (const preset of createOldCitySurfacePresets()) {
    const directory = join(suite, preset.material.id.replace(/^material\./u, ''), '0.2.0');
    const [asset, material, swatch, probe] = await Promise.all([
      loadAssetMetadata(join(directory, 'asset.yaml')),
      loadSurfaceMaterial(join(directory, 'material.json')),
      loadGeometry(join(directory, 'swatch-geometry.json')),
      json(join(directory, 'verification', 'probe.json')),
    ]);
    if (asset.type !== 'material' || asset.status !== 'validated' || asset.id !== material.id)
      throw new Error(`Material candidate '${preset.material.id}' has invalid identity or status`);
    if (!validateGeometry(swatch).valid || swatch.materials[0]?.surface?.id !== material.id)
      throw new Error(
        `Material candidate '${material.id}' has invalid or mismatched swatch geometry`,
      );
    if (
      !Array.isArray(probe.views) ||
      probe.views.length !== 4 ||
      typeof probe.turntable !== 'string'
    )
      throw new Error(`Material candidate '${material.id}' lacks complete diagnostic evidence`);
    const diagnosticFiles = ['top.png', 'raking.png', 'close.png', 'glancing.png'];
    const diagnosticHashes = await Promise.all(
      diagnosticFiles.map((file) => sha256File(join(directory, 'verification', file))),
    );
    if (new Set(diagnosticHashes).size < 3)
      throw new Error(
        `Material candidate '${material.id}' diagnostic views are not meaningfully distinct`,
      );
    const expectedCoverage = coverage.get(material.id);
    if (
      !expectedCoverage ||
      !renderPassesAndCovers(expectedCoverage.report, expectedCoverage.entityId)
    )
      throw new Error(
        `Material candidate '${material.id}' lacks accepted architectural transfer coverage`,
      );
    if (
      ['dark-brick', 'rain-aged-plaster', 'weathered-wood', 'limestone-trim'].includes(preset.id) &&
      !material.weathering
    )
      throw new Error(
        `Exterior material '${material.id}' lacks environmental weathering semantics`,
      );
    if (
      material.pattern.kind === 'architectural-glazing' &&
      (material.pattern.thicknessMeters !== 0.008 || material.pattern.transmission < 0.9)
    )
      throw new Error(
        `Glazing material '${material.id}' lacks physical thickness or useful transmission`,
      );

    const verificationDirectory = join(directory, 'verification');
    for (const file of [
      'exterior-contact-sheet.png',
      'exterior-scene-render.json',
      'interior-contact-sheet.png',
      'interior-scene-render.json',
    ])
      await copyFile(join(sharedVerification, file), join(verificationDirectory, file));
    await copyFile(
      join(sharedVerification, 'surface-suite-review.json'),
      join(verificationDirectory, 'surface-suite-review.json'),
    );
    const evidenceArtifacts: AssetMetadata['artifacts'] = [
      {
        role: 'exterior-architectural-transfer',
        path: 'verification/exterior-contact-sheet.png',
        mediaType: 'image/png',
      },
      {
        role: 'exterior-transfer-report',
        path: 'verification/exterior-scene-render.json',
        mediaType: 'application/json',
      },
      {
        role: 'interior-architectural-transfer',
        path: 'verification/interior-contact-sheet.png',
        mediaType: 'image/png',
      },
      {
        role: 'interior-transfer-report',
        path: 'verification/interior-scene-render.json',
        mediaType: 'application/json',
      },
      {
        role: 'qualitative-suite-review',
        path: 'verification/surface-suite-review.json',
        mediaType: 'application/json',
      },
    ];
    const metadata = assetMetadataSchema.parse(asset);
    accepted.push(
      await writeHashedAssetMetadata(join(directory, 'asset.yaml'), {
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
            'visual.material-diagnostic-views-accepted',
            'visual.architectural-transfer-accepted',
            'material.medium-background-shot-distance-accepted',
          ],
          artifacts: [
            ...metadata.verification.artifacts,
            ...evidenceArtifacts.map((artifact) => artifact.path),
          ],
          verifiedAt: review.reviewedAt,
        },
      }),
    );
  }
  return { suite, accepted, exteriorHashes, interiorHashes };
}
