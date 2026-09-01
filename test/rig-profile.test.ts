import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createProductionTemplateHuman } from '../src/characters/production-template.js';
import {
  loadProductionRigProfile,
  verifyProductionRigProfileSkeleton,
} from '../src/characters/rig-profile.js';

describe('MPFB Rigify production backend profile', () => {
  it('maps the complete canonical production skeleton without leaking into campaign data', async () => {
    const [profile, source, weights] = await Promise.all([
      loadProductionRigProfile('assets/rig-profiles/mpfb-rigify-human-toes-v1.json'),
      readFile('assets/character-bases/makehuman-hm08/base.obj', 'utf8'),
      readFile('assets/character-bases/makehuman-hm08/default_weights.mhw', 'utf8'),
    ]);
    const character = createProductionTemplateHuman(source, weights);
    const verification = verifyProductionRigProfileSkeleton(profile, character.skeleton);
    expect(profile.status).toBe('experimental');
    expect(profile.source).toMatchObject({
      commit: '437dd513888a92399d1d3200d2e80859fae55abc',
      codeLicence: 'GPL-3.0-or-later',
      assetLicence: 'CC0-1.0',
    });
    expect(profile.transfer).toMatchObject({
      mode: 'canonical-world-to-rigify-controls-v1',
      legTransfer: 'rigify-ik-snap-contact-solve-no-stretch',
      coordinateConversion: {
        backend: 'mpfb-blender-x-left-z-up-forward-negative-y',
      },
    });
    expect(verification.valid).toBe(true);
    expect(verification.checks).toEqual({
      skeletonJoints: 52,
      mappedJoints: 52,
      uniqueControls: 52,
    });
  });
});
