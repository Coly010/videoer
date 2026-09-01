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
    directoryName: 'upholstered-reading-chair',
    attachments: [
      'ground-origin',
      'seat-centre',
      'occupant-position',
      'back-rest',
      'side-table-left',
      'side-table-right',
    ],
    materialGroups: ['furnishing-walnut', 'furnishing-woven-wool', 'furnishing-aged-brass'],
    metadata: { domesticFurnishing: true, seatingCapacity: 1, upholstered: true },
  },
  {
    directoryName: 'pedestal-side-table',
    attachments: [
      'ground-origin',
      'tabletop-centre',
      'tabletop-left',
      'tabletop-right',
      'chair-position',
    ],
    materialGroups: ['furnishing-walnut', 'furnishing-aged-brass'],
    metadata: { domesticFurnishing: true, physicalTableSurface: true, brassInlay: true },
  },
  {
    directoryName: 'decorative-vessel-set',
    attachments: ['ground-origin', 'tabletop-base', 'carry-point', 'vessel-focus'],
    materialGroups: ['furnishing-glazed-ceramic', 'furnishing-aged-brass'],
    metadata: { domesticFurnishing: true, tabletopAsset: true, physicalVesselCount: 3 },
  },
];

function cameraClearanceAccepted(render: Record<string, unknown>) {
  if (typeof render.verification !== 'object' || render.verification === null) return false;
  const checks = 'checks' in render.verification ? render.verification.checks : undefined;
  return (
    Array.isArray(checks) &&
    checks.some(
      (check) =>
        typeof check === 'object' &&
        check !== null &&
        'id' in check &&
        check.id === 'camera-remains-inside-host-shell' &&
        'status' in check &&
        check.status === 'pass',
    )
  );
}

export async function acceptInteriorFurnishingFamily(outputDirectory: string) {
  const candidate = await loadDressingAcceptanceCandidate(outputDirectory, memberContracts);
  const { familyDirectory, family } = candidate;
  assertDressingFamilyRequiredVariants(family, ['reading-chair', 'pedestal-table', 'vessel-set']);

  const transfers: DressingTransferPublication[] = [];
  const hostIds = new Set<string>();
  const rigIds = new Set<string>();
  const baseRig = createWarmInteriorLightingRig();
  for (const kind of ['historic-library-chamber', 'contemporary-reading-loft'] as const) {
    const directory = join(familyDirectory, 'verification', kind);
    const [requestValue, persistedLayout, host, render, landmarkHashes, lightingReport, rig] =
      await Promise.all([
        readJsonRecord(join(directory, 'layout-request.json')),
        readJsonRecord(join(directory, 'layout-report.json')),
        loadGeometry(join(directory, 'host-geometry.json')),
        readJsonRecord(join(directory, 'scene-render.json')),
        verifyDistinctDressingLandmarkPixels(directory, [
          '000-right-context.png',
          '050-frontal-reading-corner.png',
          '100-left-context.png',
        ]),
        readJsonRecord(join(directory, 'lighting-adaptation-report.json')),
        loadLightingRig(join(directory, 'adapted-lighting-rig.json')),
      ]);
    if (hostIds.has(host.id)) throw new Error('Interior transfer evidence reuses the same host');
    hostIds.add(host.id);
    if (rigIds.has(rig.id))
      throw new Error('Interior transfer evidence reuses a lighting identity');
    rigIds.add(rig.id);

    const request = dressingLayoutRequestSchema.parse(requestValue);
    const recomputed = layoutDressingFamily(family, request);
    if (JSON.stringify(recomputed) !== JSON.stringify(persistedLayout))
      throw new Error(`${kind} layout does not match deterministic regeneration`);
    if (!recomputed.verification.allRequiredVariantsPresent)
      throw new Error(`${kind} layout omits required furnishing inventory`);
    const clusterIds = new Set(recomputed.instances.map((instance) => instance.clusterId));
    if (
      clusterIds.size !== 1 ||
      recomputed.instances.some((instance) => instance.recipeId !== 'complete-reading-corner')
    )
      throw new Error(`${kind} evidence lacks one complete authored reading-corner recipe`);

    const table = recomputed.instances.find((instance) => instance.variantId === 'pedestal-table')!;
    const vessels = recomputed.instances.find((instance) => instance.variantId === 'vessel-set')!;
    const supportHeight =
      table.transform.position[1] + table.heightMeters * table.transform.scale[1];
    const supportError = Math.hypot(
      vessels.transform.position[0] - table.transform.position[0],
      vessels.transform.position[1] - supportHeight,
      vessels.transform.position[2] - table.transform.position[2],
    );
    if (supportError > 1e-8)
      throw new Error(`${kind} vessel inventory is not exactly supported by its physical table`);
    if (!dressingRenderEvidencePass(render, 'interior-furnishing-inspection-coverage'))
      throw new Error(`${kind} transfer render fails declared gates`);
    if (!cameraClearanceAccepted(render))
      throw new Error(`${kind} transfer lacks live camera-shell clearance evidence`);

    const adaptation = lightingRigAdaptationSchema.parse(lightingReport.adaptation);
    const liveLighting = verifyLightingRigAdaptation(baseRig, rig, adaptation);
    if (!liveLighting.valid)
      throw new Error(`${kind} lighting derivation is invalid: ${liveLighting.issues.join('; ')}`);
    if (rig.metadata.derivedFrom !== baseRig.id)
      throw new Error(`${kind} lighting does not retain the verified parent identity`);
    const expectedFocus: [number, number] = [
      recomputed.instances.reduce((sum, instance) => sum + instance.transform.position[0], 0) /
        recomputed.instances.length,
      recomputed.instances.reduce((sum, instance) => sum + instance.transform.position[2], 0) /
        recomputed.instances.length,
    ];
    const declaredFocus = adaptation.metadata.layoutFocus;
    if (
      !Array.isArray(declaredFocus) ||
      declaredFocus.length !== 2 ||
      Math.hypot(
        Number(declaredFocus[0]) - expectedFocus[0],
        Number(declaredFocus[1]) - expectedFocus[1],
      ) > 1e-8
    )
      throw new Error(`${kind} lighting is not bound to the persisted furnishing layout focus`);

    transfers.push({
      kind,
      summary: {
        kind,
        requestId: request.id,
        hostAssetId: host.id,
        sourceLightingRigId: baseRig.id,
        adaptedLightingRigId: rig.id,
        supportErrorMeters: supportError,
        cameraClearanceAccepted: true,
        layoutFocus: expectedFocus,
        landmarkHashes,
      },
      familyCheck: `visual.${kind}-accepted`,
      memberCheck: `visual.${kind}-furnishing-transfer-accepted`,
    });
  }

  const promoted = await promoteAcceptedDressingCandidate({
    candidate,
    transfers,
    familyCapabilities: [
      'medium-background-quality-tier',
      'layout-aware-verified-lighting-rig-reuse',
      'exact-tabletop-support',
    ],
    familyChecks: [
      'layout.required-variant-coverage-accepted',
      'layout.complete-reading-corner-recipe-accepted',
      'layout.navigation-clearance-accepted',
      'furnishing.exact-tabletop-support-accepted',
      'camera.host-shell-clearance-accepted',
      'lighting.layout-aware-verified-parent-adaptation-accepted',
      'family.medium-background-shot-distance-accepted',
    ],
    memberChecks: [
      'prop.physical-furnishing-semantics-accepted',
      'prop.medium-background-shot-distance-accepted',
    ],
  });
  return {
    output: candidate.output,
    ...promoted,
    transferSummaries: transfers.map(({ summary }) => summary),
  };
}
