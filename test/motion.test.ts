import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHumanoidMannequin } from '../src/characters/mannequin.js';
import { createEnglishSpeechMorphRig } from '../src/characters/speech-rig.js';
import { analyzeMotionKinematics, verifyMotionKinematics } from '../src/motion/kinematics.js';
import { motionClipSchema, sampleMotion, validateMotionClip } from '../src/motion/model.js';
import { motionVisualReviewSchema, verifyMotionReviewEvidence } from '../src/motion/review.js';
import {
  createCasualWalkMotion,
  createWalkStyleMotion,
  verifyCasualWalkMotion,
} from '../src/motion/walk.js';

describe('canonical character motion', () => {
  it('keeps visual acceptance separate from mechanical motion evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'videoer-motion-review-'));
    const roles = [
      'motion',
      'mechanical-report',
      'side-video',
      'side-contact-sheet',
      'three-quarter-video',
      'three-quarter-contact-sheet',
    ] as const;
    await Promise.all(roles.map((role) => writeFile(join(directory, role), role)));
    const { createHash } = await import('node:crypto');
    const evidence = roles.map((role) => ({
      role,
      path: role,
      sha256: createHash('sha256').update(role).digest('hex'),
    }));
    const dimensions = Object.fromEntries(
      [
        'directionality',
        'anatomicalFootOrder',
        'temporalSmoothness',
        'plantedContact',
        'weightTransfer',
        'torsoCountermotion',
        'armDynamics',
        'footRoll',
        'silhouetteSeparation',
        'humanDeformation',
      ].map((id) => [id, { status: 'pass', observation: `${id} inspected` }]),
    );
    const review = {
      schemaVersion: 1 as const,
      motionId: 'motion.fixture',
      reviewer: 'codex',
      reviewedAt: '2026-08-31T12:00:00.000Z',
      evidence,
      dimensions,
      verdict: 'accepted' as const,
      repairs: [],
    };
    expect(
      (await verifyMotionReviewEvidence(motionVisualReviewSchema.parse(review), directory)).valid,
    ).toBe(true);

    const visuallyRejected = {
      ...review,
      dimensions: {
        ...review.dimensions,
        weightTransfer: {
          status: 'fail',
          observation: 'The stance leg reads as a rigid column.',
        },
      },
      verdict: 'rejected' as const,
      repairs: [] as string[],
    };
    expect(() => motionVisualReviewSchema.parse(visuallyRejected)).toThrow(/repair instruction/);
    visuallyRejected.repairs = ['Restore visible support-knee reserve and weight acceptance.'];
    expect(motionVisualReviewSchema.parse(visuallyRejected).verdict).toBe('rejected');

    await writeFile(join(directory, 'side-video'), 'changed');
    expect(
      (
        await verifyMotionReviewEvidence(
          motionVisualReviewSchema.parse(visuallyRejected),
          directory,
        )
      ).valid,
    ).toBe(false);
  });

  it('creates a loopable root-motion walk compatible with the humanoid skeleton', () => {
    const clip = createCasualWalkMotion();
    const validation = validateMotionClip(clip, createHumanoidMannequin());
    expect(validation).toMatchObject({
      valid: true,
      stats: { tracks: 20, durationSeconds: 120 / 108, loop: true },
    });
    expect(clip.tracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ joint: 'root', property: 'translation' }),
        expect.objectContaining({ joint: 'left-thigh', property: 'rotation-euler' }),
        expect.objectContaining({ joint: 'right-shin', property: 'rotation-euler' }),
      ]),
    );
    expect(clip.metadata).toMatchObject({
      generator: 'videoer.phase-gait.v4',
      motionDesign: 'motion-design.human-walk-v4',
      motionCalibration: 'motion-calibration.wbds-young-comfortable-overground-v1',
      style: 'neutral',
      rootMotionMeters: 0.88 * 1.18,
      synthesisVerification: {
        kinematics: {
          activeTracks: 20,
          maximumNormalizedJerk: expect.any(Number),
        },
      },
    });
    const verification = verifyCasualWalkMotion(clip);
    expect(verification).toMatchObject({
      valid: true,
      checks: {
        canonicalForward: '-z',
        rootForwardMeters: 0.88 * 1.18,
        wholeBodyDynamics: {
          globalThoraxOppositionLagSamples: expect.any(Number),
          globalThoraxPhaseLagRatio: expect.any(Number),
          globalThoraxYawCorrelation: expect.any(Number),
        },
      },
    });
    if (!('wholeBodyDynamics' in verification.checks))
      throw new Error('Verified gait omitted whole-body dynamics evidence');
    expect(verification.checks.wholeBodyDynamics.globalThoraxYawCorrelation).toBeGreaterThan(-0.99);
    expect(verification.checks.wholeBodyDynamics.globalThoraxYawCorrelation).toBeLessThan(-0.5);
    expect(Math.abs(verification.checks.wholeBodyDynamics.globalThoraxOppositionLagSamples)).toBe(
      3,
    );
    expect(verification.checks.wholeBodyDynamics.globalThoraxPhaseLagRatio).toBeCloseTo(3 / 64);
  });

  it('interpolates tracks and wraps loop time deterministically', () => {
    const clip = createCasualWalkMotion();
    const quarter = sampleMotion(clip, 0.25);
    const wrapped = sampleMotion(clip, clip.durationSeconds + 0.25);
    expect(quarter).toEqual(wrapped);
    expect(Math.abs(quarter['root:translation']?.[0] ?? 0)).toBeGreaterThan(0.001);
    expect(Math.abs(quarter['root:translation']?.[1] ?? 0)).toBeGreaterThan(0.001);
    expect(quarter['root:translation']?.[2]).toBeCloseTo(-0.23364);
    expect(Math.abs(quarter['left-thigh:rotation-euler']?.[0] ?? 0)).toBeGreaterThan(0.1);
  });

  it('samples scalar morph tracks and validates them against target geometry', () => {
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
    const clip = motionClipSchema.parse({
      schemaVersion: 1,
      id: 'motion.test-viseme',
      skeleton: 'videoer.canonical-humanoid.v1',
      durationSeconds: 1,
      tracks: [],
      morphTracks: [
        {
          target: 'viseme-aa',
          property: 'weight',
          keyframes: [
            { time: 0, value: 0 },
            { time: 0.5, value: 1 },
            { time: 1, value: 0 },
          ],
        },
      ],
    });
    expect(sampleMotion(clip, 0.25)['morph:viseme-aa']).toBeCloseTo(0.5);
    expect(validateMotionClip(clip, geometry).valid).toBe(true);
    clip.morphTracks[0]!.target = 'viseme-missing';
    expect(validateMotionClip(clip, geometry)).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: 'motion.unknown-morph-target' })],
    });
  });

  it('keeps toe geometry and root travel aligned with canonical forward', () => {
    const geometry = createHumanoidMannequin();
    const toe = geometry.skeleton.find((joint) => joint.id === 'left-toe');
    const root = createCasualWalkMotion().tracks.find(
      (track) => track.joint === 'root' && track.property === 'translation',
    );
    expect(toe?.restPosition[2]).toBeLessThan(0);
    expect(root?.keyframes.at(-1)?.value[2]).toBeLessThan(0);
  });

  it('retargets the analytic walk to continuous character proportions', () => {
    const clip = createCasualWalkMotion({ height: 1.55, legLength: 0.74, footScale: 0.9 });
    expect(verifyCasualWalkMotion(clip).valid).toBe(true);
    expect(clip.metadata).toMatchObject({
      rootMotionMeters: 0.74 * 1.18,
      proportions: { height: 1.55, legLength: 0.74, footScale: 0.9 },
    });
  });

  it('produces distinct, verified whole-body gait styles', () => {
    const styles = ['neutral', 'cautious', 'confident'] as const;
    const clips = styles.map((style) => createWalkStyleMotion(style));
    for (const [index, clip] of clips.entries()) {
      expect(verifyCasualWalkMotion(clip).valid).toBe(true);
      expect(verifyMotionKinematics(clip).valid).toBe(true);
      expect(clip.metadata.style).toBe(styles[index]);
      expect(clip.tracks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ joint: 'left-toe', property: 'rotation-euler' }),
          expect.objectContaining({ joint: 'right-toe', property: 'rotation-euler' }),
          // These are authored gait dynamics, not optional rest-pose corrections.
          // A release without them cannot satisfy the whole-body motion contract.
          expect.objectContaining({ joint: 'left-upper-arm', property: 'rotation-euler' }),
          expect.objectContaining({ joint: 'right-upper-arm', property: 'rotation-euler' }),
          expect.objectContaining({ joint: 'head', property: 'rotation-euler' }),
        ]),
      );
    }
    expect(clips.map((clip) => clip.durationSeconds)).toEqual([120 / 108, 120 / 92, 120 / 116]);
    expect(clips.map((clip) => clip.metadata.rootMotionMeters)).toEqual([
      0.88 * 1.18,
      0.88 * 0.82,
      0.88 * 1.185,
    ]);
  });

  it('rejects carrying a production-rest leg spread into locomotion', () => {
    const clip = structuredClone(createCasualWalkMotion());
    for (const track of clip.tracks)
      if (
        (track.joint === 'left-thigh' || track.joint === 'right-thigh') &&
        track.property === 'rotation-euler'
      )
        for (const keyframe of track.keyframes) keyframe.value[2] = 0;
    expect(verifyCasualWalkMotion(clip)).toMatchObject({
      valid: false,
      issues: expect.arrayContaining(['baked feet retain an over-wide production-rest stance']),
    });
  });

  it('rejects torso yaw that follows instead of countering the pelvis', () => {
    const clip = structuredClone(createCasualWalkMotion());
    const hips = clip.tracks.find(
      (track) => track.joint === 'hips' && track.property === 'rotation-euler',
    )!;
    const chest = clip.tracks.find(
      (track) => track.joint === 'chest' && track.property === 'rotation-euler',
    )!;
    for (let index = 0; index < chest.keyframes.length; index++)
      chest.keyframes[index]!.value[1] = hips.keyframes[index]!.value[1];
    expect(verifyCasualWalkMotion(clip)).toMatchObject({
      valid: false,
      issues: expect.arrayContaining(['thorax yaw is not phase-opposed to pelvis yaw']),
    });
  });

  it('rejects locally opposed chest motion when the accumulated thorax still follows the pelvis', () => {
    const clip = structuredClone(createCasualWalkMotion());
    const hips = clip.tracks.find(
      (track) => track.joint === 'hips' && track.property === 'rotation-euler',
    )!;
    const spine = clip.tracks.find(
      (track) => track.joint === 'spine' && track.property === 'rotation-euler',
    )!;
    const chest = clip.tracks.find(
      (track) => track.joint === 'chest' && track.property === 'rotation-euler',
    )!;
    for (let index = 0; index < spine.keyframes.length; index++) {
      spine.keyframes[index]!.value[1] = 0;
      chest.keyframes[index]!.value[1] = -hips.keyframes[index]!.value[1] * 0.25;
    }
    expect(verifyCasualWalkMotion(clip)).toMatchObject({
      valid: false,
      issues: expect.arrayContaining(['global thorax yaw follows instead of opposing the pelvis']),
    });
  });

  it('rejects a mechanically synchronized global thorax inversion', () => {
    const clip = structuredClone(createCasualWalkMotion());
    const hips = clip.tracks.find(
      (track) => track.joint === 'hips' && track.property === 'rotation-euler',
    )!;
    const spine = clip.tracks.find(
      (track) => track.joint === 'spine' && track.property === 'rotation-euler',
    )!;
    const chest = clip.tracks.find(
      (track) => track.joint === 'chest' && track.property === 'rotation-euler',
    )!;
    for (let index = 0; index < spine.keyframes.length; index++) {
      const pelvisYaw = hips.keyframes[index]!.value[1]!;
      spine.keyframes[index]!.value[1] = -pelvisYaw * 0.7;
      chest.keyframes[index]!.value[1] = -pelvisYaw * 0.7;
    }
    expect(verifyCasualWalkMotion(clip)).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        'global thorax yaw is a mechanically synchronized pelvis inversion',
      ]),
    });
  });

  it('detects velocity corners that pose and contact checks cannot see', () => {
    const makeClip = (id: string, values: Array<{ time: number; value: number }>) =>
      motionClipSchema.parse({
        schemaVersion: 1,
        id,
        skeleton: 'videoer.canonical-humanoid.v1',
        durationSeconds: 1,
        loop: true,
        tracks: [
          {
            joint: 'hips',
            property: 'translation',
            keyframes: values.map(({ time, value }) => ({
              time,
              value: [value, 0, 0],
              easing: 'linear',
            })),
          },
        ],
      });
    const smooth = makeClip(
      'motion.test-smooth',
      Array.from({ length: 65 }, (_, index) => {
        const time = index / 64;
        return { time, value: Math.sin(time * Math.PI * 2) };
      }),
    );
    const corner = makeClip('motion.test-corner', [
      { time: 0, value: 0 },
      { time: 0.5, value: 1 },
      { time: 1, value: 0 },
    ]);
    const smoothJerk = analyzeMotionKinematics(smooth).tracks[0]!.normalizedPeakJerk;
    const cornerJerk = analyzeMotionKinematics(corner).tracks[0]!.normalizedPeakJerk;
    expect(cornerJerk).toBeGreaterThan(smoothJerk * 2);
    expect(verifyMotionKinematics(corner)).toMatchObject({ valid: false });
  });

  it('rejects unordered clips and reports skeleton mismatches', () => {
    expect(() =>
      motionClipSchema.parse({
        schemaVersion: 1,
        id: 'bad.walk',
        skeleton: 'videoer.canonical-humanoid.v1',
        durationSeconds: 1,
        tracks: [
          {
            joint: 'hips',
            property: 'translation',
            keyframes: [
              { time: 0.5, value: [0, 0, 0] },
              { time: 0.25, value: [0, 0, 0] },
            ],
          },
        ],
      }),
    ).toThrow(/begin at zero|strictly increasing|end at clip duration/);
    const clip = createCasualWalkMotion();
    clip.tracks.push({
      joint: 'missing-joint',
      property: 'translation',
      space: 'local-delta',
      keyframes: [
        { time: 0, value: [0, 0, 0], easing: 'linear' },
        { time: clip.durationSeconds, value: [0, 0, 0], easing: 'linear' },
      ],
    });
    expect(validateMotionClip(clip, createHumanoidMannequin())).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: 'motion.unknown-joint' })],
    });
  });
});
