import type { GeometryAsset, GeometryMaterial, Vec3 } from './model.js';

export interface ObjGeometryOptions {
  id: string;
  groups: readonly string[];
  materials: Record<string, GeometryMaterial>;
  materialByGroup: Record<string, string>;
  transform?: (position: Vec3) => Vec3;
  reverseWinding?: boolean;
  metadata?: Record<string, unknown>;
}

interface ObjCorner {
  position: number;
  uv?: number;
}

interface ObjFace {
  group: string;
  corners: ObjCorner[];
}

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (value: Vec3): Vec3 => {
  const length = Math.hypot(...value);
  return length > 1e-12 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 1, 0];
};

function resolveObjIndex(value: string, length: number, line: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed === 0)
    throw new Error(`OBJ line ${line}: invalid index '${value}'`);
  const resolved = parsed > 0 ? parsed - 1 : length + parsed;
  if (resolved < 0 || resolved >= length)
    throw new Error(`OBJ line ${line}: index '${value}' is outside the source attribute`);
  return resolved;
}

/**
 * Converts explicitly allowlisted OBJ groups into Videoer's renderer-independent
 * triangle format. Position/UV corner seams remain explicit vertices, while
 * quads and larger polygons are deterministically fan-triangulated.
 */
export function parseObjGeometryWithSourceMap(source: string, options: ObjGeometryOptions) {
  const sourcePositions: Vec3[] = [];
  const sourceUvs: [number, number][] = [];
  const faces: ObjFace[] = [];
  const allowed = new Set(options.groups);
  let group = '';
  for (const [offset, raw] of source.split(/\r?\n/u).entries()) {
    const lineNumber = offset + 1;
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const fields = line.split(/\s+/u);
    if (fields[0] === 'v') {
      if (fields.length < 4) throw new Error(`OBJ line ${lineNumber}: vertex requires XYZ`);
      const position = fields.slice(1, 4).map(Number);
      if (position.some((value) => !Number.isFinite(value)))
        throw new Error(`OBJ line ${lineNumber}: vertex contains a non-finite value`);
      sourcePositions.push(position as Vec3);
    } else if (fields[0] === 'vt') {
      if (fields.length < 3)
        throw new Error(`OBJ line ${lineNumber}: texture coordinate requires UV`);
      const uv = fields.slice(1, 3).map(Number);
      if (uv.some((value) => !Number.isFinite(value)))
        throw new Error(`OBJ line ${lineNumber}: texture coordinate contains a non-finite value`);
      sourceUvs.push(uv as [number, number]);
    } else if (fields[0] === 'g') {
      group = fields[1] ?? '';
    } else if (fields[0] === 'f' && allowed.has(group)) {
      if (fields.length < 4) throw new Error(`OBJ line ${lineNumber}: face requires three corners`);
      const corners = fields.slice(1).map((field) => {
        const [position, uv] = field.split('/');
        if (!position) throw new Error(`OBJ line ${lineNumber}: face corner lacks a position`);
        return {
          position: resolveObjIndex(position, sourcePositions.length, lineNumber),
          ...(uv ? { uv: resolveObjIndex(uv, sourceUvs.length, lineNumber) } : {}),
        };
      });
      faces.push({ group, corners });
    }
  }
  if (!sourcePositions.length) throw new Error('OBJ contains no positions');
  if (!faces.length)
    throw new Error(`OBJ contains no faces in groups: ${options.groups.join(', ')}`);

  const positions: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  const vertexByCorner = new Map<string, number>();
  const sourcePositionIndices: number[] = [];
  const materialGroups: GeometryAsset['materialGroups'] = [];
  const transform = options.transform ?? ((position: Vec3) => position);
  const vertex = (corner: ObjCorner) => {
    const key = `${corner.position}/${corner.uv ?? ''}`;
    const existing = vertexByCorner.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length;
    const transformed = transform(sourcePositions[corner.position]!);
    if (transformed.some((value) => !Number.isFinite(value)))
      throw new Error(
        `OBJ transform produced a non-finite position at source vertex ${corner.position}`,
      );
    positions.push(transformed);
    uvs.push(corner.uv === undefined ? [0, 0] : sourceUvs[corner.uv]!);
    sourcePositionIndices.push(corner.position);
    vertexByCorner.set(key, index);
    return index;
  };
  for (const face of faces) {
    const materialId = options.materialByGroup[face.group];
    if (!materialId) throw new Error(`OBJ group '${face.group}' has no material mapping`);
    if (!options.materials[materialId])
      throw new Error(`OBJ group '${face.group}' maps to unknown material '${materialId}'`);
    const start = indices.length;
    for (let corner = 1; corner < face.corners.length - 1; corner++) {
      const triangle = [face.corners[0]!, face.corners[corner]!, face.corners[corner + 1]!];
      if (options.reverseWinding) triangle.reverse();
      indices.push(...triangle.map(vertex));
    }
    const count = indices.length - start;
    const previous = materialGroups.at(-1);
    if (previous?.materialId === materialId && previous.start + previous.count === start)
      previous.count += count;
    else materialGroups.push({ materialId, start, count });
  }
  const normals = positions.map(() => [0, 0, 0] as Vec3);
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index]!;
    const b = indices[index + 1]!;
    const c = indices[index + 2]!;
    const normal = cross(
      subtract(positions[b]!, positions[a]!),
      subtract(positions[c]!, positions[a]!),
    );
    normals[a] = add(normals[a]!, normal);
    normals[b] = add(normals[b]!, normal);
    normals[c] = add(normals[c]!, normal);
  }
  const geometry: GeometryAsset = {
    schemaVersion: 1,
    id: options.id,
    units: 'meters',
    coordinateSystem: { handedness: 'right', up: 'y', forward: '-z' },
    positions,
    normals: normals.map(normalize),
    uvs,
    indices,
    materials: [...new Set(Object.values(options.materialByGroup))].map(
      (id) => options.materials[id]!,
    ),
    materialGroups,
    skeleton: [],
    morphTargets: [],
    attachments: {},
    metadata: {
      sourceFormat: 'wavefront-obj',
      sourceGroups: options.groups,
      ...options.metadata,
    },
  };
  return { geometry, sourcePositionIndices };
}

