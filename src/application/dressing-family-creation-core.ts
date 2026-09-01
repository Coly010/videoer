import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { saveGeometry } from '../geometry/io.js';
import type { GeometryAsset } from '../geometry/model.js';
import { validateGeometry } from '../geometry/model.js';

export interface DressingMemberCandidateDefinition {
  directory: string;
  geometry: GeometryAsset;
  title: string;
  description: string;
  tags: string[];
  familyTag: string;
  generator: string;
  capabilities: string[];
  verificationChecks: string[];
}

export async function writeDressingMemberCandidate(definition: DressingMemberCandidateDefinition) {
  const { directory, geometry } = definition;
  await mkdir(directory, { recursive: true });
  const validation = validateGeometry(geometry);
  if (!validation.valid)
    throw new Error(
      `${geometry.id} failed geometry validation: ${validation.issues.map((issue) => issue.code).join(', ')}`,
    );
  await saveGeometry(join(directory, 'geometry.json'), geometry);
  await writeFile(
    join(directory, 'validation.json'),
    `${JSON.stringify(validation, null, 2)}\n`,
    'utf8',
  );
  return writeHashedAssetMetadata(
    join(directory, 'asset.yaml'),
    assetMetadataSchema.parse({
      schemaVersion: 1,
      id: geometry.id,
      version: '0.1.0',
      type: 'prop',
      title: definition.title,
      description: definition.description,
      status: 'validated',
      tags: [
        ...new Set([...definition.tags, definition.familyTag, 'portable', 'inhabited-environment']),
      ],
      capabilities: definition.capabilities,
      source: {
        kind: 'procedural',
        generator: definition.generator,
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
          ...definition.verificationChecks,
          'visual.cross-environment-generated-not-accepted',
        ],
        artifacts: ['validation.json'],
        verifiedAt: new Date().toISOString(),
      },
    }),
  );
}
