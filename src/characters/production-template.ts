import type {
  GeometryAsset,
  GeometryMaterial,
  SkeletonJoint,
  Vec3,
  Vec4,
} from '../geometry/model.js';
import { parseObjGeometryWithSourceMap, parseObjGroupCentres } from '../geometry/obj.js';
import {
  canonicalHumanoidJoints,
  humanoidParametersSchema,
  type HumanoidParameters,
} from './mannequin.js';
import { articulatedHandJointDefinitions } from './hands.js';
import { identifySoleSurfaceRegions } from './sole-surface.js';

const visualGroups = [
  'body',
  'helper-l-eye',
  'helper-r-eye',
  'helper-upper-teeth',
  'helper-lower-teeth',
  'helper-tongue',
  'helper-l-eyelashes-1',
  'helper-r-eyelashes-1',
] as const;

const landmarkByJoint: Record<string, string> = {
  hips: 'joint-pelvis',
  spine: 'joint-spine-3',
  chest: 'joint-spine-1',
  neck: 'joint-neck',
  head: 'joint-head',
  'left-clavicle': 'joint-l-clavicle',
  'left-upper-arm': 'joint-l-shoulder',
  'left-forearm': 'joint-l-elbow',
  'left-hand': 'joint-l-hand',
  'right-clavicle': 'joint-r-clavicle',
  'right-upper-arm': 'joint-r-shoulder',
  'right-forearm': 'joint-r-elbow',
  'right-hand': 'joint-r-hand',
  'left-thigh': 'joint-l-upper-leg',
  'left-shin': 'joint-l-knee',
  'left-foot': 'joint-l-ankle',
  // foot-1 is the metatarsal/ball-of-foot hinge. foot-2 sits near the toe tips
  // and produces severe forefoot stretching if used as the shared toe pivot.
  'left-toe': 'joint-l-foot-1',
  'right-thigh': 'joint-r-upper-leg',
  'right-shin': 'joint-r-knee',
  'right-foot': 'joint-r-ankle',
  'right-toe': 'joint-r-foot-1',
};

for (const side of ['left', 'right'] as const) {
  const sourceSide = side === 'left' ? 'l' : 'r';
  for (const [finger, sourceFinger] of [
    ['thumb', 1],
    ['index', 2],
    ['middle', 3],
    ['ring', 4],
    ['little', 5],
  ] as const)
    for (let segment = 1; segment <= 3; segment++)
      landmarkByJoint[`${side}-${finger}-${segment}`] =
        `joint-${sourceSide}-finger-${sourceFinger}-${segment}`;
}

