import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateGeometry } from '../src/geometry/model.js';
import { createDimensionalCampaignCover } from '../src/props/cover.js';
import { createRiseOfDemonsTitleTreatment } from '../src/titles/treatment.js';
import {
  adaptEditorialTreatment,
  renderEditorialTreatment,
  verifyEditorialTreatmentAdaptation,
  verifyEditorialTreatmentRendering,
} from '../src/titles/adaptation.js';
import { resolveCormorantGaramondFont } from '../src/titles/font.js';

const nocturneAdaptation = {
  kind: 'editorial-treatment-v1' as const,
  assetId: 'editorial.nocturne-event-lockup',
  canvas: { width: 480, height: 270 },
  safeAreaMargins: { left: 0.08, top: 0.08, right: 0.08, bottom: 0.08 },
  copy: {
    eyebrow: 'LIGHT / MATTER / MEMORY',
    title: 'NOCTURNE',
    cta: '14 SEPTEMBER — 03 NOVEMBER',
  },
  palette: { background: '#02030a', foreground: '#f2f4ff', accent: '#8ebcff' },
  motifOpacity: 0.28,
  typographyScale: 1,
  metadata: { campaignFamily: 'nocturne' },
};

describe('editorial title and cover assets', () => {
  it('keeps every title element inside an explicit vertical safe area', () => {
    const treatment = createRiseOfDemonsTitleTreatment();
    expect(treatment.safeArea.left).toBeGreaterThanOrEqual(treatment.canvas.width * 0.08);
    expect(treatment.safeArea.right).toBeLessThanOrEqual(treatment.canvas.width * 0.92);
    expect(treatment.safeArea.top).toBeGreaterThanOrEqual(treatment.canvas.height * 0.08);
    expect(treatment.safeArea.bottom).toBeLessThanOrEqual(treatment.canvas.height * 0.92);
    expect(treatment.font).toMatchObject({ licence: 'OFL-1.1', weight: 600 });
  });

  it('builds a dimensional cover with a dedicated UV-mapped front material', () => {
    const cover = createDimensionalCampaignCover();
    expect(validateGeometry(cover).valid).toBe(true);
    expect(cover.metadata).toMatchObject({
      frontTexture: 'cover.png',
      textureMaterialId: 'cover-front',
    });
    expect(cover.materialGroups.map((group) => group.materialId)).toEqual([
      'cover-body',
      'cover-front',
    ]);
    expect(cover.uvs).toHaveLength(cover.positions.length);
  });

  it('derives and deterministically renders a safe, readable first-class editorial treatment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'videoer-editorial-treatment-'));
    try {
      const base = createRiseOfDemonsTitleTreatment();
      const adapted = adaptEditorialTreatment(base, nocturneAdaptation);
      expect(verifyEditorialTreatmentAdaptation(base, adapted, nocturneAdaptation)).toMatchObject({
        valid: true,
        exactTreatmentMatched: true,
        fontPreserved: true,
        motifPreserved: true,
      });
      const font = await resolveCormorantGaramondFont();
      const first = join(directory, 'first.png');
      const second = join(directory, 'second.png');
      await renderEditorialTreatment(adapted, font, first);
      await renderEditorialTreatment(adapted, font, second);
      const verification = await verifyEditorialTreatmentRendering(adapted, font, first);
      const repeated = await verifyEditorialTreatmentRendering(adapted, font, second);
      expect(verification).toMatchObject({
        valid: true,
        deterministicRenderMatched: true,
        dimensionsMatched: true,
        linesInsideSafeArea: true,
      });
      expect(verification.candidateSha256).toBe(repeated.candidateSha256);
      expect(verification.contrast.foreground).toBeGreaterThanOrEqual(4.5);
      expect(verification.contrast.accent).toBeGreaterThanOrEqual(3);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects altered pixels and copy that cannot fit the declared safe area', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'videoer-editorial-rejection-'));
    try {
      const base = createRiseOfDemonsTitleTreatment();
      const accepted = adaptEditorialTreatment(base, nocturneAdaptation);
      const overflow = adaptEditorialTreatment(base, {
        ...nocturneAdaptation,
        assetId: 'editorial.overflow-lockup',
        copy: {
          ...nocturneAdaptation.copy,
          title: 'AN EXTRAORDINARILY LONG EXHIBITION IDENTITY THAT CANNOT FIT',
        },
      });
      const font = await resolveCormorantGaramondFont();
      const candidate = join(directory, 'candidate.png');
      await renderEditorialTreatment(accepted, font, candidate);
      expect((await verifyEditorialTreatmentRendering(overflow, font, candidate)).valid).toBe(
        false,
      );
      expect(
        verifyEditorialTreatmentAdaptation(
          base,
          { ...accepted, copy: overflow.copy },
          nocturneAdaptation,
        ).valid,
      ).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
