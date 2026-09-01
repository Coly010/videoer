#!/usr/bin/env node
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import {
  inspectCampaign,
  validateCampaign,
  validateStoryboard,
  verifyCampaign,
} from './application/campaigns.js';
import { ValidationError } from './domain/io.js';
import { checkMediaDependencies } from './media/dependencies.js';
import { inspectImage, inspectVideo } from './media/inspection.js';
import { inspectRender, renderCampaign, reviseShot, verifyRender } from './application/workflow.js';
import { generateSceneKeyframes, regenerateSceneKeyframe } from './application/generation.js';
import { motionPresets, type MotionPreset } from './domain/motion.js';
import { loadCampaign } from './domain/io.js';
import { CodexImageProvider } from './providers/codex-image.js';
import { FakeImageProvider } from './providers/fake-image.js';
import { ProviderRegistry } from './providers/contracts.js';
import { inspectScenes, inspectShotVideo, renderShot } from './application/scenes.js';
import { effectBundleNames, effectPresetNames } from './vfx/registry.js';
import { particlePresetNames } from './particles/presets.js';
import {
  buildAssetIndex,
  deprecateAsset,
  findAsset,
  isAssetKind,
  loadAssetMetadata,
  publishAsset,
  searchAssetLibrary,
  validateLibraryAsset,
} from './assets/library.js';
import { auditAssetLibrary, repairAssetLibraryFromSources } from './assets/integrity.js';
import { importAmbientCgMaterialSource } from './assets/sources/ambientcg.js';
import { openMaterialSourceImportRequestSchema } from './assets/sources/model.js';
import { resolveProductionAssets, validateProductionPlan } from './application/production.js';
import type { AssetKind } from './production/model.js';
import {
  createMannequin,
  createProductionHumanFoundation,
  validateGeometryFile,
} from './application/geometry.js';
import { renderGeometryProbe } from './geometry/blender.js';
import { createWalkMotion, createWalkProbe, validateMotionFile } from './application/motion.js';
import { gaitStyles, type GaitStyle } from './motion/gait.js';
import { createCharacterAsset, inspectCharacterAnatomy } from './application/characters.js';
import { createBookshopEnvironment } from './application/environments.js';
import { createStreetStorageDressingFamily } from './application/environment-dressing.js';
import { acceptStreetStorageDressingFamily } from './application/environment-dressing-acceptance.js';
import { createInsetArchitecturalWindowAsset } from './application/architectural-windows.js';
import { acceptInsetArchitecturalWindow } from './application/architectural-window-acceptance.js';
import { createArchitecturalRainwaterAsset } from './application/architectural-rainwater.js';
import { acceptArchitecturalRainwaterAsset } from './application/architectural-rainwater-acceptance.js';
import { createProjectingHangingSignAsset } from './application/projecting-signs.js';
import { acceptProjectingHangingSign } from './application/projecting-sign-acceptance.js';
import { createProjectingSupportedCanopyAsset } from './application/projecting-canopies.js';
import { acceptProjectingSupportedCanopy } from './application/projecting-canopy-acceptance.js';
import { createArchitecturalEnvelopeTransferFixtures } from './application/architectural-envelope-fixtures.js';
import {
  bindPavingConstructionMaterials,
  bindPavingUnitMaterial,
} from './application/paving-material-assembly.js';
import {
  createPavingSurfaceWaterField,
  loadSurfaceWaterAssemblyProfile,
  rebindCinematicSurfaceWaterReceiver,
} from './application/surface-water.js';
import {
  createOldCitySurfaceMaterialAssets,
  createOldCitySurfaceMaterialAsset,
  createPavingGranularMaterialAsset,
  createWetCobbleMaterialAsset,
} from './application/materials.js';
import { createEnvironmentalSurfaceGallery } from './application/material-gallery.js';
import { acceptEnvironmentalSurfaceSuite } from './application/environmental-material-acceptance.js';
import { loadSurfaceMaterial } from './materials/io.js';
import {
  textureMaterialApplicationSchema,
  textureMaterialSuitabilitySchema,
} from './materials/model.js';
import {
  assessTextureMaterialSuitability,
  deriveTextureSurfaceMaterial,
} from './materials/texture-maps.js';
import { createDarkDressAsset } from './application/clothing.js';
import {
  createAtmosphericGroundResponseProbe,
  createAtmosphericVfxTransferProbe,
  createRainyDuskVfxAsset,
  writeRainyDuskVfxDefinition,
} from './application/vfx.js';
import { acceptAtmosphericVfxCandidate } from './application/vfx-acceptance.js';
import { createSourceBoundAerosolVfxAsset } from './application/aerosol-vfx.js';
import { acceptSourceBoundAerosolVfxAsset } from './application/aerosol-vfx-acceptance.js';
import { createCinematicFinishAsset } from './application/cinematic-finish.js';
import { acceptCinematicFinishAsset } from './application/cinematic-finish-acceptance.js';
import { createBookshopLightingAssets } from './application/lighting.js';
import { createMoonlitExteriorLightingAsset } from './application/moonlit-lighting.js';
import { createFirelitInteriorLightingAsset } from './application/firelit-lighting.js';
import { createProductionSoundEffectLibrary } from './application/sound-effects.js';
import { createSoundEffectAudition } from './application/sound-effect-audition.js';
import { createPulledBackHairAsset } from './application/hair.js';
import { acceptHairCandidate } from './application/hair-acceptance.js';
import { createPortableWallLanternAsset } from './application/fixtures.js';
import { createPortableNeonBladeSignAsset } from './application/neon-fixtures.js';
import { createPottedVegetationDressingFamily } from './application/vegetation-dressing.js';
import { acceptPottedVegetationDressingFamily } from './application/vegetation-dressing-acceptance.js';
import { createMarketWorldDressingFamily } from './application/market-world.js';
import { acceptMarketWorldDressingFamily } from './application/market-world-acceptance.js';
import { createWorkshopWorldDressingFamily } from './application/workshop-world.js';
import { acceptWorkshopWorldDressingFamily } from './application/workshop-world-acceptance.js';
import { createInteriorFurnishingCandidates } from './application/interior-furnishings.js';
import { acceptInteriorFurnishingFamily } from './application/interior-furnishing-acceptance.js';
import { acceptPortableFixtureCandidate } from './application/fixture-acceptance.js';
import { compareDeterministicRenderProfile } from './application/render-profile-comparison.js';
import { createLightingTransferProbe } from './application/lighting-transfer.js';
import { acceptLightingCandidate } from './application/lighting-acceptance.js';
import { createEditorialAssets } from './application/editorial.js';
import { assembleEdit } from './application/editing.js';
import { buildDeclarativeCinematicCampaign } from './application/cinematic-campaign.js';
import {
  loadCinematicProductionRun,
  produceDeclarativeCinematicCampaign,
  recordCinematicProductionReview,
} from './application/cinematic-production.js';
import { publishApprovedCampaignAssets } from './application/cinematic-publication.js';
import { loadDeclarativeCinematicCampaign } from './production/cinematic-campaign-io.js';
import { renderCinematicProbe, renderCinematicScene } from './cinematic/blender.js';
import { loadCinematicScene } from './cinematic/io.js';
import { verifyCinematicScene } from './cinematic/verification.js';
import {
  createInteractionProbe,
  createTurnAsset,
  type InteractionKind,
} from './application/interactions.js';

interface Envelope {
  version: 1;
  ok: boolean;
  command: string;
  data?: unknown;
  error?: { code: string; message: string; details?: unknown };
}
const envelope = (command: string, data: unknown): Envelope => ({
  version: 1,
  ok: true,
  command,
  data,
});
async function imageProvider(campaignFile: string, requested?: string) {
  const campaign = await loadCampaign(campaignFile);
  const id = requested ?? campaign.providers.image;
  if (!id)
    throw new Error('No image provider selected; set campaign.providers.image or pass --provider');
  const registry = new ProviderRegistry()
    .registerImage(new FakeImageProvider())
    .registerImage(new CodexImageProvider());
  return registry.image(id);
}
function output<T>(command: Command, name: string, data: T, human: (data: T) => string) {
  console.log(
    command.optsWithGlobals().json ? JSON.stringify(envelope(name, data), null, 2) : human(data),
  );
}

const program = new Command()
  .name('video')
  .description('Agent-operable, local-first marketing video toolkit')
  .version('0.2.0')
  .option('--debug', 'show stack traces')
  .option('--json', 'emit a stable machine-readable envelope');

const cinematicCampaign = program
  .command('cinematic-campaign')
  .description('validated data-driven multi-shot cinematic campaign operations');
cinematicCampaign
  .command('validate')
  .argument('<campaign-file>')
  .description('validate geometry recipes, semantic shots, audio, overlays, and exact edit timing')
  .action(async function (campaignFile: string) {
    const data = await loadDeclarativeCinematicCampaign(campaignFile);
    output(
      this,
      'cinematic-campaign.validate',
      data,
      (result) => `✓ ${result.shots.length} declarative shots / ${result.id}`,
    );
  });
cinematicCampaign
  .command('build')
  .argument('<campaign-file>')
  .option(
    '--no-render',
    'build artifacts, scene manifests, soundtrack, and edit plan without Blender',
  )
  .description(
    'build and optionally render a complete campaign without campaign-specific source code',
  )
  .action(async function (campaignFile: string, options: { render: boolean }) {
    const data = await buildDeclarativeCinematicCampaign(campaignFile, { render: options.render });
    output(
      this,
      'cinematic-campaign.build',
      data,
      (result) => `✓ ${result.scenes.length} declarative scenes → ${result.root}`,
    );
  });
