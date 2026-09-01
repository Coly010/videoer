import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { sha256File } from '../assets/library.js';

function alignedToSample(seconds: number) {
  return Math.abs(seconds * 48000 - Math.round(seconds * 48000)) < 1e-6;
}

export const audioTreatmentSchema = z
  .object({
    kind: z.literal('cinematic-audio-treatment-v1'),
    assetId: z.string().regex(/^audio\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
    sourceStartSeconds: z.number().nonnegative().default(0),
    durationSeconds: z.number().positive(),
    highpassHz: z.number().min(20).max(800).default(40),
    lowpassHz: z.number().min(1000).max(20000).default(18000),
    gainDb: z.number().min(-18).max(12).default(0),
    compressor: z
      .object({
        thresholdDb: z.number().min(-40).max(-3).default(-18),
        ratio: z.number().min(1).max(10).default(2.5),
        attackMs: z.number().min(1).max(100).default(20),
        releaseMs: z.number().min(20).max(1000).default(250),
      })
      .default({ thresholdDb: -18, ratio: 2.5, attackMs: 20, releaseMs: 250 }),
    stereoWidth: z.number().min(0).max(2).default(1),
    fadeInSeconds: z.number().nonnegative().max(3).default(0.08),
    fadeOutSeconds: z.number().nonnegative().max(3).default(0.18),
    targetIntegratedLufs: z.number().min(-24).max(-12).default(-18),
    truePeakDb: z.number().min(-3).max(-1).default(-1.5),
    accents: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z][a-z0-9-]*$/),
          kind: z.enum(['tonal-accent', 'foley-noise']),
          startSeconds: z.number().nonnegative(),
          endSeconds: z.number().positive(),
          gain: z.number().positive().max(0.5),
          frequencyHz: z.number().positive().max(12000).optional(),
          seed: z.number().int().optional(),
        }),
      )
      .default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((treatment, context) => {
    if (treatment.lowpassHz <= treatment.highpassHz * 2)
      context.addIssue({
        code: 'custom',
        path: ['lowpassHz'],
        message: 'audio treatment lowpass must remain at least one octave above highpass',
      });
    if (treatment.fadeInSeconds + treatment.fadeOutSeconds >= treatment.durationSeconds)
      context.addIssue({
        code: 'custom',
        path: ['fadeOutSeconds'],
        message: 'audio treatment fades must leave a positive unfaded interval',
      });
    const accentIds = new Set<string>();
    treatment.accents.forEach((accent, index) => {
      if (accentIds.has(accent.id))
        context.addIssue({
          code: 'custom',
          path: ['accents', index, 'id'],
          message: 'audio treatment accent ids must be unique',
        });
      accentIds.add(accent.id);
      if (accent.startSeconds >= accent.endSeconds || accent.endSeconds > treatment.durationSeconds)
        context.addIssue({
          code: 'custom',
          path: ['accents', index],
          message: 'audio treatment accents require a positive interval inside the output',
        });
      if (!alignedToSample(accent.startSeconds) || !alignedToSample(accent.endSeconds))
        context.addIssue({
          code: 'custom',
          path: ['accents', index],
          message: 'audio treatment accents must align to exact 48 kHz sample boundaries',
        });
      if (accent.kind === 'tonal-accent' && !accent.frequencyHz)
        context.addIssue({
          code: 'custom',
          path: ['accents', index, 'frequencyHz'],
          message: 'tonal treatment accents require frequencyHz',
        });
      if (accent.kind === 'foley-noise' && accent.seed === undefined)
        context.addIssue({
          code: 'custom',
          path: ['accents', index, 'seed'],
          message: 'noise treatment accents require a deterministic seed',
        });
    });
  });

export type AudioTreatment = z.infer<typeof audioTreatmentSchema>;

function runBuffer(command: string, args: string[]) {
  return new Promise<Buffer>((accept, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const output: Buffer[] = [];
    const error: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => error.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) accept(Buffer.concat(output));
      else
        reject(
          new Error(
            `${command} exited ${String(code)}: ${Buffer.concat(error).toString('utf8').trim()}`,
          ),
        );
    });
  });
}

async function inspectAudioContainer(path: string) {
  const output = await runBuffer('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=sample_rate,channels,channel_layout,codec_name:format=duration',
    '-of',
    'json',
    resolve(path),
  ]);
  const parsed = JSON.parse(output.toString('utf8')) as {
    streams?: Array<{
      sample_rate?: string;
      channels?: number;
      channel_layout?: string;
      codec_name?: string;
    }>;
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0];
  const durationSeconds = Number(parsed.format?.duration);
  if (!stream || !Number.isFinite(durationSeconds))
    throw new Error(`Unable to inspect audio artifact '${path}'`);
  return {
    durationSeconds,
    sampleRate: Number(stream.sample_rate),
    channels: Number(stream.channels),
    channelLayout: stream.channel_layout,
    codec: stream.codec_name,
  };
}

