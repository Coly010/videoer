import { resolve } from 'node:path';
import { verifyWalkingExtremityDeformation } from '../characters/deformation.js';
import { loadGeometry } from '../geometry/io.js';
import { renderMotionProbe } from '../motion/blender.js';
import { verifyCharacterMotionAlignment } from '../motion/character-verification.js';
import { verifyCharacterGrounding } from '../motion/grounding.js';
import { loadMotionClip, saveMotionClip } from '../motion/io.js';
import { validateMotionClip } from '../motion/model.js';
import { createWalkStyleMotion, verifyCasualWalkMotion } from '../motion/walk.js';
import type { GaitStyle } from '../motion/gait.js';

/**
 * @deprecated Retired as a production path by ADR 074. Human motion is authored on
 * the Rigify rig (see `scripts/blender/render_cc0_rigify_action_reel.py`), not this
 * procedural gait targeting the retired canonical skeleton. Kept for existing tests
 * and the benchmark until a migration removes or repoints it.
 */
export async function createWalkMotion(path: string, style: GaitStyle['id'] = 'neutral') {
  const clip = createWalkStyleMotion(style);
  const output = await saveMotionClip(path, clip);
  return {
    output,
    clip,
    validation: validateMotionClip(clip),
    biomechanics: verifyCasualWalkMotion(clip),
  };
}

export async function validateMotionFile(path: string, geometryFile?: string) {
  const [motion, geometry] = await Promise.all([
    loadMotionClip(path),
    geometryFile ? loadGeometry(geometryFile) : undefined,
  ]);
  return validateMotionClip(motion, geometry);
}

export async function createWalkProbe(
  geometryFile: string,
  motionFile: string,
  outputDirectory: string,
) {
  const [validation, motion, geometry] = await Promise.all([
    validateMotionFile(motionFile, geometryFile),
    loadMotionClip(motionFile),
    loadGeometry(geometryFile),
  ]);
  if (!validation.valid)
    throw new Error(
      `Motion cannot be rendered: ${validation.issues.map((issue) => issue.message).join('; ')}`,
    );
  const usesFinalMeshGrounding = Boolean(motion.metadata.characterGrounding);
  const biomechanics = verifyCasualWalkMotion(motion, {
    verifyProxyGrounding: !usesFinalMeshGrounding,
  });
  if (!biomechanics.valid)
    throw new Error(`Motion failed biomechanical gates: ${biomechanics.issues.join('; ')}`);
  const finalCharacter = usesFinalMeshGrounding
    ? {
        grounding: verifyCharacterGrounding(geometry, motion),
        alignment: verifyCharacterMotionAlignment(geometry, motion),
        deformation: verifyWalkingExtremityDeformation(geometry, motion),
      }
    : undefined;
  const failedFinalChecks = finalCharacter
    ? Object.entries(finalCharacter)
        .filter(([, report]) => !report.valid)
        .flatMap(([id, report]) => report.issues.map((issue) => `${id}: ${issue}`))
    : [];
  if (failedFinalChecks.length)
    throw new Error(`Final character motion failed: ${failedFinalChecks.join('; ')}`);
  const qualityGates = { biomechanics, ...(finalCharacter ? { finalCharacter } : {}) };
  const probe = await renderMotionProbe(geometryFile, motionFile, outputDirectory, qualityGates);
  return {
    validation,
    biomechanics,
    ...(finalCharacter ? { finalCharacter } : {}),
    ...probe,
    output: resolve(outputDirectory),
  };
}
