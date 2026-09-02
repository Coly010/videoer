import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bindPavingConstructionMaterials,
  bindProceduralPavingUnitMaterial,
  bindPavingUnitMaterial,
} from '../src/application/paving-material-assembly.js';
import { sha256Bytes } from '../src/assets/sources/cache.js';
import {
  compileIrregularPaving,
  createHistoricSettPavingDefinition,
  pavingUnitAppearanceAttributeNames,
} from '../src/environments/irregular-paving.js';
import { loadGeometry, saveGeometry } from '../src/geometry/io.js';
import { saveSurfaceMaterial } from '../src/materials/io.js';
import {
  createPavingBorderSurfaceMaterial,
  createPavingBorderSwatch,
} from '../src/materials/paving-border.js';
import { createPavingGranularSurfaceMaterial } from '../src/materials/paving-joint.js';
import { createPavingUnitSurfaceMaterial } from '../src/materials/paving-unit.js';
import { surfaceMaterialSchema, textureMaterialApplicationSchema } from '../src/materials/model.js';
import { createWetCobbleSurfaceMaterial } from '../src/materials/wet-cobble.js';

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

describe('unit-aware paving material assembly', () => {
  it('binds project-owned procedural mineral response through the same typed unit attributes', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-procedural-paving-material-'));
    const source = compileIrregularPaving(createHistoricSettPavingDefinition());
    const geometryPath = await saveGeometry(join(directory, 'source/paving.json'), source.geometry);
    const material = createPavingUnitSurfaceMaterial('historic-cut-granite');
    const materialPath = await saveSurfaceMaterial(join(directory, 'material.json'), material);
    const outputPath = join(directory, 'bound/paving.json');
    const result = await bindProceduralPavingUnitMaterial({
      pavingGeometryPath: geometryPath,
      unitMaterialPath: materialPath,
      outputGeometryPath: outputPath,
    });
    const bound = await loadGeometry(outputPath);
    expect(result.modeledUnitTargets).toEqual(source.report.surfaceMaterialTargets.modeledUnits);
    expect(
      result.modeledUnitTargets.every(
        (id) =>
          bound.materials.find((candidate) => candidate.id === id)?.surface?.id === material.id,
      ),
    ).toBe(true);
    expect(bound.attributes).toEqual(source.geometry.attributes);
    expect(Object.keys(bound.attributes ?? {}).sort()).toEqual(
      Object.values(pavingUnitAppearanceAttributeNames).sort(),
    );
    const edgeWear = bound.attributes?.[pavingUnitAppearanceAttributeNames.edgeWear];
    const dirt = bound.attributes?.[pavingUnitAppearanceAttributeNames.dirtAccumulation];
    expect(edgeWear?.dataType).toBe('float');
    expect(dirt?.dataType).toBe('float');
    if (edgeWear?.dataType === 'float' && dirt?.dataType === 'float') {
      expect(new Set(edgeWear.values)).toEqual(new Set([0, 0.08, 0.18, 0.52, 1]));
      expect(new Set(dirt.values)).toEqual(new Set([0, 0.08, 0.28, 0.58, 0.72, 1]));
      for (let index = 0; index < bound.positions.length; index++) {
        const pair = [edgeWear.values[index], dirt.values[index]];
        const normalY = bound.normals?.[index]?.[1];
        if (pair[0] === 0 && pair[1] === 0) continue; // non-unit border geometry
        if (pair[0] === 0 && pair[1] === 1) expect(normalY).toBeLessThan(-0.99);
        else if ((pair[0] === 0.08 && pair[1] === 0.08) || (pair[0] === 0.52 && pair[1] === 0.58))
          expect(normalY).toBeGreaterThan(0.99);
        else if (pair[0] === 1 && pair[1] === 0.28) {
          expect(normalY).toBeGreaterThan(0);
          expect(normalY).toBeLessThan(0.99);
        } else if (pair[0] === 0.18 && pair[1] === 0.72)
          expect(Math.abs(normalY ?? 1)).toBeLessThan(0.01);
        else throw new Error(`Unexpected paving semantic pair ${pair.join('/')}`);
      }
    }
    expect(material.pattern).toMatchObject({ kind: 'cut-stone', grainScaleMeters: 0.006 });
    expect(material.historyResponse).toMatchObject({
      longTermExposure: { colorMultiplier: 1.025, roughnessOffset: 0.025 },
    });
    expect(material.historyResponseV3).toMatchObject({
      exposureWeathering: { colorMultiplier: 1.025, roughnessOffset: 0.025 },
    });
    expect(material.surfaceHistoryV3Participation).toEqual({ policy: 'optical-response' });
    expect(material.metadata).toMatchObject({
      constructionDomain: 'modeled-paving-unit',
      provenance: 'project-owned-procedural-definition',
    });
  }, 10_000);

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
        unitVariation: {
          kind: 'vertex-scalar-attributes-v1',
          valueAttribute: 'videoer_unit_value_variation',
          roughnessAttribute: 'videoer_unit_roughness_variation',
          weatheringAttribute: 'videoer_unit_weathering_variation',
          valueAmplitude: 0.08,
          roughnessAmplitude: 0.06,
          weatheringAmplitude: 0.2,
        },
      },
    });
    expect(() =>
      surfaceMaterialSchema.parse({
        ...material,
        unitVariation: createPavingUnitSurfaceMaterial('historic-cut-granite').unitVariation,
        textureMaps: { ...material.textureMaps!, application },
      }),
    ).toThrow(/cannot be declared together/u);
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
    expect(Object.keys(bound.attributes ?? {}).sort()).toEqual([
      'videoer_paving_dirt_accumulation',
      'videoer_paving_edge_wear',
      'videoer_unit_roughness_variation',
      'videoer_unit_value_variation',
      'videoer_unit_weathering_variation',
    ]);
    expect(
      new Set(
        (bound.attributes!.videoer_unit_value_variation!.values as number[]).map((value) =>
          value.toFixed(6),
        ),
      ).size,
    ).toBeGreaterThan(100);

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

  it('rejects out-of-range semantic masks and stale construction targets atomically', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-procedural-paving-fail-closed-'));
    const source = compileIrregularPaving(createHistoricSettPavingDefinition());
    const materialPath = await saveSurfaceMaterial(
      join(directory, 'material.json'),
      createPavingUnitSurfaceMaterial('historic-cut-granite'),
    );
    const outputPath = join(directory, 'bound/paving.json');
    await mkdir(join(directory, 'bound'), { recursive: true });
    await writeFile(outputPath, 'preserve-existing-output\n');

    const invalidRange = structuredClone(source.geometry);
    const edge = invalidRange.attributes![pavingUnitAppearanceAttributeNames.edgeWear]!;
    if (edge.dataType !== 'float') throw new Error('Fixture edge-wear attribute must be scalar');
    edge.values[0] = 1.2;
    const invalidRangePath = await saveGeometry(
      join(directory, 'invalid-range.json'),
      invalidRange,
    );
    await expect(
      bindProceduralPavingUnitMaterial({
        pavingGeometryPath: invalidRangePath,
        unitMaterialPath: materialPath,
        outputGeometryPath: outputPath,
      }),
    ).rejects.toThrow(/must remain within \[0, 1\]/u);
    expect(await readFile(outputPath, 'utf8')).toBe('preserve-existing-output\n');

    const staleTargets = structuredClone(source.geometry);
    const targetMetadata = staleTargets.metadata.surfaceMaterialTargets as {
      continuousJoint: string;
    };
    targetMetadata.continuousJoint = 'missing-continuous-joint';
    const stalePath = await saveGeometry(join(directory, 'stale-target.json'), staleTargets);
    await expect(
      bindProceduralPavingUnitMaterial({
        pavingGeometryPath: stalePath,
        unitMaterialPath: materialPath,
        outputGeometryPath: outputPath,
      }),
    ).rejects.toThrow(/is absent/u);
    expect(await readFile(outputPath, 'utf8')).toBe('preserve-existing-output\n');
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
    for (const target of [targets.continuousJoint, targets.continuousSubstrate]) {
      const surface = bound.materials.find((material) => material.id === target)?.surface;
      expect(surface?.surfaceHistoryV3Participation).toEqual({ policy: 'optical-response' });
      expect(surface?.historyResponseV3).toBeDefined();
      expect(surface?.dirtMassResponse).toBeDefined();
    }
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

  it('binds every declared border target in the same atomic construction transaction', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-paving-border-material-'));
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
    const kerbPath = await saveSurfaceMaterial(
      join(directory, 'materials/kerb.json'),
      createPavingBorderSurfaceMaterial('historic-granite-kerb'),
    );
    const gutterPath = await saveSurfaceMaterial(
      join(directory, 'materials/gutter.json'),
      createPavingBorderSurfaceMaterial('historic-dark-stone-gutter'),
    );
    const outputPath = join(directory, 'bound/paving.json');
    const targets = source.report.surfaceMaterialTargets;
    const swatch = createPavingBorderSwatch('historic-granite-kerb');
    expect(swatch.metadata).toMatchObject({
      generator: 'videoer.paving-border-swatch.v1',
      pavingBorderMaterialKind: 'historic-granite-kerb',
    });
    expect(swatch.materials[0]?.surface?.pavingBorder?.compatibleKinds).toContain('kerb');

    const result = await bindPavingConstructionMaterials({
      pavingGeometryPath: geometryPath,
      jointMaterialPath: jointPath,
      substrateMaterialPath: substratePath,
      borderMaterialPaths: {
        'granite-kerb': kerbPath,
        'dark-stone-gutter': gutterPath,
      },
      outputGeometryPath: outputPath,
    });
    const bound = await loadGeometry(outputPath);

    expect(result.borderTargets).toEqual([...targets.borders].sort());
    expect(result.materials.borders).toEqual({
      'dark-stone-gutter': 'material.paving-border-historic-dark-stone-gutter',
      'granite-kerb': 'material.paving-border-historic-granite-kerb',
    });
    for (const target of targets.borders) {
      const surface = bound.materials.find((material) => material.id === target)?.surface;
      expect(surface?.metadata.constructionDomain).toBe('paving-border');
      expect(surface?.surfaceHistoryV3Participation).toEqual({ policy: 'optical-response' });
      expect(surface?.historyResponseV3).toBeDefined();
      expect(surface?.dirtMassResponse).toBeDefined();
    }
  });

  it('rejects incomplete, extra and wrong-kind border bindings without replacing prior output', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-paving-border-rejection-'));
    const source = compileIrregularPaving(createHistoricSettPavingDefinition());
    const geometryPath = await saveGeometry(join(directory, 'source/paving.json'), source.geometry);
    const jointPath = await saveSurfaceMaterial(
      join(directory, 'materials/joint.json'),
      createPavingGranularSurfaceMaterial('polymeric-sand'),
    );
    const substratePath = await saveSurfaceMaterial(
      join(directory, 'materials/substrate.json'),
      createPavingGranularSurfaceMaterial('compacted-base'),
    );
    const kerbPath = await saveSurfaceMaterial(
      join(directory, 'materials/kerb.json'),
      createPavingBorderSurfaceMaterial('historic-granite-kerb'),
    );
    const gutterPath = await saveSurfaceMaterial(
      join(directory, 'materials/gutter.json'),
      createPavingBorderSurfaceMaterial('historic-dark-stone-gutter'),
    );
    const outputPath = await saveGeometry(join(directory, 'output/paving.json'), source.geometry);
    const originalOutputSha256 = sha256Bytes(await readFile(outputPath));
    const common = {
      pavingGeometryPath: geometryPath,
      jointMaterialPath: jointPath,
      substrateMaterialPath: substratePath,
      outputGeometryPath: outputPath,
    };

    await expect(
      bindPavingConstructionMaterials({
        ...common,
        borderMaterialPaths: { 'granite-kerb': kerbPath },
      }),
    ).rejects.toThrow(/exactly match live targets.*missing/u);
    expect(sha256Bytes(await readFile(outputPath))).toBe(originalOutputSha256);

    await expect(
      bindPavingConstructionMaterials({
        ...common,
        borderMaterialPaths: {
          'granite-kerb': kerbPath,
          'dark-stone-gutter': gutterPath,
          'not-a-live-border': kerbPath,
        },
      }),
    ).rejects.toThrow(/extra \[not-a-live-border\]/u);
    expect(sha256Bytes(await readFile(outputPath))).toBe(originalOutputSha256);

    await expect(
      bindPavingConstructionMaterials({
        ...common,
        borderMaterialPaths: {
          'granite-kerb': gutterPath,
          'dark-stone-gutter': gutterPath,
        },
      }),
    ).rejects.toThrow(/incompatible with target 'granite-kerb'/u);
    expect(sha256Bytes(await readFile(outputPath))).toBe(originalOutputSha256);

    const incompleteGutter = createPavingBorderSurfaceMaterial('historic-dark-stone-gutter');
    if (incompleteGutter.constructionSurfaceResponse?.kind !== 'paving-border')
      throw new Error('Gutter fixture lacks paving-border response');
    incompleteGutter.constructionSurfaceResponse.gutterZones = undefined;
    const incompleteGutterPath = join(directory, 'materials/incomplete-gutter.json');
    await writeFile(incompleteGutterPath, `${JSON.stringify(incompleteGutter, null, 2)}\n`, 'utf8');
    await expect(
      bindPavingConstructionMaterials({
        ...common,
        borderMaterialPaths: {
          'granite-kerb': kerbPath,
          'dark-stone-gutter': incompleteGutterPath,
        },
      }),
    ).rejects.toThrow(/gutter-compatible material requires gutter zones/u);
    expect(sha256Bytes(await readFile(outputPath))).toBe(originalOutputSha256);
  });

  it('cross-validates explicit surface-history v3 optical and transport-only policies', () => {
    const optical = createPavingUnitSurfaceMaterial('historic-cut-granite');
    expect(
      createPavingBorderSurfaceMaterial('contemporary-channel-stone').pavingBorder?.compatibleKinds,
    ).toEqual(['gutter']);
    expect(
      createPavingBorderSurfaceMaterial('contemporary-concrete-kerb').pavingBorder?.compatibleKinds,
    ).toEqual(['kerb', 'soldier-course']);
    expect(() => surfaceMaterialSchema.parse({ ...optical, historyResponseV3: undefined })).toThrow(
      /optical participation requires historyResponseV3/u,
    );
    expect(() => surfaceMaterialSchema.parse({ ...optical, dirtMassResponse: undefined })).toThrow(
      /optical participation requires dirtMassResponse/u,
    );
    expect(() =>
      surfaceMaterialSchema.parse({
        ...optical,
        surfaceHistoryV3Participation: {
          policy: 'transport-only',
          rationale: 'Hydrology-only diagnostic receiver.',
        },
      }),
    ).toThrow(/transport-only participation forbids/u);
    expect(
      surfaceMaterialSchema.parse({
        ...optical,
        historyResponseV3: undefined,
        dirtMassResponse: undefined,
        surfaceHistoryV3Participation: {
          policy: 'transport-only',
          rationale: 'Hydrology-only diagnostic receiver.',
        },
      }).surfaceHistoryV3Participation,
    ).toEqual({
      policy: 'transport-only',
      rationale: 'Hydrology-only diagnostic receiver.',
    });
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
    const wrongDomainPath = join(directory, 'materials/wrong-domain.json');
    await writeFile(wrongDomainPath, `${JSON.stringify(wrongDomain, null, 2)}\n`, 'utf8');
    await expect(
      bindPavingConstructionMaterials({
        pavingGeometryPath: geometryPath,
        jointMaterialPath: wrongDomainPath,
        substrateMaterialPath: substratePath,
        outputGeometryPath: join(directory, 'wrong-domain/paving.json'),
      }),
    ).rejects.toThrow(/requires paving-joint-substrate material metadata/u);

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

    const missingResponse = structuredClone(validJoint);
    missingResponse.constructionSurfaceResponse = undefined;
    const missingResponsePath = join(directory, 'materials/missing-response.json');
    await writeFile(missingResponsePath, `${JSON.stringify(missingResponse, null, 2)}\n`, 'utf8');
    await expect(
      bindPavingConstructionMaterials({
        pavingGeometryPath: geometryPath,
        jointMaterialPath: missingResponsePath,
        substrateMaterialPath: substratePath,
        outputGeometryPath: join(directory, 'missing-response/paving.json'),
      }),
    ).rejects.toThrow(/requires natural-joint construction response/u);
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
