#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import process from 'node:process';
import { createQuinticMotionKeyframes, motionClipSchema } from '../../dist/motion/model.js';
import { analyzeMotionKinematics } from '../../dist/motion/kinematics.js';

const directory = resolve(process.argv[2] ?? '');
if (!process.argv[2])
  throw new Error(
    'Usage: npm run build && node scripts/research/calibrate-gait-kinematics.mjs path/to/WBDSascii',
  );

const selected = (await readdir(directory))
  .filter((name) => /^WBDS(?:0[1-9]|1[0-9]|2[0-4])walkOCang\.txt$/.test(name))
  .sort();
if (selected.length !== 24)
  throw new Error(
    `Expected 24 young-adult comfortable overground angle files, found ${selected.length}`,
  );

function lowPassPeriodic(values, maximumHarmonic = 6) {
  const periodSamples = values.length - 1;
  const output = Array.from({ length: values.length }, (_, sampleIndex) =>
    [0, 1, 2].map((axis) => {
      let reconstructed = 0;
      for (let harmonic = -maximumHarmonic; harmonic <= maximumHarmonic; harmonic++) {
        let real = 0;
        let imaginary = 0;
        for (let sourceIndex = 0; sourceIndex < periodSamples; sourceIndex++) {
          const angle = (-2 * Math.PI * harmonic * sourceIndex) / periodSamples;
          real += values[sourceIndex][axis] * Math.cos(angle);
          imaginary += values[sourceIndex][axis] * Math.sin(angle);
        }
        real /= periodSamples;
        imaginary /= periodSamples;
        const angle = (2 * Math.PI * harmonic * (sampleIndex % periodSamples)) / periodSamples;
        reconstructed += real * Math.cos(angle) - imaginary * Math.sin(angle);
      }
      return reconstructed;
    }),
  );
  output[output.length - 1] = [...output[0]];
  return output;
}

const channels = [
  ['RPelvisAngle', 'hips'],
  ['RHipAngle', 'right-thigh'],
  ['RKneeAngle', 'right-shin'],
  ['RAnkleAngle', 'right-foot'],
  ['RFootAngle', 'right-toe'],
];
const tracks = [];
for (const name of selected) {
  const lines = (await readFile(resolve(directory, name), 'utf8')).trim().split(/\r?\n/);
  const header = lines[0].split('\t');
  const rows = lines.slice(1).map((line) => line.split('\t').map(Number));
  const clipTracks = channels.map(([source, joint]) => {
    const indexes = ['X', 'Y', 'Z'].map((axis) => header.indexOf(`${source}${axis}`));
    if (indexes.some((index) => index < 0)) throw new Error(`${name} lacks ${source} XYZ`);
    const values = lowPassPeriodic(
      rows.map((row) => indexes.map((index) => (row[index] * Math.PI) / 180)),
    );
    return {
      joint,
      property: 'rotation-euler',
      space: 'local-delta',
      interpolation: 'quintic-hermite',
      keyframes: createQuinticMotionKeyframes(values, 1, true),
    };
  });
  const subject = basename(name).slice(4, 6);
  const clip = motionClipSchema.parse({
    schemaVersion: 1,
    id: `reference.wbds-${subject}`,
    skeleton: 'videoer.canonical-humanoid.v1',
    durationSeconds: 1,
    loop: true,
    tracks: clipTracks,
  });
  tracks.push(...analyzeMotionKinematics(clip).tracks.map((track) => ({ subject, ...track })));
}

function quantile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

const distribution = (key) => {
  const values = tracks.map((track) => track[key]);
  return {
    median: quantile(values, 0.5),
    p90: quantile(values, 0.9),
    p95: quantile(values, 0.95),
    p99: quantile(values, 0.99),
    maximum: Math.max(...values),
  };
};

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      source: '10.6084/m9.figshare.5722711.v5',
      subjects: selected.length,
      tracks: tracks.length,
      samplesPerCurve: 101,
      maximumHarmonic: 6,
      distributions: {
        normalizedPeakJerk: distribution('normalizedPeakJerk'),
        jerkPeakToP95: distribution('jerkPeakToP95'),
      },
    },
    null,
    2,
  )}\n`,
);
