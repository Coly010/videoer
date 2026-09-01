import { identifySoleSurfaceRegions } from '../characters/sole-surface.js';
import { deformSkinnedVerticesDualQuaternion } from '../geometry/kinematics.js';
import type { GeometryAsset, Vec3 } from '../geometry/model.js';
import type { MotionPose } from './composition.js';
import {
  createQuinticMotionKeyframes,
  motionClipSchema,
  sampleMotionTrack,
  type MotionClip,
} from './model.js';

const smootherstep = (value: number) => {
  const amount = Math.max(0, Math.min(1, value));
  return amount * amount * amount * (amount * (amount * 6 - 15) + 10);
};

function samplePose(motion: MotionClip, phase: number): MotionPose {
  const pose: MotionPose = {};
  const seconds = phase * motion.durationSeconds;
  for (const track of motion.tracks) {
    const joint = (pose[track.joint] ??= {});
    const value = sampleMotionTrack(track, seconds);
    if (track.property === 'rotation-euler') joint.rotation = value;
    else joint.translation = value;
  }
  return pose;
}

function percentile(values: number[], amount: number) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * amount))]!;
}

function bandlimitLoop(values: Vec3[], maximumHarmonic: number) {
  const periodSamples = values.length - 1;
  const filtered = Array.from({ length: values.length }, (_, sampleIndex) => {
    const phase = (sampleIndex % periodSamples) / periodSamples;
    return [0, 1, 2].map((axis) => {
      let reconstructed = 0;
      for (let harmonic = -maximumHarmonic; harmonic <= maximumHarmonic; harmonic++) {
        let real = 0;
        let imaginary = 0;
        for (let sourceIndex = 0; sourceIndex < periodSamples; sourceIndex++) {
          const angle = (-2 * Math.PI * harmonic * sourceIndex) / periodSamples;
          real += values[sourceIndex]![axis]! * Math.cos(angle);
          imaginary += values[sourceIndex]![axis]! * Math.sin(angle);
        }
        real /= periodSamples;
        imaginary /= periodSamples;
        const angle = 2 * Math.PI * harmonic * phase;
        reconstructed += real * Math.cos(angle) - imaginary * Math.sin(angle);
      }
      return reconstructed;
    }) as Vec3;
  });
  filtered[filtered.length - 1] = [...filtered[0]!] as Vec3;
  return filtered;
}

function surfaceWitness(
  geometry: GeometryAsset,
  vertices: readonly number[],
  pose: MotionPose,
): Vec3 {
  const positions = deformSkinnedVerticesDualQuaternion(geometry, pose, vertices);
  return [
    positions.reduce((sum, position) => sum + position[0], 0) / positions.length,
    percentile(
      positions.map((position) => position[1]),
      0.02,
    ),
    positions.reduce((sum, position) => sum + position[2], 0) / positions.length,
  ];
}

function solveLinear(matrix: number[][], values: number[]): number[] | undefined {
  const size = values.length;
  const rows = matrix.map((row, index) => [...row, values[index]!]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++)
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row;
    if (Math.abs(rows[pivot]![column]!) < 1e-10) return undefined;
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    const divisor = rows[column]![column]!;
    for (let item = column; item <= size; item++) rows[column]![item]! /= divisor;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = rows[row]![column]!;
      for (let item = column; item <= size; item++)
        rows[row]![item]! -= factor * rows[column]![item]!;
    }
  }
  return rows.map((row) => row[size]!);
}

interface SurfaceContactConstraint {
  side: 'left' | 'right';
  vertices: readonly number[];
  target: Vec3;
  weight: number;
}

