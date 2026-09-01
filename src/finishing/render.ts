import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { inspectVideo } from '../media/inspection.js';
import { cinematicFinishProfileSchema, type CinematicFinishProfile } from './model.js';

const exec = promisify(execFile);

function fixed(value: number) {
  return Number(value.toFixed(6));
}

export function cinematicFinishFilter(profileInput: CinematicFinishProfile) {
  const profile = cinematicFinishProfileSchema.parse(profileInput);
  const redGain = 1 + profile.tonal.temperature + profile.tonal.tint * 0.5;
  const greenGain = 1 - profile.tonal.tint;
  const blueGain = 1 - profile.tonal.temperature + profile.tonal.tint * 0.5;
  const filters: string[] = [
    'format=gbrp',
    `eq=contrast=${fixed(profile.tonal.contrast)}:saturation=${fixed(profile.tonal.saturation)}:brightness=${fixed(profile.tonal.brightness)}:gamma=${fixed(profile.tonal.gamma)}`,
    `colorchannelmixer=rr=${fixed(redGain)}:gg=${fixed(greenGain)}:bb=${fixed(blueGain)}:pc=${profile.tonal.preserveLightness ? 'lum' : 'none'}:pa=${profile.tonal.preserveLightness ? 1 : 0}`,
  ];
  let graph = `[0:v]${filters.join(',')}`;
  let current = 'graded';
  if (profile.bloom.enabled && profile.bloom.intensity > 0) {
    const threshold = Math.round(profile.bloom.threshold * 255);
    graph += `,split=2[${current}][bright];`;
    graph += `[bright]lutrgb=r='if(gte(val,${threshold}),val,0)':g='if(gte(val,${threshold}),val,0)':b='if(gte(val,${threshold}),val,0)',gblur=sigma=${fixed(profile.bloom.radiusPixels)}[glow];`;
    graph += `[${current}][glow]blend=all_mode=screen:all_opacity=${fixed(profile.bloom.intensity)}[bloomed]`;
    current = 'bloomed';
  } else graph += `[${current}]`;
  const finalFilters: string[] = [];
  if (profile.vignette.enabled)
    finalFilters.push(`vignette=angle=${fixed(profile.vignette.angleRadians)}:eval=init:dither=0`);
  if (profile.grain.enabled && profile.grain.strength > 0)
    finalFilters.push(
      `noise=alls=${profile.grain.strength}:all_seed=${profile.grain.seed}:allf=${profile.grain.temporal ? 't+u' : 'u'}`,
    );
  finalFilters.push('format=yuv420p');
  graph += `;[${current}]${finalFilters.join(',')}[finished]`;
  return graph;
}

export async function renderCinematicFinish(
  sourceVideo: string,
  outputVideo: string,
  profileInput: CinematicFinishProfile,
) {
  const profile = cinematicFinishProfileSchema.parse(profileInput);
  await mkdir(dirname(outputVideo), { recursive: true });
  const filter = cinematicFinishFilter(profile);
  await exec(
    'ffmpeg',
    [
      '-v',
      'error',
      '-fflags',
      '+bitexact',
      '-i',
      sourceVideo,
      '-filter_complex',
      filter,
      '-map',
      '[finished]',
      '-map',
      '0:a?',
      '-map_metadata',
      '-1',
      '-metadata',
      'creation_time=1970-01-01T00:00:00Z',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-threads:v',
      '1',
      '-x264-params',
      'threads=1:lookahead_threads=1:sliced_threads=0',
      '-flags:v',
      '+bitexact',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      '-y',
      outputVideo,
    ],
    { maxBuffer: 20 * 1024 * 1024 },
  );
  return {
    sourceVideo,
    outputVideo,
    profile,
    filter,
    media: await inspectVideo(outputVideo),
    sha256: createHash('sha256')
      .update(await readFile(outputVideo))
      .digest('hex'),
  };
}
