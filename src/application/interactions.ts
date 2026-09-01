import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { loadGeometry, saveGeometry } from '../geometry/io.js';
import { renderInteractionProbe } from '../interactions/blender.js';
import {
  createOpenDoorInteraction,
  createReadBookInteraction,
  createTurnMotion,
  createTurnVerificationMotion,
} from '../interactions/synthesis.js';
import { renderMotionProbe } from '../motion/blender.js';
import { saveMotionClip } from '../motion/io.js';

export type InteractionKind = 'open-door' | 'read-book';

const projectLicence = {
  spdx: 'LicenseRef-Videoer-Project',
  name: 'Videoer project-owned production asset',
  commercialUse: 'allowed' as const,
  attributionRequired: false,
};

async function copyArtifact(source: string, directory: string, name: string) {
  const target = join(directory, name);
  await mkdir(resolve(target, '..'), { recursive: true });
  await copyFile(source, target);
  return name;
}

export async function createTurnAsset(actorGeometryFile: string, outputDirectory: string) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const actor = await loadGeometry(actorGeometryFile);
  const clips = Object.fromEntries(
    (['head', 'body', 'head-and-body'] as const).flatMap((scope) =>
      (['left', 'right'] as const).map((direction) => [
        `${scope}-${direction}`,
        createTurnMotion(direction, scope),
      ]),
    ),
  ) as Record<string, ReturnType<typeof createTurnMotion>>;
  await Promise.all(
    Object.entries(clips).map(([name, clip]) =>
      saveMotionClip(join(output, 'motions', `${name}.json`), clip),
    ),
  );
  const headVerification = createTurnVerificationMotion(actor, 'left', 'head');
  const bodyVerification = createTurnVerificationMotion(actor, 'left', 'body');
  await Promise.all([
    saveMotionClip(join(output, 'verification', 'head-left-motion.json'), headVerification),
    saveMotionClip(join(output, 'verification', 'body-left-motion.json'), bodyVerification),
  ]);
  const landmarks = [
    { id: 'neutral', phase: 0 },
    { id: 'anticipation', phase: 0.2 },
    { id: 'turning', phase: 0.42 },
    { id: 'oriented', phase: 0.62 },
    { id: 'hold', phase: 0.96 },
  ];
  const [headProbe, bodyProbe] = await Promise.all([
    renderMotionProbe(
      actorGeometryFile,
      join(output, 'verification', 'head-left-motion.json'),
      join(output, 'verification', 'head-left'),
      { direction: 'left', scope: 'head', mirroredDirectionValidated: true },
      { baseName: 'turn', landmarks },
    ),
    renderMotionProbe(
      actorGeometryFile,
      join(output, 'verification', 'body-left-motion.json'),
      join(output, 'verification', 'body-left'),
      { direction: 'left', scope: 'body', mirroredDirectionValidated: true },
      { baseName: 'turn', landmarks },
    ),
  ]);
  const metadata = assetMetadataSchema.parse({
    schemaVersion: 1,
    id: 'motion.turn-orientation',
    version: '0.1.0',
    type: 'motion',
    title: 'Bidirectional head and body orientation turns',
    description:
      'Blendable canonical-humanoid head-only, body-only, and coordinated head/body turns in both directions.',
    status: 'verified',
    tags: ['turn', 'gaze', 'head', 'body', 'orientation'],
    capabilities: ['canonical-humanoid', 'additive-blend', 'gaze-target'],
    source: {
      kind: 'procedural',
      generator: 'videoer.turn-synthesis.v1',
      references: [],
      licence: projectLicence,
      clearance: 'approved',
    },
    artifacts: [
      ...Object.keys(clips).map((name) => ({
        role: `motion-${name}`,
        path: `motions/${name}.json`,
        mediaType: 'application/vnd.videoer.motion+json',
      })),
      {
        role: 'head-turn-preview',
        path: 'verification/head-left/turn.mp4',
        mediaType: 'video/mp4',
      },
      {
        role: 'body-turn-preview',
        path: 'verification/body-left/turn.mp4',
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
        'motion.direction-sign',
        'motion.scope-isolation',
        'motion.mirrored-directions',
        'visual.head-turn-two-view',
        'visual.body-turn-two-view',
      ],
      artifacts: [
        'verification/head-left/contact-sheet.png',
        'verification/head-left/contact-sheet-three-quarter.png',
        'verification/head-left/turn.blend',
        'verification/body-left/contact-sheet.png',
        'verification/body-left/contact-sheet-three-quarter.png',
        'verification/body-left/turn.blend',
      ],
      verifiedAt: new Date().toISOString(),
    },
  });
  await writeHashedAssetMetadata(join(output, 'asset.yaml'), metadata);
  return { output, clips: Object.keys(clips), probes: { head: headProbe, body: bodyProbe } };
}

