import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import {
  buildAssetIndex,
  findAsset,
  loadAssetMetadata,
  publishAsset,
  sha256File,
  validateLibraryAsset,
} from '../assets/library.js';
import { campaignAssetPublicationSchema } from '../production/cinematic-campaign.js';
import { assetReferenceSchema } from '../production/model.js';
import type { AssetReference } from '../production/model.js';
import { inspectAudioDuration } from '../audio/render.js';
import { audioTreatmentSchema, verifyAudioTreatment } from '../audio/treatment.js';
import { loadGeometry } from '../geometry/io.js';
import { validateGeometry } from '../geometry/model.js';
import { verifyEnglishSpeechMorphRig } from '../characters/speech-rig.js';
import { loadMotionClip } from '../motion/io.js';
import { validateMotionClip } from '../motion/model.js';
import { verifyVisemeMotion } from '../speech/espeak.js';
import { loadAtmosphericVfx } from '../vfx/io.js';
import { verifyAtmosphericVfxAdaptation } from '../vfx/adaptation.js';
import { loadSurfaceMaterial } from '../materials/io.js';
import { verifySurfaceMaterialAdaptation } from '../materials/adaptation.js';
import { verifyCanonicalClothingFit } from '../clothing/adaptation.js';
import {
  lightingRigAdaptationSchema,
  verifyLightingRigAdaptation,
} from '../lighting/adaptation.js';
import { loadLightingRig } from '../lighting/io.js';
import {
  adaptEditorialTreatment,
  editorialTreatmentAdaptationSchema,
  verifyEditorialTreatmentAdaptation,
  verifyEditorialTreatmentRendering,
} from '../titles/adaptation.js';
import { resolveCormorantGaramondFont } from '../titles/font.js';
import { loadTitleTreatment } from '../titles/io.js';
import { loadDeclarativeCinematicCampaign } from '../production/cinematic-campaign-io.js';

type Publication = z.infer<typeof campaignAssetPublicationSchema>;

export interface CampaignPublicationInput {
  sourceId: string;
  artifactPath: string;
  artifactRole:
    'geometry' | 'material' | 'motion' | 'vfx' | 'audio' | 'lighting' | 'transparent-overlay';
  mediaType: string;
  publication: Publication;
  requires?: AssetReference[];
  sourceAsset?: string;
  sourceAssets?: string[];
  extraEvidence?: Array<{ path: string; role: string; mediaType: string }>;
}

const candidateManifestSchema = z.object({
  schemaVersion: z.literal(1),
  campaign: z.string(),
  campaignFile: z.string(),
  library: z.string(),
  deliveryReport: z.string(),
  createdAt: z.string().datetime(),
  candidates: z.array(
    z.object({
      sourceId: z.string(),
      asset: assetReferenceSchema,
      directory: z.string(),
      status: z.enum(['pending-review', 'published']),
      publishedTarget: z.string().optional(),
      approvedAt: z.string().datetime().optional(),
      reviewer: z.string().optional(),
      rationale: z.string().optional(),
    }),
  ),
});

function portablePath(fromDirectory: string, target: string) {
  const value = relative(fromDirectory, target);
  return value.startsWith('.') ? value : `./${value}`;
}

async function copyHashedArtifact(
  assetDirectory: string,
  source: string,
  target: string,
  role: string,
  mediaType: string,
) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  return {
    role,
    path: portablePath(assetDirectory, target).replace(/^\.\//, ''),
    mediaType,
    sha256: await sha256File(target),
  };
}

function evidenceMediaType(path: string) {
  if (path.endsWith('.png')) return 'image/png';
  return 'application/json';
}

