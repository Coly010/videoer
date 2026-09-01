import { describe, expect, it } from 'vitest';
import { composePoseLayers } from '../src/motion/composition.js';
import { evaluateJointLimits, evaluatePointContacts } from '../src/motion/constraints.js';
import { offsetPhase, phaseProgress, samplePhaseCurve } from '../src/motion/curves.js';
import { motionDesignSchema, phaseAt } from '../src/motion/design.js';
import { createQuinticMotionKeyframes, motionClipSchema } from '../src/motion/model.js';
import {
  composeMotionTimeline,
  verifyMotionTimelineComposition,
  type MotionTimelineDefinition,
} from '../src/motion/timeline.js';

describe('generic researched-motion architecture', () => {
  it('preserves exact clip endpoints for fractional frame durations', () => {
    const durationSeconds = 43 / 24;
    const values = Array.from(
      { length: 44 },
      (_, index) => [index, 0, 0] as [number, number, number],
    );
    const keyframes = createQuinticMotionKeyframes(values, durationSeconds, false);

    expect(keyframes.at(-1)?.time).toBe(durationSeconds);
    expect(keyframes.every((keyframe) => keyframe.time <= durationSeconds)).toBe(true);
  });

  const design = motionDesignSchema.parse({
    schemaVersion: 1,
    id: 'motion.test-action',
    category: 'environment-interaction',
    description: 'A compact non-gait design proving generic phases and contacts.',
    phases: [
      { id: 'approach', start: 0, end: 0.4, description: 'Move toward the target.' },
      { id: 'attach', start: 0.4, end: 0.7, description: 'Maintain target contact.' },
      { id: 'release', start: 0.7, end: 1, description: 'Release and recover.' },
    ],
    contacts: [
      {
        id: 'hand-target',
        effector: 'right-hand-grip',
        target: { kind: 'scene-point', reference: 'door.handle' },
        phases: ['attach'],
        mode: 'attach',
      },
    ],
    layers: [
      { id: 'body', role: 'base', joints: ['root'], description: 'Whole-body base.' },
      { id: 'reach', role: 'additive', joints: ['right-upper-arm'], description: 'Reach layer.' },
    ],
    invariants: [
      {
        id: 'hand-lock',
        type: 'target-attachment',
        tolerance: 0.01,
        unit: 'meters',
        description: 'The hand remains attached during manipulation.',
      },
    ],
    research: { sources: [], notes: [] },
  });

  it('evaluates normalized phases and reusable phase curves', () => {
    expect(phaseAt(design, 0.5)?.id).toBe('attach');
    expect(phaseAt(design, 1.1)?.id).toBe('approach');
    expect(offsetPhase(0.8, 0.5)).toBeCloseTo(0.3);
    expect(phaseProgress(0.5, 0.4, 0.7)).toBeCloseTo(1 / 3);
    expect(
      samplePhaseCurve(
        [
          { phase: 0, value: 0, interpolation: 'linear' },
          { phase: 0.5, value: 1, interpolation: 'linear' },
          { phase: 1, value: 0, interpolation: 'linear' },
        ],
        0.25,
      ),
    ).toBeCloseTo(0.5);
  });

  it('composes masked additive and override pose layers', () => {
    expect(
      composePoseLayers([
        { id: 'base', mode: 'base', weight: 1, pose: { chest: { rotation: [0, 0.2, 0] } } },
        {
          id: 'look',
          mode: 'additive',
          weight: 0.5,
          joints: ['chest'],
          pose: { chest: { rotation: [0, 0.2, 0] }, hips: { rotation: [1, 0, 0] } },
        },
      ]),
    ).toEqual({ chest: { rotation: [0, 0.30000000000000004, 0] } });
  });

  it('measures generic contact and joint-limit invariants', () => {
    expect(
      evaluatePointContacts([
        { contactId: 'hand', phase: 0.4, active: true, position: [1, 2, 3], target: [1, 2, 3] },
        { contactId: 'hand', phase: 0.5, active: true, position: [1.005, 2, 3], target: [1, 2, 3] },
        { contactId: 'hand', phase: 0.8, active: false, position: [1, 2.2, 3], target: [1, 2, 3] },
      ]),
    ).toMatchObject({ valid: true, maxContactErrorMeters: 0.004999999999999893 });
    expect(
      evaluateJointLimits([{ joint: 'elbow', rotation: [0, 0, 0.2] }], {
        elbow: { minimum: [-1, -1, -0.1], maximum: [1, 1, 0.1] },
      }),
    ).toMatchObject({ valid: false, violations: [{ joint: 'elbow', axis: 2, value: 0.2 }] });
  });

  it('compiles looped root motion and delayed additive turns into one deterministic clip', () => {
    const walk = motionClipSchema.parse({
      schemaVersion: 1,
      id: 'motion.test-walk',
      skeleton: 'videoer.canonical-humanoid.v1',
      durationSeconds: 1,
      loop: false,
      tracks: [
        {
          joint: 'root',
          property: 'translation',
          keyframes: [
            { time: 0, value: [0, 0, 0] },
            { time: 1, value: [0, 0, -1] },
          ],
        },
      ],
    });
    const turn = motionClipSchema.parse({
      schemaVersion: 1,
      id: 'motion.test-turn',
      skeleton: 'videoer.canonical-humanoid.v1',
      durationSeconds: 1,
      loop: false,
      tracks: [
        {
          joint: 'head',
          property: 'rotation-euler',
          keyframes: [
            { time: 0, value: [0, 0, 0] },
            { time: 1, value: [0, 0.5, 0] },
          ],
        },
      ],
    });
    const speech = motionClipSchema.parse({
      schemaVersion: 1,
      id: 'motion.test-speech',
      skeleton: 'videoer.canonical-humanoid.v1',
      durationSeconds: 1,
      loop: false,
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
    const definition: MotionTimelineDefinition = {
      id: 'motion.test-composed',
      skeleton: 'videoer.canonical-humanoid.v1',
      durationSeconds: 2,
      fps: 2,
      layers: [
        {
          id: 'walk',
          clip: walk,
          mode: 'base',
          startSeconds: 0,
          endSeconds: 2,
          playback: 'loop',
        },
        {
          id: 'look',
          clip: turn,
          mode: 'additive',
          startSeconds: 1,
          endSeconds: 2,
          playback: 'once',
          joints: ['head'],
          minimumContribution: 0.4,
        },
        {
          id: 'speech',
          clip: speech,
          mode: 'additive',
          startSeconds: 0,
          endSeconds: 1,
          playback: 'once',
          morphTargets: ['viseme-aa'],
          minimumContribution: 0.9,
        },
      ],
    };
    const result = composeMotionTimeline(definition);
    expect(result.tracks.find((track) => track.joint === 'root')?.keyframes.at(-1)?.value[2]).toBe(
      -2,
    );
    const head = result.tracks.find((track) => track.joint === 'head')!;
    expect(head.keyframes[1]!.value[1]).toBe(0);
    expect(head.keyframes.at(-1)!.value[1]).toBe(0.5);
    expect(result.morphTracks[0]?.keyframes.map((keyframe) => keyframe.value)).toEqual([
      0, 1, 0, 0, 0,
    ]);
    expect(result.metadata.layers).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'look', mode: 'additive' })]),
    );
    expect(
      verifyMotionTimelineComposition(definition, result, { requireMaskedNonBase: true }),
    ).toMatchObject({
      valid: true,
      checks: { baseCoverageComplete: true, layerContributions: { look: 0.5, speech: 1 } },
    });
    expect(
      verifyMotionTimelineComposition(
        {
          ...definition,
          layers: definition.layers.map((layer) =>
            layer.id === 'look' ? { ...layer, minimumContribution: 0.6 } : layer,
          ),
        },
        result,
        { requireMaskedNonBase: true },
      ),
    ).toMatchObject({
      valid: false,
      issues: [expect.stringContaining("layer 'look' contributes")],
    });
  });
});