interface MakeHumanWeights {
  license: string;
  weights: Record<string, Array<[number, number]>>;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function sourceBoneToVideoer(source: string): string {
  const side = source.endsWith('.L') ? 'left' : source.endsWith('.R') ? 'right' : undefined;
  const stem = source.replace(/\.[LR]$/u, '');
  const finger = /^finger([1-5])-([1-3])$/u.exec(stem);
  if (finger && side) {
    const names = ['thumb', 'index', 'middle', 'ring', 'little'] as const;
    return `${side}-${names[Number(finger[1]) - 1]}-${finger[2]}`;
  }
  if (stem === 'clavicle' && side) return `${side}-clavicle`;
  if ((stem === 'shoulder01' || stem.startsWith('upperarm')) && side) return `${side}-upper-arm`;
  if (stem.startsWith('lowerarm') && side) return `${side}-forearm`;
  if ((stem === 'wrist' || stem.startsWith('metacarpal')) && side) return `${side}-hand`;
  if (stem.startsWith('upperleg') && side) return `${side}-thigh`;
  if (stem.startsWith('lowerleg') && side) return `${side}-shin`;
  if (stem === 'foot' && side) return `${side}-foot`;
  if (stem.startsWith('toe') && side) return `${side}-toe`;
  if (stem === 'spine01' || stem === 'spine02') return 'spine';
  if (stem === 'spine03' || stem === 'spine04' || stem === 'spine05' || stem === 'breast')
    return 'chest';
  if (stem.startsWith('neck')) return 'neck';
  if (stem === 'root' || stem === 'pelvis' || stem.startsWith('special')) return 'hips';
  // The current Videoer face is morph-driven rather than bone-driven. Preserve
  // the authored source distribution but collapse facial, ocular, jaw, and
  // tongue groups into the stable head joint until optional face bones exist.
  return 'head';
}

function sourceBoneInfluences(source: string, shoulderUpperArmWeight: number) {
  const side = source.endsWith('.L') ? 'left' : source.endsWith('.R') ? 'right' : undefined;
  if (source.replace(/\.[LR]$/u, '') === 'shoulder01' && side)
    return [
      { joint: `${side}-clavicle`, weight: 1 - shoulderUpperArmWeight },
      { joint: `${side}-upper-arm`, weight: shoulderUpperArmWeight },
    ];
  return [{ joint: sourceBoneToVideoer(source), weight: 1 }];
}

function sourceBounds(source: string) {
  const positions = source
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('v '))
    .map((line) => line.trim().split(/\s+/u).slice(1, 4).map(Number) as Vec3);
  if (!positions.length) throw new Error('Production template OBJ has no positions');
  return {
    minimum: [0, 1, 2].map((axis) =>
      Math.min(...positions.map((position) => position[axis]!)),
    ) as Vec3,
    maximum: [0, 1, 2].map((axis) =>
      Math.max(...positions.map((position) => position[axis]!)),
    ) as Vec3,
  };
}

function createAlignedSkeleton(
  source: string,
  transform: (position: Vec3) => Vec3,
  parameters: HumanoidParameters,
) {
  const resolved = humanoidParametersSchema.parse(parameters);
  const definitions = [
    ...canonicalHumanoidJoints(resolved),
    ...articulatedHandJointDefinitions(resolved.height),
  ];
  const landmarks = parseObjGroupCentres(source, Object.values(landmarkByJoint), transform);
  const world = new Map<string, Vec3>([['root', [0, 0, 0]]]);
  for (const definition of definitions) {
    if (definition.id === 'root') continue;
    const landmark = landmarkByJoint[definition.id];
    if (!landmark)
      throw new Error(`Production template lacks a landmark mapping for '${definition.id}'`);
    world.set(definition.id, landmarks.get(landmark)!);
  }
  return definitions.map((definition) => {
    const position = world.get(definition.id)!;
    const parentPosition = definition.parent ? world.get(definition.parent)! : undefined;
    return {
      id: definition.id,
      ...(definition.parent ? { parent: definition.parent } : {}),
      restPosition: parentPosition ? subtract(position, parentPosition) : position,
      constraints: {},
    } satisfies SkeletonJoint;
  });
}

