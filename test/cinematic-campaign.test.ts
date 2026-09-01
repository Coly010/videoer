import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDeclarativeCinematicCampaign } from '../src/application/cinematic-campaign.js';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../src/assets/library.js';
import { declarativeCinematicCampaignSchema } from '../src/production/cinematic-campaign.js';
import { createHumanoidMannequin } from '../src/characters/mannequin.js';
import { createEnglishSpeechMorphRig } from '../src/characters/speech-rig.js';
import { loadGeometry, saveGeometry } from '../src/geometry/io.js';
import { loadMotionClip } from '../src/motion/io.js';
import { saveMotionClip } from '../src/motion/io.js';
import { createWalkStyleMotion } from '../src/motion/walk.js';
import { createTurnMotion } from '../src/interactions/synthesis.js';
import { saveAtmosphericVfx } from '../src/vfx/io.js';
import { createRainyDuskVfx } from '../src/vfx/rainy-dusk.js';
import { saveSurfaceMaterial } from '../src/materials/io.js';
import { createWetCobbleSurfaceMaterial } from '../src/materials/wet-cobble.js';
import { surfaceMaterialSchema } from '../src/materials/model.js';
import { sha256Bytes } from '../src/assets/sources/cache.js';
import { extractMaterialGeometry } from '../src/geometry/extract.js';
import { saveLightingRig } from '../src/lighting/io.js';
import { saveTitleTreatment } from '../src/titles/io.js';
import { createRiseOfDemonsTitleTreatment } from '../src/titles/treatment.js';
import { saveCinematicFinishProfile } from '../src/finishing/io.js';
import { createSoftAtmosphericFinishProfile } from '../src/finishing/model.js';
import YAML from 'yaml';

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

function campaignFixture() {
  return {
    schemaVersion: 1,
    id: 'campaign.declarative-test',
    fps: 24,
    resolution: { width: 160, height: 240, percentage: 100 },
    geometry: [
      {
        id: 'product',
        path: 'work/product.json',
        recipe: {
          assetId: 'prop.declarative-test',
          primitives: [
            {
              kind: 'box',
              minimum: [-0.5, 0, -0.1],
              maximum: [0.5, 1, 0.1],
              materialId: 'body',
            },
          ],
          materials: [
            {
              id: 'body',
              baseColor: [0.1, 0.2, 0.3, 1],
              roughness: 0.5,
              metallic: 0,
              emission: [0, 0, 0],
              emissionStrength: 0,
            },
          ],
          attachments: {
            focus: { position: [0, 0.5, 0] },
            camera: { position: [1, 1, -3] },
          },
        },
      },
    ],
    overlays: [],
    soundtrackPath: 'work/audio.wav',
    soundtrack: {
      schemaVersion: 1,
      id: 'audio.declarative-test',
      durationSeconds: 1,
      sampleRate: 48000,
      channels: 2,
      cues: [
        {
          id: 'tone',
          kind: 'tone-bed',
          startSeconds: 0,
          endSeconds: 1,
          gain: 0.05,
          frequencyHz: 220,
          purpose: 'Deterministic integration test',
        },
      ],
    },
    shots: [
      {
        id: 'product-shot',
        frames: 24,
        entities: [{ id: 'product', geometry: 'product', role: 'prop' }],
        camera: {
          keyframes: [
            {
              time: 0,
              position: { entityId: 'product', attachmentId: 'camera' },
              target: { entityId: 'product', attachmentId: 'focus' },
              lensMillimeters: 50,
            },
            {
              time: 1,
              position: { entityId: 'product', attachmentId: 'camera', offset: [0, 0, 0.2] },
              target: { entityId: 'product', attachmentId: 'focus' },
              lensMillimeters: 55,
            },
          ],
        },
        lights: [
          {
            id: 'key',
            type: 'area',
            position: [0, 2, -2],
            target: [0, 0.5, 0],
            color: [1, 1, 1],
            energy: 400,
          },
        ],
        landmarks: [
          { id: 'start', progress: 0, description: 'Start' },
          { id: 'end', progress: 1, description: 'End' },
        ],
      },
    ],
    delivery: { id: 'edit.declarative-test', directory: 'delivery' },
  };
}

