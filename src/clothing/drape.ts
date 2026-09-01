import type { GeometryAsset, Vec3, Vec4 } from '../geometry/model.js';

export const LONG_DRESS_HEM_NON_PELVIS_LIMIT = 0.13;

export function longDressDrapeInfluences(
  position: Vec3,
  minimumY: number,
  hipY: number,
  hipsIndex: number,
  leftThighIndex: number,
  rightThighIndex: number,
): { indices: Vec4; weights: Vec4 } {
  const drapeHeight = hipY - minimumY;
  if (!(drapeHeight > 0.2))
    throw new Error('Long-dress drape weighting requires vertices at least 0.2m below the hips');
  const heightRatio = Math.max(0, Math.min(1, (position[1] - minimumY) / drapeHeight));
  // Keep the hem pelvis-dominant while letting the upper/mid skirt follow enough
  // thigh motion to maintain clearance during a full gait. The bell-shaped term
  // reaches zero at both hem and hip, avoiding the old leg-driven hem fan.
  const thighWeight = 0.04 + 0.12 * heightRatio + 0.1 * heightRatio * (1 - heightRatio);
  return {
    indices: [hipsIndex, position[0] >= 0 ? leftThighIndex : rightThighIndex, 0, 0],
    weights: [1 - thighWeight, thighWeight, 0, 0],
  };
}

function materialVertices(asset: GeometryAsset, materialId?: string) {
  if (!materialId) return asset.positions.map((_, index) => index);
  const selected = new Set<number>();
  for (const group of asset.materialGroups) {
    if (group.materialId !== materialId) continue;
    for (const index of asset.indices.slice(group.start, group.start + group.count))
      selected.add(index);
  }
  return [...selected];
}

export function measureLongDressDrapeSkinning(asset: GeometryAsset, materialId?: string) {
  const vertices = materialVertices(asset, materialId);
  if (!vertices.length)
    return {
      valid: false,
      issues: [`no${materialId ? ` '${materialId}'` : ''} garment vertices found`],
      hemVertexCount: 0,
      maximumHemNonPelvisWeight: Number.POSITIVE_INFINITY,
    };
  if (!asset.skinIndices || !asset.skinWeights)
    return {
      valid: false,
      issues: ['long dress lacks skin indices or weights'],
      hemVertexCount: 0,
      maximumHemNonPelvisWeight: Number.POSITIVE_INFINITY,
    };
  const hipsIndex = asset.skeleton.findIndex((joint) => joint.id === 'hips');
  if (hipsIndex < 0)
    return {
      valid: false,
      issues: ['long dress lacks a hips joint'],
      hemVertexCount: 0,
      maximumHemNonPelvisWeight: Number.POSITIVE_INFINITY,
    };
  const ys = vertices.map((index) => asset.positions[index]![1]);
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);
  const hemLimit = minimumY + (maximumY - minimumY) * 0.3;
  const hemVertices = vertices.filter((index) => asset.positions[index]![1] <= hemLimit);
  const maximumHemNonPelvisWeight = Math.max(
    0,
    ...hemVertices.map((index) =>
      asset.skinWeights![index]!.reduce(
        (sum, weight, influence) =>
          sum + (asset.skinIndices![index]![influence] === hipsIndex ? 0 : weight),
        0,
      ),
    ),
  );
  const issues: string[] = [];
  if (!hemVertices.length) issues.push('long dress has no measurable hem vertices');
  if (maximumHemNonPelvisWeight > LONG_DRESS_HEM_NON_PELVIS_LIMIT)
    issues.push('long-dress hem retains excessive non-pelvis skinning influence');
  return {
    valid: issues.length === 0,
    issues,
    hemVertexCount: hemVertices.length,
    maximumHemNonPelvisWeight,
  };
}
