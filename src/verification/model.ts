export type VerificationStatus = 'pass' | 'warning' | 'fail';

export interface VerificationCheck {
  id: string;
  status: VerificationStatus;
  message: string;
  expected?: unknown;
  actual?: unknown;
  path?: string;
  shotId?: string;
  remediation?: string;
}

export interface VerificationResult {
  status: VerificationStatus;
  checks: VerificationCheck[];
}

const rank: Record<VerificationStatus, number> = { pass: 0, warning: 1, fail: 2 };

export function aggregateChecks(checks: VerificationCheck[]): VerificationResult {
  const status = checks.reduce<VerificationStatus>(
    (worst, check) => (rank[check.status] > rank[worst] ? check.status : worst),
    'pass',
  );
  return { status, checks };
}

export interface Evaluator<T> {
  evaluate(input: T): Promise<VerificationCheck[]> | VerificationCheck[];
}

export async function evaluateAll<T>(input: T, evaluators: Evaluator<T>[]) {
  return aggregateChecks((await Promise.all(evaluators.map((e) => e.evaluate(input)))).flat());
}
