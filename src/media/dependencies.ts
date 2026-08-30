import { spawn } from 'node:child_process';

export interface DependencyStatus {
  name: string;
  available: boolean;
  detail: string;
}

async function capture(name: string, args: string[]) {
  return new Promise<{ code: number; output: string }>((resolve) => {
    const child = spawn(name, args);
    let output = '';
    child.stdout.on('data', (data) => { output += String(data); });
    child.stderr.on('data', (data) => { output += String(data); });
    child.on('error', () => resolve({ code: 127, output: `${name} was not found on PATH` }));
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

function has(output: string, feature: string) {
  return new RegExp(`\\b${feature}\\b`).test(output);
}

export async function checkMediaDependencies() {
  const [ffmpegVersion, ffprobeVersion, filters, encoders, decoders] = await Promise.all([
    capture('ffmpeg', ['-version']),
    capture('ffprobe', ['-version']),
    capture('ffmpeg', ['-hide_banner', '-filters']),
    capture('ffmpeg', ['-hide_banner', '-encoders']),
    capture('ffmpeg', ['-hide_banner', '-decoders']),
  ]);
  const checks: DependencyStatus[] = [
    { name: 'ffmpeg', available: ffmpegVersion.code === 0, detail: ffmpegVersion.code === 0 ? ffmpegVersion.output.split('\n')[0]! : ffmpegVersion.output.trim() },
    { name: 'ffprobe', available: ffprobeVersion.code === 0, detail: ffprobeVersion.code === 0 ? ffprobeVersion.output.split('\n')[0]! : ffprobeVersion.output.trim() },
  ];
  for (const filter of ['drawtext', 'xfade', 'zoompan', 'xstack', 'subtitles']) checks.push({ name: `ffmpeg filter:${filter}`, available: filters.code === 0 && has(filters.output, filter), detail: has(filters.output, filter) ? 'available' : `required filter '${filter}' is missing; install the full FFmpeg build documented in README.md` });
  for (const encoder of ['libx264', 'aac']) checks.push({ name: `ffmpeg encoder:${encoder}`, available: encoders.code === 0 && has(encoders.output, encoder), detail: has(encoders.output, encoder) ? 'available' : `required encoder '${encoder}' is missing` });
  for (const decoder of ['png', 'mjpeg']) checks.push({ name: `ffmpeg decoder:${decoder}`, available: decoders.code === 0 && has(decoders.output, decoder), detail: has(decoders.output, decoder) ? 'available' : `required decoder '${decoder}' is missing` });
  return checks;
}