cinematicCampaign
  .command('produce')
  .argument('<campaign-file>')
  .option(
    '--repair-shots <shot-ids...>',
    'force named shots into the dependency-aware selective repair set',
  )
  .description('run the resumable plan, resolve, build, render, inspect, and delivery pipeline')
  .action(async function (campaignFile: string, options: { repairShots?: string[] }) {
    const data = await produceDeclarativeCinematicCampaign(campaignFile, {
      ...(options.repairShots ? { repairShots: options.repairShots } : {}),
    });
    output(
      this,
      'cinematic-campaign.produce',
      data,
      (result) =>
        `${result.run.status === 'needs-repair' ? '✗' : '✓'} ${result.run.campaignId}: rendered ${result.staleShots.length} stale shot(s), ${result.failedShots.length} failed → ${result.stateFile}`,
    );
    if (data.run.status === 'needs-repair') process.exitCode = 2;
  });
cinematicCampaign
  .command('production-status')
  .argument('<campaign-file>')
  .description('inspect the persisted autonomous production stage ledger')
  .action(async function (campaignFile: string) {
    const data = await loadCinematicProductionRun(campaignFile);
    output(
      this,
      'cinematic-campaign.production-status',
      data,
      (result) =>
        `${result.run.status.toUpperCase()}: ${result.run.shots.filter((shot) => shot.status === 'pass').length}/${result.run.shots.length} shots pass, ${result.run.attempts.length} attempt(s) → ${result.stateFile}`,
    );
  });
cinematicCampaign
  .command('review')
  .argument('<campaign-file>')
  .argument('<review-file>')
  .description('record a complete hash-bound qualitative shot and final-delivery review')
  .action(async function (campaignFile: string, reviewFile: string) {
    const data = await recordCinematicProductionReview(campaignFile, reviewFile);
    output(
      this,
      'cinematic-campaign.review',
      data,
      (result) =>
        `${result.run.status === 'completed' ? '✓' : '✗'} ${result.run.status}: review → ${result.review}`,
    );
    if (data.run.status !== 'completed') process.exitCode = 2;
  });
cinematicCampaign
  .command('publish-assets')
  .argument('<campaign-file>')
  .requiredOption(
    '--approve <source-ids...>',
    'explicit publication candidate source IDs to approve',
  )
  .requiredOption('--reviewer <identity>', 'human or accountable operator approving the evidence')
  .requiredOption('--rationale <text>', 'review rationale recorded with the immutable asset')
  .description('approve rendered campaign candidates and publish immutable verified library assets')
  .action(async function (
    campaignFile: string,
    options: { approve: string[]; reviewer: string; rationale: string },
  ) {
    const data = await publishApprovedCampaignAssets(campaignFile, {
      sourceIds: options.approve,
      reviewer: options.reviewer,
      rationale: options.rationale,
    });
    output(
      this,
      'cinematic-campaign.publish-assets',
      data,
      (result) => `✓ published ${result.published.length} approved asset(s) → ${result.index}`,
    );
  });

program
  .command('validate')
  .argument('<campaign>')
  .description('validate a campaign YAML file')
  .action(async function (p) {
    const data = await validateCampaign(p);
    output(
      this,
      'campaign.validate',
      data,
      (d) => `✓ Campaign '${d.title}' is valid (schema v${d.schemaVersion}, ${d.durationSeconds}s)`,
    );
  });
program
  .command('inspect')
  .argument('<campaign>')
  .description('inspect a campaign workspace')
  .action(async function (p) {
    const data = await inspectCampaign(p);
    output(
      this,
      'campaign.inspect',
      data,
      (d) =>
        `Campaign '${d.campaign.title}': ${d.storyboard ? `${d.storyboard.shots} shots` : 'no storyboard'}, ${d.state.generatedAssets} generated assets, ${d.state.renders} renders`,
    );
  });
program
  .command('verify')
  .argument('<campaign>')
  .description('run deterministic campaign and storyboard checks')
  .action(async function (p) {
    const data = await verifyCampaign(p);
    output(
      this,
      'campaign.verify',
      data,
      (d) =>
        `${d.status.toUpperCase()}: ${d.checks.filter((c) => c.status === 'pass').length} passed, ${d.checks.filter((c) => c.status === 'warning').length} warnings, ${d.checks.filter((c) => c.status === 'fail').length} failed`,
    );
    if (data.status === 'fail') process.exitCode = 2;
  });

const storyboard = program.command('storyboard').description('storyboard operations');
storyboard
  .command('validate')
  .argument('<storyboard>')
  .action(async function (p) {
    const data = await validateStoryboard(p);
    output(
      this,
      'storyboard.validate',
      data,
      (d) => `✓ Storyboard '${d.title}' is valid (schema v${d.schemaVersion}, ${d.shots} shots)`,
    );
  });

program
  .command('generate-assets')
  .argument('<campaign>')
  .option('--shot <shot-id>', 'generate only one scene-keyframes shot')
  .option('--keyframe <keyframe-id>', 'generate only one keyframe (requires its anchor)')
  .option('--provider <provider-id>', 'override campaign.providers.image')
  .option('--force', 'ignore matching cached assets')
  .description('generate missing scene-keyframes assets with continuity references')
  .action(async function (
    p,
    options: { shot?: string; keyframe?: string; provider?: string; force?: boolean },
  ) {
    if (options.keyframe && !options.shot) throw new Error('--keyframe requires --shot');
    const provider = await imageProvider(p, options.provider);
    const data = await generateSceneKeyframes(p, provider, {
      ...(options.shot ? { shotId: options.shot } : {}),
      ...(options.keyframe ? { keyframeId: options.keyframe } : {}),
      ...(options.force ? { force: true } : {}),
    });
    output(
      this,
      'assets.generate',
      data,
      (d) => `✓ ${d.generated.length} scene keyframe assets handled by ${d.provider}`,
    );
  });

const media = program.command('media').description('media inspection operations');
media
  .command('image')
  .argument('<path>')
  .description('inspect image metadata')
  .action(async function (p) {
    const data = await inspectImage(p);
    output(
      this,
      'media.image.inspect',
      data,
      (d) => `${d.format.toUpperCase()} ${d.width ?? '?'}x${d.height ?? '?'} (${d.bytes} bytes)`,
    );
  });
media
  .command('video')
  .argument('<path>')
  .description('inspect video metadata using ffprobe')
  .action(async function (p) {
    const data = await inspectVideo(p);
    output(this, 'media.video.inspect', data, () => JSON.stringify(data, null, 2));
  });

program
  .command('doctor')
  .description('check external media dependencies')
  .action(async function () {
    const data = await checkMediaDependencies();
    output(this, 'doctor', data, (checks) =>
      checks.map((c) => `${c.available ? '✓' : '✗'} ${c.name}: ${c.detail}`).join('\n'),
    );
    if (data.some((c) => !c.available)) process.exitCode = 3;
  });

program
  .command('render')
  .argument('<campaign>')
  .description('deterministically render a versioned campaign MP4')
  .option('--draft', 'render a faster half-width inspection draft')
  .option('--final', 'render at campaign delivery settings')
  .option('--change <message...>', 'record what changed since the parent render')
  .action(async function (p, options: { draft?: boolean; final?: boolean; change?: string[] }) {
    if (options.draft && options.final) throw new Error('Choose either --draft or --final');
    const data = await renderCampaign(p, {
      kind: options.final ? 'final' : 'draft',
      ...(options.change ? { changes: options.change } : {}),
    });
    output(
      this,
      'render.create',
      data,
      (d) => `✓ ${d.revision.id} (${d.revision.kind}) → ${d.output.path}`,
    );
  });

program
  .command('inspect-render')
  .argument('<campaign>')
  .argument('[render]', 'render ID or latest', 'latest')
  .description('extract sampled frames, metadata, and a contact sheet')
  .action(async function (p, renderId) {
    const data = await inspectRender(p, renderId);
    output(
      this,
      'render.inspect',
      data,
      (d) => `✓ ${d.revision.id}: ${d.frames.length} sampled frames → ${d.contactSheet}`,
    );
  });

program
  .command('verify-render')
  .argument('<campaign>')
  .argument('[render]', 'render ID or latest', 'latest')
  .description('verify video delivery properties and persist a report')
  .action(async function (p, renderId) {
    const data = await verifyRender(p, renderId);
    output(
      this,
      'render.verify',
      data,
      (d) => `${d.status.toUpperCase()}: ${d.revision.id} → ${d.reportPath}`,
    );
    if (data.status === 'fail') process.exitCode = 2;
  });

const shot = program.command('shot').description('selective shot operations');
shot
  .command('render')
  .argument('<campaign>')
  .argument('<shot-id>')
  .option('--preview', 'render at preview resolution')
  .option('--from <seconds>', 'start within the shot', Number.parseFloat)
  .option('--to <seconds>', 'end within the shot', Number.parseFloat)
  .option('--output <path>', 'output MP4 path')
  .description('render one shot or a short range for visual iteration')
  .action(async function (
    p,
    shotId,
    options: { preview?: boolean; from?: number; to?: number; output?: string },
  ) {
    const data = await renderShot(p, shotId, options);
    output(this, 'shot.render', data, (d) => `✓ ${d.shotId} ${d.from}s–${d.to}s → ${d.path}`);
  });
shot
  .command('inspect')
  .argument('<video>')
  .option('--output <directory>', 'deterministic frame output directory')
  .description('extract 0/25/50/75/100% frames and a contact sheet from a shot render')
  .action(async function (p, options: { output?: string }) {
    const data = await inspectShotVideo(p, options.output);
    output(this, 'shot.inspect', data, (d) => `✓ ${d.frames.length} frames → ${d.contactSheet}`);
  });
