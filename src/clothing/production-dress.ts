import { geometryAssetSchema, validateGeometry, type GeometryAsset } from '../geometry/model.js';

type Vec3 = [number, number, number];

const normalized = (value: Vec3): Vec3 => {
  const magnitude = Math.hypot(...value) || 1;
  return [value[0] / magnitude, value[1] / magnitude, value[2] / magnitude];
};

function worldJointPositions(asset: GeometryAsset) {
  const output = new Map<string, Vec3>();
  for (const joint of asset.skeleton) {
    const parent = joint.parent ? output.get(joint.parent) : undefined;
    output.set(
      joint.id,
      parent
        ? [
            parent[0] + joint.restPosition[0],
            parent[1] + joint.restPosition[1],
            parent[2] + joint.restPosition[2],
          ]
        : joint.restPosition,
    );
  }
  return output;
}

function torsoWeight(body: GeometryAsset, vertex: number, torso: Set<number>) {
  return (body.skinIndices?.[vertex] ?? []).reduce(
    (total, joint, influence) =>
      total + (torso.has(joint) ? (body.skinWeights?.[vertex]?.[influence] ?? 0) : 0),
    0,
  );
}

function boundaryTopology(indices: number[]) {
  const edges = new Map<string, [number, number, number]>();
  const surfaceAdjacency = new Map<number, Set<number>>();
  const add = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const current = edges.get(key);
    edges.set(key, current ? [current[0], current[1], current[2] + 1] : [a, b, 1]);
    if (!surfaceAdjacency.has(a)) surfaceAdjacency.set(a, new Set());
    if (!surfaceAdjacency.has(b)) surfaceAdjacency.set(b, new Set());
    surfaceAdjacency.get(a)!.add(b);
    surfaceAdjacency.get(b)!.add(a);
  };
  for (let offset = 0; offset < indices.length; offset += 3) {
    const [a, b, c] = indices.slice(offset, offset + 3) as [number, number, number];
    add(a, b);
    add(b, c);
    add(c, a);
  }
  const adjacency = new Map<number, Set<number>>();
  for (const [a, b, count] of edges.values())
    if (count === 1) {
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a)!.add(b);
      adjacency.get(b)!.add(a);
    }
  const invalidBoundaryVertexCount = [...adjacency.values()].filter(
    (items) => items.size !== 2,
  ).length;
  let boundaryLoopCount = 0;
  const visited = new Set<number>();
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    boundaryLoopCount++;
    const stack = [start];
    while (stack.length) {
      const vertex = stack.pop()!;
      if (visited.has(vertex)) continue;
      visited.add(vertex);
      stack.push(...(adjacency.get(vertex) ?? []));
    }
  }
  let connectedComponentCount = 0;
  const connected = new Set<number>();
  for (const start of surfaceAdjacency.keys()) {
    if (connected.has(start)) continue;
    connectedComponentCount++;
    const stack = [start];
    while (stack.length) {
      const vertex = stack.pop()!;
      if (connected.has(vertex)) continue;
      connected.add(vertex);
      stack.push(...(surfaceAdjacency.get(vertex) ?? []));
    }
  }
  return {
    boundaryEdgeCount: adjacency.size,
    boundaryLoopCount,
    invalidBoundaryVertexCount,
    connectedComponentCount,
  };
}

