import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assembleCinematicShot, createProductRevealShot } from '../src/cinematic/assembly.js';
import { cinematicSceneSchema } from '../src/cinematic/model.js';
import { cinematicDeliveryFilename } from '../src/cinematic/delivery.js';
import { verifyCinematicScene } from '../src/cinematic/verification.js';
import { boxPart, mergeMeshParts } from '../src/geometry/primitives.js';
import { saveGeometry } from '../src/geometry/io.js';
import { sampleCinematicCamera } from '../src/cinematic/camera-path.js';
import { saveMotionClip } from '../src/motion/io.js';
import {
  aggregateCinematicRenderVerification,
  cinematicLandmarkFrame,
} from '../src/cinematic/blender.js';
import { resolveFiniteFogDomain } from '../src/cinematic/fog.js';

const fixture = {
  schemaVersion: 1 as const,
  id: 'scene.enter-bookshop',
  durationSeconds: 1.875,
  fps: 24,
  resolution: { width: 540, height: 960, percentage: 100 },
  entities: [
    {
      id: 'heroine',
      role: 'character' as const,
      geometryPath: 'character.json',
      transform: { position: [0, 0, -0.6], rotation: [0, Math.PI, 0], scale: [1, 1, 1] },
      motion: { path: 'actor-motion.json', startSeconds: 0, endSeconds: 1.875 },
    },
  ],
  camera: {
    keyframes: [
      { time: 0, position: [-2.8, 1.5, -3.1], target: [0, 1.1, 0], lensMillimeters: 55 },
      {
        time: 1.875,
        position: [-2.65, 1.5, -2.8],
        target: [0, 1.1, 0.3],
        lensMillimeters: 58,
      },
    ],
  },
  lights: [
    {
      id: 'cool-key',
      type: 'area' as const,
      position: [-2, 3, -2],
      target: [0, 1, 0],
      color: [0.5, 0.7, 1],
      energy: 800,
      sizeMeters: 2,
    },
  ],
  atmosphere: { rain: { enabled: true, count: 120, seed: 4 } },
  landmarks: [
    { id: 'approach', progress: 0, description: 'Outside approach' },
    { id: 'open', progress: 0.6, description: 'Door opens' },
    { id: 'inside', progress: 1, description: 'Crossed threshold' },
  ],
};

