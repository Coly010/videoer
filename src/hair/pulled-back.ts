import { ellipsoidBetween, mergeMeshParts, type MeshPart } from '../geometry/primitives.js';
import { validateGeometry, type GeometryAsset, type Vec3 } from '../geometry/model.js';
import { hairAssetDefinitionSchema } from './model.js';

const bounds = (points: Vec3[]) => ({
  minimum: [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]!))) as Vec3,
  maximum: [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]!))) as Vec3,
});

function normalized(value: Vec3): Vec3 {
  const length = Math.hypot(...value);
  if (length < 1e-8) throw new Error('Hair construction encountered a zero-length vector');
  return [value[0] / length, value[1] / length, value[2] / length];
}

function dedicatedScalpCap(
  headBone: number,
  head: ReturnType<typeof bounds>,
  clearance: number,
): MeshPart {
  const height = head.maximum[1] - head.minimum[1];
  const width = head.maximum[0] - head.minimum[0];
  const depth = head.maximum[2] - head.minimum[2];
  const center: Vec3 = [
    (head.minimum[0] + head.maximum[0]) * 0.5,
    (head.minimum[1] + head.maximum[1]) * 0.5,
    (head.minimum[2] + head.maximum[2]) * 0.5,
  ];
  const radii: Vec3 = [
    width * 0.53 + clearance,
    height * 0.53 + clearance,
    depth * 0.53 + clearance,
  ];
  const segments = 36;
  const rings = 12;
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  positions.push([center[0], center[1] + radii[1], center[2]]);
  normals.push([0, 1, 0]);
  uvs.push([0.5, 0]);
  for (let ring = 1; ring <= rings; ring++) {
    const progress = ring / rings;
    for (let segment = 0; segment < segments; segment++) {
      const phi = (segment / segments) * Math.PI * 2;
      const backness = (1 - Math.cos(phi)) * 0.5;
      const side = Math.abs(Math.sin(phi));
      const hairlineTheta = 1.27 + backness * 0.61 + side * 0.08 + Math.sin(phi) * 0.025;
      const theta = progress * hairlineTheta;
      const local: Vec3 = [
        radii[0] * Math.sin(theta) * Math.sin(phi),
        radii[1] * Math.cos(theta),
        -radii[2] * Math.sin(theta) * Math.cos(phi),
      ];
      positions.push([center[0] + local[0], center[1] + local[1], center[2] + local[2]]);
      normals.push(
        normalized([
          local[0] / (radii[0] * radii[0]),
          local[1] / (radii[1] * radii[1]),
          local[2] / (radii[2] * radii[2]),
        ]),
      );
      uvs.push([segment / segments, progress]);
    }
  }
  for (let segment = 0; segment < segments; segment++)
    indices.push(0, 1 + segment, 1 + ((segment + 1) % segments));
  for (let ring = 1; ring < rings; ring++)
    for (let segment = 0; segment < segments; segment++) {
      const current = 1 + (ring - 1) * segments + segment;
      const next = 1 + (ring - 1) * segments + ((segment + 1) % segments);
      const below = current + segments;
      const belowNext = next + segments;
      indices.push(current, below, belowNext, current, belowNext, next);
    }
  return {
    positions,
    normals,
    uvs,
    indices,
    skinIndices: positions.map(() => [headBone, 0, 0, 0]),
    skinWeights: positions.map(() => [1, 0, 0, 0]),
    materialId: 'hair-base',
  };
}

function scalpPointFromDirection(center: Vec3, radii: Vec3, direction: Vec3, lift: number) {
  const local: Vec3 = [radii[0] * direction[0], radii[1] * direction[1], radii[2] * direction[2]];
  const normal = normalized([
    local[0] / (radii[0] * radii[0]),
    local[1] / (radii[1] * radii[1]),
    local[2] / (radii[2] * radii[2]),
  ]);
  return {
    position: [
      center[0] + local[0] + normal[0] * lift,
      center[1] + local[1] + normal[1] * lift,
      center[2] + local[2] + normal[2] * lift,
    ] as Vec3,
    normal,
  };
}

