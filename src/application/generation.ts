import { access } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { assetCacheKey, campaignPaths } from '../assets/layout.js';
import { loadCampaign, loadStoryboard, saveStoryboard } from '../domain/io.js';
import { loadCampaignState, recordGeneratedAsset, saveCampaignState } from '../domain/state.js';
import type { Campaign, SceneKeyframe, SceneKeyframeShot } from '../domain/schemas.js';
import type { ImageProvider } from '../providers/contracts.js';

function continuityInstructions(shot: SceneKeyframeShot) {
  const locks: string[] = [];
  if (shot.continuity.lockBackground)
    locks.push('environment, background geometry, horizon, and overall composition family');
  if (shot.continuity.lockCharacterIdentity)
    locks.push('subject identity, face, body proportions, and distinguishing features');
  if (shot.continuity.lockCostume) locks.push('costume, armour, props, and material language');
  if (shot.continuity.lockLightingFamily)
    locks.push('time of day, palette, light direction, and lighting family');
  if (shot.continuity.lockCreatureDesign)
    locks.push('creature anatomy, silhouette, markings, and scale');
  return locks.length
    ? `Preserve exactly: ${locks.join('; ')}.`
    : 'Preserve the recognizable scene composition and visual identity.';
}

export function buildSceneKeyframePrompt(
  campaign: Campaign,
  shot: SceneKeyframeShot,
  keyframe: SceneKeyframe,
) {
  const context = `Campaign: ${campaign.title}. Style: ${campaign.style}. Tone: ${campaign.tone.join(', ')}. Scene intent: ${shot.prompt}.`;
  const frame = `Keyframe ${keyframe.role}: ${keyframe.prompt ?? keyframe.description}.`;
  if (keyframe.role === 'anchor')
    return `${context} ${frame} Establish the canonical scene, subject designs, spatial relationships, costume language, and lighting for all later frames. ${continuityInstructions(shot)} Vertical cinematic frame for ${campaign.output.width}x${campaign.output.height} delivery. No typography, captions, logos, borders, or watermark.`;
  return `${context} ${frame} This is a later moment in the SAME continuous shot, not a new illustration or alternate concept. Make only the described in-scene action progress from the supplied anchor/reference frame. ${continuityInstructions(shot)} Keep the background substantially stable; allow only motivated character, creature, prop, atmosphere, energy, light, or slight camera-distance changes. Vertical cinematic frame. No typography, captions, logos, borders, or watermark.`;
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface SceneGenerationOptions {
  shotId?: string;
  keyframeId?: string;
  force?: boolean;
}

export async function generateSceneKeyframes(
  campaignFile: string,
  provider: ImageProvider,
  options: SceneGenerationOptions = {},
) {
  if (options.keyframeId && !options.shotId)
    throw new Error('Selecting a keyframe requires a shotId because keyframe IDs are shot-local');
  const absoluteCampaign = resolve(campaignFile);
  const root = dirname(absoluteCampaign);
  const paths = campaignPaths(root);
  const campaign = await loadCampaign(absoluteCampaign);
  let storyboard = await loadStoryboard(paths.storyboard);
  let state = await loadCampaignState(paths.state);
  const generated: Array<{ shotId: string; keyframeId: string; path: string; cached: boolean }> =
    [];

  for (let shotIndex = 0; shotIndex < storyboard.shots.length; shotIndex++) {
    const shot = storyboard.shots[shotIndex]!;
    if (shot.type !== 'scene-keyframes' || (options.shotId && shot.id !== options.shotId)) continue;
    const keyframes = [...shot.keyframes];
    for (let keyframeIndex = 0; keyframeIndex < keyframes.length; keyframeIndex++) {
      const keyframe = keyframes[keyframeIndex]!;
      if (options.keyframeId && keyframe.id !== options.keyframeId) continue;
      const prompt = buildSceneKeyframePrompt(campaign, shot, keyframe);
      const revision = keyframe.generation.revision;
      const relativePath = join('generated', 'images', shot.id, `${keyframe.id}.r${revision}.png`);
      const outputPath = resolve(root, relativePath);
      const priorPaths = keyframes
        .slice(0, keyframeIndex)
        .map((item) => item.assetPath)
        .filter((item): item is string => Boolean(item))
        .map((item) => resolve(root, item));
      if (keyframe.role !== 'anchor' && priorPaths.length === 0)
        throw new Error(`Cannot generate ${shot.id}/${keyframe.id} before its anchor keyframe`);
      const references =
        keyframe.role === 'anchor'
          ? []
          : [priorPaths[0]!, priorPaths.at(-1)!].filter(
              (value, index, all) => all.indexOf(value) === index,
            );
      const cacheKey = assetCacheKey({
        provider: provider.id,
        prompt,
        references: references.map((item) => relative(root, item)),
        width: campaign.output.width,
        height: campaign.output.height,
        revision,
      });
      const cached =
        !options.force &&
        keyframe.assetPath === relativePath &&
        (await exists(outputPath)) &&
        state.generatedAssets.some((asset) => asset.metadata.cacheKey === cacheKey);
      if (cached) {
        generated.push({
          shotId: shot.id,
          keyframeId: keyframe.id,
          path: relativePath,
          cached: true,
        });
        continue;
      }
      const asset = await provider.generate({
        prompt,
        outputPath,
        width: campaign.output.width,
        height: campaign.output.height,
        shotId: shot.id,
        references,
        attempt: revision + 1,
      });
      keyframes[keyframeIndex] = {
        ...keyframe,
        assetPath: relativePath,
        generation: { revision, stale: false },
      };
      state = recordGeneratedAsset(state, {
        ...asset,
        path: relative(root, asset.path),
        metadata: { ...asset.metadata, cacheKey, keyframeId: keyframe.id, role: keyframe.role },
      });
      generated.push({
        shotId: shot.id,
        keyframeId: keyframe.id,
        path: relativePath,
        cached: false,
      });
      const shots = [...storyboard.shots];
      shots[shotIndex] = { ...shot, keyframes, generation: { ...shot.generation, stale: false } };
      storyboard = { ...storyboard, shots };
      await Promise.all([
        saveStoryboard(paths.storyboard, storyboard),
        saveCampaignState(paths.state, state),
      ]);
    }
  }

  if (
    options.shotId &&
    !storyboard.shots.some((shot) => shot.id === options.shotId && shot.type === 'scene-keyframes')
  )
    throw new Error(`Scene-keyframes shot '${options.shotId}' does not exist`);
  if (options.keyframeId && generated.length === 0)
    throw new Error(`Keyframe '${options.keyframeId}' does not exist in the selected scene shot`);
  return { provider: provider.id, generated, storyboard: paths.storyboard, state: paths.state };
}

export async function regenerateSceneKeyframe(
  campaignFile: string,
  provider: ImageProvider,
  shotId: string,
  keyframeId?: string,
) {
  const absoluteCampaign = resolve(campaignFile);
  const paths = campaignPaths(dirname(absoluteCampaign));
  const storyboard = await loadStoryboard(paths.storyboard);
  const index = storyboard.shots.findIndex((shot) => shot.id === shotId);
  if (index < 0 || storyboard.shots[index]!.type !== 'scene-keyframes')
    throw new Error(`Scene-keyframes shot '${shotId}' does not exist`);
  const shot = storyboard.shots[index] as SceneKeyframeShot;
  if (keyframeId && !shot.keyframes.some((keyframe) => keyframe.id === keyframeId))
    throw new Error(`Keyframe '${keyframeId}' does not exist in shot '${shotId}'`);
  const keyframes = shot.keyframes.map((keyframe) =>
    !keyframeId || keyframe.id === keyframeId
      ? { ...keyframe, generation: { revision: keyframe.generation.revision + 1, stale: true } }
      : keyframe,
  );
  const shots = [...storyboard.shots];
  shots[index] = {
    ...shot,
    keyframes,
    generation: { revision: shot.generation.revision + 1, stale: true },
  };
  await saveStoryboard(paths.storyboard, { ...storyboard, shots });
  return generateSceneKeyframes(absoluteCampaign, provider, {
    shotId,
    ...(keyframeId ? { keyframeId } : {}),
    force: true,
  });
}
