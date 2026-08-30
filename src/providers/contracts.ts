export type Capability = 'image' | 'video' | 'voice' | 'music';
export interface GeneratedAsset {
  shotId?: string;
  path: string;
  provider: string;
  prompt?: string;
  references: string[];
  attempt: number;
  requestHash: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}
export interface ImageGenerationRequest {
  prompt: string;
  outputPath: string;
  width: number;
  height: number;
  seed?: number;
  shotId?: string;
  references?: string[];
  attempt?: number;
}
export interface ImageProvider {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  generate(input: ImageGenerationRequest): Promise<GeneratedAsset>;
}
export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
export class ProviderRegistry {
  private images = new Map<string, ImageProvider>();
  registerImage(p: ImageProvider) {
    this.images.set(p.id, p);
    return this;
  }
  image(id: string) {
    const p = this.images.get(id);
    if (!p) throw new ProviderError(id, `Image provider '${id}' is not configured`);
    return p;
  }
}
