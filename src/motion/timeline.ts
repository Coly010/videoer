import type { Vec3 } from '../geometry/model.js';
import { composePoseLayers, type MotionPose, type PoseLayer } from './composition.js';
import {
  createQuinticMotionKeyframes,
  motionClipSchema,
  sampleMorphTrack,
  sampleMotionTrack,
  type MotionClip,
} from './model.js';

export interface MotionTimelineLayer {
  id: string;
  clip: MotionClip;
  mode: PoseLayer['mode'];
  startSeconds: number;
  endSeconds: number;
  playback: 'once' | 'loop' | 'hold';
  sourceStartSeconds?: number;
  sourceEndSeconds?: number;
  weight?: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  joints?: string[];
  morphTargets?: string[];
  minimumContribution?: number;
}

export interface MotionTimelineDefinition {
  id: string;
  skeleton: string;
  durationSeconds: number;
  fps: number;
  layers: MotionTimelineLayer[];
  metadata?: Record<string, unknown>;
}

export interface MotionTimelineVerification {
  valid: boolean;
  issues: string[];
  checks: {
    frameCount: number;
    expectedSamplesPerTrack: number;
    baseCoverageComplete: boolean;
    nonBaseLayersMasked: boolean;
    finiteSamples: boolean;
    exactFrameGrid: boolean;
    metadataLineageComplete: boolean;
    layerContributions: Record<string, number>;
  };
}

const add = (a: Vec3, b: Vec3): Vec3 => a.map((value, index) => value + b[index]!) as Vec3;
const scale = (value: Vec3, amount: number): Vec3 => value.map((item) => item * amount) as Vec3;

function layerWeight(layer: MotionTimelineLayer, seconds: number) {
  if (seconds < layer.startSeconds || seconds > layer.endSeconds) return 0;
  let weight = layer.weight ?? 1;
  const elapsed = seconds - layer.startSeconds;
  const remaining = layer.endSeconds - seconds;
  if (layer.fadeInSeconds && elapsed < layer.fadeInSeconds) weight *= elapsed / layer.fadeInSeconds;
  if (layer.fadeOutSeconds && remaining < layer.fadeOutSeconds)
    weight *= remaining / layer.fadeOutSeconds;
  return Math.max(0, Math.min(1, weight));
}

function sampleLayer(layer: MotionTimelineLayer, seconds: number): MotionPose {
  const clip = motionClipSchema.parse(layer.clip);
  const sourceStart = layer.sourceStartSeconds ?? 0;
  const sourceEnd = layer.sourceEndSeconds ?? clip.durationSeconds;
  const sourceDuration = sourceEnd - sourceStart;
  const elapsed = Math.max(0, seconds - layer.startSeconds);
  let sourceTime = sourceStart;
  let completedCycles = 0;
  if (layer.playback === 'once') {
    const progress = Math.min(1, elapsed / (layer.endSeconds - layer.startSeconds));
    sourceTime = sourceStart + sourceDuration * progress;
  } else if (layer.playback === 'loop') {
    completedCycles = Math.floor(elapsed / sourceDuration);
    sourceTime = sourceStart + (elapsed % sourceDuration);
    if (seconds === layer.endSeconds && elapsed % sourceDuration === 0) {
      completedCycles = Math.max(0, completedCycles - 1);
      sourceTime = sourceEnd;
    }
  }
  const pose: MotionPose = {};
  for (const track of clip.tracks) {
    let value = sampleMotionTrack(track, sourceTime);
    if (
      layer.playback === 'loop' &&
      completedCycles > 0 &&
      track.joint === 'root' &&
      track.property === 'translation'
    ) {
      const cycleDelta = add(
        sampleMotionTrack(track, sourceEnd),
        scale(sampleMotionTrack(track, sourceStart), -1),
      );
      value = add(value, scale(cycleDelta, completedCycles));
    }
    const joint = (pose[track.joint] ??= {});
    if (track.property === 'rotation-euler') joint.rotation = value;
    else joint.translation = value;
  }
  return pose;
}

function sampleLayerMorphs(layer: MotionTimelineLayer, seconds: number) {
  const clip = motionClipSchema.parse(layer.clip);
  const sourceStart = layer.sourceStartSeconds ?? 0;
  const sourceEnd = layer.sourceEndSeconds ?? clip.durationSeconds;
  const sourceDuration = sourceEnd - sourceStart;
  const elapsed = Math.max(0, seconds - layer.startSeconds);
  let sourceTime = sourceStart;
  if (layer.playback === 'once')
    sourceTime =
      sourceStart + sourceDuration * Math.min(1, elapsed / (layer.endSeconds - layer.startSeconds));
  else if (layer.playback === 'loop') {
    sourceTime = sourceStart + (elapsed % sourceDuration);
    if (seconds === layer.endSeconds && elapsed % sourceDuration === 0) sourceTime = sourceEnd;
  }
  return Object.fromEntries(
    clip.morphTracks
      .filter((track) => !layer.morphTargets || layer.morphTargets.includes(track.target))
      .map((track) => [track.target, sampleMorphTrack(track, sourceTime)]),
  );
}

