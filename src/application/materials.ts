import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderGeometryProbe } from '../geometry/blender.js';
import { saveGeometry } from '../geometry/io.js';
import { validateGeometry, type GeometryAsset } from '../geometry/model.js';
import { saveSurfaceMaterial } from '../materials/io.js';
import type { SurfaceMaterial } from '../materials/model.js';
import {
  createOldCitySurfacePresets,
  createSurfaceMaterialSwatch,
  type OldCitySurfacePreset,
} from '../materials/old-city.js';
import { createWetCobbleSurfaceMaterial, createWetCobbleSwatch } from '../materials/wet-cobble.js';
import {
  createPavingGranularSurfaceMaterial,
  createPavingGranularSwatch,
  type PavingGranularKind,
} from '../materials/paving-joint.js';

interface SurfaceAssetDefinition {
  material: SurfaceMaterial;
  swatch: GeometryAsset;
  version: string;
  title: string;
  description: string;
  tags: string[];
}

async function createSurfaceMaterialAsset(
  outputDirectory: string,
  definition: SurfaceAssetDefinition,
) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const { material, swatch } = definition;
  const materialFile = await saveSurfaceMaterial(join(output, 'material.json'), material);
  const validation = validateGeometry(swatch);
  if (!validation.valid)
    throw new Error(
      `Surface material swatch '${material.id}' failed: ${validation.issues.map((issue) => issue.code).join(', ')}`,
    );
  const geometryFile = await saveGeometry(join(output, 'swatch-geometry.json'), swatch);
  await writeFile(
    join(output, 'validation.json'),
    `${JSON.stringify(validation, null, 2)}\n`,
    'utf8',
  );
  const probe = await renderGeometryProbe(geometryFile, join(output, 'verification'));
  const metadata = assetMetadataSchema.parse({
    schemaVersion: 1,
    id: material.id,
    version: definition.version,
    type: 'material',
    title: definition.title,
    description: definition.description,
    status: 'validated',
    tags: definition.tags,
    capabilities: [
      'procedural',
      'albedo',
      'normal',
      'roughness',
      'object-space-metre-scale',
      'deterministic-seed',
      ...(material.roughness.wetness > 0 ? ['wet-coat'] : []),
      ...(material.weathering ? ['environmental-weathering'] : []),
      ...(material.pattern.kind === 'architectural-glazing'
        ? ['transmission', 'ior', 'physical-thickness', 'cycles-verified']
        : []),
    ],
    source: {
      kind: 'procedural',
      generator: String(material.metadata.generator ?? 'videoer.surface-material.v1'),
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
        role: 'material',
        path: 'material.json',
        mediaType: 'application/vnd.videoer.material+json',
      },
      {
        role: 'swatch-geometry',
        path: 'swatch-geometry.json',
        mediaType: 'application/vnd.videoer.geometry+json',
      },
      { role: 'preview', path: 'verification/turntable.mp4', mediaType: 'video/mp4' },
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
        'material.schema',
        'material.palette-variation',
        'material.object-space-metre-scale',
        'material.procedural-normal-relief',
        'material.roughness-range',
        ...(material.pattern.kind === 'architectural-glazing'
          ? ['material.cycles-transmission', 'material.declared-physical-thickness']
          : []),
        ...(material.weathering ? ['material.environmental-weathering'] : []),
        'visual.canonical-views-generated-not-accepted',
        'visual.turntable-generated-not-accepted',
      ],
      artifacts: [
        'verification/top.png',
        'verification/raking.png',
        'verification/close.png',
        'verification/glancing.png',
        'verification/contact-sheet.png',
        'verification/turntable.mp4',
        'verification/mannequin.blend',
      ],
      verifiedAt: new Date().toISOString(),
    },
  });
  await writeHashedAssetMetadata(join(output, 'asset.yaml'), metadata);
  return { output, materialFile, geometryFile, validation, probe };
}

export async function createWetCobbleMaterialAsset(outputDirectory: string) {
  const material = createWetCobbleSurfaceMaterial();
  return createSurfaceMaterialAsset(outputDirectory, {
    material,
    swatch: createWetCobbleSwatch(),
    version: '0.2.0',
    title: 'Procedural rain-darkened old-city cobble',
    description:
      'Renderer-independent wet cobble with metre-scaled palette variation, micro-normal relief, independent roughness breakup, and a physically layered rain coat.',
    tags: ['stone', 'cobble', 'wet', 'old-city'],
  });
}

export async function createPavingGranularMaterialAsset(
  kind: PavingGranularKind,
  outputDirectory: string,
) {
  const material = createPavingGranularSurfaceMaterial(kind);
  const isSubstrate = kind === 'compacted-base';
  return createSurfaceMaterialAsset(outputDirectory, {
    material,
    swatch: createPavingGranularSwatch(kind),
    version: '0.1.0',
    title: isSubstrate
      ? 'Procedural compacted paving substrate'
      : `Procedural ${kind} paving joint`,
    description: isSubstrate
      ? 'Renderer-independent compacted granular base with physical aggregate and fines scales, pore relief, embedded dirt, and explicit surface-water absorption.'
      : 'Renderer-independent paving joint fill with physical aggregate and fines scales, compaction, pore relief, embedded dirt, and explicit surface-water response.',
    tags: ['paving', isSubstrate ? 'substrate' : 'joint', 'granular', 'construction'],
  });
}

const oldCityAssetDefinition = (preset: OldCitySurfacePreset): SurfaceAssetDefinition => ({
  material: preset.material,
  swatch: createSurfaceMaterialSwatch(preset.material),
  version: '0.2.0',
  title: preset.title,
  description: preset.description,
  tags: preset.tags,
});

export async function createOldCitySurfaceMaterialAssets(outputDirectory: string) {
  const output = resolve(outputDirectory);
  const assets = [];
  for (const preset of createOldCitySurfacePresets())
    assets.push(
      await createSurfaceMaterialAsset(
        join(
          output,
          preset.material.id.replace(/^material\./u, ''),
          oldCityAssetDefinition(preset).version,
        ),
        oldCityAssetDefinition(preset),
      ),
    );
  return { output, assets };
}

export async function createOldCitySurfaceMaterialAsset(
  presetId: OldCitySurfacePreset['id'],
  outputDirectory: string,
) {
  const preset = createOldCitySurfacePresets().find((candidate) => candidate.id === presetId);
  if (!preset) throw new Error(`Unknown old-city surface preset '${presetId}'`);
  return createSurfaceMaterialAsset(resolve(outputDirectory), oldCityAssetDefinition(preset));
}
