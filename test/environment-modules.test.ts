import { describe, expect, it } from 'vitest';
import {
  insetWindowParts,
  projectingEaveParts,
  wallWithRectangularOpeningsParts,
} from '../src/environments/architectural-modules.js';
import {
  boxPart,
  extrudedConvexPolygonPart,
  mergeMeshParts,
  openHalfRoundTroughPart,
  rectangularFrustumPart,
  sweptTubePart,
} from '../src/geometry/primitives.js';
import { validateGeometry, type GeometryAsset } from '../src/geometry/model.js';
import { surfaceOfRevolutionPart } from '../src/geometry/primitives.js';
import {
  createMarketWorldFamily,
  createPottedVegetationFamily,
  createStreetStorageFamily,
  createWorkshopWorldFamily,
  layoutDressingFamily,
} from '../src/environments/dressing-family.js';
import { createSlattedStorageCrate, createStorageBarrel } from '../src/props/street-storage.js';
import { createInsetArchitecturalWindow, insetWindowOpening } from '../src/props/inset-window.js';
import { hostWallApertureIsOpen } from '../src/application/architectural-window-acceptance.js';
import { createArchitecturalRainwaterSystem } from '../src/props/rainwater-system.js';
import { rainwaterTroughIsOpen } from '../src/application/architectural-rainwater-acceptance.js';
import { createProjectingHangingSign } from '../src/props/projecting-sign.js';
import { projectingSignHasTwoPhysicalContentFaces } from '../src/application/projecting-sign-acceptance.js';
import { createProjectingSupportedCanopy } from '../src/props/projecting-canopy.js';
import { canopySlateComponentCount } from '../src/application/projecting-canopy-acceptance.js';
import {
  createTriangleSurfaceQuery,
  surfaceAlignedEuler,
} from '../src/environments/surface-query.js';
import { createPottedFern, createPottedShrub } from '../src/props/potted-vegetation.js';
import {
  createModularMarketStall,
  createProduceBasket,
  createTiedProvisionSack,
} from '../src/props/market-stall.js';
import {
  createFreestandingToolBoard,
  createJoinersWorkbench,
  createRollingPartsCabinet,
} from '../src/props/workshop.js';

