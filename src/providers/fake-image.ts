import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { GeneratedAsset, ImageGenerationRequest, ImageProvider } from './contracts.js';
export class FakeImageProvider implements ImageProvider {
  readonly id = 'fake';
  readonly capabilities = ['image'] as const;
  async generate(r: ImageGenerationRequest): Promise<GeneratedAsset> {
    await mkdir(dirname(r.outputPath), { recursive: true });
    await writeFile(r.outputPath, `fake image: ${r.prompt}\n`);
    return {
      ...(r.shotId ? { shotId: r.shotId } : {}),
      path: r.outputPath,
      provider: this.id,
      prompt: r.prompt,
      references: r.references ?? [],
      attempt: r.attempt ?? 1,
      requestHash: createHash('sha256').update(JSON.stringify(r)).digest('hex'),
      createdAt: new Date(0).toISOString(),
      metadata: { fake: true, width: r.width, height: r.height },
    };
  }
}
