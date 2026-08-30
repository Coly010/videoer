import type { Campaign, ShotRenderMode } from '../domain/schemas.js';

export interface CinematicShotIntent {
  kind: 'scene' | 'statement' | 'cover' | 'cta' | 'screen' | 'custom';
  actionBeats?: string[];
  hasStill?: boolean;
  hasVideoReference?: boolean;
}

export function chooseShotRenderMode(
  campaign: Pick<Campaign, 'style'>,
  intent: CinematicShotIntent,
): ShotRenderMode | 'cover-reveal' | 'cta' {
  if (intent.kind === 'cta') return 'cta';
  if (intent.kind === 'cover') return 'cover-reveal';
  if (intent.kind === 'statement') return 'kinetic-text';
  if (intent.kind === 'screen') return 'screenshot';
  if (intent.hasVideoReference) return 'image-to-video';
  if (
    campaign.style === 'cinematic-fantasy' &&
    intent.kind === 'scene' &&
    (intent.actionBeats?.length ?? 0) >= 2
  )
    return 'scene-keyframes';
  if (intent.hasStill || intent.kind === 'scene') return 'image-motion';
  return 'custom';
}
