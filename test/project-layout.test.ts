import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { campaignPaths } from '../src/assets/layout.js';

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

describe('real project layout', () => {
  it('delivers source campaigns into their sibling output directory', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-project-'));
    const source = join(directory, 'source');
    await mkdir(source);
    await writeFile(join(directory, 'project.yaml'), 'schemaVersion: 1\nname: Test\n');

    expect(campaignPaths(source).renders).toBe(join(directory, 'output'));
    expect(campaignPaths(source).assets).toBe(join(source, 'assets'));
    expect(campaignPaths(source).reports).toBe(join(source, 'reports'));
  });

  it('preserves the legacy campaign render layout without a project marker', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-campaign-'));
    expect(campaignPaths(directory).renders).toBe(join(directory, 'renders'));
  });
});
