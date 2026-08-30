import { describe, expect, it } from 'vitest';
import { campaignSchema, storyboardSchema } from '../src/domain/schemas.js';
describe('schemas', () => {
  it('defaults campaign output and providers', () => {
    const c = campaignSchema.parse({
      schemaVersion: 1,
      id: 'x',
      title: 'X',
      type: 'book',
      style: 'cinematic-fantasy',
      durationSeconds: 18,
      targetAudience: 'readers',
      description: 'story',
      tone: ['epic'],
      cta: 'Read',
    });
    expect(c.output.fps).toBe(60);
    expect(c.providers).toEqual({});
  });
  it('rejects duplicate shot ids', () => {
    const shot = {
      id: 'same',
      type: 'cta',
      startSeconds: 0,
      durationSeconds: 1,
      motion: 'static',
      transition: 'cut',
    };
    expect(() =>
      storyboardSchema.parse({
        schemaVersion: 1,
        campaignId: 'x',
        title: 'x',
        durationSeconds: 2,
        style: 'saas-promo',
        shots: [shot, { ...shot, startSeconds: 1 }],
      }),
    ).toThrow(/duplicate/);
  });
  it('rejects overflowing shots', () =>
    expect(() =>
      storyboardSchema.parse({
        schemaVersion: 1,
        campaignId: 'x',
        title: 'x',
        durationSeconds: 1,
        style: 'saas-promo',
        shots: [{ id: 'a', type: 'cta', startSeconds: 0, durationSeconds: 2 }],
      }),
    ).toThrow(/beyond/));
  it('accepts a continuity-aware scene-keyframes shot', () => {
    const storyboard = storyboardSchema.parse({
      schemaVersion: 1,
      campaignId: 'x',
      title: 'scene',
      durationSeconds: 4,
      style: 'cinematic-fantasy',
      shots: [
        {
          id: 'ritual',
          type: 'scene-keyframes',
          startSeconds: 0,
          durationSeconds: 4,
          prompt: 'A mage completes a forbidden ritual',
          keyframes: [
            { id: 'anchor', role: 'anchor', timeOffset: 0, description: 'The mage raises a staff' },
            {
              id: 'reveal',
              role: 'reveal',
              timeOffset: 2.5,
              description: 'Black fire reveals a demon',
            },
          ],
        },
      ],
    });
    expect(storyboard.shots[0]).toMatchObject({
      type: 'scene-keyframes',
      continuity: { lockBackground: true, lockCharacterIdentity: true },
      sceneMotion: { blend: 'crossfade', camera: 'push-in' },
    });
  });
  it('rejects unordered scene keyframes and anchors that do not start the shot', () => {
    expect(() =>
      storyboardSchema.parse({
        schemaVersion: 1,
        campaignId: 'x',
        title: 'bad scene',
        durationSeconds: 4,
        style: 'cinematic-fantasy',
        shots: [
          {
            id: 'ritual',
            type: 'scene-keyframes',
            startSeconds: 0,
            durationSeconds: 4,
            prompt: 'Ritual',
            keyframes: [
              { id: 'later', role: 'continuation', timeOffset: 1, description: 'Later' },
              { id: 'anchor', role: 'anchor', timeOffset: 0.5, description: 'Earlier' },
            ],
          },
        ],
      }),
    ).toThrow(/first keyframe|strictly increasing|exactly one anchor/);
  });
});
