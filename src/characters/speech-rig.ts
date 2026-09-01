import { geometryAssetSchema, type GeometryAsset, type Vec3 } from '../geometry/model.js';

export const englishVisemeTargets = [
  'viseme-aa',
  'viseme-ee',
  'viseme-oh',
  'viseme-fv',
  'viseme-mbp',
] as const;

const shapes: Record<(typeof englishVisemeTargets)[number], { x: number; y: number; z: number }> = {
  'viseme-aa': { x: 0.72, y: 2.8, z: -0.006 },
  'viseme-ee': { x: 1.25, y: 0.65, z: -0.003 },
  'viseme-oh': { x: 0.55, y: 2.1, z: -0.009 },
  'viseme-fv': { x: 1.05, y: 0.35, z: -0.002 },
  'viseme-mbp': { x: 0.9, y: 0.2, z: 0 },
};

function mouthVertices(asset: GeometryAsset) {
  const vertices = new Set<number>();
  for (const group of asset.materialGroups.filter((candidate) => candidate.materialId === 'mouth'))
    for (let offset = group.start; offset < group.start + group.count; offset++)
      vertices.add(asset.indices[offset]!);
  return [...vertices].sort((left, right) => left - right);
}

function centre(points: Vec3[]): Vec3 {
  return [0, 1, 2].map(
    (axis) => points.reduce((sum, point) => sum + point[axis]!, 0) / points.length,
  ) as Vec3;
}

export function createEnglishSpeechMorphRig(input: GeometryAsset, id = input.id) {
  const base = geometryAssetSchema.parse(input);
  if (base.morphTargets.length)
    throw new Error(`Geometry '${base.id}' already contains morph targets`);
  const vertexIndices = mouthVertices(base);
  if (!vertexIndices.length)
    throw new Error(`Geometry '${base.id}' has no material-grouped mouth geometry`);
  const mouthCentre = centre(vertexIndices.map((vertex) => base.positions[vertex]!));
  const morphTargets = englishVisemeTargets.map((targetId) => {
    const shape = shapes[targetId];
    return {
      id: targetId,
      vertexIndices,
      positionDeltas: vertexIndices.map((vertex): Vec3 => {
        const position = base.positions[vertex]!;
        return [
          (position[0] - mouthCentre[0]) * (shape.x - 1),
          (position[1] - mouthCentre[1]) * (shape.y - 1),
          shape.z,
        ];
      }),
    };
  });
  return geometryAssetSchema.parse({
    ...structuredClone(base),
    id,
    morphTargets,
    attachments: {
      ...base.attachments,
      'mouth-centre': { position: mouthCentre, rotation: [0, 0, 0], bone: 'head' },
    },
    metadata: {
      ...base.metadata,
      speechRig: {
        generator: 'videoer.english-visemes.v1',
        targets: englishVisemeTargets,
        sourceMaterial: 'mouth',
        affectedVertices: vertexIndices.length,
      },
    },
  });
}

export function verifyEnglishSpeechMorphRig(asset: GeometryAsset) {
  const parsed = geometryAssetSchema.parse(asset);
  const expected = new Set(englishVisemeTargets);
  const targets = parsed.morphTargets.filter((target) => expected.has(target.id as never));
  const issues: string[] = [];
  if (targets.length !== englishVisemeTargets.length)
    issues.push('speech rig does not contain every canonical English viseme target');
  const mouth = new Set(mouthVertices(parsed));
  for (const target of targets) {
    if (target.vertexIndices.some((vertex) => !mouth.has(vertex)))
      issues.push(`morph '${target.id}' affects vertices outside the mouth material`);
    if (Math.max(...target.positionDeltas.map((delta) => Math.hypot(...delta))) < 0.001)
      issues.push(`morph '${target.id}' has no measurable deformation`);
  }
  return {
    valid: issues.length === 0,
    issues,
    checks: {
      targets: targets.map((target) => target.id),
      affectedVertices: [...mouth].length,
      mouthOnly: issues.every((issue) => !issue.includes('outside the mouth')),
      measurable: issues.every((issue) => !issue.includes('no measurable')),
    },
  };
}
