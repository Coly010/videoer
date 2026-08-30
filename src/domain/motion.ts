export const motionPresets = [
  'push-in',
  'pull-out',
  'track-left',
  'track-right',
  'pan-up',
  'pan-down',
  'scale-pop',
  'slide-in',
  'swipe',
  'crossfade',
  'static',
] as const;
export type MotionPreset = (typeof motionPresets)[number];
