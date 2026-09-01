import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { assetMetadataSchema, writeHashedAssetMetadata } from '../assets/library.js';
import { saveCinematicFinishProfile } from '../finishing/io.js';
import { createSoftAtmosphericFinishProfile } from '../finishing/model.js';
import { renderCinematicFinish } from '../finishing/render.js';
import {
  createContactSheet,
  extractVideoFrameByIndex,
  inspectBlackPixelPercentage,
  inspectVideo,
  inspectWhitePixelPercentage,
} from '../media/inspection.js';

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function videoSummary(media: Record<string, unknown>) {
  const stream = ((media.streams as Array<Record<string, unknown>> | undefined) ?? []).find(
    (candidate) => candidate.codec_type === 'video',
  );
  const format = media.format as Record<string, unknown> | undefined;
  if (!stream) throw new Error('Cinematic finish source lacks a video stream');
  const frames = Number(stream.nb_frames);
  if (!Number.isInteger(frames) || frames < 1)
    throw new Error('Cinematic finish requires an exact source frame count');
  return {
    codec: stream.codec_name,
    width: Number(stream.width),
    height: Number(stream.height),
    pixelFormat: stream.pix_fmt,
    frameRate: String(stream.avg_frame_rate),
    frames,
    durationSeconds: Number(format?.duration),
    audioStreamCount: ((media.streams as Array<Record<string, unknown>>) ?? []).filter(
      (candidate) => candidate.codec_type === 'audio',
    ).length,
  };
}

async function createTransfer(
  kind: 'warm-interior' | 'cool-interior',
  sourceInput: string,
  sourceAsset: string,
  directory: string,
  profile: ReturnType<typeof createSoftAtmosphericFinishProfile>,
) {
  const source = resolve(sourceInput);
  const sourceBytes = await readFile(source);
  const sourceMedia = await inspectVideo(source);
  const sourceSummary = videoSummary(sourceMedia);
  const finished = join(directory, `${kind}-finished.mp4`);
  const render = await renderCinematicFinish(source, finished, profile);
  const outputSummary = videoSummary(render.media);
  if (
    outputSummary.width !== sourceSummary.width ||
    outputSummary.height !== sourceSummary.height ||
    outputSummary.frameRate !== sourceSummary.frameRate ||
    outputSummary.frames !== sourceSummary.frames ||
    Math.abs(outputSummary.durationSeconds - sourceSummary.durationSeconds) > 0.001 ||
    outputSummary.audioStreamCount !== sourceSummary.audioStreamCount
  )
    throw new Error(`${kind} finish changed source delivery topology`);
  const midpoint = Math.floor((sourceSummary.frames - 1) / 2);
  const sourceFrame = join(directory, 'source-mid.png');
  const finishedFrame = join(directory, 'finished-mid.png');
  await extractVideoFrameByIndex(source, midpoint, sourceFrame);
  await extractVideoFrameByIndex(finished, midpoint, finishedFrame);
  const [sourceFrameBytes, finishedFrameBytes, sourceBlack, outputBlack, sourceWhite, outputWhite] =
    await Promise.all([
      readFile(sourceFrame),
      readFile(finishedFrame),
      inspectBlackPixelPercentage(sourceFrame),
      inspectBlackPixelPercentage(finishedFrame),
      inspectWhitePixelPercentage(sourceFrame),
      inspectWhitePixelPercentage(finishedFrame),
    ]);
  if (sha256(sourceFrameBytes) === sha256(finishedFrameBytes))
    throw new Error(`${kind} finish produced no measurable midpoint pixel change`);
  if (outputBlack > sourceBlack + 15)
    throw new Error(`${kind} finish crushed black coverage by more than 15 percentage points`);
  if (outputWhite > Math.max(5, sourceWhite + 3))
    throw new Error(`${kind} finish clipped excessive highlights`);
  const report = {
    schemaVersion: 1,
    kind,
    source: {
      asset: sourceAsset,
      path: source,
      filename: basename(source),
      sha256: sha256(sourceBytes),
      media: sourceSummary,
      midpoint: {
        frame: midpoint,
        sha256: sha256(sourceFrameBytes),
        black: sourceBlack,
        white: sourceWhite,
      },
    },
    output: {
      path: finished,
      sha256: render.sha256,
      media: outputSummary,
      midpoint: {
        frame: midpoint,
        sha256: sha256(finishedFrameBytes),
        black: outputBlack,
        white: outputWhite,
      },
    },
    profileId: profile.id,
    filter: render.filter,
    verification: {
      deliveryTopologyPreserved: true,
      pixelsChanged: true,
      blackCoveragePreserved: true,
      highlightDetailPreserved: true,
    },
  };
  const reportFile = join(directory, 'finish-report.json');
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { kind, source, finished, sourceFrame, finishedFrame, reportFile, report };
}

