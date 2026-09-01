import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import { englishVisemeTargets } from '../characters/speech-rig.js';
import { motionClipSchema, type MotionClip } from '../motion/model.js';

const exec = promisify(execFile);

export const speechVoiceSchema = z.object({
  voice: z.string().min(1).default('en+f3'),
  rate: z.number().int().min(80).max(450).default(150),
  pitch: z.number().int().min(0).max(99).default(45),
});

export type SpeechVoice = z.input<typeof speechVoiceSchema>;

export interface SpeechEvent {
  type: 'phoneme' | 'word' | 'end';
  audioPositionMs: number;
  textPosition: number;
  phoneme?: string;
  length?: number;
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveEspeakPrefix() {
  if (process.env.VIDEOER_ESPEAK_NG_PREFIX) return resolve(process.env.VIDEOER_ESPEAK_NG_PREFIX);
  try {
    const result = await exec('brew', ['--prefix', 'espeak-ng']);
    return result.stdout.trim();
  } catch {
    for (const candidate of ['/usr', '/usr/local'])
      if (await exists(join(candidate, 'include/espeak-ng/speak_lib.h'))) return candidate;
  }
  throw new Error(
    'eSpeak NG development files are required; install Homebrew espeak-ng or set VIDEOER_ESPEAK_NG_PREFIX',
  );
}

export async function ensureEspeakTimingHelper(outputDirectory: string) {
  const output = resolve(outputDirectory, 'videoer-espeak-events');
  const source = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../scripts/speech/espeak_events.c',
  );
  await mkdir(dirname(output), { recursive: true });
  const prefix = await resolveEspeakPrefix();
  const sourceModified = (await stat(source)).mtimeMs;
  const outputModified = (await stat(output).catch(() => undefined))?.mtimeMs ?? 0;
  if (outputModified < sourceModified)
    await exec('cc', [
      `-I${join(prefix, 'include')}`,
      source,
      `-L${join(prefix, 'lib')}`,
      '-lespeak-ng',
      `-Wl,-rpath,${join(prefix, 'lib')}`,
      '-o',
      output,
    ]);
  return output;
}

export async function extractSpeechEvents(
  text: string,
  voiceInput: SpeechVoice,
  toolsDirectory: string,
) {
  if (!text.trim()) throw new Error('Speech text cannot be empty');
  const voice = speechVoiceSchema.parse(voiceInput);
  const helper = await ensureEspeakTimingHelper(toolsDirectory);
  const result = await exec(helper, [voice.voice, String(voice.rate), String(voice.pitch), text], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SpeechEvent);
}

