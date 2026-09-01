import type { Vec3, Vec4 } from './model.js';
import type { MeshPart } from './primitives.js';

export interface ImplicitSurfaceOptions {
  minimum: Vec3;
  maximum: Vec3;
  resolution: [number, number, number];
  signedDistance: (position: Vec3) => number;
  skin: (position: Vec3) => { indices: Vec4; weights: Vec4 };
  materialId?: string;
  weldScale?: number;
  minimumFaceCrossMagnitude?: number;
}

const cubeCorners = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
] as const;

// Every cube uses the same body diagonal. Shared faces therefore receive the
// same diagonal, so independently visited cells cannot open cracks.
const tetrahedra = [
  [0, 5, 1, 6],
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
] as const;

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (value: Vec3): Vec3 => {
  const length = Math.hypot(...value);
  return length > 1e-12 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 1, 0];
};

function enforceConsistentWinding(indices: number[]) {
  const edges = new Map<string, Array<{ triangle: number; direction: 1 | -1 }>>();
  const triangleCount = indices.length / 3;
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const offset = triangle * 3;
    const vertices = [indices[offset]!, indices[offset + 1]!, indices[offset + 2]!];
    for (let edge = 0; edge < 3; edge++) {
      const left = vertices[edge]!;
      const right = vertices[(edge + 1) % 3]!;
      const key = left < right ? `${left}:${right}` : `${right}:${left}`;
      const entries = edges.get(key) ?? [];
      entries.push({ triangle, direction: left < right ? 1 : -1 });
      edges.set(key, entries);
    }
  }
  const visited = new Uint8Array(triangleCount);
  const flipped = new Uint8Array(triangleCount);
  for (let start = 0; start < triangleCount; start++) {
    if (visited[start]) continue;
    visited[start] = 1;
    const queue = [start];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const triangle = queue[cursor]!;
      const offset = triangle * 3;
      const vertices = [indices[offset]!, indices[offset + 1]!, indices[offset + 2]!];
      for (let edge = 0; edge < 3; edge++) {
        const left = vertices[edge]!;
        const right = vertices[(edge + 1) % 3]!;
        const key = left < right ? `${left}:${right}` : `${right}:${left}`;
        const currentDirection = (left < right ? 1 : -1) * (flipped[triangle] ? -1 : 1);
        for (const neighbor of edges.get(key) ?? []) {
          if (neighbor.triangle === triangle || visited[neighbor.triangle]) continue;
          const desired = -currentDirection;
          flipped[neighbor.triangle] = neighbor.direction === desired ? 0 : 1;
          visited[neighbor.triangle] = 1;
          queue.push(neighbor.triangle);
        }
      }
    }
  }
  for (let triangle = 0; triangle < triangleCount; triangle++)
    if (flipped[triangle]) {
      const offset = triangle * 3;
      [indices[offset + 1], indices[offset + 2]] = [indices[offset + 2]!, indices[offset + 1]!];
    }
}

