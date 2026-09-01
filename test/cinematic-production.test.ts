import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { deriveCinematicProductionPlan } from '../src/application/cinematic-production.js';
import { fingerprintCinematicScene } from '../src/cinematic/fingerprint.js';
import {
  cinematicProductionReviewSchema,
  selectCinematicProductionWork,
  selectStaleProductionShots,
} from '../src/production/autonomous-run.js';
import { loadDeclarativeCinematicCampaign } from '../src/production/cinematic-campaign-io.js';

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

describe('autonomous cinematic production loop', () => {
  it('derives an inspectable renderer-independent plan with reusable asset requirements', async () => {
    const campaign = await loadDeclarativeCinematicCampaign(
      resolve('campaigns/nocturne-programme-announcement-reuse/cinematic-campaign.yaml'),
    );
    const plan = deriveCinematicProductionPlan(campaign);
    expect(plan.campaignId).toBe('campaign.nocturne-programme-announcement');
    expect(plan.shots).toHaveLength(1);
    expect(plan.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'geometry-programme-stage', acquisition: 'create' }),
        expect.objectContaining({
          id: 'lighting-gallery-lighting',
          acquisition: 'unresolved',
          preferredAsset: { id: 'lighting.nocturne-gallery', version: '1.0.0' },
        }),
        expect.objectContaining({
          id: 'editorial-event-identity',
          acquisition: 'unresolved',
          preferredAsset: { id: 'editorial.nocturne-event-lockup', version: '1.0.0' },
        }),
      ]),
    );
    expect(plan.shots[0]!.requirements).toEqual(
      expect.arrayContaining([
        'geometry-programme-stage',
        'lighting-gallery-lighting',
        'editorial-event-identity',
        'audio-soundtrack',
      ]),
    );
  });

  it('fingerprints referenced artifacts so dependency changes invalidate the consuming shot', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-production-fingerprint-'));
    const original = resolve(
      'campaigns/nocturne-programme-announcement-reuse/work/scenes/programme-identity/scene.json',
    );
    const originalDirectory = dirname(original);
    const scene = JSON.parse(await readFile(original, 'utf8'));
    scene.entities = scene.entities.map(
      (entity: { geometryPath: string; motion?: { path: string } }) => ({
        ...entity,
        geometryPath: resolve(originalDirectory, entity.geometryPath),
        ...(entity.motion
          ? { motion: { ...entity.motion, path: resolve(originalDirectory, entity.motion.path) } }
          : {}),
      }),
    );
    const overlay = join(directory, 'overlay.png');
    await writeFile(overlay, 'first persisted overlay', 'utf8');
    scene.overlays = scene.overlays.map((item: Record<string, unknown>) => ({
      ...item,
      imagePath: overlay,
    }));
    const sceneFile = join(directory, 'scene.json');
    await writeFile(sceneFile, `${JSON.stringify(scene, null, 2)}\n`, 'utf8');
    const first = await fingerprintCinematicScene(sceneFile);
    scene.landmarks[1].description = 'Evidence wording changed without changing pixels';
    await writeFile(sceneFile, `${JSON.stringify(scene, null, 2)}\n`, 'utf8');
    const evidenceOnly = await fingerprintCinematicScene(sceneFile);
    expect(evidenceOnly.renderSha256).toBe(first.renderSha256);
    expect(evidenceOnly.sha256).not.toBe(first.sha256);
    await writeFile(overlay, 'changed persisted overlay', 'utf8');
    const second = await fingerprintCinematicScene(sceneFile);
    expect(second.renderSha256).not.toBe(evidenceOnly.renderSha256);
    expect(second.sha256).not.toBe(evidenceOnly.sha256);

    const finishProfile = join(directory, 'finish.json');
    await writeFile(finishProfile, '{"finish":"first"}\n', 'utf8');
    scene.finishProfilePath = finishProfile;
    await writeFile(sceneFile, `${JSON.stringify(scene, null, 2)}\n`, 'utf8');
    const withFinish = await fingerprintCinematicScene(sceneFile);
    await writeFile(finishProfile, '{"finish":"changed"}\n', 'utf8');
    const changedFinish = await fingerprintCinematicScene(sceneFile);
    expect(changedFinish.renderSha256).not.toBe(withFinish.renderSha256);

    const rigProfile = join(directory, 'production-rig-profile.json');
    await writeFile(rigProfile, '{"profile":"first"}\n', 'utf8');
    scene.entities[0].productionRigProfilePath = rigProfile;
    await writeFile(sceneFile, `${JSON.stringify(scene, null, 2)}\n`, 'utf8');
    const withProductionRig = await fingerprintCinematicScene(sceneFile);
    expect(withProductionRig.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'production-rig-profile:programme-stage' }),
      ]),
    );
    await writeFile(rigProfile, '{"profile":"changed"}\n', 'utf8');
    const changedProductionRig = await fingerprintCinematicScene(sceneFile);
    expect(changedProductionRig.renderSha256).not.toBe(withProductionRig.renderSha256);
  });

  it('separates pixel rendering from evidence-only refresh work', () => {
    expect(
      selectCinematicProductionWork(
        [
          { id: 'stable', inputSha256: 'a', renderInputSha256: 'ra' },
          { id: 'evidence', inputSha256: 'b2', renderInputSha256: 'rb' },
          { id: 'pixels', inputSha256: 'c2', renderInputSha256: 'rc2' },
        ],
        [
          {
            id: 'stable',
            inputSha256: 'a',
            renderInputSha256: 'ra',
            status: 'pass',
            videoAvailable: true,
            evidenceAvailable: true,
          },
          {
            id: 'evidence',
            inputSha256: 'b1',
            renderInputSha256: 'rb',
            status: 'pass',
            videoAvailable: true,
            evidenceAvailable: true,
          },
          {
            id: 'pixels',
            inputSha256: 'c1',
            renderInputSha256: 'rc1',
            status: 'pass',
            videoAvailable: true,
            evidenceAvailable: true,
          },
        ],
      ),
    ).toEqual({
      renderShots: ['pixels'],
      evidenceShots: ['evidence', 'pixels'],
      evidenceOnlyShots: ['evidence'],
    });
    expect(
      selectCinematicProductionWork(
        [{ id: 'shot', inputSha256: 'a', renderInputSha256: 'ra' }],
        [
          {
            id: 'shot',
            inputSha256: 'a',
            renderInputSha256: 'ra',
            status: 'pass',
            videoAvailable: false,
            evidenceAvailable: true,
          },
        ],
      ),
    ).toEqual({
      renderShots: ['shot'],
      evidenceShots: ['shot'],
      evidenceOnlyShots: [],
    });
    expect(
      selectCinematicProductionWork(
        [{ id: 'shot', inputSha256: 'a', renderInputSha256: 'ra' }],
        [
          {
            id: 'shot',
            inputSha256: 'a',
            renderInputSha256: 'ra',
            status: 'pass',
            videoAvailable: true,
            evidenceAvailable: false,
          },
        ],
      ),
    ).toEqual({
      renderShots: [],
      evidenceShots: ['shot'],
      evidenceOnlyShots: ['shot'],
    });
  });

  it('selects changed, failed, missing, and explicitly requested shots without rerendering valid peers', () => {
    expect(
      selectStaleProductionShots(
        [
          { id: 'stable', inputSha256: 'a' },
          { id: 'changed', inputSha256: 'b2' },
          { id: 'failed', inputSha256: 'c' },
          { id: 'new', inputSha256: 'd' },
        ],
        [
          { id: 'stable', inputSha256: 'a', status: 'pass' },
          { id: 'changed', inputSha256: 'b1', status: 'pass' },
          { id: 'failed', inputSha256: 'c', status: 'fail' },
        ],
        ['stable'],
      ),
    ).toEqual(['stable', 'changed', 'failed', 'new']);
    expect(
      selectStaleProductionShots(
        [
          { id: 'stable', inputSha256: 'a' },
          { id: 'peer', inputSha256: 'b' },
        ],
        [
          { id: 'stable', inputSha256: 'a', status: 'pass' },
          { id: 'peer', inputSha256: 'b', status: 'pass' },
        ],
      ),
    ).toEqual([]);
  });

  it('requires complete qualitative review and concrete repair instructions for failures', () => {
    const hash = 'a'.repeat(64);
    const valid = {
      schemaVersion: 1,
      campaignId: 'campaign.fixture',
      sourceSha256: hash,
      reviewer: 'codex',
      reviewedAt: '2026-08-31T08:00:00.000Z',
      shots: [
        {
          id: 'shot',
          inputSha256: hash,
          contactSheet: '/tmp/shot.png',
          dimensions: Object.fromEntries(
            ['framing', 'motion', 'continuity', 'lighting', 'editorial'].map((id) => [
              id,
              { status: 'pass', observation: `${id} inspected` },
            ]),
          ),
          verdict: 'pass',
        },
      ],
      final: {
        deliveryInputSha256: hash,
        contactSheet: '/tmp/final.png',
        dimensions: Object.fromEntries(
          ['pacing', 'continuity', 'audio', 'editorial', 'composition'].map((id) => [
            id,
            { status: 'pass', observation: `${id} inspected` },
          ]),
        ),
        verdict: 'pass',
      },
    };
    expect(cinematicProductionReviewSchema.parse(valid).final.verdict).toBe('pass');
    const failed = structuredClone(valid) as typeof valid & {
      shots: Array<(typeof valid.shots)[number] & { repair?: string }>;
    };
    failed.shots[0]!.dimensions['motion']!.status = 'fail';
    failed.shots[0]!.verdict = 'fail';
    expect(() => cinematicProductionReviewSchema.parse(failed)).toThrow(/repair instruction/);
    failed.shots[0]!.repair = 'Correct direction and foot contacts, then rerender this shot.';
    expect(cinematicProductionReviewSchema.parse(failed).shots[0]!.verdict).toBe('fail');
  });
});