shot
  .command('revise')
  .argument('<campaign>')
  .argument('<shot-id>')
  .option('--text <text>')
  .option('--caption <caption>')
  .option('--motion <preset>', `one of: ${motionPresets.join(', ')}`)
  .description('revise only one shot without regenerating unrelated assets')
  .action(async function (
    p,
    shotId,
    options: { text?: string; caption?: string; motion?: string },
  ) {
    if (options.motion && !motionPresets.includes(options.motion as MotionPreset))
      throw new Error(`Unknown motion preset '${options.motion}'`);
    const data = await reviseShot(p, shotId, {
      ...(options.text ? { text: options.text } : {}),
      ...(options.caption ? { caption: options.caption } : {}),
      ...(options.motion ? { motion: options.motion as MotionPreset } : {}),
    });
    output(
      this,
      'shot.revise',
      data,
      (d) => `✓ ${d.shotId} revision ${d.revision}; changed ${d.changed.join(', ')}`,
    );
  });

const scene = program.command('scene').description('scene composition operations');
scene
  .command('validate')
  .argument('<campaign>')
  .description('validate scene assets, presets, timing, and renderer availability')
  .action(async function (p) {
    const data = await inspectScenes(p);
    output(this, 'scene.validate', data, (d) =>
      d.valid
        ? `✓ ${d.scenes} scenes, ${d.layers} layers, ${d.effects} effects`
        : `✗ ${d.issues.length} scene issues`,
    );
    if (!data.valid) process.exitCode = 2;
  });
scene
  .command('inspect')
  .argument('<campaign>')
  .description('inspect sorted scene layers, depth, timing, and effects')
  .action(async function (p) {
    const data = await inspectScenes(p);
    output(this, 'scene.inspect', data, () => JSON.stringify(data, null, 2));
  });

const vfx = program.command('vfx').description('VFX presets and atmospheric asset operations');
vfx
  .command('list')
  .description('list registered VFX presets and bundles')
  .action(function () {
    const data = { presets: effectPresetNames, bundles: effectBundleNames };
    output(
      this,
      'vfx.list',
      data,
      (d) => `VFX presets:\n${d.presets.join('\n')}\n\nBundles:\n${d.bundles.join('\n')}`,
    );
  });

const lighting = program
  .command('lighting')
  .description('renderer-independent reusable lighting-rig operations');
lighting
  .command('create-moonlit-exterior')
  .argument('<output-directory>')
  .description('build and cross-environment verify a reusable moonlit exterior rig candidate')
  .action(async function (outputDirectory: string) {
    const data = await createMoonlitExteriorLightingAsset(outputDirectory);
    output(
      this,
      'lighting.create-moonlit-exterior',
      data,
      (result) => `✓ moonlit courtyard + rooftop transfer candidate → ${result.output}`,
    );
  });
lighting
  .command('create-firelit-interior')
  .argument('<output-directory>')
  .description(
    'build and cross-environment verify a correlated, source-bound firelit interior rig candidate',
  )
  .action(async function (outputDirectory: string) {
    const data = await createFirelitInteriorLightingAsset(outputDirectory);
    output(
      this,
      'lighting.create-firelit-interior',
      data,
      (result) => `✓ firelit chamber + contemporary lounge transfer candidate → ${result.output}`,
    );
  });
lighting
  .command('create-bookshop-rigs')
  .argument('<environment-geometry>')
  .argument('<character-geometry>')
  .argument('<output-root>')
  .option('--only <kind>', 'render only the exterior or interior candidate')
  .description('build and visually verify exterior and interior bookshop lighting rigs')
  .action(async function (
    environmentGeometry: string,
    characterGeometry: string,
    outputRoot: string,
    options: { only?: string },
  ) {
    if (options.only !== undefined && options.only !== 'exterior' && options.only !== 'interior')
      throw new Error(
        `Unknown lighting candidate '${options.only}'; expected exterior or interior`,
      );
    const data = await createBookshopLightingAssets(
      environmentGeometry,
      characterGeometry,
      outputRoot,
      options.only,
    );
    output(
      this,
      'lighting.create-bookshop-rigs',
      data,
      (result) =>
        `✓ ${options.only ?? 'exterior + interior'} reusable lighting rig${options.only ? '' : 's'} → ${result.root}`,
    );
  });
lighting
  .command('transfer-probe')
  .argument('<definition-json>')
  .argument('<output-directory>')
  .description(
    'adapt a candidate rig and render it with a static material witness in an unrelated set',
  )
  .action(async function (definitionPath: string, outputDirectory: string) {
    const data = await createLightingTransferProbe(definitionPath, outputDirectory);
    output(
      this,
      'lighting.transfer-probe',
      data,
      (result) =>
        `✓ ${result.sourceRig} → ${result.adaptedRig} transfer evidence → ${result.output}`,
    );
  });
lighting
  .command('accept-candidate')
  .argument('<asset-directory>')
  .description(
    'verify source and transfer evidence, bind qualitative review, and accept a lighting candidate',
  )
  .action(async function (assetDirectory: string) {
    const data = await acceptLightingCandidate(assetDirectory);
    output(
      this,
      'lighting.accept-candidate',
      data,
      (result) => `✓ accepted ${result.id}@${result.version} with source + transfer evidence`,
    );
  });

const audio = program.command('audio').description('provider-free audio asset operations');
audio
  .command('create-sfx-library')
  .argument('<output-root>')
  .description(
    'build isolated deterministic rain, door, page, and footstep sound-effect candidates',
  )
  .action(async function (outputRoot: string) {
    const data = await createProductionSoundEffectLibrary(outputRoot);
    output(
      this,
      'audio.create-sfx-library',
      data,
      (result) => `✓ ${result.assets.length} isolated sound-effect candidates → ${result.root}`,
    );
  });
audio
  .command('create-sfx-audition')
  .argument('<candidate-root>')
  .argument('<output-directory>')
  .description(
    'mix reusable SFX candidates into a deterministic representative auditory-review fixture',
  )
  .action(async function (candidateRoot: string, outputDirectory: string) {
    const data = await createSoundEffectAudition(candidateRoot, outputDirectory);
    output(
      this,
      'audio.create-sfx-audition',
      data,
      (result) => `✓ technically verified SFX audition awaiting auditory review → ${result.master}`,
    );
  });

const editorial = program
  .command('editorial')
  .description('deterministic campaign title and dimensional cover operations');
editorial
  .command('create-assets')
  .argument('<source-cover>')
  .argument('<output-root>')
  .description('build and visually verify the title treatment and campaign cover assets')
  .action(async function (sourceCover: string, outputRoot: string) {
    const data = await createEditorialAssets(sourceCover, outputRoot);
    output(
      this,
      'editorial.create-assets',
      data,
      (result) => `✓ deterministic title treatment + dimensional cover → ${result.root}`,
    );
  });

const edit = program.command('edit').description('frame-exact deterministic edit assembly');
edit
  .command('assemble')
  .argument('<edit-plan>')
  .argument('<output-directory>')
  .description('assemble ordered clips and audio into a verified frame-exact delivery')
  .action(async function (editPlan: string, outputDirectory: string) {
    const data = await assembleEdit(editPlan, outputDirectory);
    output(
      this,
      'edit.assemble',
      data,
      (result) => `✓ ${result.totalFrames} frames / ${result.durationSeconds}s → ${result.video}`,
    );
  });

program
  .command('particles')
  .command('list')
  .description('list registered particle presets')
  .action(function () {
    const data = { presets: particlePresetNames };
    output(this, 'particles.list', data, (d) => d.presets.join('\n'));
  });

const production = program
  .command('production')
  .description('cinematic production planning operations');
production
  .command('validate')
  .argument('<production-plan>')
  .description('validate a renderer-independent production plan')
  .action(async function (p) {
    const data = await validateProductionPlan(p);
    output(
      this,
      'production.validate',
      data,
      (d) =>
        `✓ ${d.shots} shots, ${d.requirements} asset requirements (${d.unresolved} unresolved)`,
    );
  });
production
  .command('resolve')
  .argument('<production-plan>')
  .option('--library <directory>', 'shared asset library root', 'library')
  .option('--output <path>', 'asset manifest output path')
  .description('resolve requirements to reuse, adaptation, or creation')
  .action(async function (p, options: { library: string; output?: string }) {
    const data = await resolveProductionAssets(p, options.library, options.output);
    output(
      this,
      'production.resolve',
      data,
      (d) =>
        `✓ reuse ${d.counts.reuse}, adapt ${d.counts.adapt}, create ${d.counts.create} → ${d.output}`,
    );
  });

const asset = program.command('asset').description('shared production asset library operations');
const assetSource = asset
  .command('source')
  .description('explicit provenance-aware open asset source operations');
const importMaterialSource = assetSource
  .command('import-material')
  .description('acquire a material source package without publishing or rendering it');
importMaterialSource
  .command('ambientcg')
  .requiredOption('--asset <id>', 'exact ambientCG material asset ID')
  .requiredOption('--resolution <resolution>', 'download resolution such as 1K or 2K')
  .requiredOption('--encoding <encoding>', 'texture encoding: JPG or PNG')
  .requiredOption('--cache <directory>', 'content-addressed source cache root')
  .requiredOption('--output <directory>', 'candidate package output root')
  .requiredOption('--mode <mode>', 'source acquisition mode: online or offline')
  .option('--refresh', 'explicitly reacquire current provider bytes in online mode', false)
  .option('--exact-identity <sha256>', 'require this exact source identity SHA-256')
  .description(
    'import one ambientCG v3 material through the explicit operator boundary; never publishes or renders',
  )
  .action(async function (options: {
    asset: string;
    resolution: string;
    encoding: string;
    cache: string;
    output: string;
    mode: string;
    refresh: boolean;
    exactIdentity?: string;
  }) {
    const request = openMaterialSourceImportRequestSchema.parse({
      provider: 'ambientcg',
      assetId: options.asset,
      resolution: options.resolution,
      encoding: options.encoding,
      cacheDirectory: resolve(options.cache),
      outputDirectory: resolve(options.output),
      mode: options.mode,
      refresh: options.refresh,
      ...(options.exactIdentity ? { expectedSourceIdentitySha256: options.exactIdentity } : {}),
    });
    const { expectedSourceIdentitySha256, ...sourceRequest } = request;
    const data = await importAmbientCgMaterialSource({
      ...sourceRequest,
      ...(expectedSourceIdentitySha256 ? { expectedSourceIdentitySha256 } : {}),
    });
    output(
      this,
      'asset.source.import-material.ambientcg',
      data,
      (result) =>
        `✓ ${result.manifest.asset.id} ${result.manifest.selection.resolution}-${result.manifest.selection.encoding} ${result.fromCache ? 'from cache' : 'acquired'} → ${result.candidate}`,
    );
  });