export function meshSignedDistanceField(options: ImplicitSurfaceOptions): MeshPart {
  const [nx, ny, nz] = options.resolution;
  if (nx < 2 || ny < 2 || nz < 2)
    throw new Error('Implicit surface resolution must be at least 2³');
  const step: Vec3 = [
    (options.maximum[0] - options.minimum[0]) / nx,
    (options.maximum[1] - options.minimum[1]) / ny,
    (options.maximum[2] - options.minimum[2]) / nz,
  ];
  const sx = nx + 1;
  const sy = ny + 1;
  const pointId = (x: number, y: number, z: number) => x + sx * (y + sy * z);
  const pointAt = (x: number, y: number, z: number): Vec3 => [
    options.minimum[0] + x * step[0],
    options.minimum[1] + y * step[1],
    options.minimum[2] + z * step[2],
  ];
  const values = new Float64Array(sx * sy * (nz + 1));
  // A tiny deterministic isovalue offset prevents an otherwise valid surface
  // from landing exactly on grid corners and producing zero-area slivers.
  const isovalueOffset = Math.min(...step) * 0.031;
  for (let z = 0; z <= nz; z++)
    for (let y = 0; y <= ny; y++)
      for (let x = 0; x <= nx; x++)
        values[pointId(x, y, z)] = options.signedDistance(pointAt(x, y, z)) - isovalueOffset;

  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  const skinIndices: Vec4[] = [];
  const skinWeights: Vec4[] = [];
  const edgeVertices = new Map<string, number>();
  const positionVertices = new Map<string, number>();
  const epsilon = Math.min(...step) * 0.35;
  const gradient = (position: Vec3): Vec3 =>
    normalize([
      options.signedDistance([position[0] + epsilon, position[1], position[2]]) -
        options.signedDistance([position[0] - epsilon, position[1], position[2]]),
      options.signedDistance([position[0], position[1] + epsilon, position[2]]) -
        options.signedDistance([position[0], position[1] - epsilon, position[2]]),
      options.signedDistance([position[0], position[1], position[2] + epsilon]) -
        options.signedDistance([position[0], position[1], position[2] - epsilon]),
    ]);
  const edgeVertex = (leftId: number, rightId: number, left: Vec3, right: Vec3) => {
    const leftValue = values[leftId]!;
    const rightValue = values[rightId]!;
    const denominator = leftValue - rightValue;
    const amount =
      Math.abs(denominator) > 1e-12 ? Math.max(0, Math.min(1, leftValue / denominator)) : 0.5;
    const key =
      amount <= 1e-9
        ? `point:${leftId}`
        : amount >= 1 - 1e-9
          ? `point:${rightId}`
          : leftId < rightId
            ? `${leftId}:${rightId}`
            : `${rightId}:${leftId}`;
    const existing = edgeVertices.get(key);
    if (existing !== undefined) return existing;
    const position: Vec3 = [
      left[0] + (right[0] - left[0]) * amount,
      left[1] + (right[1] - left[1]) * amount,
      left[2] + (right[2] - left[2]) * amount,
    ];
    // Weld sub-0.1-millimetre intersections created when the isosurface passes
    // very near a tetrahedron corner. This is far below visual or rigging
    // tolerances but removes numerically unstable sliver triangles.
    const positionKey = position
      .map((value) => Math.round(value * (options.weldScale ?? 1e4)))
      .join(':');
    const spatiallyExisting = positionVertices.get(positionKey);
    if (spatiallyExisting !== undefined) {
      edgeVertices.set(key, spatiallyExisting);
      return spatiallyExisting;
    }
    const vertex = positions.length;
    const skin = options.skin(position);
    positions.push(position);
    normals.push(gradient(position));
    uvs.push([
      (Math.atan2(position[0], -position[2]) / (Math.PI * 2) + 1) % 1,
      (position[1] - options.minimum[1]) / (options.maximum[1] - options.minimum[1]),
    ]);
    skinIndices.push(skin.indices);
    skinWeights.push(skin.weights);
    edgeVertices.set(key, vertex);
    positionVertices.set(positionKey, vertex);
    return vertex;
  };
  const addTriangle = (a: number, b: number, c: number) => {
    if (a === b || b === c || a === c) return;
    const face = cross(
      subtract(positions[b]!, positions[a]!),
      subtract(positions[c]!, positions[a]!),
    );
    const outward: Vec3 = [
      normals[a]![0] + normals[b]![0] + normals[c]![0],
      normals[a]![1] + normals[b]![1] + normals[c]![1],
      normals[a]![2] + normals[b]![2] + normals[c]![2],
    ];
    if (Math.hypot(...face) <= (options.minimumFaceCrossMagnitude ?? 1e-12)) return;
    if (dot(face, outward) >= 0) indices.push(a, b, c);
    else indices.push(a, c, b);
  };

  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const corners = cubeCorners.map(([dx, dy, dz]) => ({
          id: pointId(x + dx, y + dy, z + dz),
          position: pointAt(x + dx, y + dy, z + dz),
        }));
        for (const tetrahedron of tetrahedra) {
          const inside = tetrahedron.filter((corner) => values[corners[corner]!.id]! <= 0);
          if (inside.length === 0 || inside.length === 4) continue;
          const outside = tetrahedron.filter((corner) => values[corners[corner]!.id]! > 0);
          const vertex = (left: number, right: number) => {
            const a = corners[left]!;
            const b = corners[right]!;
            return edgeVertex(a.id, b.id, a.position, b.position);
          };
          if (inside.length === 1 || inside.length === 3) {
            const pivotInside = inside.length === 1;
            const pivot = (pivotInside ? inside : outside)[0]!;
            const ring = pivotInside ? outside : inside;
            addTriangle(vertex(pivot, ring[0]!), vertex(pivot, ring[1]!), vertex(pivot, ring[2]!));
          } else {
            const i0 = inside[0]!;
            const i1 = inside[1]!;
            const o0 = outside[0]!;
            const o1 = outside[1]!;
            const a = vertex(i0, o0);
            const b = vertex(i0, o1);
            const c = vertex(i1, o0);
            const d = vertex(i1, o1);
            addTriangle(a, b, c);
            addTriangle(b, d, c);
          }
        }
      }

  enforceConsistentWinding(indices);

  // Thresholded sliver rejection can leave an edge-intersection vertex with no
  // surviving triangle. Compact all attributes so serialized geometry remains
  // fail-closed under the ordinary unreferenced-vertex validator.
  const used = [...new Set(indices)].sort((a, b) => a - b);
  const remap = new Map(used.map((source, target) => [source, target]));

  return {
    positions: used.map((index) => positions[index]!),
    normals: used.map((index) => normals[index]!),
    uvs: used.map((index) => uvs[index]!),
    indices: indices.map((index) => remap.get(index)!),
    skinIndices: used.map((index) => skinIndices[index]!),
    skinWeights: used.map((index) => skinWeights[index]!),
    ...(options.materialId ? { materialId: options.materialId } : {}),
  };
}
