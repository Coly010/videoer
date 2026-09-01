import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { createOldCityBookshop } from '../environments/bookshop.js';
import { renderGeometryProbe } from '../geometry/blender.js';
import { saveGeometry } from '../geometry/io.js';
import { validateGeometry } from '../geometry/model.js';

export async function createBookshopEnvironment(outputDirectory: string) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const geometry = createOldCityBookshop();
  const validation = validateGeometry(geometry);
  if (!validation.valid)
    throw new Error(
      `Environment geometry failed: ${validation.issues.map((issue) => issue.code).join(', ')}`,
    );
  const geometryFile = await saveGeometry(join(output, 'geometry.json'), geometry);
  const validationFile = join(output, 'validation.json');
  await writeFile(validationFile, `${JSON.stringify(validation, null, 2)}\n`, 'utf8');
  const probe = await renderGeometryProbe(geometryFile, join(output, 'verification'));
  const metadata = assetMetadataSchema.parse({
    schemaVersion: 1,
    id: geometry.id,
    version: '0.5.0',
    type: 'environment',
    title: 'Continuous old-city bookshop',
    description:
      'Deterministic continuous old-city street and bookshop with metre-scaled procedural surfaces, modular facade timbers, signs, lanterns, drainage, street furniture, populated shelves, aligned openings, named paths, and interaction points.',
    status: 'validated',
    tags: ['old-city', 'narrow-street', 'bookshop', 'shelves', 'warm-interior', 'set-dressing'],
    capabilities: [
      'deterministic-seed',
      'named-paths',
      'promotable-asset',
      'exterior-continuity',
      'named-interaction-points',
      'procedural-wet-cobble',
      'opposing-street-depth',
      'tower-silhouette',
      'metre-scaled-procedural-surfaces',
      'physical-architectural-glazing',
      'modular-facade-dressing',
      'wall-lantern-practicals',
      'street-furniture',
      'populated-shelves',
    ],
    source: {
      kind: 'procedural',
      generator: 'videoer.old-city-bookshop.v5',
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
      { role: 'turntable', path: 'verification/turntable.mp4', mediaType: 'video/mp4' },
      {
        role: 'blender-source',
        path: 'verification/mannequin.blend',
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
        'geometry.material-groups',
        'material.wet-cobble-relief',
        'environment.opposing-facade-depth',
        'environment.tower-silhouette',
        'environment.modular-facade-dressing',
        'environment.populated-shelves',
        'material.object-space-metre-scale',
        'material.architectural-glazing',
        'attachments.named-paths',
        'continuity.exterior-interior',
        'visual.canonical-views-generated-not-accepted',
        'visual.turntable-generated-not-accepted',
      ],
      artifacts: [
        'verification/street-front.png',
        'verification/street-three-quarter.png',
        'verification/threshold.png',
        'verification/interior-shelves.png',
        'verification/interior-facade.png',
        'verification/continuity-overhead.png',
        'verification/contact-sheet.png',
        'verification/probe.json',
      ],
      verifiedAt: new Date().toISOString(),
    },
  });
  const metadataFile = join(output, 'asset.yaml');
  await writeHashedAssetMetadata(metadataFile, metadata);
  return { output, geometryFile, validationFile, metadataFile, validation, probe };
}
