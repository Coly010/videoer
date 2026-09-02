import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bindPavingConstructionMaterials,
  bindPavingUnitMaterial,
} from '../src/application/paving-material-assembly.js';
import { sha256Bytes } from '../src/assets/sources/cache.js';
import {
  compileIrregularPaving,
  createHistoricSettPavingDefinition,
} from '../src/environments/irregular-paving.js';
import { loadGeometry, saveGeometry } from '../src/geometry/io.js';
import { saveSurfaceMaterial } from '../src/materials/io.js';
import { createPavingGranularSurfaceMaterial } from '../src/materials/paving-joint.js';
import { surfaceMaterialSchema, textureMaterialApplicationSchema } from '../src/materials/model.js';
import { createWetCobbleSurfaceMaterial } from '../src/materials/wet-cobble.js';

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

describe('unit-aware paving material assembly', () => {
  it('binds one homogeneous source to every modeled unit while preserving joint domains', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-paving-material-'));
    const source = compileIrregularPaving(createHistoricSettPavingDefinition());
    const geometryPath = await saveGeometry(join(directory, 'source/paving.json'), source.geometry);
    const materialDirectory = join(directory, 'material');
    await mkdir(join(materialDirectory, 'textures'), { recursive: true });
    const channels = await Promise.all(
      [
        ['base-color', 'srgb-texture'],
        ['normal', 'non-color'],
        ['roughness', 'non-color'],
      ].map(async ([semantic, colorSpace]) => {
        const bytes = Buffer.from(`paving-${semantic}`);
        const path = `textures/${semantic}.png`;
        await writeFile(join(materialDirectory, path), bytes);
        return {
          semantic,
          providerName: semantic,
          path,
          mediaType: 'image/png',
          sha256: sha256Bytes(bytes),
          sizeBytes: bytes.byteLength,
          colorSpace,
          ...(semantic === 'normal' ? { normalConvention: 'opengl-positive-green' as const } : {}),
        };
      }),
    );
    const material = surfaceMaterialSchema.parse({
      ...createWetCobbleSurfaceMaterial(),
      id: 'material.homogeneous-unit-stone-fixture',
      textureMaps: {
        kind: 'hash-bound',
        source: {
          provider: 'ambientcg',
          sourceIdentitySha256: '1'.repeat(64),
          manifestSha256: '2'.repeat(64),
          licenceSpdx: 'CC0-1.0',
        },
        physicalScale: { widthMeters: 0.8, heightMeters: 0.8 },
        suitability: {
          composition: 'homogeneous-unit-material',
          intendedConstructionDomains: ['modeled-paving-unit'],
          rationale: 'Deterministic unit material assembly fixture.',
        },
        channels,
      },
    });
    const materialPath = await saveSurfaceMaterial(
      join(materialDirectory, 'material.json'),
      material,
    );
    const application = textureMaterialApplicationSchema.parse({
      constructionDomain: 'modeled-paving-unit',
      placement: {
        scalePolicy: 'preserve-source-physical-scale',
        orientation: 'unit-local-uv-meters',
        offsetMeters: [0, 0],
        rotationDegrees: 0,
        appearance: {
          exposureStops: 0,
          saturationScale: 1,
          hueShiftDegrees: 0,
          roughnessScale: 1,
          roughnessOffset: 0,
          weatheringAmount: 0.1,
        },
        macroVariation: {
          seed: 73,
          scaleMeters: 4,
          valueAmplitude: 0.05,
          saturationAmplitude: 0.02,
          hueAmplitudeDegrees: 1,
          roughnessAmplitude: 0.03,
          weatheringAmplitude: 0.1,
        },
      },
    });
    const output = join(directory, 'bound/paving.json');
    const result = await bindPavingUnitMaterial({
      pavingGeometryPath: geometryPath,
      unitMaterialPath: materialPath,
      unitApplication: application,
      outputGeometryPath: output,
    });
    const bound = await loadGeometry(output);
    const targets = source.report.surfaceMaterialTargets;

    expect(result.report.modeledUnitTargets).toEqual(targets.modeledUnits);
    expect(result.report.preservedTargets).toEqual({
      joint: targets.continuousJoint,
      substrate: targets.continuousSubstrate,
      borders: targets.borders,
    });
    expect(
      targets.modeledUnits.every(
        (id) =>
          bound.materials.find((candidate) => candidate.id === id)?.surface?.textureMaps
            ?.application?.placement.orientation === 'unit-local-uv-meters',
      ),
    ).toBe(true);
    expect(bound.materials.find((item) => item.id === targets.continuousJoint)?.surface).toBe(
      undefined,
    );
    expect(bound.materials.find((item) => item.id === targets.continuousSubstrate)?.surface).toBe(
      undefined,
    );
    expect(result.report.pavingGeometry.outputSha256).toMatch(/^[a-f0-9]{64}$/u);

    const jointPath = await saveSurfaceMaterial(
      join(directory, 'construction-materials/joint.json'),
      createPavingGranularSurfaceMaterial('natural-grit'),
    );
    const substratePath = await saveSurfaceMaterial(
      join(directory, 'construction-materials/substrate.json'),
      createPavingGranularSurfaceMaterial('compacted-base'),
    );
    const constructionOutput = join(directory, 'construction-bound/paving.json');
    await bindPavingConstructionMaterials({
      pavingGeometryPath: output,
      jointMaterialPath: jointPath,
      substrateMaterialPath: substratePath,
      outputGeometryPath: constructionOutput,
    });
    const portable = await loadGeometry(constructionOutput);
    const restagedChannel = portable.materials
      .find((candidate) => candidate.id === targets.modeledUnits[0])!
      .surface!.textureMaps!.channels.find((channel) => channel.semantic === 'base-color')!;
    expect(
      sha256Bytes(await readFile(join(directory, 'construction-bound', restagedChannel.path))),
    ).toBe(restagedChannel.sha256);

    const invalid = structuredClone(application);
    invalid.placement.orientation = 'world-horizontal';
    await expect(
      bindPavingUnitMaterial({
        pavingGeometryPath: geometryPath,
        unitMaterialPath: materialPath,
        unitApplication: invalid,
        outputGeometryPath: join(directory, 'invalid/paving.json'),
      }),
    ).rejects.toThrow(/unit-local-uv-meters/u);
  }, 10_000);

  it('binds granular joint and substrate materials only to their declared continuous targets', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-paving-construction-material-'));
    const source = compileIrregularPaving(createHistoricSettPavingDefinition());
    const geometryPath = await saveGeometry(join(directory, 'source/paving.json'), source.geometry);
    const jointPath = await saveSurfaceMaterial(
      join(directory, 'materials/joint.json'),
      createPavingGranularSurfaceMaterial('natural-grit'),
    );
    const substratePath = await saveSurfaceMaterial(
      join(directory, 'materials/substrate.json'),
      createPavingGranularSurfaceMaterial('compacted-base'),
    );
    const outputPath = join(directory, 'bound/paving.json');
    const result = await bindPavingConstructionMaterials({
      pavingGeometryPath: geometryPath,
      jointMaterialPath: jointPath,
      substrateMaterialPath: substratePath,
      outputGeometryPath: outputPath,
    });
    const bound = await loadGeometry(outputPath);
    const targets = source.report.surfaceMaterialTargets;

    expect(result.targets).toEqual({
      joint: targets.continuousJoint,
      substrate: targets.continuousSubstrate,
    });
    expect(
      bound.materials.find((material) => material.id === targets.continuousJoint)?.surface
        ?.metadata,
    ).toMatchObject({ granularKind: 'natural-grit' });
    expect(
      bound.materials.find((material) => material.id === targets.continuousSubstrate)?.surface
        ?.metadata,
    ).toMatchObject({ granularKind: 'compacted-base' });
    expect(
      targets.modeledUnits.every(
        (target) =>
          bound.materials.find((material) => material.id === target)?.surface === undefined,
      ),
    ).toBe(true);
    expect(
      targets.borders.every(
        (target) =>
          bound.materials.find((material) => material.id === target)?.surface === undefined,
      ),
    ).toBe(true);
  });

  it('rejects wrong granular roles, construction domains, and pattern kinds', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-paving-construction-rejection-'));
    const source = compileIrregularPaving(createHistoricSettPavingDefinition());
    const geometryPath = await saveGeometry(join(directory, 'source/paving.json'), source.geometry);
    const validJoint = createPavingGranularSurfaceMaterial('natural-grit');
    const validSubstrate = createPavingGranularSurfaceMaterial('compacted-base');
    const jointPath = await saveSurfaceMaterial(
      join(directory, 'materials/joint.json'),
      validJoint,
    );
    const substratePath = await saveSurfaceMaterial(
      join(directory, 'materials/substrate.json'),
      validSubstrate,
    );
    await expect(
      bindPavingConstructionMaterials({
        pavingGeometryPath: geometryPath,
        jointMaterialPath: substratePath,
        substrateMaterialPath: jointPath,
        outputGeometryPath: join(directory, 'wrong-role/paving.json'),
      }),
    ).rejects.toThrow(/wrong granular kind/u);

    const wrongDomain = structuredClone(validJoint);
    wrongDomain.metadata.constructionDomain = 'flat-ground-surface';
    const wrongDomainPath = await saveSurfaceMaterial(
      join(directory, 'materials/wrong-domain.json'),
      wrongDomain,
    );
    await expect(
      bindPavingConstructionMaterials({
        pavingGeometryPath: geometryPath,
        jointMaterialPath: wrongDomainPath,
        substrateMaterialPath: substratePath,
        outputGeometryPath: join(directory, 'wrong-domain/paving.json'),
      }),
    ).rejects.toThrow(/wrong construction domain/u);

    const wrongPattern = structuredClone(validJoint);
    wrongPattern.pattern = { kind: 'isotropic' };
    const wrongPatternPath = await saveSurfaceMaterial(
      join(directory, 'materials/wrong-pattern.json'),
      wrongPattern,
    );
    await expect(
      bindPavingConstructionMaterials({
        pavingGeometryPath: geometryPath,
        jointMaterialPath: wrongPatternPath,
        substrateMaterialPath: substratePath,
        outputGeometryPath: join(directory, 'wrong-pattern/paving.json'),
      }),
    ).rejects.toThrow(/wrong pattern kind/u);
  });

  it('rejects missing or overlapping construction targets without replacing prior output', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-paving-construction-target-'));
    const source = compileIrregularPaving(createHistoricSettPavingDefinition());
    const jointPath = await saveSurfaceMaterial(
      join(directory, 'materials/joint.json'),
      createPavingGranularSurfaceMaterial('polymeric-sand'),
    );
    const substratePath = await saveSurfaceMaterial(
      join(directory, 'materials/substrate.json'),
      createPavingGranularSurfaceMaterial('compacted-base'),
    );
    const outputPath = await saveGeometry(join(directory, 'output/paving.json'), source.geometry);
    const originalOutputSha256 = sha256Bytes(await readFile(outputPath));

    const missing = structuredClone(source.geometry);
    const targets = source.report.surfaceMaterialTargets;
    missing.metadata.surfaceMaterialTargets = {
      modeledUnits: targets.modeledUnits,
      continuousJoint: targets.continuousJoint,
      borders: targets.borders,
    };
    const missingPath = await saveGeometry(join(directory, 'source/missing.json'), missing);
    await expect(
      bindPavingConstructionMaterials({
        pavingGeometryPath: missingPath,
        jointMaterialPath: jointPath,
        substrateMaterialPath: substratePath,
        outputGeometryPath: outputPath,
      }),
    ).rejects.toThrow();
    expect(sha256Bytes(await readFile(outputPath))).toBe(originalOutputSha256);

    const overlapping = structuredClone(source.geometry);
    overlapping.metadata.surfaceMaterialTargets = {
      ...targets,
      continuousSubstrate: targets.continuousJoint,
    };
    const overlappingPath = await saveGeometry(
      join(directory, 'source/overlapping.json'),
      overlapping,
    );
    await expect(
      bindPavingConstructionMaterials({
        pavingGeometryPath: overlappingPath,
        jointMaterialPath: jointPath,
        substrateMaterialPath: substratePath,
        outputGeometryPath: outputPath,
      }),
    ).rejects.toThrow(/mutually disjoint/u);
    expect(sha256Bytes(await readFile(outputPath))).toBe(originalOutputSha256);
  });
});
