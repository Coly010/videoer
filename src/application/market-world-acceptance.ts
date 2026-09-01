import { join } from 'node:path';
import {
  dressingLayoutRequestSchema,
  layoutDressingFamily,
} from '../environments/dressing-family.js';
import { loadGeometry } from '../geometry/io.js';
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
    directoryName: 'modular-market-stall',
    attachments: [
      'ground-origin',
      'display-left',
      'display-centre',
      'display-right',
      'lower-stock',
      'canopy-hook',
    ],
    materialGroups: ['stall-oak', 'canopy-cream', 'canopy-russet'],
    metadata: { merchandisingAsset: true, modularStructure: true },
  },
  {
    directoryName: 'produce-basket',
    attachments: ['ground-origin', 'carry-handle', 'display-base', 'produce-centre'],
    materialGroups: [
      'basket-willow',
      'produce-apple-red',
      'produce-apple-gold',
      'produce-leaf-green',
    ],
    metadata: { merchandisingAsset: true, physicalInventory: true },
  },
  {
    directoryName: 'tied-provision-sack',
    attachments: ['ground-origin', 'tie-grip', 'stack-centre'],
    materialGroups: ['sack-burlap', 'sack-seam'],
    metadata: { merchandisingAsset: true, physicalInventory: true },
  },
];

export async function acceptMarketWorldDressingFamily(outputDirectory: string) {
  const candidate = await loadDressingAcceptanceCandidate(outputDirectory, memberContracts);
  const { familyDirectory, family } = candidate;
  assertDressingFamilyRequiredVariants(family, [
    'market-stall',
    'produce-basket',
    'provision-sack',
  ]);

  const transfers: DressingTransferPublication[] = [];
  const hostIds = new Set<string>();
  for (const kind of ['historic-market-square', 'contemporary-pop-up'] as const) {
    const directory = join(familyDirectory, 'verification', kind);
    const [requestValue, persistedLayout, host, render, landmarkHashes] = await Promise.all([
      readJsonRecord(join(directory, 'layout-request.json')),
      readJsonRecord(join(directory, 'layout-report.json')),
      loadGeometry(join(directory, 'host-geometry.json')),
      readJsonRecord(join(directory, 'scene-render.json')),
      verifyDistinctDressingLandmarkPixels(directory),
    ]);
    if (hostIds.has(host.id))
      throw new Error('Market transfer evidence reuses the same host identity');
    hostIds.add(host.id);
    const request = dressingLayoutRequestSchema.parse(requestValue);
    const recomputed = layoutDressingFamily(family, request);
    if (JSON.stringify(recomputed) !== JSON.stringify(persistedLayout))
      throw new Error(`Persisted ${kind} market layout does not match deterministic regeneration`);
    if (!recomputed.verification.allRequiredVariantsPresent)
      throw new Error(`${kind} market layout omits a required physical silhouette`);
    const completeClusters = new Map<string, Set<string>>();
    for (const instance of recomputed.instances) {
      const variants = completeClusters.get(instance.clusterId) ?? new Set<string>();
      variants.add(instance.variantId);
      completeClusters.set(instance.clusterId, variants);
    }
    if (
      ![...completeClusters.values()].some(
        (variants) =>
          variants.has('market-stall') &&
          variants.has('produce-basket') &&
          variants.has('provision-sack'),
      )
    )
      throw new Error(`${kind} evidence lacks a physically merchandised complete stall cluster`);
    const elevatedInventory = recomputed.instances.filter(
      (instance) => instance.variantId === 'produce-basket' && instance.transform.position[1] > 0.8,
    );
    if (elevatedInventory.length < 2)
      throw new Error(`${kind} evidence does not place physical produce on stall display surfaces`);
    if (!dressingRenderEvidencePass(render, 'market-entity-inspection-coverage'))
      throw new Error(`${kind} transfer render fails declared gates`);
    transfers.push({
      kind,
      summary: {
        kind,
        requestId: request.id,
        hostAssetId: host.id,
        completeMerchandisedClusterCount: [...completeClusters.values()].filter(
          (variants) =>
            variants.has('market-stall') &&
            variants.has('produce-basket') &&
            variants.has('provision-sack'),
        ).length,
        elevatedProduceBasketCount: elevatedInventory.length,
        landmarkHashes,
      },
      familyCheck: `visual.${kind}-accepted`,
      memberCheck: `visual.${kind}-family-transfer-accepted`,
    });
  }

  const promoted = await promoteAcceptedDressingCandidate({
    candidate,
    transfers,
    familyCapabilities: ['medium-background-quality-tier'],
    familyChecks: [
      'layout.required-variant-coverage-accepted',
      'layout.every-entity-inspectable',
      'merchandising.complete-physical-stall-cluster-accepted',
      'family.medium-background-shot-distance-accepted',
    ],
    memberChecks: [
      'prop.physical-merchandising-semantics-accepted',
      'prop.medium-background-shot-distance-accepted',
    ],
  });
  return {
    output: candidate.output,
    ...promoted,
    transferSummaries: transfers.map(({ summary }) => summary),
  };
}
