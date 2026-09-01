import { titleTreatmentSchema } from './model.js';

export function createRiseOfDemonsTitleTreatment() {
  return titleTreatmentSchema.parse({
    schemaVersion: 1,
    id: 'material.rise-of-demons-title-treatment',
    canvas: { width: 1080, height: 1920 },
    safeArea: { left: 108, top: 154, right: 972, bottom: 1766 },
    font: {
      family: 'Cormorant Garamond',
      weight: 600,
      licence: 'OFL-1.1',
      package: '@fontsource/cormorant-garamond@5.3.0',
      nativeInstall: 'font-cormorant-garamond',
    },
    copy: {
      eyebrow: 'EVERY DOOR REMEMBERS',
      title: 'THE RISE OF DEMONS',
      cta: 'BOOK ONE OF THE DARK WAR TRILOGY',
    },
    palette: { background: '#070b14', foreground: '#eadfc5', accent: '#9f4d2e' },
    motif: { kind: 'threshold-lines', opacity: 0.28 },
  });
}
