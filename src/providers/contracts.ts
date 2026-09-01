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
export interface MediaGenerationRequest {
  prompt: string;
  outputPath: string;
  shotId?: string;
  references?: string[];
  attempt?: number;
}
export interface VoiceRequest extends MediaGenerationRequest {
  text: string;
  voice?: string;
}
export interface MusicRequest extends MediaGenerationRequest {
  durationSeconds: number;
  mood: string[];
}
export interface VideoProvider {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  generate(input: MediaGenerationRequest & { durationSeconds: number }): Promise<GeneratedAsset>;
}
export interface VoiceProvider {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  synthesize(input: VoiceRequest): Promise<GeneratedAsset>;
}
export interface MusicProvider {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  getTrack(input: MusicRequest): Promise<GeneratedAsset>;
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
  private videos = new Map<string, VideoProvider>();
  private voices = new Map<string, VoiceProvider>();
  private music = new Map<string, MusicProvider>();
  registerImage(p: ImageProvider) {
    this.images.set(p.id, p);
    return this;
  }
  image(id: string) {
    const p = this.images.get(id);
    if (!p) throw new ProviderError(id, `Image provider '${id}' is not configured`);
    return p;
  }
  registerVideo(provider: VideoProvider) {
    this.videos.set(provider.id, provider);
    return this;
  }
  registerVoice(provider: VoiceProvider) {
    this.voices.set(provider.id, provider);
    return this;
  }
  registerMusic(provider: MusicProvider) {
    this.music.set(provider.id, provider);
    return this;
  }
  video(id: string) {
    const provider = this.videos.get(id);
    if (!provider) throw new ProviderError(id, `Video provider '${id}' is not configured`);
    return provider;
  }
  voice(id: string) {
    const provider = this.voices.get(id);
    if (!provider) throw new ProviderError(id, `Voice provider '${id}' is not configured`);
    return provider;
  }
  musicProvider(id: string) {
    const provider = this.music.get(id);
    if (!provider) throw new ProviderError(id, `Music provider '${id}' is not configured`);
    return provider;
  }
  has(capability: Capability, id: string) {
    return { image: this.images, video: this.videos, voice: this.voices, music: this.music }[
      capability
    ].has(id);
  }
}