function applyAuthoredWeights(
  geometry: GeometryAsset,
  sourcePositionIndices: number[],
  weightSource: string,
  shoulderUpperArmWeight: number,
) {
  const parsed = JSON.parse(weightSource) as MakeHumanWeights;
  if (parsed.license !== 'CC0')
    throw new Error(`Production template weights require CC0, received '${parsed.license}'`);
  const jointById = new Map(geometry.skeleton.map((joint, index) => [joint.id, index]));
  const sourceWeights = new Map<number, Map<string, number>>();
  for (const [sourceBone, entries] of Object.entries(parsed.weights)) {
    const targets = sourceBoneInfluences(sourceBone, shoulderUpperArmWeight);
    for (const target of targets)
      if (!jointById.has(target.joint))
        throw new Error(
          `Authored source weight '${sourceBone}' maps to absent joint '${target.joint}'`,
        );
    for (const [vertex, weight] of entries) {
      if (!(Number.isInteger(vertex) && vertex >= 0 && Number.isFinite(weight) && weight >= 0))
        throw new Error(`Authored source weight '${sourceBone}' contains an invalid entry`);
      const weights = sourceWeights.get(vertex) ?? new Map<string, number>();
      for (const target of targets)
        weights.set(target.joint, (weights.get(target.joint) ?? 0) + weight * target.weight);
      sourceWeights.set(vertex, weights);
    }
  }
  const packed = sourcePositionIndices.map((sourceVertex, vertex) => {
    const weights = sourceWeights.get(sourceVertex);
    if (!weights?.size)
      throw new Error(`Production template vertex ${vertex} lacks authored weights`);
    const ranked = [...weights]
      .filter(([, weight]) => weight > 0)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4);
    const total = ranked.reduce((sum, [, weight]) => sum + weight, 0);
    if (!(total > 0)) throw new Error(`Production template vertex ${vertex} has zero total weight`);
    while (ranked.length < 4) ranked.push(['root', 0]);
    return {
      indices: ranked.map(([joint]) => jointById.get(joint)!) as Vec4,
      weights: ranked.map(([, weight]) => weight / total) as Vec4,
    };
  });
  geometry.skinIndices = packed.map((value) => value.indices);
  geometry.skinWeights = packed.map((value) => value.weights);
}

function stabilizeReducedJointWeights(
  geometry: GeometryAsset,
  world: ReadonlyMap<string, Vec3>,
  height: number,
  shoulderIterations: number,
  thumbIterations: number,
) {
  if (!geometry.skinIndices || !geometry.skinWeights)
    throw new Error('Production template requires skin weights before shoulder stabilization');
  if (!(
    Number.isInteger(shoulderIterations) &&
    shoulderIterations >= 0 &&
    shoulderIterations <= 12
  ))
    throw new Error('Production template shoulder smoothing iterations must be 0–12');
  if (!(Number.isInteger(thumbIterations) && thumbIterations >= 0 && thumbIterations <= 12))
    throw new Error('Production template thumb smoothing iterations must be 0–12');
  if (!shoulderIterations && !thumbIterations) return;
  const neighbours = Array.from({ length: geometry.positions.length }, () => new Set<number>());
  for (let index = 0; index < geometry.indices.length; index += 3) {
    const triangle = [
      geometry.indices[index]!,
      geometry.indices[index + 1]!,
      geometry.indices[index + 2]!,
    ];
    for (const [left, right] of [
      [triangle[0]!, triangle[1]!],
      [triangle[1]!, triangle[2]!],
      [triangle[2]!, triangle[0]!],
    ] as const) {
      neighbours[left]!.add(right);
      neighbours[right]!.add(left);
    }
  }
  const unpack = (vertex: number) => {
    const weights = new Map<number, number>();
    for (let influence = 0; influence < 4; influence++) {
      const joint = geometry.skinIndices![vertex]![influence]!;
      const weight = geometry.skinWeights![vertex]![influence]!;
      if (weight > 1e-8) weights.set(joint, (weights.get(joint) ?? 0) + weight);
    }
    return weights;
  };
  const pack = (vertex: number, weights: ReadonlyMap<number, number>) => {
    const ranked = [...weights]
      .filter(([, weight]) => weight > 1e-8)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4);
    const total = ranked.reduce((sum, [, weight]) => sum + weight, 0);
    while (ranked.length < 4) ranked.push([0, 0]);
    geometry.skinIndices![vertex] = ranked.map(([joint]) => joint) as Vec4;
    geometry.skinWeights![vertex] = ranked.map(([, weight]) => weight / total) as Vec4;
  };
  const smoothRegion = (
    centreId: string,
    relevantIds: string[],
    radius: number,
    iterations: number,
  ) => {
    if (!iterations) return;
    const centre = world.get(centreId);
    const relevant = relevantIds
      .map((id) => geometry.skeleton.findIndex((joint) => joint.id === id))
      .filter((joint) => joint >= 0);
    if (!centre || relevant.length !== relevantIds.length)
      throw new Error(`Production template lacks the '${centreId}' weight-smoothing chain`);
    const vertices = geometry.positions
      .map((position, vertex) => ({ position, vertex }))
      .filter(
        ({ position, vertex }) =>
          Math.hypot(position[0] - centre[0], position[1] - centre[1], position[2] - centre[2]) <=
            radius &&
          relevant.reduce((sum, joint) => sum + (unpack(vertex).get(joint) ?? 0), 0) > 0.5,
      )
      .map(({ vertex }) => vertex);
    const included = new Set(vertices);
    for (let iteration = 0; iteration < iterations; iteration++) {
      const updates = new Map<number, Map<number, number>>();
      for (const vertex of vertices) {
        const own = unpack(vertex);
        const localNeighbours = [...neighbours[vertex]!].filter((candidate) =>
          included.has(candidate),
        );
        if (!localNeighbours.length) continue;
        const relevantTotal = relevant.reduce((sum, joint) => sum + (own.get(joint) ?? 0), 0);
        const smoothed = new Map(own);
        for (const joint of relevant) {
          const neighbourMean =
            localNeighbours.reduce(
              (sum, candidate) => sum + (unpack(candidate).get(joint) ?? 0),
              0,
            ) / localNeighbours.length;
          smoothed.set(joint, (own.get(joint) ?? 0) * 0.5 + neighbourMean * 0.5);
        }
        const smoothedTotal = relevant.reduce((sum, joint) => sum + (smoothed.get(joint) ?? 0), 0);
        for (const joint of relevant)
          smoothed.set(joint, ((smoothed.get(joint) ?? 0) * relevantTotal) / smoothedTotal);
        updates.set(vertex, smoothed);
      }
      for (const [vertex, weights] of updates) pack(vertex, weights);
    }
  };
  for (const side of ['left', 'right'] as const) {
    smoothRegion(
      `${side}-upper-arm`,
      [`${side}-upper-arm`, `${side}-clavicle`, 'spine'],
      height * 0.095,
      shoulderIterations,
    );
    smoothRegion(
      `${side}-thumb-1`,
      [`${side}-hand`, `${side}-thumb-1`, `${side}-thumb-2`],
      height * 0.04,
      thumbIterations,
    );
  }
}

