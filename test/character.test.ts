import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  characterVisualReviewSchema,
  verifyCharacterReviewEvidence,
} from '../src/characters/review.js';
import {
  handEvidenceRoles,
  handVisualReviewSchema,
  verifyHandReviewEvidence,
} from '../src/characters/hand-review.js';
import {
  faceEvidenceRoles,
  faceVisualReviewSchema,
  verifyFaceReviewEvidence,
} from '../src/characters/face-review.js';

describe('production character review', () => {
  it('keeps structural validation separate from hash-bound visual acceptance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'videoer-character-review-'));
    const roles = [
      'geometry',
      'anatomy-report',
      'canonical-contact-sheet',
      'face-close-up',
      'turntable',
      'walk-report',
      'walk-side-contact-sheet',
      'walk-three-quarter-contact-sheet',
      'walk-side-video',
      'walk-three-quarter-video',
    ] as const;
    await Promise.all(roles.map((role) => writeFile(join(directory, role), role)));
    const evidence = roles.map((role) => ({
      role,
      path: role,
      sha256: createHash('sha256').update(role).digest('hex'),
    }));
    const dimensions = Object.fromEntries(
      [
        'topologyContinuity',
        'deformationMechanics',
        'bodyProportions',
        'jointContours',
        'hands',
        'feet',
        'face',
        'hair',
        'silhouette',
        'motionNaturalism',
        'materialResponse',
      ].map((id) => [id, { status: 'pass', observation: `${id} inspected` }]),
    );
    const accepted = characterVisualReviewSchema.parse({
      schemaVersion: 1,
      characterId: 'character.fixture',
      reviewer: 'codex',
      reviewedAt: '2026-08-31T20:00:00.000Z',
      evidence,
      dimensions,
      verdict: 'accepted',
      repairs: [],
    });
    expect((await verifyCharacterReviewEvidence(accepted, directory)).valid).toBe(true);

    const rejected = structuredClone(accepted);
    rejected.dimensions.hands = {
      status: 'fail',
      observation: 'Hands remain undifferentiated mitts.',
    };
    rejected.verdict = 'rejected';
    expect(() => characterVisualReviewSchema.parse(rejected)).toThrow(/repair instructions/);
    rejected.repairs = ['Add palms, thumbs, fingers, knuckles, and grasp deformation probes.'];
    expect(characterVisualReviewSchema.parse(rejected).verdict).toBe('rejected');

    await writeFile(join(directory, 'face-close-up'), 'changed');
    expect((await verifyCharacterReviewEvidence(rejected, directory)).valid).toBe(false);
  });

  it('requires bilateral rest and flexion evidence for hand acceptance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'videoer-hand-review-'));
    await Promise.all(handEvidenceRoles.map((role) => writeFile(join(directory, role), role)));
    const evidence = handEvidenceRoles.map((role) => ({
      role,
      path: role,
      sha256: createHash('sha256').update(role).digest('hex'),
    }));
    const pass = { status: 'pass' as const, observation: 'inspected' };
    const review = handVisualReviewSchema.parse({
      schemaVersion: 1,
      characterId: 'character.fixture',
      reviewer: 'codex',
      reviewedAt: '2026-08-31T20:00:00.000Z',
      evidence,
      dimensions: {
        anthropometricProportions: pass,
        palmAndWristTopology: pass,
        fingerSilhouette: pass,
        thumbOpposition: pass,
        flexionDeformation: pass,
        knuckleAndNailLandmarks: pass,
      },
      verdict: 'accepted',
      repairs: [],
    });
    expect((await verifyHandReviewEvidence(review, directory)).valid).toBe(true);
    const rejected = structuredClone(review);
    rejected.dimensions.thumbOpposition = {
      status: 'fail',
      observation: 'Thumb folds through its own surface.',
    };
    rejected.verdict = 'rejected';
    rejected.repairs = ['Separate thumb opposition axes and rerender bilateral flexion.'];
    expect(handVisualReviewSchema.parse(rejected).verdict).toBe('rejected');
    await writeFile(join(directory, 'left-flexion'), 'stale');
    expect((await verifyHandReviewEvidence(rejected, directory)).valid).toBe(false);
  });

  it('requires neutral depth and expression evidence for face acceptance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'videoer-face-review-'));
    await Promise.all(faceEvidenceRoles.map((role) => writeFile(join(directory, role), role)));
    const evidence = faceEvidenceRoles.map((role) => ({
      role,
      path: role,
      sha256: createHash('sha256').update(role).digest('hex'),
    }));
    const pass = { status: 'pass' as const, observation: 'inspected' };
    const review = faceVisualReviewSchema.parse({
      schemaVersion: 1,
      characterId: 'character.fixture',
      reviewer: 'codex',
      reviewedAt: '2026-08-31T20:00:00.000Z',
      evidence,
      dimensions: {
        identityDifferentiation: pass,
        craniumJawAndChin: pass,
        eyesBrowsAndLids: pass,
        noseAndCheeks: pass,
        lipsAndOralCavity: pass,
        expressionDeformation: pass,
        skinAndLandmarkResponse: pass,
      },
      verdict: 'accepted',
      repairs: [],
    });
    expect((await verifyFaceReviewEvidence(review, directory)).valid).toBe(true);
    const rejected = structuredClone(review);
    rejected.dimensions.expressionDeformation = {
      status: 'fail',
      observation: 'Jaw-open morph detaches the lower lip.',
    };
    rejected.verdict = 'rejected';
    rejected.repairs = ['Add an oral cavity and surrounding jaw deformation.'];
    expect(faceVisualReviewSchema.parse(rejected).verdict).toBe('rejected');
    await writeFile(join(directory, 'neutral-three-quarter'), 'stale');
    expect((await verifyFaceReviewEvidence(rejected, directory)).valid).toBe(false);
  });
});
