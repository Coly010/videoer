import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { verifyProductionHumanAnatomy } from '../src/characters/anatomy.js';
import { createHumanoidMannequin } from '../src/characters/mannequin.js';
import { createProductionHuman } from '../src/characters/production-human.js';
import { verifyArticulatedHands } from '../src/characters/hands.js';
import { verifyIdentityFace } from '../src/characters/face.js';
import {
  createEnglishSpeechMorphRig,
  verifyEnglishSpeechMorphRig,
} from '../src/characters/speech-rig.js';
import { createOldCityBookshop } from '../src/environments/bookshop.js';
import { extractMaterialGeometry } from '../src/geometry/extract.js';
import { measureLongDressDrapeSkinning } from '../src/clothing/drape.js';
import { validateGeometry } from '../src/geometry/model.js';
import {
  toThreeBufferGeometry,
  toThreeSkeleton,
  toThreeSkinnedMesh,
} from '../src/renderers/three-geometry.js';

describe('renderer-independent geometry and canonical humanoid', () => {
  it('generates a valid skinned humanoid with canonical joints and attachment points', () => {
    const mannequin = createHumanoidMannequin({ height: 1.74, shoulderWidth: 0.44 });
    const validation = validateGeometry(mannequin);
    expect(validation).toMatchObject({
      valid: true,
      stats: { joints: 22, skinned: true },
    });
    expect(validation.stats.vertices).toBeGreaterThan(2_000);
    expect(mannequin.skeleton.map((joint) => joint.id)).toEqual(
      expect.arrayContaining([
        'root',
        'hips',
        'spine',
        'chest',
        'neck',
        'head',
        'left-upper-arm',
        'right-upper-arm',
        'left-thigh',
        'right-thigh',
        'left-foot',
        'right-foot',
      ]),
    );
    expect(mannequin.attachments).toHaveProperty('left-hand-grip');
    expect(mannequin.attachments).toHaveProperty('gaze');
    expect(mannequin.attachments).toMatchObject({
      'left-heel-contact': { bone: 'left-foot' },
      'left-toe-contact': { bone: 'left-toe' },
      'right-heel-contact': { bone: 'right-foot' },
      'right-toe-contact': { bone: 'right-toe' },
    });
    expect(
      mannequin.skinWeights?.every(
        (weights) => weights[0] === 1 && weights[1] === 0 && weights[2] === 0 && weights[3] === 0,
      ),
    ).toBe(true);
  });

  it('refuses to classify the overlapping rigid-capsule mannequin as a production human', () => {
    const report = verifyProductionHumanAnatomy(
      createHumanoidMannequin(
        {},
        {
          skin: [0.62, 0.38, 0.27, 1],
          hair: [0.022, 0.009, 0.006, 1],
          eyes: [0.035, 0.11, 0.095, 1],
          dress: [0.012, 0.018, 0.04, 1],
          leather: [0.018, 0.014, 0.012, 1],
        },
      ),
    );
    expect(report.valid).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        'character.body-surface-disconnected',
        'character.joint-deformation-coverage',
        'character.extremity-geometry-coverage',
      ]),
    );
    expect(report.checks.ownedVertices['left-hand']).toBe(0);
    expect(report.checks.jointBlendVertices['left-upper-arm:left-forearm']).toBe(0);
  });

  it('builds a continuous project-owned body with measured joint deformation', () => {
    const human = createProductionHuman({ height: 1.72 });
    const geometryValidation = validateGeometry(human);
    expect(geometryValidation.valid, JSON.stringify(geometryValidation.issues)).toBe(true);
    const report = verifyProductionHumanAnatomy(human);
    expect(report.checks.connectedComponents).toBe(1);
    expect(report.checks.boundaryEdges).toBe(0);
    expect(report.checks.nonManifoldEdges).toBe(0);
    expect(report.checks.ownedVertices['left-hand']).toBeGreaterThanOrEqual(
      report.policy.minimumOwnedVertices,
    );
    expect(report.checks.jointBlendVertices['left-upper-arm:left-forearm']).toBeGreaterThanOrEqual(
      report.policy.minimumJointBlendVertices,
    );
    expect(report.valid, JSON.stringify(report.checks.jointBlendVertices)).toBe(true);
    const hands = verifyArticulatedHands(human);
    expect(hands.valid, JSON.stringify(hands)).toBe(true);
    expect(human.skeleton).toHaveLength(52);
    expect(hands.checks.ownedVertices['left-index-3']).toBeGreaterThanOrEqual(4);
    expect(hands.checks.flexion.left).toBeGreaterThan(0.01);
    expect(hands.checks.flexion.right).toBeGreaterThan(0.01);
    const face = verifyIdentityFace(human);
    expect(face.valid, face.issues.join(', ')).toBe(true);
    expect(human.morphTargets.map((target) => target.id)).toEqual(
      expect.arrayContaining([
        'expression-smile',
        'expression-jaw-open',
        'expression-blink-left',
        'expression-blink-right',
      ]),
    );
  }, 20_000);

  it('changes face identity continuously without changing the retargeting skeleton', () => {
    const narrow = createProductionHuman({}, undefined, {
      jawWidth: 0.8,
      eyeSpacing: 0.82,
      noseLength: 0.75,
    });
    const broad = createProductionHuman({}, undefined, {
      jawWidth: 1.25,
      eyeSpacing: 1.2,
      noseLength: 1.35,
    });
    expect(narrow.skeleton.map((joint) => joint.id)).toEqual(
      broad.skeleton.map((joint) => joint.id),
    );
    expect(narrow.metadata.faceIdentityParameters).toMatchObject({ jawWidth: 0.8 });
    expect(broad.metadata.faceIdentityParameters).toMatchObject({ jawWidth: 1.25 });
    expect(narrow.positions).not.toEqual(broad.positions);
  });

  it('keeps body parameters continuous rather than categorical', () => {
    const narrow = createHumanoidMannequin({ shoulderWidth: 0.34 });
    const wide = createHumanoidMannequin({ shoulderWidth: 0.56 });
    const extent = (positions: typeof narrow.positions) => {
      const xs = positions.map((position) => position[0]);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(extent(wide.positions)).toBeGreaterThan(extent(narrow.positions));
    expect(narrow.metadata.parameters).toMatchObject({ shoulderWidth: 0.34 });
    expect(wide.metadata.parameters).toMatchObject({ shoulderWidth: 0.56 });
  });

  it('rejects degenerate topology and non-normalized skin weights', () => {
    const mannequin = createHumanoidMannequin();
    mannequin.indices.splice(0, 3, 0, 0, 0);
    mannequin.skinWeights![4] = [0.2, 0.2, 0, 0];
    const validation = validateGeometry(mannequin);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['triangle.degenerate', 'skin.non-normalized']),
    );
  });

  it('adapts the same domain asset to Three.js geometry and skeletons', () => {
    const mannequin = createHumanoidMannequin();
    const geometry = toThreeBufferGeometry(mannequin);
    expect(geometry).toBeInstanceOf(THREE.BufferGeometry);
    expect(geometry.getAttribute('position').count).toBe(mannequin.positions.length);
    expect(geometry.getAttribute('skinWeight').itemSize).toBe(4);
    const rig = toThreeSkeleton(mannequin);
    expect(rig.roots.map((bone) => bone.name)).toEqual(['root']);
    expect(rig.bones).toHaveLength(22);
    const mesh = toThreeSkinnedMesh(mannequin);
    expect(mesh).toBeInstanceOf(THREE.SkinnedMesh);
    expect(mesh.skeleton.bones).toHaveLength(22);
  });

  it('builds a material-grouped recurring character with face, hair, and deforming wardrobe', () => {
    const character = createHumanoidMannequin(
      { height: 1.7, legLength: 0.86 },
      {
        skin: [0.62, 0.38, 0.27, 1],
        hair: [0.022, 0.009, 0.006, 1],
        eyes: [0.035, 0.11, 0.095, 1],
        dress: [0.012, 0.018, 0.04, 1],
        leather: [0.018, 0.014, 0.012, 1],
      },
    );
    expect(validateGeometry(character).valid).toBe(true);
    expect(character.id).toBe('character.cinematic-heroine');
    expect(character.materials.map((material) => material.id)).toEqual([
      'skin',
      'hair',
      'eye-white',
      'eyes',
      'mouth',
      'dress',
      'leather',
    ]);
    expect(character.materialGroups.reduce((count, group) => count + group.count, 0)).toBe(
      character.indices.length,
    );
    expect(measureLongDressDrapeSkinning(character, 'dress')).toMatchObject({ valid: true });
    expect(
      measureLongDressDrapeSkinning(character, 'dress').maximumHemNonPelvisWeight,
    ).toBeLessThanOrEqual(0.13);
    const mesh = toThreeSkinnedMesh(character);
    expect(Array.isArray(mesh.material)).toBe(true);
    expect(geometryGroupCount(mesh.geometry)).toBeGreaterThanOrEqual(5);
  });

  it('adds sparse renderer-independent visemes only to mouth geometry', () => {
    const character = createEnglishSpeechMorphRig(
      createHumanoidMannequin(
        { height: 1.7 },
        {
          skin: [0.62, 0.38, 0.27, 1],
          hair: [0.022, 0.009, 0.006, 1],
          eyes: [0.035, 0.11, 0.095, 1],
          dress: [0.012, 0.018, 0.04, 1],
          leather: [0.018, 0.014, 0.012, 1],
        },
      ),
      'character.test-speaking',
    );
    expect(verifyEnglishSpeechMorphRig(character)).toMatchObject({
      valid: true,
      checks: { mouthOnly: true, measurable: true, affectedVertices: expect.any(Number) },
    });
    expect(character.morphTargets.map((target) => target.id)).toEqual([
      'viseme-aa',
      'viseme-ee',
      'viseme-oh',
      'viseme-fv',
      'viseme-mbp',
    ]);
    const mesh = toThreeSkinnedMesh(character);
    expect(mesh.morphTargetDictionary).toMatchObject({
      'viseme-aa': 0,
      'viseme-mbp': 4,
    });
    expect(mesh.morphTargetInfluences).toHaveLength(5);
  });

  it('extracts fitted clothing without losing skinning or material topology', () => {
    const character = createHumanoidMannequin(
      {},
      {
        skin: [0.62, 0.38, 0.27, 1],
        hair: [0.022, 0.009, 0.006, 1],
        eyes: [0.035, 0.11, 0.095, 1],
        dress: [0.012, 0.018, 0.04, 1],
        leather: [0.018, 0.014, 0.012, 1],
      },
    );
    const dressSourceIndexCount = character.materialGroups
      .filter((group) => group.materialId === 'dress')
      .reduce((count, group) => count + group.count, 0);
    const dress = extractMaterialGeometry(character, ['dress'], 'clothing.test-dress');

    expect(validateGeometry(dress).valid).toBe(true);
    expect(dress.indices).toHaveLength(dressSourceIndexCount);
    expect(dress.materials.map((material) => material.id)).toEqual(['dress']);
    expect(dress.materialGroups).toEqual([
      { materialId: 'dress', start: 0, count: dressSourceIndexCount },
    ]);
    expect(dress.positions.length).toBeLessThan(character.positions.length);
    expect(dress.normals).toHaveLength(dress.positions.length);
    expect(dress.uvs).toHaveLength(dress.positions.length);
    expect(dress.skinIndices).toHaveLength(dress.positions.length);
    expect(dress.skinWeights).toHaveLength(dress.positions.length);
    expect(dress.skeleton).toEqual(character.skeleton);
    expect(Math.max(...dress.indices)).toBeLessThan(dress.positions.length);
  });

  it('builds one continuous exterior/interior bookshop coordinate system with named paths', () => {
    const environment = createOldCityBookshop();
    expect(validateGeometry(environment).valid).toBe(true);
    expect(environment.metadata).toMatchObject({
      environmentClass: 'continuous-exterior-interior-bookshop',
      deterministicSeed: 1847,
      productionFeatures: expect.arrayContaining([
        'staggered-cobble-relief',
        'opposing-street-facades',
        'distant-stepped-tower',
        'modular-facade-dressing',
        'inset-upper-window-modules',
        'projecting-eave-and-brackets',
        'wall-lantern-practicals',
        'populated-bookshop-shelves',
        'physical-eight-millimetre-window-glazing',
      ]),
      dressingInventory: expect.objectContaining({
        facadeTimber: expect.any(Number),
        skyline: expect.any(Number),
        lanterns: expect.any(Number),
        books: expect.any(Number),
      }),
    });
    expect(environment.attachments).toMatchObject({
      'door-anchor': { position: [0, 0, 0] },
      'street-path-start': expect.any(Object),
      'street-path-end': expect.any(Object),
      'threshold-interior': expect.any(Object),
      'reading-position': expect.any(Object),
      'window-gaze-target': expect.any(Object),
    });
    const exterior = environment.attachments['door-approach']!.position;
    const interior = environment.attachments['threshold-interior']!.position;
    expect(exterior[2]).toBeLessThan(0);
    expect(interior[2]).toBeGreaterThan(0);
    expect(environment.materials.map((item) => item.id)).toEqual(
      expect.arrayContaining(['wet-cobble', 'glass', 'interior-floor', 'shelf-wood']),
    );
    expect(environment.materials.map((item) => item.id)).toEqual(
      expect.arrayContaining(['wet-cobble-1', 'wet-cobble-2', 'wet-cobble-3', 'warm-window']),
    );
    expect(environment.materials.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'facade-timber',
        'lantern-glass',
        'aged-copper',
        'book-burgundy',
        'window-interior-dim',
        'window-frame-painted',
      ]),
    );
    expect(environment.materials.find((item) => item.id === 'dark-brick')?.surface?.id).toBe(
      'material.old-city-dark-brick',
    );
    expect(environment.materials.find((item) => item.id === 'wet-cobble')?.surface?.id).toBe(
      'material.wet-old-city-cobble',
    );
    expect(
      environment.materials.find((item) => item.id === 'glass')?.surface?.pattern,
    ).toMatchObject({ kind: 'architectural-glazing', thicknessMeters: 0.008, transmission: 0.94 });
    expect(
      Number((environment.metadata.dressingInventory as Record<string, number>).books),
    ).toBeGreaterThan(100);
    expect(Math.min(...environment.positions.map((position) => position[0]))).toBeLessThan(-9);
    expect(Math.max(...environment.positions.map((position) => position[1]))).toBeGreaterThan(9);
  });
});

function geometryGroupCount(geometry: THREE.BufferGeometry) {
  return geometry.groups.length;
}
