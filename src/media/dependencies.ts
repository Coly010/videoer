import { spawn } from 'node:child_process';
export interface DependencyStatus {
  name: string;
  available: boolean;
  detail: string;
}
async function check(name: string): Promise<DependencyStatus> {
  return new Promise((resolve) => {
    const p = spawn(name, ['-version']);
    let out = '';
    p.stdout.on('data', (d) => (out += String(d)));
    p.on('error', () =>
      resolve({ name, available: false, detail: `${name} was not found on PATH` }),
    );
    p.on('close', (c) =>
      resolve({
        name,
        available: c === 0,
        detail: c === 0 ? (out.split('\n')[0] ?? 'available') : `exited ${c}`,
      }),
    );
  });
}
export async function checkMediaDependencies() {
  return Promise.all([check('ffmpeg'), check('ffprobe')]);
}
