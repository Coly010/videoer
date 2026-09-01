#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';

const inputDirectory = resolve(
  process.argv[2] ?? '.videoer-cache/research/wbds-v5/young-comfortable-overground',
);
const outputPath = resolve(
  process.argv[3] ?? 'assets/motion-calibration/wbds-young-comfortable-overground-v1.json',
);
const selectedName = /^WBDS(?:0[1-9]|1[0-9]|2[0-4])walkOCang\.txt$/u;
const maximumHarmonic = 6;

const channelDefinitions = {
  pelvisRotation: {
    column: 'RPelvisAngleX',
    semantic: 'pelvis transverse rotation',
    kind: 'segment-angle',
  },
  pelvisObliquity: {
    column: 'RPelvisAngleY',
    semantic: 'pelvis frontal obliquity',
    kind: 'segment-angle',
  },
  pelvisTilt: {
    column: 'RPelvisAngleZ',
    semantic: 'pelvis sagittal tilt',
    kind: 'segment-angle',
  },
  hipFlexion: {
    column: 'RHipAngleZ',
    semantic: 'right hip sagittal flexion/extension',
    kind: 'joint-angle',
  },
  kneeFlexion: {
    column: 'RKneeAngleZ',
    semantic: 'right knee sagittal flexion/extension',
    kind: 'joint-angle',
  },
  ankleDorsiflexion: {
    column: 'RAnkleAngleZ',
    semantic: 'right ankle sagittal dorsiflexion/plantarflexion',
    kind: 'joint-angle',
  },
  footPitch: {
    column: 'RFootAngleZ',
    semantic: 'right foot segment sagittal dorsiflexion/plantarflexion',
    kind: 'segment-angle',
  },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function quantile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function periodicHarmonics(values) {
  const periodSamples = values.length - 1;
  const cosineDegrees = [];
  const sineDegrees = [];
  for (let harmonic = 1; harmonic <= maximumHarmonic; harmonic++) {
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < periodSamples; index++) {
      const angle = (-2 * Math.PI * harmonic * index) / periodSamples;
      real += values[index] * Math.cos(angle);
      imaginary += values[index] * Math.sin(angle);
    }
    cosineDegrees.push((2 * real) / periodSamples);
    sineDegrees.push((-2 * imaginary) / periodSamples);
  }
  return {
    offsetDegrees:
      values.slice(0, periodSamples).reduce((sum, value) => sum + value, 0) / periodSamples,
    cosineDegrees,
    sineDegrees,
  };
}

const provenance = JSON.parse(await readFile(resolve(inputDirectory, 'provenance.json'), 'utf8'));
assert(
  provenance.source?.doi === '10.6084/m9.figshare.5722711.v5',
  'Unexpected WBDS provenance DOI',
);
assert(provenance.source?.licence === 'CC BY 4.0', 'Unexpected WBDS licence');

const selected = (await readdir(inputDirectory)).filter((name) => selectedName.test(name)).sort();
assert(selected.length === 24, `Expected 24 selected WBDS records, found ${selected.length}`);

const subjects = [];
for (const name of selected) {
  const lines = (await readFile(resolve(inputDirectory, name), 'utf8')).trim().split(/\r?\n/u);
  const header = lines[0].split('\t');
  const rows = lines.slice(1).map((line) => line.split('\t').map(Number));
  assert(rows.length === 101, `${name} has ${rows.length} rows instead of 101`);
  assert(
    rows.every((row) => row.length === header.length && row.every(Number.isFinite)),
    `${name} contains malformed numeric data`,
  );
  const channels = Object.fromEntries(
    Object.entries(channelDefinitions).map(([id, definition]) => {
      const index = header.indexOf(definition.column);
      assert(index >= 0, `${name} lacks ${definition.column}`);
      return [id, rows.map((row) => row[index])];
    }),
  );
  subjects.push({ id: basename(name).slice(4, 6), channels });
}

const channels = Object.fromEntries(
  Object.entries(channelDefinitions).map(([id, definition]) => {
    const medianDegrees = Array.from({ length: 101 }, (_, phaseIndex) =>
      quantile(
        subjects.map((subject) => subject.channels[id][phaseIndex]),
        0.5,
      ),
    );
    medianDegrees[100] = medianDegrees[0];
    const subjectRanges = subjects.map((subject) => {
      const values = subject.channels[id].slice(0, 100);
      return Math.max(...values) - Math.min(...values);
    });
    return [
      id,
      {
        ...definition,
        unit: 'degrees',
        phaseOrigin: 'right initial contact',
        positiveConvention: 'as published by the Visual3D WBDS pipeline',
        harmonics: periodicHarmonics(medianDegrees),
        populationRangeDegrees: {
          p10: quantile(subjectRanges, 0.1),
          median: quantile(subjectRanges, 0.5),
          p90: quantile(subjectRanges, 0.9),
        },
      },
    ];
  }),
);

const calibration = {
  schemaVersion: 1,
  id: 'motion-calibration.wbds-young-comfortable-overground-v1',
  source: {
    title: provenance.source.title,
    authors: ['Claudiane A. Fukuchi', 'Reginaldo K. Fukuchi', 'Marcos Duarte'],
    paperDoi: '10.7717/peerj.4640',
    datasetDoi: provenance.source.doi,
    figshareFileId: provenance.source.figshareFileId,
    publishedArchiveMd5: provenance.source.publishedArchiveMd5,
    licence: provenance.source.licence,
    attribution:
      'Fukuchi CA, Fukuchi RK, Duarte M (2018), A public dataset of overground and treadmill walking kinematics and kinetics in healthy individuals, PeerJ 6:e4640.',
  },
  population: {
    subjects: subjects.length,
    ageGroup: 'young adults',
    condition: 'overground walking at self-selected comfortable speed',
    side: 'right',
    samplesPerCycle: 101,
    aggregation: 'pointwise population median followed by periodic harmonic projection',
  },
  representation: {
    maximumHarmonic,
    formula:
      'offsetDegrees + sum(cosineDegrees[h-1] * cos(2*pi*h*phase) + sineDegrees[h-1] * sin(2*pi*h*phase))',
    runtimeProviderFree: true,
  },
  channels,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(calibration, null, 2)}\n`);
process.stdout.write(`${outputPath}\n`);
