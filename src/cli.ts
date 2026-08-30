#!/usr/bin/env node
import { Command } from 'commander';
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

program
  .command('vfx')
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
program
  .command('particles')
  .command('list')
  .description('list registered particle presets')
  .action(function () {
    const data = { presets: particlePresetNames };
    output(this, 'particles.list', data, (d) => d.presets.join('\n'));
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
