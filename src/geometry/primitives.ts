import type { GeometryAsset, GeometryAttribute, Vec3, Vec4 } from './model.js';

export interface MeshPart {
  positions: Vec3[];
  normals: Vec3[];
  uvs: [number, number][];
  indices: number[];
  skinIndices: Vec4[];
  skinWeights: Vec4[];
  attributes?: Record<string, GeometryAttribute>;
  materialId?: string;
}

export interface RevolutionProfilePoint {
  radius: number;
  y: number;
}

/**
 * Extrudes a convex XY polygon through a Z interval. This is useful for thin
 * renderer-independent facade patches, plaques, reliefs, and other planar
 * construction layers without delegating topology to a backend.
 */
export function extrudedPolygonAlongZPart(
  polygon: Array<[number, number]>,
  minimumZ: number,
  maximumZ: number,
  bone: number,
  materialId?: string,
): MeshPart {
  if (polygon.length < 3) throw new Error('Extruded XY polygon requires at least three points');
  if (!Number.isFinite(minimumZ) || !Number.isFinite(maximumZ) || maximumZ <= minimumZ)
    throw new Error('Extruded XY polygon requires a positive finite Z interval');
  const signedCrosses = polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length]!;
    const after = polygon[(index + 2) % polygon.length]!;
    return (
      (next[0] - point[0]) * (after[1] - next[1]) - (next[1] - point[1]) * (after[0] - next[0])
    );
  });
  if (signedCrosses.some((value) => Math.abs(value) < 1e-10))
    throw new Error('Extruded XY polygon cannot contain collinear consecutive points');
  const winding = Math.sign(signedCrosses[0]!);
  if (signedCrosses.some((value) => Math.sign(value) !== winding))
    throw new Error('Extruded XY polygon must be strictly convex with consistent winding');
  const ordered = winding > 0 ? polygon : [...polygon].reverse();
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  const skinIndices: Vec4[] = [];
  const skinWeights: Vec4[] = [];
  const minimumX = Math.min(...ordered.map((point) => point[0]));
  const maximumX = Math.max(...ordered.map((point) => point[0]));
  const minimumY = Math.min(...ordered.map((point) => point[1]));
  const maximumY = Math.max(...ordered.map((point) => point[1]));
  const width = maximumX - minimumX;
  const height = maximumY - minimumY;
  const addVertex = (position: Vec3, normal: Vec3) => {
    positions.push(position);
    normals.push(normal);
    uvs.push([(position[0] - minimumX) / width, (position[1] - minimumY) / height]);
    skinIndices.push([bone, 0, 0, 0]);
    skinWeights.push([1, 0, 0, 0]);
  };
  const frontStart = positions.length;
  for (const [x, y] of ordered) addVertex([x, y, minimumZ], [0, 0, -1]);
  for (let index = 1; index < ordered.length - 1; index++)
    indices.push(frontStart, frontStart + index + 1, frontStart + index);
  const backStart = positions.length;
  for (const [x, y] of ordered) addVertex([x, y, maximumZ], [0, 0, 1]);
  for (let index = 1; index < ordered.length - 1; index++)
    indices.push(backStart, backStart + index, backStart + index + 1);
  for (let index = 0; index < ordered.length; index++) {
    const next = (index + 1) % ordered.length;
    const [x0, y0] = ordered[index]!;
    const [x1, y1] = ordered[next]!;
    const normal = normalize([y0 - y1, x1 - x0, 0]);
    const offset = positions.length;
    addVertex([x0, y0, minimumZ], normal);
    addVertex([x1, y1, minimumZ], normal);
    addVertex([x1, y1, maximumZ], normal);
    addVertex([x0, y0, maximumZ], normal);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  return {
    positions,
    normals,
    uvs,
    indices,
    skinIndices,
    skinWeights,
    ...(materialId === undefined ? {} : { materialId }),
  };
}

export interface OpenTroughOptions {
  minimumX: number;
  maximumX: number;
  centreY: number;
  centreZ: number;
  outerRadius: number;
  thickness: number;
  arcSegments?: number;
  bone: number;
  materialId?: string;
}

/**
 * Builds a closed-wall, open-top half-round trough aligned to local X. Unlike
 * a split cylinder, this has an inner wall, rolled-thickness lips, and annular
 * end faces while leaving the complete top aperture physically unobstructed.
 */
