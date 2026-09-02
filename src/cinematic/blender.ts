import { execFile } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  createContactSheet,
  inspectBlackPixelPercentageInRegion,
  extractVideoFrameByIndex,
  inspectBlackPixelPercentage,
  inspectImage,
  inspectWhitePixelPercentage,
  inspectWhitePixelPercentageInRegion,
  inspectNormalizedColorEntropyInRegion,
  inspectVideo,
} from '../media/inspection.js';
import { resolveBlenderExecutable } from '../media/blender.js';
import { loadCinematicFinishProfile } from '../finishing/io.js';
import { renderCinematicFinish } from '../finishing/render.js';
import { loadCinematicScene } from './io.js';
import { verifyCinematicScene, type CinematicQualityCheck } from './verification.js';
import { loadLightingRig } from '../lighting/io.js';
import { resolveFiniteFogDomain } from './fog.js';
import { resolveRigBoundAtmosphere } from './lighting.js';
import { sha256File } from '../assets/library.js';

const exec = promisify(execFile);

export function cinematicLandmarkFrame(progress: number, durationSeconds: number, fps: number) {
  const frameCount = Math.round(durationSeconds * fps);
  if (frameCount < 1) throw new Error('Cinematic render requires at least one frame');
  return Math.min(Math.round(progress * (frameCount - 1)) + 1, frameCount);
}

export function aggregateCinematicRenderVerification(
  structural: {
    schemaVersion: 1;
    status: 'pass' | 'fail';
    checks: CinematicQualityCheck[];
  },
  renderChecks: CinematicQualityCheck[],
) {
  const checks = [...structural.checks, ...renderChecks];
  return {
    schemaVersion: 1 as const,
    status: checks.every((check) => check.status === 'pass')
      ? ('pass' as const)
      : ('fail' as const),
    checks,
  };
}

async function prepareCinematicRender(sceneFile: string, outputDirectory: string) {
  const source = resolve(sceneFile);
  const sourceDirectory = dirname(source);
  const scene = await loadCinematicScene(source);
  const verification = await verifyCinematicScene(scene, source);
  if (verification.status === 'fail')
    throw new Error(
      `Cinematic scene verification failed: ${verification.checks
        .filter((check) => check.status === 'fail')
        .map((check) => check.message)
        .join('; ')}`,
    );
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const manifest = join(output, 'resolved-scene.json');
  const lightingRig = scene.lightingRigPath
    ? await loadLightingRig(resolve(sourceDirectory, scene.lightingRigPath))
    : undefined;
  const environmentIllumination =
    lightingRig?.environmentIllumination?.kind === 'hash-bound-equirectangular-radiance'
      ? {
          ...lightingRig.environmentIllumination,
          source: {
            ...lightingRig.environmentIllumination.source,
            path: resolve(
              dirname(resolve(sourceDirectory, scene.lightingRigPath!)),
              lightingRig.environmentIllumination.source.path,
            ),
          },
        }
      : lightingRig?.environmentIllumination;
  const finiteFogDomain =
    scene.atmosphere.fogDensity > 0 ? await resolveFiniteFogDomain(scene, source) : undefined;
  const resolvedEntities = await Promise.all(
    scene.entities.map(async (entity) => {
      const historyPath = entity.surfaceHistoryFieldPath
        ? resolve(sourceDirectory, entity.surfaceHistoryFieldPath)
        : undefined;
      const waterPath = entity.surfaceWaterFieldPath
        ? resolve(sourceDirectory, entity.surfaceWaterFieldPath)
        : undefined;
      const [historyField, waterField] =
        historyPath && waterPath
          ? await Promise.all([
              readFile(historyPath, 'utf8').then((value) => JSON.parse(value)),
              readFile(waterPath, 'utf8').then((value) => JSON.parse(value)),
            ])
          : [undefined, undefined];
      return {
        ...entity,
        geometryPath: resolve(sourceDirectory, entity.geometryPath),
        ...(entity.productionRigProfilePath
          ? { productionRigProfilePath: resolve(sourceDirectory, entity.productionRigProfilePath) }
          : {}),
        ...(entity.productionCharacterBindingPath
          ? {
              productionCharacterBindingPath: resolve(
                sourceDirectory,
                entity.productionCharacterBindingPath,
              ),
            }
          : {}),
        ...(waterPath ? { surfaceWaterFieldPath: waterPath } : {}),
        ...(entity.surfaceWaterReceiverAppearancePath
          ? {
              surfaceWaterReceiverAppearancePath: resolve(
                sourceDirectory,
                entity.surfaceWaterReceiverAppearancePath,
              ),
            }
          : {}),
        ...(historyPath
          ? {
              surfaceHistoryFieldPath: historyPath,
              surfaceHistoryVerification: {
                verifier: 'videoer.surface-history-render-preflight.v1',
                fieldFileSha256: await sha256File(historyPath),
                fieldSha256: historyField.fieldSha256,
                waterFileSha256: await sha256File(waterPath!),
                waterFieldSha256: waterField.fieldSha256,
                ...(historyField.schemaVersion >= 2
                  ? { routingSha256: waterField.routing.routingSha256 }
                  : {}),
              },
            }
          : {}),
        ...(entity.surfaceWaterOpticalSurfacePath
          ? {
              surfaceWaterOpticalSurfacePath: resolve(
                sourceDirectory,
                entity.surfaceWaterOpticalSurfacePath,
              ),
            }
          : {}),
        ...(entity.fixturePath
          ? { fixturePath: resolve(sourceDirectory, entity.fixturePath) }
          : {}),
        ...(entity.motion
          ? { motion: { ...entity.motion, path: resolve(sourceDirectory, entity.motion.path) } }
          : {}),
      };
    }),
  );
  const resolved = {
    ...scene,
    atmosphere: resolveRigBoundAtmosphere(scene.atmosphere, lightingRig),
    ...(finiteFogDomain ? { finiteFogDomain } : {}),
    ...(scene.lightingRigPath
      ? { lightingRigPath: resolve(sourceDirectory, scene.lightingRigPath) }
      : {}),
    ...(lightingRig ? { exposure: lightingRig.exposure } : {}),
    ...(environmentIllumination ? { environmentIllumination } : {}),
    entities: resolvedEntities,
    overlays: scene.overlays.map((overlay) => ({
      ...overlay,
      imagePath: resolve(sourceDirectory, overlay.imagePath),
    })),
    ...(scene.finishProfilePath
      ? { finishProfilePath: resolve(sourceDirectory, scene.finishProfilePath) }
      : {}),
  };
  await writeFile(manifest, `${JSON.stringify(resolved, null, 2)}\n`, 'utf8');
  const script = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../scripts/blender/render_cinematic_scene.py',
  );
  const blender = await resolveBlenderExecutable();
  const basename = scene.id.split('.').at(-1)!;
  const blend = join(output, `${basename}.blend`);
  return {
    source,
    scene,
    verification,
    output,
    manifest,
    resolved,
    script,
    blender,
    basename,
    blend,
  };
}

