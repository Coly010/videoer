import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifySparseSmokeSequence } from '../src/application/aerosol-vfx-acceptance.js';
import { sha256File } from '../src/assets/library.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function smokeFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'videoer-aerosol-'));
  temporaryDirectories.push(directory);
  const frames = [];
  for (let index = 0; index < 3; index += 1) {
    const path = `smoke-${index + 1}.vdb`;
    await writeFile(join(directory, path), `sparse-openvdb-frame-${index + 1}`);
    frames.push({
      frame: index + 1,
      path,
      densityActiveVoxels: 1_100 + index * 250,
      temperatureActiveVoxels: 1_050 + index * 220,
      densityMaximum: 0.8 + index * 0.1,
      densityMeanActive: 0.04 + index * 0.005,
      sha256: await sha256File(join(directory, path)),
    });
  }
  return {
    directory,
    report: {
      volumeSequence: {
        representation: 'sparse-openvdb-buoyant-incompressible-v3',
        voxelSizeMeters: 0.045,
        gridDimensions: [48, 48, 56],
        warmupFrames: 72,
        sequenceFrames: 3,
        sourceParcels: [{ particleIndex: 0 }, { particleIndex: 1 }],
        solver: {
          kind: 'buoyant-incompressible-grid',
          pressureIterations: 14,
          vorticityConfinement: 0.36,
          maximumPreProjectionDivergence: 1.2,
          maximumPostProjectionDivergence: 0.42,
        },
        frames,
      },
    },
  };
}

describe('sparse OpenVDB smoke acceptance', () => {
  it('accepts a hash-bound, temporally changing, pressure-projected sequence', async () => {
    const fixture = await smokeFixture();
    await expect(
      verifySparseSmokeSequence('test-host', fixture.directory, fixture.report, 2, 3),
    ).resolves.toMatchObject({
      representation: 'sparse-openvdb-buoyant-incompressible-v3',
      frameCount: 3,
      distinctFrameHashes: 3,
    });
  });

  it('rejects a VDB file changed after its backend report was written', async () => {
    const fixture = await smokeFixture();
    await writeFile(join(fixture.directory, 'smoke-2.vdb'), 'tampered-volume');
    await expect(
      verifySparseSmokeSequence('test-host', fixture.directory, fixture.report, 2, 3),
    ).rejects.toThrow('does not match its live file hash');
  });

  it('rejects a solver whose pressure projection does not reduce divergence', async () => {
    const fixture = await smokeFixture();
    const sequence = fixture.report.volumeSequence;
    sequence.solver.maximumPostProjectionDivergence = 1.3;
    await expect(
      verifySparseSmokeSequence('test-host', fixture.directory, fixture.report, 2, 3),
    ).rejects.toThrow('lacks valid pressure-projection evidence');
  });
});
