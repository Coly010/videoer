import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import YAML from 'yaml';
import { sha256File } from '../assets/library.js';
import { renderCinematicScene } from '../cinematic/blender.js';
import { fingerprintCinematicScene, fingerprintEditInputs } from '../cinematic/fingerprint.js';
import {
  cinematicProductionReviewSchema,
  cinematicProductionRunSchema,
  selectCinematicProductionWork,
  type CinematicProductionRun,
} from '../production/autonomous-run.js';
import { loadDeclarativeCinematicCampaign } from '../production/cinematic-campaign-io.js';
import type { DeclarativeCinematicCampaign } from '../production/cinematic-campaign.js';
import { productionPlanSchema, type ProductionPlan } from '../production/model.js';
import { buildDeclarativeCinematicCampaign } from './cinematic-campaign.js';

function productionDirectory(campaignFile: string) {
  return join(dirname(resolve(campaignFile)), 'work', 'production');
}

function runFile(campaignFile: string) {
  return join(productionDirectory(campaignFile), 'production-run.json');
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadPriorRun(path: string) {
  if (!(await exists(path))) return undefined;
  return cinematicProductionRunSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

function requirementTypeForGeometry(
  campaign: DeclarativeCinematicCampaign,
  source: DeclarativeCinematicCampaign['geometry'][number],
) {
  if (source.library && ['character', 'environment', 'prop'].includes(source.library.type))
    return source.library.type as 'character' | 'environment' | 'prop';
  const publication = source.recipe?.publication ?? source.adaptation?.publication;
  if (publication && ['character', 'environment', 'prop'].includes(publication.type))
    return publication.type as 'character' | 'environment' | 'prop';
  const roles = campaign.shots.flatMap((shot) =>
    shot.entities.filter((entity) => entity.geometry === source.id).map((entity) => entity.role),
  );
  if (roles.includes('character')) return 'character' as const;
  if (roles.includes('environment')) return 'environment' as const;
  return 'prop' as const;
}

function usedShots(
  campaign: DeclarativeCinematicCampaign,
  predicate: (shot: DeclarativeCinematicCampaign['shots'][number]) => boolean,
) {
  const ids = campaign.shots.filter(predicate).map((shot) => shot.id);
  return ids.length ? ids : campaign.shots.map((shot) => shot.id);
}

function libraryRequirement(
  id: string,
  type: ProductionPlan['requirements'][number]['type'],
  description: string,
  requiredShots: string[],
  library?: {
    query: string;
    tags: string[];
    capabilities: string[];
    preferredAsset?: { id: string; version: string } | undefined;
  },
): ProductionPlan['requirements'][number] {
  return {
    id,
    type,
    description: library?.query ?? description,
    requiredShots,
    tags: library?.tags ?? [],
    capabilities: library?.capabilities ?? [],
    constraints: {},
    ...(library?.preferredAsset ? { preferredAsset: library.preferredAsset } : {}),
    acquisition: library ? 'unresolved' : 'create',
  };
}

/** Creates the inspectable renderer-independent plan before asset construction starts. */
export function deriveCinematicProductionPlan(
  campaign: DeclarativeCinematicCampaign,
): ProductionPlan {
  const requirements: ProductionPlan['requirements'] = [];
  for (const source of campaign.geometry)
    requirements.push(
      libraryRequirement(
        `geometry-${source.id}`,
        requirementTypeForGeometry(campaign, source),
        `Geometry source ${source.id}`,
        usedShots(campaign, (shot) =>
          shot.entities.some((entity) => entity.geometry === source.id),
        ),
        source.library,
      ),
    );
  for (const source of campaign.clothingSources)
    requirements.push(
      libraryRequirement(
        `clothing-${source.id}`,
        'clothing',
        `Clothing source ${source.id}`,
        usedShots(campaign, (shot) =>
          shot.entities.some((entity) =>
            entity.wardrobe.some((binding) => binding.clothing === source.id),
          ),
        ),
        source.library,
      ),
    );
  for (const source of campaign.materialSources) {
    const boundGeometry = new Set(
      campaign.geometry
        .filter((geometry) =>
          geometry.materialBindings.some((binding) => binding.material === source.id),
        )
        .map((geometry) => geometry.id),
    );
    requirements.push(
      libraryRequirement(
        `material-${source.id}`,
        'material',
        `Material source ${source.id}`,
        usedShots(campaign, (shot) =>
          shot.entities.some((entity) => boundGeometry.has(entity.geometry)),
        ),
        source.library,
      ),
    );
  }
  for (const source of campaign.motions) {
    const directShots = usedShots(campaign, (shot) =>
      shot.entities.some((entity) => entity.motion?.source === source.id),
    );
    const timelineIds = campaign.motionTimelines
      .filter((timeline) => timeline.layers.some((layer) => layer.motion === source.id))
      .map((timeline) => timeline.id);
    requirements.push(
      libraryRequirement(
        `motion-${source.id}`,
        'motion',
        `Motion source ${source.id}`,
        timelineIds.length
          ? usedShots(campaign, (shot) =>
              shot.entities.some((entity) =>
                entity.motion ? timelineIds.includes(entity.motion.source) : false,
              ),
            )
          : directShots,
        source.library,
      ),
    );
  }
  for (const source of campaign.vfxSources)
    requirements.push(
      libraryRequirement(
        `vfx-${source.id}`,
        'vfx',
        `Atmospheric VFX source ${source.id}`,
        usedShots(campaign, (shot) => shot.vfx === source.id),
        source.library,
      ),
    );
  for (const source of campaign.finishSources)
    requirements.push(
      libraryRequirement(
        `finish-${source.id}`,
        'vfx',
        `Cinematic finish source ${source.id}`,
        usedShots(campaign, (shot) => shot.finish === source.id),
        source.library,
      ),
    );
  for (const source of campaign.lightingSources)
    requirements.push(
      libraryRequirement(
        `lighting-${source.id}`,
        'lighting',
        `Lighting source ${source.id}`,
        usedShots(campaign, (shot) => shot.lighting === source.id),
        source.library,
      ),
    );
  for (const source of campaign.overlays)
    requirements.push(
      libraryRequirement(
        `editorial-${source.id}`,
        'editorial',
        `Editorial overlay ${source.id}`,
        usedShots(campaign, (shot) =>
          shot.overlays.some((overlay) => overlay.overlay === source.id),
        ),
        'library' in source ? source.library : undefined,
      ),
    );
  for (const source of campaign.audioSources)
    requirements.push(
      libraryRequirement(
        `audio-${source.id}`,
        'audio',
        `Audio source ${source.id}`,
        campaign.shots.map((shot) => shot.id),
        source.library,
      ),
    );
  requirements.push(
    libraryRequirement(
      'audio-soundtrack',
      'audio',
      `Deterministic soundtrack ${campaign.soundtrack.id}`,
      campaign.shots.map((shot) => shot.id),
    ),
  );

  return productionPlanSchema.parse({
    schemaVersion: 1,
    campaignId: campaign.id,
    title: campaign.id,
    summary:
      typeof campaign.metadata.conformancePurpose === 'string'
        ? campaign.metadata.conformancePurpose
        : `Autonomous cinematic production for ${campaign.id}`,
    shots: campaign.shots.map((shot) => ({
      id: shot.id,
      purpose: shot.landmarks.map((landmark) => landmark.description).join('; '),
      durationSeconds: shot.frames / campaign.fps,
      requirements: requirements
        .filter((requirement) => requirement.requiredShots.includes(shot.id))
        .map((requirement) => requirement.id),
      actions: shot.entities.flatMap((entity) =>
        entity.motion
          ? [
              {
                actor: entity.id,
                motion: entity.motion.source,
                startSeconds: entity.motion.startFrame / campaign.fps,
                durationSeconds:
                  ((entity.motion.endFrame ?? shot.frames) - entity.motion.startFrame) /
                  campaign.fps,
                params: {},
              },
            ]
          : [],
      ),
      camera: shot.camera,
      lighting: {
        source: shot.lighting ?? 'supplemental-only',
        supplementalLights: shot.lights.length,
      },
      ...(typeof shot.metadata.continuityGroup === 'string'
        ? { continuityGroup: shot.metadata.continuityGroup }
        : {}),
    })),
    requirements,
  });
}

function reviewTemplate(
  campaign: DeclarativeCinematicCampaign,
  sourceSha256: string,
  shotStates: CinematicProductionRun['shots'],
  deliveryInputSha256: string,
  finalContactSheet: string,
) {
  const pending = (instruction: string) => ({ status: 'PENDING', observation: instruction });
  return {
    schemaVersion: 1,
    campaignId: campaign.id,
    sourceSha256,
    reviewer: 'REPLACE_WITH_ACCOUNTABLE_REVIEWER',
    reviewedAt: 'REPLACE_WITH_ISO_8601_TIMESTAMP',
    shots: shotStates.map((shot) => ({
      id: shot.id,
      inputSha256: shot.inputSha256,
      contactSheet: shot.contactSheet,
      dimensions: {
        framing: pending('Inspect crop, scale, eyeline, and camera intent.'),
        motion: pending(
          'Inspect direction, contacts, joint articulation, deformation, and temporal continuity.',
        ),
        continuity: pending(
          'Compare identity, wardrobe, environment, props, and screen direction with adjacent shots.',
        ),
        lighting: pending(
          'Inspect exposure, readable silhouettes, highlights, depth, and intentional colour.',
        ),
        editorial: pending('Inspect hierarchy, safe area, legibility, timing, and compositing.'),
      },
      verdict: 'PENDING',
      repair: 'REMOVE_IF_PASS_OR_DESCRIBE_THE_CONCRETE_REPAIR',
    })),
    final: {
      deliveryInputSha256,
      contactSheet: finalContactSheet,
      dimensions: {
        pacing: pending('Watch the complete delivery and inspect shot timing and transitions.'),
        continuity: pending('Inspect cross-shot visual, action, spatial, and identity continuity.'),
        audio: pending(
          'Listen for timing, intelligibility, balance, discontinuities, and final resolve.',
        ),
        editorial: pending(
          'Inspect copy sequence, reading time, hierarchy, and CTA or identity resolution.',
        ),
        composition: pending(
          'Inspect the complete contact sheet and delivery for a coherent intentional finish.',
        ),
      },
      verdict: 'PENDING',
      repair: 'REMOVE_IF_PASS_OR_DESCRIBE_THE_CONCRETE_REPAIR',
    },
  };
}

export async function produceDeclarativeCinematicCampaign(
  campaignFile: string,
  options: { repairShots?: string[] } = {},
) {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const sourceFile = resolve(campaignFile);
  const root = dirname(sourceFile);
  const directory = productionDirectory(sourceFile);
  const stateFile = runFile(sourceFile);
  await mkdir(directory, { recursive: true });
  const campaign = await loadDeclarativeCinematicCampaign(sourceFile);
  const sourceSha256 = await sha256File(sourceFile);
  const requestedShots = options.repairShots ?? [];
  const knownShots = new Set(campaign.shots.map((shot) => shot.id));
  const unknownShots = requestedShots.filter((shot) => !knownShots.has(shot));
  if (unknownShots.length) throw new Error(`Unknown repair shot(s): ${unknownShots.join(', ')}`);

  const plan = deriveCinematicProductionPlan(campaign);
  const productionPlanFile = join(directory, 'production-plan.yaml');
  await writeFile(productionPlanFile, YAML.stringify(plan), 'utf8');

  const prepared = await buildDeclarativeCinematicCampaign(sourceFile, { render: false });
  const fingerprints = await Promise.all(
    prepared.scenes.map(async (scene, index) => ({
      id: campaign.shots[index]!.id,
      ...(await fingerprintCinematicScene(scene.sceneFile)),
    })),
  );
  const prior = await loadPriorRun(stateFile);
  const priorRuntime = prior
    ? await Promise.all(
        prior.shots.map(async (shot) => {
          const videoAvailable = Boolean(shot.video && (await exists(shot.video)));
          const evidenceAvailable = Boolean(
            shot.report &&
            shot.contactSheet &&
            (await exists(shot.report)) &&
            (await exists(shot.contactSheet)),
          );
          const actualVideoSha256 = videoAvailable ? await sha256File(shot.video!) : undefined;
          let renderInputSha256 = shot.renderInputSha256;
          if (!renderInputSha256 && shot.report && (await exists(shot.report))) {
            const report = JSON.parse(await readFile(shot.report, 'utf8')) as {
              manifest?: string;
            };
            if (report.manifest && (await exists(report.manifest)))
              renderInputSha256 = (await fingerprintCinematicScene(report.manifest)).renderSha256;
          }
          return {
            shot,
            videoAvailable:
              videoAvailable && (!shot.videoSha256 || shot.videoSha256 === actualVideoSha256),
            evidenceAvailable,
            actualVideoSha256,
            renderInputSha256,
          };
        }),
      )
    : [];
  const work = selectCinematicProductionWork(
    fingerprints.map((fingerprint) => ({
      id: fingerprint.id,
      inputSha256: fingerprint.sha256,
      renderInputSha256: fingerprint.renderSha256,
    })),
    priorRuntime.map((runtime) => ({
      id: runtime.shot.id,
      inputSha256: runtime.shot.inputSha256,
      ...(runtime.renderInputSha256 ? { renderInputSha256: runtime.renderInputSha256 } : {}),
      status: runtime.shot.status,
      videoAvailable: runtime.videoAvailable,
      evidenceAvailable: runtime.evidenceAvailable,
    })),
    requestedShots,
  );
  const staleShots = work.evidenceShots;
  const editFingerprint = await fingerprintEditInputs(
    prepared.editPlanFile,
    resolve(root, campaign.soundtrackPath),
  );
  const deliveryInputsChanged = prior?.deliveryInputSha256 !== editFingerprint.sha256;
  const mustAssemble = work.renderShots.length > 0 || deliveryInputsChanged || !prior?.delivery;

  let rendered: Awaited<ReturnType<typeof buildDeclarativeCinematicCampaign>> | undefined;
  if (mustAssemble)
    rendered = await buildDeclarativeCinematicCampaign(sourceFile, {
      render: true,
      renderShots: work.renderShots,
      continueOnRenderFailure: true,
    });

  const resultsById = new Map(
    (rendered?.scenes ?? []).map((scene, index) => [campaign.shots[index]!.id, scene]),
  );
  await Promise.all(
    work.evidenceOnlyShots.map(async (shotId) => {
      const index = campaign.shots.findIndex((shot) => shot.id === shotId);
      const sceneFile = prepared.scenes[index]!.sceneFile;
      try {
        resultsById.set(shotId, {
          scene: `scene.${shotId}`,
          sceneFile,
          render: await renderCinematicScene(sceneFile, join(dirname(sceneFile), 'verification'), {
            reuseExistingPixels: true,
          }),
        });
      } catch (error) {
        resultsById.set(shotId, {
          scene: `scene.${shotId}`,
          sceneFile,
          renderError: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
  const priorById = new Map((prior?.shots ?? []).map((shot) => [shot.id, shot]));
  const priorRuntimeById = new Map(priorRuntime.map((runtime) => [runtime.shot.id, runtime]));
  const now = new Date().toISOString();
  const shotStates: CinematicProductionRun['shots'] = await Promise.all(
    fingerprints.map(async (fingerprint) => {
      const priorShot = priorById.get(fingerprint.id);
      const runtime = priorRuntimeById.get(fingerprint.id);
      if (!staleShots.includes(fingerprint.id))
        return {
          ...priorShot!,
          renderInputSha256: fingerprint.renderSha256,
          ...(runtime?.actualVideoSha256 ? { videoSha256: runtime.actualVideoSha256 } : {}),
        };
      const result = resultsById.get(fingerprint.id)!;
      if (result.renderError)
        return {
          id: fingerprint.id,
          inputSha256: fingerprint.sha256,
          renderInputSha256: fingerprint.renderSha256,
          status: 'fail' as const,
          renderedAt: work.renderShots.includes(fingerprint.id)
            ? now
            : (priorShot?.renderedAt ?? now),
          ...(work.evidenceOnlyShots.includes(fingerprint.id) ? { evidenceRefreshedAt: now } : {}),
          ...(priorShot?.video ? { video: priorShot.video } : {}),
          ...(runtime?.actualVideoSha256 ? { videoSha256: runtime.actualVideoSha256 } : {}),
          error: result.renderError,
        };
      const render = result.render!;
      return {
        id: fingerprint.id,
        inputSha256: fingerprint.sha256,
        renderInputSha256: fingerprint.renderSha256,
        videoSha256: await sha256File(render.video),
        status: 'pass' as const,
        renderedAt: work.renderShots.includes(fingerprint.id)
          ? now
          : (priorShot?.renderedAt ?? now),
        ...(work.evidenceOnlyShots.includes(fingerprint.id) ? { evidenceRefreshedAt: now } : {}),
        video: render.video,
        contactSheet: render.contactSheet,
        report: render.report,
      };
    }),
  );
  const failedShots = shotStates.filter((shot) => shot.status === 'fail').map((shot) => shot.id);
  const delivery = rendered?.delivery?.video ?? (mustAssemble ? undefined : prior?.delivery);
  const finalContactSheet = rendered?.delivery?.contactSheet ?? prior?.finalContactSheet;
  const preservesAcceptedReview =
    prior?.status === 'completed' &&
    prior.sourceSha256 === sourceSha256 &&
    staleShots.length === 0 &&
    !mustAssemble &&
    requestedShots.length === 0;
  const status = failedShots.length
    ? 'needs-repair'
    : preservesAcceptedReview
      ? 'completed'
      : 'awaiting-review';
  const templateFile = join(directory, 'review-template.yaml');
  if (preservesAcceptedReview) {
    // A byte-identical no-op resume retains the already hash-bound review and its template.
  } else if (!failedShots.length && delivery && finalContactSheet)
    await writeFile(
      templateFile,
      YAML.stringify(
        reviewTemplate(
          campaign,
          sourceSha256,
          shotStates,
          editFingerprint.sha256,
          finalContactSheet,
        ),
      ),
      'utf8',
    );
  else
    await writeFile(
      templateFile,
      YAML.stringify({
        schemaVersion: 1,
        campaignId: campaign.id,
        status: 'BLOCKED_BY_OBJECTIVE_FAILURES',
        failedShots: shotStates
          .filter((shot) => shot.status === 'fail')
          .map((shot) => ({ id: shot.id, error: shot.error })),
      }),
      'utf8',
    );

  const completedAt = new Date().toISOString();
  const attempt = {
    id: `attempt-${String((prior?.attempts.length ?? 0) + 1).padStart(3, '0')}`,
    kind: prior
      ? requestedShots.length
        ? ('repair' as const)
        : ('resume' as const)
      : ('initial' as const),
    startedAt,
    completedAt,
    elapsedMilliseconds: performance.now() - started,
    sourceSha256,
    requestedShots,
    staleShots,
    renderedShots: work.renderShots.filter((shot) => !failedShots.includes(shot)),
    evidenceRefreshedShots: work.evidenceOnlyShots.filter((shot) => !failedShots.includes(shot)),
    reusedShots: campaign.shots.map((shot) => shot.id).filter((shot) => !staleShots.includes(shot)),
    failedShots,
    deliveryAssembled: Boolean(rendered?.delivery?.video),
    stages: [
      {
        id: 'analyse' as const,
        status: 'pass' as const,
        artifacts: [sourceFile],
        detail: 'Validated the complete declarative campaign contract.',
      },
      {
        id: 'plan' as const,
        status: 'pass' as const,
        artifacts: [productionPlanFile],
        detail: 'Persisted a renderer-independent production plan before construction.',
      },
      {
        id: 'resolve' as const,
        status: 'pass' as const,
        artifacts: [resolve(root, 'work', 'asset-manifest.yaml')],
        detail:
          'Recorded reuse, adapt, and create decisions against commercially cleared inventory.',
      },
      {
        id: 'build-assets' as const,
        status: 'pass' as const,
        artifacts: [prepared.reportFile],
        detail: 'Built and semantically validated every declared source.',
      },
      {
        id: 'build-scenes' as const,
        status: 'pass' as const,
        artifacts: prepared.scenes.map((scene) => scene.sceneFile),
        detail: 'Built renderer-independent executable scene contracts.',
      },
      {
        id: 'render-shots' as const,
        status: failedShots.length ? ('fail' as const) : ('pass' as const),
        artifacts: shotStates.flatMap((shot) => (shot.video ? [shot.video] : [])),
        detail: failedShots.length
          ? `Objective rendering failed for: ${failedShots.join(', ')}.`
          : `Rendered ${work.renderShots.length} pixel-stale shot(s), refreshed evidence for ${work.evidenceOnlyShots.length}, and fully reused ${campaign.shots.length - staleShots.length}.`,
      },
      {
        id: 'objective-inspection' as const,
        status: failedShots.length ? ('fail' as const) : ('pass' as const),
        artifacts: shotStates.flatMap((shot) =>
          [shot.report, shot.contactSheet].filter((path): path is string => Boolean(path)),
        ),
        detail: failedShots.length
          ? 'One or more objective scene or render gates failed.'
          : 'Every scene and render gate passed with semantic frames and contact sheets.',
      },
      {
        id: 'assemble-delivery' as const,
        status: failedShots.length === 0 && delivery ? ('pass' as const) : ('skipped' as const),
        artifacts: delivery ? [delivery] : [],
        detail: failedShots.length
          ? 'Current delivery is ineligible until every refreshed shot evidence gate passes.'
          : delivery
            ? 'Assembled and verified the frame-exact final delivery.'
            : 'Delivery assembly is forbidden until every shot passes.',
      },
      {
        id: 'qualitative-review' as const,
        status: failedShots.length
          ? ('skipped' as const)
          : preservesAcceptedReview
            ? ('pass' as const)
            : ('awaiting-review' as const),
        artifacts: preservesAcceptedReview ? [prior!.acceptedReview!] : [templateFile],
        detail: failedShots.length
          ? 'Qualitative acceptance waits for objective repairs.'
          : preservesAcceptedReview
            ? 'The existing review remains valid because every bound input is byte-identical.'
            : 'An accountable Codex or human review must inspect every shot and the complete delivery.',
      },
      {
        id: 'publish-ready' as const,
        status: preservesAcceptedReview ? ('pass' as const) : ('skipped' as const),
        artifacts: [],
        detail: preservesAcceptedReview
          ? 'Objective and qualitative evidence remain complete for explicit asset approval.'
          : 'Useful assets remain ineligible for approval until qualitative review passes.',
      },
    ],
  };
  const run = cinematicProductionRunSchema.parse({
    schemaVersion: 1,
    campaignId: campaign.id,
    campaignFile: sourceFile,
    sourceSha256,
    status,
    productionPlan: productionPlanFile,
    assetManifest: resolve(root, 'work', 'asset-manifest.yaml'),
    buildReport: prepared.reportFile,
    reviewTemplate: templateFile,
    ...(delivery ? { deliveryInputSha256: editFingerprint.sha256, delivery } : {}),
    ...(finalContactSheet ? { finalContactSheet } : {}),
    shots: shotStates,
    attempts: [...(prior?.attempts ?? []), attempt],
    ...(preservesAcceptedReview && prior?.acceptedReview
      ? { acceptedReview: prior.acceptedReview }
      : {}),
    updatedAt: completedAt,
  });
  await writeFile(stateFile, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  return {
    run,
    stateFile,
    staleShots,
    renderShots: work.renderShots,
    evidenceRefreshedShots: work.evidenceOnlyShots,
    failedShots,
    reviewTemplate: templateFile,
  };
}

export async function loadCinematicProductionRun(campaignFile: string) {
  const path = runFile(campaignFile);
  const run = await loadPriorRun(path);
  if (!run) throw new Error(`Campaign has no autonomous production run at '${path}'`);
  return { run, stateFile: path };
}

export async function recordCinematicProductionReview(campaignFile: string, reviewFile: string) {
  const sourceFile = resolve(campaignFile);
  const { run, stateFile } = await loadCinematicProductionRun(sourceFile);
  const reviewPath = resolve(reviewFile);
  const review = cinematicProductionReviewSchema.parse(
    YAML.parse(await readFile(reviewPath, 'utf8')),
  );
  const currentSourceSha256 = await sha256File(sourceFile);
  if (review.campaignId !== run.campaignId)
    throw new Error('Review campaign does not match the production run');
  if (review.sourceSha256 !== currentSourceSha256 || run.sourceSha256 !== currentSourceSha256)
    throw new Error('Campaign changed after rendering; rerun production before qualitative review');
  if (!run.deliveryInputSha256 || !run.delivery || !run.finalContactSheet)
    throw new Error('Production has no objectively verified assembled delivery to review');
  if (review.final.deliveryInputSha256 !== run.deliveryInputSha256)
    throw new Error('Final review does not match the current edit and soundtrack inputs');
  if (resolve(review.final.contactSheet) !== resolve(run.finalContactSheet))
    throw new Error('Final review must inspect the current delivery contact sheet');
  const reviewedById = new Map(review.shots.map((shot) => [shot.id, shot]));
  if (reviewedById.size !== run.shots.length)
    throw new Error('Review must cover every rendered shot exactly once');
  for (const shot of run.shots) {
    if (shot.status !== 'pass' || !shot.contactSheet)
      throw new Error(`Shot '${shot.id}' is not objectively eligible for qualitative review`);
    const reviewed = reviewedById.get(shot.id);
    if (!reviewed) throw new Error(`Review omits shot '${shot.id}'`);
    if (reviewed.inputSha256 !== shot.inputSha256)
      throw new Error(`Review for '${shot.id}' targets stale scene inputs`);
    if (resolve(reviewed.contactSheet) !== resolve(shot.contactSheet))
      throw new Error(`Review for '${shot.id}' must inspect the current contact sheet`);
  }
  const failedShots = review.shots.filter((shot) => shot.verdict === 'fail').map((shot) => shot.id);
  const passed = failedShots.length === 0 && review.final.verdict === 'pass';
  const storedReview = join(
    productionDirectory(sourceFile),
    `review-${String(run.attempts.length).padStart(3, '0')}.json`,
  );
  await writeFile(storedReview, `${JSON.stringify(review, null, 2)}\n`, 'utf8');
  const attempts = [...run.attempts];
  const latest = attempts.at(-1)!;
  latest.stages = latest.stages.map((stage) => {
    if (stage.id === 'qualitative-review')
      return {
        ...stage,
        status: passed ? ('pass' as const) : ('fail' as const),
        artifacts: [storedReview],
        detail: passed
          ? `Every shot and the complete delivery were accepted by ${review.reviewer}.`
          : `Qualitative review requires repair${failedShots.length ? ` in: ${failedShots.join(', ')}` : ' of the final assembly'}.`,
      };
    if (stage.id === 'publish-ready')
      return {
        ...stage,
        status: passed ? ('pass' as const) : ('skipped' as const),
        detail: passed
          ? 'Objective and qualitative evidence are complete; declared candidates may enter explicit approval.'
          : 'Publication remains forbidden until repairs pass a new review.',
      };
    return stage;
  });
  const updated = cinematicProductionRunSchema.parse({
    ...run,
    status: passed ? 'completed' : 'needs-repair',
    attempts,
    acceptedReview: storedReview,
    updatedAt: new Date().toISOString(),
  });
  await writeFile(stateFile, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return {
    run: updated,
    review: storedReview,
    failedShots,
    finalFailed: review.final.verdict === 'fail',
  };
}