function solveCharacterContacts(
  geometry: GeometryAsset,
  pose: MotionPose,
  constraints: SurfaceContactConstraint[],
) {
  const working: MotionPose = {
    ...pose,
    root: { ...pose.root, translation: [...(pose.root?.translation ?? [0, 0, 0])] },
  };
  const sides = [...new Set(constraints.map(({ side }) => side))];
  for (const side of sides)
    for (const part of ['thigh', 'shin'] as const) {
      const joint = `${side}-${part}`;
      working[joint] = { ...pose[joint], rotation: [...(pose[joint]?.rotation ?? [0, 0, 0])] };
    }
  const variables: Array<{
    joint: string;
    property: 'translation' | 'rotation';
    axis: 0 | 1 | 2;
    maximumStep: number;
  }> = [
    { joint: 'root', property: 'translation', axis: 1, maximumStep: 0.015 },
    ...sides.flatMap((side) => [
      {
        joint: `${side}-thigh`,
        property: 'rotation' as const,
        axis: 0 as const,
        maximumStep: 0.12,
      },
      {
        joint: `${side}-shin`,
        property: 'rotation' as const,
        axis: 0 as const,
        maximumStep: 0.12,
      },
    ]),
  ];
  const base = variables.map(
    (variable) => working[variable.joint]![variable.property]![variable.axis]!,
  );
  let maximumResidualMeters = Number.POSITIVE_INFINITY;
  for (let iteration = 0; iteration < 24; iteration++) {
    const current = constraints.map(({ vertices }) => surfaceWitness(geometry, vertices, working));
    const residual = constraints.flatMap(({ target, weight }, index) => {
      const scale = Math.sqrt(weight);
      return [(target[1] - current[index]![1]) * scale, (target[2] - current[index]![2]) * scale];
    });
    maximumResidualMeters = Math.max(
      ...constraints.map(({ target }, index) =>
        Math.hypot(target[1] - current[index]![1], target[2] - current[index]![2]),
      ),
    );
    if (maximumResidualMeters < 0.0002) break;
    const epsilon = 0.0002;
    const jacobian = Array.from({ length: residual.length }, () => [] as number[]);
    for (const variable of variables) {
      working[variable.joint]![variable.property]![variable.axis]! += epsilon;
      const shifted = constraints.map(({ vertices }) =>
        surfaceWitness(geometry, vertices, working),
      );
      working[variable.joint]![variable.property]![variable.axis]! -= epsilon;
      constraints.forEach(({ weight }, constraint) => {
        const scale = Math.sqrt(weight);
        jacobian[constraint * 2]!.push(
          ((shifted[constraint]![1] - current[constraint]![1]) / epsilon) * scale,
        );
        jacobian[constraint * 2 + 1]!.push(
          ((shifted[constraint]![2] - current[constraint]![2]) / epsilon) * scale,
        );
      });
    }
    const damping = 1e-6;
    const normal = Array.from({ length: variables.length }, (_, row) =>
      Array.from({ length: variables.length }, (_, column) =>
        jacobian.reduce(
          (sum, values) => sum + values[row]! * values[column]!,
          row === column ? damping : 0,
        ),
      ),
    );
    const projected = Array.from({ length: variables.length }, (_, column) =>
      jacobian.reduce((sum, values, axis) => sum + values[column]! * residual[axis]!, 0),
    );
    const step = solveLinear(normal, projected);
    if (!step) break;
    const scale = Math.min(
      1,
      ...step.map(
        (value, index) => variables[index]!.maximumStep / Math.max(1e-12, Math.abs(value)),
      ),
    );
    variables.forEach((variable, index) => {
      working[variable.joint]![variable.property]![variable.axis]! += step[index]! * scale;
    });
  }
  return {
    pose: working,
    maximumResidualMeters,
    corrections: variables.map(
      (variable, index) =>
        working[variable.joint]![variable.property]![variable.axis]! - base[index]!,
    ),
  };
}

export interface CharacterFootPlantingOptions {
  floorHeight?: number;
  sampleCount?: number;
  releaseEndPhase?: number;
  preparationStartPhase?: number;
  maximumCorrectionHarmonic?: number;
}

/**
 * Adds a final-character contact layer by solving against low, rigid vertices
 * on the rendered sole. The procedural gait remains the motion source, while
 * this reusable constraint absorbs rest-pose, pelvis-roll, and topology/weight
 * differences that a planar proxy leg cannot represent.
 */