/**
 * The source rig has separate joints for every toe segment, while Videoer's
 * stable locomotion rig intentionally exposes one toe-roll joint per foot.
 * Simply summing all source toe weights makes that reduced joint shear the
 * forefoot. Reproject the combined foot/toe mass across a narrow metatarsal
 * transition so the reduction preserves a coherent ball-of-foot hinge.
 */
function stabilizeSharedToeWeights(
  geometry: GeometryAsset,
  world: ReadonlyMap<string, Vec3>,
  height: number,
) {
  if (!geometry.skinIndices || !geometry.skinWeights)
    throw new Error('Production template requires skin weights before toe stabilization');
  const transitionLength = height * 0.02325;
  for (const side of ['left', 'right'] as const) {
    const foot = geometry.skeleton.findIndex((joint) => joint.id === `${side}-foot`);
    const toe = geometry.skeleton.findIndex((joint) => joint.id === `${side}-toe`);
    const pivot = world.get(`${side}-toe`);
    if (foot < 0 || toe < 0 || !pivot)
      throw new Error(`Production template lacks the ${side} foot/toe reduction chain`);
    for (let vertex = 0; vertex < geometry.positions.length; vertex++) {
      const weights = new Map<number, number>();
      for (let influence = 0; influence < 4; influence++) {
        const joint = geometry.skinIndices[vertex]![influence]!;
        weights.set(joint, (weights.get(joint) ?? 0) + geometry.skinWeights[vertex]![influence]!);
      }
      const footToeWeight = (weights.get(foot) ?? 0) + (weights.get(toe) ?? 0);
      if (footToeWeight <= 1e-8) continue;
      const toeBlend = Math.max(
        0,
        Math.min(1, 0.5 + (pivot[2] - geometry.positions[vertex]![2]) / transitionLength),
      );
      weights.set(foot, footToeWeight * (1 - toeBlend));
      weights.set(toe, footToeWeight * toeBlend);
      const ranked = [...weights]
        .filter(([, weight]) => weight > 1e-8)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 4);
      const total = ranked.reduce((sum, [, weight]) => sum + weight, 0);
      while (ranked.length < 4) ranked.push([0, 0]);
      geometry.skinIndices[vertex] = ranked.map(([joint]) => joint) as Vec4;
      geometry.skinWeights[vertex] = ranked.map(([, weight]) => weight / total) as Vec4;
    }
  }
}

