import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bindArchitecturalEnvelopeMaterials } from '../src/application/architectural-envelope-material-assembly.js';
import {
  compileArchitecturalEnvelope,
  createContemporaryMixedUseEnvelopeDefinition,
  createHistoricShopfrontEnvelopeDefinition,
} from '../src/environments/architectural-envelope.js';
import { saveGeometry } from '../src/geometry/io.js';
import { createArchitecturalEnvelopeSurfaceProfile } from '../src/materials/architectural-envelope.js';
import { saveSurfaceMaterial } from '../src/materials/io.js';

async function fixture(host: 'historic-masonry-shopfront' | 'contemporary-plaster-mixed-use') {
  const directory = await mkdtemp(join(tmpdir(), 'videoer-envelope-materials-'));
  const compiled = compileArchitecturalEnvelope(
    host === 'historic-masonry-shopfront'
      ? createHistoricShopfrontEnvelopeDefinition()
      : createContemporaryMixedUseEnvelopeDefinition(),
  );
  const geometryPath = await saveGeometry(join(directory, 'source.json'), compiled.geometry);
  const profile = createArchitecturalEnvelopeSurfaceProfile(host);
  const materialPaths: Record<string, string> = {};
  for (const [target, material] of Object.entries(profile))
    materialPaths[target] = await saveSurfaceMaterial(
      join(directory, 'materials', target, 'material.json'),
      material,
    );
  return { directory, compiled, geometryPath, profile, materialPaths };
}

describe('architectural-envelope material assembly', () => {
  it.each(['historic-masonry-shopfront', 'contemporary-plaster-mixed-use'] as const)(
    'binds exact compatible surfaces across the unrelated %s host',
    async (host) => {
      const source = await fixture(host);
      const first = await bindArchitecturalEnvelopeMaterials({
        envelopeGeometryPath: source.geometryPath,
        materialPaths: source.materialPaths,
        outputGeometryPath: join(source.directory, 'bound-a.json'),
      });
      const second = await bindArchitecturalEnvelopeMaterials({
        envelopeGeometryPath: source.geometryPath,
        materialPaths: source.materialPaths,
        outputGeometryPath: join(source.directory, 'bound-b.json'),
      });

      expect(first.geometry).toEqual(second.geometry);
      expect(first.geometry.positions).toEqual(source.compiled.geometry.positions);
      expect(first.geometry.indices).toEqual(source.compiled.geometry.indices);
      expect(first.geometry.materialGroups).toEqual(source.compiled.geometry.materialGroups);
      expect(first.geometry.attachments).toEqual(source.compiled.geometry.attachments);
      expect(first.report).toMatchObject({
        exactCoverage: true,
        topologyPreserved: true,
        unboundTargetCount: 0,
      });
      expect(first.report.bindings).toHaveLength(Object.keys(source.profile).length);
      expect(first.geometry.materials.every((material) => material.surface !== undefined)).toBe(
        true,
      );
    },
  );

  it('rejects missing and extra target bindings instead of retaining a fallback', async () => {
    const source = await fixture('contemporary-plaster-mixed-use');
    const missing = { ...source.materialPaths };
    delete missing['flat-roof-membrane'];
    await expect(
      bindArchitecturalEnvelopeMaterials({
        envelopeGeometryPath: source.geometryPath,
        materialPaths: missing,
        outputGeometryPath: join(source.directory, 'missing.json'),
      }),
    ).rejects.toThrow(/missing \[flat-roof-membrane\]/u);

    await expect(
      bindArchitecturalEnvelopeMaterials({
        envelopeGeometryPath: source.geometryPath,
        materialPaths: { ...source.materialPaths, invented: source.materialPaths['dark-room']! },
        outputGeometryPath: join(source.directory, 'extra.json'),
      }),
    ).rejects.toThrow(/extra \[invented\]/u);
  });

  it('rejects a surface authored for a different target and role', async () => {
    const source = await fixture('contemporary-plaster-mixed-use');
    await expect(
      bindArchitecturalEnvelopeMaterials({
        envelopeGeometryPath: source.geometryPath,
        materialPaths: {
          ...source.materialPaths,
          'flat-roof-membrane': source.materialPaths['painted-metal-interior']!,
        },
        outputGeometryPath: join(source.directory, 'wrong-role.json'),
      }),
    ).rejects.toThrow(/authored for target 'painted-metal-interior'/u);
  });
});
