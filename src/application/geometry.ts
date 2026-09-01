import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyWalkingExtremityDeformation } from '../characters/deformation.js';
import { createHumanoidMannequin, type HumanoidParameters } from '../characters/mannequin.js';
import { verifyProductionHumanAnatomy } from '../characters/anatomy.js';
import { createProductionHuman } from '../characters/production-human.js';
import { createProductionTemplateHuman } from '../characters/production-template.js';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderGeometryProbe } from '../geometry/blender.js';
import { loadGeometry, saveGeometry } from '../geometry/io.js';
import { validateGeometry } from '../geometry/model.js';
import { renderMotionProbe } from '../motion/blender.js';
import {
  verifyCharacterFootRocker,
  verifyCharacterMotionAlignment,
} from '../motion/character-verification.js';
import { groundMotionToCharacter } from '../motion/grounding.js';
import { plantMotionFeetToCharacter } from '../motion/foot-planting.js';
import { applyRelaxedWalkingHands } from '../motion/hand-pose.js';
import { saveMotionClip } from '../motion/io.js';
import { productionAPoseArmRetargetJoints, retargetMotionRestPose } from '../motion/rest-pose.js';
import { createWalkStyleMotion, measureWalkRig, verifyCasualWalkMotion } from '../motion/walk.js';

export async function validateGeometryFile(path: string) {
  return validateGeometry(await loadGeometry(path));
}

export async function createMannequin(
  outputDirectory: string,
  parameters: HumanoidParameters = {},
  options: { probe?: boolean; id?: string; version?: string } = {},
) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const geometry = createHumanoidMannequin(parameters);
  const validation = validateGeometry(geometry);
  if (!validation.valid)
    throw new Error(
      `Generated mannequin failed geometry validation: ${validation.issues.map((issue) => issue.code).join(', ')}`,
    );
  const anatomy = verifyProductionHumanAnatomy(geometry);
  const completeValidation = { ...validation, anatomy };
  const geometryFile = await saveGeometry(join(output, 'geometry.json'), geometry);
  const validationFile = join(output, 'validation.json');
  await writeFile(validationFile, `${JSON.stringify(completeValidation, null, 2)}\n`, 'utf8');
  const probe =
    options.probe === false
      ? undefined
      : await renderGeometryProbe(geometryFile, join(output, 'verification'));
  const metadata = assetMetadataSchema.parse({
    schemaVersion: 1,
    id: options.id ?? 'character.humanoid-mannequin',
    version: options.version ?? '0.1.0',
    type: 'character',
    title: 'Parametric humanoid mannequin',
    description:
      'Project-owned procedural humanoid foundation with continuous proportions, canonical skeleton, skin weights, and interaction attachments.',
    status: anatomy.valid && probe ? 'verified' : 'validated',
    tags: ['humanoid', 'mannequin', 'procedural', 'project-owned'],
    capabilities: [
      'canonical-humanoid-rig',
      'skinned-mesh',
      'continuous-body-parameters',
      'hand-attachments',
      'foot-contact-points',
      'gaze-target',
      anatomy.valid ? 'production-human-anatomy' : 'prototype-human-anatomy',
    ],
    source: {
      kind: 'procedural',
      generator: 'videoer.parametric-humanoid.v1',
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
      { role: 'validation', path: 'validation.json', mediaType: 'application/json' },
      ...(probe
        ? [
            {
              role: 'blender-source',
              path: 'verification/mannequin.blend',
              mediaType: 'application/x-blender',
            },
            { role: 'turntable', path: 'verification/turntable.mp4', mediaType: 'video/mp4' },
          ]
        : []),
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
        'geometry.degenerate-triangles',
        'geometry.bounds',
        'skeleton.hierarchy',
        'skin.weights-normalized',
        'character.production-human-anatomy-evaluated',
        ...(probe ? ['visual.canonical-views', 'visual.turntable'] : []),
      ],
      artifacts: probe
        ? [
            'verification/front.png',
            'verification/three-quarter.png',
            'verification/side.png',
            'verification/back.png',
            'verification/contact-sheet.png',
            'verification/turntable.mp4',
            'verification/probe.json',
          ]
        : [],
      ...(anatomy.valid && probe ? { verifiedAt: new Date().toISOString() } : {}),
    },
  });
  const metadataFile = join(output, 'asset.yaml');
  await writeHashedAssetMetadata(metadataFile, metadata);
  return {
    output,
    geometryFile,
    validationFile,
    metadataFile,
    metadata,
    validation: completeValidation,
    ...(probe ? { probe } : {}),
  };
}

