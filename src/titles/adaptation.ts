import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { sha256File } from '../assets/library.js';
import { inspectImage } from '../media/inspection.js';
import { titleTreatmentSchema, type TitleTreatment } from './model.js';

const exec = promisify(execFile);
const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/);

export const editorialTreatmentAdaptationSchema = z.object({
  kind: z.literal('editorial-treatment-v1'),
  assetId: z.string().regex(/^editorial\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
  canvas: z.object({
    width: z.number().int().min(240).max(2160),
    height: z.number().int().min(240).max(2160),
  }),
  safeAreaMargins: z.object({
    left: z.number().min(0.05).max(0.25),
    top: z.number().min(0.05).max(0.25),
    right: z.number().min(0.05).max(0.25),
    bottom: z.number().min(0.05).max(0.25),
  }),
  copy: z.object({
    eyebrow: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(80),
    cta: z.string().trim().min(1).max(100),
  }),
  palette: z.object({
    background: hexColorSchema,
    foreground: hexColorSchema,
    accent: hexColorSchema,
  }),
  motifOpacity: z.number().min(0.12).max(0.65),
  typographyScale: z.number().min(0.75).max(1.3).default(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type EditorialTreatmentAdaptation = z.infer<typeof editorialTreatmentAdaptationSchema>;

export function adaptEditorialTreatment(
  baseInput: TitleTreatment,
  input: EditorialTreatmentAdaptation,
) {
  const base = titleTreatmentSchema.parse(baseInput);
  const adaptation = editorialTreatmentAdaptationSchema.parse(input);
  const { width, height } = adaptation.canvas;
  return titleTreatmentSchema.parse({
    schemaVersion: 1,
    id: adaptation.assetId,
    canvas: adaptation.canvas,
    safeArea: {
      left: Math.round(width * adaptation.safeAreaMargins.left),
      top: Math.round(height * adaptation.safeAreaMargins.top),
      right: Math.round(width * (1 - adaptation.safeAreaMargins.right)),
      bottom: Math.round(height * (1 - adaptation.safeAreaMargins.bottom)),
    },
    font: base.font,
    copy: adaptation.copy,
    palette: adaptation.palette,
    motif: { kind: base.motif.kind, opacity: adaptation.motifOpacity },
    typographyScale: adaptation.typographyScale,
    metadata: {
      ...base.metadata,
      ...adaptation.metadata,
      derivedFrom: base.id,
      editorialAdaptation: adaptation.kind,
    },
  });
}

function escapeDrawtext(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll("'", '’').replaceAll(':', '\\:');
}

function ffmpegColor(value: string) {
  return value.replace('#', '0x');
}

function layout(treatment: TitleTreatment) {
  const { left, top, right, bottom } = treatment.safeArea;
  const width = right - left;
  const height = bottom - top;
  const scale = treatment.typographyScale;
  return {
    eyebrow: {
      y: Math.round(top + height * 0.12),
      size: Math.max(12, Math.round(Math.min(width * 0.045, height * 0.085) * scale)),
    },
    title: {
      y: Math.round(top + height * 0.4),
      size: Math.max(18, Math.round(Math.min(width * 0.11, height * 0.2) * scale)),
    },
    cta: {
      y: Math.round(top + height * 0.76),
      size: Math.max(11, Math.round(Math.min(width * 0.04, height * 0.075) * scale)),
    },
  };
}

function drawText(
  font: string,
  text: string,
  size: number,
  y: number,
  color: string,
  borderColor: string,
) {
  return (
    `drawtext=fontfile='${escapeDrawtext(resolve(font))}':text='${escapeDrawtext(text)}':` +
    `fontcolor=${color}:fontsize=${size}:x=(w-text_w)/2:y=${y}:` +
    `borderw=${Math.max(1, Math.round(size * 0.045))}:bordercolor=${borderColor}`
  );
}

async function renderFilter(treatment: TitleTreatment, filter: string, outputPath: string) {
  const output = resolve(outputPath);
  await mkdir(dirname(output), { recursive: true });
  await exec('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=black@0.0:s=${treatment.canvas.width}x${treatment.canvas.height}:d=1,format=rgba`,
    '-vf',
    filter,
    '-frames:v',
    '1',
    '-c:v',
    'png',
    '-y',
    output,
  ]);
  return output;
}

export async function renderEditorialTreatment(
  treatmentInput: TitleTreatment,
  fontPath: string,
  outputPath: string,
  options: { layerDirectory?: string } = {},
) {
  const treatment = titleTreatmentSchema.parse(treatmentInput);
  const positions = layout(treatment);
  const foreground = ffmpegColor(treatment.palette.foreground);
  const accent = ffmpegColor(treatment.palette.accent);
  const background = ffmpegColor(treatment.palette.background);
  const border = `${background}@0.92`;
  const lineFilters = {
    eyebrow: drawText(
      fontPath,
      treatment.copy.eyebrow,
      positions.eyebrow.size,
      positions.eyebrow.y,
      accent,
      border,
    ),
    title: drawText(
      fontPath,
      treatment.copy.title,
      positions.title.size,
      positions.title.y,
      foreground,
      border,
    ),
    cta: drawText(
      fontPath,
      treatment.copy.cta,
      positions.cta.size,
      positions.cta.y,
      foreground,
      border,
    ),
  };
  const safe = treatment.safeArea;
  const safeWidth = safe.right - safe.left;
  const safeHeight = safe.bottom - safe.top;
  const innerInset = Math.max(4, Math.round(Math.min(safeWidth, safeHeight) * 0.035));
  const motif = [
    `drawbox=x=${safe.left}:y=${safe.top}:w=${safeWidth}:h=${safeHeight}:color=${background}@${(treatment.motif.opacity * 0.72).toFixed(4)}:t=fill`,
    `drawbox=x=${safe.left}:y=${safe.top}:w=${safeWidth}:h=${safeHeight}:color=${accent}@${treatment.motif.opacity.toFixed(4)}:t=${Math.max(1, Math.round(Math.min(safeWidth, safeHeight) * 0.009))}`,
    `drawbox=x=${safe.left + innerInset}:y=${safe.top + innerInset}:w=${safeWidth - innerInset * 2}:h=${safeHeight - innerInset * 2}:color=${foreground}@${(treatment.motif.opacity * 0.52).toFixed(4)}:t=1`,
  ];
  const output = await renderFilter(
    treatment,
    [...motif, lineFilters.eyebrow, lineFilters.title, lineFilters.cta].join(','),
    outputPath,
  );
  const layers: Record<string, string> = {};
  if (options.layerDirectory)
    for (const [id, filter] of Object.entries(lineFilters))
      layers[id] = await renderFilter(treatment, filter, join(options.layerDirectory, `${id}.png`));
  return { output, layers, layout: positions };
}

interface AlphaBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function inspectAlphaBounds(path: string): Promise<AlphaBounds | undefined> {
  const { stderr } = await exec('ffmpeg', [
    '-v',
    'info',
    '-i',
    resolve(path),
    '-vf',
    'alphaextract,bbox=min_val=1',
    '-frames:v',
    '1',
    '-f',
    'null',
    '-',
  ]);
  const match = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].at(-1);
  if (!match) return undefined;
  return {
    width: Number(match[1]),
    height: Number(match[2]),
    x: Number(match[3]),
    y: Number(match[4]),
  };
}

function channel(value: string, offset: number) {
  const raw = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
  return raw <= 0.04045 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
}

function luminance(value: string) {
  return channel(value, 1) * 0.2126 + channel(value, 3) * 0.7152 + channel(value, 5) * 0.0722;
}

function contrast(first: string, second: string) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

export function verifyEditorialTreatmentAdaptation(
  base: TitleTreatment,
  adapted: TitleTreatment,
  input: EditorialTreatmentAdaptation,
) {
  const adaptation = editorialTreatmentAdaptationSchema.parse(input);
  const expected = adaptEditorialTreatment(base, adaptation);
  const exactTreatmentMatched = JSON.stringify(adapted) === JSON.stringify(expected);
  const fontPreserved = JSON.stringify(adapted.font) === JSON.stringify(base.font);
  const motifPreserved = adapted.motif.kind === base.motif.kind;
  const issues: string[] = [];
  if (!exactTreatmentMatched)
    issues.push('adapted editorial treatment differs from declared transform');
  if (!fontPreserved) issues.push('font identity, weight, package, or licence changed');
  if (!motifPreserved) issues.push('protected editorial motif changed');
  return {
    valid: issues.length === 0,
    issues,
    adaptation,
    exactTreatmentMatched,
    fontPreserved,
    motifPreserved,
  };
}

export async function verifyEditorialTreatmentRendering(
  treatmentInput: TitleTreatment,
  fontPath: string,
  candidatePath: string,
) {
  const treatment = titleTreatmentSchema.parse(treatmentInput);
  const temporary = await mkdtemp(join(tmpdir(), 'videoer-editorial-verification-'));
  try {
    const expected = join(temporary, 'expected.png');
    const rendered = await renderEditorialTreatment(treatment, fontPath, expected, {
      layerDirectory: join(temporary, 'layers'),
    });
    const [candidateImage, candidateSha256, expectedSha256, fontSha256] = await Promise.all([
      inspectImage(candidatePath),
      sha256File(candidatePath),
      sha256File(expected),
      sha256File(fontPath),
    ]);
    const layerBounds = Object.fromEntries(
      await Promise.all(
        Object.entries(rendered.layers).map(async ([id, path]) => [
          id,
          await inspectAlphaBounds(path),
        ]),
      ),
    ) as Record<string, AlphaBounds | undefined>;
    const safe = treatment.safeArea;
    const linesInsideSafeArea = Object.values(layerBounds).every(
      (bounds) =>
        bounds &&
        bounds.x >= safe.left &&
        bounds.y >= safe.top &&
        bounds.x + bounds.width <= safe.right &&
        bounds.y + bounds.height <= safe.bottom,
    );
    const foregroundContrast = contrast(treatment.palette.foreground, treatment.palette.background);
    const accentContrast = contrast(treatment.palette.accent, treatment.palette.background);
    const deterministicRenderMatched = candidateSha256 === expectedSha256;
    const dimensionsMatched =
      candidateImage.width === treatment.canvas.width &&
      candidateImage.height === treatment.canvas.height;
    const issues: string[] = [];
    if (!dimensionsMatched) issues.push('editorial render dimensions differ from treatment canvas');
    if (!deterministicRenderMatched)
      issues.push('editorial pixels differ from deterministic treatment render');
    if (!linesInsideSafeArea)
      issues.push('one or more editorial text lines leave the declared safe area');
    if (foregroundContrast < 4.5) issues.push('foreground/background contrast is below 4.5:1');
    if (accentContrast < 3) issues.push('accent/background contrast is below 3:1');
    return {
      valid: issues.length === 0,
      issues,
      candidateSha256,
      expectedSha256,
      fontSha256,
      deterministicRenderMatched,
      dimensionsMatched,
      linesInsideSafeArea,
      layerBounds,
      contrast: { foreground: foregroundContrast, accent: accentContrast },
      layout: rendered.layout,
      canvas: treatment.canvas,
      safeArea: treatment.safeArea,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
