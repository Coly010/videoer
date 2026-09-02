import { describe, expect, it } from 'vitest';
import {
  architecturalEnvelopeDefinitionSchema,
  compileArchitecturalEnvelope,
  createContemporaryMixedUseEnvelopeDefinition,
  createHistoricShopfrontEnvelopeDefinition,
} from '../src/environments/architectural-envelope.js';
import {
  compileIrregularPaving,
  createContemporaryPaverDefinition,
  createHistoricSettPavingDefinition,
  irregularPavingDefinitionSchema,
} from '../src/environments/irregular-paving.js';
import { createTriangleSurfaceQuery } from '../src/environments/surface-query.js';
import { validateGeometry } from '../src/geometry/model.js';

describe('construction-aware architectural envelopes', () => {
  it('compiles deterministic real-aperture envelopes across unrelated host classes', () => {
    const historicDefinition = createHistoricShopfrontEnvelopeDefinition();
    const contemporaryDefinition = createContemporaryMixedUseEnvelopeDefinition();
    const historic = compileArchitecturalEnvelope(historicDefinition);
    const repeatedHistoric = compileArchitecturalEnvelope(historicDefinition);
    const contemporary = compileArchitecturalEnvelope(contemporaryDefinition);

    expect(historic.report.deterministicSha256).toBe(repeatedHistoric.report.deterministicSha256);
    expect(historic.geometry).toEqual(repeatedHistoric.geometry);
    expect(validateGeometry(historic.geometry).valid).toBe(true);
    expect(validateGeometry(contemporary.geometry).valid).toBe(true);
    expect(historic.report.geometryValid).toBe(true);
    expect(contemporary.report.geometryValid).toBe(true);
    expect(historic.report.apertures.every((aperture) => aperture.centreRayClear)).toBe(true);
    expect(contemporary.report.apertures.every((aperture) => aperture.centreRayClear)).toBe(true);
    expect(historic.report.openingCount).toBe(6);
    expect(contemporary.report.openingCount).toBe(5);
    expect(historic.report.occupiedRoomCount).toBe(2);
    expect(contemporary.report.occupiedRoomCount).toBe(2);
    expect(historic.definition.roof.kind).toBe('gable');
    expect(contemporary.definition.roof.kind).toBe('flat-parapet');
    expect(historic.report.constructionDetail.style).toBe('historic-masonry');
    expect(historic.report.constructionDetail.openingHeadCount).toBe(6);
    expect(contemporary.report.constructionDetail.style).toBe('contemporary-plaster');
    expect(contemporary.report.constructionDetail.revealBandCount).toBe(15);
    expect(
      contemporary.report.constructionDetail.dirtReceiverZones.some(
        (zone) => zone.role === 'parapet-runoff',
      ),
    ).toBe(true);
    expect(historic.definition.metadata.hostClass).not.toBe(
      contemporary.definition.metadata.hostClass,
    );
    expect(historic.geometry.id).not.toContain('benchmark');
    expect(contemporary.geometry.id).not.toContain('benchmark');
  });

  it('persists exact module versions, room witnesses, and reusable installation anchors', () => {
    const historic = compileArchitecturalEnvelope(createHistoricShopfrontEnvelopeDefinition());
    expect(
      historic.modulePlacements.map((placement) => `${placement.assetId}@${placement.version}`),
    ).toEqual(
      expect.arrayContaining(['prop.bookshop-door@0.1.0', 'prop.inset-architectural-window@0.1.0']),
    );
    expect(historic.geometry.attachments['canopy-mount']).toBeDefined();
    expect(historic.geometry.attachments['sign-mount']).toBeDefined();
    expect(historic.geometry.attachments['rainwater-span']).toBeDefined();
    expect(historic.geometry.attachments['opening-display-window']).toBeDefined();
    expect(historic.geometry.attachments['room-focus-display-window']).toBeDefined();
    const materialGroups = new Set(
      historic.geometry.materialGroups.map((group) => group.materialId),
    );
    expect(materialGroups.has('lit-room')).toBe(true);
    expect(materialGroups.has('interior-wood')).toBe(true);
    expect(materialGroups.has('rain-aged-plaster')).toBe(true);
    expect(historic.report.facadeLayerDepths[0]!.frontZ).toBeLessThan(
      historic.report.facadeLayerDepths[0]!.backZ,
    );
  });

  it('rejects incomplete bay rhythm, unsafe openings, and false room depth', () => {
    const badWidth = structuredClone(createHistoricShopfrontEnvelopeDefinition());
    badWidth.storeys[0]!.bays[0]!.widthMeters += 0.2;
    expect(architecturalEnvelopeDefinitionSchema.safeParse(badWidth).success).toBe(false);

    const badOpening = structuredClone(createHistoricShopfrontEnvelopeDefinition());
    badOpening.storeys[0]!.bays[0]!.opening!.widthMeters =
      badOpening.storeys[0]!.bays[0]!.widthMeters;
    expect(architecturalEnvelopeDefinitionSchema.safeParse(badOpening).success).toBe(false);

    const falseRoom = structuredClone(createHistoricShopfrontEnvelopeDefinition());
    falseRoom.storeys[0]!.bays[1]!.opening!.room.depthMeters =
      falseRoom.shell.wallThicknessMeters + 0.05;
    expect(architecturalEnvelopeDefinitionSchema.safeParse(falseRoom).success).toBe(false);
  });
});

