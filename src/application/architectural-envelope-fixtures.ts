import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { renderCinematicScene } from '../cinematic/blender.js';
import { saveCinematicScene } from '../cinematic/io.js';
import { cinematicSceneSchema } from '../cinematic/model.js';
import {
  compileArchitecturalEnvelope,
  createContemporaryMixedUseEnvelopeDefinition,
  createHistoricShopfrontEnvelopeDefinition,
} from '../environments/architectural-envelope.js';
import {
  compileIrregularPaving,
  createContemporaryPaverDefinition,
  createHistoricSettPavingDefinition,
} from '../environments/irregular-paving.js';
import { saveGeometry } from '../geometry/io.js';
import type { GeometryAsset, Vec3 } from '../geometry/model.js';
import { createOldCityWallLanternGeometry } from '../fixtures/wall-lantern.js';
import { createProjectingSupportedCanopy } from '../props/projecting-canopy.js';
import { createProjectingHangingSign } from '../props/projecting-sign.js';
import { createInsetArchitecturalWindow, insetWindowOpening } from '../props/inset-window.js';
import { createBookshopDoor } from '../props/door.js';
import { createArchitecturalShopfront } from '../props/architectural-shopfront.js';
import {
  createPedestalSideTable,
  createUpholsteredReadingChair,
} from '../props/interior-furnishings.js';

type HostKind = 'historic-masonry-shopfront' | 'contemporary-plaster-mixed-use';
type LightingIntent = 'neutral-diagnostic' | 'wet-night';
type PlacedAsset = { id: string; path: string; position: Vec3; rotation?: Vec3 };

const json = async (path: string, value: unknown) =>
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

function attachment(geometry: GeometryAsset, id: string): Vec3 {
  const value = geometry.attachments[id];
  if (!value) throw new Error(`Architectural envelope is missing required attachment '${id}'`);
  return value.position;
}