asset
  .command('search')
  .argument('[query]', 'words describing the required asset', '')
  .option('--library <directory>', 'shared asset library root', 'library')
  .option('--type <type>', 'asset type')
  .option('--tag <tag...>', 'required descriptive tags')
  .option('--capability <capability...>', 'required capabilities')
  .option('--include-uncleared', 'include assets that are not approved for commercial use')
  .description('search reusable assets without manually crawling directories')
  .action(async function (
    query,
    options: {
      library: string;
      type?: string;
      tag?: string[];
      capability?: string[];
      includeUncleared?: boolean;
    },
  ) {
    if (options.type && !isAssetKind(options.type))
      throw new Error(`Unknown asset type '${options.type}'`);
    const data = await searchAssetLibrary(options.library, {
      query,
      ...(options.type ? { type: options.type as AssetKind } : {}),
      ...(options.tag ? { tags: options.tag } : {}),
      ...(options.capability ? { capabilities: options.capability } : {}),
      ...(options.includeUncleared ? { includeUncleared: true } : {}),
    });
    output(this, 'asset.search', data, (items) =>
      items.length
        ? items
            .map(
              (item) =>
                `${item.asset.id}@${item.asset.version} [${item.asset.status}] score=${item.score}${item.missingCapabilities.length ? ` missing=${item.missingCapabilities.join(',')}` : ''}`,
            )
            .join('\n')
        : 'No matching commercially cleared assets.',
    );
  });
asset
  .command('inspect')
  .argument('<id>')
  .argument('[version]')
  .option('--library <directory>', 'shared asset library root', 'library')
  .description('inspect one stable asset identity or exact version')
  .action(async function (id, version: string | undefined, options: { library: string }) {
    const matches = await searchAssetLibrary(options.library, {
      query: id,
      includeUncleared: true,
    });
    const selected = version
      ? await findAsset(options.library, { id, version })
      : matches
          .map((item) => item.asset)
          .filter((item) => item.id === id)
          .sort((a, b) => b.version.localeCompare(a.version))[0];
    if (!selected) throw new Error(`Asset '${id}${version ? `@${version}` : ''}' does not exist`);
    output(this, 'asset.inspect', selected, (item) => YAML.stringify(item));
  });
asset
  .command('audit-library')
  .option('--library <directory>', 'shared asset library root', 'library')
  .description('verify every hashed artifact in every published library version')
  .action(async function (options: { library: string }) {
    const data = await auditAssetLibrary(options.library);
    output(
      this,
      'asset.audit-library',
      data,
      (result) =>
        `${result.valid ? '✓' : '✗'} ${result.assetCount} asset version(s), ${result.invalidAssets.length} invalid, ${result.corruptArtifacts.length} corrupt or missing artifact(s)`,
    );
    if (!data.valid) process.exitCode = 2;
  });
asset
  .command('repair-library')
  .requiredOption(
    '--source <directories...>',
    'accepted candidate roots containing exact source bytes',
  )
  .option('--library <directory>', 'shared asset library root', 'library')
  .description(
    'restore corrupt artifacts only from byte-identical sources or hash-matching canonical JSON without rewriting metadata',
  )
  .action(async function (options: { source: string[]; library: string }) {
    const data = await repairAssetLibraryFromSources(options.library, options.source);
    output(
      this,
      'asset.repair-library',
      data,
      (result) =>
        `${result.after.valid ? '✓' : '✗'} repaired ${result.repaired.length}, unresolved ${result.unresolved.length}; ${result.after.invalidAssets.length} invalid asset version(s) remain`,
    );
    if (!data.after.valid) process.exitCode = 2;
  });
asset
  .command('validate')
  .argument('<asset-directory>')
  .description('validate metadata, licence clearance, and declared artifacts')
  .action(async function (directory) {
    const metadata = await loadAssetMetadata(resolve(directory, 'asset.yaml'));
    const data = await validateLibraryAsset(metadata);
    output(this, 'asset.validate', data, (result) =>
      result.valid
        ? '✓ Asset is valid and commercially cleared'
        : `✗ ${result.issues.join('\n✗ ')}`,
    );
    if (!data.valid) process.exitCode = 2;
  });
asset
  .command('publish')
  .argument('<asset-directory>')
  .option('--library <directory>', 'shared asset library root', 'library')
  .description('publish a validated immutable asset version into the shared library')
  .action(async function (directory, options: { library: string }) {
    const data = await publishAsset(directory, options.library);
    output(this, 'asset.publish', data, (d) => `✓ ${d.asset.id}@${d.asset.version} → ${d.target}`);
  });
asset
  .command('deprecate')
  .argument('<id>')
  .argument('<version>')
  .requiredOption('--by <successor-version>', 'verified successor version with the same stable ID')
  .requiredOption(
    '--reason <text>',
    'auditable reason ordinary resolution must stop selecting this version',
  )
  .option('--library <directory>', 'shared asset library root', 'library')
  .description('deprecate one immutable version in favour of a verified successor')
  .action(async function (
    id: string,
    version: string,
    options: { by: string; reason: string; library: string },
  ) {
    const data = await deprecateAsset(
      options.library,
      { id, version },
      { id, version: options.by },
      options.reason,
    );
    output(
      this,
      'asset.deprecate',
      data,
      (result) =>
        `✓ deprecated ${result.asset.id}@${result.asset.version} → ${result.deprecatedBy.version}`,
    );
  });
asset
  .command('index')
  .option('--library <directory>', 'shared asset library root', 'library')
  .description('rebuild the inspectable shared asset index')
  .action(async function (options: { library: string }) {
    const data = await buildAssetIndex(options.library);
    output(this, 'asset.index', data, (d) => `✓ indexed ${d.assets.length} assets → ${d.path}`);
  });

const character = program
  .command('character')
  .description('renderer-independent character factory');
character
  .command('create')
  .argument('<character-definition>')
  .argument('<output-directory>')
  .description('build, rig, animate, and visually verify a reusable character asset')
  .action(async function (definition, directory) {
    const data = await createCharacterAsset(definition, directory);
    output(
      this,
      'character.create',
      data,
      (result) =>
        `✓ ${result.validation.stats.vertices} vertices, ${result.validation.stats.joints} joints, canonical views + neutral/cautious gait probes → ${result.output}`,
    );
  });
character
  .command('inspect-anatomy')
  .argument('<character-geometry>')
  .option('--output <report-json>', 'persist the complete anatomy report')
  .description(
    'measure production-human body continuity, extremity ownership, joint blending, and posed deformation',
  )
  .action(async function (geometryFile: string, options: { output?: string }) {
    const data = await inspectCharacterAnatomy(geometryFile, options.output);
    output(
      this,
      'character.inspect-anatomy',
      data,
      (result) =>
        `${result.valid ? 'PASS' : 'REJECTED'}: ${result.checks.connectedComponents} body components, ${Object.values(result.checks.jointBlendVertices).filter((count) => count >= result.policy.minimumJointBlendVertices).length}/${Object.keys(result.checks.jointBlendVertices).length} deforming joint zones`,
    );
    if (!data.valid) process.exitCode = 2;
  });

const interaction = program
  .command('interaction')
  .description('synthesize and visually verify character-to-prop interactions');
interaction
  .command('create')
  .argument('<kind>', 'open-door or read-book')
  .argument('<actor-geometry>')
  .argument('<output-directory>')
  .description('build synchronized action clips and render phase probes from two viewpoints')
  .action(async function (kind: string, actorGeometry: string, directory: string) {
    if (kind !== 'open-door' && kind !== 'read-book')
      throw new Error(`Unknown interaction '${kind}'; expected open-door or read-book`);
    const data = await createInteractionProbe(kind as InteractionKind, actorGeometry, directory);
    output(
      this,
      'interaction.create',
      data,
      (result) =>
        `✓ ${result.kind}: synchronized actor/prop clips + two-view phase probe → ${result.output}`,
    );
  });
interaction
  .command('package')
  .argument('<kind>', 'open-door or read-book')
  .argument('<interaction-output>')
  .option('--prop-version <version>', 'prop candidate semantic version', '0.1.0')
  .option('--motion-version <version>', 'motion candidate semantic version', '0.1.0')
  .description(
    'package an existing verified interaction as separate immutable prop and motion candidates',
  )
  .action(async function (
    kind: string,
    directory: string,
    options: { propVersion: string; motionVersion: string },
  ) {
    if (kind !== 'open-door' && kind !== 'read-book')
      throw new Error(`Unknown interaction '${kind}'; expected open-door or read-book`);
    const { packageInteractionCandidates } = await import('./application/interactions.js');
    const data = await packageInteractionCandidates(kind as InteractionKind, directory, {
      prop: options.propVersion,
      motion: options.motionVersion,
    });
    output(this, 'interaction.package', data, (result) => `✓ 2 candidates → ${result.output}`);
  });
interaction
  .command('create-turn')
  .argument('<actor-geometry>')
  .argument('<output-directory>')
  .description('build and visually verify bidirectional head/body orientation turns')
  .action(async function (actorGeometry: string, directory: string) {
    const data = await createTurnAsset(actorGeometry, directory);
    output(
      this,
      'interaction.create-turn',
      data,
      (result) => `✓ 6 turn clips + dual-view probes → ${result.output}`,
    );
  });

