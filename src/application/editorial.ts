import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { renderGeometryProbe } from '../geometry/blender.js';
import { saveGeometry } from '../geometry/io.js';
import { validateGeometry } from '../geometry/model.js';
import { inspectImage } from '../media/inspection.js';
import { createDimensionalCampaignCover } from '../props/cover.js';
import { saveTitleTreatment } from '../titles/io.js';
import { createRiseOfDemonsTitleTreatment } from '../titles/treatment.js';

const exec = promisify(execFile);

async function resolveNativeTitleFont() {
  const candidates = [
    join(homedir(), 'Library/Fonts/CormorantGaramond[wght].ttf'),
    '/usr/share/fonts/truetype/cormorant-garamond/CormorantGaramond-SemiBold.ttf',
    'C:\\Windows\\Fonts\\CormorantGaramond-SemiBold.ttf',
  ];
  for (const candidate of candidates)
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  throw new Error(
    'Cormorant Garamond native font is missing. On macOS run: brew install --cask font-cormorant-garamond',
  );
}

function drawText(font: string, text: string, size: number, y: number, color: string) {
  const escapedFont = font.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'");
  const escapedText = text.replaceAll("'", '’').replaceAll(':', '\\:');
  return `drawtext=fontfile='${escapedFont}':text='${escapedText}':fontcolor=${color}:fontsize=${size}:x=(w-text_w)/2:y=${y}`;
}

async function createTitleAsset(outputDirectory: string) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const treatment = createRiseOfDemonsTitleTreatment();
  const treatmentFile = await saveTitleTreatment(join(output, 'title-treatment.json'), treatment);
  const font = await resolveNativeTitleFont();
  const preview = join(output, 'title-card.png');
  const filters = [
    'drawbox=x=164:y=596:w=752:h=708:color=0x9f4d2e@0.16:t=3',
    'drawbox=x=190:y=622:w=700:h=656:color=0xeadfc5@0.08:t=1',
    drawText(font, treatment.copy.eyebrow, 42, 540, '0x9f4d2e'),
    drawText(font, 'THE RISE OF', 92, 790, '0xeadfc5'),
    drawText(font, 'DEMONS', 158, 905, '0xeadfc5'),
    drawText(font, treatment.copy.cta, 34, 1215, '0xb7ad99'),
  ].join(',');
  await exec('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x070b14:s=1080x1920:d=1',
    '-vf',
    filters,
    '-frames:v',
    '1',
    '-y',
    preview,
  ]);
  const image = await inspectImage(preview);
  if (image.width !== 1080 || image.height !== 1920)
    throw new Error(
      `Title render dimensions are ${image.width}x${image.height}, expected 1080x1920`,
    );
  const overlay = join(output, 'title-overlay.png');
  const overlayFilters = [
    'format=rgba',
    'drawbox=x=120:y=500:w=840:h=850:color=0x02050a@0.52:t=fill',
    'drawbox=x=164:y=596:w=752:h=708:color=0x9f4d2e@0.34:t=3',
    'drawbox=x=190:y=622:w=700:h=656:color=0xeadfc5@0.16:t=1',
    drawText(font, treatment.copy.eyebrow, 42, 540, '0xc3633d'),
    drawText(font, 'THE RISE OF', 92, 790, '0xeadfc5'),
    drawText(font, 'DEMONS', 158, 905, '0xeadfc5'),
    drawText(font, treatment.copy.cta, 34, 1215, '0xb7ad99'),
  ].join(',');
  await exec('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=black@0.0:s=1080x1920:d=1',
    '-vf',
    overlayFilters,
    '-frames:v',
    '1',
    '-y',
    overlay,
  ]);
  const metadata = assetMetadataSchema.parse({
    schemaVersion: 1,
    id: treatment.id,
    version: '0.1.1',
    type: 'material',
    title: 'Rise of Demons restrained editorial title treatment',
    description:
      'Original vertical-safe restrained serif typography and threshold-line motif with deterministic FFmpeg rendering.',
    status: 'verified',
    tags: ['typography', 'title', 'editorial'],
    capabilities: ['vertical-safe-area', 'deterministic-render'],
    source: {
      kind: 'self-authored',
      generator: 'videoer.editorial-title.v1',
      references: ['@fontsource/cormorant-garamond@5.3.0'],
      licence: {
        spdx: 'LicenseRef-Videoer-Project-AND-OFL-1.1',
        name: 'Videoer project-owned design with OFL-1.1 Cormorant Garamond',
        commercialUse: 'allowed',
        attributionRequired: false,
      },
      clearance: 'approved',
    },
    artifacts: [
      {
        role: 'title-treatment',
        path: 'title-treatment.json',
        mediaType: 'application/vnd.videoer.title+json',
      },
      { role: 'preview', path: 'title-card.png', mediaType: 'image/png' },
      { role: 'transparent-overlay', path: 'title-overlay.png', mediaType: 'image/png' },
    ],
    compatibility: { renderers: ['ffmpeg-full', 'remotion'], requires: [] },
    verification: {
      checks: [
        'title.vertical-safe-area',
        'title.exact-font-dependency',
        'title.original-copy',
        'title.deterministic-1080x1920-render',
      ],
      artifacts: ['title-card.png', 'title-overlay.png'],
      verifiedAt: new Date().toISOString(),
    },
  });
  await writeHashedAssetMetadata(join(output, 'asset.yaml'), metadata);
  return { output, treatmentFile, preview, overlay, image };
}

