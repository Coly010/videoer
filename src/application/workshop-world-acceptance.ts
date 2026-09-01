import { join } from 'node:path';
import {
  dressingLayoutRequestSchema,
  layoutDressingFamily,
} from '../environments/dressing-family.js';
import { loadGeometry } from '../geometry/io.js';
import {
  lightingRigAdaptationSchema,
  verifyLightingRigAdaptation,
} from '../lighting/adaptation.js';
import { createWarmInteriorLightingRig } from '../lighting/bookshop.js';
import { loadLightingRig } from '../lighting/io.js';
import {
  dressingRenderEvidencePass,
  verifyDistinctDressingLandmarkPixels,
} from './environment-dressing-acceptance.js';
import {
  assertDressingFamilyRequiredVariants,
  loadDressingAcceptanceCandidate,
  promoteAcceptedDressingCandidate,
  readJsonRecord,
  type DressingTransferPublication,
} from './dressing-family-acceptance-core.js';

const memberContracts = [
  {
    directoryName: 'joiners-workbench',
    attachments: [
      'ground-origin',
      'work-surface',
      'vise-grip',
      'operator-position',
      'task-light-target',
    ],
    materialGroups: ['workshop-hardwood', 'workshop-aged-steel', 'workshop-brass'],
    metadata: { workshopAsset: true, workstationStructure: true, physicalVise: true },
  },
  {
    directoryName: 'freestanding-tool-board',
    attachments: ['ground-origin', 'tool-display-centre', 'shelf-left', 'shelf-right'],
    materialGroups: [
      'workshop-hardwood',
      'workshop-aged-steel',
      'workshop-painted-steel',
      'workshop-dark-recess',
    ],
    metadata: { workshopAsset: true, physicalToolDisplay: true, displayedToolCount: 7 },
  },
  {
    directoryName: 'rolling-parts-cabinet',
    attachments: ['ground-origin', 'top-tray', 'push-handle', 'drawer-centre'],
    materialGroups: [
      'workshop-hardwood',
      'workshop-aged-steel',
      'workshop-painted-steel',
      'workshop-brass',
      'workshop-rubber',
    ],
    metadata: { workshopAsset: true, physicalDrawerCount: 5, rollingStorage: true },
  },
];

export async function acceptWorkshopWorldDressingFamily(outputDirectory: string) {
  const candidate = await loadDressingAcceptanceCandidate(outputDirectory, memberContracts);
  const { familyDirectory, family } = candidate;
  assertDressingFamilyRequiredVariants(family, [
    'joiners-workbench',
    'freestanding-tool-board',
    'rolling-parts-cabinet',
  ]);

  const transfers: DressingTransferPublication[] = [];
  const hostIds = new Set<string>();
  const adaptedRigIds = new Set<string>();
  const baseRig = createWarmInteriorLightingRig();
  for (const kind of ['historic-forge-workroom', 'contemporary-maker-lab'] as const) {
    const directory = join(familyDirectory, 'verification', kind);
    const [
      requestValue,
      persistedLayout,
      host,
      render,
      landmarkHashes,
      lightingReport,
      adaptedRig,
    ] = await Promise.all([
      readJsonRecord(join(directory, 'layout-request.json')),
      readJsonRecord(join(directory, 'layout-report.json')),
      loadGeometry(join(directory, 'host-geometry.json')),
      readJsonRecord(join(directory, 'scene-render.json')),
      verifyDistinctDressingLandmarkPixels(directory, [
        '000-right-context.png',
        '050-frontal-workstations.png',
        '100-left-context.png',
      ]),
      readJsonRecord(join(directory, 'lighting-adaptation-report.json')),
      loadLightingRig(join(directory, 'adapted-lighting-rig.json')),
    ]);
    if (hostIds.has(host.id)) throw new Error('Workshop transfer evidence reuses the same host');
    hostIds.add(host.id);
    if (adaptedRigIds.has(adaptedRig.id))
      throw new Error('Workshop transfer evidence reuses the same adapted lighting identity');
    adaptedRigIds.add(adaptedRig.id);

    const request = dressingLayoutRequestSchema.parse(requestValue);
    const recomputed = layoutDressingFamily(family, request);
    if (JSON.stringify(recomputed) !== JSON.stringify(persistedLayout))
      throw new Error(
        `Persisted ${kind} workshop layout does not match deterministic regeneration`,
      );
    if (!recomputed.verification.allRequiredVariantsPresent)
      throw new Error(`${kind} workshop layout omits a required workstation silhouette`);
    const completeClusters = new Map<string, Set<string>>();
    for (const instance of recomputed.instances) {
      const variants = completeClusters.get(instance.clusterId) ?? new Set<string>();
      variants.add(instance.variantId);
      completeClusters.set(instance.clusterId, variants);
    }
    const completeWorkstations = [...completeClusters.values()].filter(
      (variants) =>
        variants.has('joiners-workbench') &&
        variants.has('freestanding-tool-board') &&
        variants.has('rolling-parts-cabinet'),
    );
    if (completeWorkstations.length < 1)
      throw new Error(`${kind} evidence lacks a complete physical workstation cluster`);
    if (!dressingRenderEvidencePass(render, 'workshop-entity-inspection-coverage'))
      throw new Error(`${kind} transfer render fails declared gates`);

    const adaptation = lightingRigAdaptationSchema.parse(lightingReport.adaptation);
    const liveLightingVerification = verifyLightingRigAdaptation(baseRig, adaptedRig, adaptation);
    if (!liveLightingVerification.valid)
      throw new Error(
        `${kind} lighting does not match its verified parent adaptation: ${liveLightingVerification.issues.join('; ')}`,
      );
    if (adaptedRig.metadata.derivedFrom !== baseRig.id)
      throw new Error(`${kind} lighting does not declare the verified warm-interior parent`);

    transfers.push({
      kind,
      summary: {
        kind,
        requestId: request.id,
        hostAssetId: host.id,
        adaptedLightingRigId: adaptedRig.id,
        sourceLightingRigId: baseRig.id,
        completeWorkstationCount: completeWorkstations.length,
        physicalToolDisplayCount: recomputed.instances.filter(
          (instance) => instance.variantId === 'freestanding-tool-board',
        ).length,
        landmarkHashes,
      },
      familyCheck: `visual.${kind}-accepted`,
      memberCheck: `visual.${kind}-workstation-transfer-accepted`,
    });
  }

  const promoted = await promoteAcceptedDressingCandidate({
    candidate,
    transfers,
    familyCapabilities: ['medium-background-quality-tier', 'verified-lighting-rig-reuse'],
    familyChecks: [
      'layout.required-variant-coverage-accepted',
      'layout.every-entity-inspectable',
      'workstation.complete-physical-cluster-accepted',
      'lighting.verified-parent-bounded-adaptation-accepted',
      'family.medium-background-shot-distance-accepted',
    ],
    memberChecks: [
      'prop.physical-workstation-semantics-accepted',
      'prop.medium-background-shot-distance-accepted',
    ],
  });
  return {
    output: candidate.output,
    ...promoted,
    transferSummaries: transfers.map(({ summary }) => summary),
  };
}
