import { describe, expect, it } from 'vitest';
import {
  healthyComfortableGaitCalibration,
  sampleHealthyGaitDegrees,
} from '../src/motion/gait-calibration.js';

describe('healthy gait calibration', () => {
  it('loads the attributed CC BY population calibration', () => {
    expect(healthyComfortableGaitCalibration).toMatchObject({
      id: 'motion-calibration.wbds-young-comfortable-overground-v1',
      source: {
        datasetDoi: '10.6084/m9.figshare.5722711.v5',
        paperDoi: '10.7717/peerj.4640',
        licence: 'CC BY 4.0',
      },
      population: {
        subjects: 24,
        condition: 'overground walking at self-selected comfortable speed',
        samplesPerCycle: 101,
      },
      representation: { maximumHarmonic: 6 },
    });
  });

  it('reconstructs periodic pelvis and foot evidence at right initial contact', () => {
    expect(sampleHealthyGaitDegrees('pelvisTilt', 0)).toBeCloseTo(11.56, 1);
    expect(sampleHealthyGaitDegrees('footPitch', 0)).toBeCloseTo(20.94, 1);
    expect(sampleHealthyGaitDegrees('footPitch', 0.65)).toBeLessThan(-60);
    expect(sampleHealthyGaitDegrees('footPitch', 0.92)).toBeGreaterThan(10);
    expect(sampleHealthyGaitDegrees('footPitch', 1)).toBeCloseTo(
      sampleHealthyGaitDegrees('footPitch', 0),
      10,
    );
  });
});
