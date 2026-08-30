import { describe, expect, it } from 'vitest';
import {
  campaignStateSchema,
  emptyCampaignState,
  nextRenderRevision,
  recordGeneratedAsset,
} from '../src/domain/state.js';

describe('campaign state', () => {
  it('serializes provenance and render lineage', () => {
    let state = recordGeneratedAsset(emptyCampaignState(), {
      shotId: 'shot-03',
      path: 'generated/images/shot-03.png',
      provider: 'fake',
      prompt: 'castle',
      references: ['references/cover.png'],
      attempt: 2,
      requestHash: 'abc',
      createdAt: '2026-01-01T00:00:00.000Z',
      metadata: {},
    });
    const first = nextRenderRevision(state, {
      kind: 'draft',
      path: 'renders/render-001.mp4',
      changes: ['initial'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    state = { ...state, renders: [first] };
    const second = nextRenderRevision(state, {
      kind: 'draft',
      path: 'renders/render-002.mp4',
      changes: ['regenerated shot-03'],
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    expect(second.parent).toBe('render-001');
    expect(
      campaignStateSchema.parse({ ...state, renders: [first, second] }).generatedAssets[0]?.attempt,
    ).toBe(2);
  });
});