async function signalEnvelope(
  path: string,
  options: { startSeconds?: number; durationSeconds?: number } = {},
) {
  const args = ['-v', 'error', '-i', resolve(path)];
  if (options.startSeconds !== undefined) args.push('-ss', String(options.startSeconds));
  if (options.durationSeconds !== undefined) args.push('-t', String(options.durationSeconds));
  args.push('-ac', '1', '-ar', '1000', '-f', 'f32le', 'pipe:1');
  const pcm = await runBuffer('ffmpeg', args);
  const sampleCount = Math.floor(pcm.length / 4);
  const samples = Array.from({ length: sampleCount }, (_, index) => pcm.readFloatLE(index * 4));
  const peak = samples.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
  const sumSquares = samples.reduce((value, sample) => value + sample * sample, 0);
  const rms = Math.sqrt(sumSquares / Math.max(1, samples.length));
  const envelope = [];
  for (let start = 0; start < samples.length; start += 20) {
    const window = samples.slice(start, start + 20);
    envelope.push(
      Math.sqrt(
        window.reduce((value, sample) => value + sample * sample, 0) / Math.max(1, window.length),
      ),
    );
  }
  const activeThreshold = Math.max(1e-5, rms * 0.08);
  const firstActiveWindow = envelope.findIndex((value) => value >= activeThreshold);
  let lastActiveWindow = -1;
  for (let index = envelope.length - 1; index >= 0; index--)
    if (envelope[index]! >= activeThreshold) {
      lastActiveWindow = index;
      break;
    }
  return {
    peak,
    rms,
    samples,
    envelope,
    activeWindowFraction:
      envelope.filter((value) => value >= activeThreshold).length / Math.max(1, envelope.length),
    firstActiveWindow,
    lastActiveWindow,
  };
}

function envelopeCorrelation(first: number[], second: number[]) {
  const length = Math.min(first.length, second.length);
  if (length < 3) return 0;
  const a = first.slice(0, length);
  const b = second.slice(0, length);
  const meanA = a.reduce((sum, value) => sum + value, 0) / length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / length;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let index = 0; index < length; index++) {
    const deltaA = a[index]! - meanA;
    const deltaB = b[index]! - meanB;
    covariance += deltaA * deltaB;
    varianceA += deltaA * deltaA;
    varianceB += deltaB * deltaB;
  }
  if (varianceA < 1e-12 || varianceB < 1e-12) return 1;
  return covariance / Math.sqrt(varianceA * varianceB);
}

