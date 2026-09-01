import { z } from 'zod';
import type {
  GeometryAsset,
  GeometryMaterial,
  SkeletonJoint,
  Vec3,
  Vec4,
} from '../geometry/model.js';
import {
  capsuleBetween,
  ellipsoidBetween,
  mergeMeshParts,
  type MeshPart,
} from '../geometry/primitives.js';
import { longDressDrapeInfluences } from '../clothing/drape.js';

export const humanoidParametersSchema = z.object({
  height: z.number().min(1.2).max(2.2).default(1.72),
  shoulderWidth: z.number().min(0.28).max(0.65).default(0.42),
  hipWidth: z.number().min(0.22).max(0.55).default(0.32),
  torsoLength: z.number().min(0.35).max(0.75).default(0.49),
  chestDepth: z.number().min(0.12).max(0.4).default(0.22),
  armLength: z.number().min(0.45).max(0.9).default(0.62),
  legLength: z.number().min(0.65).max(1.2).default(0.88),
  headScale: z.number().min(0.75).max(1.3).default(1),
  handScale: z.number().min(0.7).max(1.4).default(1),
  footScale: z.number().min(0.7).max(1.4).default(1),
});
export type HumanoidParameters = z.input<typeof humanoidParametersSchema>;

export interface HumanoidAppearance {
  skin: Vec4;
  hair: Vec4;
  eyes: Vec4;
  dress: Vec4;
  leather: Vec4;
}

export interface CanonicalJointDefinition {
  id: string;
  parent?: string;
  local: Vec3;
}

export function canonicalHumanoidJoints(
  parameters: z.output<typeof humanoidParametersSchema>,
): CanonicalJointDefinition[] {
  const footHeight = parameters.height * 0.035 * parameters.footScale;
  const hipY = footHeight + parameters.legLength;
  const headLength = parameters.height * 0.13 * parameters.headScale;
  const chestRise = parameters.torsoLength * 0.72;
  const neckRise = parameters.torsoLength * 0.2;
  const remainingHeadRise = Math.max(0.08, parameters.height - hipY - chestRise - neckRise);
  const upperArm = parameters.armLength * 0.52;
  const forearm = parameters.armLength * 0.48;
  const hand = parameters.height * 0.105 * parameters.handScale;
  const thigh = parameters.legLength * 0.51;
  const shin = parameters.legLength * 0.49;
  return [
    { id: 'root', local: [0, 0, 0] },
    { id: 'hips', parent: 'root', local: [0, hipY, 0] },
    { id: 'spine', parent: 'hips', local: [0, parameters.torsoLength * 0.32, 0] },
    { id: 'chest', parent: 'spine', local: [0, parameters.torsoLength * 0.4, 0] },
    { id: 'neck', parent: 'chest', local: [0, neckRise, 0] },
    {
      id: 'head',
      parent: 'neck',
      local: [0, Math.max(headLength * 0.55, remainingHeadRise * 0.45), 0],
    },
    {
      id: 'left-clavicle',
      parent: 'chest',
      local: [parameters.shoulderWidth * 0.48, parameters.torsoLength * 0.04, 0],
    },
    { id: 'left-upper-arm', parent: 'left-clavicle', local: [upperArm, 0, 0] },
    { id: 'left-forearm', parent: 'left-upper-arm', local: [forearm, 0, 0] },
    { id: 'left-hand', parent: 'left-forearm', local: [hand, 0, 0] },
    {
      id: 'right-clavicle',
      parent: 'chest',
      local: [-parameters.shoulderWidth * 0.48, parameters.torsoLength * 0.04, 0],
    },
    { id: 'right-upper-arm', parent: 'right-clavicle', local: [-upperArm, 0, 0] },
    { id: 'right-forearm', parent: 'right-upper-arm', local: [-forearm, 0, 0] },
    { id: 'right-hand', parent: 'right-forearm', local: [-hand, 0, 0] },
    {
      id: 'left-thigh',
      parent: 'hips',
      local: [parameters.hipWidth * 0.28, -parameters.legLength * 0.02, 0],
    },
    { id: 'left-shin', parent: 'left-thigh', local: [0, -thigh, 0] },
    { id: 'left-foot', parent: 'left-shin', local: [0, -shin, 0] },
    {
      id: 'left-toe',
      parent: 'left-foot',
      local: [0, -footHeight * 0.25, -parameters.height * 0.084 * parameters.footScale],
    },
    {
      id: 'right-thigh',
      parent: 'hips',
      local: [-parameters.hipWidth * 0.28, -parameters.legLength * 0.02, 0],
    },
    { id: 'right-shin', parent: 'right-thigh', local: [0, -thigh, 0] },
    { id: 'right-foot', parent: 'right-shin', local: [0, -shin, 0] },
    {
      id: 'right-toe',
      parent: 'right-foot',
      local: [0, -footHeight * 0.25, -parameters.height * 0.084 * parameters.footScale],
    },
  ];
}

