import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptLightingCandidate } from '../src/application/lighting-acceptance.js';
import { writeHashedAssetMetadata } from '../src/assets/library.js';
import { adaptLightingRig, verifyLightingRigAdaptation } from '../src/lighting/adaptation.js';
import { createWarmInteriorLightingRig } from '../src/lighting/bookshop.js';
import { saveLightingRig } from '../src/lighting/io.js';

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

async function candidateFixture() {
  directory = await mkdtemp(join(tmpdir(), 'videoer-lighting-acceptance-'));
  const verification = join(directory, 'verification');
  const transfer = join(verification, 'transfer', 'unrelated-host');
  await mkdir(transfer, { recursive: true });
  const base = createWarmInteriorLightingRig();
  const adaptation = {
    kind: 'lighting-rig-transform-v1' as const,
    assetId: 'lighting.unrelated-host-transfer',
    transform: {
      translation: [0.5, 0, -1] as [number, number, number],
      yawRadians: 0.1,
      uniformScale: 1,
    },
    energyScale: 0.9,
    purposeEnergyScale: { key: 1, fill: 1, rim: 1, practical: 1, environment: 1 },
    colorMultiply: [1, 0.98, 0.96] as [number, number, number],
    worldColor: [0.01, 0.01, 0.02] as [number, number, number],
    metadata: {},
  };
  const adapted = adaptLightingRig(base, adaptation);
  await saveLightingRig(join(directory, 'lighting-rig.json'), base);
  await saveLightingRig(join(transfer, 'adapted-lighting-rig.json'), adapted);
  const definition = {
    schemaVersion: 1,
    id: 'lighting-probe.unrelated-host',
    sourceRigPath: '../../../lighting-rig.json',
    environmentGeometryPath: 'environment.json',
    adaptation,
    witnessTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    camera: {
      start: { position: [0, 1, -3], target: [0, 1, 0], lensMillimeters: 50 },
      end: { position: [0.1, 1, -2.9], target: [0, 1, 0], lensMillimeters: 52 },
    },
    resolution: { width: 480, height: 480, percentage: 100 },
    exposureRegion: {
      x: 0.2,
      y: 0.2,
      width: 0.6,
      height: 0.6,
      maximumBlackPercentage: 50,
      maximumWhitePercentage: 10,
      minimumMidtonePercentage: 40,
    },
  };
  await writeFile(
    join(transfer, 'transfer-definition.json'),
    `${JSON.stringify(definition, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(transfer, 'lighting-adaptation-report.json'),
    `${JSON.stringify(verifyLightingRigAdaptation(base, adapted, adaptation), null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(verification, 'scene-render.json'),
    JSON.stringify({ renderChecks: [{ id: 'source', status: 'pass' }] }),
    'utf8',
  );
  const preview = join(transfer, 'preview.mp4');
  await writeFile(preview, 'test preview', 'utf8');
  await writeFile(join(transfer, 'contact-sheet.png'), 'test contact sheet', 'utf8');
  await writeFile(
    join(transfer, 'scene-render.json'),
    JSON.stringify({ video: preview, renderChecks: [{ id: 'transfer', status: 'pass' }] }),
    'utf8',
  );
  await writeFile(
    join(verification, 'lighting-candidate-review.json'),
    JSON.stringify({
      schemaVersion: 1,
      assetId: base.id,
      decision: 'accepted',
      reviewer: 'test-reviewer',
      reviewedAt: '2026-09-01T10:50:37.000Z',
      portableWithoutEnvironment: true,
      sourceEvidenceDirectory: 'verification',
      transferEvidenceDirectory: 'verification/transfer/unrelated-host',
      evidence: [
        'verification/scene-render.json',
        'verification/transfer/unrelated-host/contact-sheet.png',
      ],
      strengths: ['bounded lighting response transfers'],
      limitations: ['fixture is mechanical, not artistic acceptance'],
      notes: 'Exercises live acceptance reconstruction.',
    }),
    'utf8',
  );
  await writeHashedAssetMetadata(join(directory, 'asset.yaml'), {
    schemaVersion: 1,
    id: base.id,
    version: '9.9.9',
    type: 'lighting',
    title: 'Lighting acceptance fixture',
    description: 'Test-only validated lighting candidate.',
    status: 'validated',
    tags: ['test'],
    capabilities: ['reusable-rig'],
    source: {
      kind: 'procedural',
      generator: 'test',
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
        role: 'lighting-rig',
        path: 'lighting-rig.json',
        mediaType: 'application/vnd.videoer.lighting+json',
      },
    ],
    compatibility: {
      coordinateSystem: 'right-handed-y-up-forward-negative-z-metres',
      renderers: ['blender-headless'],
      requires: [{ id: 'environment.test-host', version: '1.0.0' }],
    },
    verification: {
      checks: ['visual.generated-not-accepted'],
      artifacts: [],
      verifiedAt: '2026-09-01T10:40:00.000Z',
    },
  });
  return { transfer };
}

describe('lighting candidate acceptance', () => {
  it('reconstructs a declared unrelated-host transfer before removing host dependency', async () => {
    await candidateFixture();
    const accepted = await acceptLightingCandidate(directory);
    expect(accepted.status).toBe('verified');
    expect(accepted.compatibility.requires).toEqual([]);
    expect(accepted.verification.checks).toContain(
      'lighting.unrelated-environment-transfer-reconstructed',
    );
  });

  it('rejects a forged adapted rig even when the persisted report still claims validity', async () => {
    const fixture = await candidateFixture();
    const path = join(fixture.transfer, 'adapted-lighting-rig.json');
    const forged = JSON.parse(await readFile(path, 'utf8'));
    forged.lights[0].energy *= 1.2;
    await writeFile(path, `${JSON.stringify(forged, null, 2)}\n`, 'utf8');
    await expect(acceptLightingCandidate(directory)).rejects.toThrow(
      /does not match the live bounded adaptation/,
    );
  });
});
