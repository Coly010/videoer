import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Composition,
  Img,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { Shot, Storyboard } from '../domain/schemas.js';
import type { StyleTemplate } from '../templates/index.js';
import { SceneView } from '../renderers/scene-view.js';

export interface VideoerCompositionProps extends Record<string, unknown> {
  storyboard: Storyboard;
  template: StyleTemplate;
  assetData: Record<string, string>;
  keyframeData: Record<
    string,
    Array<{ id: string; timeOffset: number; role: string; data: string }>
  >;
  sceneAssetData: Record<string, Record<string, string>>;
  audioData?: string;
  output: { width: number; height: number; fps: number };
}

function motionStyle(
  shot: Shot,
  frame: number,
  duration: number,
  fps: number,
): React.CSSProperties {
  const progress = frame / Math.max(1, duration - 1);
  const eased = spring({ frame, fps, config: { damping: 18, stiffness: 90 } });
  switch (shot.motion) {
    case 'push-in':
      return { transform: `scale(${interpolate(progress, [0, 1], [1, 1.12])})` };
    case 'pull-out':
      return { transform: `scale(${interpolate(progress, [0, 1], [1.12, 1])})` };
    case 'track-left':
      return { transform: `translateX(${interpolate(progress, [0, 1], [4, -4])}%) scale(1.08)` };
    case 'track-right':
      return { transform: `translateX(${interpolate(progress, [0, 1], [-4, 4])}%) scale(1.08)` };
    case 'pan-up':
      return { transform: `translateY(${interpolate(progress, [0, 1], [4, -4])}%) scale(1.08)` };
    case 'pan-down':
      return { transform: `translateY(${interpolate(progress, [0, 1], [-4, 4])}%) scale(1.08)` };
    case 'slide-in':
      return { transform: `translateX(${interpolate(eased, [0, 1], [100, 0])}%)` };
    case 'scale-pop':
      return { transform: `scale(${interpolate(eased, [0, 1], [0.72, 1])})` };
    default:
      return {};
  }
}

