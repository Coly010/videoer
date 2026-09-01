import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProductionHumanFoundation } from '../src/application/geometry.js';

describe('stable-topology production-human operation', () => {
  it('persists a rejected-but-mechanically-valid final-mesh walk without Blender', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'videoer-production-foundation-'));
    try {
      const result = await createProductionHumanFoundation(directory, {}, { probe: false });
      expect(result.metadata.status).toBe('validated');
      expect(result.metadata.source).toMatchObject({
        kind: 'imported',
        generator: 'videoer.production-template-human.v1',
        licence: { spdx: 'CC0-1.0' },
      });
      expect(result.validation.productionTemplate).toMatchObject({
        topology: 'makehuman-hm08-cc0-derived-v1',
        productionPose: 'a-pose',
      });
      expect(result.validation.productionTemplate.measuredWalkRig.legLength).toBeCloseTo(
        0.81507,
        4,
      );
      expect(result.validation.productionTemplate.measuredWalkRig).toMatchObject({
        thighRestLateral: expect.any(Number),
        shinRestLateral: expect.any(Number),
      });
      expect(result.validation.productionTemplate.measuredWalkRig.thighRestLateral).toBeGreaterThan(
        0.04,
      );
      const biomechanics = result.validation.walk.biomechanics.checks as {
        strideLengthMeters: number;
        targetLateralStepWidthMeters: number;
        minimumLateralStepWidthMeters: number;
      };
      expect(biomechanics.strideLengthMeters).toBeCloseTo(0.81507 * 1.18, 4);
      expect(biomechanics.targetLateralStepWidthMeters).toBeCloseTo(1.69091 * 0.08, 4);
      expect(biomechanics.minimumLateralStepWidthMeters).toBeGreaterThan(
        biomechanics.targetLateralStepWidthMeters * 0.7,
      );
      expect(result.validation.walk.biomechanics.valid).toBe(true);
      expect(result.validation.walk.grounding.valid).toBe(true);
      expect(result.validation.walk.footPlanting).toMatchObject({
        samples: 241,
        maximumCorrectionHarmonic: 9,
      });
      expect(result.validation.walk.footPlanting.maximumSolvedResidualMeters).toBeLessThan(0.0002);
      expect(result.validation.walk.footPlanting.maximumCorrectionRadians).toBeLessThan(0.2);
      expect(result.validation.walk.alignment.valid).toBe(true);
      expect(result.validation.walk.footRocker.valid).toBe(true);
      expect(
        result.validation.walk.footRocker.checks.sides.left.terminalStance.toeHeightMeters,
      ).toBeLessThan(0.012);
      expect(
        result.validation.walk.footRocker.checks.sides.right.terminalStance.toeHeightMeters,
      ).toBeLessThan(0.012);
      expect(result.validation.walk.deformation.valid).toBe(true);
      expect(result.validation.walk.visualAcceptance).toBe('rejected');
      expect(JSON.parse(await readFile(result.motionFile, 'utf8')).metadata).toHaveProperty(
        'characterGrounding',
      );
      const persistedMotion = JSON.parse(await readFile(result.motionFile, 'utf8'));
      expect(persistedMotion.metadata.characterFootPlanting).toMatchObject({
        generator: 'videoer.final-surface-foot-planting.v1',
        maximumCorrectionHarmonic: 9,
      });
      expect(persistedMotion.metadata.handPoseLayer).toMatchObject({
        generator: 'videoer.relaxed-walking-hands.v3',
        flexionAxis: 'local-y-palm-depth',
        thumbOpposition: 'inward-toward-index-base',
        wristTracks: 0,
      });
      expect(
        persistedMotion.tracks.filter(
          (track: { joint: string }) => track.joint === 'left-hand' || track.joint === 'right-hand',
        ),
      ).toEqual([]);
      expect(
        persistedMotion.tracks.filter((track: { joint: string }) =>
          /-index-[1-3]$/u.test(track.joint),
        ),
      ).toHaveLength(6);
      const walkingFingerTracks = persistedMotion.tracks.filter((track: { joint: string }) =>
        /-(?:index|middle|ring|little)-[1-3]$/u.test(track.joint),
      );
      expect(walkingFingerTracks).toHaveLength(24);
      for (const track of walkingFingerTracks)
        for (const keyframe of track.keyframes) {
          expect(Math.abs(keyframe.value[1])).toBeGreaterThan(0);
          expect(keyframe.value[2]).toBe(0);
        }
      expect(result).not.toHaveProperty('probe');
      expect(result).not.toHaveProperty('motionProbe');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