function composeMorphLayers(
  layers: Array<{
    mode: MotionTimelineLayer['mode'];
    weight: number;
    values: Record<string, number>;
  }>,
) {
  const output: Record<string, number> = {};
  for (const layer of layers)
    for (const [target, value] of Object.entries(layer.values)) {
      const current = output[target] ?? 0;
      if (layer.mode === 'additive') output[target] = Math.min(1, current + value * layer.weight);
      else output[target] = current * (1 - layer.weight) + value * layer.weight;
    }
  return output;
}

export function composeMotionTimeline(definition: MotionTimelineDefinition) {
  if (
    Math.abs(
      definition.durationSeconds * definition.fps -
        Math.round(definition.durationSeconds * definition.fps),
    ) > 1e-8
  )
    throw new Error('Motion timeline duration must resolve to a whole number of frames');
  if (definition.layers.length === 0)
    throw new Error('Motion timeline requires at least one layer');
  for (const layer of definition.layers) {
    if (layer.clip.skeleton !== definition.skeleton)
      throw new Error(
        `Motion layer '${layer.id}' uses incompatible skeleton '${layer.clip.skeleton}'`,
      );
    if (layer.startSeconds < 0 || layer.endSeconds <= layer.startSeconds)
      throw new Error(`Motion layer '${layer.id}' has an invalid scene interval`);
    if (layer.endSeconds > definition.durationSeconds)
      throw new Error(`Motion layer '${layer.id}' exceeds the timeline duration`);
    const sourceStart = layer.sourceStartSeconds ?? 0;
    const sourceEnd = layer.sourceEndSeconds ?? layer.clip.durationSeconds;
    if (sourceStart < 0 || sourceEnd <= sourceStart || sourceEnd > layer.clip.durationSeconds)
      throw new Error(`Motion layer '${layer.id}' has an invalid source interval`);
  }
  const properties = new Map<
    string,
    { joint: string; property: 'rotation-euler' | 'translation' }
  >();
  for (const layer of definition.layers)
    for (const track of layer.clip.tracks)
      if (!layer.joints || layer.joints.includes(track.joint))
        properties.set(`${track.joint}:${track.property}`, {
          joint: track.joint,
          property: track.property,
        });
  const morphTargets = new Set<string>();
  for (const layer of definition.layers)
    for (const track of layer.clip.morphTracks)
      if (!layer.morphTargets || layer.morphTargets.includes(track.target))
        morphTargets.add(track.target);
  const frameCount = Math.round(definition.durationSeconds * definition.fps);
  const samples = Array.from({ length: frameCount + 1 }, (_, frame) => {
    const seconds = frame / definition.fps;
    const layers = definition.layers
      .map((layer) => ({
        id: layer.id,
        mode: layer.mode,
        weight: layerWeight(layer, seconds),
        ...(layer.joints ? { joints: layer.joints } : {}),
        ...(layer.minimumContribution !== undefined
          ? { minimumContribution: layer.minimumContribution }
          : {}),
        pose: sampleLayer(layer, seconds),
      }))
      .filter((layer) => layer.weight > 0);
    const morphs = composeMorphLayers(
      definition.layers
        .map((layer) => ({
          mode: layer.mode,
          weight: layerWeight(layer, seconds),
          values: sampleLayerMorphs(layer, seconds),
        }))
        .filter((layer) => layer.weight > 0),
    );
    return { seconds, pose: composePoseLayers(layers), morphs };
  });
  return motionClipSchema.parse({
    schemaVersion: 1,
    id: definition.id,
    skeleton: definition.skeleton,
    durationSeconds: definition.durationSeconds,
    loop: false,
    tracks: [...properties.values()].map(({ joint, property }) => ({
      joint,
      property,
      space: 'local-delta' as const,
      interpolation: 'quintic-hermite' as const,
      keyframes: createQuinticMotionKeyframes(
        samples.map(({ pose }) =>
          property === 'rotation-euler'
            ? (pose[joint]?.rotation ?? [0, 0, 0])
            : (pose[joint]?.translation ?? [0, 0, 0]),
        ),
        definition.durationSeconds,
        false,
      ),
    })),
    morphTracks: [...morphTargets].map((target) => ({
      target,
      property: 'weight' as const,
      keyframes: samples.map(({ seconds, morphs }) => ({
        time: seconds,
        value: morphs[target] ?? 0,
        easing: 'linear' as const,
      })),
    })),
    metadata: {
      generator: 'videoer.motion-timeline.v1',
      layers: definition.layers.map((layer) => ({
        id: layer.id,
        clip: layer.clip.id,
        mode: layer.mode,
        playback: layer.playback,
        startSeconds: layer.startSeconds,
        endSeconds: layer.endSeconds,
        weight: layer.weight ?? 1,
        ...(layer.joints ? { joints: layer.joints } : {}),
        ...(layer.morphTargets ? { morphTargets: layer.morphTargets } : {}),
      })),
      ...definition.metadata,
    },
  });
}

