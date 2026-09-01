import { dirname, resolve } from 'node:path';
import { loadMotionClip } from '../motion/io.js';
import { sampleMotionTrack } from '../motion/model.js';
import { transformPoint } from '../interactions/transforms.js';
import type { CinematicScene } from './model.js';
import { verifyCameraPathClearance } from './camera-path.js';
import { loadGeometry } from '../geometry/io.js';
import {
  loadProductionRigProfile,
  verifyProductionRigProfileSkeleton,
} from '../characters/rig-profile.js';
import { loadProductionCharacterBinding } from '../characters/production-binding.js';
import { sha256File } from '../assets/library.js';

export interface CinematicQualityCheck {
  id: string;
  status: 'pass' | 'fail';
  message: string;
  measurements: Record<string, unknown>;
}

const axisIndex = { x: 0, y: 1, z: 2 } as const;
const magnitude = (value: [number, number, number]) => Math.hypot(...value);
const subtract = (a: [number, number, number], b: [number, number, number]) =>
  a.map((value, index) => value - b[index]!) as [number, number, number];
const dot = (a: [number, number, number], b: [number, number, number]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function worldVector(
  value: [number, number, number],
  transform: CinematicScene['entities'][number]['transform'],
) {
  return subtract(transformPoint(value, transform), transformPoint([0, 0, 0], transform));
}

export async function verifyCinematicScene(scene: CinematicScene, sceneFile: string) {
  const sourceDirectory = dirname(resolve(sceneFile));
  const checks: CinematicQualityCheck[] = [];
  for (const entity of scene.entities.filter(
    (candidate) => candidate.productionCharacterBindingPath,
  )) {
    const bindingPath = resolve(sourceDirectory, entity.productionCharacterBindingPath!);
    const binding = await loadProductionCharacterBinding(bindingPath);
    const geometryPath = resolve(sourceDirectory, entity.geometryPath);
    const geometry = await loadGeometry(geometryPath);
    const bodySha256 = await sha256File(geometryPath);
    const profilePath = entity.productionRigProfilePath
      ? resolve(sourceDirectory, entity.productionRigProfilePath)
      : undefined;
    const profileSha256 = profilePath ? await sha256File(profilePath) : undefined;
    const valid =
      entity.role === 'character' &&
      Boolean(entity.motion) &&
      binding.body.sha256 === bodySha256 &&
      binding.body.asset.id === geometry.id &&
      binding.rigProfile.sha256 === profileSha256 &&
      binding.compatibility.bodyTopology === geometry.metadata.topology;
    checks.push({
      id: `${entity.id}.production-character-binding`,
      status: valid ? 'pass' : 'fail',
      message: valid
        ? `Character '${entity.id}' has a complete content-addressed production assembly`
        : `Character '${entity.id}' has an invalid production assembly binding`,
      measurements: {
        bindingId: binding.id,
        character: binding.character,
        body: binding.body.asset,
        bodyHashMatched: binding.body.sha256 === bodySha256,
        bodyIdentityMatched: binding.body.asset.id === geometry.id,
        rigProfileHashMatched: binding.rigProfile.sha256 === profileSha256,
        topologyMatched: binding.compatibility.bodyTopology === geometry.metadata.topology,
        materialBindings: binding.materialBindings.length,
        hairBound: Boolean(binding.hair),
        wardrobeItems: binding.wardrobe.length,
        qualityTier: binding.qualityTier,
      },
    });
  }
  for (const entity of scene.entities.filter((candidate) => candidate.productionRigProfilePath)) {
    const profile = await loadProductionRigProfile(
      resolve(sourceDirectory, entity.productionRigProfilePath!),
    );
    const geometry = await loadGeometry(resolve(sourceDirectory, entity.geometryPath));
    const profileVerification = verifyProductionRigProfileSkeleton(profile, geometry.skeleton);
    const valid = entity.role === 'character' && Boolean(entity.motion) && profileVerification.valid;
    checks.push({
      id: `${entity.id}.production-rig-profile`,
      status: valid ? 'pass' : 'fail',
      message: valid
        ? `Character '${entity.id}' has a complete canonical-to-production rig binding`
        : `Entity '${entity.id}' has an invalid production rig binding`,
      measurements: {
        role: entity.role,
        motionBound: Boolean(entity.motion),
        profileId: profile.id,
        profileStatus: profile.status,
        ...profileVerification.checks,
        issues: profileVerification.issues,
      },
    });
  }
  for (const gate of scene.qualityGates) {
    if (gate.type === 'camera-path-clearance') {
      checks.push(await verifyCameraPathClearance(scene, sceneFile, gate));
      continue;
    }
    if (gate.type === 'mutual-facing') {
      const first = scene.entities.find((candidate) => candidate.id === gate.firstEntityId)!;
      const second = scene.entities.find((candidate) => candidate.id === gate.secondEntityId)!;
      const firstPosition = first.transform.position;
      const secondPosition = second.transform.position;
      const firstToSecond = subtract(secondPosition, firstPosition);
      const secondToFirst = subtract(firstPosition, secondPosition);
      const distance = magnitude(firstToSecond);
      const firstForward = worldVector([0, 0, -1], first.transform);
      const secondForward = worldVector([0, 0, -1], second.transform);
      const firstFacingDot =
        distance > 0 ? dot(firstToSecond, firstForward) / distance / magnitude(firstForward) : -1;
      const secondFacingDot =
        distance > 0 ? dot(secondToFirst, secondForward) / distance / magnitude(secondForward) : -1;
      const passed =
        distance > 0 &&
        firstFacingDot >= gate.minimumFacingDot &&
        secondFacingDot >= gate.minimumFacingDot;
      checks.push({
        id: gate.id,
        status: passed ? 'pass' : 'fail',
        message: passed
          ? `Entities '${first.id}' and '${second.id}' face one another`
          : `Entities '${first.id}' and '${second.id}' do not satisfy mutual-facing blocking`,
        measurements: {
          distanceMeters: distance,
          firstFacingDot,
          secondFacingDot,
          minimumFacingDot: gate.minimumFacingDot,
        },
      });
      continue;
    }
    const entity = scene.entities.find((candidate) => candidate.id === gate.entityId)!;
    if (!entity.motion) {
      checks.push({
        id: gate.id,
        status: 'fail',
        message: `Entity '${entity.id}' has no motion binding`,
        measurements: {},
      });
      continue;
    }
    const clip = await loadMotionClip(resolve(sourceDirectory, entity.motion.path));
    const root = clip.tracks.find(
      (track) => track.joint === 'root' && track.property === 'translation',
    );
    if (!root) {
      checks.push({
        id: gate.id,
        status: 'fail',
        message: `Entity '${entity.id}' motion has no root translation track`,
        measurements: {},
      });
      continue;
    }
    const sourceStart = entity.motion.sourceStartSeconds;
    const sourceEnd = entity.motion.sourceEndSeconds ?? clip.durationSeconds;
    const localStart = sampleMotionTrack(root, sourceStart);
    const localEnd = sampleMotionTrack(root, sourceEnd);
    const displacement = worldVector(subtract(localEnd, localStart), entity.transform);
    if (gate.type === 'directional-motion') {
      const distance = magnitude(displacement);
      const forward = worldVector([0, 0, -1], entity.transform);
      const forwardDot =
        distance > 0 ? dot(displacement, forward) / distance / magnitude(forward) : 0;
      const passed = distance >= gate.minimumDistanceMeters && forwardDot >= gate.minimumForwardDot;
      checks.push({
        id: gate.id,
        status: passed ? 'pass' : 'fail',
        message: passed
          ? `Entity '${entity.id}' moves with its facing direction`
          : `Entity '${entity.id}' moves backwards or too little for its facing direction`,
        measurements: {
          distanceMeters: distance,
          forwardDot,
          minimumDistanceMeters: gate.minimumDistanceMeters,
          minimumForwardDot: gate.minimumForwardDot,
        },
      });
    } else {
      const index = axisIndex[gate.axis];
      const origin = transformPoint([0, 0, 0], entity.transform)[index];
      const start = origin + worldVector(localStart, entity.transform)[index];
      const end = origin + worldVector(localEnd, entity.transform)[index];
      const clearance = gate.minimumClearanceMeters;
      const passed =
        gate.direction === 'negative-to-positive'
          ? start <= gate.boundary - clearance && end >= gate.boundary + clearance
          : start >= gate.boundary + clearance && end <= gate.boundary - clearance;
      checks.push({
        id: gate.id,
        status: passed ? 'pass' : 'fail',
        message: passed
          ? `Entity '${entity.id}' crosses the ${gate.axis.toUpperCase()} boundary in the required direction`
          : `Entity '${entity.id}' does not clear the required ${gate.axis.toUpperCase()} boundary`,
        measurements: {
          start,
          end,
          boundary: gate.boundary,
          clearanceMeters: clearance,
          direction: gate.direction,
        },
      });
    }
  }
  return {
    schemaVersion: 1 as const,
    status: checks.every((check) => check.status === 'pass')
      ? ('pass' as const)
      : ('fail' as const),
    checks,
  };
}
