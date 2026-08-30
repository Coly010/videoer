import type { Storyboard } from '../domain/schemas.js';
import { resolveTemplate } from '../templates/index.js';
export interface RenderPlan {
  storyboard: Storyboard;
  template: ReturnType<typeof resolveTemplate>;
  requiresGeneration: false;
}
export function createRenderPlan(storyboard: Storyboard): RenderPlan {
  return { storyboard, template: resolveTemplate(storyboard.style), requiresGeneration: false };
}
export async function render(plan: RenderPlan): Promise<never> {
  void plan;
  throw new Error(
    'Renderer adapter is not implemented yet; install Remotion in the next milestone. No generative provider is required by this boundary.',
  );
}
