import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import YAML from 'yaml';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { loadCharacterDefinition } from '../characters/definition.js';
import { verifyProductionHumanAnatomy } from '../characters/anatomy.js';
import { createHumanoidMannequin } from '../characters/mannequin.js';
import { measureLongDressDrapeSkinning } from '../clothing/drape.js';
import { bakePoseSpaceClothCorrectives, verifyTemporalClothing } from '../clothing/temporal.js';
import { renderGeometryProbe } from '../geometry/blender.js';
import { loadGeometry, saveGeometry } from '../geometry/io.js';
import { validateGeometry } from '../geometry/model.js';
import { renderMotionProbe } from '../motion/blender.js';
import { saveMotionClip } from '../motion/io.js';
import { createWalkStyleMotion, verifyCasualWalkMotion } from '../motion/walk.js';

export async function inspectCharacterAnatomy(geometryFile: string, reportFile?: string) {
  const report = verifyProductionHumanAnatomy(await loadGeometry(geometryFile));
  if (reportFile) {
    const target = resolve(reportFile);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  return { ...report, ...(reportFile ? { reportFile: resolve(reportFile) } : {}) };
}

export async function createCharacterAsset(definitionFile: string, outputDirectory: string) {
  const definition = await loadCharacterDefinition(definitionFile);
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  let geometry = createHumanoidMannequin(definition.body, definition.appearance);
  geometry.id = definition.id;
  geometry.metadata.assetVersion = definition.version;
  geometry.metadata.hair = definition.hair;
  geometry.metadata.wardrobe = definition.wardrobe;
  geometry.metadata.references = definition.references;
  const validation = validateGeometry(geometry);
  if (!validation.valid)
    throw new Error(
      `Generated character failed geometry validation: ${validation.issues.map((issue) => issue.code).join(', ')}`,
    );
  const dressDrape = measureLongDressDrapeSkinning(geometry, 'dress');
  if (!dressDrape.valid)
    throw new Error(
      `Generated character failed dress drape validation: ${dressDrape.issues.join('; ')}`,
    );
  const gaitInput = {
    height: definition.body.height,
    legLength: definition.body.legLength,
    armLength: definition.body.armLength,
    hipWidth: definition.body.hipWidth,
    footScale: definition.body.footScale,
  };
  const neutralRaw = createWalkStyleMotion('neutral', gaitInput, `walk.${definition.id}.neutral`);
  const neutralCorrection = bakePoseSpaceClothCorrectives(geometry, geometry, neutralRaw, {
    targetPrefix: 'cloth-neutral',
  });
  geometry = neutralCorrection.geometry;
  const cautiousRaw = createWalkStyleMotion(
    'cautious',
    gaitInput,
    `walk.${definition.id}.cautious`,
  );
  const cautiousCorrection = bakePoseSpaceClothCorrectives(geometry, geometry, cautiousRaw, {
    targetPrefix: 'cloth-cautious',
  });
  geometry = cautiousCorrection.geometry;
  const temporalClothing = {
    neutral: verifyTemporalClothing(geometry, geometry, neutralCorrection.motion),
    cautious: verifyTemporalClothing(geometry, geometry, cautiousCorrection.motion),
  };
  const anatomy = verifyProductionHumanAnatomy(geometry);
  for (const [style, result] of Object.entries(temporalClothing))
    if (!result.valid)
      throw new Error(
        `Generated character ${style} cloth failed temporal validation: ${result.issues.join('; ')}`,
      );
  const completeValidation = {
    ...validation,
    dressDrape,
    temporalClothing,
    poseSpaceClothCorrectives: {
      neutral: neutralCorrection.report,
      cautious: cautiousCorrection.report,
    },
    anatomy,
  };
  const geometryFile = await saveGeometry(join(output, 'geometry.json'), geometry);
  const validationFile = join(output, 'validation.json');
  await writeFile(validationFile, `${JSON.stringify(completeValidation, null, 2)}\n`, 'utf8');
  const definitionOutput = join(output, 'character.yaml');
  await writeFile(definitionOutput, YAML.stringify(definition), 'utf8');

  const geometryProbe = await renderGeometryProbe(
    geometryFile,
    join(output, 'verification', 'body'),
  );
  const renderGait = async (
    style: 'neutral' | 'cautious',
    walk: typeof neutralCorrection.motion,
  ) => {
    const biomechanics = verifyCasualWalkMotion(walk);
    if (!biomechanics.valid)
      throw new Error(
        `Generated character ${style} walk failed: ${biomechanics.issues.join('; ')}`,
      );
    const directory = join(output, 'verification', `walk-${style}`);
    const motionFile = await saveMotionClip(join(directory, 'motion.json'), walk);
    const probe = await renderMotionProbe(geometryFile, motionFile, directory, { biomechanics });
    return { style, walk, biomechanics, motionFile, probe };
  };
  const neutral = await renderGait('neutral', neutralCorrection.motion);
  const cautious = await renderGait('cautious', cautiousCorrection.motion);
  const metadata = assetMetadataSchema.parse({
    schemaVersion: 1,
    id: definition.id,
    version: definition.version,
    type: 'character',
    title: definition.title,
    description: definition.description,
    status: anatomy.valid ? 'verified' : 'validated',
    tags: ['humanoid', 'woman', 'recurring', 'procedural', 'project-owned'],
    capabilities: [
      'canonical-humanoid-rig',
      'skinned-mesh',
      'continuous-body-parameters',
      'stable-material-palette',
      'basic-face',
      'mesh-hair',
      'fitted-long-dress',
      'long-dress-drape-skinning',
      'pose-space-cloth-correction',
      'temporal-cloth-body-collision',
      'temporal-cloth-silhouette-stability',
      anatomy.valid ? 'production-human-anatomy' : 'prototype-human-anatomy',
      'motion-retargeting',
      'hand-attachments',
      'foot-contact-points',
      'gaze-target',
      'identity-reference',
    ],
    source: {
      kind: 'procedural',
      generator: 'videoer.character-factory.v1',
      references: definition.references,
      licence: {
        spdx: 'LicenseRef-Videoer-Project',
        name: 'Videoer project-owned production asset',
        commercialUse: 'allowed',
        attributionRequired: false,
      },
      clearance: 'approved',
    },
    artifacts: [
      { role: 'definition', path: 'character.yaml', mediaType: 'application/yaml' },
      {
        role: 'geometry',
        path: 'geometry.json',
        mediaType: 'application/vnd.videoer.geometry+json',
      },
      { role: 'validation', path: 'validation.json', mediaType: 'application/json' },
      {
        role: 'blender-source',
        path: 'verification/body/mannequin.blend',
        mediaType: 'application/x-blender',
      },
      { role: 'turntable', path: 'verification/body/turntable.mp4', mediaType: 'video/mp4' },
      {
        role: 'identity-reference',
        path: 'verification/body/contact-sheet.png',
        mediaType: 'image/png',
      },
      {
        role: 'identity-face-reference',
        path: 'verification/body/face-close-up.png',
        mediaType: 'image/png',
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
      requires: [],
    },
    verification: {
      checks: [
        'geometry.indices',
        'geometry.material-groups',
        'skeleton.hierarchy',
        'skin.weights-normalized',
        'clothing.long-dress-drape-skinning',
        'clothing.temporal-body-collision',
        'clothing.temporal-silhouette-stability',
        'clothing.pose-space-corrective-rendering',
        'visual.semantic-canonical-views',
        'visual.turntable',
        'motion.canonical-forward-direction',
        'motion.anatomical-knee-polarity',
        'motion.anatomical-foot-direction',
        'motion.planted-contact-error',
        'motion.swing-clearance',
        'visual.neutral-walk-deformation',
        'visual.cautious-walk-deformation',
        'character.production-human-anatomy-evaluated',
      ],
      artifacts: [
        'verification/body/front.png',
        'verification/body/three-quarter-left.png',
        'verification/body/left.png',
        'verification/body/right.png',
        'verification/body/three-quarter-right.png',
        'verification/body/back.png',
        'verification/body/face-close-up.png',
        'verification/body/contact-sheet.png',
        'verification/body/turntable.mp4',
        'verification/body/probe.json',
        'verification/walk-neutral/contact-sheet.png',
        'verification/walk-neutral/contact-sheet-three-quarter.png',
        'verification/walk-neutral/motion-probe.json',
        'verification/walk-cautious/contact-sheet.png',
        'verification/walk-cautious/contact-sheet-three-quarter.png',
        'verification/walk-cautious/motion-probe.json',
      ],
      ...(anatomy.valid ? { verifiedAt: new Date().toISOString() } : {}),
    },
  });
  const metadataFile = join(output, 'asset.yaml');
  await writeHashedAssetMetadata(metadataFile, metadata);
  return {
    output,
    definitionFile: definitionOutput,
    geometryFile,
    validationFile,
    metadataFile,
    validation: completeValidation,
    biomechanics: { neutral: neutral.biomechanics, cautious: cautious.biomechanics },
    geometryProbe,
    motionProbes: { neutral: neutral.probe, cautious: cautious.probe },
  };
}