export async function renderAudioTreatment(
  sourcePath: string,
  outputPath: string,
  input: AudioTreatment,
) {
  const treatment = audioTreatmentSchema.parse(input);
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  const source = await inspectAudioContainer(sourcePath);
  if (
    treatment.sourceStartSeconds + treatment.durationSeconds >
    source.durationSeconds + 1 / Math.max(1, source.sampleRate)
  )
    throw new Error(
      `Audio treatment interval ${treatment.sourceStartSeconds.toFixed(3)}–${(
        treatment.sourceStartSeconds + treatment.durationSeconds
      ).toFixed(3)}s exceeds ${source.durationSeconds.toFixed(3)}s source`,
    );
  const compressorThreshold = 10 ** (treatment.compressor.thresholdDb / 20);
  const fadeOutStart = treatment.durationSeconds - treatment.fadeOutSeconds;
  const baseFilters = [
    `atrim=start=${treatment.sourceStartSeconds}:duration=${treatment.durationSeconds}`,
    'asetpts=PTS-STARTPTS',
    'aresample=48000',
    'aformat=sample_fmts=fltp:channel_layouts=stereo',
    `highpass=f=${treatment.highpassHz}`,
    `lowpass=f=${treatment.lowpassHz}`,
    `volume=${treatment.gainDb}dB`,
    `acompressor=threshold=${compressorThreshold}:ratio=${treatment.compressor.ratio}:attack=${treatment.compressor.attackMs}:release=${treatment.compressor.releaseMs}:makeup=1`,
    `extrastereo=m=${treatment.stereoWidth}:c=0`,
    ...(treatment.fadeInSeconds > 0 ? [`afade=t=in:st=0:d=${treatment.fadeInSeconds}`] : []),
    ...(treatment.fadeOutSeconds > 0
      ? [`afade=t=out:st=${fadeOutStart}:d=${treatment.fadeOutSeconds}`]
      : []),
    `apad=whole_dur=${treatment.durationSeconds}`,
    `atrim=duration=${treatment.durationSeconds}`,
  ];
  const accentInputs = treatment.accents.flatMap((accent) => {
    const duration = accent.endSeconds - accent.startSeconds;
    return accent.kind === 'tonal-accent'
      ? [
          '-f',
          'lavfi',
          '-i',
          `sine=frequency=${accent.frequencyHz}:duration=${duration}:sample_rate=48000`,
        ]
      : [
          '-f',
          'lavfi',
          '-i',
          `anoisesrc=color=white:amplitude=1:duration=${duration}:sample_rate=48000:seed=${accent.seed}`,
        ];
  });
  const filterGraph = [`[0:a]${baseFilters.join(',')}[base]`];
  treatment.accents.forEach((accent, index) => {
    const duration = accent.endSeconds - accent.startSeconds;
    const fade = Math.min(0.06, duration / 4);
    filterGraph.push(
      `[${index + 1}:a]${
        accent.kind === 'foley-noise' ? 'highpass=f=180,lowpass=f=6500,' : ''
      }volume=${accent.gain},afade=t=in:st=0:d=${fade},afade=t=out:st=${Math.max(
        0,
        duration - fade,
      )}:d=${fade},adelay=${Math.round(accent.startSeconds * 48000)}S:all=1[accent${index}]`,
    );
  });
  const mixInputs = ['[base]', ...treatment.accents.map((_, index) => `[accent${index}]`)].join('');
  filterGraph.push(
    `${mixInputs}amix=inputs=${treatment.accents.length + 1}:duration=longest:normalize=0,` +
      `loudnorm=I=${treatment.targetIntegratedLufs}:TP=${treatment.truePeakDb}:LRA=7,` +
      `apad=whole_dur=${treatment.durationSeconds},atrim=duration=${treatment.durationSeconds}[master]`,
  );
  await runBuffer('ffmpeg', [
    '-v',
    'error',
    '-i',
    resolve(sourcePath),
    ...accentInputs,
    '-filter_complex',
    filterGraph.join(';'),
    '-map',
    '[master]',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-c:a',
    'pcm_s24le',
    '-fflags',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    '-map_metadata',
    '-1',
    '-y',
    resolve(outputPath),
  ]);
  return resolve(outputPath);
}

