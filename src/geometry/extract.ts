import { geometryAssetSchema, type GeometryAsset } from './model.js';

export function extractMaterialGeometry(
  source: GeometryAsset,
  materialIds: string[],
  id: string,
  metadata: Record<string, unknown> = {},
) {
  const selected = new Set(materialIds);
  const oldIndices: number[] = [];
  const selectedGroups: Array<{ materialId: string; count: number }> = [];
  for (const group of source.materialGroups) {
    if (!selected.has(group.materialId)) continue;
    oldIndices.push(...source.indices.slice(group.start, group.start + group.count));
    const previous = selectedGroups.at(-1);
    if (previous?.materialId === group.materialId) previous.count += group.count;
    else selectedGroups.push({ materialId: group.materialId, count: group.count });
  }
  if (oldIndices.length === 0)
    throw new Error(
      `Geometry '${source.id}' has no triangles for materials: ${materialIds.join(', ')}`,
    );
  const used = [...new Set(oldIndices)].sort((a, b) => a - b);
  const remap = new Map(used.map((oldIndex, newIndex) => [oldIndex, newIndex]));
  let groupStart = 0;
  return geometryAssetSchema.parse({
    schemaVersion: 1,
    id,
    units: source.units,
    coordinateSystem: source.coordinateSystem,
    positions: used.map((index) => source.positions[index]!),
    ...(source.normals ? { normals: used.map((index) => source.normals![index]!) } : {}),
    ...(source.uvs ? { uvs: used.map((index) => source.uvs![index]!) } : {}),
    indices: oldIndices.map((index) => remap.get(index)!),
    ...(source.skinIndices
      ? { skinIndices: used.map((index) => source.skinIndices![index]!) }
      : {}),
    ...(source.skinWeights
      ? { skinWeights: used.map((index) => source.skinWeights![index]!) }
      : {}),
    materials: source.materials.filter((material) => selected.has(material.id)),
    materialGroups: selectedGroups.map((group) => {
      const output = { ...group, start: groupStart };
      groupStart += group.count;
      return output;
    }),
    skeleton: source.skeleton,
    attachments: {},
    metadata: {
      generator: 'videoer.material-geometry-extractor.v1',
      sourceGeometry: source.id,
      extractedMaterials: materialIds,
      ...metadata,
    },
  });
}
