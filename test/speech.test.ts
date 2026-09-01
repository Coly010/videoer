import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEnglishSpeechMorphRig } from '../src/characters/speech-rig.js';
import { createHumanoidMannequin } from '../src/characters/mannequin.js';
import { validateMotionClip } from '../src/motion/model.js';
import {
  createVisemeMotion,
  extractSpeechEvents,
  phonemeToEnglishViseme,
  renderSpeechWav,
  verifyVisemeMotion,
} from '../src/speech/espeak.js';

const voice = { voice: 'en+f3', rate: 150, pitch: 45 } as const;

describe('provider-free speech performance', () => {
  it('maps eSpeak phonemes to the canonical English viseme vocabulary', () => {
    expect(phonemeToEnglishViseme('m')).toBe('viseme-mbp');
    expect(phonemeToEnglishViseme('f')).toBe('viseme-fv');
    expect(phonemeToEnglishViseme('oU')).toBe('viseme-oh');
    expect(phonemeToEnglishViseme('i:')).toBe('viseme-ee');
    expect(phonemeToEnglishViseme('aI')).toBe('viseme-aa');
    expect(phonemeToEnglishViseme('_')).toBe('rest');
  });

  it('turns exact native phoneme events into frame-exact compatible morph motion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'videoer-speech-'));
    const text = 'The next train leaves at midnight.';
    const events = await extractSpeechEvents(text, voice, join(root, 'tools'));
    const wav = await renderSpeechWav(text, voice, join(root, 'speech.wav'));
    expect((await readFile(wav)).subarray(0, 4).toString()).toBe('RIFF');
    expect(events.filter((event) => event.type === 'phoneme').length).toBeGreaterThan(10);
    expect(
      events.every(
        (event, index) =>
          index === 0 || event.audioPositionMs >= events[index - 1]!.audioPositionMs,
      ),
    ).toBe(true);

    const durationSeconds = 2.5;
    const clip = createVisemeMotion({
      id: 'motion.dialogue-test',
      text,
      events,
      durationSeconds,
      fps: 24,
      voice,
    });
    const geometry = createEnglishSpeechMorphRig(
      createHumanoidMannequin(
        {},
        {
          skin: [0.62, 0.38, 0.27, 1],
          hair: [0.022, 0.009, 0.006, 1],
          eyes: [0.035, 0.11, 0.095, 1],
          dress: [0.012, 0.018, 0.04, 1],
          leather: [0.018, 0.014, 0.012, 1],
        },
      ),
    );
    const verification = verifyVisemeMotion(clip);
    expect(verification.valid, verification.issues.join('\n')).toBe(true);
    expect(verification.checks.exactFrameGrid).toBe(true);
    expect(verification.checks.maximumOnsetQuantizationSeconds).toBeLessThanOrEqual(1 / 24);
    expect(validateMotionClip(clip, geometry).valid).toBe(true);
  }, 20_000);
});
