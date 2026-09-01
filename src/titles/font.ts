import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export async function resolveCormorantGaramondFont() {
  const candidates = [
    join(homedir(), 'Library/Fonts/CormorantGaramond[wght].ttf'),
    '/usr/share/fonts/truetype/cormorant-garamond/CormorantGaramond-SemiBold.ttf',
    'C:\\Windows\\Fonts\\CormorantGaramond-SemiBold.ttf',
  ];
  for (const candidate of candidates)
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  throw new Error(
    'Cormorant Garamond is required and was not found; see README.md production typography setup',
  );
}