export function sceneKeyframeOpacity(
  seconds: number,
  index: number,
  offsets: number[],
  blend: number,
) {
  const current = offsets[index] ?? 0;
  const next = offsets[index + 1];
  const fadeIn =
    index === 0
      ? 1
      : interpolate(seconds, [Math.max(0, current - blend), current], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
  const fadeOut =
    next === undefined
      ? 1
      : interpolate(seconds, [Math.max(current, next - blend), next], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
  return Math.min(fadeIn, fadeOut);
}

function SceneKeyframesView({
  shot,
  frames,
}: {
  shot: Extract<Shot, { type: 'scene-keyframes' }>;
  frames: Array<{ timeOffset: number; data: string }>;
}) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const seconds = frame / fps;
  const blend = Math.max(1 / fps, shot.sceneMotion.blendSeconds);
  const offsets = frames.map((item) => item.timeOffset);
  const progress = frame / Math.max(1, durationInFrames - 1);
  const cameraShot = { ...shot, motion: shot.sceneMotion.camera };
  return (
    <AbsoluteFill
      style={{ ...motionStyle(cameraShot, frame, durationInFrames, fps), overflow: 'hidden' }}
    >
      {frames.map((item, index) => {
        const opacity = sceneKeyframeOpacity(seconds, index, offsets, blend);
        const parallax =
          shot.sceneMotion.blend === 'parallax-blend' || shot.sceneMotion.blend === 'depth-blend';
        const drift = parallax ? interpolate(progress, [0, 1], [index * -1.2, index * 1.2]) : 0;
        return (
          <AbsoluteFill
            key={`${item.timeOffset}-${index}`}
            style={{
              opacity,
              transform: `translateX(${drift}%) scale(${parallax ? 1.035 : 1.015})`,
            }}
          >
            <Img src={item.data} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </AbsoluteFill>
        );
      })}
      {shot.sceneMotion.atmosphere.length ? (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            opacity: 0.07 + Math.sin(frame * 0.19) * 0.015,
            background:
              'radial-gradient(circle at 50% 72%, rgba(141,112,190,.24), transparent 34%), linear-gradient(180deg, rgba(5,8,14,.03), rgba(5,8,14,.16))',
            mixBlendMode: 'screen',
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
}

function ShotView({
  shot,
  template,
  asset,
  keyframes = [],
  sceneAssets = {},
}: {
  shot: Shot;
  template: StyleTemplate;
  asset?: string;
  keyframes?: Array<{ id: string; timeOffset: number; role: string; data: string }>;
  sceneAssets?: Record<string, string>;
}) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width } = useVideoConfig();
  const fade = Math.max(1, Math.round(fps * 0.25));
  const opacity =
    shot.transition === 'cut'
      ? 1
      : interpolate(frame, [0, fade, durationInFrames - fade, durationInFrames], [0, 1, 1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
  const background = `linear-gradient(155deg, ${template.palette[0]} 5%, ${template.palette[1]} 58%, ${template.palette[2] ?? template.palette[0]} 130%)`;
  const isCta = shot.type === 'cta';
  const isCampaignEndCard = isCta && Boolean(asset);
  const isCinematic = template.id === 'cinematic-fantasy';
  const displayUrl = String(shot.metadata.displayUrl ?? '');
  const showCopy = Boolean(shot.text || shot.caption) && !(shot.type === 'cover-reveal' && asset);
  return (
    <AbsoluteFill
      style={{
        background: isCampaignEndCard ? '#05070C' : background,
        opacity,
        overflow: 'hidden',
        color: template.palette.at(-1),
        fontFamily: `${template.typography.body}, Arial, sans-serif`,
      }}
    >
      {shot.type === 'scene' ? (
        <SceneView scene={shot.scene} assets={sceneAssets} />
      ) : shot.type === 'scene-keyframes' && keyframes.length ? (
        <SceneKeyframesView shot={shot} frames={keyframes} />
      ) : asset ? (
        <AbsoluteFill
          style={
            isCampaignEndCard
              ? { alignItems: 'center', justifyContent: 'flex-start', paddingTop: '9%' }
              : { ...motionStyle(shot, frame, durationInFrames, fps), opacity: 0.72 }
          }
        >
          <Img
            src={asset}
            style={
              isCampaignEndCard
                ? {
                    width: '57%',
                    height: '57%',
                    objectFit: 'contain',
                    filter: 'drop-shadow(0 20px 30px rgba(0,0,0,.75))',
                  }
                : {
                    width: '100%',
                    height: '100%',
                    objectFit: shot.type === 'cover-reveal' ? 'contain' : 'cover',
                  }
            }
          />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill
        style={{ background: 'linear-gradient(180deg, rgba(0,0,0,.08), rgba(0,0,0,.64))' }}
      />
      {isCampaignEndCard ? (
        <AbsoluteFill
          style={{ justifyContent: 'flex-end', padding: '0 8% 7%', textAlign: 'center' }}
        >
          <div
            style={{
              fontFamily: `${template.typography.heading}, Georgia, serif`,
              fontWeight: 800,
              fontSize: width * 0.068,
              lineHeight: 1,
              letterSpacing: '.045em',
              textShadow: '0 4px 24px rgba(0,0,0,.9)',
            }}
          >
            {shot.text}
          </div>
          <div
            style={{ marginTop: width * 0.022, fontSize: width * 0.034, letterSpacing: '.08em' }}
          >
            {shot.caption}
          </div>
          <div
            style={{
              marginTop: width * 0.045,
              fontWeight: 700,
              fontSize: width * 0.037,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
            }}
          >
            {String(shot.metadata.ctaLabel ?? 'Available now')}
          </div>
          {displayUrl ? (
            <div
              style={{
                marginTop: width * 0.018,
                color: template.palette[1],
                fontWeight: 700,
                fontSize: width * 0.04,
                letterSpacing: '.04em',
              }}
            >
              {displayUrl}
            </div>
          ) : null}
        </AbsoluteFill>
      ) : showCopy && isCinematic ? (
        <AbsoluteFill
          style={{
            justifyContent: 'flex-end',
            alignItems: 'flex-start',
            padding: '0 9% 14%',
            textAlign: 'left',
          }}
        >
          <div
            style={{
              maxWidth: '84%',
              fontFamily: `${template.typography.heading}, Georgia, serif`,
              fontWeight: 600,
              fontSize: width * 0.061,
              lineHeight: 1.12,
              letterSpacing: '.015em',
              textShadow: '0 3px 18px rgba(0,0,0,.95), 0 1px 3px rgba(0,0,0,1)',
            }}
          >
            {shot.text ?? shot.caption}
          </div>
          {shot.caption && shot.caption !== shot.text ? (
            <div style={{ marginTop: width * 0.035, fontSize: width * 0.032 }}>{shot.caption}</div>
          ) : null}
        </AbsoluteFill>
      ) : showCopy ? (
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            padding: '11%',
            textAlign: 'center',
            ...motionStyle(
              asset ? { ...shot, motion: 'static' } : shot,
              frame,
              durationInFrames,
              fps,
            ),
          }}
        >
          <div
            style={{
              height: Math.max(4, width * 0.006),
              background: template.palette[1],
              marginBottom: width * 0.08,
            }}
          />
          <div
            style={{
              fontFamily: `${template.typography.heading}, Arial, sans-serif`,
              fontWeight: 800,
              fontSize: width * (isCta ? 0.085 : 0.072),
              lineHeight: 1.05,
              letterSpacing: isCta ? '.05em' : '.01em',
              textShadow: '0 4px 24px rgba(0,0,0,.65)',
            }}
          >
            {shot.text ?? shot.caption}
          </div>
          {shot.caption && shot.caption !== shot.text ? (
            <div style={{ marginTop: width * 0.05, fontSize: width * 0.035 }}>{shot.caption}</div>
          ) : null}
          <div
            style={{
              height: Math.max(4, width * 0.006),
              background: template.palette[1],
              marginTop: width * 0.08,
            }}
          />
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
}

export const VideoerCampaign: React.FC<VideoerCompositionProps> = ({
  storyboard,
  template,
  assetData,
  keyframeData,
  sceneAssetData,
  audioData,
}) => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      {audioData ? <Audio src={audioData} /> : null}
      {storyboard.shots.map((shot) => (
        <Sequence
          key={shot.id}
          from={Math.round(shot.startSeconds * fps)}
          durationInFrames={Math.round(shot.durationSeconds * fps)}
          premountFor={fps}
        >
          <ShotView
            shot={shot}
            template={template}
            {...(assetData[shot.id] ? { asset: assetData[shot.id] } : {})}
            keyframes={keyframeData[shot.id] ?? []}
            sceneAssets={sceneAssetData[shot.id] ?? {}}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

export const VideoerRoot: React.FC = () => (
  <Composition
    id="VideoerCampaign"
    component={VideoerCampaign}
    durationInFrames={30}
    fps={60}
    width={1080}
    height={1920}
    defaultProps={{
      storyboard: {
        schemaVersion: 1,
        campaignId: 'preview',
        title: 'Preview',
        durationSeconds: 1,
        style: 'saas-promo',
        shots: [
          {
            id: 'preview',
            type: 'cta',
            startSeconds: 0,
            durationSeconds: 1,
            text: 'VIDEOER',
            motion: 'static',
            transition: 'cut',
            sources: [],
            metadata: {},
            generation: { revision: 0, stale: false },
          },
        ],
      },
      template: {
        id: 'saas-promo',
        typography: { heading: 'Inter', body: 'Inter' },
        palette: ['#10172A', '#7C5CFC', '#FFFFFF'],
        pacing: 'energetic',
        defaultMotion: 'scale-pop',
        transition: 'swipe',
        captions: 'bold',
        cta: 'card',
        preferredAssets: [],
        preferredShotModes: ['screenshot'],
      },
      assetData: {},
      keyframeData: {},
      sceneAssetData: {},
      output: { width: 1080, height: 1920, fps: 60 },
    }}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.round(props.storyboard.durationSeconds * props.output.fps),
      fps: props.output.fps,
      width: props.output.width,
      height: props.output.height,
    })}
  />
);
