import type { Campaign } from '../domain/schemas.js';
import type { RenderRevision } from '../domain/state.js';
import { inspectVideo } from '../media/inspection.js';
import { aggregateChecks, type VerificationCheck } from './model.js';

interface Stream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  duration?: string;
}
interface Probe {
  streams?: Stream[];
  format?: { duration?: string; size?: string; format_name?: string };
}

function rate(value?: string) {
  if (!value) return undefined;
  const [a, b] = value.split('/').map(Number);
  return b ? a! / b : a;
}

export async function verifyVideo(path: string, campaign: Campaign, revision?: RenderRevision) {
  let probe: Probe;
  try {
    probe = (await inspectVideo(path)) as Probe;
  } catch (error) {
    return aggregateChecks([
      {
        id: 'video.probe',
        status: 'fail',
        path,
        message: error instanceof Error ? error.message : String(error),
        remediation: 'Install the documented FFmpeg build or rerender the video',
      },
    ]);
  }
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');
  const duration = Number(probe.format?.duration ?? video?.duration);
  const fps = rate(video?.avg_frame_rate);
  const aspect = video?.width && video.height ? video.width / video.height : undefined;
  const expectedAspect = campaign.output.width / campaign.output.height;
  const checks: VerificationCheck[] = [
    { id: 'video.probe', status: 'pass', path, message: 'Video container is readable' },
    {
      id: 'video.duration',
      status:
        Math.abs(duration - campaign.durationSeconds) <= Math.max(0.1, 1 / campaign.output.fps)
          ? 'pass'
          : 'fail',
      path,
      expected: campaign.durationSeconds,
      actual: duration,
      message: 'Video duration matches campaign',
    },
    {
      id: 'video.width',
      status:
        video?.width === campaign.output.width ||
        (revision?.kind === 'draft' && (video?.width ?? Infinity) <= campaign.output.width)
          ? 'pass'
          : 'fail',
      path,
      expected: revision?.kind === 'draft' ? `<= ${campaign.output.width}` : campaign.output.width,
      actual: video?.width,
      message: 'Video width matches render lifecycle requirement',
    },
    {
      id: 'video.height',
      status:
        video?.height === campaign.output.height ||
        (revision?.kind === 'draft' && (video?.height ?? Infinity) <= campaign.output.height)
          ? 'pass'
          : 'fail',
      path,
      expected:
        revision?.kind === 'draft' ? `<= ${campaign.output.height}` : campaign.output.height,
      actual: video?.height,
      message: 'Video height matches render lifecycle requirement',
    },
    {
      id: 'video.aspect-ratio',
      status: aspect !== undefined && Math.abs(aspect - expectedAspect) < 0.001 ? 'pass' : 'fail',
      path,
      expected: expectedAspect,
      actual: aspect,
      message: 'Video aspect ratio matches campaign',
    },
    {
      id: 'video.fps',
      status: fps !== undefined && Math.abs(fps - campaign.output.fps) < 0.01 ? 'pass' : 'fail',
      path,
      expected: campaign.output.fps,
      actual: fps,
      message: 'Video frame rate matches campaign',
    },
    {
      id: 'video.codec',
      status: video?.codec_name === 'h264' ? 'pass' : 'fail',
      path,
      expected: 'h264',
      actual: video?.codec_name,
      message: 'Video uses H.264 delivery codec',
    },
    {
      id: 'video.size',
      status: Number(probe.format?.size) > 1024 ? 'pass' : 'fail',
      path,
      expected: '> 1024',
      actual: Number(probe.format?.size),
      message: 'Video output is non-empty',
    },
    {
      id: 'video.audio',
      status: audio ? 'pass' : 'warning',
      path,
      actual: audio?.codec_name ?? 'absent',
      message: audio ? 'Audio stream is present' : 'Video has no audio stream',
      ...(!audio
        ? {
            remediation:
              'Generate or import audio before final delivery if the campaign requires it',
          }
        : {}),
    },
    {
      id: 'video.render-state',
      status: revision ? 'pass' : 'fail',
      path,
      actual: revision?.id,
      message: revision
        ? 'Render has persisted revision metadata'
        : 'Render is missing revision metadata',
    },
  ];
  return aggregateChecks(checks);
}
