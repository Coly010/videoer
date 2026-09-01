import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import {
  prepareCampaignPublicationCandidates,
  publishApprovedCampaignAssets,
} from '../src/application/cinematic-publication.js';
import { loadAssetMetadata, sha256File, validateLibraryAsset } from '../src/assets/library.js';
import { campaignAssetPublicationSchema } from '../src/production/cinematic-campaign.js';
import { adaptAtmosphericVfx, verifyAtmosphericVfxAdaptation } from '../src/vfx/adaptation.js';
import { createRainyDuskVfx } from '../src/vfx/rainy-dusk.js';
import {
  adaptSurfaceMaterial,
  verifySurfaceMaterialAdaptation,
} from '../src/materials/adaptation.js';
import { createWetCobbleSurfaceMaterial } from '../src/materials/wet-cobble.js';
import { createHumanoidMannequin } from '../src/characters/mannequin.js';
import { extractMaterialGeometry } from '../src/geometry/extract.js';
import { fitCanonicalClothing, verifyCanonicalClothingFit } from '../src/clothing/adaptation.js';
import { soundtrackPlanSchema } from '../src/audio/model.js';
import { renderSoundtrackPlan } from '../src/audio/render.js';
import {
  audioTreatmentSchema,
  renderAudioTreatment,
  verifyAudioTreatment,
} from '../src/audio/treatment.js';
import { createWarmInteriorLightingRig } from '../src/lighting/bookshop.js';
import { adaptLightingRig, verifyLightingRigAdaptation } from '../src/lighting/adaptation.js';
import { createRiseOfDemonsTitleTreatment } from '../src/titles/treatment.js';
import {
  adaptEditorialTreatment,
  renderEditorialTreatment,
  verifyEditorialTreatmentAdaptation,
  verifyEditorialTreatmentRendering,
} from '../src/titles/adaptation.js';
import { resolveCormorantGaramondFont } from '../src/titles/font.js';

let directory = '';
const exec = promisify(execFile);
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

async function writeVerifiedFixtureAsset(input: {
  library: string;
  directory: string;
  id: string;
  version: string;
  type: 'character' | 'environment' | 'clothing' | 'material' | 'motion' | 'vfx' | 'lighting';
  role: string;
  filename: string;
  contents: string;
}) {
  const assetDirectory = join(input.library, input.directory, input.version);
  await mkdir(assetDirectory, { recursive: true });
  const artifact = join(assetDirectory, input.filename);
  await writeFile(artifact, input.contents, 'utf8');
  await writeFile(
    join(assetDirectory, 'asset.yaml'),
    YAML.stringify({
      schemaVersion: 1,
      id: input.id,
      version: input.version,
      type: input.type,
      title: input.id,
      description: `Verified fixture for ${input.id}.`,
      status: 'verified',
      tags: [],
      capabilities: [],
      source: {
        kind: 'procedural',
        generator: 'videoer.test.v1',
        references: [],
        licence: {
          spdx: 'LicenseRef-Videoer-Test',
          name: 'Videoer test fixture',
          commercialUse: 'allowed',
          attributionRequired: false,
        },
        clearance: 'approved',
      },
      artifacts: [
        {
          role: input.role,
          path: input.filename,
          mediaType: 'application/json',
          sha256: await sha256File(artifact),
        },
      ],
      compatibility: { renderers: [], requires: [] },
      verification: {
        checks: ['fixture.verified'],
        artifacts: [],
        verifiedAt: '2026-08-31T00:00:00.000Z',
      },
    }),
    'utf8',
  );
  return artifact;
}

