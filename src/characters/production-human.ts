import type { GeometryMaterial, SkeletonJoint, Vec3, Vec4 } from '../geometry/model.js';
import { meshSignedDistanceField } from '../geometry/implicit.js';
import {
  capsuleBetween,
  ellipsoidBetween,
  mergeMeshParts,
  type MeshPart,
} from '../geometry/primitives.js';
import {
  canonicalHumanoidJoints,
  canonicalHumanoidWorldPositions,
  humanoidParametersSchema,
  type HumanoidAppearance,
  type HumanoidParameters,
} from './mannequin.js';
import {
  articulatedHandJointDefinitions,
  createArticulatedHandSurface,
  createFingernailSurfaces,
} from './hands.js';
import {
  addIdentityFaceMorphTargets,
  faceIdentityParametersSchema,
  type FaceIdentityParameters,
} from './face.js';
import { createAnatomicalFaceTemplate, createScalpCap } from './face-template.js';

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (value: Vec3, amount: number): Vec3 => [
  value[0] * amount,
  value[1] * amount,
  value[2] * amount,
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function ellipsoidDistance(point: Vec3, center: Vec3, radii: Vec3) {
  const local = subtract(point, center);
  const normalized = Math.hypot(local[0] / radii[0], local[1] / radii[1], local[2] / radii[2]);
  return (normalized - 1) * Math.min(...radii);
}

function capsuleDistance(point: Vec3, start: Vec3, end: Vec3, radius: number) {
  const segment = subtract(end, start);
  const lengthSquared = dot(segment, segment);
  const amount =
    lengthSquared > 1e-12
      ? Math.max(0, Math.min(1, dot(subtract(point, start), segment) / lengthSquared))
      : 0;
  return Math.hypot(...subtract(point, add(start, scale(segment, amount)))) - radius;
}

function smoothUnion(left: number, right: number, radius: number) {
  const amount = Math.max(radius - Math.abs(left - right), 0) / radius;
  return Math.min(left, right) - amount * amount * radius * 0.25;
}

function createSkinner(skeleton: SkeletonJoint[], worlds: Map<string, Vec3>, height: number) {
  const bone = new Map(skeleton.map((joint, index) => [joint.id, index]));
  const chainWeights = (position: Vec3, ids: string[], blendWidth: number) => {
    const points = ids.map((id) => worlds.get(id)!);
    const cumulative = [0];
    let bestDistance = Number.POSITIVE_INFINITY;
    let coordinate = 0;
    for (let index = 0; index < points.length - 1; index++) {
      const start = points[index]!;
      const end = points[index + 1]!;
      const segment = subtract(end, start);
      const length = Math.hypot(...segment);
      const amount =
        length > 1e-12
          ? Math.max(0, Math.min(1, dot(subtract(position, start), segment) / (length * length)))
          : 0;
      const nearest = add(start, scale(segment, amount));
      const distance = Math.hypot(...subtract(position, nearest));
      if (distance < bestDistance) {
        bestDistance = distance;
        coordinate = cumulative[index]! + length * amount;
      }
      cumulative.push(cumulative[index]! + length);
    }
    for (let boundary = 1; boundary < cumulative.length; boundary++) {
      const delta = coordinate - cumulative[boundary]!;
      if (Math.abs(delta) <= blendWidth) {
        const linear = (delta + blendWidth) / (blendWidth * 2);
        const amount = linear * linear * linear * (linear * (linear * 6 - 15) + 10);
        return [
          { joint: ids[boundary - 1]!, weight: 1 - amount },
          { joint: ids[boundary]!, weight: amount },
        ];
      }
    }
    let owner = 0;
    while (owner + 1 < cumulative.length && coordinate >= cumulative[owner + 1]!) owner++;
    return [{ joint: ids[Math.min(owner, ids.length - 1)]!, weight: 1 }];
  };
  const smootherstep = (amount: number) => {
    const value = Math.max(0, Math.min(1, amount));
    return value * value * value * (value * (value * 6 - 15) + 10);
  };
  const blendWeights = (
    left: Array<{ joint: string; weight: number }>,
    right: Array<{ joint: string; weight: number }>,
    amount: number,
  ) => {
    const combined = new Map<string, number>();
    for (const item of left)
      combined.set(item.joint, (combined.get(item.joint) ?? 0) + item.weight * (1 - amount));
    for (const item of right)
      combined.set(item.joint, (combined.get(item.joint) ?? 0) + item.weight * amount);
    const ranked = [...combined]
      .map(([joint, weight]) => ({ joint, weight }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4);
    const sum = ranked.reduce((total, item) => total + item.weight, 0) || 1;
    return ranked.map((item) => ({ ...item, weight: item.weight / sum }));
  };
  return (position: Vec3) => {
    const hipsY = worlds.get('hips')![1];
    const chestY = worlds.get('chest')![1];
    const neckY = worlds.get('neck')![1];
    const side = position[0] >= 0 ? 'left' : 'right';
    const sideSign = side === 'left' ? 1 : -1;
    const handPosition = worlds.get(`${side}-hand`)!;
    const handCoordinate = sideSign * (position[0] - handPosition[0]);
    if (handCoordinate >= -height * 0.03) {
      const handAmount = smootherstep((handCoordinate + height * 0.03) / (height * 0.03));
      return {
        indices: [bone.get(`${side}-forearm`)!, bone.get(`${side}-hand`)!, 0, 0] as Vec4,
        weights: [1 - handAmount, handAmount, 0, 0] as Vec4,
      };
    }
    const torso = chainWeights(
      position,
      ['hips', 'spine', 'chest', 'neck', 'head'],
      height * 0.045,
    );
    const leg = chainWeights(
      position,
      ['hips', `${side}-thigh`, `${side}-shin`, `${side}-foot`, `${side}-toe`],
      height * 0.045,
    );
    const socketX = Math.abs(worlds.get(`${side}-thigh`)![0]);
    const rawLegSideAmount = smootherstep(
      (Math.abs(position[0]) - socketX * 0.25) / (socketX * 0.65),
    );
    const pelvisCentreProtection = smootherstep(
      (position[1] - (hipsY - height * 0.18)) / (height * 0.16),
    );
    const legSideAmount = 1 - pelvisCentreProtection * (1 - rawLegSideAmount);
    const centralLeg = blendWeights([{ joint: 'hips', weight: 1 }], leg, legSideAmount);
    const lowerBodyAmount = smootherstep((hipsY + height * 0.13 - position[1]) / (height * 0.18));
    const arm = chainWeights(
      position,
      ['chest', `${side}-clavicle`, `${side}-upper-arm`, `${side}-forearm`, `${side}-hand`],
      height * 0.04,
    );
    const clavicleX = Math.abs(worlds.get(`${side}-clavicle`)![0]);
    const lateralArmAmount = smootherstep(
      (Math.abs(position[0]) - clavicleX * 0.52) / (clavicleX * 0.48),
    );
    const armHeightAmount =
      smootherstep((position[1] - (chestY - height * 0.15)) / (height * 0.1)) *
      (1 - smootherstep((position[1] - (neckY + height * 0.05)) / (height * 0.1)));
    const upperBody = blendWeights(torso, arm, lateralArmAmount * armHeightAmount);
    const weighted = blendWeights(upperBody, centralLeg, lowerBodyAmount);
    while (weighted.length < 4) weighted.push({ joint: weighted[0]?.joint ?? 'hips', weight: 0 });
    return {
      indices: weighted.map((item) => bone.get(item.joint) ?? 0) as Vec4,
      weights: weighted.map((item) => item.weight) as Vec4,
    };
  };
}

const defaultAppearance: HumanoidAppearance = {
  skin: [0.58, 0.36, 0.26, 1],
  hair: [0.035, 0.018, 0.012, 1],
  eyes: [0.07, 0.16, 0.14, 1],
  dress: [0.04, 0.05, 0.065, 1],
  leather: [0.025, 0.02, 0.018, 1],
};

export function createProductionHuman(
  input: HumanoidParameters = {},
  appearance: HumanoidAppearance = defaultAppearance,
  faceInput: FaceIdentityParameters = {},
) {
  const parameters = humanoidParametersSchema.parse(input);
  const face = faceIdentityParametersSchema.parse(faceInput);
  const coreDefinitions = canonicalHumanoidJoints(parameters).map((joint) =>
    joint.id === 'left-hand'
      ? { ...joint, local: [parameters.height * 0.008, 0, 0] as Vec3 }
      : joint.id === 'right-hand'
        ? { ...joint, local: [-parameters.height * 0.008, 0, 0] as Vec3 }
        : joint,
  );
  const definitions = [...coreDefinitions, ...articulatedHandJointDefinitions(parameters.height)];
  const skeleton: SkeletonJoint[] = definitions.map((joint) => ({
    id: joint.id,
    ...(joint.parent ? { parent: joint.parent } : {}),
    restPosition: joint.local,
    constraints: {},
  }));
  const worlds = canonicalHumanoidWorldPositions(definitions);
  const at = (id: string) => worlds.get(id)!;
  const bone = new Map(skeleton.map((joint, index) => [joint.id, index]));
  const head = at('head');
  const headHalf = parameters.height * 0.065 * parameters.headScale;
  const shapes: Array<(position: Vec3) => number> = [];
  const ellipsoid = (center: Vec3, radii: Vec3) =>
    shapes.push((position) => ellipsoidDistance(position, center, radii));
  const capsule = (start: Vec3, end: Vec3, radius: number) =>
    shapes.push((position) => capsuleDistance(position, start, end, radius));

  ellipsoid(add(at('hips'), [0, parameters.torsoLength * 0.09, 0.012]), [
    parameters.hipWidth * 0.56,
    parameters.torsoLength * 0.27,
    parameters.chestDepth * 0.54,
  ]);
  ellipsoid(add(at('spine'), [0, parameters.torsoLength * 0.08, 0]), [
    parameters.shoulderWidth * 0.39,
    parameters.torsoLength * 0.28,
    parameters.chestDepth * 0.48,
  ]);
  ellipsoid(add(at('chest'), [0, -parameters.torsoLength * 0.1, -0.005]), [
    parameters.shoulderWidth * 0.53,
    parameters.torsoLength * 0.29,
    parameters.chestDepth * 0.57,
  ]);
  capsule(at('right-clavicle'), at('left-clavicle'), parameters.height * 0.052);
  capsule(at('chest'), at('neck'), parameters.height * 0.048);
  // Head/face geometry is owned by the stable production template below. The
  // implicit body retains only a fully enclosed support volume so the manifold
  // body stays connected to head-owned skinning without leaving a second
  // cranium intersecting the visible production surface.
  ellipsoid(add(head, [0, -headHalf * 0.08, headHalf * 0.04]), [
    headHalf * 0.42,
    headHalf * 0.52,
    headHalf * 0.4,
  ]);
  const socketX = headHalf * 0.29 * face.eyeSpacing;
  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? 1 : -1;
    capsule(at(`${side}-clavicle`), at(`${side}-upper-arm`), parameters.height * 0.038);
    capsule(at(`${side}-upper-arm`), at(`${side}-forearm`), parameters.height * 0.033);
    capsule(at(`${side}-forearm`), at(`${side}-hand`), parameters.height * 0.026);
    ellipsoid(add(at(`${side}-hand`), [sign * parameters.height * 0.008, 0, 0]), [
      parameters.height * 0.012,
      parameters.height * 0.018,
      parameters.height * 0.01,
    ]);
    capsule(at('hips'), at(`${side}-thigh`), parameters.height * 0.06);
    capsule(at(`${side}-thigh`), at(`${side}-shin`), parameters.height * 0.045);
    capsule(at(`${side}-shin`), at(`${side}-foot`), parameters.height * 0.038);
    const footCenter = scale(add(at(`${side}-foot`), at(`${side}-toe`)), 0.5);
    ellipsoid(add(footCenter, [0, parameters.height * 0.002, -parameters.height * 0.018]), [
      parameters.height * 0.038 * parameters.footScale,
      parameters.height * 0.03,
      parameters.height * 0.075 * parameters.footScale,
    ]);
    ellipsoid(add(at(`${side}-toe`), [0, 0, -parameters.height * 0.027]), [
      parameters.height * 0.04 * parameters.footScale,
      parameters.height * 0.025,
      parameters.height * 0.052 * parameters.footScale,
    ]);
  }
  const signedDistance = (position: Vec3) =>
    shapes.reduce(
      (distance, shape) => smoothUnion(distance, shape(position), parameters.height * 0.006),
      Number.POSITIVE_INFINITY,
    );
  const spanX = Math.max(Math.abs(at('left-hand')[0]), Math.abs(at('right-hand')[0]));
  const body = meshSignedDistanceField({
    minimum: [
      -spanX - parameters.height * 0.1,
      -parameters.height * 0.045,
      -parameters.height * 0.2,
    ],
    maximum: [spanX + parameters.height * 0.1, parameters.height * 1.04, parameters.height * 0.15],
    resolution: [72, 96, 48],
    signedDistance,
    skin: createSkinner(skeleton, worlds, parameters.height),
    materialId: 'skin',
  });
  const parts: MeshPart[] = [
    body,
    createAnatomicalFaceTemplate(head, headHalf, face, skeleton),
    createScalpCap(head, headHalf, skeleton),
    createArticulatedHandSurface('left', parameters.height, skeleton, worlds),
    createArticulatedHandSurface('right', parameters.height, skeleton, worlds),
    ...createFingernailSurfaces('left', parameters.height, skeleton, worlds),
    ...createFingernailSurfaces('right', parameters.height, skeleton, worlds),
  ];
  const withMaterial = (part: MeshPart, materialId: string) => {
    part.materialId = materialId;
    return part;
  };
  const ocularZ = head[2] - headHalf * 0.67;
  const browZ = head[2] - headHalf * 0.735;
  const mouthZ = head[2] - headHalf * 0.76;
  const lidPoints = (x: number, upper: boolean): Vec3[] => {
    const offsets = [-0.125, -0.065, 0, 0.065, 0.125];
    const heights = upper ? [0.13, 0.205, 0.235, 0.205, 0.13] : [0.12, 0.07, 0.052, 0.07, 0.12];
    return offsets.map(
      (offset, index) =>
        [
          x + headHalf * offset * face.eyeScale,
          head[1] + headHalf * heights[index]! * face.eyeScale,
          ocularZ - headHalf * 0.032,
        ] as Vec3,
    );
  };
  for (const sign of [-1, 1]) {
    const x = sign * socketX;
    const side = sign > 0 ? 'left' : 'right';
    parts.push(
      withMaterial(
        ellipsoidBetween(
          [x, head[1] + headHalf * 0.09, ocularZ],
          [x, head[1] + headHalf * 0.18, ocularZ],
          headHalf * 0.13 * face.eyeScale,
          headHalf * 0.04,
          bone.get('head')!,
        ),
        'eye-white',
      ),
      withMaterial(
        ellipsoidBetween(
          [x, head[1] + headHalf * 0.12, ocularZ - headHalf * 0.036],
          [x, head[1] + headHalf * 0.155, ocularZ - headHalf * 0.036],
          headHalf * 0.05,
          headHalf * 0.012,
          bone.get('head')!,
        ),
        'eyes',
      ),
      withMaterial(
        ellipsoidBetween(
          [x, head[1] + headHalf * 0.126, ocularZ - headHalf * 0.052],
          [x, head[1] + headHalf * 0.148, ocularZ - headHalf * 0.052],
          headHalf * 0.022,
          headHalf * 0.006,
          bone.get('head')!,
          bone.get('head')!,
          8,
          16,
        ),
        'pupils',
      ),
      withMaterial(
        capsuleBetween(
          [x - headHalf * 0.13, head[1] + headHalf * 0.325 * face.browHeight, browZ],
          [x, head[1] + headHalf * 0.37 * face.browHeight, browZ],
          headHalf * 0.013,
          headHalf * 0.007,
          bone.get('head')!,
          bone.get('head')!,
          2,
          12,
        ),
        'brows',
      ),
      withMaterial(
        capsuleBetween(
          [x, head[1] + headHalf * 0.37 * face.browHeight, browZ],
          [x + headHalf * 0.14, head[1] + headHalf * 0.33 * face.browHeight, browZ],
          headHalf * 0.012,
          headHalf * 0.006,
          bone.get('head')!,
          bone.get('head')!,
          2,
          12,
        ),
        'brows',
      ),
    );
    for (const upper of [true, false]) {
      const points = lidPoints(x, upper);
      for (let index = 0; index < points.length - 1; index++)
        parts.push(
          withMaterial(
            capsuleBetween(
              points[index]!,
              points[index + 1]!,
              headHalf * (upper ? 0.012 : 0.009),
              headHalf * 0.006,
              bone.get('head')!,
              bone.get('head')!,
              3,
              10,
            ),
            `eyelid-${side}`,
          ),
        );
    }
  }
  for (const sign of [-1, 1]) {
    parts.push(
      withMaterial(
        ellipsoidBetween(
          [sign * headHalf * 0.785, head[1] - headHalf * 0.14, head[2] + headHalf * 0.02],
          [sign * headHalf * 0.785, head[1] + headHalf * 0.18, head[2] + headHalf * 0.02],
          headHalf * 0.075,
          headHalf * 0.065,
          bone.get('head')!,
          bone.get('head')!,
          12,
          20,
        ),
        'skin-detail',
      ),
      withMaterial(
        ellipsoidBetween(
          [sign * headHalf * 0.79, head[1] - headHalf * 0.065, head[2] - headHalf * 0.035],
          [sign * headHalf * 0.79, head[1] + headHalf * 0.09, head[2] - headHalf * 0.035],
          headHalf * 0.028,
          headHalf * 0.018,
          bone.get('head')!,
          bone.get('head')!,
          8,
          14,
        ),
        'ear-shadow',
      ),
      withMaterial(
        ellipsoidBetween(
          [sign * headHalf * 0.055, head[1] - headHalf * 0.14, head[2] - headHalf * 0.985],
          [sign * headHalf * 0.055, head[1] - headHalf * 0.105, head[2] - headHalf * 0.985],
          headHalf * 0.018,
          headHalf * 0.006,
          bone.get('head')!,
          bone.get('head')!,
          6,
          12,
        ),
        'nostrils',
      ),
    );
  }
  const mouthHalf = headHalf * 0.22 * face.mouthWidth;
  parts.push(
    withMaterial(
      ellipsoidBetween(
        [-mouthHalf * 0.84, head[1] - headHalf * 0.35, mouthZ + headHalf * 0.004],
        [mouthHalf * 0.84, head[1] - headHalf * 0.35, mouthZ + headHalf * 0.004],
        headHalf * 0.035,
        headHalf * 0.012,
        bone.get('head')!,
      ),
      'mouth-interior',
    ),
    withMaterial(
      ellipsoidBetween(
        [-mouthHalf, head[1] - headHalf * 0.34, mouthZ - headHalf * 0.025],
        [0, head[1] - headHalf * 0.325, mouthZ - headHalf * 0.025],
        headHalf * 0.018 * face.lipFullness,
        headHalf * 0.012 * face.lipFullness,
        bone.get('head')!,
      ),
      'mouth-upper',
    ),
    withMaterial(
      ellipsoidBetween(
        [0, head[1] - headHalf * 0.325, mouthZ - headHalf * 0.025],
        [mouthHalf, head[1] - headHalf * 0.34, mouthZ - headHalf * 0.025],
        headHalf * 0.018 * face.lipFullness,
        headHalf * 0.012 * face.lipFullness,
        bone.get('head')!,
      ),
      'mouth-upper',
    ),
    withMaterial(
      ellipsoidBetween(
        [-mouthHalf * 0.88, head[1] - headHalf * 0.37, mouthZ - headHalf * 0.018],
        [mouthHalf * 0.88, head[1] - headHalf * 0.37, mouthZ - headHalf * 0.018],
        headHalf * 0.022 * face.lipFullness,
        headHalf * 0.014 * face.lipFullness,
        bone.get('head')!,
      ),
      'mouth-lower',
    ),
  );
  const material = (id: string, baseColor: Vec4, roughness: number): GeometryMaterial => ({
    id,
    baseColor,
    roughness,
    metallic: 0,
    emission: [0, 0, 0],
    emissionStrength: 0,
  });
  const geometry = mergeMeshParts('character.production-human', parts, skeleton, {
    generator: 'videoer.production-human.v2',
    characterClass: 'production-human-foundation',
    parameters,
    faceIdentityParameters: face,
    topology: 'project-owned-implicit-unified-body-v1',
    handTopology: 'project-owned-articulated-hand-surface-v1',
    faceTopology: 'project-owned-anatomical-head-template-v1',
    skinning: 'deterministic-dual-quaternion-v1',
    skinWeighting: 'anatomical-chain-smootherstep-v1',
    anatomy: {
      contract: 'videoer.production-human-anatomy.v1',
      bodyMaterialIds: ['skin'],
    },
  });
  geometry.materials = [
    material('skin', appearance.skin, 0.58),
    material('skin-detail', appearance.skin, 0.58),
    material('nail', [0.72, 0.48, 0.42, 1], 0.38),
    material('hair', appearance.hair, 0.46),
    material('eye-white', [0.82, 0.84, 0.8, 1], 0.34),
    material('eyes', appearance.eyes, 0.28),
    material('pupils', [0.004, 0.003, 0.002, 1], 0.22),
    material('eyelid-left', appearance.skin, 0.58),
    material('eyelid-right', appearance.skin, 0.58),
    material('brows', appearance.hair, 0.5),
    material('mouth-upper', [0.3, 0.075, 0.065, 1], 0.46),
    material('mouth-lower', [0.34, 0.09, 0.075, 1], 0.43),
    material('mouth-interior', [0.055, 0.008, 0.006, 1], 0.62),
    material('nostrils', [0.06, 0.018, 0.014, 1], 0.66),
    material(
      'ear-shadow',
      [appearance.skin[0] * 0.58, appearance.skin[1] * 0.5, appearance.skin[2] * 0.5, 1],
      0.62,
    ),
  ];
  addIdentityFaceMorphTargets(geometry, headHalf);
  const toeTipAt = (side: 'left' | 'right'): Vec3 => {
    const toe = at(`${side}-toe`);
    return [toe[0], toe[1], toe[2] - parameters.height * 0.052 * parameters.footScale];
  };
  geometry.attachments = {
    gaze: { position: [0, head[1], ocularZ], rotation: [0, 0, 0], bone: 'head' },
    'left-hand-grip': { position: at('left-hand'), rotation: [0, 0, 0], bone: 'left-hand' },
    'right-hand-grip': { position: at('right-hand'), rotation: [0, 0, 0], bone: 'right-hand' },
    'left-foot-contact': { position: at('left-foot'), rotation: [0, 0, 0], bone: 'left-foot' },
    'right-foot-contact': { position: at('right-foot'), rotation: [0, 0, 0], bone: 'right-foot' },
    'left-heel-contact': { position: at('left-foot'), rotation: [0, 0, 0], bone: 'left-foot' },
    'right-heel-contact': { position: at('right-foot'), rotation: [0, 0, 0], bone: 'right-foot' },
    'left-toe-contact': { position: toeTipAt('left'), rotation: [0, 0, 0], bone: 'left-toe' },
    'right-toe-contact': { position: toeTipAt('right'), rotation: [0, 0, 0], bone: 'right-toe' },
  };
  return geometry;
}