export async function createProductionHumanFoundation(
  outputDirectory: string,
  parameters: HumanoidParameters = {},
  options: { probe?: boolean; id?: string; version?: string } = {},
) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const templateRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../assets/character-bases/makehuman-hm08',
  );
  const [source, weightSource] = await Promise.all([
    readFile(join(templateRoot, 'base.obj'), 'utf8'),
    readFile(join(templateRoot, 'default_weights.mhw'), 'utf8'),
  ]);
  const geometry = createProductionTemplateHuman(source, weightSource, parameters);
  geometry.id = options.id ?? 'character.production-human-foundation';
  const geometryValidation = validateGeometry(geometry);
  if (!geometryValidation.valid)
    throw new Error(
      `Generated production template failed geometry validation: ${geometryValidation.issues
        .map((issue) => issue.code)
        .join(', ')}`,
    );
  const measuredRig = measureWalkRig(geometry);
  const sourceMotion = createWalkStyleMotion('neutral', measuredRig);
  const retargeted = retargetMotionRestPose(
    sourceMotion,
    createProductionHuman(parameters).skeleton,
    geometry.skeleton,
    'walk.production-template.a-pose',
    { jointIds: productionAPoseArmRetargetJoints },
  );
  const posed = applyRelaxedWalkingHands(retargeted, geometry);
  const preliminaryGrounding = groundMotionToCharacter(geometry, posed, {
    sampleCount: 241,
    verificationSampleCount: 481,
  });
  const footPlanting = plantMotionFeetToCharacter(geometry, preliminaryGrounding.motion);
  const grounded = groundMotionToCharacter(geometry, footPlanting.motion, {
    sampleCount: 241,
    verificationSampleCount: 481,
  });
  const biomechanics = verifyCasualWalkMotion(grounded.motion, {
    verifyProxyGrounding: false,
  });
  const alignment = verifyCharacterMotionAlignment(geometry, grounded.motion);
  const footRocker = verifyCharacterFootRocker(geometry, grounded.motion);
  const deformation = verifyWalkingExtremityDeformation(geometry, grounded.motion);
  const motionIssues = [
    ...biomechanics.issues,
    ...grounded.verification.issues,
    ...alignment.issues,
    ...footRocker.issues,
    ...deformation.issues,
  ];
  if (motionIssues.length)
    throw new Error(`Generated production template walk failed: ${motionIssues.join(', ')}`);
  const validation = {
    ...geometryValidation,
    productionTemplate: {
      topology: geometry.metadata.topology,
      productionPose: geometry.metadata.productionPose,
      sourceAssetSha256: geometry.metadata.sourceAssetSha256,
      sourceWeightsSha256: geometry.metadata.sourceWeightsSha256,
      sourceLicence: geometry.metadata.sourceLicence,
      measuredWalkRig: measuredRig,
    },
    walk: {
      biomechanics,
      grounding: grounded.verification,
      footPlanting: footPlanting.checks,
      alignment,
      footRocker,
      deformation,
      visualAcceptance: 'rejected' as const,
    },
  };
  const geometryFile = await saveGeometry(join(output, 'geometry.json'), geometry);
  const motionFile = await saveMotionClip(
    join(output, 'verification/walk/motion.json'),
    grounded.motion,
  );
  const validationFile = join(output, 'validation.json');
  await writeFile(validationFile, `${JSON.stringify(validation, null, 2)}\n`, 'utf8');
  const probe =
    options.probe === false
      ? undefined
      : await renderGeometryProbe(geometryFile, join(output, 'verification/static'));
  const motionProbe =
    options.probe === false
      ? undefined
      : await renderMotionProbe(geometryFile, motionFile, join(output, 'verification/walk'), {
          biomechanics,
          finalCharacter: {
            grounding: grounded.verification,
            alignment,
            deformation,
          },
        });
  const metadata = assetMetadataSchema.parse({
    schemaVersion: 1,
    id: geometry.id,
    version: options.version ?? '0.1.0',
    type: 'character',
    title: 'Production human foundation',
    description:
      'Stable CC0 production-base topology converted into the Videoer canonical rig with authored weights, preserve-volume deformation, profiled A-pose motion retargeting, and final-mesh verification. Visual production acceptance remains rejected.',
    status: 'validated',
    tags: ['humanoid', 'anatomical', 'stable-topology', 'cc0', 'production-foundation'],
    capabilities: [
      'canonical-humanoid-rig',
      'stable-production-human-topology',
      'authored-skin-weights',
      'dual-quaternion-skinning',
      'hand-geometry',
      'articulated-finger-rig',
      'foot-geometry',
      'metatarsal-toe-roll',
      'profiled-a-pose-retargeting',
      'final-mesh-grounding',
      'final-surface-foot-planting',
      'geometry-derived-facing-verification',
      'extremity-deformation-verification',
      'hand-attachments',
      'foot-contact-points',
      'gaze-target',
    ],
    source: {
      kind: 'imported',
      generator: 'videoer.production-template-human.v1',
      sourceAsset: 'assets/character-bases/makehuman-hm08/base.obj',
      sourceAssets: [
        'assets/character-bases/makehuman-hm08/base.obj',
        'assets/character-bases/makehuman-hm08/default_weights.mhw',
      ],
      references: [
        'assets/character-bases/makehuman-hm08/PROVENANCE.md',
        'https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md',
      ],
      licence: {
        spdx: 'CC0-1.0',
        name: 'Creative Commons Zero v1.0 Universal',
        commercialUse: 'allowed',
        attributionRequired: false,
        url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      },
      clearance: 'approved',
    },
    artifacts: [
      {
        role: 'geometry',
        path: 'geometry.json',
        mediaType: 'application/vnd.videoer.geometry+json',
      },
      { role: 'validation', path: 'validation.json', mediaType: 'application/json' },
      {
        role: 'motion',
        path: 'verification/walk/motion.json',
        mediaType: 'application/vnd.videoer.motion+json',
      },
      ...(probe
        ? [
            {
              role: 'blender-source',
              path: 'verification/static/mannequin.blend',
              mediaType: 'application/x-blender',
            },
            {
              role: 'turntable',
              path: 'verification/static/turntable.mp4',
              mediaType: 'video/mp4',
            },
            {
              role: 'contact-sheet',
              path: 'verification/static/contact-sheet.png',
              mediaType: 'image/png',
            },
            {
              role: 'walk-side',
              path: 'verification/walk/walk.mp4',
              mediaType: 'video/mp4',
            },
            {
              role: 'walk-three-quarter',
              path: 'verification/walk/walk-three-quarter.mp4',
              mediaType: 'video/mp4',
            },
            {
              role: 'walk-contact-sheet',
              path: 'verification/walk/contact-sheet-three-quarter.png',
              mediaType: 'image/png',
            },
            {
              role: 'walk-hand-detail',
              path: 'verification/walk/walk-left-hand-detail.mp4',
              mediaType: 'video/mp4',
            },
            {
              role: 'walk-feet-detail',
              path: 'verification/walk/walk-feet-detail.mp4',
              mediaType: 'video/mp4',
            },
          ]
        : []),
    ],
    compatibility: {
      coordinateSystem: 'right-handed-y-up-forward-negative-z-metres',
      skeleton: 'videoer.canonical-humanoid.v1',
      renderers: ['blender-headless'],
      requires: [],
    },
    verification: {
      checks: [
        'geometry.indices',
        'geometry.degenerate-triangles',
        'skeleton.hierarchy',
        'skin.weights-normalized',
        'character.stable-topology-source-hashes',
        'motion.profiled-a-pose-retargeting',
        'motion.geometry-facing-alignment',
        'motion.final-mesh-grounding',
        'motion.final-surface-foot-planting',
        'skin.shoulder-hand-foot-toe-deformation',
        ...(probe
          ? [
              'visual.canonical-views-generated-not-accepted',
              'visual.turntable-generated-not-accepted',
              'visual.walk-dual-angle-generated-not-accepted',
            ]
          : []),
      ],
      artifacts: probe
        ? [
            'verification/static/contact-sheet.png',
            'verification/static/turntable.mp4',
            'verification/static/probe.json',
            'verification/walk/walk.mp4',
            'verification/walk/walk-three-quarter.mp4',
            'verification/walk/contact-sheet.png',
            'verification/walk/contact-sheet-three-quarter.png',
            'verification/walk/contact-sheet-left-hand-detail.png',
            'verification/walk/contact-sheet-feet-detail.png',
            'verification/walk/motion-probe.json',
          ]
        : [],
    },
  });
  const metadataFile = join(output, 'asset.yaml');
  await writeHashedAssetMetadata(metadataFile, metadata);
  return {
    output,
    geometryFile,
    motionFile,
    validationFile,
    metadataFile,
    metadata,
    validation,
    ...(probe ? { probe } : {}),
    ...(motionProbe ? { motionProbe } : {}),
  };
}
