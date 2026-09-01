import { resolve } from 'node:path';
import {
  scanAssetLibrary,
  validateLibraryAsset,
  writeHashedAssetMetadata,
} from '../src/assets/library.js';

const libraryRoot = resolve(process.argv[2] ?? 'library');
const assets = await scanAssetLibrary(libraryRoot);
let migrated = 0;
for (const asset of assets) {
  if (asset.status !== 'verified' && asset.status !== 'deprecated') continue;
  await writeHashedAssetMetadata(asset.metadataPath, asset);
  migrated++;
}
const audited = await scanAssetLibrary(libraryRoot);
const failures: string[] = [];
for (const asset of audited) {
  const result = await validateLibraryAsset(asset);
  if (!result.valid) failures.push(`${asset.id}@${asset.version}: ${result.issues.join('; ')}`);
}
if (failures.length) throw new Error(`Library hash migration failed:\n${failures.join('\n')}`);
process.stdout.write(`Content-addressed and audited ${migrated} immutable asset version(s).\n`);