describe('renderer-independent executable cinematic scenes', () => {
  it('fails the aggregate report when a renderer check fails', () => {
    const result = aggregateCinematicRenderVerification(
      {
        schemaVersion: 1,
        status: 'pass',
        checks: [
          {
            id: 'body-faces-travel',
            status: 'pass',
            message: 'Structural direction passes',
            measurements: {},
          },
        ],
      },
      [
        {
          id: 'profile-frame-visible',
          status: 'fail',
          message: 'Semantic frame is excessively black',
          measurements: { blackPercentage: 75 },
        },
      ],
    );

    expect(result.status).toBe('fail');
    expect(result.checks.map((check) => check.id)).toEqual([
      'body-faces-travel',
      'profile-frame-visible',
    ]);
  });

  it('maps semantic landmarks to exact rendered frame centres for short scenes', () => {
    expect([0, 0.5, 1].map((progress) => cinematicLandmarkFrame(progress, 0.125, 24))).toEqual([
      1, 2, 3,
    ]);
  });

  it('defaults authoritative cinematic evidence to fixed-seed Cycles CPU', () => {
    const scene = cinematicSceneSchema.parse(fixture);
    expect(scene.renderProfile).toEqual({
      engine: 'cycles-cpu',
      samples: 128,
      seed: 1729,
      denoise: true,
      intent: 'deterministic-final',
    });
    expect(
      cinematicSceneSchema.parse({
        ...fixture,
        renderProfile: { engine: 'eevee-next', samples: 32 },
      }).renderProfile,
    ).toEqual({ engine: 'eevee-next', samples: 32, intent: 'preview' });
  });

  it('keeps v1 legacy invariants while v2 owns lighting rigs and finite fog domains', () => {
    expect(
      cinematicSceneSchema.safeParse({
        ...fixture,
        lights: [],
        lightingRigPath: 'rig.json',
      }).success,
    ).toBe(false);
    expect(
      cinematicSceneSchema.safeParse({
        ...fixture,
        atmosphere: {
          fogDomain: { policy: 'scene-envelope-v1' },
          rain: { enabled: false },
        },
      }).success,
    ).toBe(false);
    const v2 = cinematicSceneSchema.parse({
      ...fixture,
      schemaVersion: 2,
      lights: [],
      lightingRigPath: 'rig.json',
      atmosphere: {
        fogDensity: 0.01,
        fogDomain: {
          policy: 'explicit-box-v1',
          boundsMinimum: [-10, -2, -10],
          boundsMaximum: [10, 8, 10],
          maximumExtentMeters: 50,
          edgeFalloffMeters: 1,
        },
        rain: { enabled: false },
      },
    });
    expect(v2.schemaVersion).toBe(2);
    expect(v2.atmosphere.fogDomain).toMatchObject({ policy: 'explicit-box-v1' });
  });

  it('rejects duplicate scene-light identities and out-of-frame regional render gates', () => {
    expect(
      cinematicSceneSchema.safeParse({
        ...fixture,
        lights: [fixture.lights[0], structuredClone(fixture.lights[0])],
      }).success,
    ).toBe(false);
    expect(
      cinematicSceneSchema.safeParse({
        ...fixture,
        renderGates: [
          {
            id: 'invalid-spatial-region',
            type: 'region-spatial-color-variation',
            region: { x: 0.75, y: 0.1, width: 0.5, height: 0.5 },
            minimumMeanNormalizedColorEntropy: 0.1,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('derives asymmetric bounded fog envelopes and rejects explicit boxes that miss scene evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'videoer-fog-domain-'));
    try {
      const environment = mergeMeshParts(
        'environment.fog-domain',
        [boxPart([-1, 0, -1], [1, 3, 1], 0, undefined)],
        [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
        {},
      );
      await saveGeometry(join(directory, 'environment.json'), environment);
      const sceneFile = join(directory, 'scene.json');
      const scene = cinematicSceneSchema.parse({
        ...fixture,
        schemaVersion: 2,
        entities: [{ id: 'environment', role: 'environment', geometryPath: 'environment.json' }],
        atmosphere: {
          fogDensity: 0.01,
          fogDomain: {
            policy: 'scene-envelope-v1',
            horizontalPaddingMeters: 4,
            belowPaddingMeters: 1,
            abovePaddingMeters: 4,
            minimumHorizontalSpanMeters: 12,
            minimumVerticalSpanMeters: 6,
            maximumExtentMeters: 50,
            edgeFalloffMeters: 1,
          },
          rain: { enabled: false },
        },
      });
      const domain = await resolveFiniteFogDomain(scene, sceneFile);
      expect(domain).toMatchObject({
        policy: 'scene-envelope-v1',
        size: [20, 11, 20],
        containment: {
          allSourcePointsContained: true,
          allVisibleEntityBoundsContained: true,
          allCameraPositionsContained: true,
          allCameraTargetsContained: true,
        },
      });
      const explicit = cinematicSceneSchema.parse({
        ...scene,
        atmosphere: {
          ...scene.atmosphere,
          fogDomain: {
            policy: 'explicit-box-v1',
            boundsMinimum: [-1, -1, -1],
            boundsMaximum: [1, 3, 1],
            maximumExtentMeters: 10,
            edgeFalloffMeters: 0.2,
          },
        },
      });
      await expect(resolveFiniteFogDomain(explicit, sceneFile)).rejects.toThrow(
        /does not contain every visible entity and camera keyframe/u,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('requires overlay visibility gates to reference declared overlays and landmarks', () => {
    const scene = cinematicSceneSchema.parse({
      ...fixture,
      overlays: [
        {
          id: 'title',
          imagePath: './title.png',
          startSeconds: 0.25,
          endSeconds: fixture.durationSeconds,
        },
      ],
      renderGates: [
        {
          id: 'title-visible',
          type: 'overlay-visibility',
          overlayId: 'title',
          landmarkIds: ['open'],
          minimumOpacity: 0.9,
        },
      ],
    });
    expect(scene.renderGates[0]).toMatchObject({
      type: 'overlay-visibility',
      overlayId: 'title',
      landmarkIds: ['open'],
    });
    expect(() =>
      cinematicSceneSchema.parse({
        ...scene,
        renderGates: [{ ...scene.renderGates[0], overlayId: 'missing' }],
      }),
    ).toThrow(/unknown overlay/);
  });

  it('defines bounded regional tonal-balance gates for lighting-sensitive compositions', () => {
    const scene = cinematicSceneSchema.parse({
      ...fixture,
      renderGates: [
        {
          id: 'facade-tonal-balance',
          type: 'region-exposure',
          region: { x: 0.1, y: 0.05, width: 0.5, height: 0.4 },
          maximumBlackPercentage: 35,
          maximumWhitePercentage: 8,
          minimumMidtonePercentage: 57,
        },
      ],
    });
    expect(scene.renderGates[0]).toMatchObject({
      type: 'region-exposure',
      blackThreshold: 32,
      whiteThreshold: 245,
    });
    expect(() =>
      cinematicSceneSchema.parse({
        ...fixture,
        renderGates: [
          {
            id: 'outside-frame',
            type: 'region-exposure',
            region: { x: 0.8, y: 0.2, width: 0.3, height: 0.4 },
            maximumBlackPercentage: 35,
            maximumWhitePercentage: 8,
            minimumMidtonePercentage: 57,
          },
        ],
      }),
    ).toThrow(/within normalized frame bounds/);
  });

  it('samples declared linear and eased camera/target paths deterministically', () => {
    const linear = cinematicSceneSchema.parse({
      ...fixture,
      camera: {
        keyframes: [
          {
            time: 0,
            position: [0, 0, 0],
            target: [0, 0, 1],
            lensMillimeters: 40,
            easing: 'linear',
          },
          {
            time: fixture.durationSeconds,
            position: [4, 0, 0],
            target: [4, 0, 1],
            lensMillimeters: 80,
          },
        ],
      },
    });
    expect(sampleCinematicCamera(linear, fixture.durationSeconds / 4)).toMatchObject({
      position: [1, 0, 0],
      target: [1, 0, 1],
      lensMillimeters: 50,
    });
    const eased = cinematicSceneSchema.parse({
      ...linear,
      camera: {
        keyframes: linear.camera.keyframes.map((keyframe) => ({
          ...keyframe,
          easing: 'ease-in-out' as const,
        })),
      },
    });
    const sampled = sampleCinematicCamera(eased, fixture.durationSeconds / 4);
    expect(sampled.position[0]).toBeCloseTo(0.585786, 5);
    expect(sampled.target[0]).toBeCloseTo(0.585786, 5);
    expect(sampled.lensMillimeters).toBeCloseTo(45.857864, 5);
  });

  it('rejects obstructed semantic sightlines before rendering and respects entity transforms', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'videoer-camera-clearance-'));
    try {
      const wall = mergeMeshParts(
        'environment.camera-clearance-wall',
        [boxPart([-1, 0, -0.1], [1, 3, 0.1], 0, undefined)],
        [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
        {},
      );
      const geometryPath = join(directory, 'wall.json');
      await saveGeometry(geometryPath, wall);
      const sceneFile = join(directory, 'scene.json');
      const blocked = cinematicSceneSchema.parse({
        ...fixture,
        entities: [
          {
            id: 'wall',
            role: 'environment',
            geometryPath: 'wall.json',
            transform: { position: [3, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          },
        ],
        camera: {
          keyframes: [
            { time: 0, position: [3, 1.5, -2], target: [3, 1.5, 2], lensMillimeters: 50 },
            {
              time: fixture.durationSeconds,
              position: [3.4, 1.5, -2],
              target: [3.4, 1.5, 2],
              lensMillimeters: 50,
            },
          ],
        },
        qualityGates: [
          {
            id: 'camera-clears-wall',
            type: 'camera-path-clearance',
            obstacleEntityIds: ['wall'],
            sampleCount: 9,
            minimumCameraClearanceMeters: 0.2,
            targetOcclusionToleranceMeters: 0.2,
          },
        ],
      });
      await writeFile(sceneFile, JSON.stringify(blocked));
      const blockedReport = await verifyCinematicScene(blocked, sceneFile);
      expect(blockedReport).toMatchObject({
        status: 'fail',
        checks: [
          {
            status: 'fail',
            measurements: {
              sampleCount: 9,
              blockedSightlineSamples: 9,
              blockedObstacleEntityId: 'wall',
            },
          },
        ],
      });
      const clear = cinematicSceneSchema.parse({
        ...blocked,
        camera: {
          keyframes: blocked.camera.keyframes.map((keyframe) => ({
            ...keyframe,
            target: [keyframe.target[0], keyframe.target[1], -1] as [number, number, number],
          })),
        },
      });
      const clearReport = await verifyCinematicScene(clear, sceneFile);
      expect(clearReport.status).toBe('pass');
      expect(clearReport.checks[0]!.measurements).toMatchObject({ blockedSightlineSamples: 0 });
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('rejects camera body paths that violate obstacle clearance without blocking the target ray', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'videoer-camera-body-clearance-'));
    try {
      const wall = mergeMeshParts(
        'environment.camera-body-wall',
        [boxPart([-1, 0, -0.1], [1, 3, 0.1], 0, undefined)],
        [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
        {},
      );
      await saveGeometry(join(directory, 'wall.json'), wall);
      const sceneFile = join(directory, 'scene.json');
      const scene = cinematicSceneSchema.parse({
        ...fixture,
        entities: [{ id: 'wall', role: 'environment', geometryPath: 'wall.json' }],
        camera: {
          keyframes: [
            { time: 0, position: [-2, 1.5, -0.2], target: [-2, 1.5, -2], lensMillimeters: 50 },
            {
              time: fixture.durationSeconds,
              position: [2, 1.5, -0.2],
              target: [2, 1.5, -2],
              lensMillimeters: 50,
            },
          ],
        },
        qualityGates: [
          {
            id: 'camera-body-clears-wall',
            type: 'camera-path-clearance',
            obstacleEntityIds: ['wall'],
            sampleCount: 9,
            minimumCameraClearanceMeters: 0.25,
            targetOcclusionToleranceMeters: 0.2,
          },
        ],
      });
      await writeFile(sceneFile, JSON.stringify(scene));
      const report = await verifyCinematicScene(scene, sceneFile);
      expect(report.status).toBe('fail');
      expect(Number(report.checks[0]!.measurements.minimumCameraClearanceMeters)).toBeLessThan(
        0.25,
      );
      expect(report.checks[0]!.measurements.blockedSightlineSamples).toBe(0);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('evaluates animated skinned obstacle geometry at every camera sample', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'videoer-animated-camera-obstacle-'));
    try {
      const wall = mergeMeshParts(
        'environment.animated-camera-wall',
        [boxPart([-1, 0, -0.1], [1, 3, 0.1], 0, undefined)],
        [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
        {},
      );
      await saveGeometry(join(directory, 'wall.json'), wall);
      await saveMotionClip(join(directory, 'wall-motion.json'), {
        schemaVersion: 1,
        id: 'motion.camera-wall-slide',
        skeleton: 'skeleton.camera-wall',
        durationSeconds: fixture.durationSeconds,
        loop: false,
        tracks: [
          {
            joint: 'root',
            property: 'translation',
            space: 'local-delta',
            keyframes: [
              { time: 0, value: [0, 0, 0], easing: 'linear' },
              { time: fixture.durationSeconds, value: [-3, 0, 0], easing: 'linear' },
            ],
          },
        ],
        morphTracks: [],
        metadata: {},
      });
      const sceneFile = join(directory, 'scene.json');
      const scene = cinematicSceneSchema.parse({
        ...fixture,
        entities: [
          {
            id: 'sliding-wall',
            role: 'environment',
            geometryPath: 'wall.json',
            transform: { position: [3, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            motion: {
              path: 'wall-motion.json',
              startSeconds: 0,
              endSeconds: fixture.durationSeconds,
              sourceStartSeconds: 0,
              sourceEndSeconds: fixture.durationSeconds,
            },
          },
        ],
        camera: {
          keyframes: [
            { time: 0, position: [0, 1.5, -2], target: [0, 1.5, 2], lensMillimeters: 50 },
            {
              time: fixture.durationSeconds,
              position: [0, 1.5, -2],
              target: [0, 1.5, 2],
              lensMillimeters: 50,
            },
          ],
        },
        qualityGates: [
          {
            id: 'camera-clears-moving-wall',
            type: 'camera-path-clearance',
            obstacleEntityIds: ['sliding-wall'],
            sampleCount: 7,
            minimumCameraClearanceMeters: 0.2,
            targetOcclusionToleranceMeters: 0.2,
          },
        ],
      });
      await writeFile(sceneFile, JSON.stringify(scene));
      const report = await verifyCinematicScene(scene, sceneFile);
      expect(report.status).toBe('fail');
      expect(Number(report.checks[0]!.measurements.blockedSightlineSamples)).toBeGreaterThan(0);
      expect(report.checks[0]!.measurements.blockedObstacleEntityId).toBe('sliding-wall');
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('quantifies reciprocal multi-character blocking', async () => {
    const scene = cinematicSceneSchema.parse({
      ...fixture,
      entities: [
        {
          ...fixture.entities[0],
          id: 'first',
          motion: undefined,
          transform: { position: [-1, 0, 0], rotation: [0, -Math.PI / 2, 0], scale: [1, 1, 1] },
        },
        {
          ...fixture.entities[0],
          id: 'second',
          motion: undefined,
          transform: { position: [1, 0, 0], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] },
        },
      ],
      qualityGates: [
        {
          id: 'reciprocal-blocking',
          type: 'mutual-facing',
          firstEntityId: 'first',
          secondEntityId: 'second',
          minimumFacingDot: 0.98,
        },
      ],
    });
    const report = await verifyCinematicScene(scene, '/tmp/semantic-blocking-scene.json');
    expect(report).toMatchObject({
      status: 'pass',
      checks: [
        {
          status: 'pass',
          measurements: { firstFacingDot: 1, secondFacingDot: 1, distanceMeters: 2 },
        },
      ],
    });
    const reversed = cinematicSceneSchema.parse({
      ...scene,
      entities: scene.entities.map((entity) => ({
        ...entity,
        transform: { ...entity.transform, rotation: [0, -entity.transform.rotation[1], 0] },
      })),
    });
    expect((await verifyCinematicScene(reversed, '/tmp/semantic-blocking-scene.json')).status).toBe(
      'fail',
    );
  });

  it('validates reusable animated-subject framing gates', () => {
    const scene = cinematicSceneSchema.parse({
      ...fixture,
      renderGates: [
        {
          id: 'full-body-readable',
          type: 'subject-framing',
          entityId: 'heroine',
          minimumScreenHeightPercentage: 35,
          maximumScreenHeightPercentage: 90,
          marginPercentage: 3,
        },
      ],
    });
    expect(scene.renderGates[0]).toMatchObject({
      type: 'subject-framing',
      entityId: 'heroine',
    });
    expect(() =>
      cinematicSceneSchema.parse({
        ...scene,
        renderGates: [{ ...scene.renderGates[0], entityId: 'missing-character' }],
      }),
    ).toThrow(/unknown entity/);
  });

  it('validates entity-set inspection coverage against declared scene entities', () => {
    const scene = cinematicSceneSchema.parse({
      ...fixture,
      renderGates: [
        {
          id: 'all-dressing-inspectable',
          type: 'entity-set-coverage',
          entityIds: ['heroine'],
          minimumScreenHeightPercentage: 4,
          maximumScreenHeightPercentage: 90,
          minimumVisibleAreaPercentage: 98,
          marginPercentage: 1,
        },
      ],
    });
    expect(scene.renderGates[0]).toMatchObject({
      type: 'entity-set-coverage',
      entityIds: ['heroine'],
    });
    expect(() =>
      cinematicSceneSchema.parse({
        ...scene,
        renderGates: [{ ...scene.renderGates[0], entityIds: ['missing-prop'] }],
      }),
    ).toThrow(/unknown entity/);
  });

  it('validates large-scene entity frame-presence independently of full-object framing', () => {
    const scene = cinematicSceneSchema.parse({
      ...fixture,
      renderGates: [
        {
          id: 'environment-materials-visible',
          type: 'entity-set-frame-presence',
          entityIds: ['heroine'],
          minimumVisibleFrameAreaPercentage: 3,
          maximumVisibleFrameAreaPercentage: 90,
          marginPercentage: 1,
        },
      ],
    });
    expect(scene.renderGates[0]).toMatchObject({ type: 'entity-set-frame-presence' });
    expect(() =>
      cinematicSceneSchema.parse({
        ...scene,
        renderGates: [{ ...scene.renderGates[0], entityIds: ['missing-environment'] }],
      }),
    ).toThrow(/unknown entity/);
  });

  it('resolves product framing from transformed semantic asset attachments', () => {
    const product = mergeMeshParts(
      'prop.test-product',
      [boxPart([-0.5, 0, -0.1], [0.5, 1, 0.1], 0, 'body')],
      [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
      {},
    );
    product.attachments = {
      'camera-three-quarter': { position: [1, 1, -3], rotation: [0, 0, 0], bone: 'root' },
      'product-focus': { position: [0, 0.5, 0], rotation: [0, 0, 0], bone: 'root' },
    };
    const scene = createProductRevealShot({
      id: 'scene.generic-product-reveal',
      durationSeconds: 2,
      fps: 24,
      resolution: { width: 540, height: 960, percentage: 100 },
      product: {
        id: 'product',
        role: 'prop',
        geometryPath: './product.json',
        transform: { position: [5, 0, 2], rotation: [0, Math.PI / 2, 0], scale: [2, 2, 2] },
      },
      geometry: product,
      cameraAnchor: 'camera-three-quarter',
      targetAnchor: 'product-focus',
      lights: [
        {
          id: 'key',
          type: 'area',
          position: [0, 3, -2],
          target: [0, 0.5, 0],
          color: [1, 1, 1],
          energy: 500,
        },
      ],
      landmarks: [
        { id: 'arrive', progress: 0, description: 'Product arrives' },
        { id: 'hold', progress: 1, description: 'Product holds' },
      ],
    });
    expect(scene.metadata.template).toBe('product-reveal');
    expect(scene.camera.keyframes[0]!.target).toEqual([5, 1, 2]);
    expect(scene.camera.keyframes[0]!.position[0]).toBeCloseTo(-1);
    expect(scene.camera.keyframes[0]!.position[1]).toBeCloseTo(2);
    expect(scene.camera.keyframes[0]!.position[2]).toBeCloseTo(0);
  });

  it('rejects camera semantics missing from the supplied asset catalog', () => {
    const scene = cinematicSceneSchema.parse(fixture);
    expect(() =>
      assembleCinematicShot(
        {
          ...scene,
          camera: {
            keyframes: [
              {
                time: 0,
                position: { entityId: 'heroine', attachmentId: 'missing' },
                target: [0, 1, 0],
                lensMillimeters: 50,
              },
              {
                time: scene.durationSeconds,
                position: [0, 1, -3],
                target: [0, 1, 0],
                lensMillimeters: 50,
              },
            ],
          },
        },
        { geometryByEntity: {} },
      ),
    ).toThrow(/no geometry catalog/);
  });

  it('selects the composited scene clip whenever editorial overlays are present', () => {
    const plain = cinematicSceneSchema.parse(fixture);
    const editorial = cinematicSceneSchema.parse({
      ...fixture,
      overlays: [
        {
          imagePath: './title.png',
          startSeconds: 0,
          endSeconds: fixture.durationSeconds,
        },
      ],
    });
    expect(cinematicDeliveryFilename(editorial)).toBe('enter-bookshop-composited.mp4');
    expect(cinematicDeliveryFilename(plain)).toBe('enter-bookshop.mp4');
    const finished = cinematicSceneSchema.parse({
      ...fixture,
      overlays: editorial.overlays,
      finishProfilePath: './finish-profile.json',
    });
    expect(cinematicDeliveryFilename(finished)).toBe('enter-bookshop-finished.mp4');
  });

  it('accepts transformed, retimed entities with production camera, light, and atmosphere data', () => {
    const scene = cinematicSceneSchema.parse(fixture);
    expect(scene.entities[0]!.motion).toMatchObject({ startSeconds: 0, endSeconds: 1.875 });
    expect(scene.atmosphere.rain).toMatchObject({ enabled: true, count: 120, seed: 4 });
  });

  it('rejects incomplete cameras, duplicate entities, and invalid motion intervals', () => {
    expect(() => cinematicSceneSchema.parse({ ...fixture, durationSeconds: 1.8 })).toThrow(
      /whole number of frames/,
    );
    expect(() =>
      cinematicSceneSchema.parse({
        ...fixture,
        entities: [fixture.entities[0], fixture.entities[0]],
        camera: { keyframes: [fixture.camera.keyframes[0]] },
      }),
    ).toThrow(/duplicate scene entity|camera must end/);
    expect(() =>
      cinematicSceneSchema.parse({
        ...fixture,
        entities: [
          {
            ...fixture.entities[0],
            motion: { path: 'clip.json', startSeconds: 1.7, endSeconds: 1.2 },
          },
        ],
      }),
    ).toThrow(/positive interval/);
  });

  it('fails backwards travel and passes facing-aligned threshold crossing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'videoer-cinematic-'));
    try {
      const motion = {
        schemaVersion: 1,
        id: 'motion.forward-test',
        skeleton: 'videoer.canonical-humanoid.v1',
        durationSeconds: 1,
        loop: false,
        tracks: [
          {
            joint: 'root',
            property: 'translation',
            space: 'local-delta',
            keyframes: [
              { time: 0, value: [0, 0, 0], easing: 'linear' },
              { time: 1, value: [0, 0, -1], easing: 'linear' },
            ],
          },
        ],
        metadata: {},
      };
      await writeFile(join(directory, 'motion.json'), JSON.stringify(motion), 'utf8');
      await writeFile(
        join(directory, 'backwards-motion.json'),
        JSON.stringify({
          ...motion,
          tracks: [
            {
              ...motion.tracks[0],
              keyframes: [
                { time: 0, value: [0, 0, 0], easing: 'linear' },
                { time: 1, value: [0, 0, 1], easing: 'linear' },
              ],
            },
          ],
        }),
        'utf8',
      );
      const sceneFile = join(directory, 'scene.json');
      const aligned = cinematicSceneSchema.parse({
        ...fixture,
        entities: [
          {
            ...fixture.entities[0],
            transform: {
              position: [0, 0, -0.5],
              rotation: [0, Math.PI, 0],
              scale: [1, 1, 1],
            },
            motion: { path: 'motion.json', sourceStartSeconds: 0, sourceEndSeconds: 1 },
          },
        ],
        qualityGates: [
          {
            id: 'body-faces-travel',
            type: 'directional-motion',
            entityId: 'heroine',
            minimumDistanceMeters: 0.5,
            minimumForwardDot: 0.8,
          },
          {
            id: 'crosses-threshold',
            type: 'axis-crossing',
            entityId: 'heroine',
            axis: 'z',
            boundary: 0,
            direction: 'negative-to-positive',
            minimumClearanceMeters: 0.25,
          },
        ],
      });
      expect((await verifyCinematicScene(aligned, sceneFile)).status).toBe('pass');
      const backwards = cinematicSceneSchema.parse({
        ...aligned,
        entities: [
          {
            ...aligned.entities[0],
            motion: { ...aligned.entities[0]!.motion!, path: 'backwards-motion.json' },
          },
        ],
        qualityGates: [aligned.qualityGates[0]],
      });
      const report = await verifyCinematicScene(backwards, sceneFile);
      expect(report.status).toBe('fail');
      expect(report.checks[0]!.measurements.forwardDot).toBeLessThan(0);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
