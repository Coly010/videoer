import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { Campaign, Storyboard } from '../domain/schemas.js';
import { resolveTemplate } from '../templates/index.js';
import type { VideoerCompositionProps } from './video.js';
import { validateStoryboardScenes } from '../scene/validation.js';

export interface RenderPlan {
  campaign: Campaign;
  storyboard: Storyboard;
  campaignFile: string;
  template: ReturnType<typeof resolveTemplate>;
  requiresGeneration: false;
}

export interface RenderOptions {
  outputPath: string;
  draft?: boolean;
  frameRange?: [number, number];
  onProgress?: (progress: number) => void;
}

export interface RenderOutput {
  path: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  shots: number;
  kind: 'draft' | 'final';
}

export class RendererError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RendererError';
  }
}

export function createRenderPlan(
  campaign: Campaign,
  storyboard: Storyboard,
  campaignFile: string,
): RenderPlan {
  if (campaign.id !== storyboard.campaignId)
    throw new RendererError('Storyboard campaign ID does not match campaign');
  if (campaign.style !== storyboard.style)
    throw new RendererError('Storyboard style does not match campaign style');
  return {
    campaign,
    storyboard,
    campaignFile: resolve(campaignFile),
    template: resolveTemplate(storyboard.style),
    requiresGeneration: false,
  };
}

function mime(path: string) {
  if (path.endsWith('.mp4')) return 'video/mp4';
  if (path.endsWith('.webm')) return 'video/webm';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function compositionProps(
  plan: RenderPlan,
  draft: boolean,
): Promise<VideoerCompositionProps> {
  const root = dirname(plan.campaignFile);
  const assetData: Record<string, string> = {};
  const keyframeData: VideoerCompositionProps['keyframeData'] = {};
  const sceneAssetData: VideoerCompositionProps['sceneAssetData'] = {};
  for (const shot of plan.storyboard.shots) {
    if (shot.type === 'scene') {
      sceneAssetData[shot.id] = {};
      for (const layer of shot.scene.layers) {
        if ('asset' in layer) {
          const path = resolve(root, layer.asset);
          try {
            const data = await readFile(path);
            sceneAssetData[shot.id]![layer.id] =
              `data:${mime(path)};base64,${data.toString('base64')}`;
          } catch (error) {
            throw new RendererError(
              `Campaign '${plan.campaign.id}', shot '${shot.id}', layer '${layer.id}', renderer 'asset-loader': ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }
        }
        if (layer.mask?.type === 'asset') {
          const path = resolve(root, layer.mask.asset);
          try {
            const data = await readFile(path);
            sceneAssetData[shot.id]![`mask:${layer.id}`] =
              `data:${mime(path)};base64,${data.toString('base64')}`;
          } catch (error) {
            throw new RendererError(
              `Campaign '${plan.campaign.id}', shot '${shot.id}', mask '${layer.id}', renderer 'mask-loader': ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }
        }
      }
      continue;
    }
    if (shot.type === 'scene-keyframes') {
      keyframeData[shot.id] = await Promise.all(
        shot.keyframes
          .filter((keyframe) => keyframe.assetPath)
          .map(async (keyframe) => {
            const path = resolve(root, keyframe.assetPath!);
            const data = await readFile(path);
            return {
              id: keyframe.id,
              timeOffset: keyframe.timeOffset,
              role: keyframe.role,
              data: `data:${mime(path)};base64,${data.toString('base64')}`,
            };
          }),
      );
      continue;
    }
    const source = shot.sources.find((candidate) => candidate.path)?.path;
    if (!source) continue;
    const path = resolve(root, source);
    const data = await readFile(path);
    assetData[shot.id] = `data:${mime(path)};base64,${data.toString('base64')}`;
  }
  let audioData: string | undefined;
  const soundtrack = plan.campaign.assets.soundtrack;
  if (soundtrack) {
    const audioPath = resolve(root, soundtrack);
    const audio = await readFile(audioPath);
    audioData = `data:audio/wav;base64,${audio.toString('base64')}`;
  }
  const requested = plan.campaign.output;
  const width = draft ? Math.min(requested.width, 540) : requested.width;
  return {
    storyboard: plan.storyboard,
    template: plan.template,
    assetData,
    keyframeData,
    sceneAssetData,
    ...(audioData ? { audioData } : {}),
    output: {
      width,
      height: Math.round((width / requested.width) * requested.height),
      fps: requested.fps,
    },
  };
}

let bundled: Promise<string> | undefined;
function serveUrl() {
  bundled ??= bundle({
    entryPoint: resolve(dirname(new URL(import.meta.url).pathname), 'entry.js'),
  });
  return bundled;
}

export async function render(plan: RenderPlan, options: RenderOptions): Promise<RenderOutput> {
  const kind = options.draft ? 'draft' : 'final';
  const sceneValidation = await validateStoryboardScenes(plan.storyboard, plan.campaignFile);
  if (!sceneValidation.valid) {
    const issue = sceneValidation.issues[0]!;
    throw new RendererError(
      `Campaign '${plan.campaign.id}', shot '${issue.shotId}', layer/effect '${issue.itemId}', renderer '${issue.renderer}': ${issue.cause}`,
    );
  }
  const inputProps = await compositionProps(plan, options.draft ?? false);
  try {
    const url = await serveUrl();
    const composition = await selectComposition({
      serveUrl: url,
      id: 'VideoerCampaign',
      inputProps,
    });
    await renderMedia({
      serveUrl: url,
      composition,
      codec: 'h264',
      audioCodec: 'aac',
      // Final renders are source masters that will commonly be transcoded again by
      // delivery platforms. Avoid a lossy JPEG intermediate and leave ample quality
      // headroom for that subsequent encode. Drafts retain the faster defaults.
      ...(options.draft
        ? {}
        : {
            imageFormat: 'png' as const,
            crf: 15,
            x264Preset: 'slow' as const,
            pixelFormat: 'yuv420p' as const,
          }),
      outputLocation: options.outputPath,
      ...(options.frameRange ? { frameRange: options.frameRange } : {}),
      inputProps,
      chromiumOptions: { enableMultiProcessOnLinux: true, gl: 'angle' },
      onProgress: ({ progress }) => options.onProgress?.(progress),
    });
  } catch (error) {
    throw new RendererError(
      `Could not render ${kind} video: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return {
    path: options.outputPath,
    ...inputProps.output,
    durationSeconds: plan.storyboard.durationSeconds,
    shots: plan.storyboard.shots.length,
    kind,
  };
}
