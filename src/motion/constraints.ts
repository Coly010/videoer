import type { Vec3 } from '../geometry/model.js';

export interface ContactObservation {
  contactId: string;
  phase: number;
  active: boolean;
  position: Vec3;
  target: Vec3;
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function evaluatePointContacts(observations: ContactObservation[]) {
  const active = observations.filter((observation) => observation.active);
  const inactive = observations.filter((observation) => !observation.active);
  const errors = active.map((observation) => distance(observation.position, observation.target));
  const worst = active
    .map((observation, index) => ({ observation, errorMeters: errors[index]! }))
    .sort((left, right) => right.errorMeters - left.errorMeters)[0];
  return {
    valid: active.length > 0 && Math.max(...errors) <= 0.01,
    samples: observations.length,
    activeSamples: active.length,
    maxContactErrorMeters: active.length ? Math.max(...errors) : Number.POSITIVE_INFINITY,
    meanContactErrorMeters: active.length
      ? errors.reduce((sum, value) => sum + value, 0) / errors.length
      : Number.POSITIVE_INFINITY,
    worstContact: worst
      ? {
          contactId: worst.observation.contactId,
          phase: worst.observation.phase,
          position: worst.observation.position,
          target: worst.observation.target,
          errorMeters: worst.errorMeters,
        }
      : null,
    minimumInactiveClearanceMeters: inactive.length
      ? Math.min(...inactive.map((observation) => observation.position[1] - observation.target[1]))
      : null,
  };
}

export function evaluateJointLimits(
  samples: Array<{ joint: string; rotation: Vec3 }>,
  limits: Record<string, { minimum: Vec3; maximum: Vec3 }>,
) {
  const violations: Array<{ joint: string; axis: number; value: number }> = [];
  for (const sample of samples) {
    const limit = limits[sample.joint];
    if (!limit) continue;
    sample.rotation.forEach((value, axis) => {
      if (value < limit.minimum[axis]! || value > limit.maximum[axis]!)
        violations.push({ joint: sample.joint, axis, value });
    });
  }
  return { valid: violations.length === 0, violations };
}