const environment = program
  .command('environment')
  .description('renderer-independent procedural environment factories');
environment
  .command('create-architectural-envelope-fixtures')
  .argument('<output-directory>')
  .option('--no-render', 'write deterministic fixture scenes and reports without rendering')
  .option('--neutral-only', 'generate only the bounded neutral diagnostic probes')
  .description('assemble historic and contemporary envelope+paving transfer fixtures')
  .action(async function (directory: string, options: { render: boolean; neutralOnly?: boolean }) {
    const data = await createArchitecturalEnvelopeTransferFixtures(directory, {
      render: options.render,
      ...(options.neutralOnly ? { intents: ['neutral-diagnostic'] } : {}),
    });
    output(
      this,
      'environment.create-architectural-envelope-fixtures',
      data,
      (result) =>
        `✓ two architectural envelope transfer fixtures generated as candidates → ${result.output}`,
    );
  });
environment
  .command('bind-paving-construction-materials')
  .argument('<paving-geometry>')
  .argument('<joint-material>')
  .argument('<substrate-material>')
  .argument('<output-geometry>')
  .description('bind role-checked granular joint and substrate materials to paving construction')
  .action(async function (
    pavingGeometry: string,
    jointMaterial: string,
    substrateMaterial: string,
    outputGeometry: string,
  ) {
    const data = await bindPavingConstructionMaterials({
      pavingGeometryPath: pavingGeometry,
      jointMaterialPath: jointMaterial,
      substrateMaterialPath: substrateMaterial,
      outputGeometryPath: outputGeometry,
    });
    output(
      this,
      'environment.bind-paving-construction-materials',
      data,
      (result) =>
        `✓ granular joint ${result.targets.joint} and substrate ${result.targets.substrate} bound → ${result.path}`,
    );
  });
environment
  .command('bind-paving-unit-material')
  .argument('<paving-geometry>')
  .argument('<unit-material>')
  .argument('<unit-application>')
  .argument('<output-geometry>')
  .description(
    'bind one homogeneous texture source to every modeled unit in an irregular paving asset',
  )
  .action(async function (
    pavingGeometry: string,
    unitMaterial: string,
    unitApplication: string,
    outputGeometry: string,
  ) {
    const application = textureMaterialApplicationSchema.parse(
      JSON.parse(await readFile(resolve(unitApplication), 'utf8')),
    );
    const data = await bindPavingUnitMaterial({
      pavingGeometryPath: pavingGeometry,
      unitMaterialPath: unitMaterial,
      unitApplication: application,
      outputGeometryPath: outputGeometry,
    });
    output(
      this,
      'environment.bind-paving-unit-material',
      data,
      (result) =>
        `✓ ${result.report.modeledUnitTargets.length} modeled paving targets bound with unit-local metre frames → ${result.path}`,
    );
  });
environment
  .command('rebind-surface-water-receiver')
  .argument('<source-scene>')
  .argument('<receiver-entity-id>')
  .argument('<paving-geometry>')
  .argument('<surface-water-field>')
  .argument('<output-scene>')
  .requiredOption('--id <scene-id>', 'stable identity for the derived transfer scene')
  .description('derive a scene with an exact geometry/transform-bound surface-water receiver')
  .action(async function (
    sourceScene: string,
    receiverEntityId: string,
    pavingGeometry: string,
    surfaceWaterField: string,
    outputScene: string,
    options: { id: string },
  ) {
    const data = await rebindCinematicSurfaceWaterReceiver({
      sourceScenePath: sourceScene,
      receiverEntityId,
      pavingGeometryPath: pavingGeometry,
      surfaceWaterFieldPath: surfaceWaterField,
      outputScenePath: outputScene,
      sceneId: options.id,
    });
    output(
      this,
      'environment.rebind-surface-water-receiver',
      data,
      (result) =>
        `✓ exact surface-water receiver ${result.receiverEntityId} rebound → ${result.path}`,
    );
  });
environment
  .command('create-surface-water-field')
  .argument('<paving-geometry>')
  .argument('<atmospheric-vfx>')
  .argument('<assembly-profile>')
  .argument('<output-field>')
  .description(
    'derive a deterministic mass-conserving surface-water field from paving, rain, material and shelter evidence',
  )
  .action(async function (
    pavingGeometry: string,
    atmosphericVfx: string,
    assemblyProfile: string,
    outputField: string,
  ) {
    const profilePath = resolve(assemblyProfile);
    const profile = await loadSurfaceWaterAssemblyProfile(profilePath);
    const data = await createPavingSurfaceWaterField({
      pavingGeometryPath: pavingGeometry,
      atmosphericVfxPath: atmosphericVfx,
      profile,
      profileDirectory: dirname(profilePath),
      outputPath: outputField,
    });
    output(
      this,
      'environment.create-surface-water-field',
      data,
      (result) =>
        `✓ ${result.field.grid.activeCellCount} receiver cells solved with mass-balance error ${result.field.massBalance.errorCubicMeters} → ${result.path}`,
    );
  });
environment
  .command('create-bookshop')
  .argument('<output-directory>')
  .description('build and visually verify a continuous old-city street and bookshop interior')
  .action(async function (directory: string) {
    const data = await createBookshopEnvironment(directory);
    output(
      this,
      'environment.create-bookshop',
      data,
      (result) =>
        `✓ ${result.validation.stats.vertices} vertices, named exterior/interior paths + canonical probe → ${result.output}`,
    );
  });
environment
  .command('create-street-storage-family')
  .argument('<output-directory>')
  .description(
    'build reusable barrel/crate assets plus deterministic navigation-safe cross-environment dressing evidence',
  )
  .action(async function (directory: string) {
    const data = await createStreetStorageDressingFamily(directory);
    output(
      this,
      'environment.create-street-storage-family',
      data,
      (result) =>
        `✓ portable street-storage family and two transfer probes awaiting visual review → ${result.output}`,
    );
  });
environment
  .command('create-potted-vegetation-family')
  .argument('<output-directory>')
  .description('build and cross-host verify a surface-bound potted vegetation family')
  .action(async function (directory: string) {
    const data = await createPottedVegetationDressingFamily(directory);
    output(
      this,
      'environment.create-potted-vegetation-family',
      data,
      (result) =>
        `✓ surface-bound potted vegetation family awaiting visual review → ${result.output}`,
    );
  });
environment
  .command('accept-potted-vegetation-family')
  .argument('<output-directory>')
  .description('fail-closed acceptance for the surface-bound vegetation family and member props')
  .action(async function (directory: string) {
    const data = await acceptPottedVegetationDressingFamily(directory);
    output(
      this,
      'environment.accept-potted-vegetation-family',
      data,
      (result) => `✓ accepted surface-bound vegetation family and member props → ${result.output}`,
    );
  });
environment
  .command('accept-street-storage-family')
  .argument('<output-directory>')
  .description('fail-closed acceptance for the street-storage family and its reusable member props')
  .action(async function (directory: string) {
    const data = await acceptStreetStorageDressingFamily(directory);
    output(
      this,
      'environment.accept-street-storage-family',
      data,
      (result) => `✓ accepted street-storage family and member props → ${result.output}`,
    );
  });
environment
  .command('create-market-world-family')
  .argument('<output-directory>')
  .description('build a reusable structural market stall plus physical merchandise inventory')
  .action(async function (directory: string) {
    const data = await createMarketWorldDressingFamily(directory);
    output(
      this,
      'environment.create-market-world-family',
      data,
      (result) => `✓ portable physical market family awaiting visual review → ${result.output}`,
    );
  });
environment
  .command('accept-market-world-family')
  .argument('<output-directory>')
  .description(
    'fail-closed acceptance for market structure, physical merchandise and transfer evidence',
  )
  .action(async function (directory: string) {
    const data = await acceptMarketWorldDressingFamily(directory);
    output(
      this,
      'environment.accept-market-world-family',
      data,
      (result) => `✓ accepted market-world family and member props → ${result.output}`,
    );
  });
environment
  .command('create-workshop-world-family')
  .argument('<output-directory>')
  .description(
    'build portable workshop workstations and verify lighting/material transfer in unrelated interiors',
  )
  .action(async function (directory: string) {
    const data = await createWorkshopWorldDressingFamily(directory);
    output(
      this,
      'environment.create-workshop-world-family',
      data,
      (result) => `✓ portable workshop-world family awaiting visual review → ${result.output}`,
    );
  });
environment
  .command('create-interior-furnishings')
  .argument('<output-directory>')
  .description('create cross-era interior furnishing candidates and canonical Blender probes')
  .action(async function (directory) {
    const data = await createInteriorFurnishingCandidates(directory);
    output(
      this,
      'environment.create-interior-furnishings',
      data,
      (result) => `✓ interior furnishing candidates awaiting transfer review → ${result.output}`,
    );
  });
environment
  .command('accept-interior-furnishings')
  .argument('<output-directory>')
  .description('accept and promote a reviewed cross-era interior furnishing family')
  .action(async function (directory) {
    const data = await acceptInteriorFurnishingFamily(directory);
    output(
      this,
      'environment.accept-interior-furnishings',
      data,
      (result) => `✓ accepted interior furnishing family and member props → ${result.output}`,
    );
  });
environment
  .command('accept-workshop-world-family')
  .argument('<output-directory>')
  .description(
    'fail-closed acceptance for physical workshop inventory, transfer evidence and inherited lighting',
  )
  .action(async function (directory: string) {
    const data = await acceptWorkshopWorldDressingFamily(directory);
    output(
      this,
      'environment.accept-workshop-world-family',
      data,
      (result) => `✓ accepted workshop-world family and member props → ${result.output}`,
    );
  });
