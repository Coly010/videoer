import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { openEnvironmentRadianceSourceManifestSchema } from '../assets/sources/model.js';
import { validateAmbientCgEnvironmentSourceEvidence } from '../assets/sources/ambientcg-environment.js';
import { writeImmutableFile } from '../assets/sources/cache.js';
import { loadLightingRig } from './io.js';
import { lightingRigSchema } from './model.js';

const requestSchema = z.object({
  sourceManifestPath: z.string().min(1),
  outputDirectory: z.string().min(1),
  assetId: z.string().regex(/^lighting\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
  yawDegrees: z.number().finite().min(-180).max(180).default(0),
  environmentExposureStops: z.number().finite().min(-6).max(6).default(0),
  sceneExposureStops: z.number().finite().min(-4).max(4).default(0),
  worldColor: z
    .tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])
    .default([0.01, 0.015, 0.025]),
});

export type CreateEnvironmentLightingRigRequest = z.input<typeof requestSchema>;

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function exactBoundArtifact(
  sourceRoot: string,
  outputRoot: string,
  binding: { path: string; sha256: string; sizeBytes?: number },
) {
  const source = resolve(sourceRoot, binding.path);
  const bytes = await readFile(source);
  if (binding.sizeBytes !== undefined && bytes.byteLength !== binding.sizeBytes)
    throw new Error(`Environment source artifact byte size mismatch: ${binding.path}`);
  const digest = sha256(bytes);
  if (digest !== binding.sha256)
    throw new Error(`Environment source artifact SHA-256 mismatch: ${binding.path}`);
  const target = resolve(outputRoot, binding.path);
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(target, bytes, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await readFile(target);
    if (sha256(existing) !== digest)
      throw new Error(`Environment lighting candidate artifact collision: ${binding.path}`);
  }
  return { path: binding.path, sha256: digest, sizeBytes: bytes.byteLength };
}

async function exactCandidateFile(path: string, bytes: Uint8Array, label: string) {
  try {
    await writeImmutableFile(path, bytes);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Immutable source-cache collision'))
      throw new Error(`Environment lighting candidate ${label} collision`);
    throw error;
  }
  return path;
}

/**
 * Converts an accepted open-source ingestion package into a portable, renderer-independent
 * lighting candidate. No provider access occurs here: every byte is copied and reverified from
 * the immutable source manifest.
 */
