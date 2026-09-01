import { z } from 'zod';
import type { GeometryAsset, GeometryMorphTarget, Vec3 } from '../geometry/model.js';

export const faceIdentityParametersSchema = z.object({
  jawWidth: z.number().min(0.75).max(1.3).default(1),
  jawTaper: z.number().min(0.7).max(1.35).default(1),
  cheekVolume: z.number().min(0.65).max(1.4).default(1),
  noseLength: z.number().min(0.7).max(1.4).default(1),
  noseWidth: z.number().min(0.7).max(1.35).default(1),
  eyeScale: z.number().min(0.75).max(1.25).default(1),
  eyeSpacing: z.number().min(0.78).max(1.25).default(1),
  browHeight: z.number().min(0.75).max(1.3).default(1),
  chinProjection: z.number().min(0.7).max(1.4).default(1),
  mouthWidth: z.number().min(0.75).max(1.3).default(1),
  lipFullness: z.number().min(0.65).max(1.45).default(1),
});

export type FaceIdentityParameters = z.input<typeof faceIdentityParametersSchema>;
export type ResolvedFaceIdentityParameters = z.output<typeof faceIdentityParametersSchema>;

function materialVertices(asset: GeometryAsset, materialIds: string[]) {
  const vertices = new Set<number>();
  for (const group of asset.materialGroups.filter((value) =>
    materialIds.includes(value.materialId),
  ))
    for (let index = group.start; index < group.start + group.count; index++)
      vertices.add(asset.indices[index]!);
  return [...vertices].sort((a, b) => a - b);
}

function target(
  id: string,
  vertices: number[],
  positions: GeometryAsset['positions'],
  delta: (position: Vec3, vertex: number) => Vec3,
): GeometryMorphTarget {
  return {
    id,
    vertexIndices: vertices,
    positionDeltas: vertices.map((vertex) => delta(positions[vertex]!, vertex)),
  };
}

/** Adds sparse, renderer-independent facial controls to the authored face groups. */
export function addIdentityFaceMorphTargets(asset: GeometryAsset, headHalf: number) {
  const upperLip = materialVertices(asset, ['mouth-upper']);
  const lowerLip = materialVertices(asset, ['mouth-lower']);
  const mouthInterior = materialVertices(asset, ['mouth-interior']);
  const eyeSurface = materialVertices(asset, ['eye-white', 'eyes', 'pupils']);
  const leftLid = materialVertices(asset, ['eyelid-left']);
  const rightLid = materialVertices(asset, ['eyelid-right']);
  const mouth = [...new Set([...upperLip, ...lowerLip])].sort((a, b) => a - b);
  const mouthExtent = Math.max(
    ...mouth.map((vertex) => Math.abs(asset.positions[vertex]![0])),
    1e-6,
  );
  const mouthCentreY =
    mouth.reduce((sum, vertex) => sum + asset.positions[vertex]![1], 0) / Math.max(1, mouth.length);
  const blink = (side: 'left' | 'right', lids: number[]) => {
    const sideEyes = eyeSurface.filter((vertex) =>
      side === 'left' ? asset.positions[vertex]![0] >= 0 : asset.positions[vertex]![0] < 0,
    );
    const vertices = [...new Set([...sideEyes, ...lids])].sort((a, b) => a - b);
    const centreY =
      sideEyes.reduce((sum, vertex) => sum + asset.positions[vertex]![1], 0) /
      Math.max(1, sideEyes.length);
    const lidSet = new Set(lids);
    return target(`expression-blink-${side}`, vertices, asset.positions, (position, vertex) => [
      0,
      (centreY - position[1]) * 0.92,
      lidSet.has(vertex) ? -headHalf * 0.008 : headHalf * 0.16,
    ]);
  };
  asset.morphTargets.push(
    target('expression-smile', mouth, asset.positions, (position) => {
      const corner = Math.min(1, Math.abs(position[0]) / mouthExtent);
      return [0, headHalf * 0.055 * corner * corner, -headHalf * 0.012 * corner];
    }),
    target(
      'expression-jaw-open',
      [...new Set([...lowerLip, ...mouthInterior])].sort((a, b) => a - b),
      asset.positions,
      (position, vertex) => [
        0,
        lowerLip.includes(vertex)
          ? -headHalf * 0.11
          : position[1] < mouthCentreY
            ? -headHalf * 0.08
            : headHalf * 0.01,
        headHalf * 0.012,
      ],
    ),
    blink('left', leftLid),
    blink('right', rightLid),
  );
  return asset;
}

export function verifyIdentityFace(asset: GeometryAsset) {
  const requiredMaterials = [
    'eye-white',
    'eyes',
    'eyelid-left',
    'eyelid-right',
    'mouth-upper',
    'mouth-lower',
    'mouth-interior',
    'brows',
  ];
  const requiredMorphs = [
    'expression-smile',
    'expression-jaw-open',
    'expression-blink-left',
    'expression-blink-right',
  ];
  const materialCoverage = Object.fromEntries(
    requiredMaterials.map((id) => [id, materialVertices(asset, [id]).length]),
  );
  const morphCoverage = Object.fromEntries(
    requiredMorphs.map((id) => [
      id,
      asset.morphTargets.find((target) => target.id === id)?.vertexIndices.length ?? 0,
    ]),
  );
  const issues: string[] = [];
  if (Object.values(materialCoverage).some((count) => count < 8))
    issues.push('character.face-landmark-geometry-missing');
  if (Object.values(morphCoverage).some((count) => count < 8))
    issues.push('character.face-expression-morph-missing');
  if (!asset.metadata.faceIdentityParameters)
    issues.push('character.face-identity-parameters-missing');
  return { valid: issues.length === 0, issues, checks: { materialCoverage, morphCoverage } };
}