environment
  .command('create-inset-window-module')
  .argument('<output-directory>')
  .description('build a portable physical-glazing window against two real host-wall apertures')
  .action(async function (directory: string) {
    const data = await createInsetArchitecturalWindowAsset(directory);
    output(
      this,
      'environment.create-inset-window-module',
      data,
      (result) =>
        `✓ portable inset-window candidate awaiting cross-host visual review → ${result.output}`,
    );
  });
environment
  .command('accept-inset-window-module')
  .argument('<output-directory>')
  .description('fail-closed acceptance for a portable window and two real host-wall apertures')
  .action(async function (directory: string) {
    const data = await acceptInsetArchitecturalWindow(directory);
    output(
      this,
      'environment.accept-inset-window-module',
      data,
      (result) => `✓ accepted portable inset-window module → ${result.metadataPath}`,
    );
  });
environment
  .command('create-rainwater-system')
  .argument('<output-directory>')
  .description(
    'build a portable open-gutter/downpipe system and render two unrelated host transfers',
  )
  .action(async function (directory: string) {
    const data = await createArchitecturalRainwaterAsset(directory);
    output(
      this,
      'environment.create-rainwater-system',
      data,
      (result) =>
        `✓ portable rainwater-system candidate awaiting cross-host visual review → ${result.output}`,
    );
  });
environment
  .command('accept-rainwater-system')
  .argument('<output-directory>')
  .description(
    'fail-closed acceptance for the portable open-gutter/downpipe system and both host transfers',
  )
  .action(async function (directory: string) {
    const data = await acceptArchitecturalRainwaterAsset(directory);
    output(
      this,
      'environment.accept-rainwater-system',
      data,
      (result) => `✓ accepted portable architectural rainwater system → ${result.metadataPath}`,
    );
  });
environment
  .command('create-projecting-sign')
  .argument('<output-directory>')
  .description('build a portable two-sided hanging sign and render two unrelated facade transfers')
  .action(async function (directory: string) {
    const data = await createProjectingHangingSignAsset(directory);
    output(
      this,
      'environment.create-projecting-sign',
      data,
      (result) =>
        `✓ portable projecting-sign candidate awaiting cross-host visual review → ${result.output}`,
    );
  });
environment
  .command('accept-projecting-sign')
  .argument('<output-directory>')
  .description('fail-closed acceptance for the two-sided projecting sign and both facade transfers')
  .action(async function (directory: string) {
    const data = await acceptProjectingHangingSign(directory);
    output(
      this,
      'environment.accept-projecting-sign',
      data,
      (result) => `✓ accepted portable two-sided projecting sign → ${result.metadataPath}`,
    );
  });
environment
  .command('create-projecting-canopy')
  .argument('<output-directory>')
  .description('build a layered sloped supported canopy and render two unrelated facade transfers')
  .action(async function (directory: string) {
    const data = await createProjectingSupportedCanopyAsset(directory);
    output(
      this,
      'environment.create-projecting-canopy',
      data,
      (result) =>
        `✓ portable projecting-canopy candidate awaiting cross-host visual review → ${result.output}`,
    );
  });
environment
  .command('accept-projecting-canopy')
  .argument('<output-directory>')
  .description('fail-closed acceptance for the layered supported canopy and both facade transfers')
  .action(async function (directory: string) {
    const data = await acceptProjectingSupportedCanopy(directory);
    output(
      this,
      'environment.accept-projecting-canopy',
      data,
      (result) => `✓ accepted portable layered projecting canopy → ${result.metadataPath}`,
    );
  });

const cinematic = program
  .command('cinematic')
  .description('renderer-independent executable 3D scene operations');
cinematic
  .command('render')
  .argument('<scene-json>')
  .option('--output <directory>', 'render and verification output', 'verification/cinematic-scene')
  .option('--reuse-existing-pixels', 'refresh complete-render evidence without rerendering pixels')
  .description('verify and render one cinematic scene through Blender headless')
  .action(async function (
    sceneFile: string,
    options: { output: string; reuseExistingPixels?: boolean },
  ) {
    const data = await renderCinematicScene(sceneFile, options.output, {
      ...(options.reuseExistingPixels ? { reuseExistingPixels: true } : {}),
    });
    output(
      this,
      'cinematic.render',
      data,
      (result) => `✓ ${result.scene}: ${result.frames.length} semantic frames → ${result.video}`,
    );
  });
cinematic
  .command('probe')
  .argument('<scene-json>')
  .option(
    '--output <directory>',
    'authoritative-profile landmark output',
    'verification/cinematic-probe',
  )
  .option('--reuse-existing-pixels', 'refresh probe evidence without rerendering landmark pixels')
  .description(
    'render semantic landmarks at full declared quality for iteration; never publication',
  )
  .action(async function (
    sceneFile: string,
    options: { output: string; reuseExistingPixels?: boolean },
  ) {
    const data = await renderCinematicProbe(sceneFile, options.output, {
      ...(options.reuseExistingPixels ? { reuseExistingPixels: true } : {}),
    });
    output(
      this,
      'cinematic.probe',
      data,
      (result) =>
        `✓ ${result.scene}: ${result.frames.length} authoritative-profile landmark probes (iteration-only) → ${result.contactSheet}`,
    );
  });
cinematic
  .command('verify')
  .argument('<scene-json>')
  .description('run facing-direction and spatial-transition gates without rendering')
  .action(async function (sceneFile: string) {
    const scene = await loadCinematicScene(sceneFile);
    const data = await verifyCinematicScene(scene, sceneFile);
    output(
      this,
      'cinematic.verify',
      data,
      (result) =>
        `${result.status.toUpperCase()}: ${result.checks.filter((check) => check.status === 'pass').length}/${result.checks.length} cinematic quality gates passed`,
    );
    if (data.status === 'fail') process.exitCode = 2;
  });
cinematic
  .command('compare-render-profile')
  .argument('<scene-json>')
  .argument('<output-directory>')
  .description(
    'compare the current scene profile with a twice-rendered deterministic production-clean profile',
  )
  .action(async function (sceneFile: string, outputDirectory: string) {
    const data = await compareDeterministicRenderProfile(sceneFile, outputDirectory);
    output(
      this,
      'cinematic.compare-render-profile',
      data,
      (result) =>
        `✓ production-clean is deterministic and awaits visual review → ${result.comparison}`,
    );
  });
const surfaceMaterial = program
  .command('material')
  .description('renderer-independent reusable surface-material factories');
surfaceMaterial
  .command('derive-texture')
  .argument('<base-material>')
  .argument('<source-manifest>')
  .argument('<output-material>')
  .requiredOption('--id <asset-id>', 'stable derived surface-material identity')
  .requiredOption(
    '--suitability <json-file>',
    'composition, intended construction domains, and rationale JSON',
  )
  .description('derive a provenance-bound texture material without rendering or rescaling it')
  .action(async function (
    baseMaterial: string,
    sourceManifest: string,
    outputMaterial: string,
    options: { id: string; suitability: string },
  ) {
    const suitability = textureMaterialSuitabilitySchema.parse(
      JSON.parse(await readFile(resolve(options.suitability), 'utf8')),
    );
    const data = await deriveTextureSurfaceMaterial({
      base: await loadSurfaceMaterial(baseMaterial),
      assetId: options.id,
      sourceManifestPath: sourceManifest,
      outputMaterialPath: outputMaterial,
      suitability,
    });
    output(
      this,
      'material.derive-texture',
      data,
      (result) =>
        `✓ ${result.material.id} ${result.material.textureMaps!.suitability.composition} → ${result.path}`,
    );
  });
surfaceMaterial
  .command('assess-texture-suitability')
  .argument('<material>')
  .requiredOption(
    '--application <json-file>',
    'construction domain and deterministic placement/adaptation JSON',
  )
  .description('evaluate a texture material against one host without rendering or mutating it')
  .action(async function (material: string, options: { application: string }) {
    const application = textureMaterialApplicationSchema.parse(
      JSON.parse(await readFile(resolve(options.application), 'utf8')),
    );
    const data = assessTextureMaterialSuitability(await loadSurfaceMaterial(material), application);
    output(this, 'material.assess-texture-suitability', data, (result) =>
      result.accepted
        ? `✓ ${result.materialId} is suitable for ${result.application.constructionDomain}`
        : `✗ ${result.materialId}: ${result.reasons.map((reason) => reason.message).join('; ')}`,
    );
    if (!data.accepted) process.exitCode = 2;
  });
surfaceMaterial
  .command('create-paving-granular')
  .argument('<kind>')
  .argument('<output-directory>')
  .description('build a metre-scaled granular paving joint or compacted substrate material')
  .action(async function (kind: string, directory: string) {
    if (!['natural-grit', 'polymeric-sand', 'compacted-base'].includes(kind))
      throw new Error("kind must be 'natural-grit', 'polymeric-sand', or 'compacted-base'");
    const data = await createPavingGranularMaterialAsset(
      kind as Parameters<typeof createPavingGranularMaterialAsset>[0],
      directory,
    );
    output(
      this,
      'material.create-paving-granular',
      data,
      (result) => `✓ granular paving construction material → ${result.output}`,
    );
  });
surfaceMaterial
  .command('create-wet-cobble')
  .argument('<output-directory>')
  .description('build and visually verify a procedural rain-darkened cobble material')
  .action(async function (directory: string) {
    const data = await createWetCobbleMaterialAsset(directory);
    output(
      this,
      'material.create-wet-cobble',
      data,
      (result) =>
        `✓ wet cobble palette + relief + roughness swatch (${result.validation.stats.vertices} vertices) → ${result.output}`,
    );
  });
surfaceMaterial
  .command('create-old-city-suite')
  .argument('<output-directory>')
  .description('build reusable metre-scaled masonry, plaster, trim, and wood surface assets')
  .action(async function (directory: string) {
    const data = await createOldCitySurfaceMaterialAssets(directory);
    output(
      this,
      'material.create-old-city-suite',
      data,
      (result) => `✓ ${result.assets.length} old-city surface candidates → ${result.output}`,
    );
  });