export function openHalfRoundTroughPart(options: OpenTroughOptions): MeshPart {
  const {
    minimumX,
    maximumX,
    centreY,
    centreZ,
    outerRadius,
    thickness,
    arcSegments = 20,
    bone,
    materialId,
  } = options;
  if (maximumX <= minimumX) throw new Error('Open trough span must have positive extent');
  if (!Number.isFinite(outerRadius) || outerRadius <= 0)
    throw new Error('Open trough radius must be positive');
  if (!Number.isFinite(thickness) || thickness <= 0 || thickness >= outerRadius * 0.45)
    throw new Error('Open trough thickness must be positive and less than 45% of its radius');
  if (!Number.isInteger(arcSegments) || arcSegments < 6)
    throw new Error('Open trough requires at least six arc segments');

  const innerRadius = outerRadius - thickness;
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  const skinIndices: Vec4[] = [];
  const skinWeights: Vec4[] = [];
  const addVertex = (position: Vec3, normal: Vec3, uv: [number, number]) => {
    positions.push(position);
    normals.push(normalize(normal));
    uvs.push(uv);
    skinIndices.push([bone, 0, 0, 0]);
    skinWeights.push([1, 0, 0, 0]);
  };
  const point = (x: number, radius: number, angle: number): Vec3 => [
    x,
    centreY + Math.sin(angle) * radius,
    centreZ + Math.cos(angle) * radius,
  ];
  const addQuad = (corners: [Vec3, Vec3, Vec3, Vec3], normal: Vec3) => {
    const offset = positions.length;
    addVertex(corners[0], normal, [0, 0]);
    addVertex(corners[1], normal, [1, 0]);
    addVertex(corners[2], normal, [1, 1]);
    addVertex(corners[3], normal, [0, 1]);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  };

  for (let segment = 0; segment < arcSegments; segment++) {
    const a0 = Math.PI + (Math.PI * segment) / arcSegments;
    const a1 = Math.PI + (Math.PI * (segment + 1)) / arcSegments;
    const middle = (a0 + a1) * 0.5;
    addQuad(
      [
        point(minimumX, outerRadius, a0),
        point(maximumX, outerRadius, a0),
        point(maximumX, outerRadius, a1),
        point(minimumX, outerRadius, a1),
      ],
      [0, Math.sin(middle), Math.cos(middle)],
    );
    addQuad(
      [
        point(minimumX, innerRadius, a1),
        point(maximumX, innerRadius, a1),
        point(maximumX, innerRadius, a0),
        point(minimumX, innerRadius, a0),
      ],
      [0, -Math.sin(middle), -Math.cos(middle)],
    );
  }

  for (const angle of [Math.PI, Math.PI * 2]) {
    const direction = angle === Math.PI ? -1 : 1;
    addQuad(
      [
        point(minimumX, innerRadius, angle),
        point(maximumX, innerRadius, angle),
        point(maximumX, outerRadius, angle),
        point(minimumX, outerRadius, angle),
      ],
      [0, direction, 0],
    );
  }
  for (const [x, direction] of [
    [minimumX, -1],
    [maximumX, 1],
  ] as const)
    for (let segment = 0; segment < arcSegments; segment++) {
      const a0 = Math.PI + (Math.PI * segment) / arcSegments;
      const a1 = Math.PI + (Math.PI * (segment + 1)) / arcSegments;
      addQuad(
        [
          point(x, innerRadius, a0),
          point(x, innerRadius, a1),
          point(x, outerRadius, a1),
          point(x, outerRadius, a0),
        ],
        [direction, 0, 0],
      );
    }
  return {
    positions,
    normals,
    uvs,
    indices,
    skinIndices,
    skinWeights,
    ...(materialId === undefined ? {} : { materialId }),
  };
}

/**
 * Builds a renderer-independent surface of revolution around the local Y axis.
 * Profile points run bottom-to-top. Optional caps make the result watertight;
 * duplicated seam vertices retain predictable UVs for downstream renderers.
 */
export function surfaceOfRevolutionPart(
  profile: RevolutionProfilePoint[],
  radialSegments: number,
  bone: number,
  materialId?: string,
  caps = true,
): MeshPart {
  if (profile.length < 2)
    throw new Error('Surface of revolution requires at least two profile points');
  if (!Number.isInteger(radialSegments) || radialSegments < 3)
    throw new Error('Surface of revolution requires at least three radial segments');
  for (const [index, point] of profile.entries()) {
    if (!Number.isFinite(point.radius) || point.radius <= 0 || !Number.isFinite(point.y))
      throw new Error(
        `Surface of revolution profile point ${index} must have a positive radius and finite height`,
      );
    if (index > 0 && point.y <= profile[index - 1]!.y)
      throw new Error('Surface of revolution profile heights must increase strictly');
  }
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  const skinIndices: Vec4[] = [];
  const skinWeights: Vec4[] = [];
  const minimumY = profile[0]!.y;
  const height = profile.at(-1)!.y - minimumY;
  const addVertex = (position: Vec3, normal: Vec3, uv: [number, number]) => {
    positions.push(position);
    normals.push(normalize(normal));
    uvs.push(uv);
    skinIndices.push([bone, 0, 0, 0]);
    skinWeights.push([1, 0, 0, 0]);
  };
  for (let row = 0; row < profile.length; row++) {
    const point = profile[row]!;
    const previous = profile[Math.max(0, row - 1)]!;
    const next = profile[Math.min(profile.length - 1, row + 1)]!;
    const tangentRadius = next.radius - previous.radius;
    const tangentY = next.y - previous.y;
    for (let radial = 0; radial <= radialSegments; radial++) {
      const u = radial / radialSegments;
      const angle = u * Math.PI * 2;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      addVertex(
        [point.radius * cosine, point.y, point.radius * sine],
        [tangentY * cosine, -tangentRadius, tangentY * sine],
        [u, (point.y - minimumY) / height],
      );
    }
  }
  const rowWidth = radialSegments + 1;
  for (let row = 0; row < profile.length - 1; row++)
    for (let radial = 0; radial < radialSegments; radial++) {
      const lower = row * rowWidth + radial;
      const upper = lower + rowWidth;
      indices.push(lower, upper, lower + 1, upper, upper + 1, lower + 1);
    }
  if (caps) {
    const addCap = (profileIndex: number, normalY: -1 | 1) => {
      const point = profile[profileIndex]!;
      const center = positions.length;
      addVertex([0, point.y, 0], [0, normalY, 0], [0.5, 0.5]);
      const ring = positions.length;
      for (let radial = 0; radial <= radialSegments; radial++) {
        const angle = (radial / radialSegments) * Math.PI * 2;
        addVertex(
          [point.radius * Math.cos(angle), point.y, point.radius * Math.sin(angle)],
          [0, normalY, 0],
          [0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5],
        );
      }
      for (let radial = 0; radial < radialSegments; radial++)
        if (normalY > 0) indices.push(center, ring + radial + 1, ring + radial);
        else indices.push(center, ring + radial, ring + radial + 1);
    };
    addCap(0, -1);
    addCap(profile.length - 1, 1);
  }
  return {
    positions,
    normals,
    uvs,
    indices,
    skinIndices,
    skinWeights,
    ...(materialId === undefined ? {} : { materialId }),
  };
}