export function parseObjGeometry(source: string, options: ObjGeometryOptions): GeometryAsset {
  return parseObjGeometryWithSourceMap(source, options).geometry;
}

/** Returns transformed centres of explicitly named OBJ landmark groups. */
export function parseObjGroupCentres(
  source: string,
  groups: readonly string[],
  transform: (position: Vec3) => Vec3 = (position) => position,
) {
  const positions: Vec3[] = [];
  const referenced = new Map(groups.map((group) => [group, new Set<number>()]));
  let group = '';
  for (const [offset, raw] of source.split(/\r?\n/u).entries()) {
    const lineNumber = offset + 1;
    const fields = raw.trim().split(/\s+/u);
    if (!fields[0] || fields[0].startsWith('#')) continue;
    if (fields[0] === 'v') {
      const position = fields.slice(1, 4).map(Number);
      if (position.length !== 3 || position.some((value) => !Number.isFinite(value)))
        throw new Error(`OBJ line ${lineNumber}: invalid landmark-source vertex`);
      positions.push(position as Vec3);
    } else if (fields[0] === 'g') group = fields[1] ?? '';
    else if (fields[0] === 'f' && referenced.has(group))
      for (const field of fields.slice(1)) {
        const position = field.split('/')[0];
        if (!position) throw new Error(`OBJ line ${lineNumber}: landmark face lacks a position`);
        referenced.get(group)!.add(resolveObjIndex(position, positions.length, lineNumber));
      }
  }
  return new Map(
    groups.map((name) => {
      const indices = [...referenced.get(name)!];
      if (!indices.length) throw new Error(`OBJ landmark group '${name}' contains no faces`);
      const values = indices.map((index) => transform(positions[index]!));
      const axes = [0, 1, 2].map((axis) => {
        const valuesOnAxis = values.map((value) => value[axis]!);
        return (Math.min(...valuesOnAxis) + Math.max(...valuesOnAxis)) * 0.5;
      });
      return [name, axes as Vec3] as const;
    }),
  );
}
