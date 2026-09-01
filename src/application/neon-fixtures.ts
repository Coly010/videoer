import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderCinematicProbe, renderCinematicScene } from '../cinematic/blender.js';
import { saveCinematicScene } from '../cinematic/io.js';
import {
  createNeonBladeSignFixture,
  createNeonBladeSignGeometry,
} from '../fixtures/neon-blade-sign.js';
import { savePracticalFixture } from '../fixtures/io.js';
import { saveGeometry } from '../geometry/io.js';
import { validateGeometry } from '../geometry/model.js';
import { fixtureProbeScene, fixtureWitness } from './fixtures.js';

export async function createPortableNeonBladeSignAsset(outputDirectory: string) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const geometry = createNeonBladeSignGeometry();
  const validation = validateGeometry(geometry);
  if (!validation.valid)
    throw new Error(
      `Neon blade sign geometry failed: ${validation.issues.map((issue) => issue.code).join(', ')}`,
    );
  const geometryFile = await saveGeometry(join(output, 'geometry.json'), geometry);
  const fixtureFile = await savePracticalFixture(
    join(output, 'fixture.json'),
    createNeonBladeSignFixture(),
  );
  await writeFile(
    join(output, 'validation.json'),
    `${JSON.stringify(validation, null, 2)}\n`,
    'utf8',
  );

  const probes = [];
  for (const kind of ['facade', 'warehouse'] as const) {
    const directory = join(output, 'verification', kind);
    await mkdir(directory, { recursive: true });
    const witnessFile = await saveGeometry(
      join(directory, 'witness-geometry.json'),
      fixtureWitness(kind),
    );
    const sceneFile = await saveCinematicScene(
      join(directory, 'scene.json'),
      fixtureProbeScene(
        `neon-blade-sign-${kind}-probe`,
        witnessFile,
        geometryFile,
        fixtureFile,
        kind,
        'portable-neon-sign',
        -0.9,
        2.65,
        1.55,
        40,
      ),
    );
    probes.push({
      kind,
      sceneFile,
      render:
        kind === 'facade'
          ? await renderCinematicScene(sceneFile, directory)
          : await renderCinematicProbe(sceneFile, directory),
    });
  }

  const metadata = assetMetadataSchema.parse({
    schemaVersion: 1,
    id: geometry.id,
    version: '0.1.0',
    type: 'prop',
    title: 'Portable projecting neon blade sign practical',
    description:
      'Project-owned two-sided projecting neon sign with a physical cabinet, replaceable face-treatment slots, structural wall bracket, local area emitters, and bounded deterministic electrical instability.',
    status: 'validated',
    tags: ['neon', 'blade-sign', 'practical', 'wayfinding', 'portable-set-dressing'],
    capabilities: [
      'portable-geometry',
      'named-wall-mount',
      'replaceable-two-sided-face-treatment',
      'declared-wall-clearance-contract',
      'local-practical-emitter',
      'inverse-square-falloff',
      'cross-environment-transfer',
      'seeded-electrical-instability',
      'authored-colour-preservation',
      'visible-source-emission-binding',
    ],
    source: {
      kind: 'procedural',
      generator: 'videoer.projecting-neon-blade-sign.v1',
      references: [],
      licence: {
        spdx: 'LicenseRef-Videoer-Project',
        name: 'Videoer project-owned production asset',
        commercialUse: 'allowed',
        attributionRequired: false,
      },
      clearance: 'approved',
    },
    artifacts: [
      {
        role: 'geometry',
        path: 'geometry.json',
        mediaType: 'application/vnd.videoer.geometry+json',
      },
      {
        role: 'practical-fixture',
        path: 'fixture.json',
        mediaType: 'application/vnd.videoer.practical-fixture+json',
      },
      { role: 'validation', path: 'validation.json', mediaType: 'application/json' },
      {
        role: 'blender-source',
        path: 'verification/facade/neon-blade-sign-facade-probe.blend',
        mediaType: 'application/x-blender',
      },
      {
        role: 'temporal-preview',
        path: 'verification/facade/neon-blade-sign-facade-probe.mp4',
        mediaType: 'video/mp4',
      },
      {
        role: 'temporal-render-report',
        path: 'verification/facade/scene-render.json',
        mediaType: 'application/json',
      },
      {
        role: 'fixture-modulation-report',
        path: 'verification/facade/fixture-modulation-report.json',
        mediaType: 'application/json',
      },
      {
        role: 'transfer-blender-source',
        path: 'verification/warehouse/neon-blade-sign-warehouse-probe.blend',
        mediaType: 'application/x-blender',
      },
    ],
    compatibility: {
      coordinateSystem: 'right-handed-y-up-forward-negative-z-metres',
      renderers: ['blender-headless'],
      requires: [],
    },
    verification: {
      checks: [
        'geometry.topology',
        'fixture.geometry-binding',
        'fixture.mount-attachment',
        'fixture.local-emitter-schema',
        'fixture.authored-colour-preserved',
        'fixture.seeded-electrical-instability',
        'fixture.visible-source-and-useful-light-shared-signal',
        'prop.host-clearance-contract',
        'prop.replaceable-face-treatment-contract',
        'visual.facade-landmarks-generated-not-accepted',
        'visual.warehouse-transfer-generated-not-accepted',
      ],
      artifacts: [
        'verification/facade/contact-sheet.png',
        'verification/facade/scene-render.json',
        'verification/facade/neon-blade-sign-facade-probe.mp4',
        'verification/facade/fixture-modulation-report.json',
        'verification/warehouse/contact-sheet.png',
        'verification/warehouse/scene-probe.json',
      ],
      verifiedAt: new Date().toISOString(),
    },
  });
  const metadataFile = await writeHashedAssetMetadata(join(output, 'asset.yaml'), metadata);
  return { output, geometryFile, fixtureFile, metadataFile, validation, probes };
}