export async function renderCinematicScene(
  sceneFile: string,
  outputDirectory: string,
  options: { reuseExistingPixels?: boolean } = {},
) {
  const prepared = await prepareCinematicRender(sceneFile, outputDirectory);
  const { source, scene, verification, output, manifest, resolved, script, blender, basename } =
    prepared;
  const baseVideo = join(output, `${basename}.mp4`);
  const { blend } = prepared;
  const compositedVideo = resolved.overlays.length
    ? join(output, `${basename}-composited.mp4`)
    : baseVideo;
  const video = resolved.finishProfilePath
    ? join(output, `${basename}-finished.mp4`)
    : compositedVideo;
  if (options.reuseExistingPixels) {
    await Promise.all([access(baseVideo), access(video), access(blend)]).catch(() => {
      throw new Error(
        `Cannot refresh cinematic evidence for '${scene.id}' because its existing pixel render is incomplete`,
      );
    });
  }
  const { stdout, stderr } = await exec(
    blender,
    [
      '--background',
      '--factory-startup',
      '--python',
      script,
      '--',
      manifest,
      output,
      options.reuseExistingPixels ? 'inspect-only' : 'render',
    ],
    { maxBuffer: 30 * 1024 * 1024 },
  );
  const productionCharacterAssemblies = JSON.parse(
    await readFile(join(output, 'production-character-assembly-report.json'), 'utf8'),
  ) as { schemaVersion: 1; sceneId: string; assemblies: unknown[] };
  if (!options.reuseExistingPixels) {
    const losslessFrames = join(output, 'lossless-frames');
    await exec(
      'ffmpeg',
      [
        '-v',
        'error',
        '-fflags',
        '+bitexact',
        '-framerate',
        String(scene.fps),
        '-start_number',
        '1',
        '-i',
        join(losslessFrames, `${basename}-%04d.png`),
        '-frames:v',
        String(Math.round(scene.durationSeconds * scene.fps)),
        '-map_metadata',
        '-1',
        '-metadata',
        'creation_time=1970-01-01T00:00:00Z',
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-threads:v',
        '1',
        '-x264-params',
        'threads=1:lookahead_threads=1:sliced_threads=0',
        '-flags:v',
        '+bitexact',
        '-an',
        '-movflags',
        '+faststart',
        '-y',
        baseVideo,
      ],
      { maxBuffer: 20 * 1024 * 1024 },
    );
    await rm(losslessFrames, { recursive: true, force: true });
  }
  if (resolved.overlays.length && !options.reuseExistingPixels) {
    const filters: string[] = [];
    let current = '0:v';
    for (const [index, overlay] of resolved.overlays.entries()) {
      const input = index + 1;
      const overlayLabel = `overlay${index}`;
      const outputLabel = `composite${index}`;
      const effects = [
        `scale=${scene.resolution.width}:${scene.resolution.height}`,
        'format=rgba',
        `colorchannelmixer=aa=${overlay.opacity}`,
      ];
      if (overlay.fadeInSeconds > 0)
        effects.push(`fade=t=in:st=${overlay.startSeconds}:d=${overlay.fadeInSeconds}:alpha=1`);
      if (overlay.fadeOutSeconds > 0)
        effects.push(
          `fade=t=out:st=${overlay.endSeconds - overlay.fadeOutSeconds}:d=${overlay.fadeOutSeconds}:alpha=1`,
        );
      filters.push(`[${input}:v]${effects.join(',')}[${overlayLabel}]`);
      filters.push(
        `[${current}][${overlayLabel}]overlay=0:0:enable='between(t,${overlay.startSeconds},${overlay.endSeconds})'[${outputLabel}]`,
      );
      current = outputLabel;
    }
    await exec(
      'ffmpeg',
      [
        '-v',
        'error',
        '-i',
        baseVideo,
        ...resolved.overlays.flatMap((overlay) => ['-loop', '1', '-i', overlay.imagePath]),
        '-filter_complex',
        filters.join(';'),
        '-map',
        `[${current}]`,
        '-map_metadata',
        '-1',
        '-metadata',
        'creation_time=1970-01-01T00:00:00Z',
        '-t',
        String(scene.durationSeconds),
        '-r',
        String(scene.fps),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-threads:v',
        '1',
        '-x264-params',
        'threads=1:lookahead_threads=1:sliced_threads=0',
        '-fflags',
        '+bitexact',
        '-flags:v',
        '+bitexact',
        '-an',
        '-y',
        compositedVideo,
      ],
      { maxBuffer: 20 * 1024 * 1024 },
    );
  }
  if (resolved.finishProfilePath && !options.reuseExistingPixels)
    await renderCinematicFinish(
      compositedVideo,
      video,
      await loadCinematicFinishProfile(resolved.finishProfilePath),
    );
  const media = await inspectVideo(video);
  const duration = Number((media.format as { duration?: string } | undefined)?.duration);
  const frames = await Promise.all(
    scene.landmarks.map(async (landmark) => {
      const frame = cinematicLandmarkFrame(landmark.progress, duration, scene.fps);
      const path = join(
        output,
        `${String(Math.round(landmark.progress * 100)).padStart(3, '0')}-${landmark.id}.png`,
      );
      await extractVideoFrameByIndex(video, frame - 1, path);
      return { ...landmark, path };
    }),
  );
  const contactSheet = join(output, 'contact-sheet.png');
  await createContactSheet(
    frames.map((frame) => frame.path),
    contactSheet,
    Math.min(3, frames.length),
  );
  const framingReport = JSON.parse(await readFile(join(output, 'framing-report.json'), 'utf8')) as {
    cameraContract?: {
      valid?: boolean;
      trackingConstraint?: string;
      trackAxis?: string;
      upAxis?: string;
      interpolationImplementation?: string;
      maximumPositionErrorMeters?: number;
      maximumTargetErrorMeters?: number;
      maximumLensErrorMillimeters?: number;
      samples?: unknown[];
    };
    samples: Array<{
      landmarkId: string;
      entities: Record<
        string,
        {
          minimumX: number;
          maximumX: number;
          minimumY: number;
          maximumY: number;
          heightPercentage: number;
        } | null
      >;
    }>;
  };
  const worldReport = JSON.parse(await readFile(join(output, 'world-report.json'), 'utf8')) as {
    fog?: {
      enabled?: boolean;
      implementation?: string;
      density?: number;
      worldVolumeLinked?: boolean;
      materialVolumeLinked?: boolean;
      boundsMinimum?: number[];
      boundsMaximum?: number[];
      edgeFalloffMeters?: number;
      edgeFalloffImplementation?: string;
      derivationSha256?: string;
      requestedPolicy?: unknown;
      evaluatedBounds?: {
        sampledFrames?: number[];
        includedVisibleObjects?: string[];
        allVisibleObjectsContained?: boolean;
        allSampledFramesContained?: boolean;
        cameraAndTargetContained?: boolean;
        rendererDerivationSha256?: string;
      };
    };
  };
  const declaredRenderChecks = await Promise.all(
    scene.renderGates.map(async (gate) => {
      if (gate.type === 'overlay-visibility') {
        const overlay = scene.overlays.find((candidate) => candidate.id === gate.overlayId)!;
        const samples = gate.landmarkIds.map((landmarkId) => {
          const landmark = scene.landmarks.find((candidate) => candidate.id === landmarkId)!;
          const timeSeconds = landmark.progress * scene.durationSeconds;
          let effectiveOpacity = 0;
          if (timeSeconds >= overlay.startSeconds && timeSeconds <= overlay.endSeconds) {
            effectiveOpacity = overlay.opacity;
            if (overlay.fadeInSeconds > 0)
              effectiveOpacity *= Math.min(
                1,
                Math.max(0, (timeSeconds - overlay.startSeconds) / overlay.fadeInSeconds),
              );
            if (overlay.fadeOutSeconds > 0)
              effectiveOpacity *= Math.min(
                1,
                Math.max(0, (overlay.endSeconds - timeSeconds) / overlay.fadeOutSeconds),
              );
          }
          return { landmarkId, timeSeconds, effectiveOpacity };
        });
        const passed = samples.every((sample) => sample.effectiveOpacity >= gate.minimumOpacity);
        return {
          id: gate.id,
          status: passed ? ('pass' as const) : ('fail' as const),
          message: passed
            ? `Overlay '${gate.overlayId}' meets its declared visibility at required landmarks`
            : `Overlay '${gate.overlayId}' is absent or below its declared opacity at a required landmark`,
          measurements: {
            overlayId: gate.overlayId,
            minimumOpacity: gate.minimumOpacity,
            samples,
          },
        };
      }
      if (gate.type === 'entity-set-coverage') {
        const margin = gate.marginPercentage / 100;
        const entities = gate.entityIds.map((entityId) => {
          const samples = framingReport.samples.map((sample) => {
            const bounds = sample.entities[entityId] ?? null;
            if (!bounds)
              return {
                landmarkId: sample.landmarkId,
                visibleAreaPercentage: 0,
                screenHeightPercentage: 0,
                withinMargin: false,
                accepted: false,
              };
            const width = Math.max(0, bounds.maximumX - bounds.minimumX);
            const height = Math.max(0, bounds.maximumY - bounds.minimumY);
            const visibleWidth = Math.max(
              0,
              Math.min(1 - margin, bounds.maximumX) - Math.max(margin, bounds.minimumX),
            );
            const visibleHeight = Math.max(
              0,
              Math.min(1 - margin, bounds.maximumY) - Math.max(margin, bounds.minimumY),
            );
            const visibleAreaPercentage =
              width > 0 && height > 0 ? (visibleWidth * visibleHeight * 100) / (width * height) : 0;
            const withinMargin =
              bounds.minimumX >= margin &&
              bounds.maximumX <= 1 - margin &&
              bounds.minimumY >= margin &&
              bounds.maximumY <= 1 - margin;
            const screenHeightPercentage = bounds.heightPercentage;
            return {
              landmarkId: sample.landmarkId,
              visibleAreaPercentage,
              screenHeightPercentage,
              withinMargin,
              accepted:
                withinMargin &&
                visibleAreaPercentage >= gate.minimumVisibleAreaPercentage &&
                screenHeightPercentage >= gate.minimumScreenHeightPercentage &&
                screenHeightPercentage <= gate.maximumScreenHeightPercentage,
            };
          });
          return {
            entityId,
            covered: samples.some((sample) => sample.accepted),
            samples,
          };
        });
        const uncoveredEntityIds = entities
          .filter((entity) => !entity.covered)
          .map((entity) => entity.entityId);
        return {
          id: gate.id,
          status: uncoveredEntityIds.length === 0 ? ('pass' as const) : ('fail' as const),
          message:
            uncoveredEntityIds.length === 0
              ? 'Every declared entity is inspectable in at least one semantic landmark'
              : `Some declared entities lack a fully inspectable semantic landmark: ${uncoveredEntityIds.join(', ')}`,
          measurements: {
            minimumVisibleAreaPercentage: gate.minimumVisibleAreaPercentage,
            minimumScreenHeightPercentage: gate.minimumScreenHeightPercentage,
            maximumScreenHeightPercentage: gate.maximumScreenHeightPercentage,
            marginPercentage: gate.marginPercentage,
            uncoveredEntityIds,
            entities,
          },
        };
      }
      if (gate.type === 'entity-set-frame-presence') {
        const margin = gate.marginPercentage / 100;
        const entities = gate.entityIds.map((entityId) => {
          const samples = framingReport.samples.map((sample) => {
            const bounds = sample.entities[entityId] ?? null;
            if (!bounds)
              return {
                landmarkId: sample.landmarkId,
                visibleFrameAreaPercentage: 0,
                accepted: false,
              };
            const visibleWidth = Math.max(
              0,
              Math.min(1 - margin, bounds.maximumX) - Math.max(margin, bounds.minimumX),
            );
            const visibleHeight = Math.max(
              0,
              Math.min(1 - margin, bounds.maximumY) - Math.max(margin, bounds.minimumY),
            );
            const visibleFrameAreaPercentage = visibleWidth * visibleHeight * 100;
            return {
              landmarkId: sample.landmarkId,
              visibleFrameAreaPercentage,
              accepted:
                visibleFrameAreaPercentage >= gate.minimumVisibleFrameAreaPercentage &&
                visibleFrameAreaPercentage <= gate.maximumVisibleFrameAreaPercentage,
            };
          });
          return { entityId, covered: samples.some((sample) => sample.accepted), samples };
        });
        const uncoveredEntityIds = entities
          .filter((entity) => !entity.covered)
          .map((entity) => entity.entityId);
        return {
          id: gate.id,
          status: uncoveredEntityIds.length === 0 ? ('pass' as const) : ('fail' as const),
          message:
            uncoveredEntityIds.length === 0
              ? 'Every declared large-scene entity occupies a useful frame region in at least one landmark'
              : `Some declared large-scene entities lack useful visible frame area: ${uncoveredEntityIds.join(', ')}`,
          measurements: {
            minimumVisibleFrameAreaPercentage: gate.minimumVisibleFrameAreaPercentage,
            maximumVisibleFrameAreaPercentage: gate.maximumVisibleFrameAreaPercentage,
            marginPercentage: gate.marginPercentage,
            uncoveredEntityIds,
            entities,
          },
        };
      }
      if (gate.type === 'subject-coverage') {
        const samples = framingReport.samples.map((sample) => {
          const bounds = sample.entities[gate.entityId] ?? null;
          if (!bounds)
            return {
              landmarkId: sample.landmarkId,
              visibleAreaPercentage: 0,
              visibleScreenHeightPercentage: 0,
            };
          const width = Math.max(0, bounds.maximumX - bounds.minimumX);
          const height = Math.max(0, bounds.maximumY - bounds.minimumY);
          const visibleWidth = Math.max(
            0,
            Math.min(1, bounds.maximumX) - Math.max(0, bounds.minimumX),
          );
          const visibleHeight = Math.max(
            0,
            Math.min(1, bounds.maximumY) - Math.max(0, bounds.minimumY),
          );
          return {
            landmarkId: sample.landmarkId,
            visibleAreaPercentage:
              width > 0 && height > 0 ? (visibleWidth * visibleHeight * 100) / (width * height) : 0,
            visibleScreenHeightPercentage: visibleHeight * 100,
          };
        });
        const passed = samples.every(
          (sample) =>
            sample.visibleAreaPercentage >= gate.minimumVisibleAreaPercentage &&
            sample.visibleScreenHeightPercentage >= gate.minimumVisibleScreenHeightPercentage &&
            sample.visibleScreenHeightPercentage <= gate.maximumVisibleScreenHeightPercentage,
        );
        return {
          id: gate.id,
          status: passed ? ('pass' as const) : ('fail' as const),
          message: passed
            ? `Entity '${gate.entityId}' retains the declared partial-subject composition`
            : `Entity '${gate.entityId}' lacks the required visible coverage`,
          measurements: {
            entityId: gate.entityId,
            minimumVisibleAreaPercentage: gate.minimumVisibleAreaPercentage,
            minimumVisibleScreenHeightPercentage: gate.minimumVisibleScreenHeightPercentage,
            maximumVisibleScreenHeightPercentage: gate.maximumVisibleScreenHeightPercentage,
            samples,
          },
        };
      }
      if (gate.type === 'subject-overexposure') {
        const percentages = await Promise.all(
          frames.map(async (frame, index) => {
            const bounds = framingReport.samples[index]?.entities[gate.entityId];
            if (!bounds) return 100;
            const image = await inspectImage(frame.path);
            if (!image.width || !image.height) return 100;
            const minimumX = Math.max(0, bounds.minimumX);
            const maximumX = Math.min(1, bounds.maximumX);
            const minimumY = Math.max(0, bounds.minimumY);
            const maximumY = Math.min(1, bounds.maximumY);
            if (maximumX <= minimumX || maximumY <= minimumY) return 100;
            return inspectWhitePixelPercentageInRegion(
              frame.path,
              {
                x: minimumX * image.width,
                y: (1 - maximumY) * image.height,
                width: (maximumX - minimumX) * image.width,
                height: (maximumY - minimumY) * image.height,
              },
              gate.whiteThreshold,
            );
          }),
        );
        const maximum = Math.max(...percentages);
        return {
          id: gate.id,
          status: maximum <= gate.maximumWhitePercentage ? ('pass' as const) : ('fail' as const),
          message:
            maximum <= gate.maximumWhitePercentage
              ? `Entity '${gate.entityId}' retains subject-local highlight detail`
              : `Entity '${gate.entityId}' contains excessive clipped or near-white coverage`,
          measurements: {
            entityId: gate.entityId,
            maximumWhitePercentage: maximum,
            allowedWhitePercentage: gate.maximumWhitePercentage,
            perFrameWhitePercentage: percentages,
          },
        };
      }
      if (gate.type === 'subject-framing') {
        const margin = gate.marginPercentage / 100;
        const samples = framingReport.samples.map((sample) => ({
          landmarkId: sample.landmarkId,
          bounds: sample.entities[gate.entityId] ?? null,
        }));
        const passed = samples.every(
          ({ bounds }) =>
            bounds !== null &&
            bounds.minimumX >= margin &&
            bounds.maximumX <= 1 - margin &&
            bounds.minimumY >= margin &&
            bounds.maximumY <= 1 - margin &&
            bounds.heightPercentage >= gate.minimumScreenHeightPercentage &&
            bounds.heightPercentage <= gate.maximumScreenHeightPercentage,
        );
        return {
          id: gate.id,
          status: passed ? ('pass' as const) : ('fail' as const),
          message: passed
            ? `Entity '${gate.entityId}' remains fully framed at semantic landmarks`
            : `Entity '${gate.entityId}' is cropped or outside the declared framing scale`,
          measurements: {
            entityId: gate.entityId,
            minimumScreenHeightPercentage: gate.minimumScreenHeightPercentage,
            maximumScreenHeightPercentage: gate.maximumScreenHeightPercentage,
            marginPercentage: gate.marginPercentage,
            samples,
          },
        };
      }
      if (gate.type === 'frame-overexposure') {
        const percentages = await Promise.all(
          frames.map((frame) => inspectWhitePixelPercentage(frame.path, gate.whiteThreshold)),
        );
        const maximum = Math.max(...percentages);
        return {
          id: gate.id,
          status: maximum <= gate.maximumWhitePercentage ? ('pass' as const) : ('fail' as const),
          message:
            maximum <= gate.maximumWhitePercentage
              ? 'Semantic frames retain highlight detail within the declared limit'
              : 'A semantic frame contains excessive clipped or near-white coverage',
          measurements: {
            maximumWhitePercentage: maximum,
            allowedWhitePercentage: gate.maximumWhitePercentage,
            perFrameWhitePercentage: percentages,
          },
        };
      }
      if (gate.type === 'region-exposure') {
        const samples = await Promise.all(
          frames.map(async (frame) => {
            const image = await inspectImage(frame.path);
            if (!image.width || !image.height)
              return { blackPercentage: 100, whitePercentage: 100, midtonePercentage: 0 };
            const region = {
              x: gate.region.x * image.width,
              y: gate.region.y * image.height,
              width: gate.region.width * image.width,
              height: gate.region.height * image.height,
            };
            const [blackPercentage, whitePercentage] = await Promise.all([
              inspectBlackPixelPercentageInRegion(frame.path, region, gate.blackThreshold),
              inspectWhitePixelPercentageInRegion(frame.path, region, gate.whiteThreshold),
            ]);
            return {
              blackPercentage,
              whitePercentage,
              midtonePercentage: Math.max(0, 100 - blackPercentage - whitePercentage),
            };
          }),
        );
        const passed = samples.every(
          (sample) =>
            sample.blackPercentage <= gate.maximumBlackPercentage &&
            sample.whitePercentage <= gate.maximumWhitePercentage &&
            sample.midtonePercentage >= gate.minimumMidtonePercentage,
        );
        return {
          id: gate.id,
          status: passed ? ('pass' as const) : ('fail' as const),
          message: passed
            ? 'Declared screen region retains shadow, highlight, and midtone detail'
            : 'Declared screen region falls outside its tonal-balance contract',
          measurements: {
            region: gate.region,
            allowedMaximumBlackPercentage: gate.maximumBlackPercentage,
            allowedMaximumWhitePercentage: gate.maximumWhitePercentage,
            requiredMinimumMidtonePercentage: gate.minimumMidtonePercentage,
            samples,
          },
        };
      }
      if (gate.type === 'region-spatial-color-variation') {
        const samples = await Promise.all(
          frames.map(async (frame) => {
            const image = await inspectImage(frame.path);
            if (!image.width || !image.height) return { red: 0, green: 0, blue: 0, mean: 0 };
            return inspectNormalizedColorEntropyInRegion(frame.path, {
              x: gate.region.x * image.width,
              y: gate.region.y * image.height,
              width: gate.region.width * image.width,
              height: gate.region.height * image.height,
            });
          }),
        );
        const passed = samples.every(
          (sample) => sample.mean >= gate.minimumMeanNormalizedColorEntropy,
        );
        return {
          id: gate.id,
          status: passed ? ('pass' as const) : ('fail' as const),
          message: passed
            ? 'Declared region retains the required spatial color variation'
            : 'Declared region is too spatially flat for the color-variation contract',
          measurements: {
            region: gate.region,
            minimumMeanNormalizedColorEntropy: gate.minimumMeanNormalizedColorEntropy,
            samples,
          },
        };
      }
      const percentages = await Promise.all(
        frames.map((frame) => inspectBlackPixelPercentage(frame.path, gate.blackThreshold)),
      );
      const maximum = Math.max(...percentages);
      return {
        id: gate.id,
        status: maximum <= gate.maximumBlackPercentage ? ('pass' as const) : ('fail' as const),
        message:
          maximum <= gate.maximumBlackPercentage
            ? 'Semantic frames retain the required visible image coverage'
            : 'A semantic frame is excessively black or camera-occluded',
        measurements: {
          maximumBlackPercentage: maximum,
          allowedBlackPercentage: gate.maximumBlackPercentage,
          perFrameBlackPercentage: percentages,
        },
      };
    }),
  );
  const cameraContract = framingReport.cameraContract;
  const cameraContractPassed =
    cameraContract?.valid === true &&
    cameraContract.trackingConstraint === 'TRACK_TO' &&
    cameraContract.trackAxis === 'TRACK_NEGATIVE_Z' &&
    cameraContract.upAxis === 'UP_Y' &&
    cameraContract.interpolationImplementation === 'frame-baked-declarative-v1';
  const expectedFog = resolved.finiteFogDomain;
  const actualFog = worldReport.fog;
  const exactExplicitBoundsMatched =
    !expectedFog ||
    expectedFog.policy !== 'explicit-box-v1' ||
    (JSON.stringify(actualFog?.boundsMinimum) === JSON.stringify(expectedFog.boundsMinimum) &&
      JSON.stringify(actualFog?.boundsMaximum) === JSON.stringify(expectedFog.boundsMaximum));
  const finiteFogPassed =
    scene.atmosphere.fogDensity === 0
      ? actualFog?.enabled === false && actualFog.worldVolumeLinked === false
      : expectedFog !== undefined &&
        actualFog?.enabled === true &&
        actualFog.implementation === 'finite-mesh-volume-v1' &&
        actualFog.worldVolumeLinked === false &&
        actualFog.materialVolumeLinked === true &&
        actualFog.density === scene.atmosphere.fogDensity &&
        actualFog.derivationSha256 === expectedFog.derivationSha256 &&
        JSON.stringify(actualFog.requestedPolicy) === JSON.stringify(expectedFog.requestedPolicy) &&
        exactExplicitBoundsMatched &&
        actualFog.edgeFalloffMeters === expectedFog.edgeFalloffMeters &&
        actualFog.edgeFalloffImplementation === 'minimum-distance-smootherstep-v1' &&
        actualFog.evaluatedBounds?.allVisibleObjectsContained === true &&
        actualFog.evaluatedBounds.allSampledFramesContained === true &&
        actualFog.evaluatedBounds.cameraAndTargetContained === true &&
        actualFog.evaluatedBounds.sampledFrames?.length ===
          Math.round(scene.durationSeconds * scene.fps) &&
        Boolean(actualFog.evaluatedBounds.rendererDerivationSha256);
  const renderChecks = [
    {
      id: 'renderer-camera-contract',
      status: cameraContractPassed ? ('pass' as const) : ('fail' as const),
      message: cameraContractPassed
        ? 'Renderer camera position, semantic target, lens, and tracking contract match the declarative path'
        : 'Renderer camera does not faithfully implement the declarative position, target, lens, or tracking contract',
      measurements: cameraContract ?? {},
    },
    {
      id: 'renderer-finite-fog-domain',
      status: finiteFogPassed ? ('pass' as const) : ('fail' as const),
      message: finiteFogPassed
        ? scene.atmosphere.fogDensity > 0
          ? 'Renderer uses the exact deterministic finite tapered fog domain without a World volume'
          : 'Renderer leaves both finite and World fog disabled at zero declared density'
        : 'Renderer fog ownership, bounds, density, taper, or derivation differs from the scene contract',
      measurements: {
        expectedDensity: scene.atmosphere.fogDensity,
        expectedDomain: expectedFog,
        actualFog,
      },
    },
    ...declaredRenderChecks,
  ];
  const combinedVerification = aggregateCinematicRenderVerification(verification, renderChecks);
  const report = join(output, 'scene-render.json');
  await writeFile(
    report,
    `${JSON.stringify({ schemaVersion: 1, source, manifest, video, blend, frames, contactSheet, media, verification: combinedVerification, productionCharacterAssemblies, evidenceRefresh: options.reuseExistingPixels ? 'existing-pixels' : 'new-pixel-render', renderProfile: scene.renderProfile, deterministicEvidence: scene.renderProfile.intent === 'deterministic-final' ? { boundary: 'cycles-cpu-fixed-seed-to-lossless-png-to-single-thread-x264', expected: 'byte-identical-on-matching-runtime-and-input-fingerprint' } : { boundary: 'preview-only', expected: 'not-content-addressable' }, renderChecks, blender: { mode: options.reuseExistingPixels ? 'inspect-only' : 'render', stdout, stderr } }, null, 2)}\n`,
    'utf8',
  );
  const failedRenderChecks = renderChecks.filter((check) => check.status === 'fail');
  if (failedRenderChecks.length)
    throw new Error(
      `Cinematic render verification failed: ${failedRenderChecks.map((check) => `${check.id}: ${check.message}`).join('; ')}`,
    );
  return {
    scene: scene.id,
    output,
    manifest,
    video,
    blend,
    frames,
    contactSheet,
    report,
    media,
    verification: combinedVerification,
    productionCharacterAssemblies,
    renderChecks,
  };
}

