import { geometryAssetSchema, type GeometryAsset } from '../geometry/model.js';
import { validateGeometry } from '../geometry/model.js';
import { longDressDrapeInfluences, measureLongDressDrapeSkinning } from './drape.js';

type Vec3 = [number, number, number];

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(value: Vec3, factor: number): Vec3 {
  return [value[0] * factor, value[1] * factor, value[2] * factor];
}

function length(value: Vec3) {
  return Math.hypot(value[0], value[1], value[2]);
}

function worldJointPositions(asset: GeometryAsset) {
  const output = new Map<string, Vec3>();
  for (const joint of asset.skeleton) {
    const parent = joint.parent ? output.get(joint.parent) : undefined;
    output.set(joint.id, parent ? add(parent, joint.restPosition) : joint.restPosition);
  }
  return output;
}

function skeletonScale(source: GeometryAsset, target: GeometryAsset) {
  const sourceWorld = [...worldJointPositions(source).values()];
  const targetWorld = [...worldJointPositions(target).values()];
  const extent = (values: Vec3[]) => {
    const ys = values.map((value) => value[1]);
    return Math.max(...ys) - Math.min(...ys);
  };
  const sourceExtent = extent(sourceWorld);
  const targetExtent = extent(targetWorld);
  if (!(sourceExtent > 0) || !(targetExtent > 0))
    throw new Error('Clothing fitting requires non-degenerate source and target skeletons');
  return targetExtent / sourceExtent;
}

export function extendCanonicalClothingSkeleton(
  garment: GeometryAsset,
  target: GeometryAsset,
  assetId = garment.id,
) {
  const sourceIds = garment.skeleton.map((joint) => joint.id);
  const targetIds = target.skeleton.map((joint) => joint.id);
  if (
    sourceIds.length >= targetIds.length ||
    sourceIds.some((joint, index) => targetIds[index] !== joint)
  )
    throw new Error(
      'Clothing skeleton extension requires the source joints to be an exact ordered target prefix',
    );
  const highestInfluence = Math.max(...(garment.skinIndices?.flat() ?? [-1]));
  if (highestInfluence >= sourceIds.length)
    throw new Error('Clothing skeleton extension found an influence outside the source skeleton');
  const extended = geometryAssetSchema.parse({
    ...structuredClone(garment),
    id: assetId,
    skeleton: [
      ...structuredClone(garment.skeleton),
      ...structuredClone(target.skeleton.slice(garment.skeleton.length)),
    ],
    metadata: {
      ...garment.metadata,
      skeletonExtendedFromJointCount: garment.skeleton.length,
      skeletonExtendedToJointCount: target.skeleton.length,
      skeletonExtensionTarget: target.id,
      skeletonExtensionGenerator: 'videoer.canonical-clothing-skeleton-extension.v1',
    },
  });
  const validation = validateGeometry(extended);
  if (!validation.valid)
    throw new Error(
      `Extended clothing skeleton failed geometry validation: ${validation.issues.map((issue) => issue.message).join('; ')}`,
    );
  return extended;
}

