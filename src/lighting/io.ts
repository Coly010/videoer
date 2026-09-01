import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { openEnvironmentRadianceSourceManifestSchema } from '../assets/sources/model.js';
import { lightingRigSchema, type LightingRig, type LightingRigInput } from './model.js';

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function exactArtifact(
  path: string,
  binding: { sha256: string; sizeBytes?: number },
  label: string,
) {
  const bytes = await readFile(path);
  if (binding.sizeBytes !== undefined && bytes.byteLength !== binding.sizeBytes)
    throw new Error(`${label} byte size does not match its binding`);
  const digest = sha256(bytes);
  if (digest !== binding.sha256) throw new Error(`${label} sha256 does not match its binding`);
  return { path, sha256: digest, sizeBytes: bytes.byteLength, bytes };
}

function portablePath(root: string, path: string) {
  return relative(root, path).split(sep).join('/');
}

export async function verifyLightingRigEnvironmentIllumination(path: string, rig: LightingRig) {
  const environment = rig.environmentIllumination;
  if (environment?.kind !== 'hash-bound-equirectangular-radiance') return undefined;
  if (rig.schemaVersion !== 2)
    throw new Error('environment illumination requires lighting-rig schema version 2');
  const rigRoot = dirname(resolve(path));
  const manifestPath = resolve(rigRoot, environment.sourcePackage.manifest.path);
  const manifestArtifact = await exactArtifact(
    manifestPath,
    environment.sourcePackage.manifest,
    'environment source-package manifest',
  );
  const manifest = openEnvironmentRadianceSourceManifestSchema.parse(
    JSON.parse(manifestArtifact.bytes.toString('utf8')),
  );
  const manifestRoot = dirname(manifestPath);
  const declarations = [
    {
      role: 'source-package-api-response',
      path: manifest.providerApi.responsePath,
      sha256: manifest.providerApi.responseSha256,
    },
    {
      role: 'source-package-provider-licence-evidence',
      path: manifest.licence.providerEvidence.path,
      sha256: manifest.licence.providerEvidence.sha256,
      sizeBytes: manifest.licence.providerEvidence.sizeBytes,
    },
    {
      role: 'source-package-licence-assessment',
      path: manifest.licence.adapterAssessment.path,
      sha256: manifest.licence.adapterAssessment.sha256,
    },
    {
      role: 'source-package-archive',
      path: manifest.sourceArchive.path,
      sha256: manifest.sourceArchive.sha256,
      sizeBytes: manifest.sourceArchive.sizeBytes,
    },
    {
      role: 'source-package-radiance',
      path: manifest.radiance.path,
      sha256: manifest.radiance.sha256,
      sizeBytes: manifest.radiance.sizeBytes,
    },
    ...(manifest.radiance.encoding === 'openexr'
      ? [
          {
            role: 'source-package-openexr-inspection',
            path: manifest.radiance.structuralEvidence.inspector.evidencePath,
            sha256: manifest.radiance.structuralEvidence.inspector.evidenceSha256,
          },
        ]
      : []),
  ];
  const artifacts = await Promise.all(
    declarations.map(async (declaration) => ({
      role: declaration.role,
      packageRelativePath: portablePath(rigRoot, resolve(manifestRoot, declaration.path)),
      ...(await exactArtifact(
        resolve(manifestRoot, declaration.path),
        declaration,
        declaration.role,
      )),
    })),
  );
  const radiancePath = resolve(rigRoot, environment.source.path);
  if (radiancePath !== resolve(manifestRoot, manifest.radiance.path))
    throw new Error('lighting radiance path does not identify the source-package radiance');
  if (
    environment.source.sha256 !== manifest.radiance.sha256 ||
    environment.source.sizeBytes !== manifest.radiance.sizeBytes ||
    environment.source.mediaType !== manifest.radiance.mediaType ||
    environment.colorSpace !== manifest.radiance.colorSpace.name ||
    environment.dimensions.widthPixels !== manifest.radiance.widthPixels ||
    environment.dimensions.heightPixels !== manifest.radiance.heightPixels
  )
    throw new Error('lighting radiance identity contradicts its source-package manifest');
  return {
    manifest,
    manifestArtifact: {
      role: 'source-package-manifest',
      packageRelativePath: environment.sourcePackage.manifest.path,
      ...manifestArtifact,
    },
    artifacts,
  };
}

export async function lightingRigTransitiveDependencies(path: string, rig: LightingRig) {
  const verification = await verifyLightingRigEnvironmentIllumination(path, rig);
  if (!verification) return [];
  return [verification.manifestArtifact, ...verification.artifacts].map(
    ({ role, packageRelativePath, path: artifactPath, sha256: digest, sizeBytes }) => ({
      role,
      packageRelativePath,
      path: artifactPath,
      sha256: digest,
      sizeBytes,
    }),
  );
}

export async function loadLightingRig(path: string) {
  const rig = lightingRigSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
  await verifyLightingRigEnvironmentIllumination(path, rig);
  return rig;
}

export type SaveLightingRigOptions = {
  environmentSourceRigPath?: string;
};

async function createOrIdentical(source: string, target: string, expectedSha256: string) {
  if (source === target) return;
  const bytes = await readFile(source);
  if (sha256(bytes) !== expectedSha256)
    throw new Error(`source-package artifact changed before restaging: ${source}`);
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(target, bytes, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (sha256(await readFile(target)) !== expectedSha256)
      throw new Error(`environment source-package artifact collision: ${target}`);
  }
}

async function assertTargetCompatible(target: string, expectedSha256: string) {
  try {
    if (sha256(await readFile(target)) !== expectedSha256)
      throw new Error(`environment source-package artifact collision: ${target}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function saveLightingRig(
  path: string,
  rig: LightingRigInput,
  options: SaveLightingRigOptions = {},
) {
  const output = resolve(path);
  const parsed = lightingRigSchema.parse(rig);
  if (parsed.environmentIllumination?.kind === 'hash-bound-equirectangular-radiance') {
    if (options.environmentSourceRigPath) {
      const sourceRigPath = resolve(options.environmentSourceRigPath);
      const dependencies = await lightingRigTransitiveDependencies(sourceRigPath, parsed);
      const sourceRoot = dirname(sourceRigPath);
      const targetRoot = dirname(output);
      await Promise.all(
        dependencies.map((dependency) =>
          assertTargetCompatible(
            resolve(targetRoot, dependency.packageRelativePath),
            dependency.sha256,
          ),
        ),
      );
      for (const dependency of dependencies)
        await createOrIdentical(
          resolve(sourceRoot, dependency.packageRelativePath),
          resolve(targetRoot, dependency.packageRelativePath),
          dependency.sha256,
        );
    }
    await verifyLightingRigEnvironmentIllumination(output, parsed);
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return output;
}