export async function createEnvironmentLightingRigFromSource(
  input: CreateEnvironmentLightingRigRequest,
) {
  const request = requestSchema.parse(input);
  const sourceManifestPath = resolve(request.sourceManifestPath);
  const sourceManifestBytes = await readFile(sourceManifestPath);
  const sourceManifest = openEnvironmentRadianceSourceManifestSchema.parse(
    JSON.parse(sourceManifestBytes.toString('utf8')),
  );
  const sourceRoot = dirname(sourceManifestPath);
  const output = resolve(request.outputDirectory);

  const bindings = [
    {
      path: sourceManifest.providerApi.responsePath,
      sha256: sourceManifest.providerApi.responseSha256,
    },
    {
      path: sourceManifest.licence.providerEvidence.path,
      sha256: sourceManifest.licence.providerEvidence.sha256,
      sizeBytes: sourceManifest.licence.providerEvidence.sizeBytes,
    },
    {
      path: sourceManifest.licence.adapterAssessment.path,
      sha256: sourceManifest.licence.adapterAssessment.sha256,
    },
    {
      path: sourceManifest.sourceArchive.path,
      sha256: sourceManifest.sourceArchive.sha256,
      sizeBytes: sourceManifest.sourceArchive.sizeBytes,
    },
    {
      path: sourceManifest.radiance.path,
      sha256: sourceManifest.radiance.sha256,
      sizeBytes: sourceManifest.radiance.sizeBytes,
    },
    ...(sourceManifest.radiance.encoding === 'openexr'
      ? [
          {
            path: sourceManifest.radiance.structuralEvidence.inspector.evidencePath,
            sha256: sourceManifest.radiance.structuralEvidence.inspector.evidenceSha256,
          },
        ]
      : []),
  ];
  const sourceEvidence = {
    responseBytes: await readFile(resolve(sourceRoot, sourceManifest.providerApi.responsePath)),
    licenceEvidenceBytes: await readFile(
      resolve(sourceRoot, sourceManifest.licence.providerEvidence.path),
    ),
    licenceAssessmentBytes: await readFile(
      resolve(sourceRoot, sourceManifest.licence.adapterAssessment.path),
    ),
    archiveBytes: await readFile(resolve(sourceRoot, sourceManifest.sourceArchive.path)),
    radianceBytes: await readFile(resolve(sourceRoot, sourceManifest.radiance.path)),
    ...(sourceManifest.radiance.encoding === 'openexr'
      ? {
          inspectionEvidenceBytes: await readFile(
            resolve(sourceRoot, sourceManifest.radiance.structuralEvidence.inspector.evidencePath),
          ),
        }
      : {}),
  };
  validateAmbientCgEnvironmentSourceEvidence(sourceManifest, sourceEvidence);

  await mkdir(output, { recursive: true });
  const stagedArtifacts = await Promise.all(
    bindings.map((binding) => exactBoundArtifact(sourceRoot, output, binding)),
  );
  const stagedManifest = join(output, 'environment-radiance-source.json');
  await exactCandidateFile(stagedManifest, sourceManifestBytes, 'source-manifest');

  const rig = lightingRigSchema.parse({
    schemaVersion: 2,
    id: request.assetId,
    exposure: {
      viewTransform: 'AgX',
      look: 'AgX - Medium High Contrast',
      exposureStops: request.sceneExposureStops,
      coherentAcrossShots: true,
    },
    environmentIllumination: {
      kind: 'hash-bound-equirectangular-radiance',
      source: {
        path: sourceManifest.radiance.path,
        sha256: sourceManifest.radiance.sha256,
        sizeBytes: sourceManifest.radiance.sizeBytes,
        mediaType: sourceManifest.radiance.mediaType,
      },
      sourcePackage: {
        manifest: {
          path: 'environment-radiance-source.json',
          sha256: sha256(sourceManifestBytes),
          sizeBytes: sourceManifestBytes.byteLength,
          mediaType: 'application/vnd.videoer.environment-radiance-source+json',
        },
      },
      colorSpace: sourceManifest.radiance.colorSpace.name,
      projection: 'equirectangular',
      dimensions: {
        widthPixels: sourceManifest.radiance.widthPixels,
        heightPixels: sourceManifest.radiance.heightPixels,
      },
      yawDegrees: request.yawDegrees,
      exposureStops: request.environmentExposureStops,
    },
    worldColor: request.worldColor,
    lights: [],
    metadata: {
      sourceKind: 'open-environment-radiance',
      sourceManifest: 'environment-radiance-source.json',
      sourceManifestSha256: sha256(sourceManifestBytes),
      sourceIdentitySha256: sourceManifest.sourceIdentitySha256,
      provider: sourceManifest.provider,
      providerAssetId: sourceManifest.asset.id,
      licenceSpdx: sourceManifest.licence.spdx,
    },
  });
  const rigPath = join(output, 'lighting-rig.json');
  await exactCandidateFile(
    rigPath,
    Buffer.from(`${JSON.stringify(rig, null, 2)}\n`, 'utf8'),
    'lighting-rig',
  );
  await loadLightingRig(rigPath);
  const report = {
    schemaVersion: 1 as const,
    lightingRigId: rig.id,
    lightingRigPath: 'lighting-rig.json',
    sourceManifestPath: 'environment-radiance-source.json',
    sourceManifestSha256: sha256(sourceManifestBytes),
    sourceIdentitySha256: sourceManifest.sourceIdentitySha256,
    stagedArtifacts,
    environmentIllumination: rig.environmentIllumination,
    exposure: rig.exposure,
    status: 'structurally-verified-candidate' as const,
  };
  const reportPath = join(output, 'environment-lighting-candidate-report.json');
  await exactCandidateFile(
    reportPath,
    Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    'candidate-report',
  );
  return { output, rigPath, sourceManifestPath: stagedManifest, reportPath, rig, report };
}