export function fitCanonicalClothing(
  garment: GeometryAsset,
  target: GeometryAsset,
  assetId: string,
  options: {
    clearanceMeters?: number;
    skinningPolicy?: 'preserve' | 'long-dress-drape-v1';
    metadata?: Record<string, unknown>;
  } = {},
) {
  const sourceJointIds = garment.skeleton.map((joint) => joint.id);
  const targetJointIds = target.skeleton.map((joint) => joint.id);
  if (JSON.stringify(sourceJointIds) !== JSON.stringify(targetJointIds))
    throw new Error('Clothing fitting requires identical ordered canonical skeleton joints');
  if (!garment.skinIndices || !garment.skinWeights)
    throw new Error('Clothing fitting requires skinned garment geometry');
  if (JSON.stringify(garment.coordinateSystem) !== JSON.stringify(target.coordinateSystem))
    throw new Error('Clothing fitting requires a shared coordinate system');
  const sourceWorld = worldJointPositions(garment);
  const targetWorld = worldJointPositions(target);
  const uniformScale = skeletonScale(garment, target);
  const clearanceMeters = options.clearanceMeters ?? 0.008;
  const skinningPolicy = options.skinningPolicy ?? 'preserve';
  if (!(clearanceMeters > 0 && clearanceMeters <= 0.05))
    throw new Error('Clothing fit clearance must be greater than zero and at most 0.05 metres');
  if (!garment.normals)
    throw new Error('Clothing fitting requires garment normals for physical surface clearance');
  const positions = garment.positions.map((position, vertexIndex) => {
    const indices = garment.skinIndices![vertexIndex]!;
    const weights = garment.skinWeights![vertexIndex]!;
    let fitted: Vec3 = [0, 0, 0];
    for (let influence = 0; influence < 4; influence++) {
      const weight = weights[influence]!;
      if (weight <= 0) continue;
      const joint = garment.skeleton[indices[influence]!]!;
      const sourceJoint = sourceWorld.get(joint.id)!;
      const targetJoint = targetWorld.get(joint.id)!;
      const transformed = add(targetJoint, scale(subtract(position, sourceJoint), uniformScale));
      fitted = add(fitted, scale(transformed, weight));
    }
    return add(fitted, scale(garment.normals![vertexIndex]!, clearanceMeters));
  });
  let skinIndices = structuredClone(garment.skinIndices);
  let skinWeights = structuredClone(garment.skinWeights);
  if (skinningPolicy === 'long-dress-drape-v1') {
    const hipsIndex = garment.skeleton.findIndex((joint) => joint.id === 'hips');
    const leftThighIndex = garment.skeleton.findIndex((joint) => joint.id === 'left-thigh');
    const rightThighIndex = garment.skeleton.findIndex((joint) => joint.id === 'right-thigh');
    if (hipsIndex < 0 || leftThighIndex < 0 || rightThighIndex < 0)
      throw new Error('Long-dress drape weighting requires hips and bilateral thigh joints');
    const hipY = sourceWorld.get('hips')![1];
    const minimumY = Math.min(...garment.positions.map((position) => position[1]));
    const drapeHeight = hipY - minimumY;
    if (!(drapeHeight > 0.2))
      throw new Error('Long-dress drape weighting requires garment vertices below the hips');
    skinIndices = garment.positions.map((position, index) => {
      if (position[1] >= hipY - 0.02) return garment.skinIndices![index]!;
      return longDressDrapeInfluences(
        position,
        minimumY,
        hipY,
        hipsIndex,
        leftThighIndex,
        rightThighIndex,
      ).indices;
    });
    skinWeights = garment.positions.map((position, index) => {
      if (position[1] >= hipY - 0.02) return garment.skinWeights![index]!;
      return longDressDrapeInfluences(
        position,
        minimumY,
        hipY,
        hipsIndex,
        leftThighIndex,
        rightThighIndex,
      ).weights;
    });
  }
  const output = geometryAssetSchema.parse({
    ...structuredClone(garment),
    id: assetId,
    positions,
    skinIndices,
    skinWeights,
    skeleton: structuredClone(target.skeleton),
    metadata: {
      ...garment.metadata,
      ...options.metadata,
      sourceClothing: garment.id,
      targetGeometry: target.id,
      uniformFitScale: uniformScale,
      garmentClearanceMeters: clearanceMeters,
      clothingSkinningPolicy: skinningPolicy,
      adaptationGenerator: 'videoer.canonical-clothing-fit.v1',
    },
  });
  const validation = validateGeometry(output);
  if (!validation.valid)
    throw new Error(
      `Fitted clothing failed geometry validation: ${validation.issues.map((issue) => issue.message).join('; ')}`,
    );
  return output;
}