describe('irregular paving grammar', () => {
  it('generates deterministic physical paving and a fully queryable support surface', () => {
    const definition = createHistoricSettPavingDefinition();
    const first = compileIrregularPaving(definition);
    const second = compileIrregularPaving(definition);

    expect(first.report.deterministicSha256).toBe(second.report.deterministicSha256);
    expect(first.report.stones).toEqual(second.report.stones);
    expect(first.report.geometryValid).toBe(true);
    expect(first.report.supportGeometryValid).toBe(true);
    expect(validateGeometry(first.geometry).valid).toBe(true);
    expect(validateGeometry(first.supportGeometry).valid).toBe(true);
    expect(first.report.stoneCount).toBeGreaterThan(180);
    expect(first.report.courseCount).toBeGreaterThan(8);
    expect(first.report.uniqueFootprintSignatures).toBeGreaterThan(first.report.stoneCount * 0.8);
    expect(first.report.uniqueSurfaceFrameSignatures).toBeGreaterThan(
      first.report.stoneCount * 0.95,
    );
    expect(first.report.unitPlanCoverageRatio).toBeGreaterThanOrEqual(
      first.definition.joints.minimumUnitCoverageRatio,
    );
    expect(first.report.maximumSkippedCellSpanMeters).toBeLessThanOrEqual(
      first.definition.joints.maximumUnfilledSpanMeters,
    );
    expect(first.report.minimumObservedUnitClearanceMeters).toBeGreaterThanOrEqual(
      first.definition.joints.minimumUnitClearanceMeters,
    );
    expect(first.report.physicalConstruction).toMatchObject({
      specificationId: 'historic-natural-granite-setts',
      class: 'natural-stone-sett',
      passed: true,
    });
    expect(first.report.physicalConstruction.referenceBasis.adoption).toBe(
      'factual-reference-only-no-code-adoption',
    );
    expect(first.report.physicalConstruction.assessedWholeUnitCount).toBeGreaterThan(0);
    expect(first.report.physicalConstruction.excludedBoundaryCutCount).toBeGreaterThan(0);
    expect(first.report.physicalConstruction.nominal).toMatchObject({
      unitLengthMeters: 0.2,
      unitWidthMeters: 0.1,
      unitHeightMeters: 0.075,
      jointWidthMeters: 0.01,
      jointRecessMeters: 0.004,
      aspectRatio: 2,
    });
    expect(
      first.report.stones.every((stone) => stone.surfaceFrame.kind === 'unit-local-uv-meters'),
    ).toBe(true);
    expect(first.report.surfaceMaterialTargets).toEqual({
      modeledUnits: [
        'dark-repair-stone',
        'warm-repair-stone',
        'wet-granite-a',
        'wet-granite-b',
        'wet-granite-c',
      ],
      continuousJoint: 'dark-grit-joint',
      continuousSubstrate: 'compacted-paving-substrate',
      borders: ['dark-stone-gutter', 'granite-kerb'],
    });
    expect(first.geometry.metadata.surfaceMaterialTargets).toEqual(
      first.report.surfaceMaterialTargets,
    );
    expect(first.report.settlementRangeMeters[1]).toBeGreaterThan(
      first.report.settlementRangeMeters[0],
    );
    expect(first.report.maximumObservedStepMeters).toBeLessThanOrEqual(
      definition.walkability.maximumStepMeters,
    );
    expect(first.report.repairPatchStoneCounts['older-repair']).toBeGreaterThan(0);
    expect(first.report.supportQueryCoverage).toEqual({ samples: 25, hits: 25 });

    const query = createTriangleSurfaceQuery(first.supportGeometry);
    expect(query.geometryAssetId).toBe(`${definition.id}.support`);
    expect(query.query(0, -2.5)?.position[1]).toBeCloseTo(definition.baseY, 8);
    expect(query.query(12, -2.5)).toBeUndefined();
  });

  it('changes only unit-local surface sampling when the independent sampling seed changes', () => {
    const definition = createHistoricSettPavingDefinition();
    const changedSampling = structuredClone(definition);
    changedSampling.surfaceSampling.seed += 1;
    const first = compileIrregularPaving(definition);
    const changed = compileIrregularPaving(changedSampling);

    expect(changed.geometry.positions).toEqual(first.geometry.positions);
    expect(changed.geometry.indices).toEqual(first.geometry.indices);
    expect(changed.geometry.materialGroups).toEqual(first.geometry.materialGroups);
    expect(changed.geometry.uvs).not.toEqual(first.geometry.uvs);
    expect(changed.report.stones.map((stone) => stone.surfaceFrame)).not.toEqual(
      first.report.stones.map((stone) => stone.surfaceFrame),
    );
    expect(changed.report.stones.map((stone) => ({ ...stone, surfaceFrame: undefined }))).toEqual(
      first.report.stones.map((stone) => ({ ...stone, surfaceFrame: undefined })),
    );
    expect(
      changed.geometry.uvs?.every((uv) => uv.every((component) => Number.isFinite(component))),
    ).toBe(true);
  });

  it('transfers the same compiler across historic setts and contemporary pavers', () => {
    const historic = compileIrregularPaving(createHistoricSettPavingDefinition());
    const contemporary = compileIrregularPaving(createContemporaryPaverDefinition());

    expect(historic.definition.courses.directionDegrees).toBe(0);
    expect(contemporary.definition.courses.directionDegrees).toBe(90);
    expect(historic.definition.units.profile).toBe('irregular-sett');
    expect(contemporary.definition.units.profile).toBe('irregular-paver');
    expect(contemporary.definition.units.nominalLengthMeters).toBe(0.2);
    expect(contemporary.definition.courses.nominalWidthMeters).toBe(0.1);
    expect(contemporary.definition.units.heightMeters).toBe(0.05);
    expect(contemporary.definition.joints.widthMeters).toBe(0.004);
    expect(contemporary.definition.joints.depthMeters).toBe(0.003);
    expect(contemporary.report.physicalConstruction).toMatchObject({
      specificationId: 'contemporary-standard-concrete-block-pavers',
      class: 'precast-concrete-block-paver',
      passed: true,
      nominal: { aspectRatio: 2 },
    });
    expect(historic.report.deterministicSha256).not.toBe(contemporary.report.deterministicSha256);
    expect(contemporary.report.repairPatchStoneCounts['utility-reinstatement']).toBeGreaterThan(0);
    expect(contemporary.report.unitPlanCoverageRatio).toBeGreaterThanOrEqual(
      contemporary.definition.joints.minimumUnitCoverageRatio,
    );
    expect(contemporary.report.maximumSkippedCellSpanMeters).toBeLessThanOrEqual(
      contemporary.definition.joints.maximumUnfilledSpanMeters,
    );
    expect(contemporary.report.minimumObservedUnitClearanceMeters).toBeGreaterThanOrEqual(
      contemporary.definition.joints.minimumUnitClearanceMeters,
    );
    expect(contemporary.geometry.attachments['channel-outfall']).toBeDefined();
    expect(historic.geometry.attachments['gutter-outfall']).toBeDefined();
    expect(
      historic.geometry.materialGroups.some((group) => group.materialId === 'dark-stone-gutter'),
    ).toBe(true);
    expect(
      contemporary.geometry.materialGroups.some(
        (group) => group.materialId === 'linear-channel-stone',
      ),
    ).toBe(true);
  });

  it('rejects decorative tiling declarations that cannot be physically verified', () => {
    const noDrainage = structuredClone(createHistoricSettPavingDefinition());
    noDrainage.drainage.fall = [0, 0];
    expect(irregularPavingDefinitionSchema.safeParse(noDrainage).success).toBe(false);

    const falseReceiver = structuredClone(createHistoricSettPavingDefinition());
    falseReceiver.drainage.wetReceiverMaterialIds = ['missing-material'];
    expect(irregularPavingDefinitionSchema.safeParse(falseReceiver).success).toBe(false);

    const outsidePatch = structuredClone(createHistoricSettPavingDefinition());
    outsidePatch.repairPatches[0]!.maximum = [30, 30];
    expect(irregularPavingDefinitionSchema.safeParse(outsidePatch).success).toBe(false);

    const impossibleJoint = structuredClone(createHistoricSettPavingDefinition());
    impossibleJoint.joints.widthMeters = 0.08;
    impossibleJoint.units.nominalLengthMeters = 0.12;
    expect(irregularPavingDefinitionSchema.safeParse(impossibleJoint).success).toBe(false);

    const impossibleCoverage = structuredClone(createContemporaryPaverDefinition());
    impossibleCoverage.joints.minimumUnitCoverageRatio = 0.99;
    expect(() => compileIrregularPaving(impossibleCoverage)).toThrow(/coverage/u);

    const hiddenRepairUnits = structuredClone(createContemporaryPaverDefinition());
    hiddenRepairUnits.repairPatches[0]!.settlementBiasMeters = -0.02;
    hiddenRepairUnits.physicalConstruction.bounds.nominal.maximumExposedReliefMeters.maximum = 0.03;
    hiddenRepairUnits.physicalConstruction.bounds.nominal.maximumAbsoluteSettlementMeters.maximum = 0.03;
    hiddenRepairUnits.physicalConstruction.bounds.actual.maximumExposedReliefMeters.maximum = 0.03;
    hiddenRepairUnits.physicalConstruction.bounds.actual.maximumAbsoluteSettlementMeters.maximum = 0.03;
    expect(() => compileIrregularPaving(hiddenRepairUnits)).toThrow(/clearance/u);

    const unsupportedSlabScale = structuredClone(createContemporaryPaverDefinition());
    unsupportedSlabScale.units.nominalLengthMeters = 0.42;
    unsupportedSlabScale.courses.nominalWidthMeters = 0.3;
    expect(irregularPavingDefinitionSchema.safeParse(unsupportedSlabScale).success).toBe(false);

    const falseActualEnvelope = structuredClone(createHistoricSettPavingDefinition());
    falseActualEnvelope.physicalConstruction.bounds.actual.unitLengthMeters.maximum = 0.19;
    expect(() => compileIrregularPaving(falseActualEnvelope)).toThrow(
      /actual unitLengthMeters range/u,
    );

    const overlappingSurfaceTarget = structuredClone(createHistoricSettPavingDefinition());
    overlappingSurfaceTarget.materials.substrateId =
      overlappingSurfaceTarget.materials.stoneIds[0]!;
    expect(irregularPavingDefinitionSchema.safeParse(overlappingSurfaceTarget).success).toBe(false);
  });
});