describe('reusable architectural environment modules', () => {
  it('builds a genuinely open, thick-walled half-round gutter rather than a capped tube', () => {
    const trough = openHalfRoundTroughPart({
      minimumX: -2,
      maximumX: 2,
      centreY: 4,
      centreZ: -0.2,
      outerRadius: 0.12,
      thickness: 0.008,
      arcSegments: 16,
      bone: 0,
      materialId: 'metal',
    });
    expect(trough.positions).toHaveLength(trough.normals.length);
    expect(trough.indices.length).toBeGreaterThan(16 * 12);
    expect(Math.min(...trough.positions.map((position) => position[1]))).toBeCloseTo(3.88, 6);
    expect(Math.max(...trough.positions.map((position) => position[1]))).toBeCloseTo(4, 6);
    const topTriangles = [];
    for (let index = 0; index < trough.indices.length; index += 3)
      topTriangles.push(
        trough.indices.slice(index, index + 3).map((vertex) => trough.positions[vertex]!),
      );
    expect(
      topTriangles.some((triangle) => {
        const allOnTop = triangle.every((position) => Math.abs(position[1] - 4) < 1e-8);
        const z = triangle.map((position) => position[2]);
        return allOnTop && Math.min(...z) < -0.25 && Math.max(...z) > -0.15;
      }),
    ).toBe(false);
    expect(() =>
      openHalfRoundTroughPart({
        minimumX: 1,
        maximumX: 0,
        centreY: 0,
        centreZ: 0,
        outerRadius: 0.1,
        thickness: 0.01,
        bone: 0,
      }),
    ).toThrow(/positive extent/);
  });

  it('creates a portable configurable rainwater system with real mount and water-path contracts', () => {
    const right = createArchitecturalRainwaterSystem({ outletSide: 'right' });
    const left = createArchitecturalRainwaterSystem({ outletSide: 'left' });
    expect(validateGeometry(right).valid).toBe(true);
    expect(validateGeometry(left).valid).toBe(true);
    expect(right.metadata.hostContract).toMatchObject({
      kind: 'facade-eave-span',
      requiresContinuousMountingSurface: true,
    });
    expect(right.metadata.waterPath).toMatchObject({ gutterOpenTop: true, outletSide: 'right' });
    expect(left.attachments['downpipe-outlet']!.position[0]).toBeLessThan(0);
    expect(right.attachments['downpipe-outlet']!.position[0]).toBeGreaterThan(0);
    expect(right.attachments['eave-left']).toBeDefined();
    expect(right.attachments['wall-mount-upper']).toBeDefined();
    expect(right.materials[0]?.surface).toMatchObject({ metallic: 0.72 });
    expect(right.materials[0]?.surface?.weathering?.verticalStreaks).toBeDefined();
    expect(rainwaterTroughIsOpen(right)).toBe(true);
    const closed = structuredClone(right);
    const start = closed.positions.length;
    closed.positions.push([-2, 4.2, -0.3], [2, 4.2, -0.04], [0, 4.2, -0.17]);
    closed.indices.push(start, start + 1, start + 2);
    expect(rainwaterTroughIsOpen(closed)).toBe(false);
  });

  it('builds a reusable tapered architectural housing with valid closed geometry', () => {
    const hopper = rectangularFrustumPart(0, -0.2, 1, 1.4, [0.08, 0.06], [0.16, 0.14], 0, 'metal');
    expect(hopper.positions).toHaveLength(24);
    expect(hopper.indices).toHaveLength(36);
    expect(hopper.positions).toHaveLength(hopper.normals.length);
    expect(() => rectangularFrustumPart(0, 0, 2, 1, [0.1, 0.1], [0.2, 0.2], 0)).toThrow(
      /positive extent/,
    );
  });

  it('sweeps open and closed renderer-independent tubes for brackets and chain loops', () => {
    const bracket = sweptTubePart({
      points: [
        [0, 0, 0],
        [0, 0.3, -0.2],
        [0, 0.45, -0.65],
      ],
      radius: 0.02,
      bone: 0,
      materialId: 'iron',
    });
    const loop = sweptTubePart({
      points: [
        [-0.04, 0, 0],
        [0, 0.08, 0],
        [0.04, 0, 0],
        [0, -0.08, 0],
      ],
      radius: 0.006,
      bone: 0,
      closed: true,
      referenceAxis: [0, 0, 1],
    });
    expect(bracket.indices.length).toBeGreaterThan(loop.indices.length * 0.4);
    expect(bracket.positions).toHaveLength(bracket.normals.length);
    expect(loop.positions).toHaveLength(loop.normals.length);
    expect(() =>
      sweptTubePart({
        points: [
          [0, 0, 0],
          [0, 0, 0],
        ],
        radius: 0.02,
        bone: 0,
      }),
    ).toThrow(/duplicate/);
  });

  it('creates a two-sided portable hanging sign with independent content and facade contracts', () => {
    const sign = createProjectingHangingSign();
    expect(validateGeometry(sign).valid).toBe(true);
    expect(sign.metadata.hostContract).toMatchObject({ kind: 'vertical-facade-mount' });
    expect(sign.metadata.contentContract).toMatchObject({
      kind: 'replaceable-two-sided-sign-face',
      campaignMayReplaceFaceTreatment: true,
      hardwareMustRemainIndependent: true,
    });
    for (const attachment of [
      'wall-mount',
      'hanging-pivot-left',
      'hanging-pivot-right',
      'sign-face-front',
      'sign-face-back',
      'content-centre',
    ])
      expect(sign.attachments[attachment]).toBeDefined();
    expect(new Set(sign.materialGroups.map((group) => group.materialId))).toEqual(
      new Set(['aged-sign-iron', 'weathered-sign-board', 'sign-emblem-page', 'aged-sign-gold']),
    );
    expect(projectingSignHasTwoPhysicalContentFaces(sign)).toBe(true);
    const oneSided = structuredClone(sign);
    oneSided.materialGroups = oneSided.materialGroups.filter(
      (group, index) =>
        group.materialId !== 'sign-emblem-page' ||
        index ===
          oneSided.materialGroups.findIndex(
            (candidate) => candidate.materialId === 'sign-emblem-page',
          ),
    );
    expect(projectingSignHasTwoPhysicalContentFaces(oneSided)).toBe(false);
  });

  it('extrudes reusable convex roof and beam profiles while rejecting concave sections', () => {
    const wedge = extrudedConvexPolygonPart({
      minimumX: -2,
      maximumX: 2,
      crossSectionYZ: [
        [0, 0],
        [0.12, 0],
        [-0.08, -1],
        [-0.16, -1],
      ],
      bone: 0,
      materialId: 'roof',
    });
    expect(wedge.positions).toHaveLength(wedge.normals.length);
    expect(Math.min(...wedge.positions.map((position) => position[2]))).toBe(-1);
    expect(() =>
      extrudedConvexPolygonPart({
        minimumX: -1,
        maximumX: 1,
        crossSectionYZ: [
          [0, 0],
          [1, 0],
          [0.4, 0.4],
          [1, 1],
          [0, 1],
        ],
        bone: 0,
      }),
    ).toThrow(/convex/);
  });

  it('creates a layered sloped canopy with explicit drainage, supports, and composition anchors', () => {
    const canopy = createProjectingSupportedCanopy();
    expect(validateGeometry(canopy).valid).toBe(true);
    expect(canopy.metadata.hostContract).toMatchObject({ kind: 'vertical-facade-canopy-mount' });
    expect(canopy.metadata.roofDrainage).toMatchObject({
      kind: 'single-fall-projecting-roof',
      dischargeEdge: 'front',
    });
    expect(canopy.metadata.construction).toMatchObject({
      layeredRoof: true,
      soffitSlatCount: 7,
      roofTileRows: 4,
      bracketCount: 3,
    });
    expect(
      (canopy.metadata.construction as { roofTileCount: number }).roofTileCount,
    ).toBeGreaterThanOrEqual(48);
    expect(canopySlateComponentCount(canopy)).toBe(
      (canopy.metadata.construction as { roofTileCount: number }).roofTileCount + 1,
    );
    for (const attachment of [
      'wall-mount-left',
      'wall-mount-centre',
      'wall-mount-right',
      'rainwater-mount-left',
      'rainwater-mount-right',
      'underside-practical-left',
      'underside-practical-right',
    ])
      expect(canopy.attachments[attachment]).toBeDefined();
    expect(new Set(canopy.materialGroups.map((group) => group.materialId))).toEqual(
      new Set(['canopy-timber', 'canopy-slate', 'canopy-iron', 'canopy-flashing']),
    );
    expect(() => createProjectingSupportedCanopy({ roofFallMeters: 0.01 })).toThrow(/roof fall/);
  });
  it('proves a declared host aperture is physically clear and detects an opaque host wall', () => {
    const opening = {
      id: 'window',
      minimumX: -0.64,
      maximumX: 0.64,
      minimumY: 1.42,
      maximumY: 2.38,
    };
    const aperture = mergeMeshParts(
      'environment.aperture-witness',
      wallWithRectangularOpeningsParts({
        minimumX: -3,
        maximumX: 3,
        minimumY: 0,
        maximumY: 4,
        frontZ: 0,
        backZ: 0.3,
        materialId: 'host-wall',
        openings: [opening],
      }),
      [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
      {},
    );
    aperture.materials = [
      {
        id: 'host-wall',
        baseColor: [0.2, 0.2, 0.2, 1],
        roughness: 0.7,
        metallic: 0,
        emission: [0, 0, 0],
        emissionStrength: 0,
      },
    ];
    expect(hostWallApertureIsOpen(aperture, opening, 0.3)).toBe(true);

    const opaque = mergeMeshParts(
      'environment.opaque-wall-witness',
      [boxPart([-3, 0, 0], [3, 4, 0.3], 0, 'host-wall')],
      [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
      {},
    );
    opaque.materials = aperture.materials;
    expect(hostWallApertureIsOpen(opaque, opening, 0.3)).toBe(false);
  });
  it('builds a recessed framed window with glass, backing, mullions, and a projecting sill', () => {
    const parts = insetWindowParts({
      minimumX: -0.7,
      maximumX: 0.7,
      minimumY: 1.2,
      maximumY: 2.4,
      facadeFrontZ: -0.18,
      facadeBackZ: 0.12,
      frameMaterialId: 'frame',
      glassMaterialId: 'glass',
      interiorMaterialId: 'interior',
      glazingThicknessMeters: 0.008,
      mullions: 'cross',
    });
    expect(parts.map((part) => part.materialId)).toEqual(
      expect.arrayContaining(['frame', 'glass', 'interior']),
    );
    expect(parts).toHaveLength(9);
    const geometry = mergeMeshParts(
      'fixture.inset-window',
      parts,
      [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
      {},
    );
    geometry.materials = ['frame', 'glass', 'interior'].map((id) => ({
      id,
      baseColor: [0.2, 0.2, 0.2, 1] as [number, number, number, number],
      metallic: 0,
      roughness: 0.5,
      emission: [0, 0, 0] as [number, number, number],
      emissionStrength: 0,
    }));
    expect(validateGeometry(geometry).valid).toBe(true);
    expect(Math.min(...geometry.positions.map((position) => position[2]))).toBeLessThan(-0.18);
    expect(Math.max(...geometry.positions.map((position) => position[2]))).toBeGreaterThan(0.12);
    const glass = parts.find((part) => part.materialId === 'glass')!;
    const glassDepth =
      Math.max(...glass.positions.map((position) => position[2])) -
      Math.min(...glass.positions.map((position) => position[2]));
    expect(glassDepth).toBeCloseTo(0.008, 6);
    expect(() =>
      insetWindowParts({
        minimumX: -0.7,
        maximumX: 0.7,
        minimumY: 1.2,
        maximumY: 2.4,
        facadeFrontZ: -0.18,
        facadeBackZ: 0.12,
        frameMaterialId: 'frame',
        glassMaterialId: 'glass',
        interiorMaterialId: 'interior',
        glazingThicknessMeters: 0.08,
      }),
    ).toThrow(/glazing thickness/);
  });

  it('builds a projecting eave with deterministic support brackets and rejects invalid spans', () => {
    expect(projectingEaveParts(-2, 2, 4, -0.18, 'timber')).toHaveLength(5);
    expect(() => projectingEaveParts(2, -2, 4, -0.18, 'timber')).toThrow(/positive extent/);
  });

  it('partitions host walls around real non-overlapping apertures', () => {
    const openings = [
      { id: 'door', minimumX: -0.6, maximumX: 0.6, minimumY: 0, maximumY: 2.1 },
      { id: 'upper-window', minimumX: -2.5, maximumX: -1.2, minimumY: 2.7, maximumY: 3.7 },
    ];
    const parts = wallWithRectangularOpeningsParts({
      minimumX: -3,
      maximumX: 3,
      minimumY: 0,
      maximumY: 4,
      frontZ: -0.2,
      backZ: 0.1,
      materialId: 'wall',
      openings,
    });
    const bounds = parts.map((part) => ({
      minimumX: Math.min(...part.positions.map((position) => position[0])),
      maximumX: Math.max(...part.positions.map((position) => position[0])),
      minimumY: Math.min(...part.positions.map((position) => position[1])),
      maximumY: Math.max(...part.positions.map((position) => position[1])),
    }));
    for (const opening of openings) {
      const centreX = (opening.minimumX + opening.maximumX) * 0.5;
      const centreY = (opening.minimumY + opening.maximumY) * 0.5;
      expect(
        bounds.some(
          (part) =>
            centreX > part.minimumX &&
            centreX < part.maximumX &&
            centreY > part.minimumY &&
            centreY < part.maximumY,
        ),
      ).toBe(false);
    }
    const wallArea = 6 * 4;
    const openingArea = openings.reduce(
      (sum, opening) =>
        sum + (opening.maximumX - opening.minimumX) * (opening.maximumY - opening.minimumY),
      0,
    );
    const solidArea = bounds.reduce(
      (sum, part) => sum + (part.maximumX - part.minimumX) * (part.maximumY - part.minimumY),
      0,
    );
    expect(solidArea).toBeCloseTo(wallArea - openingArea, 8);
    expect(() =>
      wallWithRectangularOpeningsParts({
        minimumX: -3,
        maximumX: 3,
        minimumY: 0,
        maximumY: 4,
        frontZ: -0.2,
        backZ: 0.1,
        materialId: 'wall',
        openings: [openings[1]!, { ...openings[1]!, id: 'overlap' }],
      }),
    ).toThrow(/overlap/);
  });

  it('creates a portable inset window with an explicit real-cutout host contract', () => {
    const window = createInsetArchitecturalWindow();
    expect(validateGeometry(window).valid).toBe(true);
    expect(window.metadata.hostContract).toMatchObject({
      kind: 'rectangular-wall-opening',
      cutoutRequired: true,
      openingWidthMeters: insetWindowOpening.widthMeters,
      openingHeightMeters: insetWindowOpening.heightMeters,
    });
    expect(window.attachments['wall-mount']).toBeDefined();
    expect(window.attachments['exterior-focus']).toBeDefined();
    expect(window.attachments['interior-focus']).toBeDefined();
    expect(
      window.materials.find((material) => material.id === 'architectural-glass')?.surface,
    ).toMatchObject({
      pattern: { kind: 'architectural-glazing', thicknessMeters: 0.008 },
    });
  });

  it('builds watertight reusable revolution geometry for production props', () => {
    const part = surfaceOfRevolutionPart(
      [
        { radius: 0.25, y: 0 },
        { radius: 0.35, y: 0.5 },
        { radius: 0.25, y: 1 },
      ],
      16,
      0,
      'wood',
    );
    expect(part.indices.length).toBeGreaterThan(16 * 2 * 6);
    expect(part.positions).toHaveLength(part.normals.length);
    expect(part.positions).toHaveLength(part.uvs.length);
    expect(() =>
      surfaceOfRevolutionPart(
        [
          { radius: 0.2, y: 1 },
          { radius: 0.2, y: 0 },
        ],
        16,
        0,
      ),
    ).toThrow(/heights must increase/);
  });

  it('creates independently reusable medium-distance barrel and slatted crate geometry', () => {
    const barrel = createStorageBarrel();
    const crate = createSlattedStorageCrate();
    expect(validateGeometry(barrel).valid).toBe(true);
    expect(validateGeometry(crate).valid).toBe(true);
    expect(barrel.attachments['stack-top']?.position[1]).toBeCloseTo(0.925);
    expect(crate.attachments['grip-left']).toBeDefined();
    expect(new Set(barrel.materialGroups.map((group) => group.materialId))).toEqual(
      new Set(['weathered-storage-wood', 'aged-hoop-iron']),
    );
  });

  it('lays out an explicit-version dressing family deterministically without blocking navigation', () => {
    const family = createStreetStorageFamily();
    const request = {
      schemaVersion: 1 as const,
      id: 'layout.street-storage-probe',
      familyId: family.id,
      seed: 9381,
      clusterCount: 4,
      zone: {
        minimum: [-5, -4] as [number, number],
        maximum: [5, 4] as [number, number],
        groundY: 0,
      },
      exclusions: [
        {
          id: 'actor-path',
          kind: 'corridor' as const,
          start: [-4.5, 0] as [number, number],
          end: [4.5, 0] as [number, number],
          halfWidthMeters: 0.8,
          clearanceMeters: 0.25,
        },
      ],
      maximumAttemptsPerInstance: 500,
    };
    const first = layoutDressingFamily(family, request);
    const second = layoutDressingFamily(family, request);
    expect(second).toEqual(first);
    expect(first.instances).toHaveLength(8);
    expect(first.verification.navigationClearancePreserved).toBe(true);
    for (const instance of first.instances) {
      expect(Math.abs(instance.transform.position[2])).toBeGreaterThan(
        0.8 + 0.25 + instance.footprintRadiusMeters,
      );
      expect(instance.geometryVersion).toBe('0.1.0');
    }
    for (const [index, instance] of first.instances.entries())
      for (const peer of first.instances
        .slice(index + 1)
        .filter((value) => value.clusterId !== instance.clusterId))
        expect(
          Math.hypot(
            instance.transform.position[0] - peer.transform.position[0],
            instance.transform.position[2] - peer.transform.position[2],
          ),
        ).toBeGreaterThanOrEqual(
          instance.footprintRadiusMeters +
            peer.footprintRadiusMeters +
            family.placement.minimumSpacingMeters,
        );
  });

  it('queries live terrain triangles and deterministically aligns dressing to accepted slopes', () => {
    const terrain: GeometryAsset = {
      schemaVersion: 1,
      id: 'environment.sloped-courtyard-surface',
      units: 'meters',
      coordinateSystem: { handedness: 'right', up: 'y', forward: '-z' },
      positions: [
        [-6, -1.2, -6],
        [6, 1.2, -6],
        [6, 1.2, 6],
        [-6, -1.2, 6],
      ],
      indices: [0, 1, 2, 0, 2, 3],
      materials: [],
      materialGroups: [],
      skeleton: [],
      morphTargets: [],
      attachments: {},
      metadata: {},
    };
    const query = createTriangleSurfaceQuery(terrain);
    const direct = query.query(2, -1);
    expect(direct?.position[1]).toBeCloseTo(0.4, 8);
    expect(direct?.slopeDegrees).toBeCloseTo(11.31, 2);
    expect(query.query(9, 0)).toBeUndefined();

    const family = createStreetStorageFamily();
    const request = {
      schemaVersion: 1 as const,
      id: 'layout.sloped-courtyard-storage',
      familyId: family.id,
      seed: 4421,
      clusterCount: 2,
      zone: {
        minimum: [-4.5, -4.5] as [number, number],
        maximum: [4.5, 4.5] as [number, number],
        groundY: -99,
      },
      surfaceQuery: {
        kind: 'triangle-mesh' as const,
        geometryAssetId: terrain.id,
        maximumSlopeDegrees: 18,
        alignToSurfaceNormal: true,
        verticalOffsetMeters: 0.015,
      },
      exclusions: [
        {
          id: 'crossing-path',
          kind: 'corridor' as const,
          start: [-4, 0] as [number, number],
          end: [4, 0] as [number, number],
          halfWidthMeters: 0.55,
          clearanceMeters: 0.1,
        },
      ],
      maximumAttemptsPerInstance: 500,
    };
    const first = layoutDressingFamily(family, request, { surfaceQuery: query });
    const second = layoutDressingFamily(family, request, { surfaceQuery: query });
    expect(second).toEqual(first);
    for (const instance of first.instances) {
      const hit = query.query(instance.transform.position[0], instance.transform.position[2])!;
      expect(instance.surface).toMatchObject({
        geometryAssetId: terrain.id,
        triangleIndex: hit.triangleIndex,
      });
      expect(instance.transform.position[1]).toBeGreaterThan(-10);
      expect(instance.surface?.normal[1]).toBeGreaterThan(0.98);
      expect(
        Math.abs(instance.transform.rotation[0]) + Math.abs(instance.transform.rotation[2]),
      ).toBeGreaterThan(0.05);
    }
    expect(() => layoutDressingFamily(family, request)).toThrow(
      /requires its declared triangle-mesh/,
    );
    expect(() =>
      layoutDressingFamily(family, request, {
        surfaceQuery: { ...query, geometryAssetId: 'environment.wrong-surface' },
      }),
    ).toThrow(/declares surface.*but received/);
    expect(surfaceAlignedEuler([0, 1, 0], Math.PI / 3)).toEqual([0, Math.PI / 3, 0]);
  });

  it('builds two distinct portable planted silhouettes and an explicit-version family', () => {
    const fern = createPottedFern();
    const shrub = createPottedShrub();
    const family = createPottedVegetationFamily();
    expect(validateGeometry(fern).valid).toBe(true);
    expect(validateGeometry(shrub).valid).toBe(true);
    expect(fern.attachments['foliage-crown']).toBeDefined();
    expect(shrub.attachments['pot-rim']).toBeDefined();
    expect(new Set(fern.materialGroups.map((group) => group.materialId))).toEqual(
      new Set(['weathered-terracotta', 'dark-soil', 'fern-stem', 'fern-light', 'fern-dark']),
    );
    expect(new Set(shrub.materialGroups.map((group) => group.materialId))).toEqual(
      new Set([
        'galvanized-zinc',
        'dark-soil',
        'shrub-branch',
        'shrub-dark',
        'shrub-mid',
        'shrub-light',
      ]),
    );
    expect(
      family.variants.map((variant) => `${variant.geometryAssetId}@${variant.geometryVersion}`),
    ).toEqual(['prop.potted-fern@0.1.0', 'prop.potted-shrub@0.1.0']);
    expect(family.clusters).toHaveLength(3);
  });

  it('builds a structural market stall, physical merchandise and authored reusable clusters', () => {
    const stall = createModularMarketStall();
    const basket = createProduceBasket();
    const sack = createTiedProvisionSack();
    const family = createMarketWorldFamily();
    for (const geometry of [stall, basket, sack])
      expect(validateGeometry(geometry).valid).toBe(true);
    expect(stall.attachments['display-centre']).toBeDefined();
    expect(stall.attachments['canopy-hook']).toBeDefined();
    expect(basket.attachments['carry-handle']).toBeDefined();
    expect(sack.attachments['tie-grip']).toBeDefined();
    expect(basket.metadata.physicalInventory).toBe(true);
    expect(new Set(stall.materialGroups.map((group) => group.materialId))).toEqual(
      new Set(['stall-oak', 'canopy-cream', 'canopy-russet']),
    );
    expect(new Set(basket.materialGroups.map((group) => group.materialId))).toEqual(
      new Set(['basket-willow', 'produce-apple-red', 'produce-apple-gold', 'produce-leaf-green']),
    );
    expect(
      family.variants.map((variant) => `${variant.geometryAssetId}@${variant.geometryVersion}`),
    ).toEqual([
      'prop.modular-market-stall@0.1.0',
      'prop.produce-basket@0.1.0',
      'prop.tied-provision-sack@0.1.0',
    ]);
    const complete = family.clusters.find(
      (cluster) => cluster.id === 'complete-merchandised-stall',
    )!;
    expect(new Set(complete.members.map((member) => member.variantId))).toEqual(
      new Set(['market-stall', 'produce-basket', 'provision-sack']),
    );
    const layout = layoutDressingFamily(family, {
      schemaVersion: 1,
      id: 'layout.market-authored-height-probe',
      familyId: family.id,
      seed: 7719,
      clusterCount: 1,
      requiredVariantIds: ['market-stall', 'produce-basket', 'provision-sack'],
      zone: { minimum: [-4, -3], maximum: [4, 3], groundY: 0 },
      exclusions: [
        {
          id: 'front-circulation',
          kind: 'corridor',
          start: [-3.5, -2.5],
          end: [3.5, -2.5],
          halfWidthMeters: 0.2,
          clearanceMeters: 0.1,
        },
      ],
      maximumAttemptsPerInstance: 500,
    });
    expect(
      layout.instances
        .filter((instance) => instance.variantId === 'produce-basket')
        .map((instance) => instance.transform.position[1]),
    ).toEqual([1.09, 1.09]);
  });

  it('builds interaction-ready workshop props and authored complete workstations', () => {
    const bench = createJoinersWorkbench();
    const board = createFreestandingToolBoard();
    const cabinet = createRollingPartsCabinet();
    const family = createWorkshopWorldFamily();
    for (const geometry of [bench, board, cabinet])
      expect(validateGeometry(geometry).valid).toBe(true);
    expect(bench.attachments['work-surface']).toBeDefined();
    expect(bench.attachments['vise-grip']).toBeDefined();
    expect(bench.attachments['operator-position']).toBeDefined();
    expect(board.attachments['tool-display-centre']).toBeDefined();
    expect(cabinet.attachments['push-handle']).toBeDefined();
    expect(bench.metadata.physicalVise).toBe(true);
    expect(board.metadata.displayedToolCount).toBe(7);
    expect(cabinet.metadata.physicalDrawerCount).toBe(5);
    expect(new Set(bench.materialGroups.map((group) => group.materialId))).toEqual(
      new Set(['workshop-hardwood', 'workshop-aged-steel', 'workshop-brass']),
    );
    expect(
      family.variants.map((variant) => `${variant.geometryAssetId}@${variant.geometryVersion}`),
    ).toEqual([
      'prop.joiners-workbench@0.1.0',
      'prop.freestanding-tool-board@0.1.0',
      'prop.rolling-parts-cabinet@0.1.0',
    ]);
    const complete = family.clusters.find(
      (cluster) => cluster.id === 'complete-craft-workstation',
    )!;
    expect(new Set(complete.members.map((member) => member.variantId))).toEqual(
      new Set(['joiners-workbench', 'freestanding-tool-board', 'rolling-parts-cabinet']),
    );
    const layout = layoutDressingFamily(family, {
      schemaVersion: 1,
      id: 'layout.workshop-complete-probe',
      familyId: family.id,
      seed: 8819,
      clusterCount: 1,
      requiredVariantIds: ['joiners-workbench', 'freestanding-tool-board', 'rolling-parts-cabinet'],
      requiredRecipeIds: ['complete-craft-workstation'],
      zone: { minimum: [-4, -3], maximum: [4, 3], groundY: 0 },
      exclusions: [
        {
          id: 'front-circulation',
          kind: 'corridor',
          start: [-3.5, -2.6],
          end: [3.5, -2.6],
          halfWidthMeters: 0.15,
          clearanceMeters: 0.05,
        },
      ],
      maximumAttemptsPerInstance: 500,
    });
    expect(layout.instances).toHaveLength(3);
    expect(layout.verification.allRequiredVariantsPresent).toBe(true);
  });
});
