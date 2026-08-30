import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { GeneratedAsset, ImageGenerationRequest, ImageProvider } from './contracts.js';
import { ProviderError } from './contracts.js';
export class CodexImageProvider implements ImageProvider {
  readonly id = 'codex-experimental';
  readonly capabilities = ['image'] as const;
  constructor(private retries = 1) {}
  async generate(r: ImageGenerationRequest): Promise<GeneratedAsset> {
    const referenceInstruction = r.references?.length
      ? `Use these local files as strict visual references, inspecting them before generation: ${r.references.join(', ')}.`
      : '';
    const prompt = `Generate one ${r.width}x${r.height} image: ${r.prompt}. ${referenceInstruction} Save it exactly to ${r.outputPath}.`;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const code = await new Promise<number>((resolve, reject) => {
        const p = spawn('codex', ['exec', '--ephemeral', '--skip-git-repo-check', prompt], {
          stdio: 'inherit',
        });
        p.on('error', reject);
        p.on('close', (c) => resolve(c ?? 1));
      });
      if (code === 0) {
        try {
          await access(r.outputPath);
          return {
            ...(r.shotId ? { shotId: r.shotId } : {}),
            path: r.outputPath,
            provider: this.id,
            prompt: r.prompt,
            references: r.references ?? [],
            attempt: r.attempt ?? attempt + 1,
            requestHash: 'experimental',
            createdAt: new Date().toISOString(),
            metadata: { attempt: attempt + 1 },
          };
        } catch {
          /* output verification is authoritative */
        }
      }
    }
    throw new ProviderError(
      this.id,
      `Codex completed without a valid file at ${r.outputPath}`,
      true,
    );
  }
}
