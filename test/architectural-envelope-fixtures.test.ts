import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArchitecturalEnvelopeTransferFixtures } from '../src/application/architectural-envelope-fixtures.js';
import { loadCinematicScene } from '../src/cinematic/io.js';

describe('architectural envelope transfer fixture application', () => {
  it('persists deterministic structural evidence and two visual intents for unrelated hosts', async () => {
    const output = join(tmpdir(), `videoer-envelope-fixtures-${process.pid}-${Date.now()}`);
    const result = await createArchitecturalEnvelopeTransferFixtures(output, { render: false });

    expect(result.hosts.map((host) => host.host)).toEqual([
      'historic-masonry-shopfront',
      'contemporary-plaster-mixed-use',
    ]);
    for (const host of result.hosts) {
      expect(host.envelope.geometryValid).toBe(true);
      expect(host.envelope.apertures.every((aperture) => aperture.centreRayClear)).toBe(true);
      expect(host.paving.supportQueryCoverage.hits).toBe(host.paving.supportQueryCoverage.samples);
      expect(host.scenes.map((item) => item.intent)).toEqual(['neutral-diagnostic', 'wet-night']);
      const scenes = await Promise.all(host.scenes.map((item) => loadCinematicScene(item.sceneFile)));
      expect(scenes.every((item) => item.renderProfile.engine === 'cycles-cpu')).toBe(true);
      expect(scenes.every((item) => item.renderGates.some((gate) => gate.id === 'host-presence'))).toBe(true);
      expect(scenes.flatMap((item) => item.entities).every((entity) => !isAbsolute(entity.geometryPath))).toBe(true);
      expect(scenes.every((item) => item.landmarks.some((landmark) => landmark.id === 'aperture-depth'))).toBe(true);
      expect(scenes.every((item) => item.landmarks.some((landmark) => landmark.id === 'paving-relief'))).toBe(true);
      expect(scenes.flatMap((item) => item.entities).every((entity) => !entity.id.includes('benchmark'))).toBe(true);
      expect(
        scenes.every((item) => item.entities.some((entity) => entity.id.includes('architectural-envelope'))),
      ).toBe(true);
      expect(
        scenes.every((item) => item.entities.some((entity) => entity.id.startsWith('dressing-'))),
      ).toBe(true);
      expect(host.compatibility.excluded).toEqual([]);
    }
    expect(result.hosts[0]!.compatibility.compatible).toContain('projecting-sign');
    expect(result.hosts[1]!.compatibility.compatible).toEqual([
      'projecting-canopy',
      'inset-window:office-west-window',
      'inset-window:office-east-window',
      'hinged-glazed-door:lobby-door',
      'hinged-glazed-door:service-door',
      'architectural-shopfront:studio-window',
    ]);
    const report = JSON.parse(await readFile(join(output, 'fixture-report.json'), 'utf8')) as { status: string };
    expect(report.status).toBe('candidate-awaiting-visual-acceptance');
  });
});
