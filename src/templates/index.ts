import type { MotionPreset } from '../domain/motion.js';
export interface StyleTemplate {
  id: 'cinematic-fantasy' | 'saas-promo';
  typography: { heading: string; body: string };
  palette: string[];
  pacing: 'measured' | 'energetic';
  defaultMotion: MotionPreset;
  transition: 'cut' | 'crossfade' | 'swipe';
  captions: 'subtle' | 'bold';
  cta: 'reveal' | 'card';
  preferredAssets: string[];
}
export const templates: Record<StyleTemplate['id'], StyleTemplate> = {
  'cinematic-fantasy': {
    id: 'cinematic-fantasy',
    typography: { heading: 'Cinzel', body: 'Inter' },
    palette: ['#080B12', '#D7B56D', '#F4EBDD'],
    pacing: 'measured',
    defaultMotion: 'push-in',
    transition: 'crossfade',
    captions: 'subtle',
    cta: 'reveal',
    preferredAssets: ['illustration', 'cover'],
  },
  'saas-promo': {
    id: 'saas-promo',
    typography: { heading: 'Inter', body: 'Inter' },
    palette: ['#10172A', '#7C5CFC', '#34D9C5', '#FFFFFF'],
    pacing: 'energetic',
    defaultMotion: 'scale-pop',
    transition: 'swipe',
    captions: 'bold',
    cta: 'card',
    preferredAssets: ['screenshot', 'logo', 'card'],
  },
};
export function resolveTemplate(id: StyleTemplate['id']) {
  return templates[id];
}