describe('declarative cinematic campaigns', () => {
  it('owns the complete reference benchmark as declarative data', async () => {
    const source = YAML.parse(
      await readFile(
        resolve('campaigns/reference-cinematic-benchmark/cinematic-campaign.yaml'),
        'utf8',
      ),
    );
    const campaign = declarativeCinematicCampaignSchema.parse(source);
    expect(campaign.shots.map((shot) => shot.frames)).toEqual([34, 58, 43, 38, 43, 53, 43, 48]);
    expect(campaign.shots.reduce((sum, shot) => sum + shot.frames, 0)).toBe(360);
    expect(campaign.metadata.bespokeOrchestrationSourceFiles).toBe(0);
    expect(campaign.lightingSources).toHaveLength(2);
    expect(campaign.overlays.some((overlay) => 'library' in overlay)).toBe(true);
  });

  it('builds geometry, semantic scenes, soundtrack, and edit plan with zero bespoke orchestrator', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-declarative-campaign-'));
    const campaignFile = join(directory, 'campaign.json');
    await writeFile(campaignFile, JSON.stringify(campaignFixture()), 'utf8');
    const result = await buildDeclarativeCinematicCampaign(campaignFile, { render: false });
    const scene = JSON.parse(
      await readFile(join(directory, 'work/scenes/product-shot/scene.json'), 'utf8'),
    );
    const report = JSON.parse(await readFile(result.reportFile, 'utf8'));
    expect(scene.camera.keyframes[0]).toMatchObject({
      position: [1, 1, -3],
      target: [0, 0.5, 0],
    });
    expect(report).toMatchObject({ bespokeOrchestrationSourceFiles: 0, generatedGeometry: 1 });
  });

  it('resolves a renderer-independent cinematic finish into scene delivery', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-declarative-finish-'));
    await saveCinematicFinishProfile(
      join(directory, 'work/finish.json'),
      createSoftAtmosphericFinishProfile(),
    );
    const fixture = campaignFixture();
    Object.assign(fixture, {
      finishSources: [{ id: 'soft-finish', path: 'work/finish.json' }],
    });
    Object.assign(fixture.shots[0]!, { finish: 'soft-finish' });
    const campaignFile = join(directory, 'campaign.json');
    await writeFile(campaignFile, JSON.stringify(fixture), 'utf8');
    const result = await buildDeclarativeCinematicCampaign(campaignFile, { render: false });
    const scene = JSON.parse(
      await readFile(join(directory, 'work/scenes/product-shot/scene.json'), 'utf8'),
    );
    const editPlan = JSON.parse(
      await readFile(join(directory, 'work/edit/edit-plan.json'), 'utf8'),
    );
    const report = JSON.parse(await readFile(result.reportFile, 'utf8'));
    expect(resolve(join(directory, 'work/scenes/product-shot'), scene.finishProfilePath)).toBe(
      join(directory, 'work/finish.json'),
    );
    expect(editPlan.clips[0].path).toMatch(/product-shot-finished\.mp4$/);
    expect(report.reusedFinishSources).toBe(1);
  });

  it('rejects unknown asset references and soundtrack/edit duration drift', () => {
    const fixture = campaignFixture();
    fixture.shots[0]!.entities[0]!.geometry = 'missing';
    fixture.soundtrack.durationSeconds = 2;
    expect(() => declarativeCinematicCampaignSchema.parse(fixture)).toThrow(
      /unknown geometry source|soundtrack duration/,
    );
  });

  it('rejects unknown cinematic finish references', () => {
    const fixture = campaignFixture();
    Object.assign(fixture.shots[0]!, { finish: 'missing-finish' });
    expect(() => declarativeCinematicCampaignSchema.parse(fixture)).toThrow(
      /unknown cinematic finish source/,
    );
  });

  it('rejects non-geometry publication types on geometry recipes', () => {
    const fixture = campaignFixture();
    const recipe: Record<string, unknown> = fixture.geometry[0]!.recipe;
    recipe.assetId = 'vfx.declarative-test';
    recipe.publication = {
      assetId: 'vfx.declarative-test',
      version: '1.0.0',
      type: 'vfx',
      title: 'Invalid geometry publication',
      description: 'A geometry recipe must not publish through a non-geometry asset domain.',
      capabilities: ['invalid-test'],
      generator: 'test',
      verification: { checks: ['geometry.valid'], shots: ['product-shot'] },
    };
    expect(() => declarativeCinematicCampaignSchema.parse(fixture)).toThrow(
      /geometry publication must use a geometry asset type/,
    );
  });

  it('resolves reusable lighting rigs and reviewed image overlays from the library', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-declarative-lighting-overlay-'));
    const lightingDirectory = join(directory, 'library/environments/test-lighting/1.0.0');
    await saveLightingRig(join(lightingDirectory, 'lighting-rig.json'), {
      schemaVersion: 1,
      id: 'environment.test-lighting',
      exposure: { look: 'AgX - Medium High Contrast', coherentAcrossShots: true },
      worldColor: [0.01, 0.02, 0.03],
      lights: [
        {
          id: 'library-key',
          type: 'area',
          position: [1, 2, -2],
          target: [0, 0.5, 0],
          color: [0.8, 0.9, 1],
          energy: 450,
          sizeMeters: 1.5,
          angleDegrees: 45,
          purpose: 'key',
        },
      ],
      metadata: {},
    });
    await writeHashedAssetMetadata(
      join(lightingDirectory, 'asset.yaml'),
      assetMetadataSchema.parse({
        schemaVersion: 1,
        id: 'environment.test-lighting',
        version: '1.0.0',
        type: 'environment',
        title: 'Test lighting rig',
        description: 'Verified reusable lighting fixture.',
        status: 'verified',
        tags: ['lighting-rig'],
        capabilities: ['reusable-rig'],
        source: {
          kind: 'procedural',
          references: [],
          licence: {
            spdx: 'LicenseRef-Test',
            name: 'Test fixture',
            commercialUse: 'allowed',
            attributionRequired: false,
          },
          clearance: 'approved',
        },
        artifacts: [
          {
            role: 'lighting-rig',
            path: 'lighting-rig.json',
            mediaType: 'application/vnd.videoer.lighting+json',
          },
        ],
        compatibility: { renderers: ['blender-headless'], requires: [] },
        verification: {
          checks: ['lighting.reusable-rig-schema'],
          artifacts: [],
          verifiedAt: new Date().toISOString(),
        },
      }),
    );
    const overlayDirectory = join(directory, 'library/materials/test-overlay/1.0.0');
    await mkdir(overlayDirectory, { recursive: true });
    await writeFile(join(overlayDirectory, 'overlay.png'), 'deterministic-test-overlay', 'utf8');
    await writeHashedAssetMetadata(
      join(overlayDirectory, 'asset.yaml'),
      assetMetadataSchema.parse({
        schemaVersion: 1,
        id: 'material.test-overlay',
        version: '1.0.0',
        type: 'material',
        title: 'Test editorial overlay',
        description: 'Verified persisted editorial image fixture.',
        status: 'verified',
        tags: ['editorial'],
        capabilities: ['deterministic-render'],
        source: {
          kind: 'self-authored',
          references: [],
          licence: {
            spdx: 'LicenseRef-Test',
            name: 'Test fixture',
            commercialUse: 'allowed',
            attributionRequired: false,
          },
          clearance: 'approved',
        },
        artifacts: [{ role: 'transparent-overlay', path: 'overlay.png', mediaType: 'image/png' }],
        compatibility: { renderers: ['blender-headless'], requires: [] },
        verification: {
          checks: ['editorial.reviewed-image'],
          artifacts: [],
          verifiedAt: new Date().toISOString(),
        },
      }),
    );
    const fixture = campaignFixture();
    Object.assign(fixture, {
      assetLibrary: 'library',
      lightingSources: [
        {
          id: 'studio-lighting',
          library: {
            type: 'environment',
            query: 'test lighting',
            tags: ['lighting-rig'],
            capabilities: ['reusable-rig'],
            preferredAsset: { id: 'environment.test-lighting', version: '1.0.0' },
            artifactRole: 'lighting-rig',
          },
        },
      ],
      overlays: [
        {
          id: 'reviewed-title',
          library: {
            type: 'material',
            query: 'test overlay',
            tags: ['editorial'],
            capabilities: ['deterministic-render'],
            preferredAsset: { id: 'material.test-overlay', version: '1.0.0' },
            artifactRole: 'transparent-overlay',
          },
        },
      ],
    });
    Object.assign(fixture.shots[0]!, {
      lighting: 'studio-lighting',
      lights: [],
      overlays: [
        {
          overlay: 'reviewed-title',
          startSeconds: 0,
          endSeconds: 1,
          opacity: 1,
          fadeInSeconds: 0,
          fadeOutSeconds: 0,
        },
      ],
    });
    const campaignFile = join(directory, 'campaign.json');
    await writeFile(campaignFile, JSON.stringify(fixture), 'utf8');
    await buildDeclarativeCinematicCampaign(campaignFile, { render: false });
    const scene = JSON.parse(
      await readFile(join(directory, 'work/scenes/product-shot/scene.json'), 'utf8'),
    );
    expect(scene.lights.map((light: { id: string }) => light.id)).toEqual(['library-key']);
    expect(scene.overlays[0].imagePath).toContain(
      'library/materials/test-overlay/1.0.0/overlay.png',
    );
    const manifest = YAML.parse(
      await readFile(join(directory, 'work/asset-manifest.yaml'), 'utf8'),
    );
    expect(manifest.resolutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requirementId: 'studio-lighting', decision: 'reuse' }),
        expect.objectContaining({ requirementId: 'reviewed-title', decision: 'reuse' }),
      ]),
    );
  });

  it('derives a verified lighting rig through the generic campaign contract', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-declarative-lighting-adaptation-'));
    const assetDirectory = join(directory, 'library/environments/test-lighting/1.0.0');
    await saveLightingRig(join(assetDirectory, 'lighting-rig.json'), {
      schemaVersion: 1,
      id: 'environment.test-lighting',
      exposure: { look: 'AgX - Medium High Contrast', coherentAcrossShots: true },
      worldColor: [0.02, 0.025, 0.04],
      lights: [
        {
          id: 'key',
          type: 'area',
          position: [1, 2, -2],
          target: [0, 0.5, 0],
          color: [1, 0.8, 0.7],
          energy: 500,
          sizeMeters: 1.5,
          angleDegrees: 45,
          purpose: 'key',
        },
      ],
      metadata: {},
    });
    await writeHashedAssetMetadata(
      join(assetDirectory, 'asset.yaml'),
      assetMetadataSchema.parse({
        schemaVersion: 1,
        id: 'environment.test-lighting',
        version: '1.0.0',
        type: 'environment',
        title: 'Test lighting',
        description: 'Verified legacy lighting asset fixture.',
        status: 'verified',
        tags: ['lighting-rig'],
        capabilities: ['reusable-rig'],
        source: {
          kind: 'procedural',
          references: [],
          licence: {
            spdx: 'LicenseRef-Test',
            name: 'Test fixture',
            commercialUse: 'allowed',
            attributionRequired: false,
          },
          clearance: 'approved',
        },
        artifacts: [
          {
            role: 'lighting-rig',
            path: 'lighting-rig.json',
            mediaType: 'application/vnd.videoer.lighting+json',
          },
        ],
        compatibility: { renderers: ['blender-headless'], requires: [] },
        verification: {
          checks: ['lighting.reusable-rig-schema'],
          artifacts: [],
          verifiedAt: new Date().toISOString(),
        },
      }),
    );
    const fixture = campaignFixture();
    Object.assign(fixture, {
      assetLibrary: 'library',
      lightingSources: [
        {
          id: 'gallery-lighting',
          path: 'work/lighting/gallery.json',
          library: {
            type: 'environment',
            query: 'test lighting',
            tags: ['lighting-rig'],
            capabilities: ['reusable-rig', 'gallery-stage'],
            preferredAsset: { id: 'environment.test-lighting', version: '1.0.0' },
            artifactRole: 'lighting-rig',
          },
          adaptation: {
            kind: 'lighting-rig-transform-v1',
            assetId: 'lighting.test-gallery',
            transform: { translation: [1, 0, -2], yawRadians: 0, uniformScale: 1.2 },
            energyScale: 0.8,
            providesCapabilities: ['gallery-stage'],
            publication: {
              assetId: 'lighting.test-gallery',
              version: '1.0.0',
              type: 'lighting',
              title: 'Test gallery lighting',
              description: 'A deterministic derived rig for gallery staging.',
              capabilities: ['reusable-rig', 'gallery-stage'],
              generator: 'videoer.lighting-rig-transform.v1',
              verification: { checks: ['lighting.semantic-transform'], shots: ['product-shot'] },
            },
          },
        },
      ],
    });
    Object.assign(fixture.shots[0]!, { lighting: 'gallery-lighting', lights: [] });
    const campaignFile = join(directory, 'campaign.json');
    await writeFile(campaignFile, JSON.stringify(fixture));
    const result = await buildDeclarativeCinematicCampaign(campaignFile, { render: false });
    const scene = JSON.parse(
      await readFile(join(directory, 'work/scenes/product-shot/scene.json'), 'utf8'),
    );
    const report = JSON.parse(await readFile(result.reportFile, 'utf8'));
    const compatibility = JSON.parse(
      await readFile(
        join(directory, 'work/adaptations/gallery-lighting/compatibility-report.json'),
        'utf8',
      ),
    );
    expect(scene.lights[0]).toMatchObject({ id: 'key', position: [2.2, 2.4, -4.4] });
    expect(compatibility).toMatchObject({
      adaptationKind: 'lighting-rig-transform-v1',
      validation: { valid: true },
      compatibility: { topologyPreserved: true, exposurePreserved: true },
    });
    expect(report).toMatchObject({ adaptedLightingSources: 1, reusedLightingSources: 0 });
  });

  it('derives and renders a first-class editorial treatment through the generic campaign contract', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-declarative-editorial-adaptation-'));
    const assetDirectory = join(directory, 'library/materials/test-title/1.0.0');
    await saveTitleTreatment(
      join(assetDirectory, 'title-treatment.json'),
      createRiseOfDemonsTitleTreatment(),
    );
    await writeHashedAssetMetadata(
      join(assetDirectory, 'asset.yaml'),
      assetMetadataSchema.parse({
        schemaVersion: 1,
        id: 'material.test-title',
        version: '1.0.0',
        type: 'material',
        title: 'Legacy editorial treatment fixture',
        description: 'Verified legacy material-typed editorial treatment.',
        status: 'verified',
        tags: ['editorial', 'title'],
        capabilities: ['deterministic-render', 'threshold-lines'],
        source: {
          kind: 'self-authored',
          references: [],
          licence: {
            spdx: 'LicenseRef-Test-AND-OFL-1.1',
            name: 'Test editorial fixture',
            commercialUse: 'allowed',
            attributionRequired: false,
          },
          clearance: 'approved',
        },
        artifacts: [
          {
            role: 'title-treatment',
            path: 'title-treatment.json',
            mediaType: 'application/vnd.videoer.title+json',
          },
        ],
        compatibility: { renderers: ['ffmpeg-full'], requires: [] },
        verification: {
          checks: ['editorial.treatment-schema'],
          artifacts: [],
          verifiedAt: new Date().toISOString(),
        },
      }),
    );
    const fixture = campaignFixture();
    Object.assign(fixture, {
      resolution: { width: 240, height: 240, percentage: 100 },
      assetLibrary: 'library',
      overlays: [
        {
          id: 'event-lockup',
          path: 'work/editorial/event-lockup.png',
          treatmentPath: 'work/editorial/event-lockup.json',
          library: {
            type: 'material',
            query: 'legacy editorial title',
            tags: ['editorial', 'title'],
            capabilities: ['deterministic-render', 'threshold-lines', 'event-lockup'],
            preferredAsset: { id: 'material.test-title', version: '1.0.0' },
            artifactRole: 'title-treatment',
          },
          adaptation: {
            kind: 'editorial-treatment-v1',
            assetId: 'editorial.test-event-lockup',
            canvas: { width: 240, height: 240 },
            safeAreaMargins: { left: 0.1, top: 0.08, right: 0.1, bottom: 0.08 },
            copy: { eyebrow: 'NEW EXHIBITION', title: 'NOCTURNE', cta: 'OPEN NOW' },
            palette: { background: '#02030a', foreground: '#f2f4ff', accent: '#8ebcff' },
            motifOpacity: 0.28,
            typographyScale: 0.9,
            providesCapabilities: ['event-lockup'],
            publication: {
              assetId: 'editorial.test-event-lockup',
              version: '1.0.0',
              type: 'editorial',
              title: 'Test event lockup',
              description: 'A deterministic bounded editorial treatment fixture.',
              capabilities: ['deterministic-render', 'threshold-lines', 'event-lockup'],
              generator: 'videoer.editorial-treatment.v1',
              verification: {
                checks: ['editorial.safe-area', 'editorial.deterministic-render'],
                shots: ['product-shot'],
              },
            },
          },
        },
      ],
    });
    Object.assign(fixture.shots[0]!, {
      overlays: [
        {
          overlay: 'event-lockup',
          startSeconds: 0,
          endSeconds: 1,
          fadeInSeconds: 0,
          fadeOutSeconds: 0,
        },
      ],
    });
    const campaignFile = join(directory, 'campaign.json');
    await writeFile(campaignFile, JSON.stringify(fixture));
    const result = await buildDeclarativeCinematicCampaign(campaignFile, { render: false });
    const scene = JSON.parse(
      await readFile(join(directory, 'work/scenes/product-shot/scene.json'), 'utf8'),
    );
    const report = JSON.parse(await readFile(result.reportFile, 'utf8'));
    const compatibility = JSON.parse(
      await readFile(
        join(directory, 'work/adaptations/event-lockup/compatibility-report.json'),
        'utf8',
      ),
    );
    expect(scene.overlays[0].imagePath).toBe('../../editorial/event-lockup.png');
    expect(compatibility).toMatchObject({
      adaptationKind: 'editorial-treatment-v1',
      validation: { valid: true },
      compatibility: {
        fontPreserved: true,
        motifPreserved: true,
        exactTreatmentMatched: true,
        deterministicRenderMatched: true,
        linesInsideSafeArea: true,
      },
    });
    expect(report).toMatchObject({ adaptedEditorialSources: 1, reusedEditorialSources: 0 });
  });

  it('resolves and specialises verified atmospheric VFX as a reusable shot source', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-declarative-vfx-'));
    const assetDirectory = join(directory, 'library/vfx/rainy-dusk/1.0.0');
    await mkdir(assetDirectory, { recursive: true });
    await saveAtmosphericVfx(join(assetDirectory, 'vfx.json'), createRainyDuskVfx());
    await writeHashedAssetMetadata(
      join(assetDirectory, 'asset.yaml'),
      assetMetadataSchema.parse({
        schemaVersion: 1,
        id: 'vfx.test-rainy-dusk',
        version: '1.0.0',
        type: 'vfx',
        title: 'Test rainy dusk',
        description: 'Verified deterministic three-depth-band atmospheric fixture.',
        status: 'verified',
        tags: ['rain', 'fog', 'dusk'],
        capabilities: ['camera-depth', 'deterministic-seed'],
        source: {
          kind: 'procedural',
          references: [],
          licence: {
            spdx: 'LicenseRef-Test',
            name: 'Test fixture',
            commercialUse: 'allowed',
            attributionRequired: false,
          },
          clearance: 'approved',
        },
        artifacts: [
          {
            role: 'vfx',
            path: 'vfx.json',
            mediaType: 'application/vnd.videoer.atmospheric-vfx+json',
          },
        ],
        compatibility: { renderers: ['blender-headless'], requires: [] },
        verification: {
          checks: ['vfx.three-depth-bands'],
          artifacts: [],
          verifiedAt: new Date().toISOString(),
        },
      }),
    );
    const fixture = campaignFixture();
    Object.assign(fixture, {
      assetLibrary: 'library',
      vfxSources: [
        {
          id: 'morning-drizzle',
          path: 'work/vfx/morning-drizzle.json',
          library: {
            type: 'vfx',
            query: 'rainy dusk',
            tags: ['rain', 'fog'],
            capabilities: ['camera-depth', 'deterministic-seed', 'restrained-drizzle'],
            preferredAsset: { id: 'vfx.test-rainy-dusk', version: '1.0.0' },
            artifactRole: 'vfx',
          },
          adaptation: {
            kind: 'atmospheric-treatment',
            assetId: 'vfx.test-morning-drizzle',
            providesCapabilities: ['restrained-drizzle'],
            fog: { density: 0.004, color: [0.24, 0.28, 0.34] },
            rain: {
              layers: [
                { id: 'foreground', count: 24, opacity: 0.4 },
                { id: 'midground', count: 64, opacity: 0.3 },
                { id: 'background', count: 96, opacity: 0.18 },
              ],
            },
          },
        },
      ],
    });
    Object.assign(fixture.shots[0]!, { vfx: 'morning-drizzle' });
    const campaignFile = join(directory, 'campaign.json');
    await writeFile(campaignFile, JSON.stringify(fixture), 'utf8');
    const result = await buildDeclarativeCinematicCampaign(campaignFile, { render: false });
    const scene = JSON.parse(
      await readFile(join(directory, 'work/scenes/product-shot/scene.json'), 'utf8'),
    );
    const compatibility = JSON.parse(
      await readFile(
        join(directory, 'work/adaptations/morning-drizzle/compatibility-report.json'),
        'utf8',
      ),
    );
    const manifest = YAML.parse(
      await readFile(join(directory, 'work/asset-manifest.yaml'), 'utf8'),
    );
    const report = JSON.parse(await readFile(result.reportFile, 'utf8'));
    expect(scene.atmosphere).toMatchObject({ fogDensity: 0.004, rain: { enabled: true } });
    expect(scene.atmosphere.rain.layers[0]).toMatchObject({ id: 'foreground', count: 24 });
    expect(compatibility).toMatchObject({
      baseAsset: { id: 'vfx.test-rainy-dusk', version: '1.0.0' },
      operations: {
        placementChanged: false,
        deterministicLayerTopologyChanged: false,
      },
      compatibility: {
        placementPreserved: true,
        deterministicLayerTopologyPreserved: true,
      },
      validation: { valid: true },
    });
    expect(manifest.resolutions).toContainEqual(
      expect.objectContaining({ requirementId: 'morning-drizzle', decision: 'adapt' }),
    );
    expect(report).toMatchObject({ adaptedVfxSources: 1, bespokeOrchestrationSourceFiles: 0 });
  });

  it('resolves, specialises, and binds a verified surface material into scene geometry', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-declarative-material-'));
    const assetDirectory = join(directory, 'library/materials/wet-cobble/1.0.0');
    await mkdir(assetDirectory, { recursive: true });
    await saveSurfaceMaterial(
      join(assetDirectory, 'material.json'),
      createWetCobbleSurfaceMaterial(),
    );
    await writeHashedAssetMetadata(
      join(assetDirectory, 'asset.yaml'),
      assetMetadataSchema.parse({
        schemaVersion: 1,
        id: 'material.test-wet-cobble',
        version: '1.0.0',
        type: 'material',
        title: 'Test wet cobble',
        description: 'Verified procedural-palette wet stone surface fixture.',
        status: 'verified',
        tags: ['stone', 'wet'],
        capabilities: ['procedural-palette', 'wet-surface'],
        source: {
          kind: 'procedural',
          references: [],
          licence: {
            spdx: 'LicenseRef-Test',
            name: 'Test fixture',
            commercialUse: 'allowed',
            attributionRequired: false,
          },
          clearance: 'approved',
        },
        artifacts: [
          {
            role: 'material',
            path: 'material.json',
            mediaType: 'application/vnd.videoer.surface-material+json',
          },
        ],
        compatibility: { renderers: ['blender-headless'], requires: [] },
        verification: {
          checks: ['material.schema'],
          artifacts: [],
          verifiedAt: new Date().toISOString(),
        },
      }),
    );
    const fixture = campaignFixture();
    Object.assign(fixture, {
      assetLibrary: 'library',
      materialSources: [
        {
          id: 'dry-stone',
          path: 'work/materials/dry-stone.json',
          library: {
            type: 'material',
            query: 'wet cobble',
            tags: ['stone'],
            capabilities: ['procedural-palette', 'wet-surface', 'dry-morning-treatment'],
            preferredAsset: { id: 'material.test-wet-cobble', version: '1.0.0' },
            artifactRole: 'material',
          },
          adaptation: {
            kind: 'surface-treatment',
            assetId: 'material.test-dry-stone',
            providesCapabilities: ['dry-morning-treatment'],
            baseColor: { seed: 2718, scaleMeters: 0.38 },
            roughness: { minimum: 0.42, maximum: 0.68, wetness: 0.16 },
          },
        },
      ],
    });
    Object.assign(fixture.geometry[0]!, {
      materialBindings: [{ targetMaterialId: 'body', material: 'dry-stone' }],
    });
    const campaignFile = join(directory, 'campaign.json');
    await writeFile(campaignFile, JSON.stringify(fixture), 'utf8');
    const result = await buildDeclarativeCinematicCampaign(campaignFile, { render: false });
    const geometry = JSON.parse(await readFile(join(directory, 'work/product.json'), 'utf8'));
    const compatibility = JSON.parse(
      await readFile(
        join(directory, 'work/adaptations/dry-stone/compatibility-report.json'),
        'utf8',
      ),
    );
    const report = JSON.parse(await readFile(result.reportFile, 'utf8'));
    expect(geometry.materials[0]).toMatchObject({
      id: 'body',
      roughness: 0.55,
      surface: {
        id: 'material.test-dry-stone',
        baseColor: { kind: 'procedural-palette', seed: 2718 },
        roughness: { wetness: 0.16 },
      },
    });
    expect(compatibility).toMatchObject({
      baseAsset: { id: 'material.test-wet-cobble', version: '1.0.0' },
      compatibility: {
        shadingModelPreserved: true,
        baseColorModelPreserved: true,
        normalModelPreserved: true,
      },
      validation: { valid: true },
    });
    expect(report).toMatchObject({ adaptedMaterialSources: 1, bespokeOrchestrationSourceFiles: 0 });
  });

  it('stages texture-backed material dependencies beside ordinary declarative geometry', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-declarative-texture-material-'));
    const materialDirectory = join(directory, 'source-material');
    await mkdir(join(materialDirectory, 'textures'), { recursive: true });
    const channelDefinitions = [
      ['base-color', 'srgb-texture'],
      ['normal', 'non-color'],
      ['roughness', 'non-color'],
    ] as const;
    const channels = [];
    for (const [semantic, colorSpace] of channelDefinitions) {
      const bytes = Buffer.from(`declarative-${semantic}`);
      const path = `textures/${semantic}.png`;
      await writeFile(join(materialDirectory, path), bytes);
      channels.push({
        semantic,
        providerName: semantic === 'normal' ? 'NormalGL' : semantic,
        path,
        mediaType: 'image/png',
        sha256: sha256Bytes(bytes),
        sizeBytes: bytes.byteLength,
        colorSpace,
        ...(semantic === 'normal' ? { normalConvention: 'opengl-positive-green' as const } : {}),
      });
    }
    const surface = surfaceMaterialSchema.parse({
      ...createWetCobbleSurfaceMaterial(),
      id: 'material.declarative-texture-fixture',
      textureMaps: {
        kind: 'hash-bound',
        source: {
          provider: 'ambientcg',
          sourceIdentitySha256: '1'.repeat(64),
          manifestSha256: '2'.repeat(64),
          licenceSpdx: 'CC0-1.0',
        },
        physicalScale: { widthMeters: 1.1, heightMeters: 1.1 },
        suitability: {
          composition: 'continuous-layout-scan',
          intendedConstructionDomains: ['flat-ground-surface'],
          rationale: 'Fixture is a complete photographed paving layout for a flat ground host.',
        },
        channels,
      },
    });
    const materialPath = join(materialDirectory, 'material.json');
    await saveSurfaceMaterial(materialPath, surface);
    const fixture = campaignFixture();
    Object.assign(fixture, {
      materialSources: [{ id: 'texture-source', path: 'source-material/material.json' }],
    });
    Object.assign(fixture.geometry[0]!, {
      materialBindings: [
        {
          targetMaterialId: 'body',
          material: 'texture-source',
          application: {
            constructionDomain: 'flat-ground-surface',
            placement: {
              scalePolicy: 'preserve-source-physical-scale',
              orientation: 'world-horizontal',
              offsetMeters: [0.1, 0.2],
              rotationDegrees: 0,
              appearance: {
                exposureStops: -0.1,
                saturationScale: 0.9,
                hueShiftDegrees: 0,
                roughnessScale: 1,
                roughnessOffset: 0,
                weatheringAmount: 0.2,
              },
              macroVariation: {
                seed: 72,
                scaleMeters: 4,
                valueAmplitude: 0.1,
                saturationAmplitude: 0.08,
                hueAmplitudeDegrees: 2,
                roughnessAmplitude: 0.1,
                weatheringAmplitude: 0.2,
              },
            },
          },
        },
      ],
    });
    const campaignFile = join(directory, 'campaign.json');
    await writeFile(campaignFile, JSON.stringify(fixture), 'utf8');
    await buildDeclarativeCinematicCampaign(campaignFile, { render: false });
    const geometry = await loadGeometry(join(directory, 'work/product.json'));
    const stagedChannels = geometry.materials[0]!.surface!.textureMaps!.channels;
    expect(stagedChannels.every((channel) => channel.path.startsWith('textures/'))).toBe(true);
    for (const channel of stagedChannels)
      expect(sha256Bytes(await readFile(join(directory, 'work', channel.path)))).toBe(
        channel.sha256,
      );
    const textureBinding = (
      fixture.geometry[0]! as unknown as {
        materialBindings: Array<{
          application: { constructionDomain: string };
        }>;
      }
    ).materialBindings[0]!;
    textureBinding.application.constructionDomain = 'modeled-paving-unit';
    await writeFile(campaignFile, JSON.stringify(fixture), 'utf8');
    await expect(
      buildDeclarativeCinematicCampaign(campaignFile, { render: false }),
    ).rejects.toThrow(/layout-scan-on-modeled-units/);
  });

  it('fits verified clothing to a library character and composes it as a synchronised wardrobe entity', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-declarative-clothing-'));
    const library = join(directory, 'library');
    const targetDirectory = join(library, 'characters/tall-actor/1.0.0');
    const clothingDirectory = join(library, 'clothing/source-dress/1.0.0');
    await mkdir(targetDirectory, { recursive: true });
    await mkdir(clothingDirectory, { recursive: true });
    const target = createHumanoidMannequin({
      height: 1.9,
      shoulderWidth: 0.48,
      hipWidth: 0.38,
      torsoLength: 0.55,
      legLength: 0.98,
    });
    target.id = 'character.test-tall-actor';
    await saveGeometry(join(targetDirectory, 'geometry.json'), target);
    const appearance = {
      skin: [0.55, 0.34, 0.24, 1] as [number, number, number, number],
      hair: [0.04, 0.03, 0.025, 1] as [number, number, number, number],
      eyes: [0.08, 0.12, 0.15, 1] as [number, number, number, number],
      dress: [0.035, 0.04, 0.055, 1] as [number, number, number, number],
      leather: [0.12, 0.065, 0.035, 1] as [number, number, number, number],
    };
    const sourceCharacter = createHumanoidMannequin({}, appearance);
    const garment = extractMaterialGeometry(
      sourceCharacter,
      ['dress'],
      'clothing.test-source-dress',
      { fitCharacter: sourceCharacter.id },
    );
    await saveGeometry(join(clothingDirectory, 'geometry.json'), garment);
    const writeGeometryAsset = async (
      assetDirectory: string,
      input: { id: string; type: 'character' | 'clothing'; capabilities: string[] },
    ) =>
      writeHashedAssetMetadata(
        join(assetDirectory, 'asset.yaml'),
        assetMetadataSchema.parse({
          schemaVersion: 1,
          id: input.id,
          version: '1.0.0',
          type: input.type,
          title: input.id,
          description: `Verified canonical geometry fixture for ${input.id}.`,
          status: 'verified',
          tags: ['canonical-humanoid'],
          capabilities: input.capabilities,
          source: {
            kind: 'procedural',
            references: [],
            licence: {
              spdx: 'LicenseRef-Test',
              name: 'Test fixture',
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
          ],
          compatibility: {
            skeleton: 'videoer.canonical-humanoid.v1',
            renderers: ['blender-headless'],
            requires: [],
          },
          verification: {
            checks: ['geometry.schema'],
            artifacts: [],
            verifiedAt: new Date().toISOString(),
          },
        }),
      );
    await writeGeometryAsset(targetDirectory, {
      id: 'character.test-tall-actor',
      type: 'character',
      capabilities: ['canonical-humanoid', 'wardrobe-ready-body'],
    });
    await writeGeometryAsset(clothingDirectory, {
      id: 'clothing.test-source-dress',
      type: 'clothing',
      capabilities: ['canonical-humanoid-fit', 'separable-garment'],
    });
    const fixture = campaignFixture();
    Object.assign(fixture, {
      assetLibrary: 'library',
      geometry: [
        {
          id: 'actor',
          library: {
            type: 'character',
            query: 'tall actor',
            capabilities: ['canonical-humanoid', 'wardrobe-ready-body'],
            preferredAsset: { id: 'character.test-tall-actor', version: '1.0.0' },
            artifactRole: 'geometry',
          },
        },
      ],
      clothingSources: [
        {
          id: 'dress-fit',
          path: 'work/clothing/dress-fit.json',
          library: {
            type: 'clothing',
            query: 'source dress',
            capabilities: ['canonical-humanoid-fit', 'separable-garment', 'target-character-fit'],
            preferredAsset: { id: 'clothing.test-source-dress', version: '1.0.0' },
            artifactRole: 'geometry',
          },
          adaptation: {
            kind: 'canonical-clothing-fit',
            assetId: 'clothing.test-tall-dress',
            targetGeometry: 'actor',
            providesCapabilities: ['target-character-fit'],
          },
        },
      ],
    });
    Object.assign(fixture.shots[0]!, {
      entities: [
        {
          id: 'actor',
          geometry: 'actor',
          role: 'character',
          wardrobe: [{ clothing: 'dress-fit' }],
        },
      ],
      camera: {
        keyframes: [
          {
            time: 0,
            position: { world: [2.5, 1.45, -4] },
            target: { world: [0, 1, 0] },
            lensMillimeters: 50,
          },
          {
            time: 1,
            position: { world: [2.4, 1.45, -3.9] },
            target: { world: [0, 1, 0] },
            lensMillimeters: 55,
          },
        ],
      },
    });
    const campaignFile = join(directory, 'campaign.json');
    await writeFile(campaignFile, JSON.stringify(fixture), 'utf8');
    const result = await buildDeclarativeCinematicCampaign(campaignFile, { render: false });
    const scene = JSON.parse(
      await readFile(join(directory, 'work/scenes/product-shot/scene.json'), 'utf8'),
    );
    const compatibility = JSON.parse(
      await readFile(
        join(directory, 'work/adaptations/dress-fit/compatibility-report.json'),
        'utf8',
      ),
    );
    const report = JSON.parse(await readFile(result.reportFile, 'utf8'));
    expect(scene.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'actor', role: 'character' }),
        expect.objectContaining({ id: 'actor--dress-fit', role: 'set-dressing' }),
      ]),
    );
    expect(compatibility).toMatchObject({
      baseAsset: { id: 'clothing.test-source-dress', version: '1.0.0' },
      targetGeometry: {
        sourceId: 'actor',
        libraryAsset: { id: 'character.test-tall-actor', version: '1.0.0' },
      },
      compatibility: {
        topologyPreserved: true,
        skinningPreserved: true,
        targetSkeletonMatched: true,
      },
      validation: { valid: true },
    });
    expect(report).toMatchObject({ adaptedClothingSources: 1, bespokeOrchestrationSourceFiles: 0 });
  });

  it('rejects reused audiovisual assets whose global edit placement drifts', () => {
    const fixture = campaignFixture() as Record<string, unknown> &
      ReturnType<typeof campaignFixture>;
    fixture.audioSources = [
      {
        id: 'dialogue-audio',
        library: {
          type: 'audio',
          query: 'verified dialogue',
          tags: ['speech'],
          capabilities: ['deterministic-waveform'],
          artifactRole: 'audio',
        },
      },
    ];
    fixture.motions = [{ id: 'dialogue-motion', path: 'dialogue-motion.json' }];
    fixture.soundtrack.cues = [
      {
        id: 'dialogue',
        kind: 'audio-source',
        source: 'dialogue-audio',
        startSeconds: 0,
        endSeconds: 1,
        gain: 0.8,
        purpose: 'reused testimony',
      },
    ] as unknown as typeof fixture.soundtrack.cues;
    fixture.shots[0]!.entities[0] = {
      ...fixture.shots[0]!.entities[0]!,
      motion: { source: 'dialogue-motion', startFrame: 1, endFrame: 24 },
    } as (typeof fixture.shots)[0]['entities'][number];
    fixture.audiovisualBindings = [
      {
        id: 'dialogue-sync',
        motion: 'dialogue-motion',
        audioCue: 'dialogue',
        targetGeometry: 'product',
        toleranceFrames: 0,
      },
    ];
    expect(() => declarativeCinematicCampaignSchema.parse(fixture)).toThrow(
      /not aligned within 0 frame/,
    );
  });

  it('generates and composes biomechanically gated character motion from campaign data', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-declarative-motion-'));
    await saveGeometry(join(directory, 'actor.json'), createHumanoidMannequin());
    const fixture = campaignFixture();
    fixture.geometry = [{ id: 'actor', path: 'actor.json' }] as typeof fixture.geometry;
    Object.assign(fixture, {
      motions: [
        {
          id: 'walk',
          path: 'work/motions/walk.json',
          recipe: { kind: 'walk-style', style: 'cautious' },
        },
        {
          id: 'turn',
          path: 'work/motions/turn.json',
          recipe: {
            kind: 'targeted-turn',
            actorTransform: {
              position: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            },
            target: {
              geometry: 'actor',
              attachmentId: 'gaze',
              transform: {
                position: [2, 0, -2],
                rotation: [0, 0, 0],
                scale: [1, 1, 1],
              },
            },
            scope: 'head',
            durationSeconds: 1.4,
          },
        },
      ],
      motionTimelines: [
        {
          id: 'walk-and-look',
          clipId: 'motion.declarative.walk-and-look',
          path: 'work/motions/walk-and-look.json',
          frames: 24,
          layers: [
            {
              id: 'base-walk',
              motion: 'walk',
              mode: 'base',
              startFrame: 0,
              endFrame: 24,
              playback: 'once',
            },
            {
              id: 'head-look',
              motion: 'turn',
              mode: 'additive',
              startFrame: 8,
              endFrame: 24,
              playback: 'once',
              fadeInFrames: 4,
              joints: ['neck', 'head'],
            },
          ],
        },
      ],
    });
    fixture.shots[0]!.entities = [
      {
        id: 'actor',
        geometry: 'actor',
        role: 'character',
        motion: { source: 'walk-and-look', startFrame: 0, endFrame: 24 },
      },
    ] as unknown as (typeof fixture.shots)[0]['entities'];
    fixture.shots[0]!.camera.keyframes = [
      {
        time: 0,
        position: { world: [2.5, 1.4, -4] },
        target: { world: [0, 1, 0] },
        lensMillimeters: 50,
      },
      {
        time: 1,
        position: { world: [2.2, 1.4, -3.8] },
        target: { world: [0, 1, 0] },
        lensMillimeters: 55,
      },
    ] as unknown as (typeof fixture.shots)[0]['camera']['keyframes'];
    const campaignFile = join(directory, 'campaign.json');
    await writeFile(campaignFile, JSON.stringify(fixture), 'utf8');
    const result = await buildDeclarativeCinematicCampaign(campaignFile, { render: false });
    const motion = await loadMotionClip(join(directory, 'work/motions/walk-and-look.json'));
    const turn = await loadMotionClip(join(directory, 'work/motions/turn.json'));
    const scene = JSON.parse(
      await readFile(join(directory, 'work/scenes/product-shot/scene.json'), 'utf8'),
    );
    const report = JSON.parse(await readFile(result.reportFile, 'utf8'));
    expect(motion.metadata.layers).toHaveLength(2);
    expect(turn.metadata).toMatchObject({
      generator: 'videoer.targeted-turn-synthesis.v1',
      targetWorld: expect.any(Array),
    });
    expect(scene.entities[0].motion.path).toContain('walk-and-look.json');
    expect(report).toMatchObject({ generatedMotionSources: 2, generatedMotionTimelines: 1 });
  });

  it('generates exact-frame speech motion from the same declarative soundtrack cue', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-declarative-speech-'));
    const actor = createEnglishSpeechMorphRig(
      createHumanoidMannequin(
        {},
        {
          skin: [0.62, 0.38, 0.27, 1],
          hair: [0.022, 0.009, 0.006, 1],
          eyes: [0.035, 0.11, 0.095, 1],
          dress: [0.012, 0.018, 0.04, 1],
          leather: [0.018, 0.014, 0.012, 1],
        },
      ),
    );
    await saveGeometry(join(directory, 'actor.json'), actor);
    const fixture = campaignFixture();
    fixture.geometry = [{ id: 'actor', path: 'actor.json' }] as typeof fixture.geometry;
    fixture.soundtrack.durationSeconds = 3;
    fixture.soundtrack.cues = [
      {
        id: 'dialogue',
        kind: 'speech',
        startSeconds: 0,
        endSeconds: 2.5,
        gain: 0.8,
        text: 'The next train leaves at midnight.',
        voice: 'en+f3',
        rate: 150,
        pitch: 45,
        purpose: 'shared audio and facial timing source',
      },
      {
        id: 'room-tone',
        kind: 'tone-bed',
        startSeconds: 0,
        endSeconds: 3,
        gain: 0.01,
        frequencyHz: 110,
        purpose: 'master duration',
      },
    ] as typeof fixture.soundtrack.cues;
    Object.assign(fixture, {
      motions: [
        {
          id: 'dialogue-face',
          path: 'work/motions/dialogue-face.json',
          recipe: {
            kind: 'speech-visemes',
            soundtrackCue: 'dialogue',
            targetGeometry: 'actor',
          },
        },
      ],
    });
    fixture.shots[0]!.frames = 72;
    fixture.shots[0]!.entities = [
      {
        id: 'actor',
        geometry: 'actor',
        role: 'character',
        motion: { source: 'dialogue-face', startFrame: 0, endFrame: 60 },
      },
    ] as unknown as (typeof fixture.shots)[0]['entities'];
    fixture.shots[0]!.camera.keyframes = [
      {
        time: 0,
        position: { world: [0, 1.65, -1.8] },
        target: { world: [0, 1.55, 0] },
        lensMillimeters: 70,
      },
      {
        time: 3,
        position: { world: [0.1, 1.65, -1.75] },
        target: { world: [0, 1.55, 0] },
        lensMillimeters: 75,
      },
    ] as unknown as (typeof fixture.shots)[0]['camera']['keyframes'];
    const campaignFile = join(directory, 'campaign.json');
    await writeFile(campaignFile, JSON.stringify(fixture), 'utf8');
    await buildDeclarativeCinematicCampaign(campaignFile, { render: false });
    const motion = await loadMotionClip(join(directory, 'work/motions/dialogue-face.json'));
    expect(motion.durationSeconds).toBe(2.5);
    expect(motion.morphTracks).toHaveLength(5);
    expect(motion.metadata).toMatchObject({
      generator: 'videoer.espeak-viseme.v1',
      engine: 'espeak-ng',
      text: 'The next train leaves at midnight.',
      fps: 24,
    });
  }, 20_000);

  it('resolves verified library assets and records adapt decisions fail-closed', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-declarative-library-'));
    const assetDirectory = join(directory, 'library/characters/test/1.0.0');
    await mkdir(assetDirectory, { recursive: true });
    await saveGeometry(join(assetDirectory, 'geometry.json'), createHumanoidMannequin());
    await writeHashedAssetMetadata(
      join(assetDirectory, 'asset.yaml'),
      assetMetadataSchema.parse({
        schemaVersion: 1,
        id: 'character.test-library-actor',
        version: '1.0.0',
        type: 'character',
        title: 'Test library actor',
        description: 'Verified canonical humanoid fixture',
        status: 'verified',
        tags: ['human'],
        capabilities: ['canonical-humanoid'],
        source: {
          kind: 'procedural',
          references: [],
          licence: {
            spdx: 'LicenseRef-Test',
            name: 'Test fixture',
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
        ],
        compatibility: { renderers: ['blender-headless'], requires: [] },
        verification: { checks: ['fixture'], artifacts: [], verifiedAt: new Date().toISOString() },
      }),
    );
    const motionAssetDirectory = join(directory, 'library/motions/test/1.0.0');
    await mkdir(motionAssetDirectory, { recursive: true });
    await saveMotionClip(
      join(motionAssetDirectory, 'motion.json'),
      createWalkStyleMotion('cautious'),
    );
    await writeHashedAssetMetadata(
      join(motionAssetDirectory, 'asset.yaml'),
      assetMetadataSchema.parse({
        schemaVersion: 1,
        id: 'motion.test-cautious-walk',
        version: '1.0.0',
        type: 'motion',
        title: 'Test cautious walk',
        description: 'Verified phase-gait fixture for deterministic proportion retargeting.',
        status: 'verified',
        tags: ['humanoid', 'walk', 'cautious'],
        capabilities: ['canonical-humanoid', 'phase-gait'],
        source: {
          kind: 'procedural',
          references: [],
          licence: {
            spdx: 'LicenseRef-Test',
            name: 'Test fixture',
            commercialUse: 'allowed',
            attributionRequired: false,
          },
          clearance: 'approved',
        },
        artifacts: [
          {
            role: 'motion',
            path: 'motion.json',
            mediaType: 'application/vnd.videoer.motion+json',
          },
        ],
        compatibility: {
          skeleton: 'videoer.canonical-humanoid.v1',
          renderers: ['blender-headless'],
          requires: [],
        },
        verification: {
          checks: ['motion.biomechanics'],
          artifacts: [],
          verifiedAt: new Date().toISOString(),
        },
      }),
    );
    const fixture = campaignFixture();
    Object.assign(fixture, { assetLibrary: 'library' });
    fixture.geometry = [
      {
        id: 'actor',
        library: {
          type: 'character',
          query: 'test library actor',
          tags: ['human'],
          capabilities: ['canonical-humanoid'],
          artifactRole: 'geometry',
        },
      },
    ] as unknown as typeof fixture.geometry;
    fixture.shots[0]!.entities = [
      { id: 'actor', geometry: 'actor', role: 'character' },
    ] as (typeof fixture.shots)[0]['entities'];
    fixture.shots[0]!.camera.keyframes = [
      {
        time: 0,
        position: { world: [2.5, 1.4, -4] },
        target: { world: [0, 1, 0] },
        lensMillimeters: 50,
      },
      {
        time: 1,
        position: { world: [2.2, 1.4, -3.8] },
        target: { world: [0, 1, 0] },
        lensMillimeters: 55,
      },
    ] as unknown as (typeof fixture.shots)[0]['camera']['keyframes'];
    const campaignFile = join(directory, 'campaign.json');
    await writeFile(campaignFile, JSON.stringify(fixture), 'utf8');
    const result = await buildDeclarativeCinematicCampaign(campaignFile, { render: false });
    const manifest = YAML.parse(
      await readFile(join(directory, 'work/asset-manifest.yaml'), 'utf8'),
    );
    expect(manifest.resolutions[0]).toMatchObject({
      requirementId: 'actor',
      decision: 'reuse',
      asset: { id: 'character.test-library-actor', version: '1.0.0' },
    });
    expect(JSON.parse(await readFile(result.reportFile, 'utf8'))).toMatchObject({
      assetManifestFile: expect.stringContaining('asset-manifest.yaml'),
    });

    const turnAssetDirectory = join(directory, 'library/motions/turn/1.0.0');
    await mkdir(turnAssetDirectory, { recursive: true });
    await saveMotionClip(
      join(turnAssetDirectory, 'head-right.json'),
      createTurnMotion('right', 'head'),
    );
    await writeHashedAssetMetadata(
      join(turnAssetDirectory, 'asset.yaml'),
      assetMetadataSchema.parse({
        schemaVersion: 1,
        id: 'motion.test-head-turn',
        version: '1.0.0',
        type: 'motion',
        title: 'Test head turn',
        description: 'Verified additive head-turn fixture for layered performance derivation.',
        status: 'verified',
        tags: ['head', 'turn'],
        capabilities: ['canonical-humanoid', 'additive-blend'],
        source: {
          kind: 'procedural',
          references: [],
          licence: {
            spdx: 'LicenseRef-Test',
            name: 'Test fixture',
            commercialUse: 'allowed',
            attributionRequired: false,
          },
          clearance: 'approved',
        },
        artifacts: [
          {
            role: 'motion-head-right',
            path: 'head-right.json',
            mediaType: 'application/vnd.videoer.motion+json',
          },
        ],
        compatibility: {
          skeleton: 'videoer.canonical-humanoid.v1',
          renderers: ['blender-headless'],
          requires: [],
        },
        verification: {
          checks: ['motion.scope-isolation'],
          artifacts: [],
          verifiedAt: new Date().toISOString(),
        },
      }),
    );
    Object.assign(fixture, {
      motions: [
        {
          id: 'base-walk',
          library: {
            type: 'motion',
            query: 'test cautious walk',
            tags: ['walk'],
            capabilities: ['canonical-humanoid', 'phase-gait'],
            preferredAsset: { id: 'motion.test-cautious-walk', version: '1.0.0' },
            artifactRole: 'motion',
          },
        },
        {
          id: 'head-turn',
          library: {
            type: 'motion',
            query: 'test head turn',
            tags: ['head', 'turn'],
            capabilities: ['canonical-humanoid', 'additive-blend'],
            preferredAsset: { id: 'motion.test-head-turn', version: '1.0.0' },
            artifactRole: 'motion-head-right',
          },
        },
      ],
      motionTimelines: [
        {
          id: 'layered-performance',
          clipId: 'motion.test-layered-performance',
          path: 'work/layered-performance.json',
          frames: 24,
          layers: [
            {
              id: 'base',
              motion: 'base-walk',
              mode: 'base',
              startFrame: 0,
              endFrame: 24,
              playback: 'once',
            },
            {
              id: 'look',
              motion: 'head-turn',
              mode: 'additive',
              startFrame: 0,
              endFrame: 24,
              playback: 'once',
              joints: ['neck', 'head'],
              minimumContribution: 0.1,
            },
          ],
          derivation: {
            kind: 'layered-performance',
            targetGeometry: 'actor',
            providesCapabilities: ['walking-head-turn-performance'],
            publication: {
              assetId: 'motion.test-layered-performance',
              version: '1.0.0',
              type: 'motion',
              title: 'Test layered performance',
              description: 'Verified multi-parent performance derivation fixture.',
              tags: ['performance'],
              capabilities: ['walking-head-turn-performance'],
              generator: 'videoer.motion-timeline.v1',
              renderers: ['blender-headless'],
              verification: { checks: ['motion.layer-lineage'], shots: ['product-shot'] },
            },
          },
        },
      ],
    });
    (
      fixture.shots[0]!.entities.find((entity) => entity.id === 'actor') as unknown as Record<
        string,
        unknown
      >
    ).motion = { source: 'layered-performance', startFrame: 0, endFrame: 24 };
    await writeFile(campaignFile, JSON.stringify(fixture), 'utf8');
    await buildDeclarativeCinematicCampaign(campaignFile, { render: false });
    expect(
      JSON.parse(
        await readFile(
          join(directory, 'work/adaptations/layered-performance/compatibility-report.json'),
          'utf8',
        ),
      ),
    ).toMatchObject({
      derivationKind: 'layered-performance',
      derivedAssetId: 'motion.test-layered-performance',
      skeleton: { compatible: true },
      targetGeometry: {
        libraryAsset: { id: 'character.test-library-actor', version: '1.0.0' },
      },
      layers: [
        {
          libraryAsset: { id: 'motion.test-cautious-walk', version: '1.0.0' },
          artifactRole: 'motion',
        },
        {
          libraryAsset: { id: 'motion.test-head-turn', version: '1.0.0' },
          artifactRole: 'motion-head-right',
        },
      ],
      compositionVerification: { valid: true },
      targetValidation: { valid: true },
    });
    expect(
      YAML.parse(await readFile(join(directory, 'work/asset-manifest.yaml'), 'utf8')).resolutions,
    ).toContainEqual(
      expect.objectContaining({ requirementId: 'layered-performance', decision: 'adapt' }),
    );
    Object.assign(fixture, { motions: [], motionTimelines: [] });
    delete (
      fixture.shots[0]!.entities.find((entity) => entity.id === 'actor') as unknown as Record<
        string,
        unknown
      >
    ).motion;

    const geometrySource = fixture.geometry[0] as unknown as {
      path?: string;
      library: { capabilities: string[] };
      adaptation?: Record<string, unknown>;
    };
    geometrySource.path = 'work/adapted-actor.json';
    geometrySource.library.capabilities = ['canonical-humanoid', 'dialogue-staging-anchor'];
    geometrySource.adaptation = {
      assetId: 'character.test-library-actor-dialogue',
      providesCapabilities: ['dialogue-staging-anchor'],
      addAttachments: {
        'dialogue-partner-focus': { position: [0, 1.45, -1.2], rotation: [0, 0, 0], bone: 'root' },
      },
      materialOverrides: [],
      metadata: { purpose: 'test deterministic derived attachment lineage' },
    };
    fixture.shots[0]!.entities = [
      { id: 'anchor', geometry: 'actor', role: 'set-dressing' },
      {
        id: 'actor',
        geometry: 'actor',
        role: 'character',
        placement: {
          entityId: 'anchor',
          attachmentId: 'dialogue-partner-focus',
          offset: [0.1, 0, 0],
        },
      },
    ] as unknown as (typeof fixture.shots)[0]['entities'];
    await writeFile(campaignFile, JSON.stringify(fixture), 'utf8');
    await buildDeclarativeCinematicCampaign(campaignFile, { render: false });
    const adaptedManifest = YAML.parse(
      await readFile(join(directory, 'work/asset-manifest.yaml'), 'utf8'),
    );
    expect(adaptedManifest.resolutions[0]).toMatchObject({
      requirementId: 'actor',
      decision: 'adapt',
      asset: { id: 'character.test-library-actor', version: '1.0.0' },
      adaptedPath: expect.stringContaining('adapted-actor.json'),
      compatibilityReport: expect.stringContaining('compatibility-report.json'),
    });
    expect(
      (await loadGeometry(join(directory, 'work/adapted-actor.json'))).attachments,
    ).toHaveProperty('dialogue-partner-focus');
    expect(
      JSON.parse(
        await readFile(join(directory, 'work/scenes/product-shot/scene.json'), 'utf8'),
      ).entities.find((entity: { id: string }) => entity.id === 'actor').transform.position,
    ).toEqual([0.1, 1.45, -1.2]);
    expect(
      JSON.parse(
        await readFile(join(directory, 'work/adaptations/actor/compatibility-report.json'), 'utf8'),
      ),
    ).toMatchObject({
      baseAsset: { id: 'character.test-library-actor', version: '1.0.0' },
      providedCapabilities: ['dialogue-staging-anchor'],
      operations: { topologyChanged: false, skeletonChanged: false },
      compatibility: { coordinateSystemPreserved: true },
    });

    Object.assign(fixture, {
      motions: [
        {
          id: 'retargeted-walk',
          path: 'work/retargeted-walk.json',
          library: {
            type: 'motion',
            query: 'test cautious walk',
            tags: ['humanoid', 'walk', 'cautious'],
            capabilities: ['canonical-humanoid', 'phase-gait', 'target-proportions'],
            preferredAsset: { id: 'motion.test-cautious-walk', version: '1.0.0' },
            artifactRole: 'motion',
          },
          adaptation: {
            kind: 'gait-retarget',
            assetId: 'motion.test-cautious-walk-retargeted',
            targetGeometry: 'actor',
            providesCapabilities: ['target-proportions'],
            metadata: { purpose: 'test retarget lineage' },
          },
        },
      ],
    });
    (
      fixture.shots[0]!.entities.find((entity) => entity.id === 'actor') as unknown as Record<
        string,
        unknown
      >
    ).motion = { source: 'retargeted-walk', startFrame: 0, endFrame: 24 };
    await writeFile(campaignFile, JSON.stringify(fixture), 'utf8');
    await buildDeclarativeCinematicCampaign(campaignFile, { render: false });
    const motionReport = JSON.parse(
      await readFile(
        join(directory, 'work/adaptations/retargeted-walk/compatibility-report.json'),
        'utf8',
      ),
    );
    expect(motionReport).toMatchObject({
      adaptationKind: 'gait-retarget',
      baseAsset: { id: 'motion.test-cautious-walk', version: '1.0.0' },
      targetGeometry: { sourceId: 'actor' },
      skeleton: { compatible: true },
      biomechanics: { valid: true },
    });
    expect(
      (await loadMotionClip(join(directory, 'work/retargeted-walk.json'))).metadata,
    ).toMatchObject({
      adaptationGenerator: 'videoer.phase-gait-retarget.v1',
      derivedFrom: 'motion.test-cautious-walk@1.0.0',
    });

    (
      fixture.geometry[0] as unknown as { library: { capabilities: string[] } }
    ).library.capabilities = [
      'canonical-humanoid',
      'dialogue-staging-anchor',
      'missing-capability',
    ];
    await writeFile(campaignFile, JSON.stringify(fixture), 'utf8');
    await expect(
      buildDeclarativeCinematicCampaign(campaignFile, { render: false }),
    ).rejects.toThrow(/requires adaptation/);
    const rejectedManifest = YAML.parse(
      await readFile(join(directory, 'work/asset-manifest.yaml'), 'utf8'),
    );
    expect(rejectedManifest.resolutions[0]).toMatchObject({ decision: 'adapt' });
  });
});
