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
    expect(c.output.fps).toBe(30);
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
});
