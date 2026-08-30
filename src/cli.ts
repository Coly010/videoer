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