const material = (id: string, baseColor: Vec4, roughness: number): GeometryMaterial => ({
  id,
  baseColor,
  roughness,
  metallic: 0,
  emission: [0, 0, 0],
  emissionStrength: 0,
});

/**
 * Converts the pinned CC0 hm08 topology and authored weights into Videoer's
 * stable domain format. This is a production-base experiment, not a verified
 * character and not a replacement for visual acceptance.
 *
 * @deprecated Retired as a production target by ADR 074. The production human is
 * MPFB's hm08 CC0 mesh + a Rigify rig (`scripts/blender/render_mpfb_motion_probe.py`),
 * which keeps the full mesh instead of reducing it into this owned contract.
 * Retained only for the existing benchmark and tests until a migration removes it.
 */
export function createProductionTemplateHuman(
  source: string,
  weightSource: string,
  parametersInput: HumanoidParameters = {},
  rigOptions: {
    shoulderUpperArmWeight?: number;
    shoulderSmoothingIterations?: number;
    thumbSmoothingIterations?: number;
  } = {},
) {
  const parameters = humanoidParametersSchema.parse(parametersInput);
  // Preserve the measured 45/55 reduction of MakeHuman's shoulder01 helper,
  // then smooth only the collapsed reduced joint chains. Five iterations are
  // the measured minimum that prevents local shoulder inversions across the
  // 32-phase gait-v4 surface gate; four still leaves one inverted triangle,
  // while additional iterations begin increasing high-percentile strain.
  const shoulderUpperArmWeight = rigOptions.shoulderUpperArmWeight ?? 0.45;
  const shoulderSmoothingIterations = rigOptions.shoulderSmoothingIterations ?? 5;
  const thumbSmoothingIterations = rigOptions.thumbSmoothingIterations ?? 2;
  if (!(shoulderUpperArmWeight >= 0 && shoulderUpperArmWeight <= 1))
    throw new Error('Production template shoulder upper-arm weight must be between zero and one');
  const bounds = sourceBounds(source);
  const sourceHeight = bounds.maximum[1] - bounds.minimum[1];
  const scale = parameters.height / sourceHeight;
  const pelvisSource = parseObjGroupCentres(source, ['joint-pelvis']).get('joint-pelvis')!;
  const transform = ([x, y, z]: Vec3): Vec3 => [
    x * scale,
    (y - bounds.minimum[1]) * scale,
    -(z - pelvisSource[2]) * scale,
  ];
  const materials = {
    skin: material('skin', [0.58, 0.36, 0.26, 1], 0.52),
    'eye-white': material('eye-white', [0.78, 0.8, 0.77, 1], 0.3),
    teeth: material('teeth', [0.72, 0.7, 0.62, 1], 0.34),
    tongue: material('tongue', [0.34, 0.08, 0.07, 1], 0.5),
    eyelashes: material('eyelashes', [0.018, 0.009, 0.006, 1], 0.58),
  };
  const materialByGroup = {
    body: 'skin',
    'helper-l-eye': 'eye-white',
    'helper-r-eye': 'eye-white',
    'helper-upper-teeth': 'teeth',
    'helper-lower-teeth': 'teeth',
    'helper-tongue': 'tongue',
    'helper-l-eyelashes-1': 'eyelashes',
    'helper-r-eyelashes-1': 'eyelashes',
  };
  const { geometry, sourcePositionIndices } = parseObjGeometryWithSourceMap(source, {
    id: 'character.production-template-human',
    groups: visualGroups,
    materials,
    materialByGroup,
    transform,
    reverseWinding: true,
    metadata: {
      characterClass: 'production-template-human',
      parameters,
      productionPose: 'a-pose',
      topology: 'makehuman-hm08-cc0-derived-v1',
      sourceAssetSha256: '8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c',
      sourceWeightsSha256: '0f3641d651ae3d00ad6b4ccee43142edb109d3bd909d27d9e4139ef1beed8625',
      sourceLicence: 'CC0-1.0',
      skinning: 'deterministic-dual-quaternion-v1',
      weightReduction: {
        sourceRig: 'makehuman-default-139-group-v1',
        shoulder01UpperArmWeight: shoulderUpperArmWeight,
        shoulder01ClavicleWeight: 1 - shoulderUpperArmWeight,
        shoulderSmoothing: {
          method: 'topology-neighbour-laplacian-v1',
          iterations: shoulderSmoothingIterations,
          blend: 0.5,
          radiusHeightRatio: 0.095,
        },
        thumbSmoothing: {
          method: 'topology-neighbour-laplacian-v1',
          iterations: thumbSmoothingIterations,
          blend: 0.5,
          radiusHeightRatio: 0.04,
        },
        toeStrategy: 'shared-metatarsal-hinge-v1',
        toeTransitionHeightRatio: 0.02325,
      },
      soleContactStrategy: 'rigid-outsole-surface-v1',
    },
  });
  geometry.skeleton = createAlignedSkeleton(source, transform, parameters);
  applyAuthoredWeights(geometry, sourcePositionIndices, weightSource, shoulderUpperArmWeight);
  const world = new Map<string, Vec3>();
  for (const joint of geometry.skeleton) {
    const parent = joint.parent ? world.get(joint.parent)! : ([0, 0, 0] as Vec3);
    world.set(joint.id, add(parent, joint.restPosition));
  }
  stabilizeReducedJointWeights(
    geometry,
    world,
    parameters.height,
    shoulderSmoothingIterations,
    thumbSmoothingIterations,
  );
  stabilizeSharedToeWeights(geometry, world, parameters.height);
  const eyes = parseObjGroupCentres(source, ['helper-l-eye', 'helper-r-eye'], transform);
  const leftEye = eyes.get('helper-l-eye')!;
  const rightEye = eyes.get('helper-r-eye')!;
  const eyeMidpoint = add(leftEye, rightEye).map((value) => value * 0.5) as Vec3;
  const soles = {
    left: identifySoleSurfaceRegions(geometry, 'left'),
    right: identifySoleSurfaceRegions(geometry, 'right'),
  };
  geometry.attachments = {
    // This witness comes from visible ocular geometry, so verification can
    // prove that this particular mesh travels in the direction its face sees.
    gaze: { position: eyeMidpoint, rotation: [0, 0, 0], bone: 'head' },
    'left-hand-grip': { position: world.get('left-hand')!, rotation: [0, 0, 0], bone: 'left-hand' },
    'right-hand-grip': {
      position: world.get('right-hand')!,
      rotation: [0, 0, 0],
      bone: 'right-hand',
    },
    'left-heel-contact': {
      position: soles.left.heel.contactWitness,
      rotation: [0, 0, 0],
      bone: 'left-foot',
    },
    'right-heel-contact': {
      position: soles.right.heel.contactWitness,
      rotation: [0, 0, 0],
      bone: 'right-foot',
    },
    'left-toe-contact': {
      position: soles.left.forefoot.contactWitness,
      rotation: [0, 0, 0],
      bone: 'left-toe',
    },
    'right-toe-contact': {
      position: soles.right.forefoot.contactWitness,
      rotation: [0, 0, 0],
      bone: 'right-toe',
    },
  };
  return geometry;
}