/**
 * Renders only the scene's semantic landmarks at the authoritative declared
 * profile. This is iteration evidence, never a substitute for the complete
 * temporal render required by publication.
 */
export async function renderCinematicProbe(
  sceneFile: string,
  outputDirectory: string,
  options: { reuseExistingPixels?: boolean } = {},
) {
  const prepared = await prepareCinematicRender(sceneFile, outputDirectory);
  const { source, scene, verification, output, manifest, script, blender, blend } = prepared;
  const probePaths = scene.landmarks.map((landmark) =>
    join(
      output,
      'probe-frames',
      `${String(Math.round(landmark.progress * 100)).padStart(3, '0')}-${landmark.id}.png`,
    ),
  );
  let stdout = '';
  let stderr = '';
  if (options.reuseExistingPixels) {
    await Promise.all([
      access(blend),
      access(join(output, 'framing-report.json')),
      ...probePaths.map((path) => access(path)),
    ]).catch(() => {
      throw new Error(
        `Cannot refresh cinematic probe evidence for '${scene.id}' because its existing landmark pixels are incomplete`,
      );
    });
  } else {
    ({ stdout, stderr } = await exec(
      blender,
      ['--background', '--factory-startup', '--python', script, '--', manifest, output, 'probe'],
      { maxBuffer: 30 * 1024 * 1024 },
    ));
  }
  const productionCharacterAssemblies = JSON.parse(
    await readFile(join(output, 'production-character-assembly-report.json'), 'utf8'),
  ) as { schemaVersion: 1; sceneId: string; assemblies: unknown[] };
  const frames = await Promise.all(
    scene.landmarks.map(async (landmark, index) => {
      const path = probePaths[index]!;
      const [image, blackPercentage, whitePercentage] = await Promise.all([
        inspectImage(path),
        inspectBlackPixelPercentage(path),
        inspectWhitePixelPercentage(path),
      ]);
      return { ...landmark, path, image, blackPercentage, whitePercentage };
    }),
  );
  const contactSheet = join(output, 'contact-sheet.png');
  await createContactSheet(
    frames.map((frame) => frame.path),
    contactSheet,
    Math.min(3, frames.length),
  );
  const framingReport = JSON.parse(await readFile(join(output, 'framing-report.json'), 'utf8')) as {
    cameraContract?: { valid?: boolean };
  };
  if (framingReport.cameraContract?.valid !== true)
    throw new Error('Cinematic probe camera contract failed');
  const report = join(output, 'scene-probe.json');
  await writeFile(
    report,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        source,
        manifest,
        blend,
        frames,
        contactSheet,
        verification,
        productionCharacterAssemblies,
        renderProfile: scene.renderProfile,
        evidenceScope: 'authoritative-profile-semantic-landmarks-only',
        evidenceRefresh: options.reuseExistingPixels ? 'existing-pixels' : 'new-pixel-render',
        publicationEligible: false,
        missingPublicationEvidence: [
          'complete-frame-sequence',
          'temporal-artifact-review',
          'delivery-media',
        ],
        blender: { mode: options.reuseExistingPixels ? 'evidence-only' : 'probe', stdout, stderr },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return {
    scene: scene.id,
    output,
    manifest,
    blend,
    frames,
    contactSheet,
    report,
    verification,
    productionCharacterAssemblies,
    publicationEligible: false as const,
  };
}
