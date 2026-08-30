import React from 'react';
import {
  AbsoluteFill,
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

export interface VideoerCompositionProps extends Record<string, unknown> {
  storyboard: Storyboard;
  template: StyleTemplate;
  assetData: Record<string, string>;
  output: { width: number; height: number; fps: number };
}

function motionStyle(shot: Shot, frame: number, duration: number, fps: number): React.CSSProperties {
  const progress = frame / Math.max(1, duration - 1);
  const eased = spring({ frame, fps, config: { damping: 18, stiffness: 90 } });
  switch (shot.motion) {
    case 'push-in': return { transform: `scale(${interpolate(progress, [0, 1], [1, 1.12])})` };
    case 'pull-out': return { transform: `scale(${interpolate(progress, [0, 1], [1.12, 1])})` };
    case 'track-left': return { transform: `translateX(${interpolate(progress, [0, 1], [4, -4])}%) scale(1.08)` };
    case 'track-right': return { transform: `translateX(${interpolate(progress, [0, 1], [-4, 4])}%) scale(1.08)` };
    case 'pan-up': return { transform: `translateY(${interpolate(progress, [0, 1], [4, -4])}%) scale(1.08)` };
    case 'pan-down': return { transform: `translateY(${interpolate(progress, [0, 1], [-4, 4])}%) scale(1.08)` };
    case 'slide-in': return { transform: `translateX(${interpolate(eased, [0, 1], [100, 0])}%)` };
    case 'scale-pop': return { transform: `scale(${interpolate(eased, [0, 1], [0.72, 1])})` };
    default: return {};
  }
}

function ShotView({ shot, template, asset }: { shot: Shot; template: StyleTemplate; asset?: string }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width } = useVideoConfig();
  const fade = Math.max(1, Math.round(fps * .25));
  const opacity = shot.transition === 'cut' ? 1 : interpolate(frame, [0, fade, durationInFrames - fade, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const background = `linear-gradient(155deg, ${template.palette[0]} 5%, ${template.palette[1]} 58%, ${template.palette[2] ?? template.palette[0]} 130%)`;
  const isCta = shot.type === 'cta';
  const showCopy = !(shot.type === 'cover-reveal' && asset);
  return <AbsoluteFill style={{ background, opacity, overflow: 'hidden', color: template.palette.at(-1), fontFamily: `${template.typography.body}, Arial, sans-serif` }}>
    {asset ? <AbsoluteFill style={{ ...motionStyle(shot, frame, durationInFrames, fps), opacity: .72 }}><Img src={asset} style={{ width: '100%', height: '100%', objectFit: shot.type === 'cover-reveal' ? 'contain' : 'cover' }} /></AbsoluteFill> : null}
    <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,.08), rgba(0,0,0,.64))' }} />
    {showCopy ? <AbsoluteFill style={{ justifyContent: 'center', padding: '11%', textAlign: 'center', ...motionStyle(asset ? { ...shot, motion: 'static' } : shot, frame, durationInFrames, fps) }}>
      <div style={{ height: Math.max(4, width * .006), background: template.palette[1], marginBottom: width * .08 }} />
      <div style={{ fontFamily: `${template.typography.heading}, Arial, sans-serif`, fontWeight: 800, fontSize: width * (isCta ? .085 : .072), lineHeight: 1.05, letterSpacing: isCta ? '.05em' : '.01em', textShadow: '0 4px 24px rgba(0,0,0,.65)' }}>{shot.text ?? shot.caption ?? shot.id}</div>
      {shot.caption && shot.caption !== shot.text ? <div style={{ marginTop: width * .05, fontSize: width * .035 }}>{shot.caption}</div> : null}
      <div style={{ height: Math.max(4, width * .006), background: template.palette[1], marginTop: width * .08 }} />
    </AbsoluteFill> : null}
  </AbsoluteFill>;
}

export const VideoerCampaign: React.FC<VideoerCompositionProps> = ({ storyboard, template, assetData }) => {
  const { fps } = useVideoConfig();
  return <AbsoluteFill>{storyboard.shots.map((shot) => <Sequence key={shot.id} from={Math.round(shot.startSeconds * fps)} durationInFrames={Math.round(shot.durationSeconds * fps)} premountFor={fps}><ShotView shot={shot} template={template} {...(assetData[shot.id] ? { asset: assetData[shot.id] } : {})} /></Sequence>)}</AbsoluteFill>;
};

export const VideoerRoot: React.FC = () => <Composition
  id="VideoerCampaign"
  component={VideoerCampaign}
  durationInFrames={30}
  fps={30}
  width={1080}
  height={1920}
  defaultProps={{ storyboard: { schemaVersion: 1, campaignId: 'preview', title: 'Preview', durationSeconds: 1, style: 'saas-promo', shots: [{ id: 'preview', type: 'cta', startSeconds: 0, durationSeconds: 1, text: 'VIDEOER', motion: 'static', transition: 'cut', sources: [], metadata: {}, generation: { revision: 0, stale: false } }] }, template: { id: 'saas-promo', typography: { heading: 'Inter', body: 'Inter' }, palette: ['#10172A','#7C5CFC','#FFFFFF'], pacing: 'energetic', defaultMotion: 'scale-pop', transition: 'swipe', captions: 'bold', cta: 'card', preferredAssets: [] }, assetData: {}, output: { width: 1080, height: 1920, fps: 30 } }}
  calculateMetadata={({ props }) => ({ durationInFrames: Math.round(props.storyboard.durationSeconds * props.output.fps), fps: props.output.fps, width: props.output.width, height: props.output.height })}
/>;
