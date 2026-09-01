import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import YAML from 'yaml';
import { ZodError, type ZodType } from 'zod';
import { findAsset, searchAssetLibrary } from '../assets/library.js';
import {
  assetManifestSchema,
  productionPlanSchema,
  type AssetManifest,
  type AssetRequirement,
  type ProductionPlan,
} from '../production/model.js';

function parse<T>(schema: ZodType<T>, value: unknown, path: string): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError)
      throw new Error(
        `Invalid ${path}:\n${error.issues.map((issue) => `  - ${issue.path.join('.') || '<root>'}: ${issue.message}`).join('\n')}`,
      );
    throw error;
  }
}

export async function loadProductionPlan(path: string): Promise<ProductionPlan> {
  const absolute = resolve(path);
  return parse(productionPlanSchema, YAML.parse(await readFile(absolute, 'utf8')), absolute);
}

export async function saveAssetManifest(path: string, manifest: AssetManifest) {
  const valid = assetManifestSchema.parse(manifest);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, YAML.stringify(valid), 'utf8');
}

export async function validateProductionPlan(path: string) {
  const plan = await loadProductionPlan(path);
  return {
    campaignId: plan.campaignId,
    title: plan.title,
    shots: plan.shots.length,
    requirements: plan.requirements.length,
    unresolved: plan.requirements.filter((item) => item.acquisition === 'unresolved').length,
  };
}

function requirementQuery(requirement: AssetRequirement) {
  return [requirement.description, ...requirement.tags].join(' ');
}

export async function resolveProductionAssets(
  productionPlanFile: string,
  libraryRoot: string,
  outputFile = join(dirname(resolve(productionPlanFile)), 'asset-manifest.yaml'),
) {
  const planPath = resolve(productionPlanFile);
  const library = resolve(libraryRoot);
  const plan = await loadProductionPlan(planPath);
  const resolutions: AssetManifest['resolutions'] = [];

  for (const requirement of plan.requirements) {
    if (requirement.acquisition === 'create') {
      resolutions.push({
        requirementId: requirement.id,
        decision: 'create',
        candidates: [],
        reason: 'Production plan explicitly requires a new asset.',
      });
      continue;
    }
    if (requirement.resolvedAsset) {
      const asset = await findAsset(library, requirement.resolvedAsset);
      if (!asset)
        throw new Error(
          `Resolved asset ${requirement.resolvedAsset.id}@${requirement.resolvedAsset.version} for ${requirement.id} is absent from ${library}`,
        );
      resolutions.push({
        requirementId: requirement.id,
        decision: requirement.acquisition === 'adapt' ? 'adapt' : 'reuse',
        asset: requirement.resolvedAsset,
        candidates: [],
        reason: 'Production plan pins an existing asset version.',
      });
      continue;
    }
    if (requirement.preferredAsset) {
      const preferred = await findAsset(library, requirement.preferredAsset);
      if (
        preferred &&
        preferred.source.clearance === 'approved' &&
        preferred.source.licence.commercialUse === 'allowed'
      ) {
        const missing = requirement.capabilities.filter(
          (capability) => !preferred.capabilities.includes(capability),
        );
        resolutions.push({
          requirementId: requirement.id,
          decision: missing.length ? 'adapt' : 'reuse',
          asset: requirement.preferredAsset,
          candidates: [],
          reason: missing.length
            ? `Preferred asset requires adaptation for: ${missing.join(', ')}.`
            : 'Preferred asset is commercially cleared and satisfies required capabilities.',
        });
        continue;
      }
    }
    const matches = await searchAssetLibrary(library, {
      type: requirement.type,
      query: requirementQuery(requirement),
      tags: requirement.tags,
      capabilities: requirement.capabilities,
    });
    const candidates = matches.slice(0, 5).map((match) => ({
      asset: { id: match.asset.id, version: match.asset.version },
      score: match.score,
      matchedTags: match.matchedTags,
      missingCapabilities: match.missingCapabilities,
    }));
    const best = candidates[0];
    if (!best) {
      resolutions.push({
        requirementId: requirement.id,
        decision: 'create',
        candidates: [],
        reason: 'No commercially cleared library asset matches this requirement.',
      });
      continue;
    }
    resolutions.push({
      requirementId: requirement.id,
      decision: best.missingCapabilities.length ? 'adapt' : 'reuse',
      asset: best.asset,
      candidates,
      reason: best.missingCapabilities.length
        ? `Best candidate is relevant but lacks: ${best.missingCapabilities.join(', ')}.`
        : 'Best candidate satisfies the required capabilities.',
    });
  }

  const manifest = assetManifestSchema.parse({
    schemaVersion: 1,
    campaignId: plan.campaignId,
    productionPlan: relative(dirname(resolve(outputFile)), planPath),
    library: relative(dirname(resolve(outputFile)), library),
    generatedAt: new Date().toISOString(),
    resolutions,
  });
  await saveAssetManifest(outputFile, manifest);
  return {
    manifest,
    output: resolve(outputFile),
    counts: {
      reuse: resolutions.filter((item) => item.decision === 'reuse').length,
      adapt: resolutions.filter((item) => item.decision === 'adapt').length,
      create: resolutions.filter((item) => item.decision === 'create').length,
    },
  };
}