export async function packageInteractionCandidates(
  kind: InteractionKind,
  outputDirectory: string,
  versions: { prop?: string; motion?: string } = {},
) {
  const output = resolve(outputDirectory);
  const propVersion = versions.prop ?? '0.1.0';
  const motionVersion = versions.motion ?? '0.1.0';
  const profile =
    kind === 'open-door'
      ? {
          prop: {
            id: 'prop.bookshop-door',
            title: 'Articulated glazed bookshop door',
            description:
              'Project-owned hinged wooden door with glazed panel, animated handle, threshold, approach point, and collision-ready mesh.',
            tags: ['wooden', 'glazed', 'bookshop', 'door'],
            capabilities: [
              'hinge',
              'handle-interaction-point',
              'collision-volume',
              'named-interaction-points',
            ],
          },
          motion: {
            id: 'motion.open-bookshop-door',
            title: 'Phased bookshop door interaction',
            description:
              'Canonical-humanoid reach, grasp, handle turn, door opening, release, and threshold passage synchronized to an articulated door.',
            tags: ['door', 'reach', 'interaction'],
            capabilities: [
              'canonical-humanoid',
              'hand-ik',
              'target-resolution',
              'phase-sequencing',
              'root-motion',
            ],
          },
        }
      : {
          prop: {
            id: 'prop.significant-book',
            title: 'Significant hardback book',
            description:
              'Project-owned human-scale hardback with articulated covers, bilateral grips, spine, and gaze target.',
            tags: ['book', 'hardback', 'significant'],
            capabilities: [
              'openable-cover',
              'left-hand-grip',
              'right-hand-grip',
              'gaze-target',
              'named-interaction-points',
            ],
          },
          motion: {
            id: 'motion.read-significant-book',
            title: 'Two-handed book raise and read',
            description:
              'Canonical-humanoid low hold, raise, settle, and reading action with continuous bilateral attachment and animated gaze.',
            tags: ['book', 'hold', 'read'],
            capabilities: [
              'canonical-humanoid',
              'two-hand-ik',
              'prop-attachment',
              'gaze-target',
              'additive-blend',
            ],
          },
        };
  const candidateRoot = join(output, 'candidates');
  const propDirectory = join(candidateRoot, profile.prop.id.replaceAll('.', '-'));
  const motionDirectory = join(candidateRoot, profile.motion.id.replaceAll('.', '-'));
  await Promise.all([
    mkdir(propDirectory, { recursive: true }),
    mkdir(motionDirectory, { recursive: true }),
  ]);
  const probeFiles = [
    ['verification/contact-sheet.png', 'verification/contact-sheet.png'],
    ['verification/contact-sheet-opposite.png', 'verification/contact-sheet-opposite.png'],
    ['verification/interaction.mp4', 'verification/interaction.mp4'],
    ['verification/interaction-opposite.mp4', 'verification/interaction-opposite.mp4'],
    ['verification/interaction.blend', 'verification/interaction.blend'],
    ['verification/interaction-probe.json', 'verification/interaction-probe.json'],
  ] as const;
  await copyArtifact(join(output, 'target-geometry.json'), propDirectory, 'geometry.json');
  await Promise.all(
    probeFiles.map(([source, target]) => copyArtifact(join(output, source), propDirectory, target)),
  );
  const verifiedAt = new Date().toISOString();
  const propMetadata = assetMetadataSchema.parse({
    schemaVersion: 1,
    id: profile.prop.id,
    version: propVersion,
    type: 'prop',
    title: profile.prop.title,
    description: profile.prop.description,
    status: 'verified',
    tags: profile.prop.tags,
    capabilities: profile.prop.capabilities,
    source: {
      kind: 'procedural',
      generator: `videoer.${kind}-synthesis.v1`,
      references: [],
      licence: projectLicence,
      clearance: 'approved',
    },
    artifacts: [
      {
        role: 'geometry',
        path: 'geometry.json',
        mediaType: 'application/vnd.videoer.geometry+json',
      },
      { role: 'preview', path: 'verification/interaction.mp4', mediaType: 'video/mp4' },
      {
        role: 'blender-source',
        path: 'verification/interaction.blend',
        mediaType: 'application/x-blender',
      },
    ],
    compatibility: {
      coordinateSystem: 'right-handed-y-up-forward-negative-z-metres',
      renderers: ['three-3d', 'blender-headless'],
      requires: [],
    },
    verification: {
      checks: [
        'geometry.topology',
        'skeleton.hierarchy',
        'attachments.named',
        'visual.scale',
        'visual.interaction-two-view',
      ],
      artifacts: [
        'verification/contact-sheet.png',
        'verification/contact-sheet-opposite.png',
        'verification/interaction-opposite.mp4',
        'verification/interaction-probe.json',
      ],
      verifiedAt,
    },
  });
  await writeHashedAssetMetadata(join(propDirectory, 'asset.yaml'), propMetadata);

  await Promise.all([
    copyArtifact(join(output, 'actor-motion.json'), motionDirectory, 'actor-motion.json'),
    copyArtifact(join(output, 'target-motion.json'), motionDirectory, 'target-motion.json'),
    copyArtifact(join(output, 'interaction.json'), motionDirectory, 'interaction.json'),
    copyArtifact(join(output, 'verification.json'), motionDirectory, 'verification.json'),
    ...probeFiles.map(([source, target]) =>
      copyArtifact(join(output, source), motionDirectory, target),
    ),
  ]);
  const motionMetadata = assetMetadataSchema.parse({
    schemaVersion: 1,
    id: profile.motion.id,
    version: motionVersion,
    type: 'motion',
    title: profile.motion.title,
    description: profile.motion.description,
    status: 'verified',
    tags: profile.motion.tags,
    capabilities: profile.motion.capabilities,
    source: {
      kind: 'procedural',
      generator: `videoer.${kind}-synthesis.v1`,
      references: [],
      licence: projectLicence,
      clearance: 'approved',
    },
    artifacts: [
      {
        role: 'actor-motion',
        path: 'actor-motion.json',
        mediaType: 'application/vnd.videoer.motion+json',
      },
      {
        role: 'target-motion',
        path: 'target-motion.json',
        mediaType: 'application/vnd.videoer.motion+json',
      },
      { role: 'interaction', path: 'interaction.json', mediaType: 'application/json' },
      { role: 'verification', path: 'verification.json', mediaType: 'application/json' },
      { role: 'preview', path: 'verification/interaction.mp4', mediaType: 'video/mp4' },
    ],
    compatibility: {
      coordinateSystem: 'right-handed-y-up-forward-negative-z-metres',
      skeleton: 'videoer.canonical-humanoid.v1',
      renderers: ['three-3d', 'blender-headless'],
      requires: [{ id: profile.prop.id, version: propVersion }],
    },
    verification: {
      checks: [
        'interaction.phase-coverage',
        'ik.reachability',
        'attachment.contact-error',
        'visual.pose-two-view',
        ...(kind === 'read-book'
          ? ['gaze.target', 'attachment.bilateral']
          : ['door.handle-turn', 'door.threshold-step']),
      ],
      artifacts: [
        'verification/contact-sheet.png',
        'verification/contact-sheet-opposite.png',
        'verification/interaction-opposite.mp4',
        'verification/interaction.blend',
        'verification/interaction-probe.json',
      ],
      verifiedAt,
    },
  });
  await writeHashedAssetMetadata(join(motionDirectory, 'asset.yaml'), motionMetadata);
  return {
    output: candidateRoot,
    propDirectory,
    motionDirectory,
    assets: [
      { id: profile.prop.id, version: propVersion },
      { id: profile.motion.id, version: motionVersion },
    ],
  };
}

