import { z } from 'zod';
import type { GeometryAsset, Vec3 } from '../geometry/model.js';
import { resolveAttachment } from '../interactions/transforms.js';
import { cinematicSceneSchema, type CinematicScene } from './model.js';

export type SpatialPointReference =
  Vec3 | { entityId: string; attachmentId: string; offset?: Vec3 };

export interface CameraTemplateKeyframe {
  time: number;
  position: SpatialPointReference;
  target: SpatialPointReference;
  lensMillimeters: number;
  easing?: 'linear' | 'ease-in-out';
}

type SceneInput = z.input<typeof cinematicSceneSchema>;

export type CinematicShotTemplate = Omit<SceneInput, 'camera'> & {
  camera: { keyframes: CameraTemplateKeyframe[] };
};

export interface CinematicAssemblyContext {
  geometryByEntity: Record<string, GeometryAsset>;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export function resolveSpatialPoint(
  reference: SpatialPointReference,
  scene: Pick<CinematicShotTemplate, 'entities'>,
  context: CinematicAssemblyContext,
): Vec3 {
  if (Array.isArray(reference)) return reference;
  const entity = scene.entities.find((candidate) => candidate.id === reference.entityId);
  if (!entity) throw new Error(`Spatial reference uses unknown entity '${reference.entityId}'`);
  const geometry = context.geometryByEntity[reference.entityId];
  if (!geometry)
    throw new Error(`Spatial reference has no geometry catalog for '${reference.entityId}'`);
  const transform = {
    position: entity.transform?.position ?? ([0, 0, 0] as Vec3),
    rotation: entity.transform?.rotation ?? ([0, 0, 0] as Vec3),
    scale: entity.transform?.scale ?? ([1, 1, 1] as Vec3),
  };
  const resolved = resolveAttachment(geometry, reference.attachmentId, transform);
  return add(resolved.position, reference.offset ?? [0, 0, 0]);
}

/** Resolves asset-owned spatial semantics into a portable renderer-independent scene. */
export function assembleCinematicShot(
  template: CinematicShotTemplate,
  context: CinematicAssemblyContext,
): CinematicScene {
  return cinematicSceneSchema.parse({
    ...template,
    camera: {
      keyframes: template.camera.keyframes.map((keyframe) => ({
        ...keyframe,
        position: resolveSpatialPoint(keyframe.position, template, context),
        target: resolveSpatialPoint(keyframe.target, template, context),
      })),
    },
  });
}

export interface ProductRevealTemplateInput {
  id: string;
  durationSeconds: number;
  fps: number;
  resolution: SceneInput['resolution'];
  product: SceneInput['entities'][number];
  geometry: GeometryAsset;
  cameraAnchor: string;
  targetAnchor: string;
  cameraEndOffset?: Vec3;
  cameraStartLensMillimeters?: number;
  cameraEndLensMillimeters?: number;
  lights: SceneInput['lights'];
  atmosphere?: SceneInput['atmosphere'];
  landmarks: SceneInput['landmarks'];
  metadata?: Record<string, unknown>;
}

/** Reusable dimensional-product ending, independent of book, campaign, and coordinates. */
export function createProductRevealShot(input: ProductRevealTemplateInput): CinematicScene {
  const durationSeconds = input.durationSeconds;
  return assembleCinematicShot(
    {
      schemaVersion: 1,
      id: input.id,
      durationSeconds,
      fps: input.fps,
      resolution: input.resolution,
      entities: [input.product],
      camera: {
        keyframes: [
          {
            time: 0,
            position: { entityId: input.product.id, attachmentId: input.cameraAnchor },
            target: { entityId: input.product.id, attachmentId: input.targetAnchor },
            lensMillimeters: input.cameraStartLensMillimeters ?? 58,
          },
          {
            time: durationSeconds,
            position: {
              entityId: input.product.id,
              attachmentId: input.cameraAnchor,
              offset: input.cameraEndOffset ?? [0, 0, 0.25],
            },
            target: { entityId: input.product.id, attachmentId: input.targetAnchor },
            lensMillimeters: input.cameraEndLensMillimeters ?? 64,
          },
        ],
      },
      lights: input.lights,
      atmosphere: input.atmosphere,
      landmarks: input.landmarks,
      metadata: { template: 'product-reveal', ...input.metadata },
    },
    { geometryByEntity: { [input.product.id]: input.geometry } },
  );
}
