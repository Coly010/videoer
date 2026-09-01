import { spawn } from 'node:child_process';
import { blenderProbeDetail, resolveBlenderExecutable } from './blender.js';

export interface DependencyStatus {
  name: string;
  available: boolean;
  detail: string;
}

export const REQUIRED_FFMPEG_FILTERS = [
  'drawtext',
  'xfade',
  'zoompan',
  'xstack',
  'subtitles',
  'highpass',
  'lowpass',
  'acompressor',
  'extrastereo',
  'loudnorm',
  'afade',
  'adelay',
  'amix',
  'apad',
  'atrim',
  'aresample',
  'aformat',
  'eq',
  'colorchannelmixer',
  'lutrgb',
  'gblur',
  'blend',
  'vignette',
  'noise',
] as const;

async function capture(name: string, args: string[]) {
  return new Promise<{ code: number; output: string }>((resolve) => {
    const child = spawn(name, args);
    let output = '';
    child.stdout.on('data', (data) => {
      output += String(data);
    });
    child.stderr.on('data', (data) => {
      output += String(data);
    });
    child.on('error', () => resolve({ code: 127, output: `${name} was not found on PATH` }));
    child.on('close', (code, signal) =>
      resolve({ code: code ?? (signal === 'SIGSEGV' ? 139 : 1), output }),
    );
  });
}

function has(output: string, feature: string) {
  return new RegExp(`\\b${feature}\\b`).test(output);
}

export async function checkMediaDependencies() {
  const blender = await resolveBlenderExecutable();
  const [
    ffmpegVersion,
    ffprobeVersion,
    filters,
    encoders,
    decoders,
    blenderStartup,
    espeakVersion,
    compilerVersion,
  ] = await Promise.all([
    capture('ffmpeg', ['-version']),
    capture('ffprobe', ['-version']),
    capture('ffmpeg', ['-hide_banner', '-filters']),
    capture('ffmpeg', ['-hide_banner', '-encoders']),
    capture('ffmpeg', ['-hide_banner', '-decoders']),
    capture(blender, [
      '--background',
      '--factory-startup',
      '--python-expr',
      "import bpy, importlib.util; print('VIDEOER_BLENDER_READY', bpy.app.version_string); print('VIDEOER_OPENVDB_READY' if importlib.util.find_spec('openvdb') and importlib.util.find_spec('numpy') else 'VIDEOER_OPENVDB_MISSING')",
    ]),
    capture('espeak-ng', ['--version']),
    capture('cc', ['--version']),
  ]);
  const blenderStatus = blenderProbeDetail(blenderStartup);
  const checks: DependencyStatus[] = [
    {
      name: 'ffmpeg',
      available: ffmpegVersion.code === 0,
      detail:
        ffmpegVersion.code === 0
          ? ffmpegVersion.output.split('\n')[0]!
          : ffmpegVersion.output.trim(),
    },
    {
      name: 'ffprobe',
      available: ffprobeVersion.code === 0,
      detail:
        ffprobeVersion.code === 0
          ? ffprobeVersion.output.split('\n')[0]!
          : ffprobeVersion.output.trim(),
    },
    { name: 'blender headless', ...blenderStatus },
    {
      name: 'blender Python OpenVDB + NumPy',
      available:
        blenderStartup.code === 0 && blenderStartup.output.includes('VIDEOER_OPENVDB_READY'),
      detail:
        blenderStartup.code === 0 && blenderStartup.output.includes('VIDEOER_OPENVDB_READY')
          ? 'available for deterministic sparse volumetric simulation'
          : blenderStatus.available
            ? 'missing from Blender bundled Python; install a supported Blender distribution with OpenVDB and NumPy'
            : blenderStatus.detail,
    },
    {
      name: 'espeak-ng speech synthesis',
      available: espeakVersion.code === 0,
      detail:
        espeakVersion.code === 0
          ? espeakVersion.output.split('\n')[0]!
          : `${espeakVersion.output.trim()}; install the open-source eSpeak NG runtime documented in README.md`,
    },
    {
      name: 'C compiler for speech timing helper',
      available: compilerVersion.code === 0,
      detail:
        compilerVersion.code === 0
          ? compilerVersion.output.split('\n')[0]!
          : `${compilerVersion.output.trim()}; install the platform C toolchain documented in README.md`,
    },
  ];
  for (const filter of REQUIRED_FFMPEG_FILTERS)
    checks.push({
      name: `ffmpeg filter:${filter}`,
      available: filters.code === 0 && has(filters.output, filter),
      detail: has(filters.output, filter)
        ? 'available'
        : `required filter '${filter}' is missing; install the full FFmpeg build documented in README.md`,
    });
  for (const encoder of ['libx264', 'aac'])
    checks.push({
      name: `ffmpeg encoder:${encoder}`,
      available: encoders.code === 0 && has(encoders.output, encoder),
      detail: has(encoders.output, encoder)
        ? 'available'
        : `required encoder '${encoder}' is missing`,
    });
  for (const decoder of ['png', 'mjpeg'])
    checks.push({
      name: `ffmpeg decoder:${decoder}`,
      available: decoders.code === 0 && has(decoders.output, decoder),
      detail: has(decoders.output, decoder)
        ? 'available'
        : `required decoder '${decoder}' is missing`,
    });
  return checks;
}
