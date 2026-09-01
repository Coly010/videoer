import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assetMetadataSchema,
  sha256File,
  writeHashedAssetMetadata,
} from '../src/assets/library.js';
import { buildDeclarativeCinematicCampaign } from '../src/application/cinematic-campaign.js';
import {
  saveProductionCharacterBinding,
  type ProductionCharacterBindingSource,
} from '../src/characters/production-binding.js';
import { createProductionTemplateHuman } from '../src/characters/production-template.js';
import { fingerprintCinematicScene } from '../src/cinematic/fingerprint.js';
import { saveGeometry } from '../src/geometry/io.js';

let directory = '';

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

function portable(from: string, to: string) {
  return relative(from, to);
}

describe('declarative production-character binding', () => {
  it('resolves verified assembly inputs into an ordinary cinematic entity and fingerprint', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-production-character-campaign-'));
    const library = join(directory, 'library');
    const bodyDirectory = join(library, 'characters/production-body/1.0.0');
    const materialDirectory = join(library, 'materials/skin/1.0.0');
    const hairDirectory = join(library, 'hair/style/1.0.0');
    const clothingDirectory = join(library, 'clothing/dress/1.0.0');
    await Promise.all(
      [bodyDirectory, materialDirectory, hairDirectory, clothingDirectory].map((path) =>
        mkdir(path, { recursive: true }),
      ),
    );
    const [source, weights] = await Promise.all([
      readFile(resolve('assets/character-bases/makehuman-hm08/base.obj'), 'utf8'),
      readFile(resolve('assets/character-bases/makehuman-hm08/default_weights.mhw'), 'utf8'),
    ]);
    const body = createProductionTemplateHuman(source, weights);
    body.id = 'character.production-body';
    const bodyPath = await saveGeometry(join(bodyDirectory, 'geometry.json'), body);
    const materialPath = join(materialDirectory, 'material.json');
    const hairPath = join(hairDirectory, 'geometry.json');
    const clothingPath = join(clothingDirectory, 'geometry.json');
    await Promise.all([
      writeFile(materialPath, '{"material":"skin"}\n', 'utf8'),
      writeFile(hairPath, '{"geometry":"hair"}\n', 'utf8'),
      writeFile(clothingPath, '{"geometry":"dress"}\n', 'utf8'),
    ]);
    const publishFixture = async (
      assetDirectory: string,
      id: string,
      type: 'character' | 'material' | 'hair' | 'clothing',
      artifactRole: 'geometry' | 'material',
      artifactPath: string,
    ) =>
      writeHashedAssetMetadata(
        join(assetDirectory, 'asset.yaml'),
        assetMetadataSchema.parse({
          schemaVersion: 1,
          id,
          version: '1.0.0',
          type,
          title: id,
          description: `Verified production-character component ${id}.`,
          status: 'verified',
          tags: ['production-character-component'],
          capabilities: ['production-character-component'],
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
              role: artifactRole,
              path: portable(assetDirectory, artifactPath),
              mediaType: 'application/json',
            },
          ],
          compatibility: {
            skeleton: 'videoer.canonical-humanoid.v1',
            renderers: ['blender-headless'],
            requires: [],
          },
          verification: {
            checks: ['fixture.verified'],
            artifacts: [],
            verifiedAt: new Date().toISOString(),
          },
        }),
      );
    await Promise.all([
      publishFixture(bodyDirectory, 'character.production-body', 'character', 'geometry', bodyPath),
      publishFixture(materialDirectory, 'material.skin', 'material', 'material', materialPath),
      publishFixture(hairDirectory, 'hair.style', 'hair', 'geometry', hairPath),
      publishFixture(clothingDirectory, 'clothing.dress', 'clothing', 'geometry', clothingPath),
    ]);

    const work = join(directory, 'work');
    await mkdir(work, { recursive: true });
    const profilePath = join(work, 'rig-profile.json');
    await copyFile(resolve('assets/rig-profiles/mpfb-rigify-human-toes-v1.json'), profilePath);
    const bindingPath = join(work, 'hero-binding.json');
    const bindingDirectory = dirname(bindingPath);
    const binding: ProductionCharacterBindingSource = {
      schemaVersion: 1,
      id: 'character-binding.hero',
      character: { id: 'character.hero', version: '1.0.0' },
      body: {
        asset: { id: 'character.production-body', version: '1.0.0' },
        artifactRole: 'geometry',
        path: portable(bindingDirectory, bodyPath),
        sha256: await sha256File(bodyPath),
      },
      rigProfile: {
        id: 'rig-profile.mpfb-rigify-human-toes',
        version: '0.1.0',
        path: portable(bindingDirectory, profilePath),
        sha256: await sha256File(profilePath),
      },
      materialBindings: [
        {
          targetMaterialId: 'skin',
          material: {
            asset: { id: 'material.skin', version: '1.0.0' },
            artifactRole: 'material',
            path: portable(bindingDirectory, materialPath),
            sha256: await sha256File(materialPath),
          },
        },
      ],
      hair: {
        asset: { id: 'hair.style', version: '1.0.0' },
        artifactRole: 'geometry',
        path: portable(bindingDirectory, hairPath),
        sha256: await sha256File(hairPath),
        binding: 'canonical-head-v1',
      },
      wardrobe: [
        {
          asset: { id: 'clothing.dress', version: '1.0.0' },
          artifactRole: 'geometry',
          path: portable(bindingDirectory, clothingPath),
          sha256: await sha256File(clothingPath),
          binding: 'full-rig-weight-transfer-v1',
        },
      ],
      compatibility: {
        canonicalSkeleton: 'videoer.canonical-humanoid-52',
        bodyTopology: 'makehuman-hm08-cc0-derived-v1',
      },
      qualityTier: 'medium',
    };
    await saveProductionCharacterBinding(bindingPath, binding);

    const campaignFile = join(directory, 'campaign.json');
    await writeFile(
      campaignFile,
      JSON.stringify({
        schemaVersion: 1,
        id: 'campaign.production-character-binding-test',
        fps: 24,
        resolution: { width: 160, height: 240, percentage: 100 },
        assetLibrary: 'library',
        geometry: [
          {
            id: 'actor',
            productionCharacterBindingPath: 'work/hero-binding.json',
            library: {
              type: 'character',
              query: 'production body',
              capabilities: ['production-character-component'],
              preferredAsset: { id: 'character.production-body', version: '1.0.0' },
              artifactRole: 'geometry',
            },
          },
        ],
        overlays: [],
        soundtrackPath: 'work/audio.wav',
        soundtrack: {
          schemaVersion: 1,
          id: 'audio.production-character-binding-test',
          durationSeconds: 1,
          sampleRate: 48000,
          channels: 2,
          cues: [
            {
              id: 'tone',
              kind: 'tone-bed',
              startSeconds: 0,
              endSeconds: 1,
              gain: 0.01,
              frequencyHz: 220,
              purpose: 'Deterministic fixture',
            },
          ],
        },
        shots: [
          {
            id: 'actor-shot',
            frames: 24,
            entities: [{ id: 'actor', geometry: 'actor', role: 'character' }],
            camera: {
              keyframes: [
                {
                  time: 0,
                  position: { world: [2.5, 1.4, -4] },
                  target: { world: [0, 1, 0] },
                  lensMillimeters: 50,
                },
                {
                  time: 1,
                  position: { world: [2.5, 1.4, -3.9] },
                  target: { world: [0, 1, 0] },
                  lensMillimeters: 50,
                },
              ],
            },
            lights: [
              {
                id: 'key',
                type: 'area',
                position: [2, 3, -2],
                target: [0, 1, 0],
                color: [1, 1, 1],
                energy: 400,
              },
            ],
            landmarks: [
              { id: 'start', progress: 0, description: 'Assembly start' },
              { id: 'end', progress: 1, description: 'Assembly end' },
            ],
          },
        ],
        delivery: { id: 'edit.production-character-binding-test', directory: 'delivery' },
      }),
      'utf8',
    );

    await buildDeclarativeCinematicCampaign(campaignFile, { render: false });
    const sceneFile = join(directory, 'work/scenes/actor-shot/scene.json');
    const scene = JSON.parse(await readFile(sceneFile, 'utf8'));
    expect(scene.entities[0]).toMatchObject({
      id: 'actor',
      productionRigProfilePath: expect.stringContaining('rig-profile.json'),
      productionCharacterBindingPath: expect.stringContaining('hero-binding.json'),
    });
    const fingerprint = await fingerprintCinematicScene(sceneFile);
    expect(fingerprint.artifacts.map((artifact) => artifact.role)).toEqual(
      expect.arrayContaining([
        'production-character-binding:actor',
        'production-character:actor:body',
        'production-character:actor:rig-profile',
        'production-character:actor:material:skin',
        'production-character:actor:hair',
        'production-character:actor:wardrobe:0:clothing.dress@1.0.0',
      ]),
    );

    await saveProductionCharacterBinding(bindingPath, { ...binding, qualityTier: 'hero' });
    const changed = await fingerprintCinematicScene(sceneFile);
    expect(changed.renderSha256).not.toBe(fingerprint.renderSha256);
  }, 20_000);
});
