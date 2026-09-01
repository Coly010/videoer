import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { inspectAudioDuration, renderSoundtrackPlan } from '../audio/render.js';
import { saveSoundtrackPlan } from '../audio/io.js';
import { renderAudioTreatment, verifyAudioTreatment } from '../audio/treatment.js';
import { assembleCinematicShot, type SpatialPointReference } from '../cinematic/assembly.js';
import { renderCinematicScene } from '../cinematic/blender.js';
import { cinematicDeliveryFilename } from '../cinematic/delivery.js';
import { saveCinematicScene } from '../cinematic/io.js';
import { assembleEdit } from './editing.js';
import { saveEditPlan } from '../editing/io.js';
import { editPlanSchema } from '../editing/model.js';
import { loadGeometry, saveGeometry } from '../geometry/io.js';
import { validateGeometry, type GeometryAsset } from '../geometry/model.js';
import {
  boxPart,
  capsuleBetween,
  ellipsoidBetween,
  mergeMeshParts,
} from '../geometry/primitives.js';
import { renderTextOverlay } from '../titles/overlay.js';
import {
  adaptEditorialTreatment,
  renderEditorialTreatment,
  verifyEditorialTreatmentAdaptation,
  verifyEditorialTreatmentRendering,
} from '../titles/adaptation.js';
import { resolveCormorantGaramondFont } from '../titles/font.js';
import { loadTitleTreatment, saveTitleTreatment } from '../titles/io.js';
import { loadDeclarativeCinematicCampaign } from '../production/cinematic-campaign-io.js';
import type { DeclarativeCinematicCampaign } from '../production/cinematic-campaign.js';
import { loadMotionClip, saveMotionClip } from '../motion/io.js';
import { validateMotionClip, type MotionClip } from '../motion/model.js';
import { composeMotionTimeline, verifyMotionTimelineComposition } from '../motion/timeline.js';
import { createWalkStyleMotion, verifyCasualWalkMotion } from '../motion/walk.js';
import { gaitStyles, type GaitStyle } from '../motion/gait.js';
import {
  createVisemeMotion,
  extractSpeechEvents,
  renderSpeechWav,
  verifyVisemeMotion,
  type SpeechEvent,
} from '../speech/espeak.js';
import { createTargetedTurnMotion, createTurnMotion } from '../interactions/synthesis.js';
import { adaptAtmosphericVfx, verifyAtmosphericVfxAdaptation } from '../vfx/adaptation.js';
import { loadAtmosphericVfx, saveAtmosphericVfx } from '../vfx/io.js';
import { toCinematicAtmosphere } from '../vfx/rainy-dusk.js';
import { loadCinematicFinishProfile } from '../finishing/io.js';
import {
  adaptSurfaceMaterial,
  bindSurfaceMaterial,
  verifySurfaceMaterialAdaptation,
} from '../materials/adaptation.js';
import { loadSurfaceMaterial, saveSurfaceMaterial } from '../materials/io.js';
import { bindStagedSurfaceMaterialValue } from '../materials/texture-maps.js';
import { fitCanonicalClothing, verifyCanonicalClothingFit } from '../clothing/adaptation.js';
import { bakePoseSpaceClothCorrectives, verifyTemporalClothing } from '../clothing/temporal.js';
import { adaptLightingRig, verifyLightingRigAdaptation } from '../lighting/adaptation.js';
import { loadLightingRig, saveLightingRig } from '../lighting/io.js';
import {
  createEnglishSpeechMorphRig,
  verifyEnglishSpeechMorphRig,
} from '../characters/speech-rig.js';
import { resolveAttachment } from '../interactions/transforms.js';
import {
  findAsset,
  searchAssetLibrary,
  sha256File,
  validateLibraryAsset,
  type LibraryAsset,
} from '../assets/library.js';
import YAML from 'yaml';
import {
  prepareCampaignPublicationCandidates,
  type CampaignPublicationInput,
} from './cinematic-publication.js';
import {
  loadProductionRigProfile,
  verifyProductionRigProfileSkeleton,
} from '../characters/rig-profile.js';
import { loadProductionCharacterBinding } from '../characters/production-binding.js';

function portablePath(fromDirectory: string, target: string) {
  const value = relative(fromDirectory, target);
  return value.startsWith('.') ? value : `./${value}`;
}

function buildGeometryRecipe(source: DeclarativeCinematicCampaign['geometry'][number]) {
  if (!source.recipe) throw new Error(`Geometry '${source.id}' does not contain a recipe`);
  const parts = source.recipe.primitives.map((primitive) => {
    if (primitive.kind === 'box')
      return boxPart(primitive.minimum, primitive.maximum, 0, primitive.materialId);
    const curved = primitive.kind === 'capsule' ? capsuleBetween : ellipsoidBetween;
    return {
      ...curved(
        primitive.start,
        primitive.end,
        primitive.radiusX,
        primitive.radiusZ,
        0,
        0,
        primitive.kind === 'capsule' ? primitive.capSegments : primitive.latSegments,
        primitive.radialSegments,
      ),
      materialId: primitive.materialId,
    };
  });
  const geometry = mergeMeshParts(
    source.recipe.assetId,
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    source.recipe.metadata,
  );
  geometry.materials = source.recipe.materials;
  geometry.attachments = source.recipe.attachments;
  return geometry;
}

function pointReference(
  point:
    | { world: [number, number, number] }
    | { entityId: string; attachmentId: string; offset: [number, number, number] },
): SpatialPointReference {
  return 'world' in point ? point.world : point;
}