export function verifyMotionTimelineComposition(
  definition: MotionTimelineDefinition,
  output: MotionClip,
  options: { requireMaskedNonBase?: boolean } = {},
): MotionTimelineVerification {
  const issues: string[] = [];
  const frameCount = Math.round(definition.durationSeconds * definition.fps);
  const expectedSamplesPerTrack = frameCount + 1;
  const baseCoverageComplete = Array.from({ length: expectedSamplesPerTrack }, (_, frame) => {
    const seconds = frame / definition.fps;
    return definition.layers.some(
      (layer) =>
        layer.mode === 'base' &&
        seconds >= layer.startSeconds &&
        seconds <= layer.endSeconds &&
        layerWeight(layer, seconds) > 0,
    );
  }).every(Boolean);
  if (!baseCoverageComplete) issues.push('base motion does not cover every output frame');
  const nonBaseLayersMasked = definition.layers
    .filter((layer) => layer.mode !== 'base')
    .every((layer) => Boolean(layer.joints?.length || layer.morphTargets?.length));
  if (options.requireMaskedNonBase && !nonBaseLayersMasked)
    issues.push('every non-base layer requires an explicit joint mask');
  const finiteSamples =
    output.tracks.every((track) =>
      track.keyframes.every(
        (keyframe) =>
          Number.isFinite(keyframe.time) && keyframe.value.every((value) => Number.isFinite(value)),
      ),
    ) &&
    output.morphTracks.every((track) =>
      track.keyframes.every(
        (keyframe) => Number.isFinite(keyframe.time) && Number.isFinite(keyframe.value),
      ),
    );
  if (!finiteSamples) issues.push('output contains a non-finite motion sample');
  const exactFrameGrid = [...output.tracks, ...output.morphTracks].every(
    (track) =>
      track.keyframes.length === expectedSamplesPerTrack &&
      track.keyframes.every(
        (keyframe, frame) => Math.abs(keyframe.time - frame / definition.fps) <= 1e-8,
      ),
  );
  if (!exactFrameGrid) issues.push('output tracks do not preserve the exact timeline frame grid');
  const metadataLayers = Array.isArray(output.metadata.layers) ? output.metadata.layers : [];
  const metadataLineageComplete =
    output.metadata.generator === 'videoer.motion-timeline.v1' &&
    definition.layers.every((layer) =>
      metadataLayers.some(
        (candidate) =>
          typeof candidate === 'object' &&
          candidate !== null &&
          'id' in candidate &&
          candidate.id === layer.id &&
          'clip' in candidate &&
          candidate.clip === layer.clip.id,
      ),
    );
  if (!metadataLineageComplete) issues.push('output metadata omits declared layer lineage');
  const layerContributions: Record<string, number> = {};
  for (const layer of definition.layers.filter((candidate) => candidate.mode !== 'base')) {
    const baseline = composeMotionTimeline({
      ...definition,
      layers: definition.layers.filter((candidate) => candidate.id !== layer.id),
    });
    let maximum = 0;
    for (const track of output.tracks) {
      if (layer.joints && !layer.joints.includes(track.joint)) continue;
      const baselineTrack = baseline.tracks.find(
        (candidate) => candidate.joint === track.joint && candidate.property === track.property,
      );
      for (const [frame, keyframe] of track.keyframes.entries()) {
        const baselineValue = baselineTrack?.keyframes[frame]?.value ?? [0, 0, 0];
        const distance = Math.hypot(
          ...keyframe.value.map((value, axis) => value - baselineValue[axis]!),
        );
        maximum = Math.max(maximum, distance);
      }
    }
    for (const track of output.morphTracks) {
      if (layer.morphTargets && !layer.morphTargets.includes(track.target)) continue;
      const baselineTrack = baseline.morphTracks.find(
        (candidate) => candidate.target === track.target,
      );
      for (const [frame, keyframe] of track.keyframes.entries())
        maximum = Math.max(
          maximum,
          Math.abs(keyframe.value - (baselineTrack?.keyframes[frame]?.value ?? 0)),
        );
    }
    layerContributions[layer.id] = maximum;
    if (layer.minimumContribution !== undefined && maximum + 1e-8 < layer.minimumContribution)
      issues.push(`layer '${layer.id}' contributes ${maximum}, below ${layer.minimumContribution}`);
  }
  if (output.skeleton !== definition.skeleton)
    issues.push(`output skeleton '${output.skeleton}' differs from '${definition.skeleton}'`);
  if (Math.abs(output.durationSeconds - definition.durationSeconds) > 1e-8)
    issues.push('output duration differs from the timeline duration');
  return {
    valid: issues.length === 0,
    issues,
    checks: {
      frameCount,
      expectedSamplesPerTrack,
      baseCoverageComplete,
      nonBaseLayersMasked,
      finiteSamples,
      exactFrameGrid,
      metadataLineageComplete,
      layerContributions,
    },
  };
}
