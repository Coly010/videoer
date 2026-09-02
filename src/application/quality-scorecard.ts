import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { qualityScorecardSchema, type QualityScorecard } from '../quality/model.js';

export async function loadQualityScorecard(path: string): Promise<QualityScorecard> {
  const absolute = resolve(path);
  return qualityScorecardSchema.parse(YAML.parse(await readFile(absolute, 'utf8')));
}

/** Fails closed when a scorecard cites evidence that is no longer available. */
export async function validateQualityScorecard(path: string) {
  const absolute = resolve(path);
  const scorecard = await loadQualityScorecard(absolute);
  const evidence = [
    ...scorecard.domains.flatMap((domain) => [
      ...domain.canonicalProbes.flatMap((probe) => probe.evidence),
      ...domain.integratedEvidence,
    ]),
    ...scorecard.iterations.flatMap((iteration) => iteration.evidence),
  ];
  const missing: string[] = [];
  await Promise.all(
    evidence.map(async (entry) => {
      try {
        await access(resolve(dirname(absolute), entry));
      } catch {
        missing.push(entry);
      }
    }),
  );
  if (missing.length) throw new Error(`Quality scorecard evidence is missing: ${missing.sort().join(', ')}`);
  return {
    id: scorecard.id,
    baselineId: scorecard.baselineId,
    domains: scorecard.domains.length,
    accepted: scorecard.domains.filter((domain) => domain.status === 'accepted').length,
    blocked: scorecard.domains.filter((domain) => domain.status === 'blocked').length,
    evidence: evidence.length,
  };
}
