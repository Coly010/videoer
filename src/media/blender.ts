import { access } from 'node:fs/promises';
import { platform } from 'node:os';

const macOSApplicationBinary = '/Applications/Blender.app/Contents/MacOS/Blender';

export async function resolveBlenderExecutable() {
  if (process.env.VIDEOER_BLENDER) return process.env.VIDEOER_BLENDER;
  if (platform() === 'darwin') {
    try {
      await access(macOSApplicationBinary);
      return macOSApplicationBinary;
    } catch {
      // PATH resolution below produces the useful not-installed error.
    }
  }
  return 'blender';
}

export function blenderProbeDetail(result: { code: number; output: string }) {
  const firstVersion = result.output.match(/Blender \d+\.\d+(?:\.\d+)?(?: LTS)?/)?.[0];
  if (result.code === 0 && result.output.includes('VIDEOER_BLENDER_READY'))
    return { available: true, detail: firstVersion ?? 'Blender headless startup passed' };
  if (
    result.code === 139 ||
    result.output.includes('supports_barycentric_whitelist') ||
    result.output.includes('MTLCreateSystemDefaultDevice')
  )
    return {
      available: false,
      detail:
        'Blender could not access a Metal device. In Codex, approve host/GPU execution and rerun doctor; see docs/install-blender.md. Reinstalling Blender or bpy does not repair a sandbox denial.',
    };
  return {
    available: false,
    detail: result.output.trim() || 'Blender headless startup failed; see docs/install-blender.md',
  };
}
