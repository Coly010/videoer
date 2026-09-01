import { z } from 'zod';
import { surfaceMaterialSchema } from '../materials/model.js';

const vec2Schema = z.tuple([z.number().finite(), z.number().finite()]);
const vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const vec4Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const index4Schema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
]);

export const geometryMaterialSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  baseColor: vec4Schema,
  roughness: z.number().min(0).max(1).default(0.5),
  metallic: z.number().min(0).max(1).default(0),
  specularIorLevel: z.number().min(0).max(1).optional(),
  anisotropy: z.number().min(0).max(1).optional(),
  anisotropyRotation: z.number().min(0).max(1).optional(),
  fiber: z
    .object({
      kind: z.literal('uv-hair-flow'),
      strandFrequency: z.number().positive(),
      colorVariation: z.number().min(0).max(1),
      normalStrength: z.number().min(0).max(1),
    })
    .optional(),
  emission: vec3Schema.default([0, 0, 0]),
  emissionStrength: z.number().nonnegative().default(0),
  surface: surfaceMaterialSchema.optional(),
});

export const geometryMaterialGroupSchema = z.object({
  materialId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  start: z.number().int().nonnegative(),
  count: z.number().int().positive(),
});

export const geometryMorphTargetSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  vertexIndices: z.array(z.number().int().nonnegative()).min(1),
  positionDeltas: z.array(vec3Schema).min(1),
});

export const skeletonJointSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  parent: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .optional(),
  restPosition: vec3Schema,
  constraints: z
    .object({
      rotationMin: vec3Schema.optional(),
      rotationMax: vec3Schema.optional(),
    })
    .default({}),
});

export const geometryAssetSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/),
    units: z.literal('meters'),
    coordinateSystem: z.object({
      handedness: z.literal('right'),
      up: z.literal('y'),
      forward: z.literal('-z'),
    }),
    positions: z.array(vec3Schema).min(3),
    normals: z.array(vec3Schema).optional(),
    uvs: z.array(vec2Schema).optional(),
    indices: z.array(z.number().int().nonnegative()).min(3),
    skinIndices: z.array(index4Schema).optional(),
    skinWeights: z.array(vec4Schema).optional(),
    materials: z.array(geometryMaterialSchema).default([]),
    materialGroups: z.array(geometryMaterialGroupSchema).default([]),
    skeleton: z.array(skeletonJointSchema).default([]),
    morphTargets: z.array(geometryMorphTargetSchema).default([]),
    attachments: z
      .record(
        z.string(),
        z.object({
          position: vec3Schema,
          rotation: vec3Schema.default([0, 0, 0]),
          bone: z.string().optional(),
        }),
      )
      .default({}),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((geometry, ctx) => {
    const vertexCount = geometry.positions.length;
    for (const attribute of ['normals', 'uvs', 'skinIndices', 'skinWeights'] as const) {
      const value = geometry[attribute];
      if (value && value.length !== vertexCount)
        ctx.addIssue({
          code: 'custom',
          path: [attribute],
          message: `${attribute} must contain one value per vertex`,
        });
    }
    if (geometry.indices.length % 3 !== 0)
      ctx.addIssue({
        code: 'custom',
        path: ['indices'],
        message: 'indices must describe triangles',
      });
    if (geometry.skinIndices && !geometry.skinWeights)
      ctx.addIssue({
        code: 'custom',
        path: ['skinWeights'],
        message: 'skinIndices require skinWeights',
      });
    if (geometry.skinWeights && !geometry.skinIndices)
      ctx.addIssue({
        code: 'custom',
        path: ['skinIndices'],
        message: 'skinWeights require skinIndices',
      });
    const morphTargets = new Set<string>();
    for (const [targetIndex, target] of geometry.morphTargets.entries()) {
      if (morphTargets.has(target.id))
        ctx.addIssue({
          code: 'custom',
          path: ['morphTargets', targetIndex, 'id'],
          message: 'duplicate morph target id',
        });
      morphTargets.add(target.id);
      if (target.vertexIndices.length !== target.positionDeltas.length)
        ctx.addIssue({
          code: 'custom',
          path: ['morphTargets', targetIndex],
          message: 'morph target indices and deltas must have equal length',
        });
      const vertices = new Set<number>();
      for (const [entryIndex, vertex] of target.vertexIndices.entries()) {
        if (vertex >= vertexCount)
          ctx.addIssue({
            code: 'custom',
            path: ['morphTargets', targetIndex, 'vertexIndices', entryIndex],
            message: 'morph target vertex is outside the geometry',
          });
        if (vertices.has(vertex))
          ctx.addIssue({
            code: 'custom',
            path: ['morphTargets', targetIndex, 'vertexIndices', entryIndex],
            message: 'morph target contains a duplicate vertex',
          });
        vertices.add(vertex);
      }
    }
    const joints = new Set<string>();
    for (const [index, joint] of geometry.skeleton.entries()) {
      if (joints.has(joint.id))
        ctx.addIssue({
          code: 'custom',
          path: ['skeleton', index, 'id'],
          message: 'duplicate joint id',
        });
      const materials = new Set<string>();
      for (const [index, material] of geometry.materials.entries()) {
        if (materials.has(material.id))
          ctx.addIssue({
            code: 'custom',
            path: ['materials', index, 'id'],
            message: 'duplicate material id',
          });
        materials.add(material.id);
      }
      const groupedIndices = new Set<number>();
      for (const [index, group] of geometry.materialGroups.entries()) {
        if (!materials.has(group.materialId))
          ctx.addIssue({
            code: 'custom',
            path: ['materialGroups', index, 'materialId'],
            message: `unknown material '${group.materialId}'`,
          });
        if (group.start % 3 !== 0 || group.count % 3 !== 0)
          ctx.addIssue({
            code: 'custom',
            path: ['materialGroups', index],
            message: 'material groups must align to triangle index boundaries',
          });
        if (group.start + group.count > geometry.indices.length)
          ctx.addIssue({
            code: 'custom',
            path: ['materialGroups', index],
            message: 'material group exceeds the index buffer',
          });
        for (let value = group.start; value < group.start + group.count; value++) {
          if (groupedIndices.has(value))
            ctx.addIssue({
              code: 'custom',
              path: ['materialGroups', index],
              message: 'material groups overlap',
            });
          groupedIndices.add(value);
        }
      }
      if (geometry.materialGroups.length && groupedIndices.size !== geometry.indices.length)
        ctx.addIssue({
          code: 'custom',
          path: ['materialGroups'],
          message: 'material groups must cover the complete index buffer',
        });
      if (joint.parent && !joints.has(joint.parent))
        ctx.addIssue({
          code: 'custom',
          path: ['skeleton', index, 'parent'],
          message: `parent '${joint.parent}' must appear before its child`,
        });
      joints.add(joint.id);
    }
  });

