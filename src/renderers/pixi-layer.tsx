import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { Application, Color, Graphics } from 'pixi.js';
import { continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion';
import { particlesAt } from '../particles/engine.js';
import { resolveParticlePreset } from '../particles/presets.js';
import type { SceneLayer } from '../scene/model.js';

type PixiLayer = Extract<SceneLayer, { type: 'particle-system' | 'effect' }>;
type ParticlePreset = ReturnType<typeof resolveParticlePreset> | null;

function drawEffect(
  graphics: Graphics,
  layer: Extract<PixiLayer, { type: 'effect' }>,
  frame: number,
  width: number,
  height: number,
  fps: number,
) {
  const intensity = typeof layer.params.intensity === 'number' ? layer.params.intensity : 1;
  const time = frame / fps;
  if (['fog', 'low-fog', 'smoke', 'light-mist'].includes(layer.preset)) {
    const low = layer.preset === 'low-fog';
    const count = layer.preset === 'smoke' ? 9 : 7;
    for (let index = 0; index < count; index++) {
      const phase = index * 1.73;
      const x = (((index / count + time * (0.018 + index * 0.001)) % 1.25) - 0.12) * width;
      const y = (low ? 0.72 : 0.35) * height + Math.sin(time * 0.42 + phase) * height * 0.08;
      const radius = width * (0.25 + (index % 3) * 0.07);
      graphics.circle(x, y, radius).fill({
        color: new Color(layer.preset === 'smoke' ? '#34343c' : '#d9ddea').toNumber(),
        alpha: (low ? 0.052 : 0.032) * intensity,
      });
    }
  } else {
    const pulse = 0.5 + Math.sin(time * 1.7) * 0.18;
    const color = typeof layer.params.color === 'string' ? layer.params.color : '#9b6dff';
    graphics
      .circle(
        width * (0.5 + Math.sin(time * 0.27) * 0.08),
        height * 0.52,
        width * (0.32 + pulse * 0.08),
      )
      .fill({ color: new Color(color).toNumber(), alpha: 0.035 * intensity });
    graphics
      .circle(width * 0.5, height * 0.5, width * 0.18)
      .fill({ color: new Color(color).toNumber(), alpha: 0.045 * intensity });
  }
}

function drawLayer(
  app: Application,
  graphics: Graphics,
  layer: PixiLayer,
  preset: ParticlePreset,
  frame: number,
  width: number,
  height: number,
  fps: number,
) {
  graphics.clear();
  if (layer.type === 'effect') drawEffect(graphics, layer, frame, width, height, fps);
  else
    for (const [emitterIndex, emitter] of preset!.emitters.entries()) {
      for (const particle of particlesAt(
        emitter,
        `${layer.seed}:${emitterIndex}`,
        frame / fps,
        width,
        height,
      )) {
        const color = new Color(particle.color).toNumber();
        if (particle.shape === 'streak')
          graphics
            .rect(particle.x, particle.y, Math.max(1, particle.size * 0.22), particle.size * 2.8)
            .fill({ color, alpha: particle.opacity });
        else if (particle.shape === 'square')
          graphics
            .rect(particle.x, particle.y, particle.size, particle.size * 0.65)
            .fill({ color, alpha: particle.opacity });
        else
          graphics
            .circle(particle.x, particle.y, particle.size / 2)
            .fill({ color, alpha: particle.opacity });
      }
    }
  app.renderer.render({ container: app.stage });
}

export function PixiLayerView({ layer }: { layer: PixiLayer }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<Application | null>(null);
  const graphicsRef = useRef<Graphics | null>(null);
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const handle = useMemo(() => delayRender(`Initialise Pixi layer ${layer.id}`), [layer.id]);
  const preset = useMemo(
    () =>
      layer.type === 'particle-system' ? resolveParticlePreset(layer.preset, layer.params) : null,
    [layer],
  );

  useLayoutEffect(() => {
    let cancelled = false;
    const app = new Application();
    void app
      .init({
        canvas: canvasRef.current!,
        width,
        height,
        backgroundAlpha: 0,
        antialias: true,
        autoStart: false,
        preference: ['webgl'],
        preserveDrawingBuffer: true,
      })
      .then(() => {
        if (cancelled) {
          app.destroy();
          return;
        }
        const graphics = new Graphics();
        app.stage.addChild(graphics);
        appRef.current = app;
        graphicsRef.current = graphics;
        drawLayer(app, graphics, layer, preset, frame, width, height, fps);
        continueRender(handle);
      })
      .catch((error: unknown) => {
        continueRender(handle);
        throw new Error(
          `Pixi renderer unavailable for layer '${layer.id}': ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    return () => {
      cancelled = true;
      if (appRef.current) appRef.current.destroy();
      appRef.current = null;
      graphicsRef.current = null;
    };
  }, [handle, height, layer.id, width]);

  useLayoutEffect(() => {
    const app = appRef.current;
    const graphics = graphicsRef.current;
    if (!app || !graphics) return;
    drawLayer(app, graphics, layer, preset, frame, width, height, fps);
  }, [frame, fps, height, layer, preset, width]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
}
