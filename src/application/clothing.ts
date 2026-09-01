import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderGeometryProbe } from '../geometry/blender.js';
import { extractMaterialGeometry } from '../geometry/extract.js';
import { loadGeometry, saveGeometry } from '../geometry/io.js';
import { validateGeometry } from '../geometry/model.js';
import { humanoidParametersSchema } from '../characters/mannequin.js';
import { bakePoseSpaceClothCorrectives, verifyTemporalClothing } from '../clothing/temporal.js';
import { renderMotionProbe } from '../motion/blender.js';
import { saveMotionClip } from '../motion/io.js';
import { createWalkStyleMotion, verifyCasualWalkMotion } from '../motion/walk.js';

export async function createDarkDressAsset(
  characterGeometryFile: string,
  outputDirectory: string,
  sourceCharacterVersion?: string,
) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const character = await loadGeometry(characterGeometryFile);
  const characterVersion =
    sourceCharacterVersion ??
    (typeof character.metadata.assetVersion === 'string'
      ? character.metadata.assetVersion
      : undefined);
  if (!characterVersion)
    throw new Error(
      'Source character geometry does not record its asset version; pass --character-version for legacy geometry',
    );
  let dress = extractMaterialGeometry(character, ['dress'], 'clothing.elara-midnight-dress', {
    clothingClass: 'canonical-humanoid-fitted-long-dress',
    clothingSkinningPolicy: 'long-dress-drape-v1',
    fitCharacter: character.id,
    fitCharacterVersion: characterVersion,
    deformationValidation: ['neutral-walk', 'cautious-walk'],
  });
  const initialValidation = validateGeometry(dress);
  if (!initialValidation.valid)
    throw new Error(
      `Dress extraction failed: ${initialValidation.issues.map((issue) => issue.code).join(', ')}`,
    );
  const parameters = humanoidParametersSchema.parse(character.metadata.parameters);
  const gaitInput = {
    height: parameters.height,
    legLength: parameters.legLength,
    armLength: parameters.armLength,
    hipWidth: parameters.hipWidth,
    footScale: parameters.footScale,
  };
  const neutralRaw = createWalkStyleMotion('neutral', gaitInput, `walk.${dress.id}.neutral`);
  const neutralCorrection = bakePoseSpaceClothCorrectives(dress, character, neutralRaw, {
    targetPrefix: 'cloth-neutral',
  });
  dress = neutralCorrection.geometry;
  const cautiousRaw = createWalkStyleMotion('cautious', gaitInput, `walk.${dress.id}.cautious`);
  const cautiousCorrection = bakePoseSpaceClothCorrectives(dress, character, cautiousRaw, {
    targetPrefix: 'cloth-cautious',
  });
  dress = cautiousCorrection.geometry;
  const temporalClothing = {
    neutral: verifyTemporalClothing(dress, character, neutralCorrection.motion),
    cautious: verifyTemporalClothing(dress, character, cautiousCorrection.motion),
  };
  for (const [style, result] of Object.entries(temporalClothing))
    if (!result.valid)
      throw new Error(`Dress ${style} cloth failed temporal gates: ${result.issues.join('; ')}`);
  const finalValidation = validateGeometry(dress);
  if (!finalValidation.valid)
    throw new Error(
      `Corrected dress failed geometry validation: ${finalValidation.issues.map((issue) => issue.code).join(', ')}`,
    );
  const validation = {
    ...finalValidation,
    temporalClothing,
    poseSpaceClothCorrectives: {
      neutral: neutralCorrection.report,
      cautious: cautiousCorrection.report,
    },
  };
  const geometryFile = await saveGeometry(join(output, 'geometry.json'), dress);
  await writeFile(
    join(output, 'validation.json'),
    `${JSON.stringify(validation, null, 2)}\n`,
    'utf8',
  );
  const probe = await renderGeometryProbe(geometryFile, join(output, 'verification'));
  const renderDeformationProbe = async (style: 'neutral' | 'cautious') => {
    const motion = style === 'neutral' ? neutralCorrection.motion : cautiousCorrection.motion;
    const biomechanics = verifyCasualWalkMotion(motion);
    if (!biomechanics.valid)
      throw new Error(`Dress ${style} gait failed: ${biomechanics.issues.join('; ')}`);
    const directory = join(output, 'verification', `walk-${style}`);
    const motionFile = await saveMotionClip(join(directory, 'motion.json'), motion);
    const motionProbe = await renderMotionProbe(geometryFile, motionFile, directory, {
      biomechanics,
    });
    return { biomechanics, motionFile, probe: motionProbe };
  };
  const neutral = await renderDeformationProbe('neutral');
  const cautious = await renderDeformationProbe('cautious');
  const metadata = assetMetadataSchema.parse({
    schemaVersion: 1,
    id: dress.id,
    version: '0.2.0',
    type: 'clothing',
    title: 'Elara midnight period dress',
    description:
      'Project-owned fitted long dark dress with canonical humanoid skin weights, renderer-independent pose-space cloth correction, and temporal collision and silhouette verification.',
    status: 'verified',
    tags: ['long-dress', 'dark', 'period-inspired', 'woman'],
    capabilities: [
      'canonical-humanoid-fit',
      'walk-deformation',
      'reusable-material',
      'pose-space-cloth-correction',
      'temporal-cloth-body-collision',
      'temporal-cloth-silhouette-stability',
    ],
    source: {
      kind: 'procedural',
      generator: 'videoer.material-geometry-extractor.v1',
      references: [],
      licence: {
        spdx: 'LicenseRef-Videoer-Project',
        name: 'Videoer project-owned production asset',
        commercialUse: 'allowed',
        attributionRequired: false,
      },
      clearance: 'approved',
    },
    artifacts: [
      {
        role: 'geometry',
        path: 'geometry.json',
        mediaType: 'application/vnd.videoer.geometry+json',
      },
      { role: 'preview', path: 'verification/turntable.mp4', mediaType: 'video/mp4' },
      {
        role: 'blender-source',
        path: 'verification/mannequin.blend',
        mediaType: 'application/x-blender',
      },
      {
        role: 'neutral-walk-preview',
        path: 'verification/walk-neutral/walk.mp4',
        mediaType: 'video/mp4',
      },
      {
        role: 'cautious-walk-preview',
        path: 'verification/walk-cautious/walk.mp4',
        mediaType: 'video/mp4',
      },
    ],
    compatibility: {
      coordinateSystem: 'right-handed-y-up-forward-negative-z-metres',
      skeleton: 'videoer.canonical-humanoid.v1',
      renderers: ['three-3d', 'blender-headless'],
      requires: [{ id: character.id, version: characterVersion }],
    },
    verification: {
      checks: [
        'geometry.topology',
        'skin.weights-normalized',
        'clothing.canonical-humanoid-fit',
        'clothing.temporal-body-collision',
        'clothing.temporal-silhouette-stability',
        'clothing.pose-space-corrective-rendering',
        'visual.canonical-views',
        'visual.turntable',
        'motion.canonical-forward-direction',
        'motion.anatomical-knee-polarity',
        'motion.anatomical-foot-direction',
        'motion.planted-contact-error',
        'motion.swing-clearance',
        'visual.neutral-walk-deformation',
        'visual.cautious-walk-deformation',
      ],
      artifacts: [
        'verification/contact-sheet.png',
        'verification/turntable.mp4',
        'verification/walk-neutral/contact-sheet.png',
        'verification/walk-neutral/contact-sheet-three-quarter.png',
        'verification/walk-neutral/motion-probe.json',
        'verification/walk-cautious/contact-sheet.png',
        'verification/walk-cautious/contact-sheet-three-quarter.png',
        'verification/walk-cautious/motion-probe.json',
      ],
      verifiedAt: new Date().toISOString(),
    },
  });
  await writeHashedAssetMetadata(join(output, 'asset.yaml'), metadata);
  return {
    output,
    geometryFile,
    validation,
    probe,
    biomechanics: { neutral: neutral.biomechanics, cautious: cautious.biomechanics },
    motionProbes: { neutral: neutral.probe, cautious: cautious.probe },
  };
}
