import type { Vec3 } from '../geometry/model.js';

export interface JointPose {
  rotation?: Vec3;
  translation?: Vec3;
}

export type MotionPose = Record<string, JointPose>;

export interface PoseLayer {
  id: string;
  mode: 'base' | 'additive' | 'override';
  weight: number;
  joints?: string[];
  pose: MotionPose;
}

const mix = (a: Vec3, b: Vec3, amount: number): Vec3 =>
  a.map((value, index) => value + (b[index]! - value) * amount) as Vec3;
const add = (a: Vec3, b: Vec3, weight: number): Vec3 =>
  a.map((value, index) => value + b[index]! * weight) as Vec3;

export function composePoseLayers(layers: PoseLayer[]): MotionPose {
  const output: MotionPose = {};
  for (const layer of layers) {
    const weight = Math.max(0, Math.min(1, layer.weight));
    for (const [joint, incoming] of Object.entries(layer.pose)) {
      if (layer.joints && !layer.joints.includes(joint)) continue;
      const current = output[joint] ?? {};
      const combine = (property: 'rotation' | 'translation') => {
        const value = incoming[property];
        if (!value) return;
        const existing = current[property] ?? [0, 0, 0];
        current[property] =
          layer.mode === 'additive' ? add(existing, value, weight) : mix(existing, value, weight);
      };
      combine('rotation');
      combine('translation');
      output[joint] = current;
    }
  }
  return output;
}
