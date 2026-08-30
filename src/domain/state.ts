import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { GeneratedAsset } from '../providers/contracts.js';

export const renderRevisionSchema = z.object({
  id: z.string().regex(/^render-\d{3,}$/),
  kind: z.enum(['draft', 'final']),
  path: z.string(),
  parent: z.string().optional(),
  changes: z.array(z.string()).default([]),
  createdAt: z.string(),
});

export const generatedAssetSchema = z.object({
  shotId: z.string().optional(),
  path: z.string(),
  provider: z.string(),
  prompt: z.string().optional(),
  references: z.array(z.string()).default([]),
  attempt: z.number().int().positive().default(1),
  requestHash: z.string(),
  createdAt: z.string(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const campaignStateSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAssets: z.array(generatedAssetSchema).default([]),
  renders: z.array(renderRevisionSchema).default([]),
  inspections: z.array(z.string()).default([]),
  verificationReports: z.array(z.string()).default([]),
});

export type CampaignState = z.infer<typeof campaignStateSchema>;
export type RenderRevision = z.infer<typeof renderRevisionSchema>;

export const emptyCampaignState = (): CampaignState => ({
  schemaVersion: 1,
  generatedAssets: [],
  renders: [],
  inspections: [],
  verificationReports: [],
});

export async function loadCampaignState(path: string): Promise<CampaignState> {
  try {
    return campaignStateSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyCampaignState();
    throw error;
  }
}

export async function saveCampaignState(path: string, state: CampaignState): Promise<void> {
  const valid = campaignStateSchema.parse(state);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(valid, null, 2)}\n`, 'utf8');
}

export function recordGeneratedAsset(state: CampaignState, asset: GeneratedAsset): CampaignState {
  return {
    ...state,
    generatedAssets: [...state.generatedAssets, generatedAssetSchema.parse(asset)],
  };
}

export function nextRenderRevision(
  state: CampaignState,
  input: Omit<RenderRevision, 'id' | 'createdAt' | 'parent'> & { createdAt?: string },
): RenderRevision {
  const previous = state.renders.at(-1);
  return {
    ...input,
    id: `render-${String(state.renders.length + 1).padStart(3, '0')}`,
    ...(previous ? { parent: previous.id } : {}),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}
