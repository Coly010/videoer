import type { Vec3 } from '../geometry/model.js';
import { sampleCinematicCamera } from './camera-path.js';
import type { CinematicScene } from './model.js';

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const magnitude = (value: Vec3) => Math.hypot(...value);

function isFramingGate(type: CinematicScene['renderGates'][number]['type']) {
  return [
    'subject-framing',
    'subject-coverage',
    'entity-set-coverage',
    'entity-set-frame-presence',
  ].includes(type);
}

/**
 * Verifies an authored shot brief against the executable camera sampler.
 *
 * Framing is intentionally proved by existing renderer image gates rather
 * than guessed from a camera-to-target distance; this keeps the editorial
 * grammar portable across character, product, and architectural shots.
 */
export function verifyCinematicShotIntent(
  scene: CinematicScene,
  gate: Extract<CinematicScene['qualityGates'][number], { type: 'camera-shot-intent' }>,
) {
  const intent = scene.camera.intent;
  if (!intent || intent.id !== gate.intentId)
    return {
      id: gate.id,
      status: 'fail' as const,
      message: 'Camera shot-intent gate does not resolve an authored camera intent',
      measurements: { intentId: gate.intentId },
    };

  const samples = Array.from({ length: intent.sampleCount }, (_, index) => {
    const timeSeconds = (scene.durationSeconds * index) / (intent.sampleCount - 1);
    return { timeSeconds, camera: sampleCinematicCamera(scene, timeSeconds) };
  });
  const speeds = samples
    .slice(1)
    .map(
      (sample, index) =>
        magnitude(subtract(sample.camera.position, samples[index]!.camera.position)) /
        (sample.timeSeconds - samples[index]!.timeSeconds),
    );
  const accelerations = speeds
    .slice(1)
    .map(
      (speed, index) =>
        Math.abs(speed - speeds[index]!) /
        (samples[index + 2]!.timeSeconds - samples[index + 1]!.timeSeconds),
    );
  const first = samples[0]!.camera;
  const last = samples.at(-1)!.camera;
  const displacement = subtract(last.position, first.position);
  const progressMeters = magnitude(displacement);
  const startTargetDistance = magnitude(subtract(first.target, first.position));
  const endTargetDistance = magnitude(subtract(last.target, last.position));
  const maximumSpeedMetersPerSecond = Math.max(0, ...speeds);
  const minimumSpeedMetersPerSecond = Math.min(...speeds);
  const maximumAccelerationMetersPerSecondSquared = Math.max(0, ...accelerations);
  const framingGateIds = intent.framingGateIds.filter((id) =>
    scene.renderGates.some((candidate) => candidate.id === id && isFramingGate(candidate.type)),
  );

  const directionPasses = (() => {
    const tolerance = intent.distanceToleranceMeters;
    if (intent.movement === 'locked-off') return progressMeters <= tolerance;
    if (intent.movement === 'push-in')
      return startTargetDistance - endTargetDistance >= intent.minimumProgressMeters - tolerance;
    if (intent.movement === 'pull-back')
      return endTargetDistance - startTargetDistance >= intent.minimumProgressMeters - tolerance;
    if (intent.movement === 'lateral-move')
      return (
        Math.hypot(displacement[0], displacement[2]) >= intent.minimumProgressMeters &&
        Math.hypot(displacement[0], displacement[2]) > Math.abs(displacement[1])
      );
    if (intent.movement === 'rising-move') return displacement[1] >= intent.minimumProgressMeters;
    if (intent.movement === 'falling-move') return -displacement[1] >= intent.minimumProgressMeters;
    return progressMeters >= intent.minimumProgressMeters;
  })();
  const passed =
    framingGateIds.length === intent.framingGateIds.length &&
    directionPasses &&
    minimumSpeedMetersPerSecond >= intent.minimumSpeedMetersPerSecond &&
    maximumSpeedMetersPerSecond <= intent.maximumSpeedMetersPerSecond &&
    maximumAccelerationMetersPerSecondSquared <= intent.maximumAccelerationMetersPerSecondSquared;
  return {
    id: gate.id,
    status: passed ? ('pass' as const) : ('fail' as const),
    message: passed
      ? 'Camera path satisfies its typed shot intent, motion envelope, and framing evidence contract'
      : 'Camera path does not satisfy its typed shot intent, motion envelope, or framing evidence contract',
    measurements: {
      intentId: intent.id,
      purpose: intent.purpose,
      movement: intent.movement,
      sampleCount: intent.sampleCount,
      framingGateIds,
      requestedFramingGateIds: intent.framingGateIds,
      progressMeters,
      startTargetDistanceMeters: startTargetDistance,
      endTargetDistanceMeters: endTargetDistance,
      minimumSpeedMetersPerSecond,
      maximumSpeedMetersPerSecond,
      requiredMinimumSpeedMetersPerSecond: intent.minimumSpeedMetersPerSecond,
      requiredMaximumSpeedMetersPerSecond: intent.maximumSpeedMetersPerSecond,
      maximumAccelerationMetersPerSecondSquared,
      requiredMaximumAccelerationMetersPerSecondSquared:
        intent.maximumAccelerationMetersPerSecondSquared,
      directionPasses,
    },
  };
}
