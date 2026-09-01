import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { sha256File } from '../assets/library.js';

const layerBase = {
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  gain: z.number().positive().max(2),
  attackSeconds: z.number().nonnegative().max(2).default(0.005),
  releaseSeconds: z.number().nonnegative().max(3).default(0.08),
  pan: z.number().min(-1).max(1).default(0),
};

const soundEffectLayerSchema = z.discriminatedUnion('kind', [
  z.object({
    ...layerBase,
    kind: z.literal('noise'),
    seed: z.number().int(),
    color: z.enum(['white', 'pink', 'brown']),
    highpassHz: z.number().min(10).max(18000),
    lowpassHz: z.number().min(20).max(22000),
    modulationHz: z.number().nonnegative().max(40).default(0),
    modulationDepth: z.number().min(0).max(1).default(0),
  }),
  z.object({
    ...layerBase,
    kind: z.literal('tone'),
    frequencyHz: z.number().min(20).max(18000),
    endFrequencyHz: z.number().min(20).max(18000).optional(),
    waveform: z.enum(['sine', 'triangle']).default('sine'),
  }),
  z.object({
    ...layerBase,
    kind: z.literal('impulse-train'),
    seed: z.number().int(),
    eventRateHz: z.number().positive().max(200),
    decaySeconds: z.number().positive().max(1),
    frequencyHz: z.number().min(20).max(18000),
    frequencyJitter: z.number().min(0).max(1).default(0.15),
  }),
]);

export const soundEffectRecipeSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^audio\.sfx\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
    durationSeconds: z.number().positive().max(60),
    sampleRate: z.literal(48000),
    channels: z.literal(2),
    targetPeakDb: z.number().min(-12).max(-0.5).default(-3),
    layers: z.array(soundEffectLayerSchema).min(1),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((recipe, context) => {
    const ids = new Set<string>();
    recipe.layers.forEach((layer, index) => {
      if (ids.has(layer.id))
        context.addIssue({
          code: 'custom',
          path: ['layers', index, 'id'],
          message: 'sound-effect layer ids must be unique',
        });
      ids.add(layer.id);
      if (layer.startSeconds >= layer.endSeconds || layer.endSeconds > recipe.durationSeconds)
        context.addIssue({
          code: 'custom',
          path: ['layers', index],
          message: 'sound-effect layers require a positive interval inside the recipe',
        });
      if (layer.attackSeconds + layer.releaseSeconds > layer.endSeconds - layer.startSeconds)
        context.addIssue({
          code: 'custom',
          path: ['layers', index],
          message: 'sound-effect layer fades must fit inside its interval',
        });
      if (layer.kind === 'noise' && layer.lowpassHz <= layer.highpassHz)
        context.addIssue({
          code: 'custom',
          path: ['layers', index, 'lowpassHz'],
          message: 'noise lowpass must exceed highpass',
        });
    });
  });

export type SoundEffectRecipe = z.infer<typeof soundEffectRecipeSchema>;

