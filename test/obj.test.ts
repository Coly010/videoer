import { describe, expect, it } from 'vitest';
import { parseObjGeometry, parseObjGroupCentres } from '../src/geometry/obj.js';
import { validateGeometry } from '../src/geometry/model.js';

const material = {
  id: 'skin',
  baseColor: [0.5, 0.3, 0.2, 1] as [number, number, number, number],
  roughness: 0.5,
  metallic: 0,
  emission: [0, 0, 0] as [number, number, number],
  emissionStrength: 0,
};

describe('renderer-independent OBJ conversion', () => {
  it('allowlists groups, preserves UV seams, transforms coordinates, and triangulates quads', () => {
    const source = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 9 9 9
vt 0 0
vt 1 0
vt 1 1
vt 0 1
g body
f 1/1 2/2 3/3 4/4
g helper
f 1/1 2/2 5/3
`;
    const geometry = parseObjGeometry(source, {
      id: 'character.obj-fixture',
      groups: ['body'],
      materials: { skin: material },
      materialByGroup: { body: 'skin' },
      transform: ([x, y, z]) => [x * 2, y * 3, -z],
      reverseWinding: true,
    });
    expect(geometry.positions).toHaveLength(4);
    expect(geometry.indices).toHaveLength(6);
    expect(geometry.positions).toContainEqual([2, 3, -0]);
    expect(geometry.materialGroups).toEqual([{ materialId: 'skin', start: 0, count: 6 }]);
    expect(validateGeometry(geometry)).toMatchObject({ valid: true });
  });

  it('rejects a missing allowlisted face set instead of silently importing everything', () => {
    expect(() =>
      parseObjGeometry('v 0 0 0\nv 1 0 0\nv 0 1 0\ng helper\nf 1 2 3\n', {
        id: 'character.empty',
        groups: ['body'],
        materials: { skin: material },
        materialByGroup: { body: 'skin' },
      }),
    ).toThrow(/no faces in groups/u);
  });

  it('derives transformed landmark centres from referenced group geometry', () => {
    const source = `
v 0 0 0
v 2 0 0
v 2 2 0
v 0 2 0
g joint-head
f 1 2 3 4
`;
    expect(
      parseObjGroupCentres(source, ['joint-head'], ([x, y, z]) => [x * 2, y * 3, z]).get(
        'joint-head',
      ),
    ).toEqual([2, 3, 0]);
  });
});