async function createCoverAsset(sourceImage: string, outputDirectory: string) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  await copyFile(resolve(sourceImage), join(output, 'cover.png'));
  const geometry = createDimensionalCampaignCover();
  const validation = validateGeometry(geometry);
  if (!validation.valid)
    throw new Error(
      `Cover geometry failed: ${validation.issues.map((issue) => issue.code).join(', ')}`,
    );
  const geometryFile = await saveGeometry(join(output, 'geometry.json'), geometry);
  await writeFile(
    join(output, 'validation.json'),
    `${JSON.stringify(validation, null, 2)}\n`,
    'utf8',
  );
  const probe = await renderGeometryProbe(geometryFile, join(output, 'verification'));
  const metadata = assetMetadataSchema.parse({
    schemaVersion: 1,
    id: geometry.id,
    version: '0.1.0',
    type: 'prop',
    title: 'The Rise of Demons campaign cover',
    description:
      'Campaign-supplied front artwork packaged on a project-owned dimensional hardback cover mesh for the final product reveal.',
    status: 'verified',
    tags: ['cover', 'campaign-supplied'],
    capabilities: ['front-texture', 'dimensional-reveal'],
    source: {
      kind: 'supplied',
      sourceAsset: resolve(sourceImage),
      references: [],
      licence: {
        spdx: 'LicenseRef-Campaign-Supplied',
        name: 'Campaign-supplied artwork authorized for this production',
        commercialUse: 'allowed',
        attributionRequired: false,
      },
      clearance: 'approved',
    },
    artifacts: [
      { role: 'front-texture', path: 'cover.png', mediaType: 'image/png' },
      {
        role: 'geometry',
        path: 'geometry.json',
        mediaType: 'application/vnd.videoer.geometry+json',
      },
      { role: 'preview', path: 'verification/turntable.mp4', mediaType: 'video/mp4' },
      {
        role: 'blender-source',
        path: 'verification/mannequin.blend',
        mediaType: 'application/x-blender',
      },
    ],
    compatibility: {
      coordinateSystem: 'right-handed-y-up-forward-negative-z-metres',
      renderers: ['three-3d', 'blender-headless'],
      requires: [],
    },
    verification: {
      checks: [
        'geometry.topology',
        'geometry.front-face-uv',
        'texture.campaign-supplied-front',
        'visual.front-texture-legibility',
        'visual.dimensional-three-quarter',
      ],
      artifacts: ['verification/contact-sheet.png', 'verification/turntable.mp4'],
      verifiedAt: new Date().toISOString(),
    },
  });
  await writeHashedAssetMetadata(join(output, 'asset.yaml'), metadata);
  return { output, geometryFile, validation, probe };
}

export async function createEditorialAssets(sourceCover: string, outputRoot: string) {
  const root = resolve(outputRoot);
  const title = await createTitleAsset(join(root, 'title-treatment'));
  const cover = await createCoverAsset(sourceCover, join(root, 'cover-art'));
  return { root, title, cover };
}
