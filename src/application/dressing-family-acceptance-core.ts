import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  assetMetadataSchema,
  loadAssetMetadata,
  writeHashedAssetMetadata,
  type AssetMetadata,
  type LibraryAsset,
} from '../assets/library.js';
import { dressingFamilySchema, type DressingFamily } from '../environments/dressing-family.js';
import { dressingFamilyCandidateReviewSchema } from '../environments/dressing-review.js';
import { loadGeometry } from '../geometry/io.js';
import type { GeometryAsset } from '../geometry/model.js';
import { validateGeometry } from '../geometry/model.js';

export interface DressingMemberContract {
  directoryName: string;
  attachments: string[];
  materialGroups?: string[];
  metadata?: Record<string, unknown>;
}

export interface LoadedDressingMember {
  directory: string;
  asset: LibraryAsset;
  geometry: GeometryAsset;
  contract: DressingMemberContract;
}

export async function readJsonRecord(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

function metadataValue(asset: LibraryAsset): AssetMetadata {
  return assetMetadataSchema.parse(asset);
}

export async function loadDressingAcceptanceCandidate(
  outputDirectory: string,
  memberContracts: DressingMemberContract[],
) {
  const output = resolve(outputDirectory);
  const familyDirectory = join(output, 'family');
  const [familyAsset, family, review, members] = await Promise.all([
    loadAssetMetadata(join(familyDirectory, 'asset.yaml')),
    readJsonRecord(join(familyDirectory, 'family.json')).then((value) =>
      dressingFamilySchema.parse(value),
    ),
    readJsonRecord(join(familyDirectory, 'verification', 'family-candidate-review.json')).then(
      (value) => dressingFamilyCandidateReviewSchema.parse(value),
    ),
    Promise.all(
      memberContracts.map(async (contract) => {
        const directory = join(output, 'props', contract.directoryName);
        const [asset, geometry] = await Promise.all([
          loadAssetMetadata(join(directory, 'asset.yaml')),
          loadGeometry(join(directory, 'geometry.json')),
        ]);
        return { directory, asset, geometry, contract } satisfies LoadedDressingMember;
      }),
    ),
  ]);
  if (
    familyAsset.status !== 'validated' ||
    members.some(({ asset }) => asset.status !== 'validated')
  )
    throw new Error('Dressing acceptance requires validated family and member candidates');
  if (review.decision !== 'accepted') throw new Error(`Dressing review rejected '${family.id}'`);
  if (review.familyAssetId !== family.id || review.familyAssetId !== familyAsset.id)
    throw new Error('Dressing review family identity does not match the candidate');
  const expectedMembers = family.variants.map((variant) => variant.geometryAssetId).sort();
  const loadedMembers = members.map(({ asset }) => asset.id).sort();
  if (JSON.stringify(loadedMembers) !== JSON.stringify(expectedMembers))
    throw new Error('Loaded dressing member identities do not match the family');
  if (JSON.stringify([...review.memberAssetIds].sort()) !== JSON.stringify(expectedMembers))
    throw new Error('Dressing review member identities do not match the family');
  for (const { geometry, asset, contract } of members) {
    if (geometry.id !== asset.id || !validateGeometry(geometry).valid)
      throw new Error(`Dressing member '${asset.id}' has invalid or mismatched geometry`);
    for (const attachment of contract.attachments)
      if (!geometry.attachments[attachment])
        throw new Error(`Dressing member '${asset.id}' lacks '${attachment}'`);
    const physicalMaterials = new Set(geometry.materialGroups.map((group) => group.materialId));
    for (const material of contract.materialGroups ?? [])
      if (!physicalMaterials.has(material))
        throw new Error(
          `Dressing member '${asset.id}' lacks physical material group '${material}'`,
        );
    for (const [key, expected] of Object.entries(contract.metadata ?? {}))
      if (geometry.metadata[key] !== expected)
        throw new Error(
          `Dressing member '${asset.id}' metadata '${key}' is not ${JSON.stringify(expected)}`,
        );
  }
  for (const path of review.evidence) await readFile(join(familyDirectory, path));
  return { output, familyDirectory, familyAsset, family, review, members };
}

export interface DressingTransferPublication {
  kind: string;
  summary: Record<string, unknown>;
  familyCheck: string;
  memberCheck: string;
}

export async function promoteAcceptedDressingCandidate(options: {
  candidate: Awaited<ReturnType<typeof loadDressingAcceptanceCandidate>>;
  transfers: DressingTransferPublication[];
  familyChecks: string[];
  memberChecks: string[];
  familyCapabilities?: string[];
}) {
  const { candidate, transfers } = options;
  const { familyDirectory, familyAsset, family, review, members } = candidate;
  const acceptedAt = review.reviewedAt;
  const reviewArtifact = {
    role: 'qualitative-review',
    path: 'verification/family-candidate-review.json',
    mediaType: 'application/json',
  } satisfies AssetMetadata['artifacts'][number];
  const familyMetadata = await writeHashedAssetMetadata(join(familyDirectory, 'asset.yaml'), {
    ...metadataValue(familyAsset),
    status: 'verified',
    artifacts: [
      ...metadataValue(familyAsset).artifacts.map(({ role, path, mediaType }) => ({
        role,
        path,
        mediaType,
      })),
      reviewArtifact,
    ],
    capabilities: [
      ...new Set([...familyAsset.capabilities, ...(options.familyCapabilities ?? [])]),
    ],
    verification: {
      checks: [
        ...familyAsset.verification.checks.filter(
          (check) => !check.endsWith('-generated-not-accepted'),
        ),
        ...transfers.map((transfer) => transfer.familyCheck),
        ...options.familyChecks,
      ],
      artifacts: [...familyAsset.verification.artifacts, reviewArtifact.path],
      verifiedAt: acceptedAt,
    },
  });

  const propResults = [];
  for (const { asset, directory } of members) {
    const verification = join(directory, 'verification');
    await mkdir(verification, { recursive: true });
    const artifacts: AssetMetadata['artifacts'] = [];
    for (const transfer of transfers) {
      const filename = `${transfer.kind}-family-contact-sheet.png`;
      await copyFile(
        join(familyDirectory, 'verification', transfer.kind, 'contact-sheet.png'),
        join(verification, filename),
      );
      artifacts.push({
        role: `${transfer.kind}-family-contact-sheet`,
        path: `verification/${filename}`,
        mediaType: 'image/png',
      });
    }
    const summaryRelativePath = 'verification/family-transfer-summary.json';
    await writeFile(
      join(directory, summaryRelativePath),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          familyId: family.id,
          memberAssetId: asset.id,
          acceptedAt,
          transferSummaries: transfers.map(({ summary }) => summary),
          intendedShotDistance: review.intendedShotDistance,
          limitations: review.limitations,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    artifacts.push({
      role: 'family-transfer-summary',
      path: summaryRelativePath,
      mediaType: 'application/json',
    });
    propResults.push(
      await writeHashedAssetMetadata(join(directory, 'asset.yaml'), {
        ...metadataValue(asset),
        status: 'verified',
        artifacts: [
          ...metadataValue(asset).artifacts.map(({ role, path, mediaType }) => ({
            role,
            path,
            mediaType,
          })),
          ...artifacts,
        ],
        verification: {
          checks: [
            ...asset.verification.checks.filter(
              (check) => !check.endsWith('-generated-not-accepted'),
            ),
            ...transfers.map((transfer) => transfer.memberCheck),
            ...options.memberChecks,
          ],
          artifacts: artifacts.map((artifact) => artifact.path),
          verifiedAt: acceptedAt,
        },
      }),
    );
  }
  return { familyMetadata, propResults };
}

export function assertDressingFamilyRequiredVariants(family: DressingFamily, ids: string[]) {
  const actual = new Set(family.variants.map((variant) => variant.id));
  for (const id of ids)
    if (!actual.has(id))
      throw new Error(`Dressing family '${family.id}' lacks required variant '${id}'`);
}