export async function verifyAudioTreatment(
  sourcePath: string,
  adaptedPath: string,
  input: AudioTreatment,
) {
  const treatment = audioTreatmentSchema.parse(input);
  const [source, adapted, sourceSignal, adaptedSignal, sourceHash, adaptedHash] = await Promise.all(
    [
      inspectAudioContainer(sourcePath),
      inspectAudioContainer(adaptedPath),
      signalEnvelope(sourcePath, {
        startSeconds: treatment.sourceStartSeconds,
        durationSeconds: treatment.durationSeconds,
      }),
      signalEnvelope(adaptedPath),
      sha256File(sourcePath),
      sha256File(adaptedPath),
    ],
  );
  const temporary = await mkdtemp(join(tmpdir(), 'videoer-audio-treatment-verify-'));
  let deterministicRenderHash = '';
  let baseOnlySignal: Awaited<ReturnType<typeof signalEnvelope>> | undefined;
  try {
    const expected = join(temporary, 'expected.wav');
    const baseOnly = join(temporary, 'base-only.wav');
    await renderAudioTreatment(sourcePath, expected, treatment);
    await renderAudioTreatment(sourcePath, baseOnly, { ...treatment, accents: [] });
    deterministicRenderHash = await sha256File(expected);
    baseOnlySignal = await signalEnvelope(baseOnly);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  const durationErrorSeconds = Math.abs(adapted.durationSeconds - treatment.durationSeconds);
  const temporalEnvelopeCorrelation = envelopeCorrelation(
    sourceSignal.envelope,
    adaptedSignal.envelope,
  );
  const onsetDeltaSeconds =
    sourceSignal.firstActiveWindow < 0 || adaptedSignal.firstActiveWindow < 0
      ? Number.POSITIVE_INFINITY
      : Math.abs(sourceSignal.firstActiveWindow - adaptedSignal.firstActiveWindow) * 0.02;
  const endingDeltaSeconds =
    sourceSignal.lastActiveWindow < 0 || adaptedSignal.lastActiveWindow < 0
      ? Number.POSITIVE_INFINITY
      : Math.abs(sourceSignal.lastActiveWindow - adaptedSignal.lastActiveWindow) * 0.02;
  const maximumSamplePeak = 10 ** ((treatment.truePeakDb + 0.5) / 20);
  const accentContributions = treatment.accents.map((accent) => {
    const length = Math.min(adaptedSignal.samples.length, baseOnlySignal!.samples.length);
    const start = Math.max(0, Math.round(accent.startSeconds * 1000));
    const end = Math.min(length, Math.round(accent.endSeconds * 1000));
    const differences = Array.from(
      { length },
      (_, index) => adaptedSignal.samples[index]! - baseOnlySignal!.samples[index]!,
    );
    const inside = differences.slice(start, end);
    const outside = differences.filter((_, index) =>
      treatment.accents.every(
        (candidate) =>
          index < Math.round(candidate.startSeconds * 1000) ||
          index >= Math.round(candidate.endSeconds * 1000),
      ),
    );
    const rmsOf = (samples: number[]) =>
      Math.sqrt(
        samples.reduce((total, sample) => total + sample * sample, 0) / Math.max(1, samples.length),
      );
    const insideDifferenceRms = rmsOf(inside);
    const outsideDifferenceRms = rmsOf(outside);
    return {
      id: accent.id,
      startSample: Math.round(accent.startSeconds * 48000),
      endSample: Math.round(accent.endSeconds * 48000),
      insideDifferenceRms,
      outsideDifferenceRms,
      contributionOverOutsideDb:
        20 * Math.log10((insideDifferenceRms + 1e-9) / (outsideDifferenceRms + 1e-9)),
    };
  });
  const issues: string[] = [];
  if (durationErrorSeconds > 1 / 48000) issues.push('adapted duration differs from the contract');
  if (adapted.sampleRate !== 48000) issues.push('adapted sample rate is not 48 kHz');
  if (adapted.channels !== 2) issues.push('adapted output is not stereo');
  if (adapted.codec !== 'pcm_s24le') issues.push('adapted output is not 24-bit PCM');
  if (adaptedSignal.rms < 0.0005) issues.push('adapted output is effectively silent');
  if (adaptedSignal.peak > maximumSamplePeak)
    issues.push('adapted output exceeds the true-peak safety bound');
  if (temporalEnvelopeCorrelation < 0.72)
    issues.push('adapted output does not preserve the source temporal envelope');
  if (onsetDeltaSeconds > 0.06) issues.push('adapted output shifts the first meaningful onset');
  if (endingDeltaSeconds > Math.max(0.2, treatment.fadeOutSeconds + 0.04))
    issues.push('adapted output shifts the final meaningful activity');
  if (adaptedSignal.activeWindowFraction < 0.05)
    issues.push('adapted output contains too little meaningful activity');
  if (accentContributions.some((accent) => accent.contributionOverOutsideDb < 3))
    issues.push('one or more declared accents lacks measurable interval-local contribution');
  if (deterministicRenderHash !== adaptedHash)
    issues.push('adapted output does not match deterministic treatment rendering');
  return {
    valid: issues.length === 0,
    issues,
    treatment,
    source: { ...source, sha256: sourceHash },
    adapted: { ...adapted, sha256: adaptedHash },
    compatibility: {
      selectedIntervalPreserved: durationErrorSeconds <= 1 / 48000,
      sampleRatePreservedAt48kHz: adapted.sampleRate === 48000,
      stereoPreserved: adapted.channels === 2,
      temporalEnvelopePreserved: temporalEnvelopeCorrelation >= 0.72,
      accentSampleAlignmentPreserved: treatment.accents.every(
        (accent) => alignedToSample(accent.startSeconds) && alignedToSample(accent.endSeconds),
      ),
      declaredAccentsContribute: accentContributions.every(
        (accent) => accent.contributionOverOutsideDb >= 3,
      ),
      deterministicRenderMatched: deterministicRenderHash === adaptedHash,
    },
    metrics: {
      durationErrorSeconds,
      temporalEnvelopeCorrelation,
      onsetDeltaSeconds,
      endingDeltaSeconds,
      activeWindowFraction: adaptedSignal.activeWindowFraction,
      rms: adaptedSignal.rms,
      samplePeak: adaptedSignal.peak,
      deterministicRenderHash,
      accents: accentContributions,
    },
  };
}

export async function loadAudioTreatmentReport(path: string) {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as {
    treatment?: AudioTreatment;
  };
}