function randomGenerator(seed: number) {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function envelope(localSeconds: number, duration: number, attack: number, release: number) {
  const attackGain = attack <= 0 ? 1 : Math.min(1, localSeconds / attack);
  const releaseGain = release <= 0 ? 1 : Math.min(1, (duration - localSeconds) / release);
  return Math.max(0, Math.min(attackGain, releaseGain));
}

function writePcm24Sample(buffer: Buffer, offset: number, value: number) {
  const integer = Math.max(-0x800000, Math.min(0x7fffff, Math.round(value * 0x7fffff)));
  buffer.writeUIntLE(integer < 0 ? integer + 0x1000000 : integer, offset, 3);
}

function wavBuffer(left: Float64Array, right: Float64Array, sampleRate: number) {
  const bytesPerSample = 3;
  const channels = 2;
  const dataBytes = left.length * channels * bytesPerSample;
  const output = Buffer.alloc(44 + dataBytes);
  output.write('RIFF', 0, 'ascii');
  output.writeUInt32LE(36 + dataBytes, 4);
  output.write('WAVE', 8, 'ascii');
  output.write('fmt ', 12, 'ascii');
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(channels, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  output.writeUInt16LE(channels * bytesPerSample, 32);
  output.writeUInt16LE(bytesPerSample * 8, 34);
  output.write('data', 36, 'ascii');
  output.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < left.length; index++) {
    const offset = 44 + index * channels * bytesPerSample;
    writePcm24Sample(output, offset, left[index]!);
    writePcm24Sample(output, offset + bytesPerSample, right[index]!);
  }
  return output;
}

function noiseSample(
  color: 'white' | 'pink' | 'brown',
  white: number,
  state: { pink: number; brown: number },
) {
  if (color === 'white') return white;
  if (color === 'brown') {
    state.brown = Math.max(-1, Math.min(1, state.brown * 0.994 + white * 0.055));
    return state.brown;
  }
  state.pink = state.pink * 0.965 + white * 0.12;
  return Math.max(-1, Math.min(1, state.pink));
}

function renderNoiseLayer(
  recipe: SoundEffectRecipe,
  layer: Extract<SoundEffectRecipe['layers'][number], { kind: 'noise' }>,
  left: Float64Array,
  right: Float64Array,
) {
  const random = randomGenerator(layer.seed);
  const start = Math.round(layer.startSeconds * recipe.sampleRate);
  const end = Math.round(layer.endSeconds * recipe.sampleRate);
  const duration = layer.endSeconds - layer.startSeconds;
  const lowAlpha = 1 - Math.exp((-2 * Math.PI * layer.lowpassHz) / recipe.sampleRate);
  const highAlpha = Math.exp((-2 * Math.PI * layer.highpassHz) / recipe.sampleRate);
  const colorState = { pink: 0, brown: 0 };
  // Four cascaded one-pole sections create useful material-band separation.
  // A single section only attenuates 6 dB/octave and left visibly broadband
  // leakage in the first door/footstep spectrograms.
  const highState = Array.from({ length: 4 }, () => ({ output: 0, input: 0 }));
  const lowState = [0, 0, 0, 0];
  const leftGain = Math.cos(((layer.pan + 1) * Math.PI) / 4);
  const rightGain = Math.sin(((layer.pan + 1) * Math.PI) / 4);
  for (let sample = start; sample < end; sample++) {
    const localSeconds = (sample - start) / recipe.sampleRate;
    const colored = noiseSample(layer.color, random() * 2 - 1, colorState);
    let filtered = colored;
    for (const state of highState) {
      const output = highAlpha * (state.output + filtered - state.input);
      state.input = filtered;
      state.output = output;
      filtered = output;
    }
    for (let stage = 0; stage < lowState.length; stage++) {
      lowState[stage] = lowState[stage]! + lowAlpha * (filtered - lowState[stage]!);
      filtered = lowState[stage]!;
    }
    const modulation =
      layer.modulationHz <= 0
        ? 1
        : 1 -
          layer.modulationDepth * 0.5 +
          Math.sin(localSeconds * layer.modulationHz * Math.PI * 2) * layer.modulationDepth * 0.5;
    const value =
      filtered *
      layer.gain *
      modulation *
      envelope(localSeconds, duration, layer.attackSeconds, layer.releaseSeconds);
    left[sample] = left[sample]! + value * leftGain;
    right[sample] = right[sample]! + value * rightGain;
  }
}

function renderToneLayer(
  recipe: SoundEffectRecipe,
  layer: Extract<SoundEffectRecipe['layers'][number], { kind: 'tone' }>,
  left: Float64Array,
  right: Float64Array,
) {
  const start = Math.round(layer.startSeconds * recipe.sampleRate);
  const end = Math.round(layer.endSeconds * recipe.sampleRate);
  const duration = layer.endSeconds - layer.startSeconds;
  const leftGain = Math.cos(((layer.pan + 1) * Math.PI) / 4);
  const rightGain = Math.sin(((layer.pan + 1) * Math.PI) / 4);
  let phase = 0;
  for (let sample = start; sample < end; sample++) {
    const localSeconds = (sample - start) / recipe.sampleRate;
    const progress = localSeconds / duration;
    const frequency =
      layer.frequencyHz +
      ((layer.endFrequencyHz ?? layer.frequencyHz) - layer.frequencyHz) * progress;
    phase += (frequency * Math.PI * 2) / recipe.sampleRate;
    const oscillator =
      layer.waveform === 'sine' ? Math.sin(phase) : (2 / Math.PI) * Math.asin(Math.sin(phase));
    const value =
      oscillator *
      layer.gain *
      envelope(localSeconds, duration, layer.attackSeconds, layer.releaseSeconds);
    left[sample] = left[sample]! + value * leftGain;
    right[sample] = right[sample]! + value * rightGain;
  }
}

function renderImpulseLayer(
  recipe: SoundEffectRecipe,
  layer: Extract<SoundEffectRecipe['layers'][number], { kind: 'impulse-train' }>,
  left: Float64Array,
  right: Float64Array,
) {
  const random = randomGenerator(layer.seed);
  const start = Math.round(layer.startSeconds * recipe.sampleRate);
  const end = Math.round(layer.endSeconds * recipe.sampleRate);
  const duration = layer.endSeconds - layer.startSeconds;
  const leftGain = Math.cos(((layer.pan + 1) * Math.PI) / 4);
  const rightGain = Math.sin(((layer.pan + 1) * Math.PI) / 4);
  const active: Array<{ age: number; amplitude: number; frequency: number }> = [];
  let nextEvent = 0;
  for (let sample = start; sample < end; sample++) {
    const localSeconds = (sample - start) / recipe.sampleRate;
    if (localSeconds >= nextEvent) {
      active.push({
        age: 0,
        amplitude: 0.55 + random() * 0.45,
        frequency: layer.frequencyHz * (1 + (random() * 2 - 1) * layer.frequencyJitter),
      });
      nextEvent += Math.max(
        1 / recipe.sampleRate,
        -Math.log(Math.max(1e-9, 1 - random())) / layer.eventRateHz,
      );
    }
    let value = 0;
    for (const event of active) {
      value +=
        event.amplitude *
        Math.exp(-event.age / layer.decaySeconds) *
        Math.sin(event.age * event.frequency * Math.PI * 2);
      event.age += 1 / recipe.sampleRate;
    }
    while (active.length && active[0]!.age > layer.decaySeconds * 8) active.shift();
    value *=
      layer.gain * envelope(localSeconds, duration, layer.attackSeconds, layer.releaseSeconds);
    left[sample] = left[sample]! + value * leftGain;
    right[sample] = right[sample]! + value * rightGain;
  }
}

export async function renderSoundEffectRecipe(input: SoundEffectRecipe, outputPath: string) {
  const recipe = soundEffectRecipeSchema.parse(input);
  const samples = Math.round(recipe.durationSeconds * recipe.sampleRate);
  const left = new Float64Array(samples);
  const right = new Float64Array(samples);
  for (const layer of recipe.layers) {
    if (layer.kind === 'noise') renderNoiseLayer(recipe, layer, left, right);
    else if (layer.kind === 'tone') renderToneLayer(recipe, layer, left, right);
    else renderImpulseLayer(recipe, layer, left, right);
  }
  let sourcePeak = 0;
  for (let index = 0; index < samples; index++)
    sourcePeak = Math.max(sourcePeak, Math.abs(left[index]!), Math.abs(right[index]!));
  if (sourcePeak <= 1e-9) throw new Error(`Sound-effect recipe '${recipe.id}' rendered silence`);
  const targetPeak = 10 ** (recipe.targetPeakDb / 20);
  const scale = targetPeak / sourcePeak;
  let sumSquares = 0;
  for (let index = 0; index < samples; index++) {
    left[index] = left[index]! * scale;
    right[index] = right[index]! * scale;
    sumSquares += left[index]! ** 2 + right[index]! ** 2;
  }
  const output = resolve(outputPath);
  await writeFile(output, wavBuffer(left, right, recipe.sampleRate));
  return {
    output,
    durationSeconds: recipe.durationSeconds,
    sampleRate: recipe.sampleRate,
    channels: recipe.channels,
    peak: targetPeak,
    rms: Math.sqrt(sumSquares / (samples * 2)),
    samples,
  };
}

export async function verifySoundEffectRecipe(input: SoundEffectRecipe, artifactPath: string) {
  const recipe = soundEffectRecipeSchema.parse(input);
  const temporary = await mkdtemp(join(tmpdir(), 'videoer-sfx-verify-'));
  try {
    const expected = join(temporary, 'expected.wav');
    const rendered = await renderSoundEffectRecipe(recipe, expected);
    const [expectedHash, artifactHash, artifact] = await Promise.all([
      sha256File(expected),
      sha256File(artifactPath),
      readFile(resolve(artifactPath)),
    ]);
    const riff = artifact.subarray(0, 4).toString('ascii') === 'RIFF';
    const wave = artifact.subarray(8, 12).toString('ascii') === 'WAVE';
    const expectedBytes = 44 + rendered.samples * recipe.channels * 3;
    return {
      valid:
        expectedHash === artifactHash &&
        riff &&
        wave &&
        artifact.length === expectedBytes &&
        rendered.rms > 1e-5,
      deterministic: expectedHash === artifactHash,
      expectedHash,
      artifactHash,
      durationSeconds: rendered.durationSeconds,
      sampleRate: rendered.sampleRate,
      channels: rendered.channels,
      peak: rendered.peak,
      rms: rendered.rms,
      pcmBits: 24,
      exactByteLength: artifact.length === expectedBytes,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