describe('declarative campaign publication loop', () => {
  it('prepares hashed review candidates, rejects tampering, and publishes explicit approvals', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-campaign-publication-'));
    const campaignFile = join(directory, 'cinematic-campaign.yaml');
    const geometry = join(directory, 'work/environment/platform.json');
    const verification = join(directory, 'work/scenes/establish/verification');
    const deliveryReport = join(directory, 'delivery/edit-report.json');
    await mkdir(join(directory, 'work/environment'), { recursive: true });
    await mkdir(verification, { recursive: true });
    await mkdir(join(directory, 'delivery'), { recursive: true });
    await writeFile(campaignFile, 'schemaVersion: 1\n', 'utf8');
    await writeFile(geometry, '{"asset":"original"}\n', 'utf8');
    await writeFile(join(verification, 'scene-render.json'), '{"status":"pass"}\n', 'utf8');
    await writeFile(join(verification, 'contact-sheet.png'), 'png-fixture', 'utf8');
    await writeFile(deliveryReport, '{"status":"pass"}\n', 'utf8');
    const publication = campaignAssetPublicationSchema.parse({
      assetId: 'environment.test-platform',
      version: '1.0.0',
      type: 'environment',
      title: 'Test platform',
      description: 'A deterministic project-owned test platform with semantic cameras.',
      tags: ['platform'],
      capabilities: ['semantic-camera-anchors'],
      generator: 'videoer.test.v1',
      renderers: ['blender-headless'],
      verification: { checks: ['geometry.schema'], shots: ['establish'] },
    });
    const prepared = await prepareCampaignPublicationCandidates({
      root: directory,
      campaignId: 'campaign.test-publication',
      campaignFile,
      libraryRoot: join(directory, 'library'),
      deliveryReport,
      items: [
        {
          sourceId: 'platform',
          artifactPath: geometry,
          artifactRole: 'geometry',
          mediaType: 'application/vnd.videoer.geometry+json',
          publication,
        },
      ],
    });
    expect(prepared.candidates).toEqual([
      expect.objectContaining({ sourceId: 'platform', status: 'pending-review' }),
    ]);
    const candidateDirectory = join(directory, 'work/publication-candidates/platform');
    const candidate = await loadAssetMetadata(join(candidateDirectory, 'asset.yaml'));
    expect(candidate.status).toBe('validated');
    expect(candidate.artifacts.every((artifact) => artifact.sha256)).toBe(true);
    expect(candidate.source.references).toEqual(['provenance/cinematic-campaign.yaml']);
    await writeFile(join(candidateDirectory, 'geometry.json'), '{"asset":"tampered"}\n', 'utf8');
    await expect(
      publishApprovedCampaignAssets(campaignFile, {
        sourceIds: ['platform'],
        reviewer: 'test-reviewer',
        rationale: 'Reviewed semantic frames and delivery evidence.',
      }),
    ).rejects.toThrow(/integrity checks|hash mismatch/);
    await writeFile(join(candidateDirectory, 'geometry.json'), '{"asset":"original"}\n', 'utf8');
    const result = await publishApprovedCampaignAssets(campaignFile, {
      sourceIds: ['platform'],
      reviewer: 'test-reviewer',
      rationale: 'Reviewed semantic frames and delivery evidence.',
    });
    expect(result.published).toHaveLength(1);
    const published = await loadAssetMetadata(
      join(directory, 'library/environments/test-platform/1.0.0/asset.yaml'),
    );
    expect(published).toMatchObject({
      status: 'verified',
      verification: {
        checks: expect.arrayContaining(['campaign.delivery.verified', 'review.operator-approved']),
      },
    });
    await expect(validateLibraryAsset(published)).resolves.toEqual({ valid: true, issues: [] });
    const manifest = YAML.parse(await readFile(prepared.manifestFile, 'utf8'));
    expect(manifest.candidates[0]).toMatchObject({
      status: 'published',
      reviewer: 'test-reviewer',
    });
    const repeated = await prepareCampaignPublicationCandidates({
      root: directory,
      campaignId: 'campaign.test-publication',
      campaignFile,
      libraryRoot: join(directory, 'library'),
      deliveryReport,
      items: [
        {
          sourceId: 'platform',
          artifactPath: geometry,
          artifactRole: 'geometry',
          mediaType: 'application/vnd.videoer.geometry+json',
          publication,
        },
      ],
    });
    expect(repeated.candidates).toEqual([
      expect.objectContaining({ sourceId: 'platform', status: 'published' }),
    ]);
    await writeFile(geometry, '{"asset":"changed-without-version-bump"}\n', 'utf8');
    await expect(
      prepareCampaignPublicationCandidates({
        root: directory,
        campaignId: 'campaign.test-publication',
        campaignFile,
        libraryRoot: join(directory, 'library'),
        deliveryReport,
        items: [
          {
            sourceId: 'platform',
            artifactPath: geometry,
            artifactRole: 'geometry',
            mediaType: 'application/vnd.videoer.geometry+json',
            publication,
          },
        ],
      }),
    ).rejects.toThrow(/already contains different 'geometry' content; declare a new version/);
  });

  it('requires passing delivery evidence before preparing candidates', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-campaign-publication-fail-'));
    await mkdir(join(directory, 'delivery'), { recursive: true });
    const report = join(directory, 'delivery/edit-report.json');
    await writeFile(report, '{"status":"fail"}\n', 'utf8');
    await expect(
      prepareCampaignPublicationCandidates({
        root: directory,
        campaignId: 'campaign.failed',
        campaignFile: join(directory, 'cinematic-campaign.yaml'),
        libraryRoot: join(directory, 'library'),
        deliveryReport: report,
        items: [],
      }),
    ).rejects.toThrow(/passing rendered delivery/);
  });

  it('rejects a semantically forged speech ledger even when candidate hashes are rewritten', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-speech-publication-forgery-'));
    const campaignFile = join(directory, 'cinematic-campaign.yaml');
    const sourceDirectory = join(directory, 'work/audio/speech/line');
    const verification = join(directory, 'work/scenes/dialogue/verification');
    const deliveryReport = join(directory, 'delivery/edit-report.json');
    const audio = join(sourceDirectory, 'speech.wav');
    const events = join(sourceDirectory, 'events.json');
    const lineage = join(sourceDirectory, 'lineage.json');
    await mkdir(sourceDirectory, { recursive: true });
    await mkdir(verification, { recursive: true });
    await mkdir(join(directory, 'delivery'), { recursive: true });
    await writeFile(campaignFile, 'schemaVersion: 1\n', 'utf8');
    await exec('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:duration=1:sample_rate=48000',
      '-c:a',
      'pcm_s24le',
      '-y',
      audio,
    ]);
    await writeFile(
      events,
      `${JSON.stringify({
        schemaVersion: 1,
        cueId: 'line',
        engine: 'espeak-ng',
        durationSeconds: 1,
        events: [
          { type: 'phoneme', audioPositionMs: 0, phoneme: 'a' },
          { type: 'end', audioPositionMs: 1000 },
        ],
      })}\n`,
      'utf8',
    );
    await writeFile(
      lineage,
      `${JSON.stringify({
        audioSha256: await sha256File(audio),
        eventsSha256: await sha256File(events),
        durationSeconds: 1,
        verification: { valid: true },
      })}\n`,
      'utf8',
    );
    await writeFile(join(verification, 'scene-render.json'), '{"status":"pass"}\n', 'utf8');
    await writeFile(join(verification, 'contact-sheet.png'), 'png-fixture', 'utf8');
    await writeFile(deliveryReport, '{"status":"pass"}\n', 'utf8');
    const publication = campaignAssetPublicationSchema.parse({
      assetId: 'audio.test-speech',
      version: '1.0.0',
      type: 'audio',
      title: 'Test speech',
      description: 'Speech fixture with a native timing ledger.',
      tags: ['speech'],
      capabilities: ['native-phoneme-events'],
      generator: 'videoer.test-speech.v1',
      renderers: ['ffmpeg'],
      verification: { checks: ['speech.event-ledger-hash'], shots: ['dialogue'] },
    });
    await prepareCampaignPublicationCandidates({
      root: directory,
      campaignId: 'campaign.speech-forgery',
      campaignFile,
      libraryRoot: join(directory, 'library'),
      deliveryReport,
      items: [
        {
          sourceId: 'line',
          artifactPath: audio,
          artifactRole: 'audio',
          mediaType: 'audio/wav',
          publication,
          extraEvidence: [
            { path: events, role: 'speech-events', mediaType: 'application/json' },
            {
              path: lineage,
              role: 'verification-speech-audio-lineage',
              mediaType: 'application/json',
            },
          ],
        },
      ],
    });
    const candidateDirectory = join(directory, 'work/publication-candidates/line');
    const candidateEvents = join(candidateDirectory, 'verification/adaptation/speech-events.json');
    const candidateLineage = join(
      candidateDirectory,
      'verification/adaptation/verification-speech-audio-lineage.json',
    );
    await writeFile(
      candidateEvents,
      `${JSON.stringify({
        schemaVersion: 1,
        engine: 'espeak-ng',
        durationSeconds: 1,
        events: [
          { type: 'phoneme', audioPositionMs: 900, phoneme: 'a' },
          { type: 'end', audioPositionMs: 100 },
        ],
      })}\n`,
      'utf8',
    );
    const forgedLineage = JSON.parse(await readFile(candidateLineage, 'utf8'));
    forgedLineage.eventsSha256 = await sha256File(candidateEvents);
    await writeFile(candidateLineage, `${JSON.stringify(forgedLineage)}\n`, 'utf8');
    const metadataFile = join(candidateDirectory, 'asset.yaml');
    const metadata = YAML.parse(await readFile(metadataFile, 'utf8'));
    metadata.artifacts.find(
      (artifact: { role: string }) => artifact.role === 'speech-events',
    ).sha256 = await sha256File(candidateEvents);
    metadata.artifacts.find(
      (artifact: { role: string }) => artifact.role === 'verification-speech-audio-lineage',
    ).sha256 = await sha256File(candidateLineage);
    await writeFile(metadataFile, YAML.stringify(metadata), 'utf8');
    await expect(
      publishApprovedCampaignAssets(campaignFile, {
        sourceIds: ['line'],
        reviewer: 'test-reviewer',
        rationale: 'A forged semantic ledger must fail independent validation.',
      }),
    ).rejects.toThrow(/event ledger fails live validation/);
    expect((await loadAssetMetadata(metadataFile)).status).toBe('validated');
  });

  it('rejects forged VFX topology even when the candidate and declared lineage hashes are rewritten', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-vfx-publication-forgery-'));
    const library = join(directory, 'library');
    const campaignFile = join(directory, 'cinematic-campaign.yaml');
    const work = join(directory, 'work/vfx');
    const verification = join(directory, 'work/scenes/establish/verification');
    const deliveryReport = join(directory, 'delivery/edit-report.json');
    await mkdir(work, { recursive: true });
    await mkdir(verification, { recursive: true });
    await mkdir(join(directory, 'delivery'), { recursive: true });
    await writeFile(campaignFile, 'schemaVersion: 1\n', 'utf8');
    await writeFile(join(verification, 'scene-render.json'), '{"status":"pass"}\n', 'utf8');
    await writeFile(join(verification, 'contact-sheet.png'), 'png-fixture', 'utf8');
    await writeFile(deliveryReport, '{"status":"pass"}\n', 'utf8');
    const base = createRainyDuskVfx();
    const parent = await writeVerifiedFixtureAsset({
      library,
      directory: 'vfx/rainy-dusk',
      id: 'vfx.parent-rainy-dusk',
      version: '1.0.0',
      type: 'vfx',
      role: 'vfx',
      filename: 'vfx.json',
      contents: `${JSON.stringify(base)}\n`,
    });
    const adaptedValue = adaptAtmosphericVfx(base, {
      assetId: 'vfx.test-restrained-drizzle',
      fog: { density: 0.004 },
      rain: { layers: [{ id: 'foreground', count: 24, opacity: 0.4 }] },
    });
    const adapted = join(work, 'adapted.json');
    await writeFile(adapted, `${JSON.stringify(adaptedValue)}\n`, 'utf8');
    const adaptation = join(work, 'compatibility-report.json');
    const live = verifyAtmosphericVfxAdaptation(base, adaptedValue);
    await writeFile(
      adaptation,
      `${JSON.stringify({
        baseAsset: { id: 'vfx.parent-rainy-dusk', version: '1.0.0' },
        baseVfxSha256: await sha256File(parent),
        adaptedVfxSha256: await sha256File(adapted),
        operations: {
          placementChanged: false,
          deterministicLayerTopologyChanged: false,
        },
        compatibility: {
          placementPreserved: true,
          deterministicLayerTopologyPreserved: true,
        },
        validation: live,
      })}\n`,
      'utf8',
    );
    const publication = campaignAssetPublicationSchema.parse({
      assetId: 'vfx.test-restrained-drizzle',
      version: '1.0.0',
      type: 'vfx',
      title: 'Test restrained drizzle',
      description: 'Derived deterministic camera-depth atmospheric treatment.',
      tags: ['rain'],
      capabilities: ['restrained-drizzle'],
      generator: 'videoer.atmospheric-treatment.v1',
      renderers: ['blender-headless'],
      verification: { checks: ['vfx.deterministic-topology'], shots: ['establish'] },
    });
    await prepareCampaignPublicationCandidates({
      root: directory,
      campaignId: 'campaign.vfx-forgery',
      campaignFile,
      libraryRoot: library,
      deliveryReport,
      items: [
        {
          sourceId: 'drizzle',
          artifactPath: adapted,
          artifactRole: 'vfx',
          mediaType: 'application/vnd.videoer.atmospheric-vfx+json',
          publication,
          requires: [{ id: 'vfx.parent-rainy-dusk', version: '1.0.0' }],
          sourceAsset: 'vfx.parent-rainy-dusk@1.0.0',
          extraEvidence: [
            {
              path: adaptation,
              role: 'verification-vfx-adaptation-compatibility',
              mediaType: 'application/json',
            },
          ],
        },
      ],
    });
    const candidateDirectory = join(directory, 'work/publication-candidates/drizzle');
    const candidateVfx = join(candidateDirectory, 'vfx.json');
    const candidateReport = join(
      candidateDirectory,
      'verification/adaptation/verification-vfx-adaptation-compatibility.json',
    );
    const forged = JSON.parse(await readFile(candidateVfx, 'utf8'));
    forged.rain.layers[0].seed += 5000;
    await writeFile(candidateVfx, `${JSON.stringify(forged)}\n`, 'utf8');
    const forgedReport = JSON.parse(await readFile(candidateReport, 'utf8'));
    forgedReport.adaptedVfxSha256 = await sha256File(candidateVfx);
    await writeFile(candidateReport, `${JSON.stringify(forgedReport)}\n`, 'utf8');
    const metadataFile = join(candidateDirectory, 'asset.yaml');
    const metadata = YAML.parse(await readFile(metadataFile, 'utf8'));
    metadata.artifacts.find((artifact: { role: string }) => artifact.role === 'vfx').sha256 =
      await sha256File(candidateVfx);
    metadata.artifacts.find(
      (artifact: { role: string }) => artifact.role === 'verification-vfx-adaptation-compatibility',
    ).sha256 = await sha256File(candidateReport);
    await writeFile(metadataFile, YAML.stringify(metadata), 'utf8');
    await expect(
      publishApprovedCampaignAssets(campaignFile, {
        sourceIds: ['drizzle'],
        reviewer: 'test-reviewer',
        rationale: 'Rewritten hashes must not conceal a semantic topology change.',
      }),
    ).rejects.toThrow(/fails live semantic validation|changed invariant 'seed'/);
    expect((await loadAssetMetadata(metadataFile)).status).toBe('validated');
  });

  it('rejects a forged material model even when candidate and lineage hashes are rewritten', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-material-publication-forgery-'));
    const library = join(directory, 'library');
    const campaignFile = join(directory, 'cinematic-campaign.yaml');
    const work = join(directory, 'work/materials');
    const verification = join(directory, 'work/scenes/establish/verification');
    const deliveryReport = join(directory, 'delivery/edit-report.json');
    await mkdir(work, { recursive: true });
    await mkdir(verification, { recursive: true });
    await mkdir(join(directory, 'delivery'), { recursive: true });
    await writeFile(campaignFile, 'schemaVersion: 1\n', 'utf8');
    await writeFile(join(verification, 'scene-render.json'), '{"status":"pass"}\n', 'utf8');
    await writeFile(join(verification, 'contact-sheet.png'), 'png-fixture', 'utf8');
    await writeFile(deliveryReport, '{"status":"pass"}\n', 'utf8');
    const base = createWetCobbleSurfaceMaterial();
    const parent = await writeVerifiedFixtureAsset({
      library,
      directory: 'materials/wet-cobble',
      id: 'material.parent-wet-cobble',
      version: '1.0.0',
      type: 'material',
      role: 'material',
      filename: 'material.json',
      contents: `${JSON.stringify(base)}\n`,
    });
    const adaptedValue = adaptSurfaceMaterial(base, {
      assetId: 'material.test-dry-cobble',
      roughness: { minimum: 0.42, maximum: 0.68, wetness: 0.16 },
    });
    const adapted = join(work, 'adapted.json');
    await writeFile(adapted, `${JSON.stringify(adaptedValue)}\n`, 'utf8');
    const adaptation = join(work, 'compatibility-report.json');
    await writeFile(
      adaptation,
      `${JSON.stringify({
        baseAsset: { id: 'material.parent-wet-cobble', version: '1.0.0' },
        baseMaterialSha256: await sha256File(parent),
        adaptedMaterialSha256: await sha256File(adapted),
        operations: {
          shadingModelChanged: false,
          baseColorModelChanged: false,
          normalModelChanged: false,
        },
        compatibility: {
          shadingModelPreserved: true,
          baseColorModelPreserved: true,
          normalModelPreserved: true,
        },
        validation: verifySurfaceMaterialAdaptation(base, adaptedValue),
      })}\n`,
      'utf8',
    );
    const publication = campaignAssetPublicationSchema.parse({
      assetId: 'material.test-dry-cobble',
      version: '1.0.0',
      type: 'material',
      title: 'Test dry cobble',
      description: 'Derived deterministic dry stone surface treatment.',
      tags: ['stone'],
      capabilities: ['dry-treatment'],
      generator: 'videoer.surface-treatment.v1',
      renderers: ['blender-headless'],
      verification: { checks: ['material.model-preserved'], shots: ['establish'] },
    });
    await prepareCampaignPublicationCandidates({
      root: directory,
      campaignId: 'campaign.material-forgery',
      campaignFile,
      libraryRoot: library,
      deliveryReport,
      items: [
        {
          sourceId: 'dry-cobble',
          artifactPath: adapted,
          artifactRole: 'material',
          mediaType: 'application/vnd.videoer.surface-material+json',
          publication,
          requires: [{ id: 'material.parent-wet-cobble', version: '1.0.0' }],
          sourceAsset: 'material.parent-wet-cobble@1.0.0',
          extraEvidence: [
            {
              path: adaptation,
              role: 'verification-material-adaptation-compatibility',
              mediaType: 'application/json',
            },
          ],
        },
      ],
    });
    const candidateDirectory = join(directory, 'work/publication-candidates/dry-cobble');
    const candidateMaterial = join(candidateDirectory, 'material.json');
    const candidateReport = join(
      candidateDirectory,
      'verification/adaptation/verification-material-adaptation-compatibility.json',
    );
    const forged = JSON.parse(await readFile(candidateMaterial, 'utf8'));
    forged.baseColor.kind = 'constant';
    await writeFile(candidateMaterial, `${JSON.stringify(forged)}\n`, 'utf8');
    const forgedReport = JSON.parse(await readFile(candidateReport, 'utf8'));
    forgedReport.adaptedMaterialSha256 = await sha256File(candidateMaterial);
    await writeFile(candidateReport, `${JSON.stringify(forgedReport)}\n`, 'utf8');
    const metadataFile = join(candidateDirectory, 'asset.yaml');
    const metadata = YAML.parse(await readFile(metadataFile, 'utf8'));
    metadata.artifacts.find((artifact: { role: string }) => artifact.role === 'material').sha256 =
      await sha256File(candidateMaterial);
    metadata.artifacts.find(
      (artifact: { role: string }) =>
        artifact.role === 'verification-material-adaptation-compatibility',
    ).sha256 = await sha256File(candidateReport);
    await writeFile(metadataFile, YAML.stringify(metadata), 'utf8');
    await expect(
      publishApprovedCampaignAssets(campaignFile, {
        sourceIds: ['dry-cobble'],
        reviewer: 'test-reviewer',
        rationale: 'Rewritten hashes must not conceal a material model substitution.',
      }),
    ).rejects.toThrow(/fails live semantic validation|base-color model changed/);
  });

  it('rejects forged clothing fit lineage even when candidate and report hashes are rewritten', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-clothing-publication-forgery-'));
    const library = join(directory, 'library');
    const campaignFile = join(directory, 'cinematic-campaign.yaml');
    const work = join(directory, 'work/clothing');
    const verification = join(directory, 'work/scenes/establish/verification');
    const deliveryReport = join(directory, 'delivery/edit-report.json');
    await mkdir(work, { recursive: true });
    await mkdir(verification, { recursive: true });
    await mkdir(join(directory, 'delivery'), { recursive: true });
    await writeFile(campaignFile, 'schemaVersion: 1\n', 'utf8');
    await writeFile(join(verification, 'scene-render.json'), '{"status":"pass"}\n', 'utf8');
    await writeFile(join(verification, 'contact-sheet.png'), 'png-fixture', 'utf8');
    await writeFile(deliveryReport, '{"status":"pass"}\n', 'utf8');
    const appearance = {
      skin: [0.55, 0.34, 0.24, 1] as [number, number, number, number],
      hair: [0.04, 0.03, 0.025, 1] as [number, number, number, number],
      eyes: [0.08, 0.12, 0.15, 1] as [number, number, number, number],
      dress: [0.035, 0.04, 0.055, 1] as [number, number, number, number],
      leather: [0.12, 0.065, 0.035, 1] as [number, number, number, number],
    };
    const sourceCharacter = createHumanoidMannequin({}, appearance);
    const garment = extractMaterialGeometry(sourceCharacter, ['dress'], 'clothing.parent-dress');
    const target = createHumanoidMannequin({ height: 1.9, torsoLength: 0.55, legLength: 0.98 });
    target.id = 'character.target-tall';
    const parentGarment = await writeVerifiedFixtureAsset({
      library,
      directory: 'clothing/parent-dress',
      id: 'clothing.parent-dress',
      version: '1.0.0',
      type: 'clothing',
      role: 'geometry',
      filename: 'geometry.json',
      contents: `${JSON.stringify(garment)}\n`,
    });
    const targetGeometry = await writeVerifiedFixtureAsset({
      library,
      directory: 'characters/target-tall',
      id: 'character.target-tall',
      version: '1.0.0',
      type: 'character',
      role: 'geometry',
      filename: 'geometry.json',
      contents: `${JSON.stringify(target)}\n`,
    });
    const fittedValue = fitCanonicalClothing(garment, target, 'clothing.test-fitted-dress');
    const fitted = join(work, 'fitted.json');
    await writeFile(fitted, `${JSON.stringify(fittedValue)}\n`, 'utf8');
    const adaptation = join(work, 'compatibility-report.json');
    const fitVerification = verifyCanonicalClothingFit(garment, target, fittedValue);
    await writeFile(
      adaptation,
      `${JSON.stringify({
        baseAsset: { id: 'clothing.parent-dress', version: '1.0.0' },
        baseClothingSha256: await sha256File(parentGarment),
        targetGeometry: {
          libraryAsset: { id: 'character.target-tall', version: '1.0.0' },
          sha256: await sha256File(targetGeometry),
        },
        adaptedClothingSha256: await sha256File(fitted),
        operations: {
          topologyChanged: false,
          skinningChanged: false,
          skinningPolicy: 'preserve',
          skeletonRetargeted: true,
        },
        compatibility: {
          topologyPreserved: true,
          skinningPreserved: true,
          targetSkeletonMatched: true,
          canonicalSkeletonCompatible: true,
        },
        validation: fitVerification,
      })}\n`,
      'utf8',
    );
    const publication = campaignAssetPublicationSchema.parse({
      assetId: 'clothing.test-fitted-dress',
      version: '1.0.0',
      type: 'clothing',
      title: 'Test fitted dress',
      description: 'Topology-preserving dress fit to a verified target character.',
      tags: ['dress'],
      capabilities: ['target-character-fit'],
      generator: 'videoer.canonical-clothing-fit.v1',
      renderers: ['blender-headless'],
      verification: { checks: ['clothing.target-fit'], shots: ['establish'] },
    });
    await prepareCampaignPublicationCandidates({
      root: directory,
      campaignId: 'campaign.clothing-forgery',
      campaignFile,
      libraryRoot: library,
      deliveryReport,
      items: [
        {
          sourceId: 'fitted-dress',
          artifactPath: fitted,
          artifactRole: 'geometry',
          mediaType: 'application/vnd.videoer.geometry+json',
          publication,
          requires: [
            { id: 'clothing.parent-dress', version: '1.0.0' },
            { id: 'character.target-tall', version: '1.0.0' },
          ],
          sourceAsset: 'clothing.parent-dress@1.0.0',
          extraEvidence: [
            {
              path: adaptation,
              role: 'verification-clothing-adaptation-compatibility',
              mediaType: 'application/json',
            },
          ],
        },
      ],
    });
    const candidateDirectory = join(directory, 'work/publication-candidates/fitted-dress');
    const candidateGeometry = join(candidateDirectory, 'geometry.json');
    const candidateReport = join(
      candidateDirectory,
      'verification/adaptation/verification-clothing-adaptation-compatibility.json',
    );
    const forged = JSON.parse(await readFile(candidateGeometry, 'utf8'));
    forged.skeleton[1].restPosition[1] += 0.03;
    await writeFile(candidateGeometry, `${JSON.stringify(forged)}\n`, 'utf8');
    const forgedReport = JSON.parse(await readFile(candidateReport, 'utf8'));
    forgedReport.adaptedClothingSha256 = await sha256File(candidateGeometry);
    await writeFile(candidateReport, `${JSON.stringify(forgedReport)}\n`, 'utf8');
    const metadataFile = join(candidateDirectory, 'asset.yaml');
    const metadata = YAML.parse(await readFile(metadataFile, 'utf8'));
    metadata.artifacts.find((artifact: { role: string }) => artifact.role === 'geometry').sha256 =
      await sha256File(candidateGeometry);
    metadata.artifacts.find(
      (artifact: { role: string }) =>
        artifact.role === 'verification-clothing-adaptation-compatibility',
    ).sha256 = await sha256File(candidateReport);
    await writeFile(metadataFile, YAML.stringify(metadata), 'utf8');
    await expect(
      publishApprovedCampaignAssets(campaignFile, {
        sourceIds: ['fitted-dress'],
        reviewer: 'test-reviewer',
        rationale: 'Rewritten hashes must not conceal a false target rest skeleton.',
      }),
    ).rejects.toThrow(/fails live semantic validation|exact target skeleton/);
  });

  it('rejects false motion-target lineage before writing approval state', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-motion-publication-lineage-'));
    const library = join(directory, 'library');
    const campaignFile = join(directory, 'cinematic-campaign.yaml');
    const motion = join(directory, 'work/motions/adapted.json');
    const adaptation = join(directory, 'work/adaptations/gait/compatibility-report.json');
    const verification = join(directory, 'work/scenes/establish/verification');
    const deliveryReport = join(directory, 'delivery/edit-report.json');
    await mkdir(join(directory, 'work/motions'), { recursive: true });
    await mkdir(join(directory, 'work/adaptations/gait'), { recursive: true });
    await mkdir(verification, { recursive: true });
    await mkdir(join(directory, 'delivery'), { recursive: true });
    await writeFile(campaignFile, 'schemaVersion: 1\n', 'utf8');
    await writeFile(motion, '{"motion":"adapted"}\n', 'utf8');
    await writeFile(join(verification, 'scene-render.json'), '{"status":"pass"}\n', 'utf8');
    await writeFile(join(verification, 'contact-sheet.png'), 'png-fixture', 'utf8');
    await writeFile(deliveryReport, '{"status":"pass"}\n', 'utf8');
    const parentMotion = await writeVerifiedFixtureAsset({
      library,
      directory: 'motions/parent-gait',
      id: 'motion.parent-gait',
      version: '1.0.0',
      type: 'motion',
      role: 'motion',
      filename: 'motion.json',
      contents: '{"motion":"parent"}\n',
    });
    await writeVerifiedFixtureAsset({
      library,
      directory: 'characters/target-character',
      id: 'character.target-character',
      version: '1.0.0',
      type: 'character',
      role: 'geometry',
      filename: 'geometry.json',
      contents: '{"geometry":"target"}\n',
    });
    await writeFile(
      adaptation,
      `${JSON.stringify(
        {
          baseAsset: { id: 'motion.parent-gait', version: '1.0.0' },
          baseMotionSha256: await sha256File(parentMotion),
          adaptedMotionSha256: await sha256File(motion),
          targetGeometry: {
            libraryAsset: { id: 'character.target-character', version: '1.0.0' },
            sha256: '0'.repeat(64),
          },
          skeleton: { compatible: true },
          biomechanics: { valid: true },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const publication = campaignAssetPublicationSchema.parse({
      assetId: 'motion.target-gait',
      version: '1.0.0',
      type: 'motion',
      title: 'Target gait',
      description: 'A proportion-aware gait fixture with explicit target lineage.',
      tags: ['gait'],
      capabilities: ['target-proportions'],
      generator: 'videoer.phase-gait-retarget.v1',
      renderers: ['blender-headless'],
      verification: { checks: ['motion.biomechanics'], shots: ['establish'] },
    });
    await prepareCampaignPublicationCandidates({
      root: directory,
      campaignId: 'campaign.motion-lineage',
      campaignFile,
      libraryRoot: library,
      deliveryReport,
      items: [
        {
          sourceId: 'gait',
          artifactPath: motion,
          artifactRole: 'motion',
          mediaType: 'application/vnd.videoer.motion+json',
          publication,
          sourceAsset: 'motion.parent-gait@1.0.0',
          requires: [
            { id: 'motion.parent-gait', version: '1.0.0' },
            { id: 'character.target-character', version: '1.0.0' },
          ],
          extraEvidence: [
            {
              path: adaptation,
              role: 'verification-motion-adaptation-compatibility',
              mediaType: 'application/json',
            },
          ],
        },
      ],
    });
    await expect(
      publishApprovedCampaignAssets(campaignFile, {
        sourceIds: ['gait'],
        reviewer: 'test-reviewer',
        rationale: 'Review should fail before approval state is written.',
      }),
    ).rejects.toThrow(/target geometry hash does not match the library/);
    const candidateDirectory = join(directory, 'work/publication-candidates/gait');
    expect((await loadAssetMetadata(join(candidateDirectory, 'asset.yaml'))).status).toBe(
      'validated',
    );
    await expect(
      readFile(join(candidateDirectory, 'verification/approval.json')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects tampered multi-parent performance lineage before approval', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-layered-publication-lineage-'));
    const library = join(directory, 'library');
    const campaignFile = join(directory, 'cinematic-campaign.yaml');
    const outputMotion = join(directory, 'work/motions/performance.json');
    const compatibility = join(directory, 'work/adaptations/performance/compatibility-report.json');
    const verification = join(directory, 'work/scenes/performance/verification');
    const deliveryReport = join(directory, 'delivery/edit-report.json');
    await mkdir(join(directory, 'work/motions'), { recursive: true });
    await mkdir(join(directory, 'work/adaptations/performance'), { recursive: true });
    await mkdir(verification, { recursive: true });
    await mkdir(join(directory, 'delivery'), { recursive: true });
    await writeFile(campaignFile, 'schemaVersion: 1\n', 'utf8');
    await writeFile(outputMotion, '{"motion":"performance"}\n', 'utf8');
    await writeFile(join(verification, 'scene-render.json'), '{"status":"pass"}\n', 'utf8');
    await writeFile(join(verification, 'contact-sheet.png'), 'png-fixture', 'utf8');
    await writeFile(deliveryReport, '{"status":"pass"}\n', 'utf8');
    const baseMotion = await writeVerifiedFixtureAsset({
      library,
      directory: 'motions/base-performance',
      id: 'motion.base-performance',
      version: '1.0.0',
      type: 'motion',
      role: 'motion',
      filename: 'motion.json',
      contents: '{"motion":"base"}\n',
    });
    const additiveMotion = await writeVerifiedFixtureAsset({
      library,
      directory: 'motions/additive-performance',
      id: 'motion.additive-performance',
      version: '1.0.0',
      type: 'motion',
      role: 'motion-head',
      filename: 'head.json',
      contents: '{"motion":"head"}\n',
    });
    const targetGeometry = await writeVerifiedFixtureAsset({
      library,
      directory: 'characters/performance-target',
      id: 'character.performance-target',
      version: '1.0.0',
      type: 'character',
      role: 'geometry',
      filename: 'geometry.json',
      contents: '{"geometry":"target"}\n',
    });
    await writeFile(
      compatibility,
      `${JSON.stringify(
        {
          derivationKind: 'layered-performance',
          derivedAssetId: 'motion.layered-performance',
          derivedMotionSha256: await sha256File(outputMotion),
          skeleton: { compatible: true },
          targetGeometry: {
            libraryAsset: { id: 'character.performance-target', version: '1.0.0' },
            sha256: await sha256File(targetGeometry),
          },
          layers: [
            {
              libraryAsset: { id: 'motion.base-performance', version: '1.0.0' },
              artifactRole: 'motion',
              artifactSha256: await sha256File(baseMotion),
            },
            {
              libraryAsset: { id: 'motion.additive-performance', version: '1.0.0' },
              artifactRole: 'motion-head',
              artifactSha256: '0'.repeat(64),
            },
          ],
          compositionVerification: { valid: true },
          targetValidation: { valid: true },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    expect(await sha256File(additiveMotion)).not.toBe('0'.repeat(64));
    const publication = campaignAssetPublicationSchema.parse({
      assetId: 'motion.layered-performance',
      version: '1.0.0',
      type: 'motion',
      title: 'Layered performance',
      description: 'A multi-parent performance fixture with immutable layer lineage.',
      tags: ['performance'],
      capabilities: ['layered-performance'],
      generator: 'videoer.motion-timeline.v1',
      renderers: ['blender-headless'],
      verification: { checks: ['motion.multi-parent-lineage'], shots: ['performance'] },
    });
    await prepareCampaignPublicationCandidates({
      root: directory,
      campaignId: 'campaign.layered-lineage',
      campaignFile,
      libraryRoot: library,
      deliveryReport,
      items: [
        {
          sourceId: 'performance',
          artifactPath: outputMotion,
          artifactRole: 'motion',
          mediaType: 'application/vnd.videoer.motion+json',
          publication,
          sourceAssets: ['motion.base-performance@1.0.0', 'motion.additive-performance@1.0.0'],
          requires: [
            { id: 'motion.base-performance', version: '1.0.0' },
            { id: 'motion.additive-performance', version: '1.0.0' },
            { id: 'character.performance-target', version: '1.0.0' },
          ],
          extraEvidence: [
            {
              path: compatibility,
              role: 'verification-layered-performance-compatibility',
              mediaType: 'application/json',
            },
          ],
        },
      ],
    });
    await expect(
      publishApprovedCampaignAssets(campaignFile, {
        sourceIds: ['performance'],
        reviewer: 'test-reviewer',
        rationale: 'Tampered layer lineage must be rejected atomically.',
      }),
    ).rejects.toThrow(/source motion.additive-performance@1.0.0 hash does not match the library/);
    const candidateDirectory = join(directory, 'work/publication-candidates/performance');
    expect((await loadAssetMetadata(join(candidateDirectory, 'asset.yaml'))).status).toBe(
      'validated',
    );
    await expect(
      readFile(join(candidateDirectory, 'verification/approval.json')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects forged lighting semantics even when candidate and lineage hashes are rewritten', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-lighting-publication-forgery-'));
    const library = join(directory, 'library');
    const campaignFile = join(directory, 'cinematic-campaign.yaml');
    const work = join(directory, 'work/lighting');
    const verification = join(directory, 'work/scenes/gallery/verification');
    const deliveryReport = join(directory, 'delivery/edit-report.json');
    await Promise.all([
      mkdir(work, { recursive: true }),
      mkdir(verification, { recursive: true }),
      mkdir(join(directory, 'delivery'), { recursive: true }),
    ]);
    await writeFile(campaignFile, 'schemaVersion: 1\n');
    await writeFile(join(verification, 'scene-render.json'), '{"status":"pass"}\n');
    await writeFile(join(verification, 'contact-sheet.png'), 'png-fixture');
    await writeFile(deliveryReport, '{"status":"pass"}\n');
    const base = createWarmInteriorLightingRig();
    const parent = await writeVerifiedFixtureAsset({
      library,
      directory: 'lighting/warm-lighting',
      id: base.id,
      version: '1.0.0',
      type: 'lighting',
      role: 'lighting-rig',
      filename: 'lighting-rig.json',
      contents: `${JSON.stringify(base)}\n`,
    });
    const specification = {
      kind: 'lighting-rig-transform-v1' as const,
      assetId: 'lighting.test-gallery',
      transform: {
        translation: [0.5, 0.1, -1.8] as [number, number, number],
        yawRadians: 0.25,
        uniformScale: 1.1,
      },
      energyScale: 0.85,
      purposeEnergyScale: { key: 1.1, fill: 0.8, rim: 1, practical: 0.9, environment: 0.75 },
      colorMultiply: [0.95, 0.9, 1] as [number, number, number],
      metadata: {},
    };
    const adaptedValue = adaptLightingRig(base, specification);
    const adapted = join(work, 'lighting.json');
    await writeFile(adapted, `${JSON.stringify(adaptedValue)}\n`);
    const live = verifyLightingRigAdaptation(base, adaptedValue, specification);
    const report = join(work, 'compatibility-report.json');
    await writeFile(
      report,
      `${JSON.stringify({
        baseAsset: { id: base.id, version: '1.0.0' },
        baseArtifactRole: 'lighting-rig',
        baseLightingSha256: await sha256File(parent),
        adaptedLightingSha256: await sha256File(adapted),
        adaptation: specification,
        operations: {
          lightTopologyChanged: false,
          exposureChanged: false,
          spatialTransformMatched: true,
          energyTransformMatched: true,
          colorTransformMatched: true,
          sizeTransformMatched: true,
        },
        compatibility: {
          topologyPreserved: true,
          exposurePreserved: true,
          nonBlackWorld: true,
          baseLightCount: base.lights.length,
          adaptedLightCount: adaptedValue.lights.length,
        },
        validation: live,
      })}\n`,
    );
    const publication = campaignAssetPublicationSchema.parse({
      assetId: specification.assetId,
      version: '1.0.0',
      type: 'lighting',
      title: 'Test gallery lighting',
      description: 'A bounded derived gallery lighting rig with verified parent semantics.',
      tags: ['gallery'],
      capabilities: ['key-fill-rim'],
      generator: 'videoer.lighting-rig-transform.v1',
      renderers: ['blender-headless'],
      verification: { checks: ['lighting.semantic-transform'], shots: ['gallery'] },
    });
    await prepareCampaignPublicationCandidates({
      root: directory,
      campaignId: 'campaign.lighting-forgery',
      campaignFile,
      libraryRoot: library,
      deliveryReport,
      items: [
        {
          sourceId: 'gallery-lighting',
          artifactPath: adapted,
          artifactRole: 'lighting',
          mediaType: 'application/vnd.videoer.lighting+json',
          publication,
          sourceAsset: `${base.id}@1.0.0`,
          requires: [{ id: base.id, version: '1.0.0' }],
          extraEvidence: [
            {
              path: report,
              role: 'verification-lighting-adaptation-compatibility',
              mediaType: 'application/json',
            },
          ],
        },
      ],
    });
    const candidateDirectory = join(directory, 'work/publication-candidates/gallery-lighting');
    const candidateLighting = join(candidateDirectory, 'lighting.json');
    const candidateReport = join(
      candidateDirectory,
      'verification/adaptation/verification-lighting-adaptation-compatibility.json',
    );
    const forged = JSON.parse(await readFile(candidateLighting, 'utf8'));
    forged.lights[0].position[0] += 0.4;
    await writeFile(candidateLighting, `${JSON.stringify(forged)}\n`);
    const forgedReport = JSON.parse(await readFile(candidateReport, 'utf8'));
    forgedReport.adaptedLightingSha256 = await sha256File(candidateLighting);
    await writeFile(candidateReport, `${JSON.stringify(forgedReport)}\n`);
    const metadataFile = join(candidateDirectory, 'asset.yaml');
    const metadata = YAML.parse(await readFile(metadataFile, 'utf8'));
    metadata.artifacts.find((artifact: { role: string }) => artifact.role === 'lighting').sha256 =
      await sha256File(candidateLighting);
    metadata.artifacts.find(
      (artifact: { role: string }) =>
        artifact.role === 'verification-lighting-adaptation-compatibility',
    ).sha256 = await sha256File(candidateReport);
    await writeFile(metadataFile, YAML.stringify(metadata));
    await expect(
      publishApprovedCampaignAssets(campaignFile, {
        sourceIds: ['gallery-lighting'],
        reviewer: 'test-reviewer',
        rationale: 'Rewritten hashes must not conceal altered light placement semantics.',
      }),
    ).rejects.toThrow(/fails live semantic validation|positions or targets/);
    expect((await loadAssetMetadata(metadataFile)).status).toBe('validated');
  });

  it('rejects forged editorial semantics even when pixels, treatment, report, and hashes are rewritten', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-editorial-publication-forgery-'));
    const library = join(directory, 'library');
    const campaignFile = join(directory, 'cinematic-campaign.json');
    const work = join(directory, 'work/editorial');
    const verification = join(directory, 'work/scenes/product/verification');
    const deliveryReport = join(directory, 'delivery/edit-report.json');
    await Promise.all([
      mkdir(work, { recursive: true }),
      mkdir(verification, { recursive: true }),
      mkdir(join(directory, 'delivery'), { recursive: true }),
    ]);
    await writeFile(join(verification, 'scene-render.json'), '{"status":"pass"}\n');
    await writeFile(join(verification, 'contact-sheet.png'), 'png-fixture');
    await writeFile(deliveryReport, '{"status":"pass"}\n');
    const base = createRiseOfDemonsTitleTreatment();
    const parent = await writeVerifiedFixtureAsset({
      library,
      directory: 'materials/editorial-parent',
      id: base.id,
      version: '1.0.0',
      type: 'material',
      role: 'title-treatment',
      filename: 'title-treatment.json',
      contents: `${JSON.stringify(base)}\n`,
    });
    const publication = campaignAssetPublicationSchema.parse({
      assetId: 'editorial.test-event-lockup',
      version: '1.0.0',
      type: 'editorial',
      title: 'Test event lockup',
      description: 'A bounded deterministic event identity derived from a verified treatment.',
      tags: ['editorial', 'event'],
      capabilities: ['safe-area', 'deterministic-render'],
      generator: 'videoer.editorial-treatment.v1',
      renderers: ['ffmpeg-full', 'remotion'],
      verification: {
        checks: ['editorial.safe-area', 'editorial.deterministic-render'],
        shots: ['product'],
      },
    });
    const declaredAdaptation = {
      kind: 'editorial-treatment-v1' as const,
      assetId: 'editorial.test-event-lockup',
      canvas: { width: 480, height: 270 },
      safeAreaMargins: { left: 0.08, top: 0.08, right: 0.08, bottom: 0.08 },
      copy: {
        eyebrow: 'LIGHT / MATTER / MEMORY',
        title: 'NOCTURNE',
        cta: '14 SEPTEMBER — 03 NOVEMBER',
      },
      palette: { background: '#02030a', foreground: '#f2f4ff', accent: '#8ebcff' },
      motifOpacity: 0.28,
      typographyScale: 1,
      metadata: {},
    };
    const campaign = {
      schemaVersion: 1,
      id: 'campaign.editorial-forgery',
      fps: 24,
      resolution: { width: 480, height: 270, percentage: 100 },
      assetLibrary: 'library',
      geometry: [
        {
          id: 'product',
          path: 'work/product.json',
          recipe: {
            assetId: 'prop.editorial-fixture',
            primitives: [
              {
                kind: 'box',
                minimum: [-0.5, 0, -0.2],
                maximum: [0.5, 1, 0.2],
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
            attachments: {},
          },
        },
      ],
      overlays: [
        {
          id: 'event-lockup',
          path: 'work/editorial/event-lockup.png',
          treatmentPath: 'work/editorial/event-lockup.json',
          library: {
            type: 'material',
            query: 'verified editorial parent',
            tags: ['editorial'],
            capabilities: ['deterministic-render', 'event-lockup'],
            preferredAsset: { id: base.id, version: '1.0.0' },
            artifactRole: 'title-treatment',
          },
          adaptation: {
            ...declaredAdaptation,
            providesCapabilities: ['event-lockup'],
            publication,
          },
        },
      ],
      soundtrackPath: 'work/audio.wav',
      soundtrack: {
        schemaVersion: 1,
        id: 'audio.editorial-fixture',
        durationSeconds: 1,
        sampleRate: 48000,
        channels: 2,
        cues: [
          {
            id: 'tone',
            kind: 'tone-bed',
            startSeconds: 0,
            endSeconds: 1,
            gain: 0.03,
            frequencyHz: 110,
            purpose: 'Publication fixture',
          },
        ],
      },
      shots: [
        {
          id: 'product',
          frames: 24,
          entities: [{ id: 'product', geometry: 'product', role: 'prop' }],
          camera: {
            keyframes: [
              {
                time: 0,
                position: { world: [0, 1, -3] },
                target: { world: [0, 0.5, 0] },
                lensMillimeters: 50,
              },
              {
                time: 1,
                position: { world: [0, 1, -2.8] },
                target: { world: [0, 0.5, 0] },
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
          atmosphere: { rain: { enabled: false } },
          overlays: [
            {
              overlay: 'event-lockup',
              startSeconds: 0,
              endSeconds: 1,
              fadeInSeconds: 0,
              fadeOutSeconds: 0,
            },
          ],
          landmarks: [
            { id: 'start', progress: 0, description: 'Start' },
            { id: 'end', progress: 1, description: 'End' },
          ],
        },
      ],
      delivery: { id: 'edit.editorial-fixture', directory: 'delivery' },
    };
    await writeFile(campaignFile, JSON.stringify(campaign));
    const treatment = adaptEditorialTreatment(base, declaredAdaptation);
    const treatmentPath = join(work, 'event-lockup.json');
    const overlayPath = join(work, 'event-lockup.png');
    await writeFile(treatmentPath, `${JSON.stringify(treatment)}\n`);
    const font = await resolveCormorantGaramondFont();
    await renderEditorialTreatment(treatment, font, overlayPath);
    const semantic = verifyEditorialTreatmentAdaptation(base, treatment, declaredAdaptation);
    const rendering = await verifyEditorialTreatmentRendering(treatment, font, overlayPath);
    expect(semantic.valid && rendering.valid).toBe(true);
    const reportPath = join(work, 'compatibility-report.json');
    await writeFile(
      reportPath,
      `${JSON.stringify({
        baseAsset: { id: base.id, version: '1.0.0' },
        baseArtifactRole: 'title-treatment',
        baseEditorialSha256: await sha256File(parent),
        adaptedTreatmentSha256: await sha256File(treatmentPath),
        adaptedEditorialSha256: await sha256File(overlayPath),
        adaptation: declaredAdaptation,
        operations: {
          fontChanged: false,
          motifChanged: false,
          deterministicPixelsChanged: false,
          safeAreaViolated: false,
        },
        compatibility: {
          fontPreserved: true,
          motifPreserved: true,
          exactTreatmentMatched: true,
          deterministicRenderMatched: true,
          dimensionsMatched: true,
          linesInsideSafeArea: true,
          contrast: rendering.contrast,
          fontSha256: rendering.fontSha256,
        },
        validation: { valid: true },
      })}\n`,
    );
    await prepareCampaignPublicationCandidates({
      root: directory,
      campaignId: campaign.id,
      campaignFile,
      libraryRoot: library,
      deliveryReport,
      items: [
        {
          sourceId: 'event-lockup',
          artifactPath: overlayPath,
          artifactRole: 'transparent-overlay',
          mediaType: 'image/png',
          publication,
          sourceAsset: `${base.id}@1.0.0`,
          requires: [{ id: base.id, version: '1.0.0' }],
          extraEvidence: [
            {
              path: treatmentPath,
              role: 'editorial-treatment',
              mediaType: 'application/vnd.videoer.title+json',
            },
            {
              path: reportPath,
              role: 'verification-editorial-adaptation-compatibility',
              mediaType: 'application/json',
            },
          ],
        },
      ],
    });
    const candidateDirectory = join(directory, 'work/publication-candidates/event-lockup');
    const candidateOverlay = join(candidateDirectory, 'transparent-overlay.png');
    const candidateTreatment = join(
      candidateDirectory,
      'verification/adaptation/editorial-treatment.json',
    );
    const candidateReport = join(
      candidateDirectory,
      'verification/adaptation/verification-editorial-adaptation-compatibility.json',
    );
    const forgedAdaptation = {
      ...declaredAdaptation,
      copy: { ...declaredAdaptation.copy, title: 'FORGED IDENTITY' },
    };
    const forgedTreatment = adaptEditorialTreatment(base, forgedAdaptation);
    await writeFile(candidateTreatment, `${JSON.stringify(forgedTreatment)}\n`);
    await renderEditorialTreatment(forgedTreatment, font, candidateOverlay);
    const forgedReport = JSON.parse(await readFile(candidateReport, 'utf8'));
    forgedReport.adaptation = forgedAdaptation;
    forgedReport.adaptedTreatmentSha256 = await sha256File(candidateTreatment);
    forgedReport.adaptedEditorialSha256 = await sha256File(candidateOverlay);
    await writeFile(candidateReport, `${JSON.stringify(forgedReport)}\n`);
    const metadataFile = join(candidateDirectory, 'asset.yaml');
    const metadata = YAML.parse(await readFile(metadataFile, 'utf8'));
    metadata.artifacts.find(
      (artifact: { role: string }) => artifact.role === 'transparent-overlay',
    ).sha256 = await sha256File(candidateOverlay);
    metadata.artifacts.find(
      (artifact: { role: string }) => artifact.role === 'editorial-treatment',
    ).sha256 = await sha256File(candidateTreatment);
    metadata.artifacts.find(
      (artifact: { role: string }) =>
        artifact.role === 'verification-editorial-adaptation-compatibility',
    ).sha256 = await sha256File(candidateReport);
    await writeFile(metadataFile, YAML.stringify(metadata));
    await expect(
      publishApprovedCampaignAssets(campaignFile, {
        sourceIds: ['event-lockup'],
        reviewer: 'test-reviewer',
        rationale: 'Rewritten candidate semantics must remain bound to current campaign intent.',
      }),
    ).rejects.toThrow(/adaptation differs from the current campaign declaration/);
    expect((await loadAssetMetadata(metadataFile)).status).toBe('validated');
  });

  it('rejects forged audio treatment even when candidate and lineage hashes are rewritten', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-audio-publication-forgery-'));
    const library = join(directory, 'library');
    const campaignFile = join(directory, 'cinematic-campaign.yaml');
    const sourceDirectory = join(library, 'audio/source-score/1.0.0');
    const sourceAudio = join(sourceDirectory, 'master.wav');
    const adaptedAudio = join(directory, 'work/audio/treated.wav');
    const compatibility = join(
      directory,
      'work/adaptations/treated-audio/compatibility-report.json',
    );
    const verificationDirectory = join(directory, 'work/scenes/product/verification');
    const deliveryReport = join(directory, 'delivery/edit-report.json');
    await Promise.all([
      mkdir(sourceDirectory, { recursive: true }),
      mkdir(join(directory, 'work/audio'), { recursive: true }),
      mkdir(join(directory, 'work/adaptations/treated-audio'), { recursive: true }),
      mkdir(verificationDirectory, { recursive: true }),
      mkdir(join(directory, 'delivery'), { recursive: true }),
    ]);
    await writeFile(campaignFile, 'schemaVersion: 1\n', 'utf8');
    await writeFile(join(verificationDirectory, 'scene-render.json'), '{"status":"pass"}\n');
    await writeFile(join(verificationDirectory, 'contact-sheet.png'), 'png-fixture');
    await writeFile(deliveryReport, '{"status":"pass"}\n');
    await renderSoundtrackPlan(
      soundtrackPlanSchema.parse({
        schemaVersion: 1,
        id: 'audio.source-score',
        durationSeconds: 2,
        sampleRate: 48000,
        channels: 2,
        cues: [
          {
            id: 'bed',
            kind: 'noise-bed',
            startSeconds: 0,
            endSeconds: 2,
            gain: 0.08,
            seed: 771,
            purpose: 'Verified parent fixture',
          },
        ],
      }),
      sourceAudio,
    );
    await writeFile(
      join(sourceDirectory, 'asset.yaml'),
      YAML.stringify({
        schemaVersion: 1,
        id: 'audio.source-score',
        version: '1.0.0',
        type: 'audio',
        title: 'Source score',
        description: 'Verified deterministic parent score.',
        status: 'verified',
        tags: ['score'],
        capabilities: ['provider-free'],
        source: {
          kind: 'procedural',
          generator: 'videoer.test-audio.v1',
          references: [],
          licence: {
            spdx: 'LicenseRef-Videoer-Test',
            name: 'Videoer test fixture',
            commercialUse: 'allowed',
            attributionRequired: false,
          },
          clearance: 'approved',
        },
        artifacts: [
          {
            role: 'master',
            path: 'master.wav',
            mediaType: 'audio/wav',
            sha256: await sha256File(sourceAudio),
          },
        ],
        compatibility: { renderers: ['ffmpeg-full'], requires: [] },
        verification: {
          checks: ['audio.verified'],
          artifacts: [],
          verifiedAt: '2026-08-31T00:00:00.000Z',
        },
      }),
    );
    const treatment = audioTreatmentSchema.parse({
      kind: 'cinematic-audio-treatment-v1',
      assetId: 'audio.treated-score',
      durationSeconds: 2,
      highpassHz: 60,
      lowpassHz: 10000,
      gainDb: -1,
      fadeInSeconds: 0.04,
      fadeOutSeconds: 0.08,
      accents: [
        {
          id: 'resolve',
          kind: 'tonal-accent',
          startSeconds: 1,
          endSeconds: 1.8,
          gain: 0.2,
          frequencyHz: 220,
        },
      ],
    });
    await renderAudioTreatment(sourceAudio, adaptedAudio, treatment);
    const validation = await verifyAudioTreatment(sourceAudio, adaptedAudio, treatment);
    expect(validation.valid).toBe(true);
    await writeFile(
      compatibility,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          adaptationKind: treatment.kind,
          baseAsset: { id: 'audio.source-score', version: '1.0.0' },
          baseArtifactRole: 'master',
          baseAudioSha256: await sha256File(sourceAudio),
          adaptedAudioSha256: await sha256File(adaptedAudio),
          treatment,
          operations: {
            selectedIntervalChanged: false,
            temporalEnvelopeChanged: false,
            sampleRateChanged: false,
            channelLayoutChanged: false,
          },
          compatibility: validation.compatibility,
          validation,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const publication = campaignAssetPublicationSchema.parse({
      assetId: 'audio.treated-score',
      version: '1.0.0',
      type: 'audio',
      title: 'Treated score',
      description: 'Deterministic derived score with exact parent lineage.',
      tags: ['score'],
      capabilities: ['deterministic-treatment'],
      generator: 'videoer.cinematic-audio-treatment.v1',
      renderers: ['ffmpeg-full'],
      verification: { checks: ['audio.deterministic-rerender'], shots: ['product'] },
    });
    await prepareCampaignPublicationCandidates({
      root: directory,
      campaignId: 'campaign.audio-forgery',
      campaignFile,
      libraryRoot: library,
      deliveryReport,
      items: [
        {
          sourceId: 'treated-audio',
          artifactPath: adaptedAudio,
          artifactRole: 'audio',
          mediaType: 'audio/wav',
          publication,
          sourceAsset: 'audio.source-score@1.0.0',
          requires: [{ id: 'audio.source-score', version: '1.0.0' }],
          extraEvidence: [
            {
              path: compatibility,
              role: 'verification-audio-adaptation-compatibility',
              mediaType: 'application/json',
            },
          ],
        },
      ],
    });
    const candidateDirectory = join(directory, 'work/publication-candidates/treated-audio');
    const candidateAudio = join(candidateDirectory, 'audio.wav');
    const candidateReport = join(
      candidateDirectory,
      'verification/adaptation/verification-audio-adaptation-compatibility.json',
    );
    await renderAudioTreatment(sourceAudio, candidateAudio, { ...treatment, gainDb: 8 });
    const forgedReport = JSON.parse(await readFile(candidateReport, 'utf8'));
    forgedReport.adaptedAudioSha256 = await sha256File(candidateAudio);
    await writeFile(candidateReport, `${JSON.stringify(forgedReport, null, 2)}\n`, 'utf8');
    const candidateMetadataFile = join(candidateDirectory, 'asset.yaml');
    const candidateMetadata = YAML.parse(await readFile(candidateMetadataFile, 'utf8'));
    candidateMetadata.artifacts.find(
      (artifact: { role: string }) => artifact.role === 'audio',
    ).sha256 = await sha256File(candidateAudio);
    candidateMetadata.artifacts.find(
      (artifact: { role: string }) =>
        artifact.role === 'verification-audio-adaptation-compatibility',
    ).sha256 = await sha256File(candidateReport);
    await writeFile(candidateMetadataFile, YAML.stringify(candidateMetadata), 'utf8');
    await expect(
      publishApprovedCampaignAssets(campaignFile, {
        sourceIds: ['treated-audio'],
        reviewer: 'test-reviewer',
        rationale: 'Rewritten hashes must not conceal altered treatment semantics.',
      }),
    ).rejects.toThrow(/fails live semantic validation|deterministic treatment rendering/);
    expect((await loadAssetMetadata(candidateMetadataFile)).status).toBe('validated');
  });
});
