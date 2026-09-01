import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { createProductionSoundEffectRecipes } from '../audio/sound-effect-presets.js';
import { renderSoundEffectRecipe, verifySoundEffectRecipe } from '../audio/sound-effect.js';

const exec = promisify(execFile);

export async function renderAudioEvidence(wav: string, waveform: string, spectrogram: string) {
  await Promise.all([
    exec('ffmpeg', [
      '-v',
      'error',
      '-i',
      wav,
      '-filter_complex',
      'showwavespic=s=1200x280:split_channels=1:colors=0x75a7ff|0xffb36b',
      '-frames:v',
      '1',
      '-y',
      waveform,
    ]),
    exec('ffmpeg', [
      '-v',
      'error',
      '-i',
      wav,
      '-lavfi',
      'showspectrumpic=s=1200x600:legend=1:color=fiery:scale=log',
      '-frames:v',
      '1',
      '-y',
      spectrogram,
    ]),
  ]);
}

export async function createProductionSoundEffectLibrary(outputRoot: string) {
  const root = resolve(outputRoot);
  const assets = [];
  for (const recipe of createProductionSoundEffectRecipes()) {
    const slug = recipe.id.replace(/^audio\.sfx\./u, '');
    const output = join(root, slug, '0.1.0');
    const verification = join(output, 'verification');
    await mkdir(verification, { recursive: true });
    const recipeFile = join(output, 'sound-effect-recipe.json');
    const master = join(output, `${slug}.wav`);
    const waveform = join(verification, 'waveform.png');
    const spectrogram = join(verification, 'spectrogram.png');
    const reportFile = join(verification, 'sound-effect-verification.json');
    await writeFile(recipeFile, `${JSON.stringify(recipe, null, 2)}\n`, 'utf8');
    const render = await renderSoundEffectRecipe(recipe, master);
    const report = await verifySoundEffectRecipe(recipe, master);
    if (!report.valid) throw new Error(`Sound-effect verification failed for '${recipe.id}'`);
    await renderAudioEvidence(master, waveform, spectrogram);
    await writeFile(
      reportFile,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          id: recipe.id,
          status: 'pass',
          render,
          verification: report,
          qualitativeStatus: 'generated-not-auditorily-accepted',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const category = String(recipe.metadata.category ?? 'sound-effect');
    const metadata = assetMetadataSchema.parse({
      schemaVersion: 1,
      id: recipe.id,
      version: '0.1.0',
      type: 'audio',
      title: slug
        .split('-')
        .map((word) => word[0]!.toUpperCase() + word.slice(1))
        .join(' '),
      description: `Project-owned deterministic layered ${category} sound effect with isolated timing and reusable synchronization metadata.`,
      status: 'validated',
      tags: [
        'sound-effect',
        category,
        'deterministic',
        'provider-free',
        ...Object.values(recipe.metadata).filter(
          (value): value is string => typeof value === 'string',
        ),
      ],
      capabilities: [
        'isolated-sound-effect',
        'sample-exact',
        'stereo-48khz',
        'deterministic-rerender',
      ],
      source: {
        kind: 'procedural',
        generator: 'videoer.procedural-sfx.v1',
        references: [],
        licence: {
          spdx: 'LicenseRef-Videoer-Project',
          name: 'Videoer project-owned procedural audio',
          commercialUse: 'allowed',
          attributionRequired: false,
        },
        clearance: 'approved',
      },
      artifacts: [
        {
          role: 'sound-effect-recipe',
          path: basename(recipeFile),
          mediaType: 'application/vnd.videoer.sound-effect-recipe+json',
        },
        { role: 'master', path: basename(master), mediaType: 'audio/wav' },
        { role: 'waveform', path: 'verification/waveform.png', mediaType: 'image/png' },
        { role: 'spectrogram', path: 'verification/spectrogram.png', mediaType: 'image/png' },
        {
          role: 'verification-report',
          path: 'verification/sound-effect-verification.json',
          mediaType: 'application/json',
        },
      ],
      compatibility: { renderers: ['ffmpeg-full', 'remotion'], requires: [] },
      verification: {
        checks: [
          'audio.recipe-schema',
          'audio.exact-duration',
          'audio.stereo-48000hz-pcm24',
          'audio.deterministic-rerender-hash',
          'audio.non-silent-rms',
          'audio.declared-peak',
          'visual.waveform-and-spectrogram-generated',
          'auditory.generated-not-accepted',
        ],
        artifacts: [
          'verification/waveform.png',
          'verification/spectrogram.png',
          'verification/sound-effect-verification.json',
        ],
        verifiedAt: new Date().toISOString(),
      },
    });
    const assetFile = await writeHashedAssetMetadata(join(output, 'asset.yaml'), metadata);
    assets.push({ id: recipe.id, output, assetFile, master, report: reportFile });
  }
  return { root, assets };
}