export function createProductionBoatNeckDress(
  body: GeometryAsset,
  options: {
    id?: string;
    clearanceMeters?: number;
    hemHeightRatio?: number;
    flareScaleX?: number;
    flareScaleZ?: number;
    crossSectionExponent?: number;
    fitEaseScale?: number;
  } = {},
) {
  if (!body.normals || !body.uvs || !body.skinIndices || !body.skinWeights)
    throw new Error('Production dress derivation requires body normals, UVs, and skin weights');
  const clearance = options.clearanceMeters ?? 0.012;
  const hemHeightRatio = options.hemHeightRatio ?? 0.09;
  const flareScaleX = options.flareScaleX ?? 2.05;
  const flareScaleZ = options.flareScaleZ ?? 1.95;
  const crossSectionExponent = options.crossSectionExponent ?? 3.6;
  const fitEaseScale = options.fitEaseScale ?? 1.08;
  if (!(clearance > 0 && clearance <= 0.03))
    throw new Error('Production dress clearance must be greater than zero and at most 0.03m');
  if (!(hemHeightRatio >= 0.04 && hemHeightRatio <= 0.3))
    throw new Error('Production dress hem height ratio must be between 0.04 and 0.3');
  if (!(flareScaleX >= 1 && flareScaleX <= 3.5 && flareScaleZ >= 1 && flareScaleZ <= 3.5))
    throw new Error('Production dress flare scales must be between 1 and 3.5');
  if (!(crossSectionExponent >= 2 && crossSectionExponent <= 6))
    throw new Error('Production dress cross-section exponent must be between 2 and 6');
  if (!(fitEaseScale >= 1 && fitEaseScale <= 1.3))
    throw new Error('Production dress fit ease scale must be between 1 and 1.3');
  const jointIndex = (id: string) => {
    const index = body.skeleton.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Production dress target lacks '${id}'`);
    return index;
  };
  const joints = worldJointPositions(body);
  const jointPosition = (id: string) => {
    const value = joints.get(id);
    if (!value) throw new Error(`Production dress target lacks '${id}'`);
    return value;
  };
  const hips = jointIndex('hips');
  const spine = jointIndex('spine');
  const chest = jointIndex('chest');
  const leftClavicle = jointIndex('left-clavicle');
  const rightClavicle = jointIndex('right-clavicle');
  const leftThigh = jointIndex('left-thigh');
  const rightThigh = jointIndex('right-thigh');
  const torso = new Set([hips, spine, chest, leftClavicle, rightClavicle]);
  const hipsY = jointPosition('hips')[1];
  const spineY = jointPosition('spine')[1];
  const chestY = jointPosition('chest')[1];
  const neckY = jointPosition('neck')[1];
  const groundY = Math.min(...body.positions.map((position) => position[1]));
  const crownY = Math.max(...body.positions.map((position) => position[1]));
  const bodyHeight = crownY - groundY;
  const torsoHalfWidth =
    Math.max(
      Math.abs(jointPosition('left-upper-arm')[0]),
      Math.abs(jointPosition('right-upper-arm')[0]),
    ) * 1.28;
  const waistY = hipsY + (spineY - hipsY) * 0.16;
  const armholeY = chestY + (neckY - chestY) * 0.04;
  const necklineY = chestY + (neckY - chestY) * 0.55;
  const hemY = groundY + bodyHeight * hemHeightRatio;
  const sectionTolerance = Math.max(0.012, (neckY - hipsY) / 24);
  const measuredSectionClearances: number[] = [];
  const measureSection = (y: number) => {
    const samples = body.positions.filter(
      (position, vertex) =>
        Math.abs(position[1] - y) <= sectionTolerance &&
        Math.abs(position[0]) <= torsoHalfWidth &&
        torsoWeight(body, vertex, torso) >= 0.08,
    );
    if (samples.length < 12)
      throw new Error(`Production body has no stable torso cross-section at y=${y.toFixed(4)}`);
    const minimumX = Math.min(...samples.map((position) => position[0]));
    const maximumX = Math.max(...samples.map((position) => position[0]));
    const minimumZ = Math.min(...samples.map((position) => position[2]));
    const maximumZ = Math.max(...samples.map((position) => position[2]));
    const centerX = (minimumX + maximumX) * 0.5;
    const centerZ = (minimumZ + maximumZ) * 0.5;
    const radiusX = ((maximumX - minimumX) * 0.5 + clearance) * fitEaseScale;
    const radiusZ = ((maximumZ - minimumZ) * 0.5 + clearance) * fitEaseScale;
    const maximumImplicitRadius = Math.max(
      ...samples.map((position) => {
        const x = Math.abs((position[0] - centerX) / radiusX) ** crossSectionExponent;
        const z = Math.abs((position[2] - centerZ) / radiusZ) ** crossSectionExponent;
        return (x + z) ** (1 / crossSectionExponent);
      }),
    );
    measuredSectionClearances.push((1 - maximumImplicitRadius) * Math.min(radiusX, radiusZ));
    return {
      centerX,
      centerZ,
      radiusX,
      radiusZ,
    };
  };

  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const skinIndices: [number, number, number, number][] = [];
  const skinWeights: [number, number, number, number][] = [];
  const indices: number[] = [];
  const segments = 64;
  const superellipse = (value: number) =>
    Math.sign(value) * Math.abs(value) ** (2 / crossSectionExponent);
  const connectRings = (start: number, rings: number) => {
    for (let ring = 0; ring < rings - 1; ring++)
      for (let segment = 0; segment < segments; segment++) {
        const next = (segment + 1) % segments;
        const first = start + ring * segments + segment;
        const second = start + ring * segments + next;
        const third = start + (ring + 1) * segments + segment;
        const fourth = start + (ring + 1) * segments + next;
        indices.push(first, third, fourth, first, fourth, second);
      }
  };

  const bodiceRings = 12;
  for (let ring = 0; ring < bodiceRings; ring++) {
    const progress = ring / (bodiceRings - 1);
    for (let segment = 0; segment < segments; segment++) {
      const angle = (segment / segments) * Math.PI * 2;
      const frontBack = Math.abs(Math.sin(angle));
      const topY = armholeY + (necklineY - armholeY) * frontBack ** 1.6;
      const y = waistY + (topY - waistY) * progress;
      const section = measureSection(y);
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      positions.push([
        section.centerX + superellipse(cosine) * section.radiusX,
        y,
        section.centerZ + superellipse(sine) * section.radiusZ,
      ]);
      normals.push(normalized([cosine / section.radiusX, 0, sine / section.radiusZ]));
      uvs.push([segment / segments, progress]);
      const upperWeight = progress * 0.82;
      skinIndices.push([spine, chest, hips, 0]);
      skinWeights.push([1 - upperWeight, upperWeight, 0, 0]);
    }
  }
  connectRings(0, bodiceRings);

  const waistSection = measureSection(waistY);
  const skirtStart = positions.length;
  const skirtRings = 14;
  for (let ring = 0; ring < skirtRings; ring++) {
    const progress = ring / (skirtRings - 1);
    const eased = progress * progress * (3 - 2 * progress);
    const y = waistY + (hemY - waistY) * progress;
    const radiusX = waistSection.radiusX * (1 + (flareScaleX - 1) * eased);
    const radiusZ = waistSection.radiusZ * (1 + (flareScaleZ - 1) * eased);
    for (let segment = 0; segment < segments; segment++) {
      const angle = (segment / segments) * Math.PI * 2;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      positions.push([
        waistSection.centerX + superellipse(cosine) * radiusX,
        y,
        waistSection.centerZ + superellipse(sine) * radiusZ,
      ]);
      normals.push(normalized([cosine / radiusX, 0.12, sine / radiusZ]));
      uvs.push([segment / segments, progress]);
      const sideThigh = cosine < 0 ? leftThigh : rightThigh;
      const thighWeight = 0.16 * progress;
      skinIndices.push([hips, sideThigh, spine, 0]);
      skinWeights.push([0.82 - thighWeight, thighWeight, 0.18, 0]);
    }
  }
  connectRings(skirtStart, skirtRings);

  const topology = boundaryTopology(indices);
  if (
    topology.connectedComponentCount !== 2 ||
    topology.boundaryLoopCount !== 4 ||
    topology.invalidBoundaryVertexCount !== 0
  )
    throw new Error('Production dress does not have two intact bodice/skirt surfaces and loops');
  const minimumMeasuredSectionClearanceMeters = Math.min(...measuredSectionClearances);
  if (minimumMeasuredSectionClearanceMeters < clearance * 0.5)
    throw new Error('Production dress failed its sampled torso section clearance gate');
  const bodiceVertexCount = bodiceRings * segments;
  const skirtVertexCount = skirtRings * segments;
  const dress = geometryAssetSchema.parse({
    schemaVersion: 1,
    id: options.id ?? 'clothing.production-boat-neck-cap-edge-long-dress',
    units: 'meters',
    coordinateSystem: body.coordinateSystem,
    positions,
    normals,
    uvs,
    indices,
    skinIndices,
    skinWeights,
    materials: [{ id: 'dress', baseColor: [0.035, 0.045, 0.07, 1], metallic: 0, roughness: 0.76 }],
    materialGroups: [{ materialId: 'dress', start: 0, count: indices.length }],
    skeleton: structuredClone(body.skeleton),
    morphTargets: [],
    attachments: {},
    metadata: {
      sourceTarget: body.id,
      targetGeometry: body.id,
      clothingClass: 'production-body-measured-boat-neck-cap-edge-long-dress',
      topology: 'production-body-cross-section-bodice-measured-skirt-v1',
      generator: 'videoer.production-sleeveless-dress.v1',
      garmentClearanceMeters: clearance,
      minimumMeasuredSectionClearanceMeters,
      hemHeightRatio,
      flareScaleX,
      flareScaleZ,
      crossSectionExponent,
      fitEaseScale,
      waistY,
      armholeY,
      necklineY,
      hemY,
      measuredWaistRadiusX: waistSection.radiusX,
      measuredWaistRadiusZ: waistSection.radiusZ,
      weightTransferRegions: [
        {
          id: 'fitted-bodice',
          startVertex: 0,
          vertexCount: bodiceVertexCount,
          maximumDistanceMeters: 0.065,
        },
        {
          id: 'flared-skirt',
          startVertex: skirtStart,
          vertexCount: skirtVertexCount,
          maximumDistanceMeters: 0.24,
        },
      ],
      ...topology,
    },
  });
  const validation = validateGeometry(dress);
  if (!validation.valid)
    throw new Error(
      `Production dress failed geometry validation: ${validation.issues.map((issue) => issue.message).join('; ')}`,
    );
  return dress;
}