export async function renderSpeechWav(text: string, voiceInput: SpeechVoice, outputPath: string) {
  const voice = speechVoiceSchema.parse(voiceInput);
  const output = resolve(outputPath);
  await mkdir(dirname(output), { recursive: true });
  await exec(
    'espeak-ng',
    [
      '-D',
      '-v',
      voice.voice,
      '-s',
      String(voice.rate),
      '-p',
      String(voice.pitch),
      '-w',
      output,
      text,
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  return output;
}

export type EnglishViseme = (typeof englishVisemeTargets)[number] | 'rest';

export function phonemeToEnglishViseme(phoneme: string): EnglishViseme {
  const value = phoneme.replace(/[',:]/g, '');
  if (!value || value.startsWith('_')) return 'rest';
  if (/^[mpb]/i.test(value)) return 'viseme-mbp';
  if (/^[fv]/i.test(value)) return 'viseme-fv';
  if (/^(o|O|u|U|w)/.test(value)) return 'viseme-oh';
  if (/^(i|I|e|E|j)/.test(value)) return 'viseme-ee';
  if (/^(a|A|@|3|V)/.test(value)) return 'viseme-aa';
  if (/^(l|r|D|T)/.test(value)) return 'viseme-aa';
  return 'rest';
}

export function createVisemeMotion(input: {
  id: string;
  text: string;
  events: SpeechEvent[];
  durationSeconds: number;
  fps: number;
  voice: SpeechVoice;
}): MotionClip {
  if (!Number.isFinite(input.fps) || input.fps <= 0)
    throw new Error('Speech performance frame rate must be positive and finite');
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0)
    throw new Error('Speech performance duration must be positive and finite');
  const voice = speechVoiceSchema.parse(input.voice);
  const frameCount = Math.round(input.durationSeconds * input.fps);
  if (Math.abs(frameCount / input.fps - input.durationSeconds) > 1e-8)
    throw new Error('Speech performance duration must resolve to an exact frame count');
  const phonemes = input.events.filter(
    (event): event is SpeechEvent & { type: 'phoneme'; phoneme: string } =>
      event.type === 'phoneme' && Boolean(event.phoneme),
  );
  const weights = new Map(
    englishVisemeTargets.map((target) => [target, Array(frameCount + 1).fill(0)]),
  );
  const quantized = phonemes.map((event, index) => {
    const start = Math.max(0, event.audioPositionMs / 1000);
    const end = Math.min(
      input.durationSeconds,
      (phonemes[index + 1]?.audioPositionMs ?? input.durationSeconds * 1000) / 1000,
    );
    return { phoneme: event.phoneme, viseme: phonemeToEnglishViseme(event.phoneme), start, end };
  });
  for (let frame = 0; frame <= frameCount; frame++) {
    const seconds = frame / input.fps;
    const active = quantized.find((event) => seconds >= event.start && seconds < event.end);
    if (!active || active.viseme === 'rest') continue;
    const ramp = Math.min(0.045, Math.max(0.015, (active.end - active.start) / 3));
    const attack = Math.min(1, (seconds - active.start) / ramp);
    const release = Math.min(1, (active.end - seconds) / ramp);
    weights.get(active.viseme)![frame] = Math.max(0, Math.min(1, attack, release));
  }
  return motionClipSchema.parse({
    schemaVersion: 1,
    id: input.id,
    skeleton: 'videoer.canonical-humanoid.v1',
    durationSeconds: input.durationSeconds,
    loop: false,
    tracks: [],
    morphTracks: englishVisemeTargets.map((target) => ({
      target,
      property: 'weight',
      keyframes: weights.get(target)!.map((value, frame) => ({
        time: frame / input.fps,
        value,
        easing: 'linear' as const,
      })),
    })),
    metadata: {
      generator: 'videoer.espeak-viseme.v1',
      engine: 'espeak-ng',
      text: input.text,
      voice,
      fps: input.fps,
      phonemes: quantized,
      words: input.events.filter((event) => event.type === 'word'),
    },
  });
}

export function verifyVisemeMotion(clip: MotionClip) {
  const parsed = motionClipSchema.parse(clip);
  const phonemes = Array.isArray(parsed.metadata.phonemes)
    ? (parsed.metadata.phonemes as Array<{ viseme?: string; start?: number; end?: number }>)
    : [];
  const fps = Number(parsed.metadata.fps);
  const issues: string[] = [];
  const validFps = Number.isFinite(fps) && fps > 0;
  const targets = new Set(parsed.morphTracks.map((track) => track.target));
  for (const target of englishVisemeTargets)
    if (!targets.has(target)) issues.push(`missing canonical morph track '${target}'`);
  const activeVisemes = new Set(
    parsed.morphTracks
      .filter((track) => Math.max(...track.keyframes.map((keyframe) => keyframe.value)) >= 0.5)
      .map((track) => track.target),
  );
  if (activeVisemes.size < 3) issues.push('speech performance exercises fewer than three visemes');
  const timed = phonemes.filter(
    (event) =>
      event.viseme &&
      event.viseme !== 'rest' &&
      typeof event.start === 'number' &&
      typeof event.end === 'number',
  );
  const maximumOnsetQuantizationSeconds = validFps
    ? timed.reduce((maximum, event) => {
        const frame = Math.round(event.start! * fps);
        return Math.max(maximum, Math.abs(frame / fps - event.start!));
      }, 0)
    : Number.POSITIVE_INFINITY;
  if (!validFps) issues.push('speech performance lacks a valid frame rate');
  if (validFps && maximumOnsetQuantizationSeconds > 1 / fps + 1e-8)
    issues.push('viseme onset exceeds one-frame sync tolerance');
  return {
    valid: issues.length === 0,
    issues,
    checks: {
      phonemeCount: phonemes.length,
      activeVisemes: [...activeVisemes],
      maximumOnsetQuantizationSeconds,
      toleranceSeconds: validFps ? 1 / fps : null,
      exactFrameGrid:
        validFps &&
        parsed.morphTracks.every(
          (track) =>
            track.keyframes.length === Math.round(parsed.durationSeconds * fps) + 1 &&
            track.keyframes.every(
              (keyframe, frame) => Math.abs(keyframe.time - frame / fps) <= 1e-8,
            ),
        ),
    },
  };
}
