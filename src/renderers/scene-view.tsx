import React from 'react';
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { cameraCss, cameraTransform } from '../scene/camera.js';
import {
  isVisibleAt,
  sceneItemOrder,
  type BlendMode,
  type Scene,
  type SceneLayer,
} from '../scene/model.js';
import { rendererFor } from './registry.js';
import { PixiLayerView } from './pixi-layer.js';
import { isEffectBundle, resolveEffectBundle } from '../vfx/registry.js';

const blendCss: Record<BlendMode, React.CSSProperties['mixBlendMode']> = {
  normal: 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  add: 'screen',
  'soft-light': 'soft-light',
};
const filterCss = (layer: SceneLayer) =>
  layer.filters
    .map((filter) => {
      if (filter.type === 'hue-rotate') return `hue-rotate(${filter.value}deg)`;
      if (filter.type === 'glow') return `drop-shadow(0 0 ${filter.value}px currentColor)`;
      if (filter.type === 'blur') return `blur(${filter.value}px)`;
      return `${filter.type}(${filter.value})`;
    })
    .join(' ');

function maskStyle(layer: SceneLayer, assets: Record<string, string>): React.CSSProperties {
  if (!layer.mask) return {};
  if (layer.mask.type === 'rectangle')
    return {
      clipPath: `inset(${layer.mask.y}% ${100 - layer.mask.x - layer.mask.width}% ${100 - layer.mask.y - layer.mask.height}% ${layer.mask.x}%)`,
    };
  if (layer.mask.type === 'circle')
    return { clipPath: `circle(${layer.mask.radius}% at ${layer.mask.x}% ${layer.mask.y}%)` };
  const data = assets[`mask:${layer.id}`];
  return data
    ? {
        maskImage: `url(${data})`,
        maskSize: 'cover',
        maskPosition: 'center',
        maskRepeat: 'no-repeat',
        ...(layer.mask.invert ? { filter: 'invert(1)' } : {}),
      }
    : {};
}

function ReactEffect({
  layer,
  progress,
}: {
  layer: Extract<SceneLayer, { type: 'effect' }>;
  progress: number;
}) {
  const intensity = typeof layer.params.intensity === 'number' ? layer.params.intensity : 1;
  const wave = (Math.sin(progress * Math.PI * 8) + 1) / 2;
  if (layer.preset === 'vignette')
    return (
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, transparent 42%, rgba(0,0,0,${0.72 * intensity}) 112%)`,
        }}
      />
    );
  if (layer.preset === 'film-grain' || layer.preset === 'animated-grain')
    return (
      <AbsoluteFill
        style={{
          opacity: 0.08 * intensity,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='${0.72 + wave * 0.08}' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.68'/%3E%3C/svg%3E")`,
          mixBlendMode: 'soft-light',
        }}
      />
    );
  if (layer.preset === 'letterbox')
    return (
      <>
        <div
          style={{ position: 'absolute', inset: '0 0 auto', height: '7%', background: '#000' }}
        />
        <div
          style={{ position: 'absolute', inset: 'auto 0 0', height: '7%', background: '#000' }}
        />
      </>
    );
  if (layer.preset === 'flash') {
    const at = typeof layer.params.at === 'number' ? layer.params.at : 0.5;
    const opacity = interpolate(
      progress,
      [Math.max(0, at - 0.06), at, Math.min(1, at + 0.12)],
      [0, 0.82 * intensity, 0],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
    );
    return <AbsoluteFill style={{ background: '#fff', opacity, mixBlendMode: 'screen' }} />;
  }
  if (layer.preset === 'light-leak')
    return (
      <AbsoluteFill
        style={{
          opacity: (0.12 + wave * 0.08) * intensity,
          background:
            'linear-gradient(120deg, transparent 35%, rgba(255,104,35,.85) 70%, rgba(255,222,154,.65) 84%, transparent)',
          mixBlendMode: 'screen',
        }}
      />
    );
  if (layer.preset === 'haze')
    return (
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, rgba(218,224,236,${0.04 * intensity}), rgba(180,190,205,${0.16 * intensity}))`,
        }}
      />
    );
  if (['glitch', 'chromatic-aberration', 'screen-distortion'].includes(layer.preset))
    return (
      <AbsoluteFill
        style={{
          boxShadow: `${2 * intensity}px 0 rgba(255,0,70,.16) inset, ${-2 * intensity}px 0 rgba(0,220,255,.16) inset`,
          transform: `skewX(${Math.sin(progress * 30) * 0.12 * intensity}deg)`,
        }}
      />
    );
  if (['camera-shake', 'blur-pulse', 'rack-focus', 'motion-blur'].includes(layer.preset)) {
    const blur = layer.preset === 'motion-blur' ? 0.7 : wave * 2.4 * intensity;
    return (
      <AbsoluteFill
        style={{
          backdropFilter: `blur(${blur}px)`,
          boxShadow: `inset 0 0 ${8 + wave * 12}px rgba(255,255,255,${0.015 * intensity})`,
        }}
      />
    );
  }
  if (['flicker', 'exposure-flicker', 'pulse'].includes(layer.preset))
    return (
      <AbsoluteFill
        style={{
          background: '#fff4d3',
          opacity: (0.01 + wave * 0.035) * intensity,
          mixBlendMode: 'screen',
        }}
      />
    );
  if (layer.preset === 'lens-dirt')
    return (
      <AbsoluteFill
        style={{
          opacity: 0.1 * intensity,
          background:
            'radial-gradient(circle at 18% 28%, rgba(255,255,255,.3) 0 1%, transparent 4%), radial-gradient(circle at 82% 62%, rgba(255,255,255,.25) 0 2%, transparent 7%)',
          mixBlendMode: 'screen',
        }}
      />
    );
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 50%, rgba(255,255,255,${0.025 * intensity}), transparent 52%)`,
        mixBlendMode: 'screen',
      }}
    />
  );
}