export async function createCinematicFinishAsset(
  outputDirectory: string,
  warmSource: string,
  coolSource: string,
  warmSourceAsset: string,
  coolSourceAsset: string,
) {
  const sourceAssetPattern = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+@\d+\.\d+\.\d+$/;
  if (!sourceAssetPattern.test(warmSourceAsset) || !sourceAssetPattern.test(coolSourceAsset))
    throw new Error('Cinematic finish source assets require stable id@semantic-version identities');
  if (warmSourceAsset === coolSourceAsset)
    throw new Error('Cinematic finish transfer requires two distinct source asset identities');
  const output = resolve(outputDirectory);
  const verification = join(output, 'verification');
  await mkdir(verification, { recursive: true });
  const profile = createSoftAtmosphericFinishProfile();
  const profileFile = await saveCinematicFinishProfile(
    join(output, 'finish-profile.json'),
    profile,
  );
  const warm = await createTransfer(
    'warm-interior',
    warmSource,
    warmSourceAsset,
    join(verification, 'warm-interior'),
    profile,
  );
  const cool = await createTransfer(
    'cool-interior',
    coolSource,
    coolSourceAsset,
    join(verification, 'cool-interior'),
    profile,
  );
  if (warm.report.source.sha256 === cool.report.source.sha256)
    throw new Error('Cinematic finish transfer requires distinct warm and cool source videos');
  const contactSheet = join(verification, 'contact-sheet.png');
  await createContactSheet(
    [warm.sourceFrame, warm.finishedFrame, cool.sourceFrame, cool.finishedFrame],
    contactSheet,
    2,
  );
  const artifact = (path: string) => relative(output, path);
  const metadata = await writeHashedAssetMetadata(
    join(output, 'asset.yaml'),
    assetMetadataSchema.parse({
      schemaVersion: 1,
      id: profile.id,
      version: '0.1.0',
      type: 'vfx',
      title: 'Restrained soft-atmospheric cinematic finish',
      description:
        'Renderer-independent deterministic display-referred finish with bounded tonal treatment, thresholded bloom, vignette and seeded temporal grain.',
      status: 'validated',
      tags: ['cinematic-finish', 'grading', 'bloom', 'vignette', 'grain'],
      capabilities: [
        'renderer-independent-finish-profile',
        'deterministic-ffmpeg-reconstruction',
        'post-editorial-compositing',
        'warm-cool-source-transfer',
      ],
      source: {
        kind: 'procedural',
        generator: 'videoer.cinematic-finish.v1',
        sourceAssets: [warmSourceAsset, coolSourceAsset],
        references: [warm.source, cool.source],
        licence: {
          spdx: 'LicenseRef-Videoer-Project',
          name: 'Videoer project-owned production asset',
          commercialUse: 'allowed',
          attributionRequired: false,
        },
        clearance: 'approved',
      },
      artifacts: [
        {
          role: 'finish-profile',
          path: 'finish-profile.json',
          mediaType: 'application/vnd.videoer.cinematic-finish+json',
        },
        { role: 'warm-finished-preview', path: artifact(warm.finished), mediaType: 'video/mp4' },
        {
          role: 'warm-finish-report',
          path: artifact(warm.reportFile),
          mediaType: 'application/json',
        },
        { role: 'cool-finished-preview', path: artifact(cool.finished), mediaType: 'video/mp4' },
        {
          role: 'cool-finish-report',
          path: artifact(cool.reportFile),
          mediaType: 'application/json',
        },
        {
          role: 'cross-source-contact-sheet',
          path: artifact(contactSheet),
          mediaType: 'image/png',
        },
      ],
      compatibility: {
        coordinateSystem: 'screen-space-display-referred',
        renderers: ['ffmpeg'],
        requires: [],
      },
      verification: {
        checks: [
          'finish.schema-and-bounds',
          'finish.delivery-topology-preserved',
          'finish.measurable-pixel-change',
          'finish.black-and-highlight-detail-preserved',
          'finish.warm-cool-transfer-generated-not-accepted',
          'finish.independent-rerender-pending-acceptance',
        ],
        artifacts: [artifact(warm.reportFile), artifact(cool.reportFile), artifact(contactSheet)],
        verifiedAt: new Date().toISOString(),
      },
    }),
  );
  return { output, profileFile, metadata, warm, cool, contactSheet };
}
