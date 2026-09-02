import { mkdtemp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  productionQualityReelReviewSchema,
  productionQualityReviewCriteria,
  validateProductionQualityReelReview,
} from '../src/quality/production-quality-reel-review.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('production-quality reel review evidence', () => {
  it('requires all independent criteria and detects changed reviewed pixels', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'videoer-reel-review-'));
    const names = [
      'campaign.yaml',
      'scorecard.yaml',
      ...['establish', 'detail', 'crossing', 'resolve'].flatMap((shot) => [
        `${shot}.png`,
        `${shot}.mp4`,
        `${shot}.json`,
      ]),
      'delivery.png',
      'delivery.mp4',
      'edit-report.json',
    ];
    await Promise.all(names.map((name) => writeFile(join(directory, name), name)));
    const evidence = (path: string) => ({ path, sha256: hash(path) });
    const review = {
      schemaVersion: 1,
      campaignId: 'campaign.production-quality-reel',
      decision: 'accepted',
      reviewer: 'independent reviewer',
      reviewedAt: '2026-09-02T12:00:00.000Z',
      campaign: evidence('campaign.yaml'),
      scorecard: { ...evidence('scorecard.yaml'), baselineId: 'baseline' },
      shots: ['establish', 'detail', 'crossing', 'resolve'].map((name, index) => ({
        id: [
          'wet-street-establish',
          'practical-material-detail',
          'character-crossing',
          'threshold-resolve',
        ][index],
        contactSheet: evidence(`${name}.png`),
        motionClip: evidence(`${name}.mp4`),
        renderGateReport: evidence(`${name}.json`),
      })),
      delivery: {
        contactSheet: evidence('delivery.png'),
        video: evidence('delivery.mp4'),
        editReport: evidence('edit-report.json'),
      },
      criteria: productionQualityReviewCriteria.map((id) => ({
        id,
        status: 'pass',
        observation: `${id} inspected`,
        evidence: ['delivery.mp4'],
      })),
      baselineComparison: {
        visibleChange: 'material-improvement',
        observation: 'Integrated improvement is visible.',
      },
      strengths: ['Cross-system evidence is comparable.'],
      limitations: ['Not a substitute for domain acceptance.'],
    };
    const parsed = productionQualityReelReviewSchema.parse(review);
    await writeFile(join(directory, 'review.yaml'), YAML.stringify(parsed));
    await expect(
      validateProductionQualityReelReview(join(directory, 'review.yaml')),
    ).resolves.toMatchObject({ evidence: 17 });
    await writeFile(join(directory, 'delivery.mp4'), 'changed');
    await expect(
      validateProductionQualityReelReview(join(directory, 'review.yaml')),
    ).rejects.toThrow(/hash mismatch/);
  });

  it('does not accept a review without a material visible delta', () => {
    const candidate = {
      schemaVersion: 1,
      campaignId: 'campaign.production-quality-reel',
      decision: 'accepted',
      reviewer: 'r',
      reviewedAt: '2026-09-02T12:00:00.000Z',
      campaign: { path: 'campaign.yaml', sha256: 'a'.repeat(64) },
      scorecard: { path: 'scorecard.yaml', sha256: 'a'.repeat(64), baselineId: 'b' },
      shots: [
        'wet-street-establish',
        'practical-material-detail',
        'character-crossing',
        'threshold-resolve',
      ].map((id) => ({
        id,
        contactSheet: { path: `${id}.png`, sha256: 'a'.repeat(64) },
        motionClip: { path: `${id}.mp4`, sha256: 'a'.repeat(64) },
        renderGateReport: { path: `${id}.json`, sha256: 'a'.repeat(64) },
      })),
      delivery: {
        contactSheet: { path: 'delivery.png', sha256: 'a'.repeat(64) },
        video: { path: 'delivery.mp4', sha256: 'a'.repeat(64) },
        editReport: { path: 'edit.json', sha256: 'a'.repeat(64) },
      },
      criteria: productionQualityReviewCriteria.map((id) => ({
        id,
        status: 'pass',
        observation: 'seen',
        evidence: ['delivery.mp4'],
      })),
      baselineComparison: { visibleChange: 'no-material-change', observation: 'No visible delta.' },
      strengths: ['none'],
      limitations: ['none'],
    };
    expect(() => productionQualityReelReviewSchema.parse(candidate)).toThrow(
      /material visible improvement/,
    );
  });

  it('allows a review record to bind a baseline outside the campaign directory', () => {
    const record = {
      path: '../../docs/reviews/production-quality-scorecard-2026-09-02.yaml',
      sha256: 'a'.repeat(64),
      baselineId: 'baseline',
    };
    expect(productionQualityReelReviewSchema.shape.scorecard.parse(record)).toEqual(record);
  });
});
