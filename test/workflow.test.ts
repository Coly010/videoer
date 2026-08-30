import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { reviseShot } from '../src/application/workflow.js';
import { loadStoryboard } from '../src/domain/io.js';
import { chooseShotRenderMode } from '../src/application/storyboard-planning.js';
import { sceneKeyframeOpacity } from '../src/renderer/video.js';

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

describe('selective campaign workflow', () => {
  it('crossfades scene keyframes without exposing the template background', () => {
    const offsets = [0, 2];
    const transitionMiddle = 1.75;
    const outgoing = sceneKeyframeOpacity(transitionMiddle, 0, offsets, 0.5);
    const incoming = sceneKeyframeOpacity(transitionMiddle, 1, offsets, 0.5);
    expect(outgoing + incoming).toBeCloseTo(1, 5);
  });
  it('prefers scene-keyframes for a cinematic scene with intra-shot action', () => {
    expect(
      chooseShotRenderMode(
        { style: 'cinematic-fantasy' },
        { kind: 'scene', actionBeats: ['fire appears', 'creatures emerge'] },
      ),
    ).toBe('scene-keyframes');
    expect(
      chooseShotRenderMode(
        { style: 'cinematic-fantasy' },
        { kind: 'scene', actionBeats: ['establish castle'], hasStill: true },
      ),
    ).toBe('image-motion');
  });
  it('revises only the named shot and preserves the rest of the storyboard', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-workflow-'));
    await cp(resolve('campaigns/examples/saas-promo'), directory, { recursive: true });
    const campaign = join(directory, 'campaign.yaml');
    const before = await loadStoryboard(join(directory, 'storyboard.json'));
    const result = await reviseShot(campaign, 'hook', {
      text: 'MORE TIME TO TEACH',
      motion: 'slide-in',
    });
    const after = await loadStoryboard(join(directory, 'storyboard.json'));
    expect(result).toMatchObject({ shotId: 'hook', revision: 1, staleGeneratedAssets: false });
    expect(after.shots[0]).toMatchObject({
      text: 'MORE TIME TO TEACH',
      motion: 'slide-in',
      generation: { revision: 1 },
    });
    expect(after.shots.slice(1)).toEqual(before.shots.slice(1));
    expect(await readFile(join(directory, 'assets/dashboard-placeholder.svg'), 'utf8')).toContain(
      '<svg',
    );
  });
});