function scene(
  host: HostKind,
  intent: LightingIntent,
  paths: {
    envelope: string;
    paving: string;
    canopy: string;
    sign?: string;
    lantern?: string;
    apertures: PlacedAsset[];
    dressings: PlacedAsset[];
  },
  mounts: { canopy: Vec3; sign?: Vec3; lantern?: Vec3 },
) {
  const historic = host === 'historic-masonry-shopfront';
  const wetNight = intent === 'wet-night';
  const entities: Array<{
    id: string;
    role: 'environment' | 'prop' | 'set-dressing';
    geometryPath: string;
    transform?: { position: Vec3; rotation: Vec3; scale: Vec3 };
  }> = [
    { id: 'architectural-envelope', role: 'environment' as const, geometryPath: paths.envelope },
    { id: 'irregular-paving', role: 'environment' as const, geometryPath: paths.paving },
    {
      id: 'projecting-canopy', role: 'prop' as const, geometryPath: paths.canopy,
      transform: { position: mounts.canopy, rotation: [0, 0, 0] as Vec3, scale: [1, 1, 1] as Vec3 },
    },
  ];
  if (paths.sign && mounts.sign)
    entities.push({
      id: 'projecting-sign', role: 'prop', geometryPath: paths.sign,
      transform: { position: mounts.sign, rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
  if (paths.lantern && mounts.lantern)
    entities.push({
      id: 'wall-lantern', role: 'prop', geometryPath: paths.lantern,
      transform: { position: mounts.lantern, rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
  for (const aperture of paths.apertures)
    entities.push({
      id: `aperture-${aperture.id}`, role: 'prop', geometryPath: aperture.path,
      transform: { position: aperture.position, rotation: aperture.rotation ?? [0, 0, 0], scale: [1, 1, 1] },
    });
  for (const dressing of paths.dressings)
    entities.push({
      id: `dressing-${dressing.id}`, role: 'set-dressing', geometryPath: dressing.path,
      transform: { position: dressing.position, rotation: dressing.rotation ?? [0, 0, 0], scale: [1, 1, 1] },
    });
  const lights = wetNight
    ? [
        { id: 'moon-key', type: 'area' as const, position: [-5.5, 9, -5] as Vec3, target: [0, 3, 0] as Vec3, color: [0.26, 0.4, 0.72] as Vec3, energy: 1050, sizeMeters: 5.5 },
        { id: 'warm-shop', type: 'area' as const, position: [historic ? 0.1 : -0.8, 2.3, -0.55] as Vec3, target: [0, 1.7, -3] as Vec3, color: [1, 0.3, 0.08] as Vec3, energy: 620, sizeMeters: 2.2 },
        { id: 'paving-rim', type: 'area' as const, position: [4.8, 3.2, -4] as Vec3, target: [0, 0, -2.7] as Vec3, color: [0.18, 0.34, 0.68] as Vec3, energy: 720, sizeMeters: 3 },
      ]
    : [
        { id: 'neutral-key', type: 'area' as const, position: [-4.5, 8.5, -6] as Vec3, target: [0, 3, 0] as Vec3, color: [0.82, 0.88, 1] as Vec3, energy: 1350, sizeMeters: 5 },
        { id: 'neutral-fill', type: 'area' as const, position: [5, 4.5, -4] as Vec3, target: [0, 2.3, 0] as Vec3, color: [1, 0.73, 0.5] as Vec3, energy: 760, sizeMeters: 4 },
        { id: 'interior-ground-witness', type: 'point' as const, position: [historic ? -0.2 : 0.8, 2.55, 1.8] as Vec3, color: [1, 0.56, 0.28] as Vec3, energy: 360, sizeMeters: 0.12 },
        { id: 'interior-upper-witness', type: 'point' as const, position: [historic ? -0.05 : 2.4, 5.35, 1.8] as Vec3, color: [1, 0.62, 0.35] as Vec3, energy: 310, sizeMeters: 0.1 },
      ];
  return cinematicSceneSchema.parse({
    schemaVersion: 1,
    id: `scene.architectural-envelope.${host}.${intent}`,
    durationSeconds: 0.125,
    fps: 24,
    resolution: { width: 720, height: 480, percentage: 100 },
    entities,
    camera: { keyframes: [
      { time: 0, position: [4.8, 2.35, -5.8], target: [0.45, 1.65, 1.25], lensMillimeters: 42 },
      { time: 0.0625, position: [3.7, 0.58, -5.2], target: [0, 0.04, -2.1], lensMillimeters: 46 },
      { time: 0.125, position: [-7, 4.2, -11.5], target: [0, 3.2, -0.2], lensMillimeters: 42 },
    ] },
    lights,
    atmosphere: {
      worldColor: wetNight ? [0.006, 0.01, 0.022] : [0.11, 0.13, 0.17],
      fogDensity: wetNight ? 0.006 : 0,
      fogColor: wetNight ? [0.035, 0.055, 0.1] : [0.15, 0.17, 0.2],
      rain: wetNight ? { enabled: true, layers: [
        { id: 'foreground', count: 260, seed: 1847, depthMinimumMeters: 1.2, depthMaximumMeters: 5, horizontalSpanMeters: 13, verticalSpanMeters: 8, streakLengthMeters: 0.28, streakRadiusMeters: 0.004, fallSpeedMetersPerSecond: 8, opacity: 0.38, color: [0.48, 0.62, 0.82] },
        { id: 'midground', count: 420, seed: 90211, depthMinimumMeters: 5, depthMaximumMeters: 12, horizontalSpanMeters: 16, verticalSpanMeters: 9, streakLengthMeters: 0.18, streakRadiusMeters: 0.0025, fallSpeedMetersPerSecond: 7, opacity: 0.22, color: [0.4, 0.54, 0.76] },
      ], windMetersPerSecond: [0.35, 0] } : undefined,
    },
    renderProfile: { engine: 'cycles-cpu', samples: 128, seed: 1729, denoise: true, intent: 'deterministic-final' },
    renderGates: [
      { id: 'environment-visible', type: 'frame-visibility', maximumBlackPercentage: wetNight ? 68 : 38 },
      { id: 'highlight-detail', type: 'frame-overexposure', maximumWhitePercentage: 5 },
      { id: 'host-presence', type: 'entity-set-frame-presence', entityIds: ['architectural-envelope', 'irregular-paving'], minimumVisibleFrameAreaPercentage: 2 },
      { id: 'module-coverage', type: 'entity-set-coverage', entityIds: entities.filter((entity) => entity.role === 'prop' && !entity.id.startsWith('aperture-')).map((entity) => entity.id), minimumScreenHeightPercentage: 2, minimumVisibleAreaPercentage: 50, marginPercentage: 1 },
      { id: 'aperture-presence', type: 'entity-set-frame-presence', entityIds: entities.filter((entity) => entity.id.startsWith('aperture-')).map((entity) => entity.id), minimumVisibleFrameAreaPercentage: 0.04 },
      ...(paths.dressings.length > 0
        ? [{ id: 'interior-dressing-presence', type: 'entity-set-frame-presence' as const, entityIds: entities.filter((entity) => entity.role === 'set-dressing').map((entity) => entity.id), minimumVisibleFrameAreaPercentage: 0.04 }]
        : []),
    ],
    landmarks: [
      { id: 'aperture-depth', progress: 0, description: 'Oblique exterior-to-interior sightline through real facade apertures into room depth' },
      { id: 'paving-relief', progress: 0.5, description: 'Low grazing view of physical paving relief, joints, repairs, drainage fall and threshold' },
      { id: 'left-construction', progress: 1, description: 'Opposite construction angle and portable module integration' },
    ],
    metadata: { verificationPurpose: 'architectural-envelope-and-irregular-paving-transfer', hostClass: host, lightingIntent: intent, publicationStatus: 'candidate-until-human-visual-acceptance' },
  });
}

export async function createArchitecturalEnvelopeTransferFixtures(
  outputDirectory: string,
  options: { render?: boolean; intents?: LightingIntent[] } = {},
) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const canopy = createProjectingSupportedCanopy({ spanMeters: 3, projectionMeters: 0.86, bracketCount: 3 });
  const sign = createProjectingHangingSign();
  const lantern = createOldCityWallLanternGeometry();
  const window = createInsetArchitecturalWindow();
  const door = createBookshopDoor();
  const chair = createUpholsteredReadingChair();
  const table = createPedestalSideTable();
  const shared = join(output, 'portable-modules');
  await mkdir(shared, { recursive: true });
  const canopyFile = await saveGeometry(join(shared, 'projecting-canopy.json'), canopy);
  const signFile = await saveGeometry(join(shared, 'projecting-sign.json'), sign);
  const lanternFile = await saveGeometry(join(shared, 'wall-lantern.json'), lantern);
  const windowFile = await saveGeometry(join(shared, 'inset-window.json'), window);
  const doorFile = await saveGeometry(join(shared, 'hinged-glazed-door.json'), door);
  const chairFile = await saveGeometry(join(shared, 'upholstered-reading-chair.json'), chair);
  const tableFile = await saveGeometry(join(shared, 'pedestal-side-table.json'), table);
  const hosts = [];
  for (const host of ['historic-masonry-shopfront', 'contemporary-plaster-mixed-use'] as const) {
    const historic = host === 'historic-masonry-shopfront';
    const directory = join(output, host);
    await mkdir(directory, { recursive: true });
    const envelope = compileArchitecturalEnvelope(historic ? createHistoricShopfrontEnvelopeDefinition() : createContemporaryMixedUseEnvelopeDefinition());
    const paving = compileIrregularPaving(historic ? createHistoricSettPavingDefinition() : createContemporaryPaverDefinition());
    if (!envelope.report.geometryValid || envelope.report.apertures.some((item) => !item.centreRayClear))
      throw new Error(`${host} envelope failed structural acceptance`);
    if (!paving.report.geometryValid || !paving.report.supportGeometryValid || paving.report.supportQueryCoverage.hits !== paving.report.supportQueryCoverage.samples)
      throw new Error(`${host} paving failed structural acceptance`);
    const envelopeFile = await saveGeometry(join(directory, 'envelope-geometry.json'), envelope.geometry);
    const pavingFile = await saveGeometry(join(directory, 'paving-geometry.json'), paving.geometry);
    await saveGeometry(join(directory, 'paving-support-geometry.json'), paving.supportGeometry);
    await json(join(directory, 'envelope-definition.json'), envelope.definition);
    await json(join(directory, 'paving-definition.json'), paving.definition);
    await json(join(directory, 'envelope-report.json'), envelope.report);
    await json(join(directory, 'paving-report.json'), paving.report);
    const mounts = historic
      ? { canopy: attachment(envelope.geometry, 'canopy-mount'), sign: attachment(envelope.geometry, 'sign-mount'), lantern: [-2.85, 3.25, -0.04] as Vec3 }
      : { canopy: attachment(envelope.geometry, 'studio-canopy-mount') };
    const compatibleWindows = envelope.modulePlacements.filter(
      (placement) =>
        placement.assetId === window.id &&
        Math.abs(placement.opening.maximumX - placement.opening.minimumX - insetWindowOpening.widthMeters) < 1e-8 &&
        Math.abs(placement.opening.maximumY - placement.opening.minimumY - insetWindowOpening.heightMeters) < 1e-8,
    );
    const compatibleDoors = envelope.modulePlacements.filter(
      (placement) =>
        placement.kind === 'door' &&
        Math.abs(placement.opening.maximumX - placement.opening.minimumX - 1.2) < 1e-8 &&
        Math.abs(placement.opening.maximumY - placement.opening.minimumY - 2.16) < 1e-8,
    );
    const moduleDirectory = join(directory, 'aperture-modules');
    await mkdir(moduleDirectory, { recursive: true });
    const shopfronts: Array<{
      placement: (typeof envelope.modulePlacements)[number];
      file: string;
    }> = [];
    for (const placement of envelope.modulePlacements.filter(
      (candidate) => candidate.kind === 'shopfront',
    )) {
      const openingDefinition = envelope.definition.storeys
        .flatMap((storey) => storey.bays)
        .map((bay) => bay.opening)
        .find((opening) => opening?.id === placement.openingId)!;
      const geometry = createArchitecturalShopfront({
        schemaVersion: 1,
        id: `prop.architectural-shopfront.${placement.openingId}`,
        openingWidthMeters: placement.opening.maximumX - placement.opening.minimumX,
        openingHeightMeters: placement.opening.maximumY - placement.opening.minimumY,
        wallThicknessMeters: envelope.definition.shell.wallThicknessMeters,
        mullionCount: historic ? 2 : 3,
        stallRiserMeters: historic ? 0.38 : 0.28,
        interiorDepthMeters: openingDefinition.room.depthMeters,
        finishStyle: historic ? 'historic-timber' : 'contemporary-metal',
      });
      shopfronts.push({
        placement,
        file: await saveGeometry(
          join(moduleDirectory, `${placement.openingId}.json`),
          geometry,
        ),
      });
    }
    const openingDefinitions = new Map(
      envelope.definition.storeys
        .flatMap((storey) => storey.bays)
        .flatMap((bay) => (bay.opening ? [[bay.opening.id, bay.opening] as const] : [])),
    );
    const inhabited = envelope.modulePlacements.filter(
      (placement) => openingDefinitions.get(placement.openingId)?.room.occupancy === 'inhabited',
    );
    const compatibility = {
      schemaVersion: 1, host,
      compatible: [
        'projecting-canopy',
        ...(historic ? ['projecting-sign', 'wall-lantern'] : []),
        ...compatibleWindows.map((placement) => `inset-window:${placement.openingId}`),
        ...compatibleDoors.map((placement) => `hinged-glazed-door:${placement.openingId}`),
        ...shopfronts.map(({ placement }) => `architectural-shopfront:${placement.openingId}`),
      ],
      excluded: envelope.modulePlacements
        .filter(
          (placement) =>
            !compatibleWindows.includes(placement) &&
            !compatibleDoors.includes(placement) &&
            !shopfronts.some((shopfront) => shopfront.placement === placement),
        )
        .map((placement) => ({ openingId: placement.openingId, assetId: placement.assetId, reason: 'opening dimensions do not exactly match the current portable module contract; scaling is prohibited' })),
      exactPortableGeometryReused: true,
    };
    await json(join(directory, 'module-compatibility-report.json'), compatibility);
    const scenes = [];
    for (const intent of options.intents ?? ['neutral-diagnostic', 'wet-night']) {
      const sceneDirectory = join(directory, 'verification', intent);
      await mkdir(sceneDirectory, { recursive: true });
      const portablePath = (path: string) => relative(sceneDirectory, path);
      const apertureAssets: PlacedAsset[] = [
        ...compatibleWindows.map((placement) => ({
          id: placement.openingId,
          path: portablePath(windowFile),
          position: placement.position,
        })),
        ...compatibleDoors.map((placement) => ({
          id: placement.openingId,
          path: portablePath(doorFile),
          position: placement.position,
        })),
        ...shopfronts.map(({ placement, file }) => ({
          id: placement.openingId,
          path: portablePath(file),
          position: placement.position,
        })),
      ];
      const dressingAssets: PlacedAsset[] = inhabited.flatMap((placement, index) => {
        const near = attachment(envelope.geometry, `interior-depth-near-${placement.openingId}`);
        const narrowWindow = placement.kind === 'window';
        return [
          {
            id: `${placement.openingId}-chair`,
            path: portablePath(chairFile),
            position: [near[0] + (narrowWindow ? 0 : -0.55), near[1], near[2] + (narrowWindow ? 0.08 : 0.35)],
            rotation: [0, index % 2 === 0 ? 0.18 : -0.22, 0],
          },
          {
            id: `${placement.openingId}-table`,
            path: portablePath(tableFile),
            position: [near[0] + (narrowWindow ? 0.42 : 0.65), near[1], near[2] + (narrowWindow ? 0.52 : 0.22)],
          },
        ];
      });
      const scenePaths = historic
        ? {
            envelope: portablePath(envelopeFile), paving: portablePath(pavingFile),
            canopy: portablePath(canopyFile), sign: portablePath(signFile),
            lantern: portablePath(lanternFile),
            apertures: apertureAssets,
            dressings: dressingAssets,
          }
        : {
            envelope: portablePath(envelopeFile), paving: portablePath(pavingFile),
            canopy: portablePath(canopyFile),
            apertures: apertureAssets,
            dressings: dressingAssets,
          };
      const sceneFile = await saveCinematicScene(
        join(sceneDirectory, 'scene.json'),
        scene(host, intent, scenePaths, mounts),
      );
      scenes.push({ intent, sceneFile, render: options.render === false ? undefined : await renderCinematicScene(sceneFile, sceneDirectory) });
    }
    hosts.push({ host, directory, envelope: envelope.report, paving: paving.report, compatibility, scenes });
  }
  await json(join(output, 'fixture-report.json'), { schemaVersion: 1, status: 'candidate-awaiting-visual-acceptance', hosts: hosts.map(({ host, directory, compatibility, scenes }) => ({ host, directory, compatibility, scenes: scenes.map(({ intent, sceneFile }) => ({ intent, sceneFile })) })) });
  return { output, hosts };
}
