import { describe, expect, it } from 'vitest';
import { createHumanoidMannequin } from '../src/characters/mannequin.js';
import { interactionDefinitionSchema, interactionPhaseAt } from '../src/interactions/model.js';
import {
  createOpenDoorInteraction,
  createReadBookInteraction,
  createTargetedTurnMotion,
  createTurnMotion,
  createTurnVerificationMotion,
} from '../src/interactions/synthesis.js';
import {
  inverseTransformPoint,
  resolveAttachment,
  transformPoint,
} from '../src/interactions/transforms.js';
import { forwardReachEndpoint, solveTwoBoneReach } from '../src/motion/ik.js';
import { animatedAttachmentPosition } from '../src/geometry/kinematics.js';
import { createBookshopDoor } from '../src/props/door.js';
import { createSignificantBook } from '../src/props/book.js';
import { validateGeometry } from '../src/geometry/model.js';

describe('renderer-independent interactions and arm IK', () => {
  it('requires contiguous, complete, target-consistent interaction phases', () => {
    const interaction = interactionDefinitionSchema.parse({
      schemaVersion: 1,
      id: 'interaction.open-door',
      type: 'open-door',
      actor: 'character.elara-vale',
      target: 'prop.bookshop-door',
      hand: 'right',
      phases: [
        { id: 'approach', start: 0, end: 0.2, constraint: 'approach' },
        {
          id: 'reach',
          start: 0.2,
          end: 0.42,
          constraint: 'point',
          actorEffector: 'right-hand-grip',
          targetAttachment: 'handle-grip',
        },
        {
          id: 'attach',
          start: 0.42,
          end: 0.75,
          constraint: 'attach',
          actorEffector: 'right-hand-grip',
          targetAttachment: 'handle-grip',
        },
        { id: 'release', start: 0.75, end: 1, constraint: 'release' },
      ],
      invariants: ['contact', 'joint-limits'],
    });
    expect(interactionPhaseAt(interaction, 0.5)?.id).toBe('attach');
    expect(() =>
      interactionDefinitionSchema.parse({
        ...interaction,
        phases: interaction.phases.map((phase, index) =>
          index === 1 ? { ...phase, start: 0.25 } : phase,
        ),
      }),
    ).toThrow(/contiguous/);
  });

  it('resolves named attachments through explicit scene transforms', () => {
    const character = createHumanoidMannequin();
    const resolved = resolveAttachment(character, 'right-hand-grip', {
      position: [2, 0, -3],
      rotation: [0, Math.PI / 2, 0],
      scale: [1, 1, 1],
    });
    expect(resolved.position.every(Number.isFinite)).toBe(true);
    expect(() =>
      resolveAttachment(character, 'invented-handle', {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      }),
    ).toThrow(/no attachment/);
    const transform = {
      position: [1.2, -0.4, 2.1] as [number, number, number],
      rotation: [0.3, -1.1, 0.2] as [number, number, number],
      scale: [1.2, 0.8, 1.5] as [number, number, number],
    };
    const point = [0.3, 1.4, -0.8] as [number, number, number];
    expect(inverseTransformPoint(transformPoint(point, transform), transform)).toEqual(
      expect.arrayContaining(point.map((value) => expect.closeTo(value, 9))),
    );
  });

  it('solves reachable left and right hand targets and proves them with forward kinematics', () => {
    for (const side of ['left', 'right'] as const) {
      const input = {
        side,
        origin: [side === 'left' ? 0.2 : -0.2, 1.42, 0] as [number, number, number],
        target: [side === 'left' ? 0.38 : -0.38, 1.12, -0.42] as [number, number, number],
        upperLength: 0.31,
        lowerLength: 0.29,
        pole: [0, -1, 0] as [number, number, number],
      };
      const solution = solveTwoBoneReach(input);
      const endpoint = forwardReachEndpoint(input, solution);
      expect(solution.reachable).toBe(true);
      expect(
        Math.hypot(...endpoint.map((value, index) => value - input.target[index]!)),
      ).toBeLessThan(1e-6);
      expect(solution.bendRadians).toBeGreaterThan(0.1);
    }
  });

  it('reports unreachable targets instead of silently stretching a limb', () => {
    const input = {
      side: 'right' as const,
      origin: [-0.2, 1.4, 0] as [number, number, number],
      target: [-0.2, 1.4, -2] as [number, number, number],
      upperLength: 0.3,
      lowerLength: 0.3,
      pole: [0, -1, 0] as [number, number, number],
    };
    const solution = solveTwoBoneReach(input);
    expect(solution.reachable).toBe(false);
    expect(solution.endpointErrorMeters).toBeGreaterThan(1.3);
  });

  it('builds valid articulated door and book props with named interaction points', () => {
    const door = createBookshopDoor();
    const book = createSignificantBook();
    expect(validateGeometry(door).valid).toBe(true);
    expect(validateGeometry(book).valid).toBe(true);
    expect(door.attachments).toHaveProperty('handle-grip');
    expect(book.attachments).toMatchObject({
      'left-grip': expect.any(Object),
      'right-grip': expect.any(Object),
      'gaze-target': expect.any(Object),
    });
    const closed = animatedAttachmentPosition(door, 'handle-grip');
    const opened = animatedAttachmentPosition(door, 'handle-grip', {
      'door-leaf': { rotation: [0, -Math.PI / 2, 0] },
    });
    expect(Math.hypot(...opened.map((value, index) => value - closed[index]!))).toBeGreaterThan(
      0.5,
    );
  });

  it('synthesizes a phased door action with verified moving-handle contact', () => {
    const interaction = createOpenDoorInteraction();
    expect(interaction.verification).toMatchObject({ valid: true, issues: [] });
    expect(interaction.verification.checks.maximumContactErrorMeters).toBeLessThan(0.006);
    expect(interaction.targetClip?.skeleton).toBe('videoer.prop.bookshop-door.v1');
    expect(interaction.definition.phases.map((phase) => phase.id)).toEqual([
      'approach',
      'reach',
      'grasp',
      'turn-handle',
      'open',
      'release',
      'pass-through',
    ]);
    expect(interaction.actorTransform.position[2]).toBeLessThan(0);
    expect(interaction.actorTransform.rotation[1]).toBeCloseTo(Math.PI);
  });

  it('synthesizes a two-handed book hold with gaze and bilateral contact gates', () => {
    const interaction = createReadBookInteraction();
    expect(interaction.verification).toMatchObject({ valid: true, issues: [] });
    expect(interaction.verification.checks.leftContactErrorMeters).toBeLessThan(0.006);
    expect(interaction.verification.checks.rightContactErrorMeters).toBeLessThan(0.006);
    expect(interaction.verification.checks.gazeTurnRadians).toBeGreaterThan(0.05);
    expect(interaction.verification.checks.twoHandConstraint).toBe(true);
  });

  it('creates distinct head and whole-body turn clips in both directions', () => {
    const headLeft = createTurnMotion('left', 'head');
    const bodyRight = createTurnMotion('right', 'body');
    expect(headLeft.tracks.map((track) => track.joint)).toEqual(['neck', 'head']);
    expect(bodyRight.tracks.map((track) => track.joint)).toEqual(['hips', 'spine', 'chest']);
    expect(headLeft.tracks[0]!.keyframes[1]!.value[1]).toBeGreaterThan(0);
    expect(bodyRight.tracks[0]!.keyframes[1]!.value[1]).toBeLessThan(0);
    const verification = createTurnVerificationMotion(createHumanoidMannequin(), 'left', 'head');
    expect(verification.tracks.map((track) => track.joint)).toEqual([
      'neck',
      'head',
      'left-clavicle',
      'left-upper-arm',
      'right-clavicle',
      'right-upper-arm',
    ]);
    expect(headLeft.tracks).toHaveLength(2);
  });

  it('derives turn direction and magnitude from a world-space gaze target', () => {
    const transform = {
      position: [2.4, 0, -1.3] as [number, number, number],
      rotation: [0, Math.PI / 2, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    };
    const towardShop = createTargetedTurnMotion(transform, [2.15, 1.72, -0.04], 'head-and-body');
    const awayFromShop = createTargetedTurnMotion(transform, [2.15, 1.72, -2.5], 'head-and-body');
    expect(towardShop.metadata.resolvedYawRadians).toBeGreaterThan(0);
    expect(awayFromShop.metadata.resolvedYawRadians).toBeLessThan(0);
    expect(towardShop.tracks.map((track) => track.joint)).toEqual([
      'hips',
      'spine',
      'chest',
      'neck',
      'head',
    ]);
  });
});