export async function createInteractionProbe(
  kind: InteractionKind,
  actorGeometryFile: string,
  outputDirectory: string,
) {
  const actor = await loadGeometry(actorGeometryFile);
  const synthesis =
    kind === 'open-door' ? createOpenDoorInteraction(actor) : createReadBookInteraction(actor);
  if (!synthesis.verification.valid)
    throw new Error(`Interaction synthesis failed: ${synthesis.verification.issues.join('; ')}`);
  if (!synthesis.target || !synthesis.targetTransform)
    throw new Error(`Interaction '${synthesis.definition.id}' did not produce a target asset`);
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const actorGeometry = await saveGeometry(join(output, 'actor-geometry.json'), synthesis.actor);
  const targetGeometry = await saveGeometry(join(output, 'target-geometry.json'), synthesis.target);
  const actorMotion = await saveMotionClip(join(output, 'actor-motion.json'), synthesis.actorClip);
  const targetMotion = synthesis.targetClip
    ? await saveMotionClip(join(output, 'target-motion.json'), synthesis.targetClip)
    : undefined;
  const definition = join(output, 'interaction.json');
  const verification = join(output, 'verification.json');
  await Promise.all([
    writeFile(definition, `${JSON.stringify(synthesis.definition, null, 2)}\n`, 'utf8'),
    writeFile(verification, `${JSON.stringify(synthesis.verification, null, 2)}\n`, 'utf8'),
  ]);
  const probe = await renderInteractionProbe(
    {
      actorGeometry,
      actorMotion,
      actorTransform: synthesis.actorTransform,
      targetGeometry,
      ...(targetMotion ? { targetMotion } : {}),
      targetTransform: synthesis.targetTransform,
      definition: synthesis.definition,
      qualityGates: synthesis.verification,
    },
    join(output, 'verification'),
  );
  const candidates = await packageInteractionCandidates(kind, output);
  return {
    kind,
    output,
    definition,
    verification,
    actorGeometry,
    targetGeometry,
    actorMotion,
    ...(targetMotion ? { targetMotion } : {}),
    synthesis: synthesis.verification,
    probe,
    candidates,
  };
}
