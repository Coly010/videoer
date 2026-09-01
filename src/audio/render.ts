import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { SoundtrackPlan } from './model.js';
import { renderSpeechWav } from '../speech/espeak.js';

const exec = promisify(execFile);

function cueInput(cue: SoundtrackPlan['cues'][number], sampleRate: number) {
  const duration = cue.endSeconds - cue.startSeconds;
  if (cue.kind === 'tone-bed' || cue.kind === 'tonal-accent')
    return `sine=frequency=${cue.frequencyHz}:duration=${duration}:sample_rate=${sampleRate}`;
  const color = cue.kind === 'noise-bed' ? 'pink' : 'white';
  return `anoisesrc=color=${color}:amplitude=1:duration=${duration}:sample_rate=${sampleRate}:seed=${cue.seed}`;
}

export async function inspectAudioDuration(path: string) {
  const result = await exec('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    path,
  ]);
  const duration = Number(result.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error(`Unable to determine duration of speech source '${path}'`);
  return duration;
}

function cueFilter(cue: SoundtrackPlan['cues'][number], index: number) {
  const duration = cue.endSeconds - cue.startSeconds;
  const fade = Math.min(0.12, duration / 4);
  const filters = [
    ...(cue.kind === 'speech' || cue.kind === 'audio-source'
      ? [`apad=whole_dur=${duration}`, `atrim=duration=${duration}`]
      : []),
    `volume=${cue.gain}`,
    `afade=t=in:st=0:d=${fade}`,
    `afade=t=out:st=${Math.max(0, duration - fade)}:d=${fade}`,
    // Normalize every source to the delivery layout before mixing. Procedural
    // and speech cues are upmixed, while reusable stereo sources retain their
    // independent left/right content.
    `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo`,
  ];
  if (cue.kind === 'noise-bed') filters.unshift('highpass=f=80', 'lowpass=f=8000');
  if (cue.kind === 'foley-noise') filters.unshift('highpass=f=180', 'lowpass=f=6500');
  if (cue.startSeconds > 0) filters.push(`adelay=${Math.round(cue.startSeconds * 1000)}:all=1`);
  return `[${index}:a]${filters.join(',')}[cue${index}]`;
}

/** Render any validated soundtrack plan without a provider or campaign-specific filter graph. */
export async function renderSoundtrackPlan(
  plan: SoundtrackPlan,
  outputPath: string,
  options: {
    integratedLufs?: number;
    truePeakDb?: number;
    loudnessRange?: number;
    speechSources?: Record<string, string>;
    audioSources?: Record<string, string>;
  } = {},
) {
  const output = resolve(outputPath);
  await mkdir(dirname(output), { recursive: true });
  const temporary = await mkdtemp(join(tmpdir(), 'videoer-soundtrack-'));
  try {
    const inputs = await Promise.all(
      plan.cues.map(async (cue, index) => {
        if (cue.kind !== 'speech' && cue.kind !== 'audio-source')
          return ['-f', 'lavfi', '-i', cueInput(cue, plan.sampleRate)];
        if (cue.kind === 'audio-source') {
          const path = cue.source ? options.audioSources?.[cue.source] : undefined;
          if (!path)
            throw new Error(`Audio cue '${cue.id}' has no resolved source '${cue.source}'`);
          const sourceDuration = await inspectAudioDuration(path);
          const interval = cue.endSeconds - cue.startSeconds;
          if (sourceDuration > interval + 1 / plan.sampleRate)
            throw new Error(
              `Audio cue '${cue.id}' source is ${sourceDuration.toFixed(3)}s but its interval is only ${interval.toFixed(3)}s`,
            );
          return ['-i', resolve(path)];
        }
        const supplied = options.speechSources?.[cue.id];
        const path = supplied
          ? resolve(supplied)
          : join(temporary, `${String(index).padStart(3, '0')}-${cue.id}.wav`);
        if (!supplied)
          await renderSpeechWav(
            cue.text!,
            { voice: cue.voice!, rate: cue.rate!, pitch: cue.pitch! },
            path,
          );
        const sourceDuration = await inspectAudioDuration(path);
        const interval = cue.endSeconds - cue.startSeconds;
        if (sourceDuration > interval + 1 / plan.sampleRate)
          throw new Error(
            `Speech cue '${cue.id}' is ${sourceDuration.toFixed(3)}s but its interval is only ${interval.toFixed(3)}s; increase the interval or speech rate`,
          );
        return ['-i', path];
      }),
    );
    const filters = plan.cues.map(cueFilter);
    const labels = plan.cues.map((_, index) => `[cue${index}]`).join('');
    filters.push(
      `${labels}amix=inputs=${plan.cues.length}:duration=longest:normalize=0,` +
        `apad=whole_dur=${plan.durationSeconds},atrim=duration=${plan.durationSeconds},` +
        `loudnorm=I=${options.integratedLufs ?? -18}:` +
        `TP=${options.truePeakDb ?? -1.5}:LRA=${options.loudnessRange ?? 7}[master]`,
    );
    await exec(
      'ffmpeg',
      [
        '-v',
        'error',
        ...inputs.flat(),
        '-filter_complex',
        filters.join(';'),
        '-map',
        '[master]',
        '-t',
        String(plan.durationSeconds),
        '-ar',
        String(plan.sampleRate),
        '-ac',
        String(plan.channels),
        '-c:a',
        'pcm_s24le',
        '-y',
        output,
      ],
      { maxBuffer: 30 * 1024 * 1024 },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return output;
}