surfaceMaterial
  .command('create-old-city-surface')
  .argument('<preset-id>')
  .argument('<output-directory>')
  .description('build and visually verify one named old-city surface candidate')
  .action(async function (presetId: string, directory: string) {
    const data = await createOldCitySurfaceMaterialAsset(
      presetId as Parameters<typeof createOldCitySurfaceMaterialAsset>[0],
      directory,
    );
    output(
      this,
      'material.create-old-city-surface',
      data,
      (result) => `✓ old-city surface candidate → ${result.output}`,
    );
  });
surfaceMaterial
  .command('create-environmental-gallery')
  .argument('<output-directory>')
  .option('--only <kind>', 'render only exterior or interior while iterating')
  .description('render weathered exterior and warm-interior architectural material transfers')
  .action(async function (directory: string, options: { only?: string }) {
    if (options.only && options.only !== 'exterior' && options.only !== 'interior')
      throw new Error("--only must be 'exterior' or 'interior'");
    const data = await createEnvironmentalSurfaceGallery(
      directory,
      options.only as 'exterior' | 'interior' | undefined,
    );
    output(
      this,
      'material.create-environmental-gallery',
      data,
      (result) =>
        `✓ environmental surface transfer gallery awaiting visual review → ${result.output}`,
    );
  });
surfaceMaterial
  .command('accept-environmental-suite')
  .argument('<suite-directory>')
  .requiredOption(
    '--exterior-gallery <directory>',
    'completed exterior architectural transfer evidence',
  )
  .requiredOption(
    '--interior-gallery <directory>',
    'completed interior architectural transfer evidence',
  )
  .description('fail-closed acceptance for the seven environmental surface assets')
  .action(async function (
    directory: string,
    options: { exteriorGallery: string; interiorGallery: string },
  ) {
    const data = await acceptEnvironmentalSurfaceSuite(
      directory,
      options.exteriorGallery,
      options.interiorGallery,
    );
    output(
      this,
      'material.accept-environmental-suite',
      data,
      (result) =>
        `✓ accepted ${result.accepted.length} environmental surface assets → ${result.suite}`,
    );
  });

const clothing = program
  .command('clothing')
  .description('renderer-independent fitted clothing asset operations');
clothing
  .command('extract-dark-dress')
  .argument('<character-geometry>')
  .argument('<output-directory>')
  .option(
    '--character-version <version>',
    'source character asset version when legacy geometry does not embed assetVersion',
  )
  .description('extract and verify the canonical-humanoid fitted dark dress as reusable inventory')
  .action(async function (
    geometryFile: string,
    directory: string,
    options: { characterVersion?: string },
  ) {
    const data = await createDarkDressAsset(geometryFile, directory, options.characterVersion);
    output(
      this,
      'clothing.extract-dark-dress',
      data,
      (result) =>
        `✓ fitted dress (${result.validation.stats.vertices} vertices) + canonical probe → ${result.output}`,
    );
  });

const hair = program
  .command('hair')
  .description('separable canonical-humanoid hair asset operations');
hair
  .command('accept')
  .argument('<asset-directory>')
  .argument('<transfer-directory>')
  .description('verify qualitative, structural, rendered, and cross-character hair evidence')
  .action(async function (directory: string, transferDirectory: string) {
    const data = await acceptHairCandidate(directory, transferDirectory);
    output(
      this,
      'hair.accept',
      data,
      (result) => `✓ accepted reusable medium-shot hair candidate → ${result.metadataPath}`,
    );
  });
hair
  .command('create-pulled-back')
  .argument('<target-geometry>')
  .argument('<output-directory>')
  .description('derive and fit a reusable pulled-back low-bun mesh-hair candidate')
  .action(async function (targetGeometry: string, directory: string) {
    const data = await createPulledBackHairAsset(targetGeometry, directory);
    output(
      this,
      'hair.create-pulled-back',
      data,
      (result) => `✓ separable canonical hair candidate awaiting visual review → ${result.output}`,
    );
  });

const fixture = program
  .command('fixture')
  .description('portable model and local practical-light fixture operations');
fixture
  .command('accept')
  .argument('<asset-directory>')
  .description('verify review and two-set evidence, then accept a portable fixture')
  .action(async function (directory: string) {
    const data = await acceptPortableFixtureCandidate(directory);
    output(
      this,
      'fixture.accept',
      data,
      (result) => `✓ accepted portable fixture candidate → ${result.metadataPath}`,
    );
  });
fixture
  .command('create-wall-lantern')
  .argument('<output-directory>')
  .description('build and transfer-verify a portable wall lantern with local light semantics')
  .action(async function (directory: string) {
    const data = await createPortableWallLanternAsset(directory);
    output(
      this,
      'fixture.create-wall-lantern',
      data,
      (result) =>
        `✓ portable practical fixture candidate awaiting visual review → ${result.output}`,
    );
  });
fixture
  .command('create-neon-blade-sign')
  .argument('<output-directory>')
  .description('build and transfer-verify a portable two-sided neon blade-sign practical')
  .action(async function (directory: string) {
    const data = await createPortableNeonBladeSignAsset(directory);
    output(
      this,
      'fixture.create-neon-blade-sign',
      data,
      (result) => `✓ portable neon practical candidate awaiting visual review → ${result.output}`,
    );
  });

vfx
  .command('accept')
  .argument('<asset-directory>')
  .description('verify review and cross-environment evidence, then accept a VFX candidate')
  .action(async function (directory: string) {
    const data = await acceptAtmosphericVfxCandidate(directory);
    output(
      this,
      'vfx.accept',
      data,
      (result) => `✓ accepted atmospheric VFX candidate → ${result.metadataPath}`,
    );
  });
vfx
  .command('create-rainy-dusk')
  .argument('<environment-geometry>')
  .argument('<output-directory>')
  .description('build and visually verify deterministic camera-depth rain and dusk fog')
  .action(async function (environmentGeometry: string, directory: string) {
    const data = await createRainyDuskVfxAsset(environmentGeometry, directory);
    output(
      this,
      'vfx.create-rainy-dusk',
      data,
      (result) => `✓ three-layer camera-depth rain + dusk fog probe → ${result.output}`,
    );
  });
vfx
  .command('create-source-bound-aerosol')
  .argument('<output-directory>')
  .option('--probe', 'render only semantic landmark frames for visual iteration')
  .description(
    'build true world-space volumetric smoke and emissive embers bound to source attachments',
  )
  .action(async function (directory: string, options: { probe?: boolean }) {
    const data = await createSourceBoundAerosolVfxAsset(directory, {
      renderMode: options.probe ? 'probe' : 'full',
    });
    output(
      this,
      'vfx.create-source-bound-aerosol',
      data,
      (result) => `✓ source-bound aerosol candidate awaiting visual review → ${result.output}`,
    );
  });
vfx
  .command('accept-source-bound-aerosol')
  .argument('<asset-directory>')
  .description(
    'fail-closed acceptance for source attachment, backend reproduction and two-host aerosol evidence',
  )
  .action(async function (directory: string) {
    const data = await acceptSourceBoundAerosolVfxAsset(directory);
    output(
      this,
      'vfx.accept-source-bound-aerosol',
      data,
      (result) => `✓ accepted source-bound aerosol VFX → ${result.output}`,
    );
  });
vfx
  .command('create-cinematic-finish')
  .argument('<output-directory>')
  .requiredOption('--warm-source <video>', 'warm-source verification video')
  .requiredOption('--warm-asset <id@version>', 'stable asset identity for the warm source')
  .requiredOption('--cool-source <video>', 'cool-source verification video')
  .requiredOption('--cool-asset <id@version>', 'stable asset identity for the cool source')
  .description(
    'build a renderer-independent deterministic tonal, bloom, vignette and grain finish profile',
  )
  .action(async function (
    directory: string,
    options: { warmSource: string; warmAsset: string; coolSource: string; coolAsset: string },
  ) {
    const data = await createCinematicFinishAsset(
      directory,
      options.warmSource,
      options.coolSource,
      options.warmAsset,
      options.coolAsset,
    );
    output(
      this,
      'vfx.create-cinematic-finish',
      data,
      (result) => `✓ cinematic finish candidate awaiting visual review → ${result.output}`,
    );
  });
vfx
  .command('accept-cinematic-finish')
  .argument('<asset-directory>')
  .description('fail-closed deterministic and qualitative acceptance for cinematic finishing')
  .action(async function (directory: string) {
    const data = await acceptCinematicFinishAsset(directory);
    output(
      this,
      'vfx.accept-cinematic-finish',
      data,
      (result) => `✓ accepted cinematic finish profile → ${result.output}`,
    );
  });
vfx
  .command('write-rainy-dusk')
  .argument('<vfx-json>')
  .description('write the current deterministic rainy-dusk VFX definition without rendering')
  .action(async function (vfxFile: string) {
    const data = await writeRainyDuskVfxDefinition(vfxFile);
    output(
      this,
      'vfx.write-rainy-dusk',
      data,
      (result) => `✓ renderer-independent rainy-dusk definition → ${result.vfxFile}`,
    );
  });
vfx
  .command('ground-response-probe')
  .argument('<vfx-json>')
  .argument('<environment-geometry>')
  .argument('<output-directory>')
  .description('render a low-angle temporal probe of unchanged world-space rain impacts')
  .action(async function (vfxFile: string, environmentGeometry: string, directory: string) {
    const data = await createAtmosphericGroundResponseProbe(
      vfxFile,
      environmentGeometry,
      directory,
    );
    output(
      this,
      'vfx.ground-response-probe',
      data,
      (result) => `✓ close-range atmospheric ground-response probe → ${result.render.contactSheet}`,
    );
  });
