import * as THREE from 'three';
import type { GeometryAsset } from '../geometry/model.js';

export function toThreeBufferGeometry(asset: GeometryAsset) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(asset.positions.flat(), 3));
  if (asset.normals)
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(asset.normals.flat(), 3));
  else geometry.computeVertexNormals();
  if (asset.uvs) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(asset.uvs.flat(), 2));
  if (asset.skinIndices)
    geometry.setAttribute(
      'skinIndex',
      new THREE.Uint16BufferAttribute(asset.skinIndices.flat(), 4),
    );
  if (asset.skinWeights)
    geometry.setAttribute(
      'skinWeight',
      new THREE.Float32BufferAttribute(asset.skinWeights.flat(), 4),
    );
  geometry.morphAttributes.position = (asset.morphTargets ?? []).map((target) => {
    const deltas = Array.from({ length: asset.positions.length }, () => [0, 0, 0]);
    target.vertexIndices.forEach((vertex, index) => {
      deltas[vertex] = target.positionDeltas[index]!;
    });
    const attribute = new THREE.Float32BufferAttribute(deltas.flat(), 3);
    attribute.name = target.id;
    return attribute;
  });
  geometry.morphTargetsRelative = true;
  geometry.setIndex(asset.indices);
  for (const group of asset.materialGroups)
    geometry.addGroup(
      group.start,
      group.count,
      asset.materials.findIndex((item) => item.id === group.materialId),
    );
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function toThreeSkeleton(asset: GeometryAsset) {
  const bones = asset.skeleton.map((joint) => {
    const bone = new THREE.Bone();
    bone.name = joint.id;
    bone.position.fromArray(joint.restPosition);
    return bone;
  });
  const byId = new Map(asset.skeleton.map((joint, index) => [joint.id, bones[index]!]));
  const roots: THREE.Bone[] = [];
  asset.skeleton.forEach((joint, index) => {
    const current = bones[index]!;
    if (joint.parent) byId.get(joint.parent)?.add(current);
    else roots.push(current);
  });
  roots.forEach((root) => root.updateMatrixWorld(true));
  return { skeleton: new THREE.Skeleton(bones), roots, bones };
}

export function toThreeSkinnedMesh(
  asset: GeometryAsset,
  material?: THREE.Material | THREE.Material[],
) {
  const geometry = toThreeBufferGeometry(asset);
  const { skeleton, roots } = toThreeSkeleton(asset);
  const resolvedMaterial =
    material ??
    (asset.materials.length
      ? asset.materials.map(
          (item) =>
            new THREE.MeshStandardMaterial({
              name: item.id,
              color: new THREE.Color(...item.baseColor.slice(0, 3)),
              opacity: item.baseColor[3],
              transparent: item.baseColor[3] < 1,
              roughness: item.roughness,
              metalness: item.metallic,
              emissive: new THREE.Color(...item.emission),
              emissiveIntensity: item.emissionStrength,
            }),
        )
      : new THREE.MeshStandardMaterial());
  const mesh = new THREE.SkinnedMesh(geometry, resolvedMaterial);
  roots.forEach((root) => mesh.add(root));
  mesh.bind(skeleton);
  return mesh;
}