export async function prepareCampaignPublicationCandidates(input: {
  root: string;
  campaignId: string;
  campaignFile: string;
  libraryRoot: string;
  deliveryReport: string;
  items: CampaignPublicationInput[];
}) {
  const root = resolve(input.root);
  const candidatesRoot = join(root, 'work', 'publication-candidates');
  const manifestFile = join(candidatesRoot, 'manifest.yaml');
  await mkdir(candidatesRoot, { recursive: true });
  const delivery = JSON.parse(await readFile(input.deliveryReport, 'utf8')) as { status?: string };
  if (delivery.status !== 'pass')
    throw new Error('Publication candidates require a passing rendered delivery report');

  const candidates = [];
  for (const item of input.items) {
    const existing = await findAsset(input.libraryRoot, {
      id: item.publication.assetId,
      version: item.publication.version,
    });
    if (existing) {
      if (existing.status !== 'verified')
        throw new Error(
          `Publication version ${existing.id}@${existing.version} already exists with status '${existing.status}'`,
        );
      const existingValidation = await validateLibraryAsset(existing);
      if (!existingValidation.valid)
        throw new Error(
          `Published asset ${existing.id}@${existing.version} is invalid: ${existingValidation.issues.join('; ')}`,
        );
      const existingArtifact = existing.artifacts.find(
        (artifact) => artifact.role === item.artifactRole,
      );
      if (!existingArtifact)
        throw new Error(
          `Published asset ${existing.id}@${existing.version} lacks '${item.artifactRole}'`,
        );
      const [existingHash, currentHash] = await Promise.all([
        sha256File(resolve(existing.directory, existingArtifact.path)),
        sha256File(item.artifactPath),
      ]);
      if (existingHash !== currentHash)
        throw new Error(
          `Immutable publication version ${existing.id}@${existing.version} already contains different '${item.artifactRole}' content; declare a new version`,
        );
      candidates.push({
        sourceId: item.sourceId,
        asset: { id: existing.id, version: existing.version },
        directory: portablePath(candidatesRoot, existing.directory),
        status: 'published' as const,
        publishedTarget: existing.directory,
      });
      continue;
    }
    const directory = join(candidatesRoot, item.sourceId);
    const artifactName =
      item.artifactRole === 'geometry'
        ? 'geometry.json'
        : item.artifactRole === 'motion'
          ? 'motion.json'
          : item.artifactRole === 'material'
            ? 'material.json'
            : item.artifactRole === 'vfx'
              ? 'vfx.json'
              : item.artifactRole === 'lighting'
                ? 'lighting.json'
                : item.artifactRole === 'transparent-overlay'
                  ? 'transparent-overlay.png'
                  : 'audio.wav';
    const artifacts = [
      await copyHashedArtifact(
        directory,
        item.artifactPath,
        join(directory, artifactName),
        item.artifactRole,
        item.mediaType,
      ),
    ];
    const provenanceArtifact = await copyHashedArtifact(
      directory,
      input.campaignFile,
      join(directory, 'provenance', 'cinematic-campaign.yaml'),
      'source-campaign',
      'application/yaml',
    );
    artifacts.push(provenanceArtifact);
    const verificationArtifacts: string[] = [];
    for (const evidence of item.extraEvidence ?? []) {
      const filename = `${evidence.role.replace(/[^a-z0-9-]+/gi, '-')}${evidence.path.endsWith('.json') ? '.json' : ''}`;
      const artifact = await copyHashedArtifact(
        directory,
        evidence.path,
        join(directory, 'verification', 'adaptation', filename),
        evidence.role,
        evidence.mediaType,
      );
      artifacts.push(artifact);
      verificationArtifacts.push(artifact.path);
    }
    for (const shotId of item.publication.verification.shots) {
      const verificationDirectory = join(root, 'work', 'scenes', shotId, 'verification');
      for (const filename of ['scene-render.json', 'contact-sheet.png', 'framing-report.json']) {
        const source = join(verificationDirectory, filename);
        try {
          await readFile(source);
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code === 'ENOENT' &&
            filename === 'framing-report.json'
          )
            continue;
          throw new Error(`Publication evidence is missing for '${item.sourceId}': ${source}`);
        }
        const target = join(directory, 'verification', 'shots', shotId, filename);
        const artifact = await copyHashedArtifact(
          directory,
          source,
          target,
          `verification-${shotId}-${filename.replace(/\.[^.]+$/, '')}`,
          evidenceMediaType(filename),
        );
        artifacts.push(artifact);
        verificationArtifacts.push(artifact.path);
      }
    }
    const deliveryArtifact = await copyHashedArtifact(
      directory,
      input.deliveryReport,
      join(directory, 'verification', 'campaign-delivery-report.json'),
      'verification-campaign-delivery',
      'application/json',
    );
    artifacts.push(deliveryArtifact);
    verificationArtifacts.push(deliveryArtifact.path);
    const metadata = {
      schemaVersion: 1,
      id: item.publication.assetId,
      version: item.publication.version,
      type: item.publication.type,
      title: item.publication.title,
      description: item.publication.description,
      status: 'validated',
      tags: item.publication.tags,
      capabilities: item.publication.capabilities,
      source: {
        kind: 'procedural',
        generator: item.publication.generator,
        ...(item.sourceAsset ? { sourceAsset: item.sourceAsset } : {}),
        ...(item.sourceAssets?.length ? { sourceAssets: item.sourceAssets } : {}),
        references: [provenanceArtifact.path],
        licence: {
          spdx: 'LicenseRef-Videoer-Project',
          name: 'Videoer project-owned production asset',
          commercialUse: 'allowed',
          attributionRequired: false,
        },
        clearance: 'approved',
      },
      artifacts,
      compatibility: {
        coordinateSystem: item.publication.coordinateSystem,
        renderers: item.publication.renderers,
        requires: item.requires ?? [],
      },
      verification: {
        checks: [
          ...new Set([...item.publication.verification.checks, 'campaign.delivery.verified']),
        ],
        artifacts: verificationArtifacts,
      },
    };
    await writeFile(join(directory, 'asset.yaml'), YAML.stringify(metadata), 'utf8');
    const loaded = await loadAssetMetadata(join(directory, 'asset.yaml'));
    const validation = await validateLibraryAsset(loaded);
    if (!validation.valid)
      throw new Error(
        `Publication candidate '${item.sourceId}' is invalid: ${validation.issues.join('; ')}`,
      );
    candidates.push({
      sourceId: item.sourceId,
      asset: { id: item.publication.assetId, version: item.publication.version },
      directory: portablePath(candidatesRoot, directory),
      status: 'pending-review' as const,
    });
  }
  const manifest = candidateManifestSchema.parse({
    schemaVersion: 1,
    campaign: input.campaignId,
    campaignFile: portablePath(candidatesRoot, input.campaignFile),
    library: portablePath(candidatesRoot, input.libraryRoot),
    deliveryReport: portablePath(candidatesRoot, input.deliveryReport),
    createdAt: new Date().toISOString(),
    candidates,
  });
  await writeFile(manifestFile, YAML.stringify(manifest), 'utf8');
  return { manifestFile, candidates: manifest.candidates };
}