export function boxPart(minimum: Vec3, maximum: Vec3, bone: number, materialId?: string): MeshPart {
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  const skinIndices: Vec4[] = [];
  const skinWeights: Vec4[] = [];
  const faces: Array<{ corners: Vec3[]; normal: Vec3 }> = [
    {
      corners: [
        [minimum[0], minimum[1], minimum[2]],
        [maximum[0], minimum[1], minimum[2]],
        [maximum[0], maximum[1], minimum[2]],
        [minimum[0], maximum[1], minimum[2]],
      ],
      normal: [0, 0, -1],
    },
    {
      corners: [
        [maximum[0], minimum[1], maximum[2]],
        [minimum[0], minimum[1], maximum[2]],
        [minimum[0], maximum[1], maximum[2]],
        [maximum[0], maximum[1], maximum[2]],
      ],
      normal: [0, 0, 1],
    },
    {
      corners: [
        [minimum[0], minimum[1], maximum[2]],
        [minimum[0], minimum[1], minimum[2]],
        [minimum[0], maximum[1], minimum[2]],
        [minimum[0], maximum[1], maximum[2]],
      ],
      normal: [-1, 0, 0],
    },
    {
      corners: [
        [maximum[0], minimum[1], minimum[2]],
        [maximum[0], minimum[1], maximum[2]],
        [maximum[0], maximum[1], maximum[2]],
        [maximum[0], maximum[1], minimum[2]],
      ],
      normal: [1, 0, 0],
    },
    {
      corners: [
        [minimum[0], maximum[1], minimum[2]],
        [maximum[0], maximum[1], minimum[2]],
        [maximum[0], maximum[1], maximum[2]],
        [minimum[0], maximum[1], maximum[2]],
      ],
      normal: [0, 1, 0],
    },
    {
      corners: [
        [minimum[0], minimum[1], maximum[2]],
        [maximum[0], minimum[1], maximum[2]],
        [maximum[0], minimum[1], minimum[2]],
        [minimum[0], minimum[1], minimum[2]],
      ],
      normal: [0, -1, 0],
    },
  ];
  for (const face of faces) {
    const offset = positions.length;
    positions.push(...face.corners);
    normals.push(face.normal, face.normal, face.normal, face.normal);
    uvs.push([0, 0], [1, 0], [1, 1], [0, 1]);
    skinIndices.push([bone, 0, 0, 0], [bone, 0, 0, 0], [bone, 0, 0, 0], [bone, 0, 0, 0]);
    skinWeights.push([1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0]);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  return {
    positions,
    normals,
    uvs,
    indices,
    skinIndices,
    skinWeights,
    ...(materialId === undefined ? {} : { materialId }),
  };
}

/**
 * Builds a watertight rounded cuboid without delegating bevel semantics to a
 * renderer. Each face samples the same signed-distance rounded-box surface;
 * duplicated seam vertices keep face-local UVs and stable outward normals.
 */
export function roundedBoxPart(
  minimum: Vec3,
  maximum: Vec3,
  radius: number,
  bone: number,
  materialId?: string,
  subdivisions = 8,
): MeshPart {
  const center: Vec3 = [
    (minimum[0] + maximum[0]) * 0.5,
    (minimum[1] + maximum[1]) * 0.5,
    (minimum[2] + maximum[2]) * 0.5,
  ];
  const half: Vec3 = [
    (maximum[0] - minimum[0]) * 0.5,
    (maximum[1] - minimum[1]) * 0.5,
    (maximum[2] - minimum[2]) * 0.5,
  ];
  if (half.some((extent) => !Number.isFinite(extent) || extent <= 0))
    throw new Error('Rounded box requires strictly positive finite extents');
  if (!Number.isFinite(radius) || radius <= 0 || radius >= Math.min(...half))
    throw new Error('Rounded box radius must be positive and smaller than every half extent');
  if (!Number.isInteger(subdivisions) || subdivisions < 2 || subdivisions > 64)
    throw new Error('Rounded box subdivisions must be an integer between 2 and 64');

  const core: Vec3 = [half[0] - radius, half[1] - radius, half[2] - radius];
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  const skinIndices: Vec4[] = [];
  const skinWeights: Vec4[] = [];
  const faces = [
    { axis: 0, sign: -1, uAxis: 2, vAxis: 1 },
    { axis: 0, sign: 1, uAxis: 2, vAxis: 1 },
    { axis: 1, sign: -1, uAxis: 0, vAxis: 2 },
    { axis: 1, sign: 1, uAxis: 0, vAxis: 2 },
    { axis: 2, sign: -1, uAxis: 0, vAxis: 1 },
    { axis: 2, sign: 1, uAxis: 0, vAxis: 1 },
  ] as const;
  const clamp = (value: number, extent: number) => Math.max(-extent, Math.min(extent, value));
  const addTriangle = (a: number, b: number, c: number) => {
    const geometricNormal = cross(
      subtract(positions[b]!, positions[a]!),
      subtract(positions[c]!, positions[a]!),
    );
    const expected = normalize([
      normals[a]![0] + normals[b]![0] + normals[c]![0],
      normals[a]![1] + normals[b]![1] + normals[c]![1],
      normals[a]![2] + normals[b]![2] + normals[c]![2],
    ]);
    if (dot(geometricNormal, expected) >= 0) indices.push(a, b, c);
    else indices.push(a, c, b);
  };

  for (const face of faces) {
    const offset = positions.length;
    for (let row = 0; row <= subdivisions; row++) {
      const v = row / subdivisions;
      for (let column = 0; column <= subdivisions; column++) {
        const u = column / subdivisions;
        const local: Vec3 = [0, 0, 0];
        local[face.axis] = face.sign * half[face.axis];
        local[face.uAxis] = (u * 2 - 1) * half[face.uAxis];
        local[face.vAxis] = (v * 2 - 1) * half[face.vAxis];
        const nearest: Vec3 = [
          clamp(local[0], core[0]),
          clamp(local[1], core[1]),
          clamp(local[2], core[2]),
        ];
        const direction = normalize(subtract(local, nearest));
        positions.push([
          center[0] + nearest[0] + direction[0] * radius,
          center[1] + nearest[1] + direction[1] * radius,
          center[2] + nearest[2] + direction[2] * radius,
        ]);
        normals.push(direction);
        uvs.push([u, v]);
        skinIndices.push([bone, 0, 0, 0]);
        skinWeights.push([1, 0, 0, 0]);
      }
    }
    const rowWidth = subdivisions + 1;
    for (let row = 0; row < subdivisions; row++)
      for (let column = 0; column < subdivisions; column++) {
        const a = offset + row * rowWidth + column;
        const b = a + 1;
        const c = a + rowWidth;
        const d = c + 1;
        addTriangle(a, c, b);
        addTriangle(b, c, d);
      }
  }
  return {
    positions,
    normals,
    uvs,
    indices,
    skinIndices,
    skinWeights,
    ...(materialId === undefined ? {} : { materialId }),
  };
}

/** A closed rectangular frustum aligned to Y, useful for hoppers, shades, and tapered housings. */
export function rectangularFrustumPart(
  centreX: number,
  centreZ: number,
  lowerY: number,
  upperY: number,
  lowerHalfExtents: [number, number],
  upperHalfExtents: [number, number],
  bone: number,
  materialId?: string,
): MeshPart {
  if (upperY <= lowerY) throw new Error('Rectangular frustum height must have positive extent');
  if (
    [...lowerHalfExtents, ...upperHalfExtents].some(
      (value) => !Number.isFinite(value) || value <= 0,
    )
  )
    throw new Error('Rectangular frustum half-extents must be positive');
  const ring = (y: number, half: [number, number]): Vec3[] => [
    [centreX - half[0], y, centreZ - half[1]],
    [centreX + half[0], y, centreZ - half[1]],
    [centreX + half[0], y, centreZ + half[1]],
    [centreX - half[0], y, centreZ + half[1]],
  ];
  const lower = ring(lowerY, lowerHalfExtents);
  const upper = ring(upperY, upperHalfExtents);
  const faces: Vec3[][] = [
    [lower[0]!, lower[3]!, lower[2]!, lower[1]!],
    [upper[0]!, upper[1]!, upper[2]!, upper[3]!],
    [lower[0]!, lower[1]!, upper[1]!, upper[0]!],
    [lower[1]!, lower[2]!, upper[2]!, upper[1]!],
    [lower[2]!, lower[3]!, upper[3]!, upper[2]!],
    [lower[3]!, lower[0]!, upper[0]!, upper[3]!],
  ];
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  const skinIndices: Vec4[] = [];
  const skinWeights: Vec4[] = [];
  for (const face of faces) {
    const offset = positions.length;
    const normal = normalize(cross(subtract(face[1]!, face[0]!), subtract(face[2]!, face[0]!)));
    positions.push(...face);
    normals.push(normal, normal, normal, normal);
    uvs.push([0, 0], [1, 0], [1, 1], [0, 1]);
    skinIndices.push([bone, 0, 0, 0], [bone, 0, 0, 0], [bone, 0, 0, 0], [bone, 0, 0, 0]);
    skinWeights.push([1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0]);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  return {
    positions,
    normals,
    uvs,
    indices,
    skinIndices,
    skinWeights,
    ...(materialId === undefined ? {} : { materialId }),
  };
}

export interface ExtrudedConvexPolygonOptions {
  minimumX: number;
  maximumX: number;
  crossSectionYZ: Array<[number, number]>;
  bone: number;
  materialId?: string;
}

/** Extrudes a closed convex Y/Z profile along X for wedges, fascia, beams, and layered roof sections. */
export function extrudedConvexPolygonPart(options: ExtrudedConvexPolygonOptions): MeshPart {
  const { minimumX, maximumX, crossSectionYZ, bone, materialId } = options;
  if (maximumX <= minimumX) throw new Error('Extruded polygon span must have positive extent');
  if (crossSectionYZ.length < 3)
    throw new Error('Extruded polygon requires at least three cross-section points');
  const area =
    crossSectionYZ.reduce((sum, point, index) => {
      const next = crossSectionYZ[(index + 1) % crossSectionYZ.length]!;
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0) * 0.5;
  if (Math.abs(area) < 1e-10) throw new Error('Extruded polygon cross-section has zero area');
  let winding = 0;
  for (let index = 0; index < crossSectionYZ.length; index++) {
    const a = crossSectionYZ[index]!;
    const b = crossSectionYZ[(index + 1) % crossSectionYZ.length]!;
    const c = crossSectionYZ[(index + 2) % crossSectionYZ.length]!;
    const turn = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(turn) < 1e-10) continue;
    const sign = Math.sign(turn);
    if (winding && sign !== winding)
      throw new Error('Extruded polygon cross-section must be convex');
    winding = sign;
  }
  if (!winding)
    throw new Error('Extruded polygon cross-section must contain non-collinear corners');
  const profile = area > 0 ? crossSectionYZ : [...crossSectionYZ].reverse();
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  const skinIndices: Vec4[] = [];
  const skinWeights: Vec4[] = [];
  const addVertex = (position: Vec3, normal: Vec3, uv: [number, number]) => {
    positions.push(position);
    normals.push(normalize(normal));
    uvs.push(uv);
    skinIndices.push([bone, 0, 0, 0]);
    skinWeights.push([1, 0, 0, 0]);
  };
  for (let index = 0; index < profile.length; index++) {
    const current = profile[index]!;
    const next = profile[(index + 1) % profile.length]!;
    const offset = positions.length;
    const edgeY = next[0] - current[0];
    const edgeZ = next[1] - current[1];
    const normal: Vec3 = [0, edgeZ, -edgeY];
    addVertex([minimumX, current[0], current[1]], normal, [0, 0]);
    addVertex([minimumX, next[0], next[1]], normal, [0, 1]);
    addVertex([maximumX, next[0], next[1]], normal, [1, 1]);
    addVertex([maximumX, current[0], current[1]], normal, [1, 0]);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  const addCap = (x: number, normalX: -1 | 1) => {
    const start = positions.length;
    for (const [y, z] of profile) addVertex([x, y, z], [normalX, 0, 0], [y, z]);
    for (let index = 1; index < profile.length - 1; index++)
      if (normalX > 0) indices.push(start, start + index, start + index + 1);
      else indices.push(start, start + index + 1, start + index);
  };
  addCap(minimumX, -1);
  addCap(maximumX, 1);
  return {
    positions,
    normals,
    uvs,
    indices,
    skinIndices,
    skinWeights,
    ...(materialId === undefined ? {} : { materialId }),
  };
}

/** A closed gable-roof prism aligned to either horizontal scene axis. */
export function gableRoofPart(
  minimum: Vec3,
  maximum: Vec3,
  ridgeAxis: 'x' | 'z',
  bone: number,
  materialId?: string,
): MeshPart {
  if (maximum[0] <= minimum[0] || maximum[1] <= minimum[1] || maximum[2] <= minimum[2])
    throw new Error('Gable roof bounds must have positive extent');
  const points: Vec3[] =
    ridgeAxis === 'x'
      ? [
          [minimum[0], minimum[1], minimum[2]],
          [maximum[0], minimum[1], minimum[2]],
          [maximum[0], minimum[1], maximum[2]],
          [minimum[0], minimum[1], maximum[2]],
          [minimum[0], maximum[1], (minimum[2] + maximum[2]) * 0.5],
          [maximum[0], maximum[1], (minimum[2] + maximum[2]) * 0.5],
        ]
      : [
          [minimum[0], minimum[1], minimum[2]],
          [minimum[0], minimum[1], maximum[2]],
          [maximum[0], minimum[1], maximum[2]],
          [maximum[0], minimum[1], minimum[2]],
          [(minimum[0] + maximum[0]) * 0.5, maximum[1], minimum[2]],
          [(minimum[0] + maximum[0]) * 0.5, maximum[1], maximum[2]],
        ];
  const faces = [
    [0, 3, 2, 1],
    [0, 1, 5, 4],
    [3, 4, 5, 2],
    [0, 4, 3],
    [1, 2, 5],
  ];
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  const skinIndices: Vec4[] = [];
  const skinWeights: Vec4[] = [];
  for (const face of faces) {
    const offset = positions.length;
    const a = points[face[0]!]!;
    const b = points[face[1]!]!;
    const c = points[face[2]!]!;
    const normal = normalize(cross(subtract(b, a), subtract(c, a)));
    face.forEach((point, index) => {
      positions.push(points[point]!);
      normals.push(normal);
      uvs.push(index === 0 ? [0, 0] : index === 1 ? [1, 0] : index === 2 ? [1, 1] : [0, 1]);
      skinIndices.push([bone, 0, 0, 0]);
      skinWeights.push([1, 0, 0, 0]);
    });
    for (let index = 1; index < face.length - 1; index++)
      indices.push(offset, offset + index, offset + index + 1);
  }
  return {
    positions,
    normals,
    uvs,
    indices,
    skinIndices,
    skinWeights,
    ...(materialId === undefined ? {} : { materialId }),
  };
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, value: number): Vec3 => [a[0] * value, a[1] * value, a[2] * value];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a);
  return length ? scale(a, 1 / length) : [0, 1, 0];
};

function basis(direction: Vec3) {
  const y = normalize(direction);
  const helper: Vec3 = Math.abs(dot(y, [0, 0, 1])) > 0.95 ? [1, 0, 0] : [0, 0, 1];
  const x = normalize(cross(y, helper));
  const z = normalize(cross(x, y));
  return { x, y, z };
}

function mapBasis(local: Vec3, frame: ReturnType<typeof basis>, center: Vec3): Vec3 {
  return add(
    center,
    add(add(scale(frame.x, local[0]), scale(frame.y, local[1])), scale(frame.z, local[2])),
  );
}

export interface SweptTubeOptions {
  points: Vec3[];
  radius: number;
  bone: number;
  materialId?: string;
  radialSegments?: number;
  closed?: boolean;
  referenceAxis?: Vec3;
}

export interface LanceolateLeafOptions {
  start: Vec3;
  end: Vec3;
  maximumWidth: number;
  bone: number;
  materialId?: string;
  bow?: number;
  referenceAxis?: Vec3;
  doubleSided?: boolean;
}

/**
 * Builds a tapered, subtly bowed manufactured/botanical blade between two
 * points. Unlike an ellipsoid proxy, it preserves a readable leaf edge,
 * mid-plane and tip at medium distance while remaining renderer-independent.
 */
export function lanceolateLeafPart(options: LanceolateLeafOptions): MeshPart {
  const {
    start,
    end,
    maximumWidth,
    bone,
    materialId,
    bow = 0.012,
    referenceAxis = [0, 1, 0],
    doubleSided = true,
  } = options;
  const direction = subtract(end, start);
  const length = Math.hypot(...direction);
  if (length < 1e-5) throw new Error('Lanceolate leaf requires distinct endpoints');
  if (!Number.isFinite(maximumWidth) || maximumWidth <= 0 || maximumWidth >= length)
    throw new Error('Lanceolate leaf width must be positive and smaller than its length');
  const frame = basis(direction);
  let side = cross(normalize(direction), referenceAxis);
  if (Math.hypot(...side) < 1e-5) side = frame.x;
  side = normalize(side);
  const normal = normalize(cross(side, normalize(direction)));
  const rows = [
    { t: 0, width: maximumWidth * 0.025, lift: 0 },
    { t: 0.32, width: maximumWidth, lift: bow },
    { t: 0.7, width: maximumWidth * 0.62, lift: bow * 0.7 },
    { t: 1, width: maximumWidth * 0.02, lift: 0 },
  ];
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const skinIndices: Vec4[] = [];
  const skinWeights: Vec4[] = [];
  for (const row of rows)
    for (const sign of [-1, 1]) {
      const centre = add(add(start, scale(direction, row.t)), scale(normal, row.lift));
      positions.push(add(centre, scale(side, row.width * sign)));
      normals.push(normal);
      uvs.push([(sign + 1) * 0.5, row.t]);
      skinIndices.push([bone, 0, 0, 0]);
      skinWeights.push([1, 0, 0, 0]);
    }
  const indices: number[] = [];
  for (let row = 0; row < rows.length - 1; row++) {
    const left = row * 2;
    const next = left + 2;
    indices.push(left, next, left + 1, left + 1, next, next + 1);
    if (doubleSided) indices.push(left + 1, next, left, next + 1, next, left + 1);
  }
  return {
    positions,
    normals,
    uvs,
    indices,
    skinIndices,
    skinWeights,
    ...(materialId === undefined ? {} : { materialId }),
  };
}

/**
 * Sweeps a circular tube through a renderer-independent polyline. It supports
 * open manufactured rails/brackets and closed cable/chain loops without
 * requiring a renderer-specific curve object.
 */
export function sweptTubePart(options: SweptTubeOptions): MeshPart {
  const {
    points,
    radius,
    bone,
    materialId,
    radialSegments = 12,
    closed = false,
    referenceAxis = [1, 0, 0],
  } = options;
  if (points.length < (closed ? 3 : 2))
    throw new Error(`Swept tube requires at least ${closed ? 3 : 2} path points`);
  if (!Number.isFinite(radius) || radius <= 0)
    throw new Error('Swept tube radius must be positive');
  if (!Number.isInteger(radialSegments) || radialSegments < 6)
    throw new Error('Swept tube requires at least six radial segments');
  const segmentLength = (a: Vec3, b: Vec3) => Math.hypot(...subtract(b, a));
  for (let index = 0; index < points.length - 1; index++)
    if (segmentLength(points[index]!, points[index + 1]!) < 1e-7)
      throw new Error('Swept tube path cannot contain duplicate adjacent points');
  if (closed && segmentLength(points.at(-1)!, points[0]!) < 1e-7)
    throw new Error('Closed swept-tube path must omit a duplicated final point');

  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  const skinIndices: Vec4[] = [];
  const skinWeights: Vec4[] = [];
  const ringWidth = radialSegments + 1;
  const tangentAt = (index: number) => {
    const previous = points[index === 0 ? (closed ? points.length - 1 : 0) : index - 1]!;
    const next =
      points[index === points.length - 1 ? (closed ? 0 : points.length - 1) : index + 1]!;
    return normalize(subtract(next, previous));
  };
  for (let index = 0; index < points.length; index++) {
    const tangent = tangentAt(index);
    let side = cross(tangent, referenceAxis);
    if (Math.hypot(...side) < 1e-5)
      side = cross(tangent, Math.abs(tangent[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1]);
    side = normalize(side);
    const binormal = normalize(cross(side, tangent));
    for (let radial = 0; radial <= radialSegments; radial++) {
      const angle = (radial / radialSegments) * Math.PI * 2;
      const normal = normalize(add(scale(side, Math.cos(angle)), scale(binormal, Math.sin(angle))));
      positions.push(add(points[index]!, scale(normal, radius)));
      normals.push(normal);
      uvs.push([radial / radialSegments, index / Math.max(1, points.length - 1)]);
      skinIndices.push([bone, 0, 0, 0]);
      skinWeights.push([1, 0, 0, 0]);
    }
  }
  const pathSegments = closed ? points.length : points.length - 1;
  for (let segment = 0; segment < pathSegments; segment++) {
    const next = (segment + 1) % points.length;
    for (let radial = 0; radial < radialSegments; radial++) {
      const a = segment * ringWidth + radial;
      const b = next * ringWidth + radial;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  if (!closed) {
    const addCap = (index: number, direction: -1 | 1) => {
      const tangent = scale(tangentAt(index), direction);
      const centre = positions.length;
      positions.push(points[index]!);
      normals.push(tangent);
      uvs.push([0.5, 0.5]);
      skinIndices.push([bone, 0, 0, 0]);
      skinWeights.push([1, 0, 0, 0]);
      const ring = index * ringWidth;
      for (let radial = 0; radial < radialSegments; radial++) {
        const next = ring + radial + 1;
        if (direction < 0) indices.push(centre, ring + radial, next);
        else indices.push(centre, next, ring + radial);
      }
    };
    addCap(0, -1);
    addCap(points.length - 1, 1);
  }
  return {
    positions,
    normals,
    uvs,
    indices,
    skinIndices,
    skinWeights,
    ...(materialId === undefined ? {} : { materialId }),
  };
}

export function ellipsoidBetween(
  start: Vec3,
  end: Vec3,
  radiusX: number,
  radiusZ: number,
  startBone: number,
  endBone = startBone,
  latSegments = 10,
  radialSegments = 16,
): MeshPart {
  const vector = subtract(end, start);
  const length = Math.hypot(...vector);
  const center = scale(add(start, end), 0.5);
  const frame = basis(vector);
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  const skinIndices: Vec4[] = [];
  const skinWeights: Vec4[] = [];
  const addVertex = (local: Vec3, localNormal: Vec3, uv: [number, number], v: number) => {
    positions.push(mapBasis(local, frame, center));
    normals.push(normalize(mapBasis(localNormal, frame, [0, 0, 0])));
    uvs.push(uv);
    skinIndices.push([startBone, endBone, 0, 0]);
    skinWeights.push(startBone === endBone ? [1, 0, 0, 0] : [1 - v, v, 0, 0]);
  };
  addVertex([0, -length * 0.5, 0], [0, -1, 0], [0.5, 1], 0);
  for (let latitude = 1; latitude < latSegments; latitude++) {
    const v = latitude / latSegments;
    const theta = v * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    for (let radial = 0; radial <= radialSegments; radial++) {
      const u = radial / radialSegments;
      const phi = u * Math.PI * 2;
      const local: Vec3 = [
        Math.cos(phi) * sinTheta * radiusX,
        -Math.cos(theta) * length * 0.5,
        Math.sin(phi) * sinTheta * radiusZ,
      ];
      const localNormal = normalize([
        (Math.cos(phi) * sinTheta) / radiusX,
        -cosTheta / Math.max(length * 0.5, 1e-6),
        (Math.sin(phi) * sinTheta) / radiusZ,
      ]);
      addVertex(local, localNormal, [u, 1 - v], v);
    }
  }
  const topIndex = positions.length;
  addVertex([0, length * 0.5, 0], [0, 1, 0], [0.5, 0], 1);
  const row = radialSegments + 1;
  for (let radial = 0; radial < radialSegments; radial++)
    indices.push(0, 1 + radial, 1 + radial + 1);
  for (let latitude = 0; latitude < latSegments - 2; latitude++)
    for (let radial = 0; radial < radialSegments; radial++) {
      const a = 1 + latitude * row + radial;
      const b = a + row;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const lastRing = 1 + (latSegments - 2) * row;
  for (let radial = 0; radial < radialSegments; radial++)
    indices.push(lastRing + radial, topIndex, lastRing + radial + 1);
  return { positions, normals, uvs, indices, skinIndices, skinWeights };
}

export function capsuleBetween(
  start: Vec3,
  end: Vec3,
  radiusX: number,
  radiusZ: number,
  startBone: number,
  endBone = startBone,
  capSegments = 4,
  radialSegments = 16,
): MeshPart {
  const vector = subtract(end, start);
  const length = Math.hypot(...vector);
  const center = scale(add(start, end), 0.5);
  const frame = basis(vector);
  const capLength = Math.min(radiusX, radiusZ);
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  const skinIndices: Vec4[] = [];
  const skinWeights: Vec4[] = [];
  const totalLength = length + capLength * 2;
  const addVertex = (
    local: Vec3,
    localNormal: Vec3,
    uv: [number, number],
    longitudinal: number,
  ) => {
    positions.push(mapBasis(local, frame, center));
    normals.push(normalize(mapBasis(localNormal, frame, [0, 0, 0])));
    uvs.push(uv);
    const endWeight = Math.max(0, Math.min(1, longitudinal));
    skinIndices.push([startBone, endBone, 0, 0]);
    skinWeights.push(startBone === endBone ? [1, 0, 0, 0] : [1 - endWeight, endWeight, 0, 0]);
  };

  addVertex([0, -length * 0.5 - capLength, 0], [0, -1, 0], [0.5, 1], 0);
  const rings: Array<{ y: number; scale: number; normalY: number }> = [];
  for (let index = 1; index <= capSegments; index++) {
    const angle = -Math.PI / 2 + (Math.PI / 2) * (index / capSegments);
    rings.push({
      y: -length * 0.5 + Math.sin(angle) * capLength,
      scale: Math.cos(angle),
      normalY: Math.sin(angle),
    });
  }
  rings.push({ y: length * 0.5, scale: 1, normalY: 0 });
  for (let index = 1; index < capSegments; index++) {
    const angle = (Math.PI / 2) * (index / capSegments);
    rings.push({
      y: length * 0.5 + Math.sin(angle) * capLength,
      scale: Math.cos(angle),
      normalY: Math.sin(angle),
    });
  }
  for (const ring of rings) {
    const longitudinal = (ring.y + totalLength * 0.5) / totalLength;
    for (let radial = 0; radial <= radialSegments; radial++) {
      const u = radial / radialSegments;
      const phi = u * Math.PI * 2;
      addVertex(
        [Math.cos(phi) * radiusX * ring.scale, ring.y, Math.sin(phi) * radiusZ * ring.scale],
        normalize([Math.cos(phi) * ring.scale, ring.normalY, Math.sin(phi) * ring.scale]),
        [u, 1 - longitudinal],
        longitudinal,
      );
    }
  }
  const topIndex = positions.length;
  addVertex([0, length * 0.5 + capLength, 0], [0, 1, 0], [0.5, 0], 1);
  const row = radialSegments + 1;
  for (let radial = 0; radial < radialSegments; radial++)
    indices.push(0, 1 + radial, 1 + radial + 1);
  for (let ring = 0; ring < rings.length - 1; ring++)
    for (let radial = 0; radial < radialSegments; radial++) {
      const a = 1 + ring * row + radial;
      const b = a + row;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const lastRing = 1 + (rings.length - 1) * row;
  for (let radial = 0; radial < radialSegments; radial++)
    indices.push(lastRing + radial, topIndex, lastRing + radial + 1);
  return { positions, normals, uvs, indices, skinIndices, skinWeights };
}

export function mergeMeshParts(
  id: string,
  parts: MeshPart[],
  skeleton: GeometryAsset['skeleton'],
  metadata: Record<string, unknown>,
): GeometryAsset {
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  const skinIndices: Vec4[] = [];
  const skinWeights: Vec4[] = [];
  const materialGroups: GeometryAsset['materialGroups'] = [];
  const attributeDefinitions = new Map<string, GeometryAttribute['dataType']>();
  for (const part of parts)
    for (const [name, attribute] of Object.entries(part.attributes ?? {})) {
      const existing = attributeDefinitions.get(name);
      if (existing && existing !== attribute.dataType)
        throw new Error(
          `Mesh attribute '${name}' changes data type from ${existing} to ${attribute.dataType}`,
        );
      if (attribute.values.length !== part.positions.length)
        throw new Error(`Mesh attribute '${name}' must contain one value per part vertex`);
      attributeDefinitions.set(name, attribute.dataType);
    }
  const attributes: Record<string, GeometryAttribute> = Object.fromEntries(
    [...attributeDefinitions].map(([name, dataType]) => [
      name,
      { dataType, interpolation: 'vertex' as const, values: [] },
    ]),
  ) as Record<string, GeometryAttribute>;
  const zero = (dataType: GeometryAttribute['dataType']) => {
    if (dataType === 'float') return 0;
    if (dataType === 'vec2') return [0, 0] as [number, number];
    if (dataType === 'vec3') return [0, 0, 0] as Vec3;
    return [0, 0, 0, 0] as Vec4;
  };
  for (const part of parts) {
    const offset = positions.length;
    const indexStart = indices.length;
    for (const position of part.positions) positions.push(position);
    for (const normal of part.normals) normals.push(normal);
    for (const uv of part.uvs) uvs.push(uv);
    for (const value of part.skinIndices) skinIndices.push(value);
    for (const value of part.skinWeights) skinWeights.push(value);
    for (const [name, attribute] of Object.entries(attributes)) {
      const source = part.attributes?.[name];
      const values = source?.values ?? part.positions.map(() => zero(attribute.dataType));
      (attribute.values as unknown[]).push(...values);
    }
    for (const index of part.indices) indices.push(index + offset);
    if (part.materialId) {
      const previous = materialGroups.at(-1);
      if (
        previous?.materialId === part.materialId &&
        previous.start + previous.count === indexStart
      )
        previous.count += part.indices.length;
      else
        materialGroups.push({
          materialId: part.materialId,
          start: indexStart,
          count: part.indices.length,
        });
    }
  }
  return {
    schemaVersion: 1,
    id,
    units: 'meters',
    coordinateSystem: { handedness: 'right', up: 'y', forward: '-z' },
    positions,
    normals,
    uvs,
    indices,
    skinIndices,
    skinWeights,
    ...(Object.keys(attributes).length ? { attributes } : {}),
    materials: [],
    materialGroups,
    skeleton,
    morphTargets: [],
    attachments: {},
    metadata,
  };
}
