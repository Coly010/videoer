import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const exec = promisify(execFile);

describe('CLI JSON contract', () => {
  it('returns a stable envelope', async () => {
    const { stdout } = await exec(process.execPath, [
      '--import',
      'tsx',
      resolve('src/cli.ts'),
      '--json',
      'validate',
      resolve('campaigns/examples/saas-promo/campaign.yaml'),
    ]);
    expect(JSON.parse(stdout)).toMatchObject({
      version: 1,
      ok: true,
      command: 'campaign.validate',
      data: { campaignId: 'tutarium-focus' },
    });
  });
});