export async function buildDeclarativeCinematicCampaign(
  campaignFile: string,
  options: {
    render?: boolean;
    renderShots?: string[];
    continueOnRenderFailure?: boolean;
  } = {},
) {
  const sourceFile = resolve(campaignFile);
  const root = dirname(sourceFile);
  const campaign = await loadDeclarativeCinematicCampaign(sourceFile);
  const requestedRenderShots = options.renderShots ? new Set(options.renderShots) : undefined;
  if (requestedRenderShots) {
    const knownShots = new Set(campaign.shots.map((shot) => shot.id));
    const unknownShots = [...requestedRenderShots].filter((shot) => !knownShots.has(shot));
    if (unknownShots.length)
      throw new Error(`Unknown declarative render shot(s): ${unknownShots.join(', ')}`);
  }
  const libraryRoot = resolve(root, campaign.assetLibrary);
  const assetResolutions: Array<Record<string, unknown>> = [];
  const assetManifestFile = resolve(root, 'work', 'asset-manifest.yaml');
  const writeAssetManifest = async () => {
    await mkdir(dirname(assetManifestFile), { recursive: true });
    await writeFile(
      assetManifestFile,
      YAML.stringify({
        schemaVersion: 1,
        campaignId: campaign.id,
        campaign: portablePath(dirname(assetManifestFile), sourceFile),
        library: portablePath(dirname(assetManifestFile), libraryRoot),
        generatedAt: new Date().toISOString(),
        resolutions: assetResolutions,
      }),
      'utf8',
    );
  };
  const libraryArtifact = async (
    sourceId: string,
    requirement: NonNullable<DeclarativeCinematicCampaign['geometry'][number]['library']>,
    adaptation?: { providesCapabilities: string[] },
  ) => {
    let selected: LibraryAsset | undefined;
    if (requirement.preferredAsset)
      selected = await findAsset(libraryRoot, requirement.preferredAsset);
    if (selected && selected.status !== 'verified')
      throw new Error(
        `Preferred asset ${selected.id}@${selected.version} is ${selected.status}; declarative builds require verified assets`,
      );
    const matches = await searchAssetLibrary(libraryRoot, {
      type: requirement.type,
      query: requirement.query,
      tags: requirement.tags,
      capabilities: requirement.capabilities,
    });
    selected ??= matches.find((match) => match.asset.status === 'verified')?.asset;
    const candidates = matches.slice(0, 5).map((match) => ({
      asset: { id: match.asset.id, version: match.asset.version },
      score: match.score,
      matchedTags: match.matchedTags,
      missingCapabilities: match.missingCapabilities,
    }));
    if (!selected) {
      assetResolutions.push({
        requirementId: sourceId,
        decision: 'create',
        candidates,
        reason: 'No verified commercially cleared library asset satisfies the requirement.',
      });
      await writeAssetManifest();
      throw new Error(
        `Declarative asset '${sourceId}' requires creation; no verified match exists`,
      );
    }
    const missingCapabilities = requirement.capabilities.filter(
      (capability) => !selected!.capabilities.includes(capability),
    );
    const adaptationCoversMissing =
      adaptation &&
      missingCapabilities.every((capability) =>
        adaptation.providesCapabilities.includes(capability),
      );
    if (missingCapabilities.length && !adaptationCoversMissing) {
      assetResolutions.push({
        requirementId: sourceId,
        decision: 'adapt',
        asset: { id: selected.id, version: selected.version },
        candidates,
        reason: `Selected asset lacks: ${missingCapabilities.join(', ')}.`,
      });
      await writeAssetManifest();
      throw new Error(
        `Declarative asset '${sourceId}' requires adaptation for: ${missingCapabilities.join(', ')}`,
      );
    }
    const validation = await validateLibraryAsset(selected);
    if (!validation.valid)
      throw new Error(
        `Library asset ${selected.id}@${selected.version} is not usable: ${validation.issues.join('; ')}`,
      );
    const artifact = selected.artifacts.find(
      (candidate) => candidate.role === requirement.artifactRole,
    );
    if (!artifact)
      throw new Error(
        `Library asset ${selected.id}@${selected.version} has no '${requirement.artifactRole}' artifact`,
      );
    const path = resolve(selected.directory, artifact.path);
    const resolutionRecord: Record<string, unknown> = {
      requirementId: sourceId,
      decision: adaptation ? 'adapt' : 'reuse',
      asset: { id: selected.id, version: selected.version },
      artifactRole: requirement.artifactRole,
      path: portablePath(dirname(assetManifestFile), path),
      candidates,
      reason: adaptation
        ? missingCapabilities.length
          ? `Declared deterministic adaptation provides: ${missingCapabilities.join(', ')}.`
          : 'Campaign declares a deterministic derived-asset adaptation.'
        : 'Verified commercially cleared asset satisfies every required capability.',
    };
    assetResolutions.push(resolutionRecord);
    return { path, asset: selected, missingCapabilities, resolutionRecord };
  };
  const materials = new Map<
    string,
    {
      path: string;
      textureRoot: string;
      asset: Awaited<ReturnType<typeof loadSurfaceMaterial>>;
    }
  >();
  const materialAdaptationReports = new Map<
    string,
    { path: string; baseAsset: { id: string; version: string } }
  >();
  for (const source of campaign.materialSources) {
    const resolvedLibrary = source.library
      ? await libraryArtifact(source.id, source.library, source.adaptation)
      : undefined;
    const sourcePath = resolvedLibrary?.path ?? resolve(root, source.path!);
    const base = await loadSurfaceMaterial(sourcePath);
    let path = sourcePath;
    let asset = base;
    if (source.adaptation) {
      asset = adaptSurfaceMaterial(base, {
        assetId: source.adaptation.assetId,
        baseColor: source.adaptation.baseColor,
        normal: source.adaptation.normal,
        roughness: source.adaptation.roughness,
        metallic: source.adaptation.metallic,
        metadata: {
          ...source.adaptation.metadata,
          derivedFrom: `${resolvedLibrary!.asset.id}@${resolvedLibrary!.asset.version}`,
        },
      });
      const verification = verifySurfaceMaterialAdaptation(base, asset);
      if (!verification.valid)
        throw new Error(
          `Material adaptation '${source.id}' failed semantic gates: ${verification.issues.join('; ')}`,
        );
      path = resolve(root, source.path!);
      await saveSurfaceMaterial(path, asset);
      const reportPath = resolve(
        root,
        'work',
        'adaptations',
        source.id,
        'compatibility-report.json',
      );
      await mkdir(dirname(reportPath), { recursive: true });
      const report = {
        schemaVersion: 1,
        adaptationKind: source.adaptation.kind,
        sourceId: source.id,
        baseAsset: { id: resolvedLibrary!.asset.id, version: resolvedLibrary!.asset.version },
        baseArtifact: sourcePath,
        baseMaterialSha256: await sha256File(sourcePath),
        adaptedAssetId: asset.id,
        adaptedArtifact: path,
        adaptedMaterialSha256: await sha256File(path),
        requestedCapabilities: source.library!.capabilities,
        missingBaseCapabilities: resolvedLibrary!.missingCapabilities,
        providedCapabilities: source.adaptation.providesCapabilities,
        operations: {
          changedFields: verification.changedFields,
          shadingModelChanged: false,
          baseColorModelChanged: false,
          normalModelChanged: false,
        },
        compatibility: {
          shadingModelPreserved: verification.shadingModelPreserved,
          baseColorModelPreserved: verification.baseColorModelPreserved,
          normalModelPreserved: verification.normalModelPreserved,
        },
        validation: verification,
      };
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      resolvedLibrary!.resolutionRecord.adaptedPath = portablePath(
        dirname(assetManifestFile),
        path,
      );
      resolvedLibrary!.resolutionRecord.compatibilityReport = portablePath(
        dirname(assetManifestFile),
        reportPath,
      );
      materialAdaptationReports.set(source.id, {
        path: reportPath,
        baseAsset: { id: resolvedLibrary!.asset.id, version: resolvedLibrary!.asset.version },
      });
    } else if (!source.library) {
      assetResolutions.push({
        requirementId: source.id,
        decision: 'reuse',
        path: portablePath(dirname(assetManifestFile), path),
        candidates: [],
        reason: 'Campaign supplies an existing local persisted surface material.',
      });
    }
    materials.set(source.id, { path, textureRoot: dirname(sourcePath), asset });
  }

  const geometry = new Map<
    string,
    {
      path: string;
      asset: GeometryAsset;
      productionRigProfilePath?: string;
      productionCharacterBindingPath?: string;
    }
  >();
  const geometryAdaptationReports = new Map<
    string,
    { path: string; baseAsset: { id: string; version: string } }
  >();
  const geometryLibraryReferences = new Map<string, { id: string; version: string }>();
  for (const source of campaign.geometry) {
    const resolvedLibrary = source.library
      ? await libraryArtifact(source.id, source.library, source.adaptation)
      : undefined;
    if (resolvedLibrary)
      geometryLibraryReferences.set(source.id, {
        id: resolvedLibrary.asset.id,
        version: resolvedLibrary.asset.version,
      });
    const sourcePath = resolvedLibrary?.path ?? resolve(root, source.path!);
    let path = sourcePath;
    let asset = source.recipe ? buildGeometryRecipe(source) : await loadGeometry(sourcePath);
    if (source.adaptation) {
      const base = asset;
      for (const attachmentId of Object.keys(source.adaptation.addAttachments))
        if (base.attachments[attachmentId])
          throw new Error(
            `Geometry adaptation '${source.id}' cannot overwrite attachment '${attachmentId}'`,
          );
      const adaptedMaterials = base.materials.map((material) => {
        const override = source.adaptation!.materialOverrides.find(
          (candidate) => candidate.materialId === material.id,
        );
        if (!override) return material;
        return {
          ...material,
          ...(override.baseColor ? { baseColor: override.baseColor } : {}),
          ...(override.roughness !== undefined ? { roughness: override.roughness } : {}),
          ...(override.metallic !== undefined ? { metallic: override.metallic } : {}),
          ...(override.emission ? { emission: override.emission } : {}),
          ...(override.emissionStrength !== undefined
            ? { emissionStrength: override.emissionStrength }
            : {}),
        };
      });
      for (const override of source.adaptation.materialOverrides)
        if (!base.materials.some((material) => material.id === override.materialId))
          throw new Error(
            `Geometry adaptation '${source.id}' references unknown material '${override.materialId}'`,
          );
      asset = {
        ...structuredClone(base),
        id: source.adaptation.assetId,
        materials: adaptedMaterials,
        attachments: {
          ...base.attachments,
          ...source.adaptation.addAttachments,
        },
        metadata: {
          ...base.metadata,
          ...source.adaptation.metadata,
          derivedFrom: `${resolvedLibrary!.asset.id}@${resolvedLibrary!.asset.version}`,
          adaptationGenerator: 'videoer.declarative-geometry-adaptation.v1',
        },
      };
      if (source.adaptation.speechMorphs)
        asset = createEnglishSpeechMorphRig(asset, source.adaptation.assetId);
      path = resolve(root, source.path!);
      for (const binding of source.materialBindings) {
        const material = materials.get(binding.material)!;
        if (material.asset.textureMaps && !binding.application)
          throw new Error(
            `Texture material binding '${source.id}.${binding.targetMaterialId}' requires an explicit construction application`,
          );
        if (!material.asset.textureMaps && binding.application)
          throw new Error(
            `Procedural material binding '${source.id}.${binding.targetMaterialId}' must not declare a texture application`,
          );
        asset = material.asset.textureMaps
          ? (
              await bindStagedSurfaceMaterialValue({
                geometry: asset,
                targetMaterialId: binding.targetMaterialId,
                surface: material.asset,
                sourceTextureDirectory: material.textureRoot,
                outputGeometryPath: path,
                application: binding.application!,
              })
            ).geometry
          : bindSurfaceMaterial(asset, binding.targetMaterialId, material.asset);
      }
      const validation = validateGeometry(asset);
      if (!validation.valid)
        throw new Error(
          `Geometry adaptation '${source.id}' failed validation: ${validation.issues.map((issue) => issue.message).join('; ')}`,
        );
      await saveGeometry(path, asset);
      const reportPath = resolve(
        root,
        'work',
        'adaptations',
        source.id,
        'compatibility-report.json',
      );
      await mkdir(dirname(reportPath), { recursive: true });
      const baseGeometrySha256 = await sha256File(sourcePath);
      const adaptedGeometrySha256 = await sha256File(path);
      const report = {
        schemaVersion: 1,
        sourceId: source.id,
        baseAsset: { id: resolvedLibrary!.asset.id, version: resolvedLibrary!.asset.version },
        baseArtifact: sourcePath,
        baseGeometrySha256,
        adaptedAssetId: asset.id,
        adaptedArtifact: path,
        adaptedGeometrySha256,
        requestedCapabilities: source.library!.capabilities,
        missingBaseCapabilities: resolvedLibrary!.missingCapabilities,
        providedCapabilities: source.adaptation.providesCapabilities,
        operations: {
          addedAttachments: Object.keys(source.adaptation.addAttachments),
          materialOverrides: source.adaptation.materialOverrides.map((item) => item.materialId),
          addedMorphTargets: asset.morphTargets
            .filter((target) => !base.morphTargets.some((candidate) => candidate.id === target.id))
            .map((target) => target.id),
          topologyChanged: false,
          skeletonChanged: false,
        },
        compatibility: {
          coordinateSystemPreserved: true,
          vertexCountBefore: base.positions.length,
          vertexCountAfter: asset.positions.length,
          triangleCountBefore: base.indices.length / 3,
          triangleCountAfter: asset.indices.length / 3,
          skeletonJointsBefore: base.skeleton.map((joint) => joint.id),
          skeletonJointsAfter: asset.skeleton.map((joint) => joint.id),
          morphTargetsBefore: base.morphTargets.map((target) => target.id),
          morphTargetsAfter: asset.morphTargets.map((target) => target.id),
        },
        validation,
        ...(source.adaptation.speechMorphs
          ? { speechMorphValidation: verifyEnglishSpeechMorphRig(asset) }
          : {}),
      };
      if ('speechMorphValidation' in report && !report.speechMorphValidation.valid)
        throw new Error(
          `Geometry adaptation '${source.id}' failed speech-morph gates: ${report.speechMorphValidation.issues.join('; ')}`,
        );
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      resolvedLibrary!.resolutionRecord.adaptedPath = portablePath(
        dirname(assetManifestFile),
        path,
      );
      resolvedLibrary!.resolutionRecord.compatibilityReport = portablePath(
        dirname(assetManifestFile),
        reportPath,
      );
      geometryAdaptationReports.set(source.id, {
        path: reportPath,
        baseAsset: { id: resolvedLibrary!.asset.id, version: resolvedLibrary!.asset.version },
      });
    } else {
      if (source.materialBindings.length) {
        path = resolve(root, source.path!);
        for (const binding of source.materialBindings) {
          const material = materials.get(binding.material)!;
          if (material.asset.textureMaps && !binding.application)
            throw new Error(
              `Texture material binding '${source.id}.${binding.targetMaterialId}' requires an explicit construction application`,
            );
          if (!material.asset.textureMaps && binding.application)
            throw new Error(
              `Procedural material binding '${source.id}.${binding.targetMaterialId}' must not declare a texture application`,
            );
          asset = material.asset.textureMaps
            ? (
                await bindStagedSurfaceMaterialValue({
                  geometry: asset,
                  targetMaterialId: binding.targetMaterialId,
                  surface: material.asset,
                  sourceTextureDirectory: material.textureRoot,
                  outputGeometryPath: path,
                  application: binding.application!,
                })
              ).geometry
            : bindSurfaceMaterial(asset, binding.targetMaterialId, material.asset);
        }
        await saveGeometry(path, asset);
        if (resolvedLibrary)
          resolvedLibrary.resolutionRecord.materialBindings = source.materialBindings.map(
            (binding) => ({
              targetMaterialId: binding.targetMaterialId,
              materialSource: binding.material,
              ...(binding.application ? { application: binding.application } : {}),
            }),
          );
      } else if (source.recipe) await saveGeometry(path, asset);
    }
    if (!source.library)
      assetResolutions.push({
        requirementId: source.id,
        decision: source.recipe ? 'create' : 'reuse',
        path: portablePath(dirname(assetManifestFile), path),
        candidates: [],
        reason: source.recipe
          ? 'Campaign declares a deterministic procedural recipe.'
          : 'Campaign supplies an existing local persisted asset.',
      });
    let productionRigProfilePath: string | undefined;
    let productionCharacterBindingPath: string | undefined;
    if (source.productionCharacterBindingPath) {
      productionCharacterBindingPath = resolve(root, source.productionCharacterBindingPath);
      const binding = await loadProductionCharacterBinding(productionCharacterBindingPath);
      const boundComponents = [
        binding.body,
        ...binding.materialBindings.map((item) => item.material),
        ...(binding.hair ? [binding.hair] : []),
        ...binding.wardrobe,
      ];
      for (const component of boundComponents) {
        const libraryAsset = await findAsset(libraryRoot, component.asset);
        if (!libraryAsset || libraryAsset.status !== 'verified')
          throw new Error(
            `Production-character binding for geometry '${source.id}' requires verified ${component.asset.id}@${component.asset.version}`,
          );
        const integrity = await validateLibraryAsset(libraryAsset);
        if (!integrity.valid)
          throw new Error(
            `Production-character component ${component.asset.id}@${component.asset.version} is invalid: ${integrity.issues.join('; ')}`,
          );
        const artifact = libraryAsset.artifacts.find(
          (candidate) => candidate.role === component.artifactRole,
        );
        if (!artifact?.sha256 || artifact.sha256 !== component.sha256)
          throw new Error(
            `Production-character component ${component.asset.id}@${component.asset.version} does not match its bound ${component.artifactRole} hash`,
          );
      }
      const bodySha256 = await sha256File(path);
      if (binding.body.sha256 !== bodySha256)
        throw new Error(
          `Production-character binding for geometry '${source.id}' names a different body artifact`,
        );
      if (binding.body.asset.id !== asset.id)
        throw new Error(
          `Production-character binding for geometry '${source.id}' names a different body identity`,
        );
      if (binding.compatibility.bodyTopology !== asset.metadata.topology)
        throw new Error(
          `Production-character binding for geometry '${source.id}' names an incompatible body topology`,
        );
      if (
        resolvedLibrary &&
        (binding.body.asset.id !== resolvedLibrary.asset.id ||
          binding.body.asset.version !== resolvedLibrary.asset.version)
      )
        throw new Error(
          `Production-character binding for geometry '${source.id}' names a different body asset version`,
        );
      productionRigProfilePath = resolve(
        dirname(productionCharacterBindingPath),
        binding.rigProfile.path,
      );
      const profile = await loadProductionRigProfile(productionRigProfilePath);
      if (profile.id !== binding.rigProfile.id || profile.version !== binding.rigProfile.version)
        throw new Error(
          `Production-character binding for geometry '${source.id}' names a different rig profile identity`,
        );
      const verification = verifyProductionRigProfileSkeleton(profile, asset.skeleton);
      if (!verification.valid)
        throw new Error(
          `Production-character binding for geometry '${source.id}' is incompatible: ${verification.issues.join('; ')}`,
        );
    } else if (source.productionRigProfilePath) {
      productionRigProfilePath = resolve(root, source.productionRigProfilePath);
      const profile = await loadProductionRigProfile(productionRigProfilePath);
      const verification = verifyProductionRigProfileSkeleton(profile, asset.skeleton);
      if (!verification.valid)
        throw new Error(
          `Production rig profile for geometry '${source.id}' is incompatible: ${verification.issues.join('; ')}`,
        );
    }
    geometry.set(source.id, {
      path,
      asset,
      ...(productionRigProfilePath ? { productionRigProfilePath } : {}),
      ...(productionCharacterBindingPath ? { productionCharacterBindingPath } : {}),
    });
  }

  const clothing = new Map<
    string,
    { path: string; asset: GeometryAsset; targetGeometrySource?: string }
  >();
  const clothingAdaptationReports = new Map<
    string,
    {
      path: string;
      baseAsset: { id: string; version: string };
      targetAsset?: { id: string; version: string };
    }
  >();
  for (const source of campaign.clothingSources) {
    const resolvedLibrary = source.library
      ? await libraryArtifact(source.id, source.library, source.adaptation)
      : undefined;
    const sourcePath = resolvedLibrary?.path ?? resolve(root, source.path!);
    const base = await loadGeometry(sourcePath);
    let path = sourcePath;
    let asset = base;
    let targetGeometrySource: string | undefined;
    if (source.adaptation) {
      targetGeometrySource = source.adaptation.targetGeometry;
      const target = geometry.get(targetGeometrySource)!;
      const targetReference = geometryLibraryReferences.get(targetGeometrySource);
      if (source.adaptation.publication && !targetReference)
        throw new Error(
          `Published clothing fit '${source.id}' requires a verified library target geometry`,
        );
      asset = fitCanonicalClothing(base, target.asset, source.adaptation.assetId, {
        clearanceMeters: source.adaptation.clearanceMeters,
        skinningPolicy: source.adaptation.skinningPolicy,
        metadata: {
          ...source.adaptation.metadata,
          derivedFrom: `${resolvedLibrary!.asset.id}@${resolvedLibrary!.asset.version}`,
        },
      });
      const verification = verifyCanonicalClothingFit(base, target.asset, asset);
      if (!verification.valid)
        throw new Error(
          `Clothing adaptation '${source.id}' failed fit gates: ${verification.issues.join('; ')}`,
        );
      path = resolve(root, source.path!);
      await saveGeometry(path, asset);
      const reportPath = resolve(
        root,
        'work',
        'adaptations',
        source.id,
        'compatibility-report.json',
      );
      await mkdir(dirname(reportPath), { recursive: true });
      const report = {
        schemaVersion: 1,
        adaptationKind: source.adaptation.kind,
        sourceId: source.id,
        baseAsset: { id: resolvedLibrary!.asset.id, version: resolvedLibrary!.asset.version },
        baseArtifact: sourcePath,
        baseClothingSha256: await sha256File(sourcePath),
        targetGeometry: {
          sourceId: targetGeometrySource,
          ...(targetReference ? { libraryAsset: targetReference } : {}),
          sha256: await sha256File(target.path),
        },
        adaptedAssetId: asset.id,
        adaptedArtifact: path,
        adaptedClothingSha256: await sha256File(path),
        requestedCapabilities: source.library!.capabilities,
        missingBaseCapabilities: resolvedLibrary!.missingCapabilities,
        providedCapabilities: source.adaptation.providesCapabilities,
        operations: {
          topologyChanged: false,
          skinningChanged: !verification.skinningPreserved,
          skinningPolicy: verification.skinningPolicy,
          skeletonRetargeted: true,
          changedVertexCount: verification.changedVertexCount,
          maximumVertexDisplacement: verification.maximumVertexDisplacement,
          clearanceMeters: verification.clearanceMeters,
          minimumNormalClearance: verification.minimumNormalClearance,
        },
        compatibility: {
          topologyPreserved: verification.topologyPreserved,
          skinningPreserved: verification.skinningPreserved,
          targetSkeletonMatched: verification.targetSkeletonMatched,
          canonicalSkeletonCompatible: verification.canonicalSkeletonCompatible,
          drapeSkinningValid: verification.drapeSkinningValid,
          maximumHemNonPelvisWeight: verification.maximumHemNonPelvisWeight,
        },
        validation: verification,
      };
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      resolvedLibrary!.resolutionRecord.adaptedPath = portablePath(
        dirname(assetManifestFile),
        path,
      );
      resolvedLibrary!.resolutionRecord.compatibilityReport = portablePath(
        dirname(assetManifestFile),
        reportPath,
      );
      clothingAdaptationReports.set(source.id, {
        path: reportPath,
        baseAsset: { id: resolvedLibrary!.asset.id, version: resolvedLibrary!.asset.version },
        ...(targetReference ? { targetAsset: targetReference } : {}),
      });
    } else if (!source.library) {
      assetResolutions.push({
        requirementId: source.id,
        decision: 'reuse',
        path: portablePath(dirname(assetManifestFile), path),
        candidates: [],
        reason: 'Campaign supplies existing local persisted clothing geometry.',
      });
    }
    clothing.set(source.id, {
      path,
      asset,
      ...(targetGeometrySource ? { targetGeometrySource } : {}),
    });
  }

  const resolvedAudioSources = new Map<string, string>();
  const audioAdaptationReports = new Map<
    string,
    { path: string; baseAsset: { id: string; version: string } }
  >();
  for (const source of campaign.audioSources) {
    const resolved = await libraryArtifact(source.id, source.library, source.adaptation);
    let path = resolved.path;
    if (source.adaptation) {
      path = resolve(root, source.path!);
      await renderAudioTreatment(resolved.path, path, source.adaptation);
      const verification = await verifyAudioTreatment(resolved.path, path, source.adaptation);
      if (!verification.valid)
        throw new Error(
          `Audio adaptation '${source.id}' failed semantic gates: ${verification.issues.join('; ')}`,
        );
      const reportPath = resolve(
        root,
        'work',
        'adaptations',
        source.id,
        'compatibility-report.json',
      );
      await mkdir(dirname(reportPath), { recursive: true });
      const report = {
        schemaVersion: 1,
        adaptationKind: source.adaptation.kind,
        sourceId: source.id,
        baseAsset: { id: resolved.asset.id, version: resolved.asset.version },
        baseArtifact: resolved.path,
        baseArtifactRole: source.library.artifactRole,
        baseAudioSha256: await sha256File(resolved.path),
        adaptedAssetId: source.adaptation.assetId,
        adaptedArtifact: path,
        adaptedAudioSha256: await sha256File(path),
        requestedCapabilities: source.library.capabilities,
        missingBaseCapabilities: resolved.missingCapabilities,
        providedCapabilities: source.adaptation.providesCapabilities,
        treatment: verification.treatment,
        operations: {
          selectedIntervalChanged:
            verification.treatment.sourceStartSeconds !== 0 ||
            Math.abs(verification.source.durationSeconds - verification.treatment.durationSeconds) >
              1 / 48000,
          temporalEnvelopeChanged: !verification.compatibility.temporalEnvelopePreserved,
          sampleRateChanged: !verification.compatibility.sampleRatePreservedAt48kHz,
          channelLayoutChanged: !verification.compatibility.stereoPreserved,
        },
        compatibility: verification.compatibility,
        validation: verification,
      };
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      resolved.resolutionRecord.adaptedPath = portablePath(dirname(assetManifestFile), path);
      resolved.resolutionRecord.compatibilityReport = portablePath(
        dirname(assetManifestFile),
        reportPath,
      );
      audioAdaptationReports.set(source.id, {
        path: reportPath,
        baseAsset: { id: resolved.asset.id, version: resolved.asset.version },
      });
    }
    resolvedAudioSources.set(source.id, path);
  }

  const lighting = new Map<string, Awaited<ReturnType<typeof loadLightingRig>>>();
  const lightingPaths = new Map<string, string>();
  const lightingAdaptationReports = new Map<
    string,
    { path: string; baseAsset: { id: string; version: string } }
  >();
  for (const source of campaign.lightingSources) {
    const resolved = await libraryArtifact(source.id, source.library, source.adaptation);
    const base = await loadLightingRig(resolved.path);
    let path = resolved.path;
    let asset = base;
    if (source.adaptation) {
      asset = adaptLightingRig(base, source.adaptation);
      const verification = verifyLightingRigAdaptation(base, asset, source.adaptation);
      if (!verification.valid)
        throw new Error(
          `Lighting adaptation '${source.id}' failed semantic gates: ${verification.issues.join('; ')}`,
        );
      path = resolve(root, source.path!);
      await saveLightingRig(path, asset);
      const reportPath = resolve(
        root,
        'work',
        'adaptations',
        source.id,
        'compatibility-report.json',
      );
      await mkdir(dirname(reportPath), { recursive: true });
      const report = {
        schemaVersion: 1,
        adaptationKind: source.adaptation.kind,
        sourceId: source.id,
        baseAsset: { id: resolved.asset.id, version: resolved.asset.version },
        baseArtifact: resolved.path,
        baseArtifactRole: source.library.artifactRole,
        baseLightingSha256: await sha256File(resolved.path),
        adaptedAssetId: asset.id,
        adaptedArtifact: path,
        adaptedLightingSha256: await sha256File(path),
        requestedCapabilities: source.library.capabilities,
        missingBaseCapabilities: resolved.missingCapabilities,
        providedCapabilities: source.adaptation.providesCapabilities,
        adaptation: verification.adaptation,
        operations: {
          lightTopologyChanged: !verification.topologyPreserved,
          exposureChanged: !verification.exposurePreserved,
          spatialTransformMatched: verification.spatialTransformMatched,
          energyTransformMatched: verification.energyTransformMatched,
          colorTransformMatched: verification.colorTransformMatched,
          sizeTransformMatched: verification.sizeTransformMatched,
        },
        compatibility: {
          topologyPreserved: verification.topologyPreserved,
          exposurePreserved: verification.exposurePreserved,
          nonBlackWorld: verification.nonBlackWorld,
          baseLightCount: verification.baseLightCount,
          adaptedLightCount: verification.adaptedLightCount,
          roleCoverage: verification.roleCoverage,
          energyRange: verification.energyRange,
        },
        validation: verification,
      };
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      resolved.resolutionRecord.adaptedPath = portablePath(dirname(assetManifestFile), path);
      resolved.resolutionRecord.compatibilityReport = portablePath(
        dirname(assetManifestFile),
        reportPath,
      );
      lightingAdaptationReports.set(source.id, {
        path: reportPath,
        baseAsset: { id: resolved.asset.id, version: resolved.asset.version },
      });
    }
    lightingPaths.set(source.id, path);
    lighting.set(source.id, asset);
  }

  const vfx = new Map<
    string,
    { path: string; asset: Awaited<ReturnType<typeof loadAtmosphericVfx>> }
  >();
  const vfxAdaptationReports = new Map<
    string,
    { path: string; baseAsset: { id: string; version: string } }
  >();
  for (const source of campaign.vfxSources) {
    const resolvedLibrary = source.library
      ? await libraryArtifact(source.id, source.library, source.adaptation)
      : undefined;
    const sourcePath = resolvedLibrary?.path ?? resolve(root, source.path!);
    const base = await loadAtmosphericVfx(sourcePath);
    let path = sourcePath;
    let asset = base;
    if (source.adaptation) {
      asset = adaptAtmosphericVfx(base, {
        assetId: source.adaptation.assetId,
        worldColor: source.adaptation.worldColor,
        fog: source.adaptation.fog,
        rain: source.adaptation.rain,
        metadata: {
          ...source.adaptation.metadata,
          derivedFrom: `${resolvedLibrary!.asset.id}@${resolvedLibrary!.asset.version}`,
        },
      });
      const verification = verifyAtmosphericVfxAdaptation(base, asset);
      if (!verification.valid)
        throw new Error(
          `VFX adaptation '${source.id}' failed semantic gates: ${verification.issues.join('; ')}`,
        );
      path = resolve(root, source.path!);
      await saveAtmosphericVfx(path, asset);
      const reportPath = resolve(
        root,
        'work',
        'adaptations',
        source.id,
        'compatibility-report.json',
      );
      await mkdir(dirname(reportPath), { recursive: true });
      const report = {
        schemaVersion: 1,
        adaptationKind: source.adaptation.kind,
        sourceId: source.id,
        baseAsset: { id: resolvedLibrary!.asset.id, version: resolvedLibrary!.asset.version },
        baseArtifact: sourcePath,
        baseVfxSha256: await sha256File(sourcePath),
        adaptedAssetId: asset.id,
        adaptedArtifact: path,
        adaptedVfxSha256: await sha256File(path),
        requestedCapabilities: source.library!.capabilities,
        missingBaseCapabilities: resolvedLibrary!.missingCapabilities,
        providedCapabilities: source.adaptation.providesCapabilities,
        operations: {
          changedFields: verification.changedFields,
          placementChanged: false,
          deterministicLayerTopologyChanged: false,
        },
        compatibility: {
          placementPreserved: verification.placementPreserved,
          deterministicLayerTopologyPreserved: verification.deterministicLayerTopologyPreserved,
        },
        validation: verification,
      };
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      resolvedLibrary!.resolutionRecord.adaptedPath = portablePath(
        dirname(assetManifestFile),
        path,
      );
      resolvedLibrary!.resolutionRecord.compatibilityReport = portablePath(
        dirname(assetManifestFile),
        reportPath,
      );
      vfxAdaptationReports.set(source.id, {
        path: reportPath,
        baseAsset: { id: resolvedLibrary!.asset.id, version: resolvedLibrary!.asset.version },
      });
    } else if (!source.library) {
      assetResolutions.push({
        requirementId: source.id,
        decision: 'reuse',
        path: portablePath(dirname(assetManifestFile), path),
        candidates: [],
        reason: 'Campaign supplies an existing local persisted VFX asset.',
      });
    }
    vfx.set(source.id, { path, asset });
  }

  const finishPaths = new Map<string, string>();
  for (const source of campaign.finishSources) {
    const resolvedLibrary = source.library
      ? await libraryArtifact(source.id, source.library)
      : undefined;
    const path = resolvedLibrary?.path ?? resolve(root, source.path!);
    await loadCinematicFinishProfile(path);
    finishPaths.set(source.id, path);
  }

  const speechSources = new Map<
    string,
    { audioPath: string; eventsPath: string; events: SpeechEvent[]; durationSeconds: number }
  >();
  const speechAudioReports = new Map<
    string,
    { path: string; asset: { id: string; version: string } }
  >();
  for (const cue of campaign.soundtrack.cues.filter((candidate) => candidate.kind === 'speech')) {
    const directory = resolve(root, 'work', 'audio', 'speech', cue.id);
    const audioPath = join(directory, 'speech.wav');
    const eventsPath = join(directory, 'events.json');
    const voice = { voice: cue.voice!, rate: cue.rate!, pitch: cue.pitch! };
    const [events] = await Promise.all([
      extractSpeechEvents(cue.text!, voice, resolve(root, 'work', 'tools')),
      renderSpeechWav(cue.text!, voice, audioPath),
    ]);
    const durationSeconds = await inspectAudioDuration(audioPath);
    const interval = cue.endSeconds - cue.startSeconds;
    if (durationSeconds > interval + 1 / campaign.soundtrack.sampleRate)
      throw new Error(
        `Speech cue '${cue.id}' is ${durationSeconds.toFixed(3)}s but its interval is only ${interval.toFixed(3)}s; increase the interval or speech rate`,
      );
    await mkdir(directory, { recursive: true });
    await writeFile(
      eventsPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          cueId: cue.id,
          engine: 'espeak-ng',
          text: cue.text,
          voice,
          durationSeconds,
          events,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    speechSources.set(cue.id, { audioPath, eventsPath, events, durationSeconds });
    const publication = campaign.speechPublications.find((candidate) => candidate.cue === cue.id);
    if (publication) {
      const reportPath = join(directory, 'lineage-report.json');
      const phonemes = events.filter((event) => event.type === 'phoneme');
      const words = events.filter((event) => event.type === 'word');
      const verification = {
        valid:
          phonemes.length > 0 &&
          words.length > 0 &&
          events.every(
            (event, index) =>
              index === 0 || event.audioPositionMs >= events[index - 1]!.audioPositionMs,
          ) &&
          durationSeconds <= interval + 1 / campaign.soundtrack.sampleRate,
        phonemeCount: phonemes.length,
        wordCount: words.length,
        monotonicEvents: events.every(
          (event, index) =>
            index === 0 || event.audioPositionMs >= events[index - 1]!.audioPositionMs,
        ),
        fitsDeclaredInterval: durationSeconds <= interval + 1 / campaign.soundtrack.sampleRate,
      };
      if (!verification.valid)
        throw new Error(`Speech cue '${cue.id}' failed publication lineage verification`);
      await writeFile(
        reportPath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            cueId: cue.id,
            assetId: publication.publication.assetId,
            engine: 'espeak-ng',
            text: cue.text,
            voice,
            durationSeconds,
            intervalSeconds: interval,
            audioSha256: await sha256File(audioPath),
            eventsSha256: await sha256File(eventsPath),
            verification,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      speechAudioReports.set(cue.id, {
        path: reportPath,
        asset: {
          id: publication.publication.assetId,
          version: publication.publication.version,
        },
      });
    }
  }

  const motions = new Map<string, { path: string; clip: MotionClip }>();
  const motionLibraryInputs = new Map<
    string,
    {
      asset: { id: string; version: string };
      artifactRole: string;
      path: string;
    }
  >();
  const motionChecks: Array<Record<string, unknown>> = [];
  const motionAdaptationReports = new Map<
    string,
    {
      path: string;
      baseAsset: { id: string; version: string };
      targetAsset?: { id: string; version: string };
    }
  >();
  const layeredPerformanceReports = new Map<
    string,
    {
      path: string;
      sourceAssets: Array<{ id: string; version: string }>;
      targetAsset: { id: string; version: string };
    }
  >();
  const speechPerformanceReports = new Map<
    string,
    {
      path: string;
      audioAsset: { id: string; version: string };
      targetAsset: { id: string; version: string };
    }
  >();
  for (const source of campaign.motions) {
    const resolvedLibrary = source.library
      ? await libraryArtifact(source.id, source.library, source.adaptation)
      : undefined;
    const sourcePath = resolvedLibrary?.path ?? resolve(root, source.path!);
    if (resolvedLibrary && !source.adaptation)
      motionLibraryInputs.set(source.id, {
        asset: { id: resolvedLibrary.asset.id, version: resolvedLibrary.asset.version },
        artifactRole: source.library!.artifactRole,
        path: sourcePath,
      });
    let path = sourcePath;
    let clip: MotionClip;
    if (source.adaptation) {
      const base = await loadMotionClip(sourcePath);
      if (
        base.metadata.generator !== 'videoer.phase-gait.v1' &&
        base.metadata.generator !== 'videoer.phase-gait.v2' &&
        base.metadata.generator !== 'videoer.phase-gait.v3' &&
        base.metadata.generator !== 'videoer.phase-gait.v4'
      )
        throw new Error(
          `Motion adaptation '${source.id}' requires a phase-gait parent, got '${String(base.metadata.generator)}'`,
        );
      const styleId = base.metadata.style as GaitStyle['id'];
      if (!gaitStyles[styleId])
        throw new Error(
          `Motion adaptation '${source.id}' has unknown gait style '${String(styleId)}'`,
        );
      const target = geometry.get(source.adaptation.targetGeometry)!;
      const parameters = target.asset.metadata.parameters as Record<string, unknown> | undefined;
      const requiredProportion = (key: string) => {
        const value = parameters?.[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
          throw new Error(
            `Motion adaptation '${source.id}' target geometry lacks positive numeric '${key}' proportion`,
          );
        return value;
      };
      const targetProportions = {
        height: requiredProportion('height'),
        legLength: requiredProportion('legLength'),
        armLength: requiredProportion('armLength'),
        hipWidth: requiredProportion('hipWidth'),
        footScale: requiredProportion('footScale'),
      };
      clip = createWalkStyleMotion(styleId, targetProportions, source.adaptation.assetId);
      clip = {
        ...clip,
        metadata: {
          ...clip.metadata,
          ...source.adaptation.metadata,
          derivedFrom: `${resolvedLibrary!.asset.id}@${resolvedLibrary!.asset.version}`,
          retargetGeometry: target.asset.id,
          adaptationGenerator: 'videoer.phase-gait-retarget.v1',
        },
      };
      path = resolve(root, source.path!);
      await saveMotionClip(path, clip);
      const biomechanics = verifyCasualWalkMotion(clip);
      if (!biomechanics.valid)
        throw new Error(
          `Motion adaptation '${source.id}' failed biomechanical gates: ${biomechanics.issues.join('; ')}`,
        );
      const reportPath = resolve(
        root,
        'work',
        'adaptations',
        source.id,
        'compatibility-report.json',
      );
      await mkdir(dirname(reportPath), { recursive: true });
      const targetReference = geometryLibraryReferences.get(source.adaptation.targetGeometry);
      const report = {
        schemaVersion: 1,
        sourceId: source.id,
        adaptationKind: source.adaptation.kind,
        baseAsset: { id: resolvedLibrary!.asset.id, version: resolvedLibrary!.asset.version },
        baseArtifact: sourcePath,
        baseMotionSha256: await sha256File(sourcePath),
        adaptedAssetId: clip.id,
        adaptedArtifact: path,
        adaptedMotionSha256: await sha256File(path),
        targetGeometry: {
          sourceId: source.adaptation.targetGeometry,
          assetId: target.asset.id,
          ...(targetReference ? { libraryAsset: targetReference } : {}),
          sha256: await sha256File(target.path),
        },
        skeleton: {
          source: base.skeleton,
          adapted: clip.skeleton,
          targetJoints: target.asset.skeleton.map((joint) => joint.id),
          compatible: validateMotionClip(clip, target.asset).valid,
        },
        proportions: {
          source: base.metadata.proportions,
          target: targetProportions,
        },
        requestedCapabilities: source.library!.capabilities,
        missingBaseCapabilities: resolvedLibrary!.missingCapabilities,
        providedCapabilities: source.adaptation.providesCapabilities,
        biomechanics,
      };
      if (!report.skeleton.compatible)
        throw new Error(`Motion adaptation '${source.id}' is incompatible with target geometry`);
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      resolvedLibrary!.resolutionRecord.adaptedPath = portablePath(
        dirname(assetManifestFile),
        path,
      );
      resolvedLibrary!.resolutionRecord.compatibilityReport = portablePath(
        dirname(assetManifestFile),
        reportPath,
      );
      motionAdaptationReports.set(source.id, {
        path: reportPath,
        baseAsset: { id: resolvedLibrary!.asset.id, version: resolvedLibrary!.asset.version },
        ...(targetReference ? { targetAsset: targetReference } : {}),
      });
    } else if (!source.recipe) clip = await loadMotionClip(sourcePath);
    else if (source.recipe.kind === 'walk-style') clip = createWalkStyleMotion(source.recipe.style);
    else if (source.recipe.kind === 'turn')
      clip = createTurnMotion(source.recipe.direction, source.recipe.scope);
    else if (source.recipe.kind === 'targeted-turn') {
      const targetGeometry = geometry.get(source.recipe.target.geometry)!;
      const target = resolveAttachment(
        targetGeometry.asset,
        source.recipe.target.attachmentId,
        source.recipe.target.transform,
      ).position;
      clip = createTargetedTurnMotion(
        source.recipe.actorTransform,
        target,
        source.recipe.scope,
        source.recipe.durationSeconds,
        source.recipe.maximumYawRadians,
      );
    } else {
      const recipe = source.recipe;
      const cue = campaign.soundtrack.cues.find(
        (candidate) => candidate.id === recipe.soundtrackCue,
      );
      if (!cue || cue.kind !== 'speech')
        throw new Error(`Speech motion '${source.id}' references a missing speech cue`);
      const events = speechSources.get(cue.id)!.events;
      clip = createVisemeMotion({
        id: `motion.${source.id}`,
        text: cue.text!,
        events,
        durationSeconds: cue.endSeconds - cue.startSeconds,
        fps: campaign.fps,
        voice: { voice: cue.voice!, rate: cue.rate!, pitch: cue.pitch! },
      });
      const speechVerification = verifyVisemeMotion(clip);
      if (!speechVerification.valid)
        throw new Error(
          `Speech motion '${source.id}' failed viseme gates: ${speechVerification.issues.join('; ')}`,
        );
      const target = geometry.get(recipe.targetGeometry)!;
      const compatibility = validateMotionClip(clip, target.asset);
      if (!compatibility.valid)
        throw new Error(
          `Speech motion '${source.id}' is incompatible with '${recipe.targetGeometry}': ${compatibility.issues.map((issue) => issue.message).join('; ')}`,
        );
    }
    const validation = validateMotionClip(clip);
    if (!validation.valid)
      throw new Error(
        `Motion '${source.id}' failed validation: ${validation.issues.map((issue) => issue.message).join('; ')}`,
      );
    if (source.recipe) await saveMotionClip(path, clip);
    if (source.recipe?.kind === 'speech-visemes') {
      const recipe = source.recipe;
      const cue = campaign.soundtrack.cues.find(
        (candidate) => candidate.id === recipe.soundtrackCue,
      )!;
      const speech = speechSources.get(cue.id)!;
      const audioReport = speechAudioReports.get(cue.id);
      const targetSource = campaign.geometry.find(
        (candidate) => candidate.id === recipe.targetGeometry,
      )!;
      const targetAsset = targetSource.adaptation?.publication
        ? {
            id: targetSource.adaptation.publication.assetId,
            version: targetSource.adaptation.publication.version,
          }
        : geometryLibraryReferences.get(targetSource.id);
      if (source.publication && (!audioReport || !targetAsset))
        throw new Error(
          `Published speech motion '${source.id}' requires published speech audio and target geometry`,
        );
      if (source.publication && audioReport && targetAsset) {
        const reportPath = resolve(
          root,
          'work',
          'adaptations',
          source.id,
          'speech-performance-report.json',
        );
        await mkdir(dirname(reportPath), { recursive: true });
        const visemeVerification = verifyVisemeMotion(clip);
        const target = geometry.get(recipe.targetGeometry)!;
        const targetCompatibility = validateMotionClip(clip, target.asset);
        const bindings = campaign.shots.flatMap((shot, shotIndex) => {
          const priorFrames = campaign.shots
            .slice(0, shotIndex)
            .reduce((sum, candidate) => sum + candidate.frames, 0);
          return shot.entities.flatMap((entity) =>
            entity.motion?.source === source.id
              ? [
                  {
                    shot: shot.id,
                    startSeconds: (priorFrames + entity.motion.startFrame) / campaign.fps,
                    endSeconds:
                      (priorFrames + (entity.motion.endFrame ?? shot.frames)) / campaign.fps,
                  },
                ]
              : [],
          );
        });
        const audiovisualSync = {
          valid:
            bindings.length > 0 &&
            bindings.every(
              (binding) =>
                Math.abs(binding.startSeconds - cue.startSeconds) <= 1 / campaign.fps + 1e-8 &&
                Math.abs(binding.endSeconds - cue.endSeconds) <= 1 / campaign.fps + 1e-8,
            ),
          toleranceSeconds: 1 / campaign.fps,
          cue: { startSeconds: cue.startSeconds, endSeconds: cue.endSeconds },
          bindings,
        };
        await writeFile(
          reportPath,
          `${JSON.stringify(
            {
              schemaVersion: 1,
              derivationKind: 'speech-performance',
              derivedAssetId: source.publication.assetId,
              derivedMotionSha256: await sha256File(path),
              audio: {
                libraryAsset: audioReport.asset,
                sha256: await sha256File(speech.audioPath),
                eventsSha256: await sha256File(speech.eventsPath),
              },
              targetGeometry: {
                libraryAsset: targetAsset,
                sha256: await sha256File(target.path),
              },
              visemeVerification,
              targetCompatibility,
              audiovisualSync,
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
        speechPerformanceReports.set(source.id, {
          path: reportPath,
          audioAsset: audioReport.asset,
          targetAsset,
        });
      }
    }
    if (!source.library)
      assetResolutions.push({
        requirementId: source.id,
        decision: source.recipe ? 'create' : 'reuse',
        path: portablePath(dirname(assetManifestFile), path),
        candidates: [],
        reason: source.recipe
          ? 'Campaign declares a deterministic motion recipe.'
          : 'Campaign supplies an existing local persisted motion.',
      });
    const biomechanics =
      source.recipe?.kind === 'walk-style' ||
      clip.metadata.generator === 'videoer.phase-gait.v1' ||
      clip.metadata.generator === 'videoer.phase-gait.v2' ||
      clip.metadata.generator === 'videoer.phase-gait.v3' ||
      clip.metadata.generator === 'videoer.phase-gait.v4'
        ? verifyCasualWalkMotion(clip)
        : undefined;
    if (biomechanics && !biomechanics.valid)
      throw new Error(
        `Motion '${source.id}' failed biomechanical gates: ${biomechanics.issues.join('; ')}`,
      );
    motions.set(source.id, { path, clip });
    motionChecks.push({
      id: source.id,
      path,
      validation,
      ...(biomechanics ? { biomechanics } : {}),
    });
  }
  for (const timeline of campaign.motionTimelines) {
    const first = motions.get(timeline.layers[0]!.motion)!;
    const definition = {
      id: timeline.clipId,
      skeleton: first.clip.skeleton,
      durationSeconds: timeline.frames / campaign.fps,
      fps: campaign.fps,
      layers: timeline.layers.map((layer) => ({
        id: layer.id,
        clip: motions.get(layer.motion)!.clip,
        mode: layer.mode,
        startSeconds: layer.startFrame / campaign.fps,
        endSeconds: layer.endFrame / campaign.fps,
        playback: layer.playback,
        weight: layer.weight,
        fadeInSeconds: layer.fadeInFrames / campaign.fps,
        fadeOutSeconds: layer.fadeOutFrames / campaign.fps,
        ...(layer.sourceStartSeconds !== undefined
          ? { sourceStartSeconds: layer.sourceStartSeconds }
          : {}),
        ...(layer.sourceEndSeconds !== undefined
          ? { sourceEndSeconds: layer.sourceEndSeconds }
          : {}),
        ...(layer.joints ? { joints: layer.joints } : {}),
        ...(layer.morphTargets ? { morphTargets: layer.morphTargets } : {}),
        ...(layer.minimumContribution !== undefined
          ? { minimumContribution: layer.minimumContribution }
          : {}),
      })),
      metadata: { declarativeCampaign: campaign.id, ...timeline.metadata },
    };
    const clip = composeMotionTimeline(definition);
    const compositionVerification = verifyMotionTimelineComposition(definition, clip, {
      requireMaskedNonBase: Boolean(timeline.derivation),
    });
    if (!compositionVerification.valid)
      throw new Error(
        `Motion timeline '${timeline.id}' failed composition gates: ${compositionVerification.issues.join('; ')}`,
      );
    const path = resolve(root, timeline.path);
    await saveMotionClip(path, clip);
    const target = timeline.derivation
      ? geometry.get(timeline.derivation.targetGeometry)!
      : undefined;
    const targetValidation = target ? validateMotionClip(clip, target.asset) : undefined;
    if (targetValidation && !targetValidation.valid)
      throw new Error(
        `Layered performance '${timeline.id}' is incompatible with target geometry: ${targetValidation.issues.map((issue) => issue.message).join('; ')}`,
      );
    if (timeline.derivation) {
      const targetReference = geometryLibraryReferences.get(timeline.derivation.targetGeometry)!;
      const layerInputs = timeline.layers.map((layer) => {
        const input = motionLibraryInputs.get(layer.motion);
        if (!input)
          throw new Error(
            `Layered performance '${timeline.id}' requires directly reused verified input '${layer.motion}'`,
          );
        return { layer, input };
      });
      const reportPath = resolve(
        root,
        'work',
        'adaptations',
        timeline.id,
        'compatibility-report.json',
      );
      await mkdir(dirname(reportPath), { recursive: true });
      const report = {
        schemaVersion: 1,
        sourceId: timeline.id,
        derivationKind: timeline.derivation.kind,
        derivedAssetId: clip.id,
        derivedArtifact: path,
        derivedMotionSha256: await sha256File(path),
        skeleton: {
          output: clip.skeleton,
          targetJoints: target!.asset.skeleton.map((joint) => joint.id),
          compatible: targetValidation!.valid,
        },
        targetGeometry: {
          sourceId: timeline.derivation.targetGeometry,
          libraryAsset: targetReference,
          sha256: await sha256File(target!.path),
        },
        layers: await Promise.all(
          layerInputs.map(async ({ layer, input }) => ({
            id: layer.id,
            sourceId: layer.motion,
            libraryAsset: input.asset,
            artifactRole: input.artifactRole,
            artifactSha256: await sha256File(input.path),
            mode: layer.mode,
            startFrame: layer.startFrame,
            endFrame: layer.endFrame,
            playback: layer.playback,
            sourceStartSeconds: layer.sourceStartSeconds ?? 0,
            sourceEndSeconds:
              layer.sourceEndSeconds ?? motions.get(layer.motion)!.clip.durationSeconds,
            weight: layer.weight,
            fadeInFrames: layer.fadeInFrames,
            fadeOutFrames: layer.fadeOutFrames,
            ...(layer.joints ? { joints: layer.joints } : {}),
            ...(layer.minimumContribution !== undefined
              ? { minimumContribution: layer.minimumContribution }
              : {}),
          })),
        ),
        providedCapabilities: timeline.derivation.providesCapabilities,
        compositionVerification,
        targetValidation,
      };
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      const uniqueSourceAssets = [
        ...new Map(
          layerInputs.map(({ input }) => [`${input.asset.id}@${input.asset.version}`, input.asset]),
        ).values(),
      ];
      layeredPerformanceReports.set(timeline.id, {
        path: reportPath,
        sourceAssets: uniqueSourceAssets,
        targetAsset: targetReference,
      });
    }
    motions.set(timeline.id, { path, clip });
    assetResolutions.push({
      requirementId: timeline.id,
      decision: timeline.derivation ? 'adapt' : 'create',
      path: portablePath(dirname(assetManifestFile), path),
      candidates: [],
      reason: timeline.derivation
        ? 'Campaign declares a deterministic multi-parent layered performance derivation.'
        : 'Campaign declares a deterministic layered motion timeline.',
      ...(timeline.derivation
        ? {
            compatibilityReport: portablePath(
              dirname(assetManifestFile),
              layeredPerformanceReports.get(timeline.id)!.path,
            ),
          }
        : {}),
    });
    motionChecks.push({
      id: timeline.id,
      path,
      validation: validateMotionClip(clip),
      compositionVerification,
      ...(targetValidation ? { targetValidation } : {}),
    });
  }
  const motionReport = resolve(root, 'work', 'motions', 'motion-build-report.json');
  await mkdir(dirname(motionReport), { recursive: true });
  await writeFile(
    motionReport,
    `${JSON.stringify({ schemaVersion: 1, campaign: campaign.id, motions: motionChecks }, null, 2)}\n`,
    'utf8',
  );
  await writeAssetManifest();

  const overlays = new Map<string, string>();
  const editorialAdaptationReports = new Map<
    string,
    {
      path: string;
      treatmentPath: string;
      baseAsset: { id: string; version: string };
    }
  >();
  for (const overlay of campaign.overlays) {
    if ('library' in overlay) {
      const resolved = await libraryArtifact(
        overlay.id,
        overlay.library,
        'adaptation' in overlay ? overlay.adaptation : undefined,
      );
      if ('adaptation' in overlay) {
        const base = await loadTitleTreatment(resolved.path);
        const treatment = adaptEditorialTreatment(base, overlay.adaptation);
        const adaptationVerification = verifyEditorialTreatmentAdaptation(
          base,
          treatment,
          overlay.adaptation,
        );
        if (!adaptationVerification.valid)
          throw new Error(
            `Editorial adaptation '${overlay.id}' failed semantic gates: ${adaptationVerification.issues.join('; ')}`,
          );
        const treatmentPath = resolve(root, overlay.treatmentPath);
        const path = resolve(root, overlay.path);
        const fontPath = await resolveCormorantGaramondFont();
        await saveTitleTreatment(treatmentPath, treatment);
        await renderEditorialTreatment(treatment, fontPath, path);
        const renderingVerification = await verifyEditorialTreatmentRendering(
          treatment,
          fontPath,
          path,
        );
        if (!renderingVerification.valid)
          throw new Error(
            `Editorial adaptation '${overlay.id}' failed rendering gates: ${renderingVerification.issues.join('; ')}`,
          );
        const reportPath = resolve(
          root,
          'work',
          'adaptations',
          overlay.id,
          'compatibility-report.json',
        );
        await mkdir(dirname(reportPath), { recursive: true });
        const report = {
          schemaVersion: 1,
          adaptationKind: overlay.adaptation.kind,
          sourceId: overlay.id,
          baseAsset: { id: resolved.asset.id, version: resolved.asset.version },
          baseArtifact: resolved.path,
          baseArtifactRole: overlay.library.artifactRole,
          baseEditorialSha256: await sha256File(resolved.path),
          adaptedAssetId: treatment.id,
          adaptedTreatment: treatmentPath,
          adaptedTreatmentSha256: await sha256File(treatmentPath),
          adaptedArtifact: path,
          adaptedEditorialSha256: await sha256File(path),
          requestedCapabilities: overlay.library.capabilities,
          missingBaseCapabilities: resolved.missingCapabilities,
          providedCapabilities: overlay.adaptation.providesCapabilities,
          adaptation: adaptationVerification.adaptation,
          operations: {
            fontChanged: !adaptationVerification.fontPreserved,
            motifChanged: !adaptationVerification.motifPreserved,
            deterministicPixelsChanged: !renderingVerification.deterministicRenderMatched,
            safeAreaViolated: !renderingVerification.linesInsideSafeArea,
          },
          compatibility: {
            fontPreserved: adaptationVerification.fontPreserved,
            motifPreserved: adaptationVerification.motifPreserved,
            exactTreatmentMatched: adaptationVerification.exactTreatmentMatched,
            deterministicRenderMatched: renderingVerification.deterministicRenderMatched,
            dimensionsMatched: renderingVerification.dimensionsMatched,
            linesInsideSafeArea: renderingVerification.linesInsideSafeArea,
            contrast: renderingVerification.contrast,
            fontSha256: renderingVerification.fontSha256,
          },
          validation: {
            valid: adaptationVerification.valid && renderingVerification.valid,
            adaptation: adaptationVerification,
            rendering: renderingVerification,
          },
        };
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        resolved.resolutionRecord.adaptedPath = portablePath(dirname(assetManifestFile), path);
        resolved.resolutionRecord.compatibilityReport = portablePath(
          dirname(assetManifestFile),
          reportPath,
        );
        editorialAdaptationReports.set(overlay.id, {
          path: reportPath,
          treatmentPath,
          baseAsset: { id: resolved.asset.id, version: resolved.asset.version },
        });
        overlays.set(overlay.id, path);
      } else overlays.set(overlay.id, resolved.path);
    } else {
      const path = resolve(root, overlay.path);
      const fontPath = await resolveCormorantGaramondFont();
      await renderTextOverlay({ ...overlay, fontPath }, path);
      overlays.set(overlay.id, path);
    }
  }
  await writeAssetManifest();

  const soundtrackPath = resolve(root, campaign.soundtrackPath);
  await saveSoundtrackPlan(
    join(dirname(soundtrackPath), 'soundtrack-plan.json'),
    campaign.soundtrack,
  );
  await renderSoundtrackPlan(campaign.soundtrack, soundtrackPath, {
    speechSources: Object.fromEntries(
      [...speechSources].map(([cueId, source]) => [cueId, source.audioPath]),
    ),
    audioSources: Object.fromEntries(resolvedAudioSources),
  });

  type PreparedClothingDeformation = {
    target: GeometryAsset;
    geometryPath: string;
    motion: MotionClip;
    motionPath: string;
  };
  const clothingDeformationCache = new Map<string, Promise<PreparedClothingDeformation>>();
  const sceneResults: Array<{
    scene: string;
    sceneFile: string;
    render?: Awaited<ReturnType<typeof renderCinematicScene>>;
    renderError?: string;
  }> = [];
  const scenes = [];
  for (const shot of campaign.shots) {
    const sceneDirectory = resolve(root, 'work', 'scenes', shot.id);
    await mkdir(sceneDirectory, { recursive: true });
    const durationSeconds = shot.frames / campaign.fps;
    const geometryByEntity: Record<string, GeometryAsset> = {};
    const entityDefinitions = new Map(shot.entities.map((entity) => [entity.id, entity]));
    const resolvedTransforms = new Map<string, (typeof shot.entities)[number]['transform']>();
    const resolvingTransforms = new Set<string>();
    const resolveEntityTransform = (
      entity: (typeof shot.entities)[number],
    ): (typeof shot.entities)[number]['transform'] => {
      const existing = resolvedTransforms.get(entity.id);
      if (existing) return existing;
      if (resolvingTransforms.has(entity.id))
        throw new Error(`Cyclic semantic entity placement in shot '${shot.id}' at '${entity.id}'`);
      resolvingTransforms.add(entity.id);
      let transform = entity.transform;
      if (entity.placement) {
        const anchorEntity = entityDefinitions.get(entity.placement.entityId)!;
        const anchorTransform = resolveEntityTransform(anchorEntity);
        const anchorGeometry = geometry.get(anchorEntity.geometry)!.asset;
        const attachment = resolveAttachment(
          anchorGeometry,
          entity.placement.attachmentId,
          anchorTransform,
        );
        transform = {
          ...entity.transform,
          position: attachment.position.map(
            (value, index) => value + entity.placement!.offset[index]!,
          ) as [number, number, number],
        };
      }
      resolvingTransforms.delete(entity.id);
      resolvedTransforms.set(entity.id, transform);
      return transform;
    };
    const entities = [];
    for (const entity of shot.entities) {
      const source = geometry.get(entity.geometry)!;
      const transform = resolveEntityTransform(entity);
      const motion = entity.motion ? motions.get(entity.motion.source)! : undefined;
      const prepareAnimatedEntity = async (
        targetId: string,
        target: GeometryAsset,
        geometryPath: string,
        body: GeometryAsset,
      ) => {
        if (!motion || !entity.motion)
          return { target, geometryPath, motionBinding: {} as Record<string, never> };
        const validation = validateMotionClip(motion.clip, target);
        if (!validation.valid)
          throw new Error(
            `Motion '${entity.motion.source}' is incompatible with entity '${targetId}': ${validation.issues.map((issue) => issue.message).join('; ')}`,
          );
        if (
          entity.motion.sourceEndSeconds !== undefined &&
          entity.motion.sourceEndSeconds > motion.clip.durationSeconds
        )
          throw new Error(
            `Motion '${entity.motion.source}' source interval exceeds ${motion.clip.durationSeconds}s`,
          );
        let resolvedGeometry = target;
        let resolvedMotion = motion.clip;
        let resolvedGeometryPath = geometryPath;
        let resolvedMotionPath = motion.path;
        const hasLongDress =
          target.metadata.clothingSkinningPolicy === 'long-dress-drape-v1' &&
          target.materialGroups.some((group) => group.materialId === 'dress');
        if (hasLongDress) {
          const [targetHash, bodyHash, motionHash] = await Promise.all([
            sha256File(geometryPath),
            sha256File(source.path),
            sha256File(motion.path),
          ]);
          const cacheKey = `${targetHash}:${bodyHash}:${motionHash}`;
          let prepared = clothingDeformationCache.get(cacheKey);
          if (!prepared) {
            prepared = (async () => {
              const initial = verifyTemporalClothing(target, body, motion.clip);
              if (initial.valid)
                return {
                  target,
                  geometryPath,
                  motion: motion.clip,
                  motionPath: motion.path,
                };
              const artifactKey = `${targetHash.slice(0, 12)}-${bodyHash.slice(0, 12)}-${motionHash.slice(0, 12)}`;
              const correctionDirectory = resolve(
                libraryRoot,
                '..',
                '.videoer-cache',
                'deformations',
                artifactKey,
              );
              const cachedGeometryPath = join(correctionDirectory, 'geometry.json');
              const cachedMotionPath = join(correctionDirectory, 'motion.json');
              const cachedReportPath = join(correctionDirectory, 'temporal-clothing-report.json');
              try {
                await Promise.all([
                  access(cachedGeometryPath),
                  access(cachedMotionPath),
                  access(cachedReportPath),
                ]);
                const [cachedGeometry, cachedMotion, cachedReport] = await Promise.all([
                  loadGeometry(cachedGeometryPath),
                  loadMotionClip(cachedMotionPath),
                  readFile(cachedReportPath, 'utf8').then((value) => JSON.parse(value)),
                ]);
                const cacheInputsMatch =
                  cachedReport?.inputs?.targetGeometrySha256 === targetHash &&
                  cachedReport?.inputs?.bodyGeometrySha256 === bodyHash &&
                  cachedReport?.inputs?.motionSha256 === motionHash;
                const cachedMotionValidation = validateMotionClip(cachedMotion, cachedGeometry);
                const cachedTemporalValidation = verifyTemporalClothing(
                  cachedGeometry,
                  body,
                  cachedMotion,
                );
                if (
                  cacheInputsMatch &&
                  cachedMotionValidation.valid &&
                  cachedTemporalValidation.valid
                )
                  return {
                    target: cachedGeometry,
                    geometryPath: cachedGeometryPath,
                    motion: cachedMotion,
                    motionPath: cachedMotionPath,
                  };
              } catch {
                // A missing, partial, or stale derived cache is regenerated from its source hashes.
              }
              const corrected = bakePoseSpaceClothCorrectives(target, body, motion.clip, {
                targetPrefix: `cloth-${artifactKey}`,
              });
              const final = verifyTemporalClothing(corrected.geometry, body, corrected.motion);
              if (!final.valid)
                throw new Error(
                  `Pose-space clothing correction failed for '${targetId}': ${final.issues.join('; ')}; ${JSON.stringify({ collision: final.collision, silhouette: final.silhouette, correction: corrected.report })}`,
                );
              const correctedGeometryPath = await saveGeometry(
                join(correctionDirectory, 'geometry.json'),
                corrected.geometry,
              );
              const correctedMotionPath = await saveMotionClip(
                join(correctionDirectory, 'motion.json'),
                corrected.motion,
              );
              await writeFile(
                join(correctionDirectory, 'temporal-clothing-report.json'),
                `${JSON.stringify(
                  {
                    schemaVersion: 1,
                    cacheKey: artifactKey,
                    inputs: {
                      targetGeometrySha256: targetHash,
                      bodyGeometrySha256: bodyHash,
                      motionSha256: motionHash,
                    },
                    initial,
                    correction: corrected.report,
                    final,
                  },
                  null,
                  2,
                )}\n`,
                'utf8',
              );
              return {
                target: corrected.geometry,
                geometryPath: correctedGeometryPath,
                motion: corrected.motion,
                motionPath: correctedMotionPath,
              };
            })();
            clothingDeformationCache.set(cacheKey, prepared);
          }
          const result = await prepared;
          resolvedGeometry = result.target;
          resolvedGeometryPath = result.geometryPath;
          resolvedMotion = result.motion;
          resolvedMotionPath = result.motionPath;
        }
        const correctedValidation = validateMotionClip(resolvedMotion, resolvedGeometry);
        if (!correctedValidation.valid)
          throw new Error(
            `Prepared motion for '${targetId}' is incompatible: ${correctedValidation.issues.map((issue) => issue.message).join('; ')}`,
          );
        return {
          target: resolvedGeometry,
          geometryPath: resolvedGeometryPath,
          motionBinding: {
            motion: {
              path: portablePath(sceneDirectory, resolvedMotionPath),
              startSeconds: entity.motion.startFrame / campaign.fps,
              endSeconds: (entity.motion.endFrame ?? shot.frames) / campaign.fps,
              sourceStartSeconds: entity.motion.sourceStartSeconds,
              sourceEndSeconds: entity.motion.sourceEndSeconds,
            },
          },
        };
      };
      const preparedBase = await prepareAnimatedEntity(
        entity.id,
        source.asset,
        source.path,
        source.asset,
      );
      geometryByEntity[entity.id] = preparedBase.target;
      const baseEntity = {
        id: entity.id,
        role: entity.role,
        geometryPath: portablePath(sceneDirectory, preparedBase.geometryPath),
        ...(source.productionRigProfilePath
          ? {
              productionRigProfilePath: portablePath(
                sceneDirectory,
                source.productionRigProfilePath,
              ),
            }
          : {}),
        ...(source.productionCharacterBindingPath
          ? {
              productionCharacterBindingPath: portablePath(
                sceneDirectory,
                source.productionCharacterBindingPath,
              ),
            }
          : {}),
        transform,
        ...preparedBase.motionBinding,
      };
      const wardrobeEntities = [];
      for (const binding of entity.wardrobe) {
        const garment = clothing.get(binding.clothing)!;
        if (garment.targetGeometrySource && garment.targetGeometrySource !== entity.geometry)
          throw new Error(
            `Clothing '${binding.clothing}' was fitted to '${garment.targetGeometrySource}', not '${entity.geometry}'`,
          );
        if (!garment.targetGeometrySource) {
          const fitCharacter =
            garment.asset.metadata.targetGeometry ??
            garment.asset.metadata.fitCharacter ??
            garment.asset.metadata.sourceGeometry;
          const derivedFrom = source.asset.metadata.derivedFrom;
          if (
            fitCharacter !== source.asset.id &&
            !(typeof derivedFrom === 'string' && derivedFrom.startsWith(`${String(fitCharacter)}@`))
          )
            throw new Error(
              `Clothing '${binding.clothing}' is fitted to '${String(fitCharacter)}', not '${source.asset.id}'; declare a canonical clothing-fit adaptation`,
            );
        }
        const wardrobeId = `${entity.id}--${binding.clothing}`;
        const preparedWardrobe = await prepareAnimatedEntity(
          wardrobeId,
          garment.asset,
          garment.path,
          source.asset,
        );
        geometryByEntity[wardrobeId] = preparedWardrobe.target;
        wardrobeEntities.push({
          id: wardrobeId,
          role: 'set-dressing' as const,
          geometryPath: portablePath(sceneDirectory, preparedWardrobe.geometryPath),
          transform,
          ...preparedWardrobe.motionBinding,
        });
      }
      entities.push(baseEntity, ...wardrobeEntities);
    }
    const scene = assembleCinematicShot(
      {
        schemaVersion: 1,
        id: `scene.${shot.id}`,
        durationSeconds,
        fps: campaign.fps,
        resolution: campaign.resolution,
        entities,
        camera: {
          keyframes: shot.camera.keyframes.map((keyframe) => ({
            ...keyframe,
            position: pointReference(keyframe.position),
            target: pointReference(keyframe.target),
          })),
        },
        lights: [
          ...(shot.lighting
            ? lighting.get(shot.lighting)!.lights.map(({ purpose, ...light }) => {
                void purpose;
                return light;
              })
            : []),
          ...shot.lights,
        ],
        atmosphere: shot.vfx ? toCinematicAtmosphere(vfx.get(shot.vfx)!.asset) : shot.atmosphere!,
        ...(shot.finish
          ? { finishProfilePath: portablePath(sceneDirectory, finishPaths.get(shot.finish)!) }
          : {}),
        overlays: shot.overlays.map((overlay) => ({
          ...overlay,
          id: overlay.overlay,
          imagePath: portablePath(sceneDirectory, overlays.get(overlay.overlay)!),
        })),
        renderGates: shot.renderGates,
        qualityGates: shot.qualityGates,
        landmarks: shot.landmarks,
        metadata: {
          declarativeCampaign: campaign.id,
          templateSource: portablePath(sceneDirectory, sourceFile),
          ...shot.metadata,
        },
      },
      { geometryByEntity },
    );
    const sceneFile = await saveCinematicScene(join(sceneDirectory, 'scene.json'), scene);
    scenes.push({ shot, scene, sceneDirectory });
    const shouldRender =
      options.render && (!requestedRenderShots || requestedRenderShots.has(shot.id));
    if (!shouldRender) sceneResults.push({ scene: scene.id, sceneFile });
    else {
      try {
        sceneResults.push({
          scene: scene.id,
          sceneFile,
          render: await renderCinematicScene(sceneFile, join(sceneDirectory, 'verification')),
        });
      } catch (error) {
        if (!options.continueOnRenderFailure) throw error;
        sceneResults.push({
          scene: scene.id,
          sceneFile,
          renderError: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const editDirectory = resolve(root, 'work', 'edit');
  const editPlan = editPlanSchema.parse({
    schemaVersion: 1,
    id: campaign.delivery.id,
    fps: campaign.fps,
    resolution: campaign.resolution,
    clips: scenes.map(({ shot, scene, sceneDirectory }) => ({
      id: shot.id,
      path: portablePath(
        editDirectory,
        join(sceneDirectory, 'verification', cinematicDeliveryFilename(scene)),
      ),
      frames: shot.frames,
    })),
    audioPath: portablePath(editDirectory, soundtrackPath),
    delivery: {
      codec: campaign.delivery.codec,
      pixelFormat: campaign.delivery.pixelFormat,
      fastStart: campaign.delivery.fastStart,
    },
    metadata: { declarativeCampaign: campaign.id, ...campaign.metadata },
  });
  const editPlanFile = await saveEditPlan(join(editDirectory, 'edit-plan.json'), editPlan);
  const renderFailures = sceneResults.filter((result) => result.renderError);
  const delivery =
    options.render && renderFailures.length === 0
      ? await assembleEdit(editPlanFile, resolve(root, campaign.delivery.directory))
      : undefined;
  const publicationItems: CampaignPublicationInput[] = [
    ...campaign.overlays.flatMap((source) =>
      'adaptation' in source
        ? [
            {
              sourceId: source.id,
              artifactPath: overlays.get(source.id)!,
              artifactRole: 'transparent-overlay' as const,
              mediaType: 'image/png',
              publication: source.adaptation.publication,
              requires: [editorialAdaptationReports.get(source.id)!.baseAsset],
              sourceAsset: `${editorialAdaptationReports.get(source.id)!.baseAsset.id}@${editorialAdaptationReports.get(source.id)!.baseAsset.version}`,
              extraEvidence: [
                {
                  path: editorialAdaptationReports.get(source.id)!.treatmentPath,
                  role: 'editorial-treatment',
                  mediaType: 'application/vnd.videoer.title+json',
                },
                {
                  path: editorialAdaptationReports.get(source.id)!.path,
                  role: 'verification-editorial-adaptation-compatibility',
                  mediaType: 'application/json',
                },
              ],
            },
          ]
        : [],
    ),
    ...campaign.lightingSources.flatMap((source) =>
      source.adaptation?.publication
        ? [
            {
              sourceId: source.id,
              artifactPath: lightingPaths.get(source.id)!,
              artifactRole: 'lighting' as const,
              mediaType: 'application/vnd.videoer.lighting+json',
              publication: source.adaptation.publication,
              requires: [lightingAdaptationReports.get(source.id)!.baseAsset],
              sourceAsset: `${lightingAdaptationReports.get(source.id)!.baseAsset.id}@${lightingAdaptationReports.get(source.id)!.baseAsset.version}`,
              extraEvidence: [
                {
                  path: lightingAdaptationReports.get(source.id)!.path,
                  role: 'verification-lighting-adaptation-compatibility',
                  mediaType: 'application/json',
                },
              ],
            },
          ]
        : [],
    ),
    ...campaign.audioSources.flatMap((source) =>
      source.adaptation?.publication
        ? [
            {
              sourceId: source.id,
              artifactPath: resolvedAudioSources.get(source.id)!,
              artifactRole: 'audio' as const,
              mediaType: 'audio/wav',
              publication: source.adaptation.publication,
              requires: [audioAdaptationReports.get(source.id)!.baseAsset],
              sourceAsset: `${audioAdaptationReports.get(source.id)!.baseAsset.id}@${audioAdaptationReports.get(source.id)!.baseAsset.version}`,
              extraEvidence: [
                {
                  path: audioAdaptationReports.get(source.id)!.path,
                  role: 'verification-audio-adaptation-compatibility',
                  mediaType: 'application/json',
                },
              ],
            },
          ]
        : [],
    ),
    ...campaign.clothingSources.flatMap((source) =>
      source.adaptation?.publication
        ? [
            {
              sourceId: source.id,
              artifactPath: clothing.get(source.id)!.path,
              artifactRole: 'geometry' as const,
              mediaType: 'application/vnd.videoer.geometry+json',
              publication: source.adaptation.publication,
              requires: [
                clothingAdaptationReports.get(source.id)!.baseAsset,
                clothingAdaptationReports.get(source.id)!.targetAsset!,
              ],
              sourceAsset: `${clothingAdaptationReports.get(source.id)!.baseAsset.id}@${clothingAdaptationReports.get(source.id)!.baseAsset.version}`,
              extraEvidence: [
                {
                  path: clothingAdaptationReports.get(source.id)!.path,
                  role: 'verification-clothing-adaptation-compatibility',
                  mediaType: 'application/json',
                },
              ],
            },
          ]
        : [],
    ),
    ...campaign.materialSources.flatMap((source) =>
      source.adaptation?.publication
        ? [
            {
              sourceId: source.id,
              artifactPath: materials.get(source.id)!.path,
              artifactRole: 'material' as const,
              mediaType: 'application/vnd.videoer.surface-material+json',
              publication: source.adaptation.publication,
              requires: [materialAdaptationReports.get(source.id)!.baseAsset],
              sourceAsset: `${materialAdaptationReports.get(source.id)!.baseAsset.id}@${materialAdaptationReports.get(source.id)!.baseAsset.version}`,
              extraEvidence: [
                {
                  path: materialAdaptationReports.get(source.id)!.path,
                  role: 'verification-material-adaptation-compatibility',
                  mediaType: 'application/json',
                },
              ],
            },
          ]
        : [],
    ),
    ...campaign.vfxSources.flatMap((source) =>
      source.adaptation?.publication
        ? [
            {
              sourceId: source.id,
              artifactPath: vfx.get(source.id)!.path,
              artifactRole: 'vfx' as const,
              mediaType: 'application/vnd.videoer.atmospheric-vfx+json',
              publication: source.adaptation.publication,
              requires: [vfxAdaptationReports.get(source.id)!.baseAsset],
              sourceAsset: `${vfxAdaptationReports.get(source.id)!.baseAsset.id}@${vfxAdaptationReports.get(source.id)!.baseAsset.version}`,
              extraEvidence: [
                {
                  path: vfxAdaptationReports.get(source.id)!.path,
                  role: 'verification-vfx-adaptation-compatibility',
                  mediaType: 'application/json',
                },
              ],
            },
          ]
        : [],
    ),
    ...campaign.geometry.flatMap((source) =>
      source.recipe?.publication || source.adaptation?.publication
        ? [
            {
              sourceId: source.id,
              artifactPath: geometry.get(source.id)!.path,
              artifactRole: 'geometry' as const,
              mediaType: 'application/vnd.videoer.geometry+json',
              publication: (source.recipe?.publication ?? source.adaptation!.publication)!,
              ...(geometryAdaptationReports.has(source.id)
                ? {
                    requires: [geometryAdaptationReports.get(source.id)!.baseAsset],
                    sourceAsset: `${geometryAdaptationReports.get(source.id)!.baseAsset.id}@${geometryAdaptationReports.get(source.id)!.baseAsset.version}`,
                    extraEvidence: [
                      {
                        path: geometryAdaptationReports.get(source.id)!.path,
                        role: 'verification-adaptation-compatibility',
                        mediaType: 'application/json',
                      },
                    ],
                  }
                : {}),
            },
          ]
        : [],
    ),
    ...campaign.speechPublications.map((speech) => {
      const source = speechSources.get(speech.cue)!;
      const report = speechAudioReports.get(speech.cue)!;
      return {
        sourceId: speech.cue,
        artifactPath: source.audioPath,
        artifactRole: 'audio' as const,
        mediaType: 'audio/wav',
        publication: speech.publication,
        extraEvidence: [
          {
            path: source.eventsPath,
            role: 'speech-events',
            mediaType: 'application/json',
          },
          {
            path: report.path,
            role: 'verification-speech-audio-lineage',
            mediaType: 'application/json',
          },
        ],
      };
    }),
    ...campaign.motions.flatMap((source) =>
      source.publication || source.adaptation?.publication
        ? [
            {
              sourceId: source.id,
              artifactPath: motions.get(source.id)!.path,
              artifactRole: 'motion' as const,
              mediaType: 'application/vnd.videoer.motion+json',
              publication: (source.publication ?? source.adaptation!.publication)!,
              ...(speechPerformanceReports.has(source.id)
                ? {
                    requires: [
                      speechPerformanceReports.get(source.id)!.audioAsset,
                      speechPerformanceReports.get(source.id)!.targetAsset,
                    ],
                    extraEvidence: [
                      {
                        path: speechPerformanceReports.get(source.id)!.path,
                        role: 'verification-speech-performance-compatibility',
                        mediaType: 'application/json',
                      },
                    ],
                  }
                : {}),
              ...(motionAdaptationReports.has(source.id)
                ? {
                    requires: [
                      motionAdaptationReports.get(source.id)!.baseAsset,
                      ...(motionAdaptationReports.get(source.id)!.targetAsset
                        ? [motionAdaptationReports.get(source.id)!.targetAsset!]
                        : []),
                    ],
                    sourceAsset: `${motionAdaptationReports.get(source.id)!.baseAsset.id}@${motionAdaptationReports.get(source.id)!.baseAsset.version}`,
                    extraEvidence: [
                      {
                        path: motionAdaptationReports.get(source.id)!.path,
                        role: 'verification-motion-adaptation-compatibility',
                        mediaType: 'application/json',
                      },
                    ],
                  }
                : {}),
            },
          ]
        : [],
    ),
    ...campaign.motionTimelines.flatMap((timeline) =>
      timeline.publication || timeline.derivation?.publication
        ? [
            {
              sourceId: timeline.id,
              artifactPath: motions.get(timeline.id)!.path,
              artifactRole: 'motion' as const,
              mediaType: 'application/vnd.videoer.motion+json',
              publication: (timeline.publication ?? timeline.derivation!.publication)!,
              ...(layeredPerformanceReports.has(timeline.id)
                ? {
                    requires: [
                      ...layeredPerformanceReports.get(timeline.id)!.sourceAssets,
                      layeredPerformanceReports.get(timeline.id)!.targetAsset,
                    ],
                    sourceAssets: layeredPerformanceReports
                      .get(timeline.id)!
                      .sourceAssets.map((asset) => `${asset.id}@${asset.version}`),
                    extraEvidence: [
                      {
                        path: layeredPerformanceReports.get(timeline.id)!.path,
                        role: 'verification-layered-performance-compatibility',
                        mediaType: 'application/json',
                      },
                    ],
                  }
                : {}),
            },
          ]
        : [],
    ),
  ];
  const publication =
    delivery && publicationItems.length
      ? await prepareCampaignPublicationCandidates({
          root,
          campaignId: campaign.id,
          campaignFile: sourceFile,
          libraryRoot,
          deliveryReport: delivery.report,
          items: publicationItems,
        })
      : undefined;
  const reportFile = resolve(root, 'declarative-build-report.json');
  const sourceLines = (await readFile(sourceFile, 'utf8')).trimEnd().split('\n').length;
  await writeFile(
    reportFile,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        campaign: campaign.id,
        sourceFile,
        sourceLines,
        bespokeOrchestrationSourceFiles: 0,
        generatedGeometry: campaign.geometry.filter((item) => item.recipe).length,
        adaptedGeometry: campaign.geometry.filter((item) => item.adaptation).length,
        reusedAudioSources: campaign.audioSources.filter((item) => !item.adaptation).length,
        adaptedAudioSources: campaign.audioSources.filter((item) => item.adaptation).length,
        reusedLightingSources: campaign.lightingSources.filter((item) => !item.adaptation).length,
        adaptedLightingSources: campaign.lightingSources.filter((item) => item.adaptation).length,
        generatedEditorialSources: campaign.overlays.filter((item) => !('library' in item)).length,
        reusedEditorialSources: campaign.overlays.filter(
          (item) => 'library' in item && !('adaptation' in item),
        ).length,
        adaptedEditorialSources: campaign.overlays.filter((item) => 'adaptation' in item).length,
        reusedVfxSources: campaign.vfxSources.filter((item) => !item.adaptation).length,
        adaptedVfxSources: campaign.vfxSources.filter((item) => item.adaptation).length,
        reusedFinishSources: campaign.finishSources.length,
        reusedMaterialSources: campaign.materialSources.filter((item) => !item.adaptation).length,
        adaptedMaterialSources: campaign.materialSources.filter((item) => item.adaptation).length,
        reusedClothingSources: campaign.clothingSources.filter((item) => !item.adaptation).length,
        adaptedClothingSources: campaign.clothingSources.filter((item) => item.adaptation).length,
        generatedMotionSources: campaign.motions.filter((item) => item.recipe).length,
        adaptedMotionSources: campaign.motions.filter((item) => item.adaptation).length,
        generatedMotionTimelines: campaign.motionTimelines.length,
        derivedMotionTimelines: campaign.motionTimelines.filter((item) => item.derivation).length,
        motionReport,
        assetManifestFile,
        publicationCandidatesDeclared: publicationItems.length,
        publicationCandidatesFile: publication?.manifestFile,
        scenes: sceneResults.map((result) => result.scene),
        renderedScenes: sceneResults
          .filter((result) => result.render)
          .map((result) => result.scene),
        renderFailures: renderFailures.map((result) => ({
          scene: result.scene,
          error: result.renderError,
        })),
        editPlanFile,
        delivery: delivery?.video,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return {
    root,
    campaign: campaign.id,
    scenes: sceneResults,
    renderFailures,
    editPlanFile,
    delivery,
    publication,
    reportFile,
  };
}
