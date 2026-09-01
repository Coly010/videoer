import { z } from 'zod';
import { lightingRigSchema, type LightingRig } from './model.js';

const vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const colorSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);

export const lightingRigAdaptationSchema = z.object({
  kind: z.literal('lighting-rig-transform-v1'),
  assetId: z.string().regex(/^lighting\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
  transform: z
    .object({
      translation: vec3Schema.default([0, 0, 0]),
      yawRadians: z
        .number()
        .finite()
        .min(-Math.PI * 2)
        .max(Math.PI * 2)
        .default(0),
      uniformScale: z.number().min(0.5).max(2).default(1),
    })
    .default({ translation: [0, 0, 0], yawRadians: 0, uniformScale: 1 }),
  energyScale: z.number().min(0.25).max(4).default(1),
  purposeEnergyScale: z
    .object({
      key: z.number().min(0.5).max(2).default(1),
      fill: z.number().min(0.5).max(2).default(1),
      rim: z.number().min(0.5).max(2).default(1),
      practical: z.number().min(0.5).max(2).default(1),
      environment: z.number().min(0.5).max(2).default(1),
    })
    .default({ key: 1, fill: 1, rim: 1, practical: 1, environment: 1 }),
  colorMultiply: z
    .tuple([z.number().min(0.25).max(2), z.number().min(0.25).max(2), z.number().min(0.25).max(2)])
    .default([1, 1, 1]),
  worldColor: colorSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type LightingRigAdaptation = z.infer<typeof lightingRigAdaptationSchema>;

function transformPoint(
  point: [number, number, number],
  transform: LightingRigAdaptation['transform'],
): [number, number, number] {
  const scaledX = point[0] * transform.uniformScale;
  const scaledZ = point[2] * transform.uniformScale;
  const cosine = Math.cos(transform.yawRadians);
  const sine = Math.sin(transform.yawRadians);
  return [
    scaledX * cosine + scaledZ * sine + transform.translation[0],
    point[1] * transform.uniformScale + transform.translation[1],
    -scaledX * sine + scaledZ * cosine + transform.translation[2],
  ];
}

function colorMultiply(
  color: [number, number, number],
  multiplier: [number, number, number],
): [number, number, number] {
  return color.map((value, index) => Math.min(1, value * multiplier[index]!)) as [
    number,
    number,
    number,
  ];
}

export function adaptLightingRig(base: LightingRig, input: LightingRigAdaptation) {
  const adaptation = lightingRigAdaptationSchema.parse(input);
  return lightingRigSchema.parse({
    ...structuredClone(base),
    id: adaptation.assetId,
    worldColor: adaptation.worldColor ?? colorMultiply(base.worldColor, adaptation.colorMultiply),
    lights: base.lights.map((light) => ({
      ...light,
      position: transformPoint(light.position, adaptation.transform),
      ...(light.target ? { target: transformPoint(light.target, adaptation.transform) } : {}),
      color: colorMultiply(light.color, adaptation.colorMultiply),
      energy: light.energy * adaptation.energyScale * adaptation.purposeEnergyScale[light.purpose],
      sizeMeters: light.sizeMeters * adaptation.transform.uniformScale,
    })),
    metadata: {
      ...base.metadata,
      ...adaptation.metadata,
      derivedFrom: base.id,
      lightingAdaptation: adaptation.kind,
    },
  });
}

function distance(first: number[], second: number[]) {
  return Math.hypot(...first.map((value, index) => value - second[index]!));
}

export function verifyLightingRigAdaptation(
  base: LightingRig,
  adapted: LightingRig,
  input: LightingRigAdaptation,
) {
  const adaptation = lightingRigAdaptationSchema.parse(input);
  const expected = adaptLightingRig(base, adaptation);
  const issues: string[] = [];
  const topologyPreserved =
    base.lights.length === adapted.lights.length &&
    base.lights.every((light, index) => {
      const candidate = adapted.lights[index];
      return (
        candidate?.id === light.id &&
        candidate.type === light.type &&
        candidate.purpose === light.purpose
      );
    });
  if (!topologyPreserved) issues.push('lighting identity, type, purpose, or order changed');
  const exposurePreserved =
    adapted.exposure.look === base.exposure.look &&
    adapted.exposure.coherentAcrossShots === base.exposure.coherentAcrossShots;
  if (!exposurePreserved) issues.push('lighting exposure contract changed');
  const spatialTransformMatched = adapted.lights.every((light, index) => {
    const candidate = expected.lights[index];
    if (!candidate || distance(light.position, candidate.position) > 1e-8) return false;
    if (Boolean(light.target) !== Boolean(candidate.target)) return false;
    return !light.target || distance(light.target, candidate.target!) <= 1e-8;
  });
  if (!spatialTransformMatched) issues.push('lighting positions or targets do not match transform');
  const energyTransformMatched = adapted.lights.every(
    (light, index) => Math.abs(light.energy - expected.lights[index]!.energy) <= 1e-8,
  );
  if (!energyTransformMatched) issues.push('lighting energy does not match bounded scaling');
  const colorTransformMatched =
    distance(adapted.worldColor, expected.worldColor) <= 1e-8 &&
    adapted.lights.every(
      (light, index) => distance(light.color, expected.lights[index]!.color) <= 1e-8,
    );
  if (!colorTransformMatched) issues.push('lighting color does not match bounded treatment');
  const sizeTransformMatched = adapted.lights.every(
    (light, index) => Math.abs(light.sizeMeters - expected.lights[index]!.sizeMeters) <= 1e-8,
  );
  if (!sizeTransformMatched) issues.push('lighting emitter size does not match spatial scale');
  const roleCoverage = Object.fromEntries(
    ['key', 'fill', 'rim', 'practical', 'environment'].map((purpose) => [
      purpose,
      adapted.lights.filter((light) => light.purpose === purpose).length,
    ]),
  );
  const nonBlackWorld = adapted.worldColor.some((channel) => channel > 0);
  if (!nonBlackWorld) issues.push('lighting world color is fully black');
  return {
    valid: issues.length === 0,
    issues,
    adaptation,
    topologyPreserved,
    exposurePreserved,
    spatialTransformMatched,
    energyTransformMatched,
    colorTransformMatched,
    sizeTransformMatched,
    nonBlackWorld,
    roleCoverage,
    baseLightCount: base.lights.length,
    adaptedLightCount: adapted.lights.length,
    energyRange: {
      minimum: Math.min(...adapted.lights.map((light) => light.energy)),
      maximum: Math.max(...adapted.lights.map((light) => light.energy)),
    },
  };
}