vfx
  .command('transfer-probe')
  .argument('<vfx-json>')
  .argument('<scene-json>')
  .argument('<output-directory>')
  .option('--splash-min <x,y,z>', 'world-space minimum splash receiver bound')
  .option('--splash-max <x,y,z>', 'world-space maximum splash receiver bound')
  .description('apply atmospheric VFX to an existing scene and render intended-camera landmarks')
  .action(async function (
    vfxFile: string,
    sceneFile: string,
    directory: string,
    options: { splashMin?: string; splashMax?: string },
  ) {
    if (Boolean(options.splashMin) !== Boolean(options.splashMax))
      throw new Error('Both --splash-min and --splash-max are required for receiver adaptation');
    const vector = (value: string) => {
      const numbers = value.split(',').map(Number);
      if (numbers.length !== 3 || numbers.some((number) => !Number.isFinite(number)))
        throw new Error(`Expected three finite comma-separated coordinates, received '${value}'`);
      return numbers as [number, number, number];
    };
    const data = await createAtmosphericVfxTransferProbe(vfxFile, sceneFile, directory, {
      ...(options.splashMin && options.splashMax
        ? {
            groundSplashBounds: {
              minimum: vector(options.splashMin),
              maximum: vector(options.splashMax),
            },
          }
        : {}),
    });
    output(
      this,
      'vfx.transfer-probe',
      data,
      (result) =>
        `✓ intended-camera VFX transfer probe (iteration-only) → ${result.probe.contactSheet}`,
    );
  });

const geometry = program
  .command('geometry')
  .description('renderer-independent geometry operations');
geometry
  .command('production-human')
  .argument('<output-directory>')
  .option('--height <meters>', 'total height in metres', Number.parseFloat)
  .option('--shoulder-width <meters>', 'shoulder width', Number.parseFloat)
  .option('--hip-width <meters>', 'hip width', Number.parseFloat)
  .option('--torso-length <meters>', 'torso length', Number.parseFloat)
  .option('--arm-length <meters>', 'arm length', Number.parseFloat)
  .option('--leg-length <meters>', 'leg length', Number.parseFloat)
  .option('--id <asset-id>', 'stable character asset id', 'character.production-human-foundation')
  .option('--asset-version <version>', 'immutable semantic asset version', '0.2.0')
  .option('--no-probe', 'skip Blender render probes')
  .description('generate and inspect the stable-topology production-human foundation')
  .action(async function (
    directory: string,
    options: {
      height?: number;
      shoulderWidth?: number;
      hipWidth?: number;
      torsoLength?: number;
      armLength?: number;
      legLength?: number;
      id: string;
      assetVersion: string;
      probe: boolean;
    },
  ) {
    const data = await createProductionHumanFoundation(
      directory,
      {
        ...(options.height ? { height: options.height } : {}),
        ...(options.shoulderWidth ? { shoulderWidth: options.shoulderWidth } : {}),
        ...(options.hipWidth ? { hipWidth: options.hipWidth } : {}),
        ...(options.torsoLength ? { torsoLength: options.torsoLength } : {}),
        ...(options.armLength ? { armLength: options.armLength } : {}),
        ...(options.legLength ? { legLength: options.legLength } : {}),
      },
      { probe: options.probe, id: options.id, version: options.assetVersion },
    );
    output(
      this,
      'geometry.production-human',
      data,
      (result) =>
        `✓ ${result.validation.stats.vertices} vertices, stable CC0 topology, ${Object.keys(result.validation.walk.deformation.checks.regions).length} walking deformation regions → ${result.output}`,
    );
  });
geometry
  .command('mannequin')
  .argument('<output-directory>')
  .option('--height <meters>', 'total height in metres', Number.parseFloat)
  .option('--shoulder-width <meters>', 'shoulder width', Number.parseFloat)
  .option('--hip-width <meters>', 'hip width', Number.parseFloat)
  .option('--torso-length <meters>', 'torso length', Number.parseFloat)
  .option('--arm-length <meters>', 'arm length', Number.parseFloat)
  .option('--leg-length <meters>', 'leg length', Number.parseFloat)
  .option('--id <asset-id>', 'stable character asset id', 'character.humanoid-mannequin')
  .option('--asset-version <version>', 'immutable semantic asset version', '0.1.0')
  .option('--no-probe', 'skip Blender render probes')
  .description('generate, validate, rig, and render a parametric humanoid mannequin')
  .action(async function (
    directory,
    options: {
      height?: number;
      shoulderWidth?: number;
      hipWidth?: number;
      torsoLength?: number;
      armLength?: number;
      legLength?: number;
      id: string;
      assetVersion: string;
      probe?: boolean;
    },
  ) {
    const parameters = {
      ...(options.height !== undefined ? { height: options.height } : {}),
      ...(options.shoulderWidth !== undefined ? { shoulderWidth: options.shoulderWidth } : {}),
      ...(options.hipWidth !== undefined ? { hipWidth: options.hipWidth } : {}),
      ...(options.torsoLength !== undefined ? { torsoLength: options.torsoLength } : {}),
      ...(options.armLength !== undefined ? { armLength: options.armLength } : {}),
      ...(options.legLength !== undefined ? { legLength: options.legLength } : {}),
    };
    const data = await createMannequin(directory, parameters, {
      probe: options.probe !== false,
      id: options.id,
      version: options.assetVersion,
    });
    output(
      this,
      'geometry.mannequin',
      data,
      (d) =>
        `✓ ${d.validation.stats.vertices} vertices, ${d.validation.stats.triangles} triangles, ${d.validation.stats.joints} joints → ${d.output}`,
    );
  });
geometry
  .command('validate')
  .argument('<geometry-json>')
  .description('run topology, bounds, attribute, skeleton, and skin-weight gates')
  .action(async function (path) {
    const data = await validateGeometryFile(path);
    output(this, 'geometry.validate', data, (d) =>
      d.valid
        ? `✓ ${d.stats.vertices} vertices, ${d.stats.triangles} triangles, ${d.stats.joints} joints`
        : `✗ ${d.issues.length} geometry issues`,
    );
    if (!data.valid) process.exitCode = 2;
  });
geometry
  .command('probe')
  .argument('<geometry-json>')
  .option('--output <directory>', 'verification output directory', 'verification/geometry-probe')
  .description('render canonical views and a turntable through Blender headless')
  .action(async function (path, options: { output: string }) {
    const data = await renderGeometryProbe(path, options.output);
    output(this, 'geometry.probe', data, (d) => `✓ 4 views + turntable → ${d.output}`);
  });

const characterMotion = program
  .command('motion')
  .description('renderer-independent character motion operations');
characterMotion
  .command('create-walk')
  .argument('<output-json>')
  .option('--style <style>', 'neutral, cautious, or confident', 'neutral')
  .description('create a deterministic phase-based natural walk clip')
  .action(async function (path, options: { style: string }) {
    if (!(options.style in gaitStyles))
      throw new Error(
        `Unknown gait style '${options.style}'; expected neutral, cautious, or confident`,
      );
    const data = await createWalkMotion(path, options.style as GaitStyle['id']);
    output(
      this,
      'motion.create-walk',
      data,
      (d) =>
        `✓ ${d.clip.id}: ${d.validation.stats.tracks} tracks, ${d.clip.durationSeconds}s → ${d.output}`,
    );
  });
characterMotion
  .command('validate')
  .argument('<motion-json>')
  .option('--geometry <geometry-json>', 'validate all tracks against a geometry skeleton')
  .description('validate motion timing, tracks, and skeleton compatibility')
  .action(async function (path, options: { geometry?: string }) {
    const data = await validateMotionFile(path, options.geometry);
    output(this, 'motion.validate', data, (d) =>
      d.valid
        ? `✓ ${d.stats.tracks} tracks, ${d.stats.durationSeconds}s`
        : `✗ ${d.issues.length} motion issues`,
    );
    if (!data.valid) process.exitCode = 2;
  });
characterMotion
  .command('probe')
  .argument('<geometry-json>')
  .argument('<motion-json>')
  .option('--output <directory>', 'motion verification output', 'verification/motion-probe')
  .description('render and sample a canonical motion through Blender headless')
  .action(async function (geometryFile, motionFile, options: { output: string }) {
    const data = await createWalkProbe(geometryFile, motionFile, options.output);
    output(this, 'motion.probe', data, (d) => `✓ walk preview + 8 gait phases → ${d.output}`);
  });
shot
  .command('regenerate')
  .argument('<campaign>')
  .argument('<shot-id>')
  .option('--keyframe <keyframe-id>', 'regenerate only one weak keyframe')
  .option('--provider <provider-id>', 'override campaign.providers.image')
  .description('regenerate one scene-keyframes shot or a selected keyframe')
  .action(async function (p, shotId, options: { keyframe?: string; provider?: string }) {
    const provider = await imageProvider(p, options.provider);
    const data = await regenerateSceneKeyframe(p, provider, shotId, options.keyframe);
    output(
      this,
      'shot.regenerate',
      data,
      (d) => `✓ ${shotId}: ${d.generated.length} keyframe assets regenerated by ${d.provider}`,
    );
  });

program.parseAsync().catch((error) => {
  const isValidation = error instanceof ValidationError;
  const message = error instanceof Error ? error.message : String(error);
  if (program.opts().json) {
    const body: Envelope = {
      version: 1,
      ok: false,
      command: 'unknown',
      error: {
        code: isValidation ? 'VALIDATION_ERROR' : 'UNEXPECTED_ERROR',
        message,
        ...(isValidation ? { details: { file: error.file, issues: error.issues } } : {}),
      },
    };
    console.error(JSON.stringify(body, null, 2));
  } else console.error(program.opts().debug && error instanceof Error ? error.stack : message);
  process.exitCode = isValidation ? 2 : 1;
});