export function canonicalHumanoidWorldPositions(joints: CanonicalJointDefinition[]) {
  const result = new Map<string, Vec3>();
  for (const joint of joints) {
    const parent = joint.parent ? result.get(joint.parent) : undefined;
    result.set(
      joint.id,
      parent
        ? [parent[0] + joint.local[0], parent[1] + joint.local[1], parent[2] + joint.local[2]]
        : joint.local,
    );
  }
  return result;
}

function createDressSkirt(
  parameters: z.output<typeof humanoidParametersSchema>,
  hips: Vec3,
  hipsBone: number,
  leftThighBone: number,
  rightThighBone: number,
): MeshPart {
  const ringCount = 8;
  const radialSegments = 32;
  const topY = hips[1] + parameters.torsoLength * 0.2;
  const bottomY = parameters.height * 0.095;
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  const skinIndices: Vec4[] = [];
  const skinWeights: Vec4[] = [];
  for (let ring = 0; ring < ringCount; ring++) {
    const v = ring / (ringCount - 1);
    const shaped = v * v * (3 - 2 * v);
    // The upper skirt must enclose both anatomical thigh capsules, not merely the
    // hip centreline. The earlier 0.55 multiplier visibly rendered well but cut
    // through the outside of each upper thigh in renderer-independent geometry.
    const radiusX = parameters.hipWidth * (0.72 + shaped * 0.55);
    const radiusZ = parameters.chestDepth * (0.85 + shaped * 1.4);
    const y = topY + (bottomY - topY) * v;
    for (let radial = 0; radial <= radialSegments; radial++) {
      const u = radial / radialSegments;
      const angle = u * Math.PI * 2;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const position: Vec3 = [hips[0] + cosine * radiusX, y, hips[2] + sine * radiusZ];
      positions.push(position);
      const normalLength = Math.hypot(cosine, 0.28, sine);
      normals.push([cosine / normalLength, 0.28 / normalLength, sine / normalLength]);
      uvs.push([u, v]);
      const influence = longDressDrapeInfluences(
        position,
        bottomY,
        hips[1],
        hipsBone,
        leftThighBone,
        rightThighBone,
      );
      skinIndices.push(influence.indices);
      skinWeights.push(influence.weights);
    }
  }
  const row = radialSegments + 1;
  for (let ring = 0; ring < ringCount - 1; ring++)
    for (let radial = 0; radial < radialSegments; radial++) {
      const a = ring * row + radial;
      const b = a + row;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  return {
    positions,
    normals,
    uvs,
    indices,
    skinIndices,
    skinWeights,
    materialId: 'dress',
  };
}

export function createHumanoidMannequin(
  input: HumanoidParameters = {},
  appearance?: HumanoidAppearance,
): GeometryAsset {
  const parameters = humanoidParametersSchema.parse(input);
  const definitions = canonicalHumanoidJoints(parameters);
  const skeleton: SkeletonJoint[] = definitions.map((joint) => ({
    id: joint.id,
    ...(joint.parent ? { parent: joint.parent } : {}),
    restPosition: joint.local,
    constraints: {},
  }));
  const worlds = canonicalHumanoidWorldPositions(definitions);
  const bone = new Map(skeleton.map((joint, index) => [joint.id, index]));
  const at = (id: string) => {
    const value = worlds.get(id);
    if (!value) throw new Error(`Missing canonical joint '${id}'`);
    return value;
  };
  const boneAt = (id: string) => {
    const value = bone.get(id);
    if (value === undefined) throw new Error(`Missing canonical bone '${id}'`);
    return value;
  };
  const toeTipAt = (side: 'left' | 'right'): Vec3 => {
    const toe = at(`${side}-toe`);
    return [toe[0], toe[1], toe[2] - parameters.height * 0.036 * parameters.footScale];
  };
  const parts: MeshPart[] = [];
  const styled = Boolean(appearance);
  const withMaterial = (part: MeshPart, materialId: string) => {
    part.materialId = materialId;
    return part;
  };
  const limbRadius = parameters.height * 0.042;
  const capsulePart = (
    start: string,
    end: string,
    radiusX: number,
    radiusZ = radiusX,
    startBone = start,
    endBone = startBone,
    materialId?: string,
  ) =>
    parts.push(
      materialId
        ? withMaterial(
            capsuleBetween(
              at(start),
              at(end),
              radiusX,
              radiusZ,
              boneAt(startBone),
              boneAt(endBone),
            ),
            materialId,
          )
        : capsuleBetween(at(start), at(end), radiusX, radiusZ, boneAt(startBone), boneAt(endBone)),
    );

  capsulePart(
    'hips',
    'spine',
    parameters.hipWidth * 0.5,
    parameters.chestDepth * 0.48,
    'hips',
    'hips',
    styled ? 'dress' : undefined,
  );
  capsulePart(
    'spine',
    'chest',
    parameters.shoulderWidth * 0.48,
    parameters.chestDepth * 0.52,
    'spine',
    'spine',
    styled ? 'dress' : undefined,
  );
  capsulePart(
    'chest',
    'neck',
    parameters.height * 0.055,
    parameters.height * 0.05,
    'chest',
    'chest',
    styled ? 'skin' : undefined,
  );
  const head = at('head');
  const headHalf = parameters.height * 0.065 * parameters.headScale;
  const headPart = ellipsoidBetween(
    [head[0], head[1] - headHalf, head[2]],
    [head[0], head[1] + headHalf, head[2]],
    headHalf * 0.76,
    headHalf * 0.82,
    boneAt('head'),
  );
  parts.push(styled ? withMaterial(headPart, 'skin') : headPart);
  for (const side of ['left', 'right'] as const) {
    capsulePart(
      `${side}-clavicle`,
      `${side}-upper-arm`,
      limbRadius * 1.2,
      limbRadius * 1.1,
      `${side}-clavicle`,
      `${side}-clavicle`,
      styled ? 'dress' : undefined,
    );
    capsulePart(
      `${side}-upper-arm`,
      `${side}-forearm`,
      limbRadius,
      limbRadius * 0.92,
      `${side}-upper-arm`,
      `${side}-upper-arm`,
      styled ? 'dress' : undefined,
    );
    capsulePart(
      `${side}-forearm`,
      `${side}-hand`,
      limbRadius * 0.72 * parameters.handScale,
      limbRadius * 0.55,
      `${side}-forearm`,
      `${side}-forearm`,
      styled ? 'skin' : undefined,
    );
    capsulePart(
      `${side}-thigh`,
      `${side}-shin`,
      limbRadius * 1.45,
      limbRadius * 1.32,
      `${side}-thigh`,
      `${side}-thigh`,
      styled ? 'leather' : undefined,
    );
    capsulePart(
      `${side}-shin`,
      `${side}-foot`,
      limbRadius * 1.05,
      limbRadius * 0.95,
      `${side}-shin`,
      `${side}-shin`,
      styled ? 'leather' : undefined,
    );
    capsulePart(
      `${side}-foot`,
      `${side}-toe`,
      limbRadius * 1.2 * parameters.footScale,
      limbRadius * 0.72,
      `${side}-foot`,
      `${side}-foot`,
      styled ? 'leather' : undefined,
    );
    const toe = at(`${side}-toe`);
    const toeTip = toeTipAt(side);
    const toePart = capsuleBetween(
      toe,
      toeTip,
      limbRadius * 1.08 * parameters.footScale,
      limbRadius * 0.62,
      boneAt(`${side}-toe`),
      boneAt(`${side}-toe`),
    );
    parts.push(styled ? withMaterial(toePart, 'leather') : toePart);
  }
  if (appearance) {
    const faceZ = head[2] - headHalf * 0.76;
    for (const x of [-headHalf * 0.3, headHalf * 0.3]) {
      parts.push(
        withMaterial(
          ellipsoidBetween(
            [x, head[1] + headHalf * 0.13, faceZ + headHalf * 0.015],
            [x, head[1] + headHalf * 0.27, faceZ + headHalf * 0.015],
            headHalf * 0.125,
            headHalf * 0.075,
            boneAt('head'),
          ),
          'eye-white',
        ),
      );
      parts.push(
        withMaterial(
          ellipsoidBetween(
            [x, head[1] + headHalf * 0.16, faceZ - headHalf * 0.055],
            [x, head[1] + headHalf * 0.245, faceZ - headHalf * 0.055],
            headHalf * 0.068,
            headHalf * 0.045,
            boneAt('head'),
          ),
          'eyes',
        ),
      );
      const browInner = x + (x < 0 ? headHalf * 0.13 : -headHalf * 0.13);
      const browOuter = x + (x < 0 ? -headHalf * 0.13 : headHalf * 0.13);
      parts.push(
        withMaterial(
          capsuleBetween(
            [browInner, head[1] + headHalf * 0.39, faceZ - headHalf * 0.025],
            [browOuter, head[1] + headHalf * 0.39, faceZ - headHalf * 0.02],
            headHalf * 0.016,
            headHalf * 0.012,
            boneAt('head'),
          ),
          'hair',
        ),
      );
    }
    parts.push(
      withMaterial(
        capsuleBetween(
          [0, head[1] + headHalf * 0.04, faceZ - headHalf * 0.02],
          [0, head[1] - headHalf * 0.035, faceZ - headHalf * 0.12],
          headHalf * 0.055,
          headHalf * 0.045,
          boneAt('head'),
        ),
        'skin',
      ),
    );
    parts.push(
      withMaterial(
        capsuleBetween(
          [-headHalf * 0.18, head[1] - headHalf * 0.3, faceZ - headHalf * 0.055],
          [headHalf * 0.18, head[1] - headHalf * 0.3, faceZ - headHalf * 0.055],
          headHalf * 0.018,
          headHalf * 0.012,
          boneAt('head'),
        ),
        'mouth',
      ),
    );
    parts.push(
      withMaterial(
        ellipsoidBetween(
          [0, head[1] - headHalf * 0.88, head[2] + headHalf * 0.3],
          [0, head[1] + headHalf * 1.05, head[2] + headHalf * 0.3],
          headHalf * 0.88,
          headHalf * 0.7,
          boneAt('head'),
        ),
        'hair',
      ),
    );
    parts.push(
      withMaterial(
        ellipsoidBetween(
          [0, at('chest')[1] - parameters.torsoLength * 0.05, parameters.chestDepth * 0.38],
          [0, head[1] + headHalf * 0.35, headHalf * 0.5],
          parameters.shoulderWidth * 0.34,
          parameters.chestDepth * 0.26,
          boneAt('chest'),
        ),
        'hair',
      ),
    );
    parts.push(
      createDressSkirt(
        parameters,
        at('hips'),
        boneAt('hips'),
        boneAt('left-thigh'),
        boneAt('right-thigh'),
      ),
    );
  }
  const geometry = mergeMeshParts('character.humanoid-mannequin', parts, skeleton, {
    generator: 'videoer.parametric-humanoid.v1',
    parameters,
    topology: 'procedural-overlapping-capsule-study',
    skinning: 'deterministic-rigid-region-v1',
  });
  geometry.attachments = {
    gaze: { position: [0, head[1], head[2] - headHalf], rotation: [0, 0, 0], bone: 'head' },
    'left-hand-grip': { position: at('left-hand'), rotation: [0, 0, 0], bone: 'left-hand' },
    'right-hand-grip': { position: at('right-hand'), rotation: [0, 0, 0], bone: 'right-hand' },
    'left-foot-contact': { position: at('left-foot'), rotation: [0, 0, 0], bone: 'left-foot' },
    'right-foot-contact': { position: at('right-foot'), rotation: [0, 0, 0], bone: 'right-foot' },
    'left-heel-contact': { position: at('left-foot'), rotation: [0, 0, 0], bone: 'left-foot' },
    'right-heel-contact': { position: at('right-foot'), rotation: [0, 0, 0], bone: 'right-foot' },
    'left-toe-contact': { position: toeTipAt('left'), rotation: [0, 0, 0], bone: 'left-toe' },
    'right-toe-contact': { position: toeTipAt('right'), rotation: [0, 0, 0], bone: 'right-toe' },
  };
  if (appearance) {
    const material = (
      id: string,
      baseColor: Vec4,
      roughness: number,
      metallic = 0,
    ): GeometryMaterial => ({
      id,
      baseColor,
      roughness,
      metallic,
      emission: [0, 0, 0],
      emissionStrength: 0,
    });
    geometry.id = 'character.cinematic-heroine';
    geometry.materials = [
      material('skin', appearance.skin, 0.62),
      material('hair', appearance.hair, 0.42),
      material('eye-white', [0.82, 0.84, 0.8, 1], 0.34),
      material('eyes', appearance.eyes, 0.28),
      material('mouth', [0.24, 0.045, 0.035, 1], 0.5),
      material('dress', appearance.dress, 0.72),
      material('leather', appearance.leather, 0.48),
    ];
    geometry.metadata.appearance = appearance;
    geometry.metadata.characterClass = 'stylized-recurring-heroine';
    geometry.metadata.clothingSkinningPolicy = 'long-dress-drape-v1';
  }
  return geometry;
}