function sphericalDirection(theta: number, phi: number): Vec3 {
  return [Math.sin(theta) * Math.sin(phi), Math.cos(theta), -Math.sin(theta) * Math.cos(phi)];
}

function slerpDirection(start: Vec3, end: Vec3, progress: number): Vec3 {
  const dot = Math.max(-1, Math.min(1, start[0] * end[0] + start[1] * end[1] + start[2] * end[2]));
  const angle = Math.acos(dot);
  if (angle < 1e-5) return start;
  const scale = Math.sin(angle);
  const startWeight = Math.sin((1 - progress) * angle) / scale;
  const endWeight = Math.sin(progress * angle) / scale;
  return normalized([
    start[0] * startWeight + end[0] * endWeight,
    start[1] * startWeight + end[1] * endWeight,
    start[2] * startWeight + end[2] * endWeight,
  ]);
}

function flowCard(
  center: Vec3,
  radii: Vec3,
  headBone: number,
  rootPhi: number,
  index: number,
  count: number,
): MeshPart {
  const segments = 24;
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  const targetPhi = rootPhi < 0 ? -Math.PI : Math.PI;
  const phase = (index / count) * Math.PI * 2;
  const backness = (1 - Math.cos(rootPhi)) * 0.5;
  const side = Math.abs(Math.sin(rootPhi));
  const rootTheta = 1.23 + backness * 0.61 + side * 0.08 + Math.sin(rootPhi) * 0.025;
  const startDirection = sphericalDirection(rootTheta, rootPhi);
  const endDirection = sphericalDirection(1.82, targetPhi);
  for (let segment = 0; segment <= segments; segment++) {
    const progress = segment / segments;
    const eased = progress * progress * (3 - 2 * progress);
    const lift =
      0.0004 +
      Math.sin(Math.PI * progress) * 0.0005 +
      Math.sin(progress * Math.PI * 3 + phase) * 0.00008;
    const current = scalpPointFromDirection(
      center,
      radii,
      slerpDirection(startDirection, endDirection, eased),
      lift,
    );
    const tangentProgress = progress === 1 ? progress - 0.025 : progress + 0.025;
    const tangentEased = tangentProgress * tangentProgress * (3 - 2 * tangentProgress);
    const tangentSample = scalpPointFromDirection(
      center,
      radii,
      slerpDirection(startDirection, endDirection, tangentEased),
      lift,
    );
    const direction = progress === 1 ? -1 : 1;
    const tangent = normalized([
      (tangentSample.position[0] - current.position[0]) * direction,
      (tangentSample.position[1] - current.position[1]) * direction,
      (tangentSample.position[2] - current.position[2]) * direction,
    ]);
    const lateral = normalized([
      current.normal[1] * tangent[2] - current.normal[2] * tangent[1],
      current.normal[2] * tangent[0] - current.normal[0] * tangent[2],
      current.normal[0] * tangent[1] - current.normal[1] * tangent[0],
    ]);
    const width = (0.00125 + (1 - progress) * 0.00065) * (0.97 + 0.03 * Math.sin(phase));
    positions.push(
      [
        current.position[0] - lateral[0] * width * 0.5,
        current.position[1] - lateral[1] * width * 0.5,
        current.position[2] - lateral[2] * width * 0.5,
      ],
      [
        current.position[0] + lateral[0] * width * 0.5,
        current.position[1] + lateral[1] * width * 0.5,
        current.position[2] + lateral[2] * width * 0.5,
      ],
    );
    normals.push(current.normal, current.normal);
    uvs.push([0, progress], [1, progress]);
    if (segment < segments) {
      const base = segment * 2;
      indices.push(base, base + 2, base + 3, base, base + 3, base + 1);
    }
  }
  return {
    positions,
    normals,
    uvs,
    indices,
    skinIndices: positions.map(() => [headBone, 0, 0, 0]),
    skinWeights: positions.map(() => [1, 0, 0, 0]),
    materialId: 'hair-base',
  };
}

