import type { SkeletonJoint, Vec3, Vec4 } from '../geometry/model.js';
import type { MeshPart } from '../geometry/primitives.js';
import type { ResolvedFaceIdentityParameters } from './face.js';

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (value: Vec3): Vec3 => {
  const length = Math.hypot(...value);
  return length > 1e-12 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 1, 0];
};
const gaussian = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
  Math.exp(-0.5 * (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2));

/**
 * Stable project-owned head topology. Facial depth changes vertex positions but
 * never the index layout, so identities and expression correctives can share it.
 */
export function createAnatomicalFaceTemplate(
  head: Vec3,
  headHalf: number,
  face: ResolvedFaceIdentityParameters,
  skeleton: SkeletonJoint[],
): MeshPart {
  const radialSegments = 144;
  const latitudeSegments = 88;
  const positions: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  const headBone = skeleton.findIndex((joint) => joint.id === 'head');
  const centre = add(head, [0, headHalf * 0.035, headHalf * 0.04]);
  const vertexAt = (latitude: number, radial: number) => latitude * radialSegments + radial;

  for (let latitude = 0; latitude <= latitudeSegments; latitude++) {
    const v = latitude / latitudeSegments;
    const theta = v * Math.PI;
    const unitY = Math.cos(theta);
    const ring = Math.sin(theta);
    for (let radial = 0; radial < radialSegments; radial++) {
      const u = radial / radialSegments;
      const phi = u * Math.PI * 2;
      const unitX = Math.cos(phi) * ring;
      const unitZ = Math.sin(phi) * ring;
      const lower = Math.max(0, -unitY);
      // A human head is not an egg: the zygomatic arch is the widest lower-face
      // region, while the mandible narrows decisively into the chin.
      const jawScale = 1 - lower ** 1.35 * (0.46 / face.jawTaper);
      const templeScale = 1 - gaussian(0, unitY, 0, 0.34, 1, 0.18) * 0.055;
      const cheekScale = 1 + gaussian(0, unitY, 0, -0.12, 1, 0.18) * 0.045 * face.cheekVolume;
      const x =
        unitX *
        headHalf *
        0.76 *
        jawScale *
        templeScale *
        cheekScale *
        (0.93 + face.jawWidth * 0.07);
      const y = unitY * headHalf * (unitY > 0 ? 1.07 : 0.94);
      // The back of the cranium is deeper than the facial plane. Facial
      // landmarks below add controlled projection to this continuous surface.
      let z = unitZ * headHalf * (unitZ > 0 ? 0.9 : 0.79);
      const normalizedX = x / headHalf;
      const normalizedY = y / headHalf;
      const front = Math.max(0, Math.min(1, (-unitZ - 0.15) / 0.85));
      if (front > 0) {
        const nasalBridge =
          gaussian(normalizedX, normalizedY, 0, 0.19, 0.12 * face.noseWidth, 0.31) *
          0.07 *
          face.noseLength;
        const nasalTip =
          gaussian(normalizedX, normalizedY, 0, -0.075, 0.17 * face.noseWidth, 0.14) *
          0.075 *
          face.noseLength;
        const nasalWings =
          (gaussian(normalizedX, normalizedY, 0.09 * face.noseWidth, -0.12, 0.07, 0.075) +
            gaussian(normalizedX, normalizedY, -0.09 * face.noseWidth, -0.12, 0.07, 0.075)) *
          0.025;
        const leftCheek = gaussian(normalizedX, normalizedY, 0.31, -0.13, 0.22, 0.22);
        const rightCheek = gaussian(normalizedX, normalizedY, -0.31, -0.13, 0.22, 0.22);
        const brow =
          gaussian(normalizedX, normalizedY, 0.3 * face.eyeSpacing, 0.27, 0.18, 0.12) +
          gaussian(normalizedX, normalizedY, -0.3 * face.eyeSpacing, 0.27, 0.18, 0.12);
        const sockets =
          gaussian(normalizedX, normalizedY, 0.3 * face.eyeSpacing, 0.12, 0.14, 0.1) +
          gaussian(normalizedX, normalizedY, -0.3 * face.eyeSpacing, 0.12, 0.14, 0.1);
        const muzzle = gaussian(normalizedX, normalizedY, 0, -0.34, 0.27, 0.18);
        const philtrum = gaussian(normalizedX, normalizedY, 0, -0.27, 0.055, 0.1);
        const chin = gaussian(normalizedX, normalizedY, 0, -0.68, 0.23, 0.16);
        z -=
          headHalf *
          front ** 1.7 *
          (nasalBridge +
            nasalTip +
            nasalWings +
            (leftCheek + rightCheek) * 0.075 * face.cheekVolume +
            brow * 0.045 -
            sockets * 0.07 +
            muzzle * 0.035 +
            philtrum * 0.025 +
            chin * 0.085 * face.chinProjection);
      }
      positions.push(add(centre, [x, y, z]));
      uvs.push([u, 1 - v]);
    }
  }

  // Keep the facial template continuous. The previous latitude-grid aperture
  // deletion produced square, jagged holes whose silhouette could never read as
  // an orbit. The ocular surface and curved lid margins now sit over a recessed
  // socket in this manifold skin surface.
  for (let latitude = 0; latitude < latitudeSegments; latitude++)
    for (let radial = 0; radial < radialSegments; radial++) {
      const next = (radial + 1) % radialSegments;
      const a = vertexAt(latitude, radial);
      const b = vertexAt(latitude + 1, radial);
      const c = vertexAt(latitude, next);
      const d = vertexAt(latitude + 1, next);
      if (latitude === 0) {
        const top = vertexAt(0, 0);
        indices.push(top, b, d);
      } else if (latitude === latitudeSegments - 1) {
        const bottom = vertexAt(latitudeSegments, 0);
        indices.push(a, bottom, c);
      } else {
        indices.push(a, b, c);
        indices.push(c, b, d);
      }
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
    for (const vertex of [a, b, c]) normals[vertex] = add(normals[vertex]!, normal);
  }
  for (let index = 0; index < normals.length; index++) normals[index] = normalize(normals[index]!);
  const skinIndices = positions.map(() => [headBone, 0, 0, 0] as Vec4);
  const skinWeights = positions.map(() => [1, 0, 0, 0] as Vec4);
  const used = [...new Set(indices)].sort((a, b) => a - b);
  const remap = new Map(used.map((source, target) => [source, target]));
  return {
    positions: used.map((index) => positions[index]!),
    normals: used.map((index) => normals[index]!),
    uvs: used.map((index) => uvs[index]!),
    indices: indices.map((index) => remap.get(index)!),
    skinIndices: used.map((index) => skinIndices[index]!),
    skinWeights: used.map((index) => skinWeights[index]!),
    materialId: 'skin-detail',
  };
}

