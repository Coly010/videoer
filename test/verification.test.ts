import { describe, expect, it } from 'vitest';
import { aggregateChecks } from '../src/verification/model.js';

describe('verification results', () => {
  it('aggregates the worst status', () => {
    expect(
      aggregateChecks([
        { id: 'a', status: 'pass', message: 'ok' },
        { id: 'b', status: 'warning', message: 'review' },
      ]).status,
    ).toBe('warning');
    expect(
      aggregateChecks([
        { id: 'a', status: 'warning', message: 'review' },
        { id: 'b', status: 'fail', message: 'broken' },
      ]).status,
    ).toBe('fail');
  });
});