function bunSurfaceRibbon(center: Vec3, radii: Vec3, headBone: number, phi: number): MeshPart {
  const segments = 20;
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  for (let segment = 0; segment <= segments; segment++) {
    const progress = segment / segments;
    const theta = 0.18 + progress * (Math.PI - 0.36);
    const local: Vec3 = [
      radii[0] * Math.sin(theta) * Math.cos(phi),
      radii[1] * Math.cos(theta),
      radii[2] * Math.sin(theta) * Math.sin(phi),
    ];
    const normal = normalized([
      local[0] / (radii[0] * radii[0]),
      local[1] / (radii[1] * radii[1]),
      local[2] / (radii[2] * radii[2]),
    ]);
    const tangent = normalized([
      radii[0] * Math.cos(theta) * Math.cos(phi),
      -radii[1] * Math.sin(theta),
      radii[2] * Math.cos(theta) * Math.sin(phi),
    ]);
    const lateral = normalized([
      normal[1] * tangent[2] - normal[2] * tangent[1],
      normal[2] * tangent[0] - normal[0] * tangent[2],
      normal[0] * tangent[1] - normal[1] * tangent[0],
    ]);
    const lift = 0.00045;
    const width = 0.0015;
    const point: Vec3 = [
      center[0] + local[0] + normal[0] * lift,
      center[1] + local[1] + normal[1] * lift,
      center[2] + local[2] + normal[2] * lift,
    ];
    positions.push(
      [
        point[0] - lateral[0] * width * 0.5,
        point[1] - lateral[1] * width * 0.5,
        point[2] - lateral[2] * width * 0.5,
      ],
      [
        point[0] + lateral[0] * width * 0.5,
        point[1] + lateral[1] * width * 0.5,
        point[2] + lateral[2] * width * 0.5,
      ],
    );
    normals.push(normal, normal);
    uvs.push([0, progress], [1, progress]);
    if (segment < segments) {
      const base = segment * 2;
      indices.push(base, base + 2, base + 3, base, base + 3, base + 1);
    }
  }
  return {
    positions,
    normals,
    uvs,
    indices,
    skinIndices: positions.map(() => [headBone, 0, 0, 0]),
    skinWeights: positions.map(() => [1, 0, 0, 0]),
    materialId: 'hair-base',
  };
}