function LayerContent({
  layer,
  asset,
  progress,
}: {
  layer: SceneLayer;
  asset?: string | undefined;
  progress: number;
}) {
  if (rendererFor(layer) === 'pixi-2d')
    return (
      <PixiLayerView layer={layer as Extract<SceneLayer, { type: 'particle-system' | 'effect' }>} />
    );
  if (layer.type === 'image' || layer.type === 'sprite')
    return asset ? (
      <Img
        src={asset}
        style={{
          width: layer.type === 'sprite' ? (layer.width ?? '100%') : '100%',
          height: layer.type === 'sprite' ? (layer.height ?? '100%') : '100%',
          objectFit: layer.type === 'image' ? layer.fit : 'contain',
        }}
      />
    ) : null;
  if (layer.type === 'video')
    return asset ? (
      <OffthreadVideo
        src={asset}
        muted={layer.muted}
        style={{ width: '100%', height: '100%', objectFit: layer.fit }}
      />
    ) : null;
  if (layer.type === 'text')
    return (
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          padding: '8%',
          color: layer.color,
          fontSize: layer.fontSize,
          fontWeight: layer.fontWeight,
          textAlign: layer.align,
        }}
      >
        {layer.text}
      </AbsoluteFill>
    );
  if (layer.type === 'shape') {
    const background =
      layer.shape === 'gradient'
        ? `linear-gradient(135deg, ${(layer.gradient ?? ['#111', '#555']).join(',')})`
        : layer.color;
    return (
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: layer.width,
          height: layer.height,
          transform: 'translate(-50%,-50%)',
          borderRadius: layer.shape === 'circle' ? '50%' : layer.radius,
          background,
        }}
      />
    );
  }
  return (
    <ReactEffect layer={layer as Extract<SceneLayer, { type: 'effect' }>} progress={progress} />
  );
}

export function SceneView({ scene, assets }: { scene: Scene; assets: Record<string, string> }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const seconds = frame / fps;
  const progress = frame / Math.max(1, durationInFrames - 1);
  const expandedLayers: SceneLayer[] = scene.layers.flatMap((layer) => {
    if (layer.type !== 'effect' || !isEffectBundle(layer.preset)) return [layer];
    return resolveEffectBundle(layer.preset).map((item, index) => ({
      ...layer,
      id: `${layer.id}-${item.preset}-${index}`,
      preset: item.preset,
      zIndex: layer.zIndex + index,
      params: {
        ...item.params,
        ...layer.params,
        intensity:
          item.intensity *
          (typeof layer.params.intensity === 'number' ? layer.params.intensity : 1),
      },
    }));
  });
  const effectLayers: SceneLayer[] = scene.effects.map((effect) => ({
    id: effect.id,
    type: 'effect',
    preset: effect.type,
    seed: 1,
    params: { ...effect.params, intensity: effect.intensity },
    depth: effect.depth,
    zIndex: 0,
    start: effect.start,
    ...(effect.end === undefined ? {} : { end: effect.end }),
    opacity: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    blendMode: effect.blendMode,
    filters: [],
  }));
  const layers = [...expandedLayers, ...effectLayers].sort(
    (a, b) => sceneItemOrder(a) - sceneItemOrder(b),
  );
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      {layers.map((layer) => {
        if (!isVisibleAt(layer, seconds)) return null;
        const camera =
          layer.depth === 'screen'
            ? { x: 0, y: 0, scale: 1, rotation: 0 }
            : cameraTransform(
                scene.camera.preset,
                layer.depth,
                progress,
                scene.camera.intensity,
                scene.camera.easing,
              );
        const motion = layer.motion
          ? cameraTransform(
              layer.motion.preset,
              layer.depth,
              progress,
              layer.motion.intensity,
              layer.motion.easing,
            )
          : { x: 0, y: 0, scale: 1, rotation: 0 };
        const transform = {
          x: camera.x + motion.x + layer.transform.x,
          y: camera.y + motion.y + layer.transform.y,
          scale: camera.scale * motion.scale * layer.transform.scale,
          rotation: camera.rotation + motion.rotation + layer.transform.rotation,
        };
        const atmosphericBlur =
          layer.type === 'effect' &&
          ['fog', 'low-fog', 'smoke', 'light-mist'].includes(layer.preset)
            ? `blur(${layer.preset === 'smoke' ? 42 : 30}px)`
            : undefined;
        return (
          <AbsoluteFill
            key={layer.id}
            style={{
              opacity: layer.opacity,
              mixBlendMode: blendCss[layer.blendMode],
              transform: cameraCss(transform),
              filter: filterCss(layer) || atmosphericBlur,
              ...maskStyle(layer, assets),
            }}
          >
            <LayerContent layer={layer} asset={assets[layer.id]} progress={progress} />
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
}