export type Vec3 = z.infer<typeof vec3Schema>;
export type Vec4 = z.infer<typeof vec4Schema>;
export type GeometryAsset = z.infer<typeof geometryAssetSchema>;
export type SkeletonJoint = z.infer<typeof skeletonJointSchema>;
export type GeometryMaterial = z.infer<typeof geometryMaterialSchema>;
export type GeometryMorphTarget = z.infer<typeof geometryMorphTargetSchema>;

export interface GeometryValidationIssue {
  code: string;
  message: string;
  vertex?: number;
  triangle?: number;
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function magnitude(value: Vec3) {
  return Math.hypot(...value);
}

export function validateGeometry(input: GeometryAsset) {
  const geometry = geometryAssetSchema.parse(input);
  const issues: GeometryValidationIssue[] = [];
  const referenced = new Set<number>();
  const jointCount = geometry.skeleton.length;
  for (const [index, value] of geometry.indices.entries()) {
    if (value >= geometry.positions.length)
      issues.push({
        code: 'index.out-of-range',
        message: `Index ${value} exceeds vertex count`,
        triangle: Math.floor(index / 3),
      });
    else referenced.add(value);
  }
  for (let index = 0; index < geometry.indices.length; index += 3) {
    const ia = geometry.indices[index];
    const ib = geometry.indices[index + 1];
    const ic = geometry.indices[index + 2];
    if (ia === undefined || ib === undefined || ic === undefined) continue;
    const a = geometry.positions[ia];
    const b = geometry.positions[ib];
    const c = geometry.positions[ic];
    if (!a || !b || !c) continue;
    if (magnitude(cross(subtract(b, a), subtract(c, a))) < 1e-10)
      issues.push({
        code: 'triangle.degenerate',
        message: 'Triangle has effectively zero area',
        triangle: index / 3,
      });
  }
  for (let vertex = 0; vertex < geometry.positions.length; vertex++) {
    if (!referenced.has(vertex))
      issues.push({
        code: 'vertex.unreferenced',
        message: 'Vertex is not used by any triangle',
        vertex,
      });
    const position = geometry.positions[vertex]!;
    if (Math.max(...position.map(Math.abs)) > 10_000)
      issues.push({
        code: 'bounds.extreme',
        message: 'Vertex exceeds the 10 km safety bound',
        vertex,
      });
    const weights = geometry.skinWeights?.[vertex];
    const indices = geometry.skinIndices?.[vertex];
    if (weights && Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) > 1e-5)
      issues.push({ code: 'skin.non-normalized', message: 'Skin weights must sum to one', vertex });
    if (indices)
      for (const boneIndex of indices)
        if (boneIndex >= jointCount)
          issues.push({
            code: 'skin.bone-out-of-range',
            message: `Bone index ${boneIndex} is invalid`,
            vertex,
          });
  }
  return {
    valid: issues.length === 0,
    issues,
    stats: {
      vertices: geometry.positions.length,
      triangles: geometry.indices.length / 3,
      joints: geometry.skeleton.length,
      skinned: Boolean(geometry.skinIndices),
      morphTargets: geometry.morphTargets.length,
    },
  };
}