export function createPulledBackHair(target: GeometryAsset) {
  const headBone = target.skeleton.findIndex((joint) => joint.id === 'head');
  if (headBone < 0) throw new Error(`Target '${target.id}' has no canonical head joint`);
  if (!target.skinIndices || !target.skinWeights)
    throw new Error(`Target '${target.id}' has no reusable skin-weight contract`);
  const targetSkinIndices = target.skinIndices;
  const targetSkinWeights = target.skinWeights;
  const owned = target.positions.filter((_, index) => {
    const influences = targetSkinIndices[index] ?? [0, 0, 0, 0];
    const weights = targetSkinWeights[index] ?? [0, 0, 0, 0];
    return influences.some((bone, influence) => bone === headBone && weights[influence]! >= 0.35);
  });
  if (owned.length < 100) throw new Error(`Target '${target.id}' lacks a stable head fit region`);
  const head = bounds(owned);
  const center: Vec3 = [
    (head.minimum[0] + head.maximum[0]) * 0.5,
    (head.minimum[1] + head.maximum[1]) * 0.5,
    (head.minimum[2] + head.maximum[2]) * 0.5,
  ];
  const width = head.maximum[0] - head.minimum[0];
  const height = head.maximum[1] - head.minimum[1];
  const depth = head.maximum[2] - head.minimum[2];
  const clearance = 0.01;
  const cap = dedicatedScalpCap(headBone, head, clearance);
  const mass = (start: Vec3, end: Vec3, radiusX: number, radiusZ: number): MeshPart => {
    const part = ellipsoidBetween(start, end, radiusX, radiusZ, headBone, headBone, 12, 24);
    part.materialId = 'hair-base';
    return part;
  };
  const radii: Vec3 = [
    width * 0.53 + clearance,
    height * 0.53 + clearance,
    depth * 0.53 + clearance,
  ];
  const back = center[2] + radii[2];
  const parts: MeshPart[] = [cap];
  const cardCount = 72;
  const phiSpan = 1.92;
  for (let index = 0; index < cardCount; index++) {
    const progress = index / (cardCount - 1);
    const phi = -phiSpan + progress * phiSpan * 2 + Math.sin(index * 2.17) * 0.008;
    parts.push(flowCard(center, radii, headBone, phi, index, cardCount));
  }
  const bunCenter: Vec3 = [center[0], center[1] - height * 0.34, back + depth * 0.08];
  parts.push(
    mass(
      [bunCenter[0], bunCenter[1] - height * 0.12, bunCenter[2]],
      [bunCenter[0], bunCenter[1] + height * 0.12, bunCenter[2]],
      width * 0.235,
      depth * 0.19,
    ),
  );
  const bunRadii: Vec3 = [width * 0.235, height * 0.12, depth * 0.19];
  for (let ribbon = 0; ribbon < 12; ribbon++)
    parts.push(bunSurfaceRibbon(bunCenter, bunRadii, headBone, (ribbon / 12) * Math.PI * 2));
  const definition = hairAssetDefinitionSchema.parse({
    schemaVersion: 1,
    id: 'hair.pulled-back-low-bun',
    version: '0.7.0',
    style: 'pulled-back-low-bun',
    representation: 'dedicated-scalp-layered-cards',
    compatibleSkeleton: 'canonical-humanoid-v1',
    anchorJoint: 'head',
    fit: {
      scalpClearanceMeters: clearance,
      headWidthMeters: width,
      headHeightMeters: height,
      headDepthMeters: depth,
    },
    cardSystem: {
      scalpTopology: 'parametric-continuous-cap-v1',
      cardCount,
      segmentsPerCard: 24,
      widthMinimumMeters: 0.00125,
      widthMaximumMeters: 0.0019,
      rootLiftMeters: 0.0004,
      silhouetteBreakupMeters: 0.0009,
    },
    material: { melaninColor: [0.018, 0.006, 0.003], roughness: 0.72, anisotropy: 0.2 },
    metadata: { generator: 'videoer.layered-mesh-hair.v7', sourceTarget: target.id },
  });
  const geometry = mergeMeshParts(definition.id, parts, target.skeleton, {
    hairClass: definition.style,
    assetVersion: definition.version,
    compatibleSkeleton: definition.compatibleSkeleton,
    anchorJoint: definition.anchorJoint,
    sourceTarget: target.id,
    fit: definition.fit,
  });
  geometry.materials = [
    {
      id: 'hair-base',
      baseColor: [...definition.material.melaninColor, 1],
      roughness: definition.material.roughness,
      metallic: 0,
      specularIorLevel: 0.06,
      anisotropy: definition.material.anisotropy,
      anisotropyRotation: 0,
      fiber: {
        kind: 'uv-hair-flow',
        strandFrequency: 120,
        colorVariation: 0.08,
        normalStrength: 0.045,
      },
      emission: [0, 0, 0],
      emissionStrength: 0,
    },
  ];
  const validation = validateGeometry(geometry);
  if (!validation.valid)
    throw new Error(
      `Hair geometry failed: ${validation.issues.map((issue) => issue.code).join(', ')}`,
    );
  return { definition, geometry, validation, headBone, ownedHeadVertices: owned.length };
}