export function plantMotionFeetToCharacter(
  geometry: GeometryAsset,
  motionInput: MotionClip,
  options: CharacterFootPlantingOptions = {},
) {
  const motion = motionClipSchema.parse(motionInput);
  const floorHeight = options.floorHeight ?? 0;
  const sampleCount = options.sampleCount ?? 241;
  const releaseEndPhase = options.releaseEndPhase ?? 0.64;
  const preparationStartPhase = options.preparationStartPhase ?? 0.92;
  // Nine harmonics retain a 3 mm safety margin inside the final-surface
  // contact gate while affected tracks remain below half of the calibrated
  // normalized-jerk limit. Seven is the first passing band, but is too close
  // to the 12 mm contact boundary for a reusable production constraint.
  const maximumCorrectionHarmonic = options.maximumCorrectionHarmonic ?? 9;
  const stride = Number(motion.metadata.rootMotionMeters);
  if (!(stride > 0)) throw new Error('Character foot planting requires positive rootMotionMeters');
  if (sampleCount < 33) throw new Error('Character foot planting requires at least 33 samples');
  const regions = Object.fromEntries(
    (['left', 'right'] as const).map((side) => [side, identifySoleSurfaceRegions(geometry, side)]),
  ) as Record<'left' | 'right', ReturnType<typeof identifySoleSurfaceRegions>>;
  const anchors = Object.fromEntries(
    (['left', 'right'] as const).map((side) => {
      const strikePhase = side === 'right' ? 0 : 0.5;
      const flatPhase = strikePhase + 0.2;
      const heel = surfaceWitness(
        geometry,
        regions[side].heel.witnessVertices,
        samplePose(motion, strikePhase),
      );
      const toe = surfaceWitness(
        geometry,
        regions[side].forefoot.witnessVertices,
        samplePose(motion, flatPhase),
      );
      heel[1] = floorHeight;
      toe[1] = floorHeight;
      return [side, { heel, toe, baseCycle: side === 'right' ? 0 : 1 }];
    }),
  ) as Record<'left' | 'right', { heel: Vec3; toe: Vec3; baseCycle: number }>;
  const phases = Array.from({ length: sampleCount }, (_, index) => index / (sampleCount - 1));
  const values = new Map<string, Vec3[]>(
    ['root', 'left-thigh', 'left-shin', 'right-thigh', 'right-shin'].map((joint) => [joint, []]),
  );
  const baseValues = new Map<string, Vec3[]>([...values.keys()].map((joint) => [joint, []]));
  let maximumSolvedResidualMeters = 0;
  let maximumCorrectionRadians = 0;
  let maximumRootCorrectionMeters = 0;
  for (const phase of phases) {
    const pose = samplePose(motion, phase);
    for (const joint of baseValues.keys())
      baseValues
        .get(joint)!
        .push([...(joint === 'root' ? pose.root!.translation! : pose[joint]!.rotation!)] as Vec3);
    const constraints: SurfaceContactConstraint[] = [];
    for (const side of ['left', 'right'] as const) {
      const offset = side === 'left' ? 0.5 : 0;
      const unwrapped = phase + offset;
      const cycle = Math.floor(unwrapped + 1e-10);
      const localPhase = unwrapped - cycle;
      let region: 'heel' | 'forefoot' | undefined;
      let targetCycle = cycle;
      let weight = 0;
      if (localPhase < 0.12) {
        region = 'heel';
        weight = 1;
      } else if (localPhase < 0.58) {
        region = 'forefoot';
        weight = 1;
      } else if (localPhase < releaseEndPhase) {
        region = 'forefoot';
        weight = 1 - smootherstep((localPhase - 0.58) / (releaseEndPhase - 0.58));
      } else if (localPhase >= preparationStartPhase) {
        region = 'heel';
        targetCycle = cycle + 1;
        weight = smootherstep((localPhase - preparationStartPhase) / (1 - preparationStartPhase));
      }
      if (region && weight > 1e-6) {
        const anchor = anchors[side][region === 'heel' ? 'heel' : 'toe'];
        const intended = [
          anchor[0],
          floorHeight,
          anchor[2] - (targetCycle - anchors[side].baseCycle) * stride,
        ] as Vec3;
        const vertices = regions[side][region].witnessVertices;
        const current = surfaceWitness(geometry, vertices, pose);
        constraints.push({
          side,
          vertices,
          target: current.map((value, axis) => value + (intended[axis]! - value) * weight) as Vec3,
          weight: 1,
        });
      }
    }
    if (constraints.length) {
      const solved = solveCharacterContacts(geometry, pose, constraints);
      maximumSolvedResidualMeters = Math.max(
        maximumSolvedResidualMeters,
        solved.maximumResidualMeters,
      );
      maximumRootCorrectionMeters = Math.max(
        maximumRootCorrectionMeters,
        Math.abs(solved.corrections[0] ?? 0),
      );
      maximumCorrectionRadians = Math.max(
        maximumCorrectionRadians,
        ...solved.corrections.slice(1).map(Math.abs),
      );
      for (const joint of values.keys()) pose[joint] = solved.pose[joint]!;
    }
    for (const joint of values.keys())
      values.get(joint)!.push(joint === 'root' ? pose.root!.translation! : pose[joint]!.rotation!);
  }
  const tracks = motion.tracks.map((track) => {
    const solved = values.get(track.joint);
    const base = baseValues.get(track.joint);
    const corrected =
      solved && base
        ? bandlimitLoop(
            solved.map(
              (value, index) =>
                value.map((component, axis) => component - base[index]![axis]!) as Vec3,
            ),
            maximumCorrectionHarmonic,
          ).map(
            (correction, index) =>
              correction.map((component, axis) => component + base[index]![axis]!) as Vec3,
          )
        : undefined;
    return corrected &&
      ((track.joint === 'root' && track.property === 'translation') ||
        (track.joint !== 'root' && track.property === 'rotation-euler'))
      ? {
          ...track,
          interpolation: 'quintic-hermite' as const,
          keyframes: createQuinticMotionKeyframes(corrected, motion.durationSeconds, true),
        }
      : structuredClone(track);
  });
  const planted = motionClipSchema.parse({
    ...motion,
    tracks,
    metadata: {
      ...motion.metadata,
      characterFootPlanting: {
        generator: 'videoer.final-surface-foot-planting.v1',
        geometry: geometry.id,
        surface: 'rigid-low-sole-vertices',
        samples: sampleCount,
        floorHeight,
        contactPhases: { heel: [0, 0.12], forefoot: [0.12, 0.58] },
        releaseEndPhase,
        preparationStartPhase,
        maximumCorrectionHarmonic,
        maximumSolvedResidualMeters,
        maximumRootCorrectionMeters,
        maximumCorrectionRadians,
      },
    },
  });
  return {
    motion: planted,
    checks: {
      samples: sampleCount,
      maximumSolvedResidualMeters,
      maximumRootCorrectionMeters,
      maximumCorrectionRadians,
      maximumCorrectionHarmonic,
    },
  };
}
