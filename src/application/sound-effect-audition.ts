import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sha256File } from '../assets/library.js';
import { soundtrackPlanSchema } from '../audio/model.js';
import { inspectAudioDuration, renderSoundtrackPlan } from '../audio/render.js';
import { renderAudioEvidence } from './sound-effects.js';

const candidate = (root: string, slug: string) => resolve(root, slug, '0.1.0', `${slug}.wav`);

/**
 * Put isolated effects into a neutral miniature sound scene. The result is an
 * audition fixture, not an acceptance decision: ears still have to judge
 * material identity, scale, balance, repetition, and cinematic usefulness.
 */
export async function createSoundEffectAudition(candidateRoot: string, outputDirectory: string) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const sources = {
    rain: candidate(candidateRoot, 'rain-on-stone-ambience'),
    door: candidate(candidateRoot, 'wooden-door-open'),
    page: candidate(candidateRoot, 'page-turn-parchment'),
    footstep: candidate(candidateRoot, 'footstep-wet-stone'),
  };
  const plan = soundtrackPlanSchema.parse({
    schemaVersion: 1,
    id: 'audio.sfx-production-audition',
    durationSeconds: 8,
    sampleRate: 48000,
    channels: 2,
    metadata: {
      purpose: 'representative-mix audition for reusable ambience and foley candidates',
      qualitativeStatus: 'requires-auditory-review',
      scene: 'rainy stone threshold, wooden door, two steps, parchment page',
    },
    cues: [
      {
        id: 'rain-bed',
        kind: 'audio-source',
        source: 'rain',
        startSeconds: 0,
        endSeconds: 8,
        gain: 0.34,
        purpose: 'continuous exterior rain perspective',
      },
      {
        id: 'low-room-tone',
        kind: 'tone-bed',
        startSeconds: 0,
        endSeconds: 8,
        gain: 0.018,
        frequencyHz: 55,
        purpose: 'restrained low-frequency room weight',
      },
      {
        id: 'upper-room-tone',
        kind: 'tone-bed',
        startSeconds: 0,
        endSeconds: 8,
        gain: 0.006,
        frequencyHz: 164.81,
        purpose: 'subtle non-melodic tonal coherence',
      },
      {
        id: 'door-open',
        kind: 'audio-source',
        source: 'door',
        startSeconds: 0.72,
        endSeconds: 2.22,
        gain: 0.7,
        purpose: 'foreground wooden threshold action',
      },
      {
        id: 'left-step',
        kind: 'audio-source',
        source: 'footstep',
        startSeconds: 2.72,
        endSeconds: 3.44,
        gain: 0.72,
        purpose: 'first wet-stone foot contact',
      },
      {
        id: 'right-step',
        kind: 'audio-source',
        source: 'footstep',
        startSeconds: 3.58,
        endSeconds: 4.3,
        gain: 0.62,
        purpose: 'second wet-stone foot contact at varied level',
      },
      {
        id: 'page-turn',
        kind: 'audio-source',
        source: 'page',
        startSeconds: 5.62,
        endSeconds: 6.57,
        gain: 0.78,
        purpose: 'foreground parchment handling',
      },
    ],
  });
  const planFile = join(output, 'audition-plan.json');
  const master = join(output, 'sfx-production-audition.wav');
  const waveform = join(output, 'waveform.png');
  const spectrogram = join(output, 'spectrogram.png');
  const reportFile = join(output, 'audition-verification.json');
  await writeFile(planFile, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

  const temporary = await mkdtemp(join(tmpdir(), 'videoer-sfx-audition-'));
  try {
    const comparison = join(temporary, 'comparison.wav');
    const renderOptions = {
      integratedLufs: -18,
      truePeakDb: -1.5,
      loudnessRange: 7,
      audioSources: sources,
    };
    await renderSoundtrackPlan(plan, master, renderOptions);
    await renderSoundtrackPlan(plan, comparison, renderOptions);
    const [masterSha256, comparisonSha256, durationSeconds, sourceEntries] = await Promise.all([
      sha256File(master),
      sha256File(comparison),
      inspectAudioDuration(master),
      Promise.all(
        Object.entries(sources).map(async ([id, path]) => ({
          id,
          path,
          sha256: await sha256File(path),
        })),
      ),
    ]);
    if (masterSha256 !== comparisonSha256)
      throw new Error('Sound-effect audition did not rerender byte-identically');
    if (Math.abs(durationSeconds - plan.durationSeconds) > 1 / plan.sampleRate)
      throw new Error(`Sound-effect audition duration ${durationSeconds}s is not sample-exact`);
    await renderAudioEvidence(master, waveform, spectrogram);
    const report = {
      schemaVersion: 1,
      id: plan.id,
      status: 'technically-validated-awaiting-auditory-review',
      qualitativeStatus: 'not-accepted',
      durationSeconds,
      sampleRate: plan.sampleRate,
      channels: plan.channels,
      masterSha256,
      deterministicRerenderSha256: comparisonSha256,
      deterministic: true,
      sources: sourceEntries,
      reviewQuestions: [
        'Does the rain read as spatial rain striking stone rather than filtered static?',
        'Does the door read as latch, moving wooden mass, hinge friction, and stop without synthetic buzzing?',
        'Do the footsteps read as two grounded wet-stone contacts without machine-gun repetition?',
        'Does the page read as lift, travel, and settle rather than broadband hiss?',
        'Do all foreground effects remain intelligible at representative mix levels?',
      ],
    };
    await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return {
      output,
      master,
      plan: planFile,
      waveform,
      spectrogram,
      report: reportFile,
      verification: report,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
