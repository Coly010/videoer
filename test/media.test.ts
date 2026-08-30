import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contactSheetArgs, inspectImage } from '../src/media/inspection.js';
import { verifyImage } from '../src/verification/image.js';

let dir = '';
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});
describe('media inspection', () => {
  it('reads PNG dimensions without a paid or network service', async () => {
    dir = await mkdtemp(join(tmpdir(), 'videoer-media-'));
    const path = join(dir, 'fixture.png');
    const bytes = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    bytes.writeUInt32BE(320, 16);
    bytes.writeUInt32BE(180, 20);
    await writeFile(path, bytes);
    expect(await inspectImage(path)).toMatchObject({ format: 'png', width: 320, height: 180 });
    expect(await verifyImage(path, { width: 320, height: 180, formats: ['png'] })).toMatchObject({
      status: 'pass',
    });
  });
  it('builds reusable contact-sheet arguments', () => {
    expect(contactSheetArgs(['a.png', 'b.png'], 'sheet.jpg', 2)).toContain(
      'xstack=inputs=2:layout=0_0|w0_0:fill=black',
    );
  });
});
