import { z } from 'zod';
import wbdsCalibrationJson from '../../assets/motion-calibration/wbds-young-comfortable-overground-v1.json' with { type: 'json' };

const harmonicSchema = z.object({
  offsetDegrees: z.number(),
  cosineDegrees: z.array(z.number()).length(6),
  sineDegrees: z.array(z.number()).length(6),
});

const channelSchema = z.object({
  column: z.string(),
  semantic: z.string(),
  kind: z.enum(['segment-angle', 'joint-angle']),
  unit: z.literal('degrees'),
  phaseOrigin: z.literal('right initial contact'),
  positiveConvention: z.string(),
  harmonics: harmonicSchema,
  populationRangeDegrees: z.object({
    p10: z.number().positive(),
    median: z.number().positive(),
    p90: z.number().positive(),
  }),
});

const calibrationSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.literal('motion-calibration.wbds-young-comfortable-overground-v1'),
  source: z.object({
    datasetDoi: z.literal('10.6084/m9.figshare.5722711.v5'),
    paperDoi: z.literal('10.7717/peerj.4640'),
    licence: z.literal('CC BY 4.0'),
  }),
  population: z.object({
    subjects: z.literal(24),
    condition: z.literal('overground walking at self-selected comfortable speed'),
    samplesPerCycle: z.literal(101),
  }),
  representation: z.object({ maximumHarmonic: z.literal(6) }),
  channels: z.object({
    pelvisRotation: channelSchema,
    pelvisObliquity: channelSchema,
    pelvisTilt: channelSchema,
    hipFlexion: channelSchema,
    kneeFlexion: channelSchema,
    ankleDorsiflexion: channelSchema,
    footPitch: channelSchema,
  }),
});

export const healthyComfortableGaitCalibration = calibrationSchema.parse(wbdsCalibrationJson);
export type HealthyGaitChannel = keyof typeof healthyComfortableGaitCalibration.channels;

const wrapPhase = (phase: number) => ((phase % 1) + 1) % 1;

export function sampleHealthyGaitDegrees(channel: HealthyGaitChannel, phase: number) {
  const harmonics = healthyComfortableGaitCalibration.channels[channel].harmonics;
  const wrapped = wrapPhase(phase);
  return harmonics.cosineDegrees.reduce((value, cosine, index) => {
    const harmonic = index + 1;
    const angle = 2 * Math.PI * harmonic * wrapped;
    return value + cosine * Math.cos(angle) + harmonics.sineDegrees[index]! * Math.sin(angle);
  }, harmonics.offsetDegrees);
}

export function sampleCenteredHealthyGaitDegrees(channel: HealthyGaitChannel, phase: number) {
  const harmonics = healthyComfortableGaitCalibration.channels[channel].harmonics;
  return sampleHealthyGaitDegrees(channel, phase) - harmonics.offsetDegrees;
}