export function verifyCanonicalClothingFit(
  source: GeometryAsset,
  target: GeometryAsset,
  fitted: GeometryAsset,
) {
  const issues: string[] = [];
  const sourceJointIds = source.skeleton.map((joint) => joint.id);
  const targetJointIds = target.skeleton.map((joint) => joint.id);
  const fittedJointIds = fitted.skeleton.map((joint) => joint.id);
  const topologyPreserved =
    fitted.positions.length === source.positions.length &&
    JSON.stringify(fitted.indices) === JSON.stringify(source.indices) &&
    JSON.stringify(fitted.materialGroups) === JSON.stringify(source.materialGroups);
  const skinningPreserved =
    JSON.stringify(fitted.skinIndices) === JSON.stringify(source.skinIndices) &&
    JSON.stringify(fitted.skinWeights) === JSON.stringify(source.skinWeights);
  const skinningPolicy = fitted.metadata.clothingSkinningPolicy ?? 'preserve';
  const targetSkeletonMatched =
    JSON.stringify(fittedJointIds) === JSON.stringify(targetJointIds) &&
    JSON.stringify(fitted.skeleton) === JSON.stringify(target.skeleton);
  const canonicalSkeletonCompatible =
    JSON.stringify(sourceJointIds) === JSON.stringify(targetJointIds);
  const displacements = fitted.positions.map((position, index) =>
    length(subtract(position, source.positions[index]!)),
  );
  const clearanceMeters = Number(fitted.metadata.garmentClearanceMeters);
  const baseline = fitCanonicalClothing(source, target, `${fitted.id}.baseline`, {
    clearanceMeters: 1e-6,
  });
  const normalClearances = fitted.positions.map((position, index) => {
    const normal = source.normals?.[index];
    if (!normal) return Number.NEGATIVE_INFINITY;
    const delta = subtract(position, baseline.positions[index]!);
    return delta[0] * normal[0] + delta[1] * normal[1] + delta[2] * normal[2] + 1e-6;
  });
  const minimumNormalClearance = Math.min(...normalClearances);
  const drape = measureLongDressDrapeSkinning(fitted);
  const maximumHemNonPelvisWeight = drape.maximumHemNonPelvisWeight;
  const drapeSkinningValid = skinningPolicy !== 'long-dress-drape-v1' || drape.valid;
  const maximumVertexDisplacement = Math.max(...displacements);
  const changedVertexCount = displacements.filter((value) => value > 1e-8).length;
  if (!topologyPreserved) issues.push('garment topology or material groups changed');
  if (skinningPolicy === 'preserve' && !skinningPreserved)
    issues.push('garment skinning changed under the preserve policy');
  if (!drapeSkinningValid)
    issues.push('long-dress hem retains excessive non-pelvis skinning influence');
  if (!targetSkeletonMatched) issues.push('fitted garment does not use the exact target skeleton');
  if (!canonicalSkeletonCompatible) issues.push('source and target skeletons are incompatible');
  if (!changedVertexCount) issues.push('clothing fit made no geometric change');
  if (!Number.isFinite(clearanceMeters) || clearanceMeters <= 0)
    issues.push('fitted garment lacks a positive declared surface clearance');
  else if (minimumNormalClearance < clearanceMeters - 1e-5)
    issues.push('fitted garment does not preserve its declared outward surface clearance');
  const validation = validateGeometry(fitted);
  if (!validation.valid)
    issues.push(...validation.issues.map((issue) => `${issue.code}: ${issue.message}`));
  return {
    valid: issues.length === 0,
    issues,
    topologyPreserved,
    skinningPreserved,
    skinningPolicy,
    drapeSkinningValid,
    hemVertexCount: drape.hemVertexCount,
    maximumHemNonPelvisWeight,
    targetSkeletonMatched,
    canonicalSkeletonCompatible,
    changedVertexCount,
    maximumVertexDisplacement,
    clearanceMeters,
    minimumNormalClearance,
    validation,
  };
}