/**
 * Reusable scalp shell for the production base. This is intentionally a
 * separate mesh part rather than a fused head volume so a later library hair
 * asset can replace it without changing identity topology or skin weights.
 */
export function createScalpCap(head: Vec3, headHalf: number, skeleton: SkeletonJoint[]): MeshPart {
  const radialSegments = 96;
  const latitudeSegments = 36;
  const sourcePositions: Vec3[] = [];
  const sourceUvs: [number, number][] = [];
  const sourceIndices: number[] = [];
  const headBone = skeleton.findIndex((joint) => joint.id === 'head');
  const vertexAt = (latitude: number, radial: number) =>
    1 + (latitude - 1) * radialSegments + radial;
  sourcePositions.push([head[0], head[1] + headHalf * 1.135, head[2] + headHalf * 0.04]);
  sourceUvs.push([0.5, 1]);
  for (let latitude = 1; latitude <= latitudeSegments; latitude++) {
    const v = latitude / latitudeSegments;
    for (let radial = 0; radial < radialSegments; radial++) {
      const u = radial / radialSegments;
      const phi = u * Math.PI * 2;
      const front = Math.max(0, -Math.sin(phi));
      const back = Math.max(0, Math.sin(phi));
      const side = Math.abs(Math.cos(phi));
      const boundaryY = 0.34 * front + 0.04 * side - 0.48 * back;
      const theta = v * Math.acos(boundaryY);
      const unitY = Math.cos(theta);
      const ring = Math.sin(theta);
      const unitX = Math.cos(phi) * ring;
      const unitZ = Math.sin(phi) * ring;
      sourcePositions.push([
        head[0] + unitX * headHalf * 0.785,
        head[1] + headHalf * 0.04 + unitY * headHalf * (unitY > 0 ? 1.095 : 0.96),
        head[2] + headHalf * 0.04 + unitZ * headHalf * (unitZ > 0 ? 0.925 : 0.815),
      ]);
      sourceUvs.push([u, 1 - v]);
    }
  }
  for (let radial = 0; radial < radialSegments; radial++) {
    const next = (radial + 1) % radialSegments;
    sourceIndices.push(0, vertexAt(1, radial), vertexAt(1, next));
  }
  for (let latitude = 1; latitude < latitudeSegments; latitude++)
    for (let radial = 0; radial < radialSegments; radial++) {
      const next = (radial + 1) % radialSegments;
      const a = vertexAt(latitude, radial);
      const b = vertexAt(latitude + 1, radial);
      const c = vertexAt(latitude, next);
      const d = vertexAt(latitude + 1, next);
      sourceIndices.push(a, b, c, c, b, d);
    }
  const sourceNormals = sourcePositions.map(() => [0, 0, 0] as Vec3);
  for (let index = 0; index < sourceIndices.length; index += 3) {
    const a = sourceIndices[index]!;
    const b = sourceIndices[index + 1]!;
    const c = sourceIndices[index + 2]!;
    const normal = cross(
      subtract(sourcePositions[b]!, sourcePositions[a]!),
      subtract(sourcePositions[c]!, sourcePositions[a]!),
    );
    for (const vertex of [a, b, c]) sourceNormals[vertex] = add(sourceNormals[vertex]!, normal);
  }
  const used = [...new Set(sourceIndices)].sort((a, b) => a - b);
  const remap = new Map(used.map((source, target) => [source, target]));
  return {
    positions: used.map((index) => sourcePositions[index]!),
    normals: used.map((index) => normalize(sourceNormals[index]!)),
    uvs: used.map((index) => sourceUvs[index]!),
    indices: sourceIndices.map((index) => remap.get(index)!),
    skinIndices: used.map(() => [headBone, 0, 0, 0] as Vec4),
    skinWeights: used.map(() => [1, 0, 0, 0] as Vec4),
    materialId: 'hair',
  };
}