export async function publishApprovedCampaignAssets(
  campaignFile: string,
  options: { sourceIds: string[]; reviewer: string; rationale: string },
) {
  if (!options.sourceIds.length)
    throw new Error('At least one explicit publication source ID is required');
  if (!options.reviewer.trim()) throw new Error('Publication reviewer is required');
  if (!options.rationale.trim()) throw new Error('Publication rationale is required');
  const root = dirname(resolve(campaignFile));
  const manifestFile = join(root, 'work', 'publication-candidates', 'manifest.yaml');
  const manifestDirectory = dirname(manifestFile);
  const manifest = candidateManifestSchema.parse(YAML.parse(await readFile(manifestFile, 'utf8')));
  const deliveryReport = resolve(manifestDirectory, manifest.deliveryReport);
  const delivery = JSON.parse(await readFile(deliveryReport, 'utf8')) as { status?: string };
  if (delivery.status !== 'pass')
    throw new Error('Approved publication requires a passing delivery report');
  const requested = new Set(options.sourceIds);
  const unknown = [...requested].filter(
    (sourceId) => !manifest.candidates.some((candidate) => candidate.sourceId === sourceId),
  );
  if (unknown.length) throw new Error(`Unknown publication candidate(s): ${unknown.join(', ')}`);
  const libraryRoot = resolve(manifestDirectory, manifest.library);
  const published = [];
  for (const candidate of manifest.candidates) {
    if (!requested.has(candidate.sourceId)) continue;
    if (candidate.status === 'published')
      throw new Error(`Publication candidate '${candidate.sourceId}' is already published`);
    const directory = resolve(manifestDirectory, candidate.directory);
    const metadataFile = join(directory, 'asset.yaml');
    const asset = await loadAssetMetadata(metadataFile);
    const validation = await validateLibraryAsset(asset);
    if (!validation.valid)
      throw new Error(
        `Publication candidate '${candidate.sourceId}' failed integrity checks: ${validation.issues.join('; ')}`,
      );
    const verified = asset;
    const sourceCampaignArtifact = verified.artifacts.find(
      (artifact) => artifact.role === 'source-campaign',
    );
    if (!sourceCampaignArtifact)
      throw new Error(
        `Publication candidate '${candidate.sourceId}' lacks embedded campaign provenance`,
      );
    const currentCampaignFile = resolve(manifestDirectory, manifest.campaignFile);
    if (
      (await sha256File(resolve(directory, sourceCampaignArtifact.path))) !==
      (await sha256File(currentCampaignFile))
    )
      throw new Error(
        `Publication candidate '${candidate.sourceId}' embedded campaign provenance differs from the current campaign; rebuild candidates before approval`,
      );
    const dependencies = new Map<string, Awaited<ReturnType<typeof findAsset>>>();
    for (const requirement of verified.compatibility.requires) {
      const dependency = await findAsset(libraryRoot, requirement);
      if (!dependency)
        throw new Error(
          `Approved candidate '${candidate.sourceId}' requires missing asset ${requirement.id}@${requirement.version}`,
        );
      if (dependency.status !== 'verified')
        throw new Error(
          `Approved candidate '${candidate.sourceId}' requires non-verified asset ${requirement.id}@${requirement.version}`,
        );
      const dependencyValidation = await validateLibraryAsset(dependency);
      if (!dependencyValidation.valid)
        throw new Error(
          `Approved candidate '${candidate.sourceId}' has invalid dependency ${requirement.id}@${requirement.version}: ${dependencyValidation.issues.join('; ')}`,
        );
      dependencies.set(`${requirement.id}@${requirement.version}`, dependency);
    }
    if (verified.source.sourceAsset) {
      const dependency = dependencies.get(verified.source.sourceAsset);
      if (!dependency)
        throw new Error(
          `Derived candidate '${candidate.sourceId}' sourceAsset is not declared in compatibility.requires`,
        );
      const adaptationRole =
        verified.type === 'motion'
          ? 'verification-motion-adaptation-compatibility'
          : verified.type === 'audio'
            ? 'verification-audio-adaptation-compatibility'
            : verified.type === 'lighting'
              ? 'verification-lighting-adaptation-compatibility'
              : verified.type === 'editorial'
                ? 'verification-editorial-adaptation-compatibility'
                : verified.type === 'clothing'
                  ? 'verification-clothing-adaptation-compatibility'
                  : verified.type === 'material'
                    ? 'verification-material-adaptation-compatibility'
                    : verified.type === 'vfx'
                      ? 'verification-vfx-adaptation-compatibility'
                      : 'verification-adaptation-compatibility';
      const adaptationArtifact = verified.artifacts.find(
        (artifact) => artifact.role === adaptationRole,
      );
      if (!adaptationArtifact)
        throw new Error(
          `Derived candidate '${candidate.sourceId}' lacks an adaptation compatibility report`,
        );
      const adaptation = JSON.parse(
        await readFile(resolve(directory, adaptationArtifact.path), 'utf8'),
      ) as {
        baseAsset?: { id?: string; version?: string };
        baseArtifactRole?: string;
        baseGeometrySha256?: string;
        adaptedGeometrySha256?: string;
        baseMotionSha256?: string;
        adaptedMotionSha256?: string;
        baseVfxSha256?: string;
        adaptedVfxSha256?: string;
        baseMaterialSha256?: string;
        adaptedMaterialSha256?: string;
        baseClothingSha256?: string;
        adaptedClothingSha256?: string;
        baseAudioSha256?: string;
        adaptedAudioSha256?: string;
        baseLightingSha256?: string;
        adaptedLightingSha256?: string;
        baseEditorialSha256?: string;
        adaptedEditorialSha256?: string;
        adaptedTreatmentSha256?: string;
        treatment?: unknown;
        adaptation?: unknown;
        targetGeometry?: {
          libraryAsset?: { id?: string; version?: string };
          sha256?: string;
        };
        skeleton?: { compatible?: boolean };
        biomechanics?: { valid?: boolean };
        operations?: {
          topologyChanged?: boolean;
          skeletonChanged?: boolean;
          placementChanged?: boolean;
          deterministicLayerTopologyChanged?: boolean;
          shadingModelChanged?: boolean;
          baseColorModelChanged?: boolean;
          normalModelChanged?: boolean;
          skinningChanged?: boolean;
          skinningPolicy?: string;
          skeletonRetargeted?: boolean;
          selectedIntervalChanged?: boolean;
          temporalEnvelopeChanged?: boolean;
          sampleRateChanged?: boolean;
          channelLayoutChanged?: boolean;
          lightTopologyChanged?: boolean;
          exposureChanged?: boolean;
          spatialTransformMatched?: boolean;
          energyTransformMatched?: boolean;
          colorTransformMatched?: boolean;
          sizeTransformMatched?: boolean;
          fontChanged?: boolean;
          motifChanged?: boolean;
          deterministicPixelsChanged?: boolean;
          safeAreaViolated?: boolean;
        };
        compatibility?: {
          coordinateSystemPreserved?: boolean;
          placementPreserved?: boolean;
          deterministicLayerTopologyPreserved?: boolean;
          shadingModelPreserved?: boolean;
          baseColorModelPreserved?: boolean;
          normalModelPreserved?: boolean;
          topologyPreserved?: boolean;
          skinningPreserved?: boolean;
          targetSkeletonMatched?: boolean;
          canonicalSkeletonCompatible?: boolean;
          drapeSkinningValid?: boolean;
          maximumHemNonPelvisWeight?: number;
          selectedIntervalPreserved?: boolean;
          sampleRatePreservedAt48kHz?: boolean;
          stereoPreserved?: boolean;
          temporalEnvelopePreserved?: boolean;
          accentSampleAlignmentPreserved?: boolean;
          declaredAccentsContribute?: boolean;
          deterministicRenderMatched?: boolean;
          exposurePreserved?: boolean;
          nonBlackWorld?: boolean;
          baseLightCount?: number;
          adaptedLightCount?: number;
          fontPreserved?: boolean;
          motifPreserved?: boolean;
          exactTreatmentMatched?: boolean;
          dimensionsMatched?: boolean;
          linesInsideSafeArea?: boolean;
          fontSha256?: string;
          contrast?: { foreground?: number; accent?: number };
        };
        validation?: { valid?: boolean };
        speechMorphValidation?: { valid?: boolean };
      };
      if (
        `${adaptation.baseAsset?.id}@${adaptation.baseAsset?.version}` !==
        verified.source.sourceAsset
      )
        throw new Error(
          `Derived candidate '${candidate.sourceId}' adaptation report names the wrong parent`,
        );
      const artifactRole =
        verified.type === 'motion'
          ? 'motion'
          : verified.type === 'audio'
            ? 'audio'
            : verified.type === 'lighting'
              ? 'lighting'
              : verified.type === 'editorial'
                ? 'transparent-overlay'
                : verified.type === 'clothing'
                  ? 'geometry'
                  : verified.type === 'material'
                    ? 'material'
                    : verified.type === 'vfx'
                      ? 'vfx'
                      : 'geometry';
      const parentArtifact = dependency.artifacts.find(
        (artifact) =>
          artifact.role ===
          (verified.type === 'audio' ||
          verified.type === 'lighting' ||
          verified.type === 'editorial'
            ? adaptation.baseArtifactRole
            : artifactRole),
      );
      const adaptedArtifact = verified.artifacts.find((artifact) => artifact.role === artifactRole);
      if (!parentArtifact || !adaptedArtifact)
        throw new Error(
          `Derived candidate '${candidate.sourceId}' requires ${artifactRole} artifacts on both versions`,
        );
      const actualParentHash = await sha256File(resolve(dependency.directory, parentArtifact.path));
      const actualAdaptedHash = await sha256File(resolve(directory, adaptedArtifact.path));
      const reportedParentHash =
        verified.type === 'motion'
          ? adaptation.baseMotionSha256
          : verified.type === 'audio'
            ? adaptation.baseAudioSha256
            : verified.type === 'lighting'
              ? adaptation.baseLightingSha256
              : verified.type === 'editorial'
                ? adaptation.baseEditorialSha256
                : verified.type === 'clothing'
                  ? adaptation.baseClothingSha256
                  : verified.type === 'material'
                    ? adaptation.baseMaterialSha256
                    : verified.type === 'vfx'
                      ? adaptation.baseVfxSha256
                      : adaptation.baseGeometrySha256;
      const reportedAdaptedHash =
        verified.type === 'motion'
          ? adaptation.adaptedMotionSha256
          : verified.type === 'audio'
            ? adaptation.adaptedAudioSha256
            : verified.type === 'lighting'
              ? adaptation.adaptedLightingSha256
              : verified.type === 'editorial'
                ? adaptation.adaptedEditorialSha256
                : verified.type === 'clothing'
                  ? adaptation.adaptedClothingSha256
                  : verified.type === 'material'
                    ? adaptation.adaptedMaterialSha256
                    : verified.type === 'vfx'
                      ? adaptation.adaptedVfxSha256
                      : adaptation.adaptedGeometrySha256;
      if (reportedParentHash !== actualParentHash)
        throw new Error(
          `Derived candidate '${candidate.sourceId}' parent hash does not match the library`,
        );
      if (reportedAdaptedHash !== actualAdaptedHash)
        throw new Error(
          `Derived candidate '${candidate.sourceId}' adapted hash does not match the candidate`,
        );
      if (verified.type === 'editorial') {
        const specification = editorialTreatmentAdaptationSchema.parse(adaptation.adaptation);
        const campaign = await loadDeclarativeCinematicCampaign(currentCampaignFile);
        const source = campaign.overlays.find((overlay) => overlay.id === candidate.sourceId);
        if (!source || !('adaptation' in source))
          throw new Error(
            `Derived editorial candidate '${candidate.sourceId}' has no matching adaptation in the current campaign`,
          );
        const declared = editorialTreatmentAdaptationSchema.parse(source.adaptation);
        if (JSON.stringify(declared) !== JSON.stringify(specification))
          throw new Error(
            `Derived editorial candidate '${candidate.sourceId}' adaptation differs from the current campaign declaration`,
          );
        const treatmentArtifact = verified.artifacts.find(
          (artifact) => artifact.role === 'editorial-treatment',
        );
        if (!treatmentArtifact)
          throw new Error(
            `Derived editorial candidate '${candidate.sourceId}' lacks its normalized treatment artifact`,
          );
        const treatmentPath = resolve(directory, treatmentArtifact.path);
        if (adaptation.adaptedTreatmentSha256 !== (await sha256File(treatmentPath)))
          throw new Error(
            `Derived editorial candidate '${candidate.sourceId}' treatment hash does not match`,
          );
        if (
          !adaptation.validation?.valid ||
          !adaptation.compatibility?.fontPreserved ||
          !adaptation.compatibility?.motifPreserved ||
          !adaptation.compatibility?.exactTreatmentMatched ||
          !adaptation.compatibility?.deterministicRenderMatched ||
          !adaptation.compatibility?.dimensionsMatched ||
          !adaptation.compatibility?.linesInsideSafeArea ||
          Number(adaptation.compatibility?.contrast?.foreground) < 4.5 ||
          Number(adaptation.compatibility?.contrast?.accent) < 3 ||
          adaptation.operations?.fontChanged !== false ||
          adaptation.operations?.motifChanged !== false ||
          adaptation.operations?.deterministicPixelsChanged !== false ||
          adaptation.operations?.safeAreaViolated !== false
        )
          throw new Error(
            `Derived editorial candidate '${candidate.sourceId}' lacks passing font, motif, safe-area, contrast, or deterministic-pixel evidence`,
          );
        const parentTreatment = await loadTitleTreatment(
          resolve(dependency.directory, parentArtifact.path),
        );
        const adaptedTreatment = await loadTitleTreatment(treatmentPath);
        const semanticValidation = verifyEditorialTreatmentAdaptation(
          parentTreatment,
          adaptedTreatment,
          specification,
        );
        if (!semanticValidation.valid)
          throw new Error(
            `Derived editorial candidate '${candidate.sourceId}' fails live semantic validation: ${semanticValidation.issues.join('; ')}`,
          );
        const expectedTreatment = adaptEditorialTreatment(parentTreatment, specification);
        if (JSON.stringify(expectedTreatment) !== JSON.stringify(adaptedTreatment))
          throw new Error(
            `Derived editorial candidate '${candidate.sourceId}' normalized treatment differs from the live parent derivation`,
          );
        const fontPath = await resolveCormorantGaramondFont();
        const renderingValidation = await verifyEditorialTreatmentRendering(
          adaptedTreatment,
          fontPath,
          resolve(directory, adaptedArtifact.path),
        );
        if (!renderingValidation.valid)
          throw new Error(
            `Derived editorial candidate '${candidate.sourceId}' fails live pixel/layout validation: ${renderingValidation.issues.join('; ')}`,
          );
        if (adaptation.compatibility.fontSha256 !== renderingValidation.fontSha256)
          throw new Error(
            `Derived editorial candidate '${candidate.sourceId}' font hash differs from live rendering`,
          );
      } else if (verified.type === 'lighting') {
        const specification = lightingRigAdaptationSchema.parse(adaptation.adaptation);
        if (
          !adaptation.validation?.valid ||
          !adaptation.compatibility?.topologyPreserved ||
          !adaptation.compatibility?.exposurePreserved ||
          !adaptation.compatibility?.nonBlackWorld ||
          adaptation.compatibility?.baseLightCount !==
            adaptation.compatibility?.adaptedLightCount ||
          adaptation.operations?.lightTopologyChanged !== false ||
          adaptation.operations?.exposureChanged !== false ||
          !adaptation.operations?.spatialTransformMatched ||
          !adaptation.operations?.energyTransformMatched ||
          !adaptation.operations?.colorTransformMatched ||
          !adaptation.operations?.sizeTransformMatched
        )
          throw new Error(
            `Derived lighting candidate '${candidate.sourceId}' lacks passing topology, exposure, spatial, energy, or color evidence`,
          );
        const parentLighting = await loadLightingRig(
          resolve(dependency.directory, parentArtifact.path),
        );
        const adaptedLighting = await loadLightingRig(resolve(directory, adaptedArtifact.path));
        const liveValidation = verifyLightingRigAdaptation(
          parentLighting,
          adaptedLighting,
          specification,
        );
        if (!liveValidation.valid)
          throw new Error(
            `Derived lighting candidate '${candidate.sourceId}' fails live semantic validation: ${liveValidation.issues.join('; ')}`,
          );
      } else if (verified.type === 'audio') {
        const treatment = audioTreatmentSchema.parse(adaptation.treatment);
        if (
          !adaptation.validation?.valid ||
          !adaptation.compatibility?.selectedIntervalPreserved ||
          !adaptation.compatibility?.sampleRatePreservedAt48kHz ||
          !adaptation.compatibility?.stereoPreserved ||
          !adaptation.compatibility?.temporalEnvelopePreserved ||
          !adaptation.compatibility?.accentSampleAlignmentPreserved ||
          !adaptation.compatibility?.declaredAccentsContribute ||
          !adaptation.compatibility?.deterministicRenderMatched ||
          adaptation.operations?.temporalEnvelopeChanged !== false ||
          adaptation.operations?.sampleRateChanged !== false ||
          adaptation.operations?.channelLayoutChanged !== false
        )
          throw new Error(
            `Derived audio candidate '${candidate.sourceId}' lacks passing duration, format, envelope, or deterministic-render evidence`,
          );
        const liveValidation = await verifyAudioTreatment(
          resolve(dependency.directory, parentArtifact.path),
          resolve(directory, adaptedArtifact.path),
          treatment,
        );
        if (!liveValidation.valid)
          throw new Error(
            `Derived audio candidate '${candidate.sourceId}' fails live semantic validation: ${liveValidation.issues.join('; ')}`,
          );
      } else if (verified.type === 'motion') {
        if (!adaptation.skeleton?.compatible || !adaptation.biomechanics?.valid)
          throw new Error(
            `Derived motion candidate '${candidate.sourceId}' lacks passing skeleton or biomechanical evidence`,
          );
        const targetReference = adaptation.targetGeometry?.libraryAsset;
        if (targetReference?.id && targetReference.version) {
          const targetKey = `${targetReference.id}@${targetReference.version}`;
          const target = dependencies.get(targetKey);
          if (!target)
            throw new Error(
              `Derived motion candidate '${candidate.sourceId}' target geometry is not declared in compatibility.requires`,
            );
          const targetGeometry = target.artifacts.find((artifact) => artifact.role === 'geometry');
          if (!targetGeometry)
            throw new Error(
              `Derived motion candidate '${candidate.sourceId}' target asset lacks geometry`,
            );
          const targetHash = await sha256File(resolve(target.directory, targetGeometry.path));
          if (adaptation.targetGeometry?.sha256 !== targetHash)
            throw new Error(
              `Derived motion candidate '${candidate.sourceId}' target geometry hash does not match the library`,
            );
        }
      } else if (verified.type === 'clothing') {
        const preservedSkinning =
          adaptation.operations?.skinningPolicy === 'preserve' &&
          adaptation.compatibility?.skinningPreserved === true &&
          adaptation.operations?.skinningChanged === false;
        const verifiedDrapeSkinning =
          adaptation.operations?.skinningPolicy === 'long-dress-drape-v1' &&
          adaptation.compatibility?.drapeSkinningValid === true &&
          adaptation.operations?.skinningChanged === true &&
          Number(adaptation.compatibility.maximumHemNonPelvisWeight) <= 0.13;
        if (
          !adaptation.validation?.valid ||
          !adaptation.compatibility?.topologyPreserved ||
          (!preservedSkinning && !verifiedDrapeSkinning) ||
          !adaptation.compatibility?.targetSkeletonMatched ||
          !adaptation.compatibility?.canonicalSkeletonCompatible ||
          adaptation.operations?.topologyChanged !== false ||
          adaptation.operations?.skeletonRetargeted !== true
        )
          throw new Error(
            `Derived clothing candidate '${candidate.sourceId}' lacks passing topology, skinning, or target-fit evidence`,
          );
        const targetReference = adaptation.targetGeometry?.libraryAsset;
        if (!targetReference?.id || !targetReference.version)
          throw new Error(
            `Derived clothing candidate '${candidate.sourceId}' lacks verified target geometry lineage`,
          );
        const target = dependencies.get(`${targetReference.id}@${targetReference.version}`);
        const targetArtifact = target?.artifacts.find((artifact) => artifact.role === 'geometry');
        if (!target || !targetArtifact)
          throw new Error(
            `Derived clothing candidate '${candidate.sourceId}' target dependency lacks geometry`,
          );
        const actualTargetHash = await sha256File(resolve(target.directory, targetArtifact.path));
        if (adaptation.targetGeometry?.sha256 !== actualTargetHash)
          throw new Error(
            `Derived clothing candidate '${candidate.sourceId}' target hash does not match the library`,
          );
        const parentClothing = await loadGeometry(
          resolve(dependency.directory, parentArtifact.path),
        );
        const targetGeometry = await loadGeometry(resolve(target.directory, targetArtifact.path));
        const fittedClothing = await loadGeometry(resolve(directory, adaptedArtifact.path));
        const liveValidation = verifyCanonicalClothingFit(
          parentClothing,
          targetGeometry,
          fittedClothing,
        );
        if (!liveValidation.valid)
          throw new Error(
            `Derived clothing candidate '${candidate.sourceId}' fails live semantic validation: ${liveValidation.issues.join('; ')}`,
          );
      } else if (verified.type === 'material') {
        if (
          !adaptation.validation?.valid ||
          !adaptation.compatibility?.shadingModelPreserved ||
          !adaptation.compatibility?.baseColorModelPreserved ||
          !adaptation.compatibility?.normalModelPreserved ||
          adaptation.operations?.shadingModelChanged !== false ||
          adaptation.operations?.baseColorModelChanged !== false ||
          adaptation.operations?.normalModelChanged !== false
        )
          throw new Error(
            `Derived material candidate '${candidate.sourceId}' lacks passing shading-model evidence`,
          );
        const parentMaterial = await loadSurfaceMaterial(
          resolve(dependency.directory, parentArtifact.path),
        );
        const adaptedMaterial = await loadSurfaceMaterial(resolve(directory, adaptedArtifact.path));
        const liveValidation = verifySurfaceMaterialAdaptation(parentMaterial, adaptedMaterial);
        if (!liveValidation.valid)
          throw new Error(
            `Derived material candidate '${candidate.sourceId}' fails live semantic validation: ${liveValidation.issues.join('; ')}`,
          );
      } else if (verified.type === 'vfx') {
        if (
          !adaptation.validation?.valid ||
          !adaptation.compatibility?.placementPreserved ||
          !adaptation.compatibility?.deterministicLayerTopologyPreserved ||
          adaptation.operations?.placementChanged !== false ||
          adaptation.operations?.deterministicLayerTopologyChanged !== false
        )
          throw new Error(
            `Derived VFX candidate '${candidate.sourceId}' lacks passing placement or deterministic-layer evidence`,
          );
        const parentVfx = await loadAtmosphericVfx(
          resolve(dependency.directory, parentArtifact.path),
        );
        const adaptedVfx = await loadAtmosphericVfx(resolve(directory, adaptedArtifact.path));
        const liveValidation = verifyAtmosphericVfxAdaptation(parentVfx, adaptedVfx);
        if (!liveValidation.valid)
          throw new Error(
            `Derived VFX candidate '${candidate.sourceId}' fails live semantic validation: ${liveValidation.issues.join('; ')}`,
          );
      } else {
        if (
          !adaptation.validation?.valid ||
          !adaptation.compatibility?.coordinateSystemPreserved ||
          adaptation.operations?.topologyChanged !== false ||
          adaptation.operations?.skeletonChanged !== false
        )
          throw new Error(
            `Derived geometry candidate '${candidate.sourceId}' lacks passing topology, skeleton, coordinate, or schema evidence`,
          );
        if (
          verified.capabilities.includes('canonical-english-visemes') &&
          !adaptation.speechMorphValidation?.valid
        )
          throw new Error(
            `Derived speech geometry candidate '${candidate.sourceId}' lacks passing speech-morph evidence`,
          );
        const parsedGeometry = await loadGeometry(resolve(directory, adaptedArtifact.path));
        const liveValidation = validateGeometry(parsedGeometry);
        if (!liveValidation.valid)
          throw new Error(
            `Derived geometry candidate '${candidate.sourceId}' fails live validation`,
          );
        if (
          verified.capabilities.includes('canonical-english-visemes') &&
          !verifyEnglishSpeechMorphRig(parsedGeometry).valid
        )
          throw new Error(
            `Derived speech geometry candidate '${candidate.sourceId}' fails live morph validation`,
          );
      }
    }
    const speechAudioArtifact = verified.artifacts.find(
      (artifact) => artifact.role === 'verification-speech-audio-lineage',
    );
    if (verified.type === 'audio' && speechAudioArtifact) {
      const report = JSON.parse(
        await readFile(resolve(directory, speechAudioArtifact.path), 'utf8'),
      ) as {
        audioSha256?: string;
        eventsSha256?: string;
        durationSeconds?: number;
        verification?: { valid?: boolean };
      };
      const audio = verified.artifacts.find((artifact) => artifact.role === 'audio');
      const events = verified.artifacts.find((artifact) => artifact.role === 'speech-events');
      if (!audio || !events)
        throw new Error(
          `Speech audio candidate '${candidate.sourceId}' lacks audio or event artifacts`,
        );
      if (report.audioSha256 !== (await sha256File(resolve(directory, audio.path))))
        throw new Error(`Speech audio candidate '${candidate.sourceId}' audio hash does not match`);
      if (report.eventsSha256 !== (await sha256File(resolve(directory, events.path))))
        throw new Error(`Speech audio candidate '${candidate.sourceId}' event hash does not match`);
      if (!report.verification?.valid || !Number.isFinite(report.durationSeconds))
        throw new Error(
          `Speech audio candidate '${candidate.sourceId}' lacks passing lineage evidence`,
        );
      const actualDuration = await inspectAudioDuration(resolve(directory, audio.path));
      if (Math.abs(actualDuration - report.durationSeconds!) > 1 / 48000)
        throw new Error(
          `Speech audio candidate '${candidate.sourceId}' duration evidence does not match`,
        );
      const ledger = JSON.parse(await readFile(resolve(directory, events.path), 'utf8')) as {
        schemaVersion?: number;
        engine?: string;
        durationSeconds?: number;
        events?: Array<{ audioPositionMs?: number; type?: string }>;
      };
      if (
        ledger.schemaVersion !== 1 ||
        ledger.engine !== 'espeak-ng' ||
        !Array.isArray(ledger.events) ||
        !ledger.events.some((event) => event.type === 'phoneme') ||
        ledger.events.some(
          (event, index) =>
            !Number.isFinite(event.audioPositionMs) ||
            (index > 0 && event.audioPositionMs! < ledger.events![index - 1]!.audioPositionMs!),
        ) ||
        Math.abs((ledger.durationSeconds ?? 0) - actualDuration) > 1 / 48000
      )
        throw new Error(
          `Speech audio candidate '${candidate.sourceId}' event ledger fails live validation`,
        );
    }
    const speechPerformanceArtifact = verified.artifacts.find(
      (artifact) => artifact.role === 'verification-speech-performance-compatibility',
    );
    if (verified.type === 'motion' && speechPerformanceArtifact) {
      const report = JSON.parse(
        await readFile(resolve(directory, speechPerformanceArtifact.path), 'utf8'),
      ) as {
        derivedMotionSha256?: string;
        audio?: { libraryAsset?: AssetReference; sha256?: string; eventsSha256?: string };
        targetGeometry?: { libraryAsset?: AssetReference; sha256?: string };
        visemeVerification?: { valid?: boolean };
        targetCompatibility?: { valid?: boolean };
        audiovisualSync?: { valid?: boolean };
      };
      const output = verified.artifacts.find((artifact) => artifact.role === 'motion');
      if (
        !output ||
        report.derivedMotionSha256 !== (await sha256File(resolve(directory, output.path)))
      )
        throw new Error(
          `Speech motion candidate '${candidate.sourceId}' output hash does not match`,
        );
      const audioReference = report.audio?.libraryAsset;
      const targetReference = report.targetGeometry?.libraryAsset;
      if (!audioReference || !targetReference)
        throw new Error(
          `Speech motion candidate '${candidate.sourceId}' lacks audio or target lineage`,
        );
      const audioDependency = dependencies.get(`${audioReference.id}@${audioReference.version}`);
      const targetDependency = dependencies.get(`${targetReference.id}@${targetReference.version}`);
      const audio = audioDependency?.artifacts.find((artifact) => artifact.role === 'audio');
      const events = audioDependency?.artifacts.find(
        (artifact) => artifact.role === 'speech-events',
      );
      const target = targetDependency?.artifacts.find((artifact) => artifact.role === 'geometry');
      if (!audioDependency || !targetDependency || !audio || !events || !target)
        throw new Error(
          `Speech motion candidate '${candidate.sourceId}' dependencies lack required artifacts`,
        );
      if (
        report.audio?.sha256 !== (await sha256File(resolve(audioDependency.directory, audio.path)))
      )
        throw new Error(
          `Speech motion candidate '${candidate.sourceId}' audio hash does not match the library`,
        );
      if (
        report.audio?.eventsSha256 !==
        (await sha256File(resolve(audioDependency.directory, events.path)))
      )
        throw new Error(
          `Speech motion candidate '${candidate.sourceId}' event hash does not match the library`,
        );
      if (
        report.targetGeometry?.sha256 !==
        (await sha256File(resolve(targetDependency.directory, target.path)))
      )
        throw new Error(
          `Speech motion candidate '${candidate.sourceId}' target hash does not match the library`,
        );
      if (
        !report.visemeVerification?.valid ||
        !report.targetCompatibility?.valid ||
        !report.audiovisualSync?.valid
      )
        throw new Error(
          `Speech motion candidate '${candidate.sourceId}' lacks passing AV evidence`,
        );
      const liveMotion = await loadMotionClip(resolve(directory, output.path));
      const liveTarget = await loadGeometry(resolve(targetDependency.directory, target.path));
      if (
        !verifyVisemeMotion(liveMotion).valid ||
        !validateMotionClip(liveMotion, liveTarget).valid
      )
        throw new Error(
          `Speech motion candidate '${candidate.sourceId}' fails live viseme or target validation`,
        );
    }
    if (verified.source.sourceAssets?.length) {
      const reportArtifact = verified.artifacts.find(
        (artifact) => artifact.role === 'verification-layered-performance-compatibility',
      );
      if (!reportArtifact)
        throw new Error(
          `Layered performance candidate '${candidate.sourceId}' lacks a compatibility report`,
        );
      const report = JSON.parse(
        await readFile(resolve(directory, reportArtifact.path), 'utf8'),
      ) as {
        derivationKind?: string;
        derivedAssetId?: string;
        derivedMotionSha256?: string;
        skeleton?: { compatible?: boolean };
        targetGeometry?: {
          libraryAsset?: { id?: string; version?: string };
          sha256?: string;
        };
        layers?: Array<{
          libraryAsset?: { id?: string; version?: string };
          artifactRole?: string;
          artifactSha256?: string;
        }>;
        compositionVerification?: { valid?: boolean };
        targetValidation?: { valid?: boolean };
      };
      if (report.derivationKind !== 'layered-performance')
        throw new Error(
          `Layered performance candidate '${candidate.sourceId}' has the wrong derivation kind`,
        );
      if (report.derivedAssetId !== verified.id)
        throw new Error(
          `Layered performance candidate '${candidate.sourceId}' report names the wrong output`,
        );
      const outputArtifact = verified.artifacts.find((artifact) => artifact.role === 'motion');
      if (!outputArtifact)
        throw new Error(
          `Layered performance candidate '${candidate.sourceId}' lacks output motion`,
        );
      if (
        report.derivedMotionSha256 !== (await sha256File(resolve(directory, outputArtifact.path)))
      )
        throw new Error(
          `Layered performance candidate '${candidate.sourceId}' output hash does not match the candidate`,
        );
      if (
        !report.skeleton?.compatible ||
        !report.compositionVerification?.valid ||
        !report.targetValidation?.valid
      )
        throw new Error(
          `Layered performance candidate '${candidate.sourceId}' lacks passing composition or target evidence`,
        );
      const declaredSources = new Set(verified.source.sourceAssets);
      const reportSources = new Set<string>();
      for (const layer of report.layers ?? []) {
        const reference = layer.libraryAsset;
        if (!reference?.id || !reference.version || !layer.artifactRole)
          throw new Error(
            `Layered performance candidate '${candidate.sourceId}' has incomplete layer lineage`,
          );
        const key = `${reference.id}@${reference.version}`;
        reportSources.add(key);
        if (!declaredSources.has(key))
          throw new Error(
            `Layered performance candidate '${candidate.sourceId}' report contains undeclared source ${key}`,
          );
        const dependency = dependencies.get(key);
        if (!dependency)
          throw new Error(
            `Layered performance candidate '${candidate.sourceId}' source ${key} is not declared in compatibility.requires`,
          );
        const artifact = dependency.artifacts.find(
          (candidateArtifact) => candidateArtifact.role === layer.artifactRole,
        );
        if (!artifact)
          throw new Error(
            `Layered performance candidate '${candidate.sourceId}' source ${key} lacks artifact role '${layer.artifactRole}'`,
          );
        const actualHash = await sha256File(resolve(dependency.directory, artifact.path));
        if (layer.artifactSha256 !== actualHash)
          throw new Error(
            `Layered performance candidate '${candidate.sourceId}' source ${key} hash does not match the library`,
          );
      }
      if ([...declaredSources].some((source) => !reportSources.has(source)))
        throw new Error(
          `Layered performance candidate '${candidate.sourceId}' report omits a declared source`,
        );
      const targetReference = report.targetGeometry?.libraryAsset;
      if (!targetReference?.id || !targetReference.version)
        throw new Error(
          `Layered performance candidate '${candidate.sourceId}' lacks target geometry lineage`,
        );
      const targetKey = `${targetReference.id}@${targetReference.version}`;
      const target = dependencies.get(targetKey);
      if (!target)
        throw new Error(
          `Layered performance candidate '${candidate.sourceId}' target geometry is not declared in compatibility.requires`,
        );
      const targetArtifact = target.artifacts.find((artifact) => artifact.role === 'geometry');
      if (!targetArtifact)
        throw new Error(
          `Layered performance candidate '${candidate.sourceId}' target asset lacks geometry`,
        );
      const targetHash = await sha256File(resolve(target.directory, targetArtifact.path));
      if (report.targetGeometry?.sha256 !== targetHash)
        throw new Error(
          `Layered performance candidate '${candidate.sourceId}' target geometry hash does not match the library`,
        );
    }
    const approvedAt = new Date().toISOString();
    const approvalPath = join(directory, 'verification', 'approval.json');
    await mkdir(dirname(approvalPath), { recursive: true });
    await writeFile(
      approvalPath,
      `${JSON.stringify({ schemaVersion: 1, campaign: manifest.campaign, sourceId: candidate.sourceId, asset: candidate.asset, reviewer: options.reviewer, rationale: options.rationale, approvedAt }, null, 2)}\n`,
      'utf8',
    );
    const raw = YAML.parse(await readFile(metadataFile, 'utf8')) as {
      status: string;
      verification: { verifiedAt?: string; checks: string[]; artifacts: string[] };
      artifacts: Array<{
        role: string;
        path: string;
        mediaType: string;
        sha256?: string;
      }>;
    };
    raw.status = 'verified';
    raw.verification.verifiedAt = approvedAt;
    raw.verification.checks.push('review.operator-approved');
    raw.verification.artifacts.push('verification/approval.json');
    raw.artifacts.push({
      role: 'verification-approval',
      path: 'verification/approval.json',
      mediaType: 'application/json',
      sha256: await sha256File(approvalPath),
    });
    await writeFile(metadataFile, YAML.stringify(raw), 'utf8');
    const approved = await loadAssetMetadata(metadataFile);
    const approvedValidation = await validateLibraryAsset(approved);
    if (!approvedValidation.valid)
      throw new Error(
        `Approved candidate '${candidate.sourceId}' is invalid: ${approvedValidation.issues.join('; ')}`,
      );
    const result = await publishAsset(directory, libraryRoot);
    Object.assign(candidate, {
      status: 'published' as const,
      publishedTarget: result.target,
      approvedAt,
      reviewer: options.reviewer,
      rationale: options.rationale,
    });
    published.push({ sourceId: candidate.sourceId, ...result });
  }
  await writeFile(manifestFile, YAML.stringify(manifest), 'utf8');
  const index = await buildAssetIndex(libraryRoot);
  return { manifestFile, published, index: index.path };
}
