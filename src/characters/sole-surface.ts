import { jointWorldTransforms } from '../geometry/kinematics.js';
import type { GeometryAsset, Vec3 } from '../geometry/model.js';

export type CharacterSide = 'left' | 'right';
export type SoleRegion = 'heel' | 'forefoot';

export interface SoleSurfaceRegion {
  indices: number[];
  contactWitness: Vec3;
  witnessBone: string;
  witnessVertices: number[];
}

function percentile(values: number[], amount: number) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * amount))]!;
}

function jointInfluence(asset: GeometryAsset, vertex: number, jointId: string) {
  if (!asset.skinIndices || !asset.skinWeights) return 0;
  return asset.skinIndices[vertex]!.reduce((total, jointIndex, influence) => {
    const joint = asset.skeleton[jointIndex];
    return total + (joint?.id === jointId ? asset.skinWeights![vertex]![influence]! : 0);
  }, 0);
}

function rigidSurfaceWitness(
  asset: GeometryAsset,
  indices: number[],
  bone: string,
): { position: Vec3; vertices: number[] } {
  // A point contact owned by one bone can only predict the visible surface if
  // it is derived from vertices that move with that bone. Blended vertices are
  // still included in final-surface verification, but are not silently treated
  // as a rigid kinematic landmark.
  const rigid = indices.filter((index) => jointInfluence(asset, index, bone) >= 0.99);
  const candidates = rigid.length >= 3 ? rigid : indices;
  if (!candidates.length)
    throw new Error(`Cannot derive '${bone}' contact from an empty sole region`);
  const contactY = percentile(
    candidates.map((index) => asset.positions[index]![1]),
    0.02,
  );
  const ordered = [...candidates].sort(
    (left, right) => asset.positions[left]![1] - asset.positions[right]![1],
  );
  const patch = ordered.slice(0, Math.max(3, Math.ceil(ordered.length * 0.03)));
  const average = (axis: 0 | 2) =>
    patch.reduce((sum, index) => sum + asset.positions[index]![axis], 0) / patch.length;
  return { position: [average(0), contactY, average(2)], vertices: patch };
}

/**
 * Finds the low, visible support regions of an authored human foot. The same
 * regions drive gait measurement and final deformed-surface verification, so
 * the solver cannot target a helper-bone centre while QA judges the outsole.
 */
export function identifySoleSurfaceRegions(
  asset: GeometryAsset,
  side: CharacterSide,
): Record<SoleRegion, SoleSurfaceRegion> {
  const footId = `${side}-foot`;
  const toeId = `${side}-toe`;
  const foot = jointWorldTransforms(asset).get(footId);
  if (!foot) throw new Error(`Cannot identify ${side} sole without joint '${footId}'`);
  const ys = asset.positions.map((position) => position[1]);
  const height = Math.max(...ys) - Math.min(...ys);
  const minimumY = Math.min(...ys);
  const candidates = asset.positions
    .map((position, index) => ({ position, index }))
    .filter(
      ({ position }) =>
        position[1] <= minimumY + height * 0.022 &&
        Math.abs(position[0] - foot.position[0]) <= height * 0.09 &&
        Math.abs(position[2] - foot.position[2]) <= height * 0.16,
    );
  if (!candidates.length) throw new Error(`Cannot identify ${side} sole surface`);
  const minimumZ = Math.min(...candidates.map(({ position }) => position[2]));
  const maximumZ = Math.max(...candidates.map(({ position }) => position[2]));
  const span = maximumZ - minimumZ;
  const heel = candidates
    .filter(({ position }) => position[2] >= maximumZ - span * 0.3)
    .map(({ index }) => index);
  const forefoot = candidates
    .filter(({ position }) => position[2] <= minimumZ + span * 0.3)
    .map(({ index }) => index);
  const heelWitness = rigidSurfaceWitness(asset, heel, footId);
  const forefootWitness = rigidSurfaceWitness(asset, forefoot, toeId);
  return {
    heel: {
      indices: heel,
      contactWitness: heelWitness.position,
      witnessBone: footId,
      witnessVertices: heelWitness.vertices,
    },
    forefoot: {
      indices: forefoot,
      contactWitness: forefootWitness.position,
      witnessBone: toeId,
      witnessVertices: forefootWitness.vertices,
    },
  };
}
