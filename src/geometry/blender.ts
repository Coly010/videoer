import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createContactSheet, inspectVideo } from '../media/inspection.js';
import { resolveBlenderExecutable } from '../media/blender.js';
import { loadGeometry } from './io.js';

const exec = promisify(execFile);

export async function renderGeometryProbe(geometryFile: string, outputDirectory: string) {
  const input = resolve(geometryFile);
  const geometry = await loadGeometry(input);
  const output = resolve(outputDirectory);
  const script = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../scripts/blender/render_geometry_probe.py',
  );
  await mkdir(output, { recursive: true });
  const blender = await resolveBlenderExecutable();
  const { stdout, stderr } = await exec(
    blender,
    ['--background', '--python', script, '--', input, output],
    { maxBuffer: 20 * 1024 * 1024 },
  );
  const names = geometry.metadata.materialClass
    ? ['top.png', 'raking.png', 'close.png', 'glancing.png']
    : geometry.metadata.characterClass
      ? [
          'front.png',
          'three-quarter-left.png',
          'left.png',
          'right.png',
          'three-quarter-right.png',
          'back.png',
          'face-close-up.png',
          'face-three-quarter.png',
          ...(geometry.morphTargets.length
            ? ['face-smile.png', 'face-jaw-open.png', 'face-blink.png']
            : []),
          'left-hand-close-up.png',
          'right-hand-close-up.png',
          'left-hand-flexion.png',
          'right-hand-flexion.png',
        ]
      : geometry.metadata.environmentClass
        ? [
            'street-front.png',
            'street-three-quarter.png',
            'threshold.png',
            'interior-shelves.png',
            'interior-facade.png',
            'continuity-overhead.png',
          ]
        : ['front.png', 'three-quarter.png', 'side.png', 'back.png'];
  const views = names.map((name) => join(output, name));
  const contactSheet = join(output, 'contact-sheet.png');
  await createContactSheet(
    views,
    contactSheet,
    geometry.metadata.characterClass || geometry.metadata.environmentClass ? 3 : 2,
  );
  const turntable = join(output, 'turntable.mp4');
  const media = await inspectVideo(turntable);
  const report = join(output, 'probe.json');
  const transmissive = geometry.metadata.witnessGeometry === 'standing-transmissive-pane';
  await writeFile(
    report,
    `${JSON.stringify({ schemaVersion: 1, input, views, contactSheet, turntable, media, renderProfile: transmissive ? { engine: 'cycles-cpu', samples: 128, seed: 1729, denoise: true, intent: 'transmission-verification' } : { engine: 'eevee-next', intent: 'material-preview' }, blender: { stdout, stderr } }, null, 2)}\n`,
    'utf8',
  );
  return { input, output, views, contactSheet, turntable, report, media };
}
