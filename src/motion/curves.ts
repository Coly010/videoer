export interface PhaseKeyframe {
  phase: number;
  value: number;
  interpolation?: 'hold' | 'linear' | 'smooth';
}

const normalizePhase = (phase: number) => ((phase % 1) + 1) % 1;
// C2-continuous interpolation: position, velocity, and acceleration all join
// cleanly at phase landmarks. Ordinary smoothstep is only C1 and creates a
// finite acceleration step, which becomes an artificial jerk impulse.
const smootherstep = (value: number) => value * value * value * (value * (value * 6 - 15) + 10);

export function samplePhaseCurve(keyframes: PhaseKeyframe[], phase: number) {
  if (keyframes.length < 2) throw new Error('A phase curve requires at least two keyframes');
  const sorted = [...keyframes].sort((a, b) => a.phase - b.phase);
  const normalized = normalizePhase(phase);
  let previous = sorted.at(-1)!;
  let next = sorted[0]!;
  let adjusted = normalized;
  for (let index = 0; index < sorted.length - 1; index++) {
    if (normalized >= sorted[index]!.phase && normalized <= sorted[index + 1]!.phase) {
      previous = sorted[index]!;
      next = sorted[index + 1]!;
      break;
    }
  }
  const start = previous.phase;
  let end = next.phase;
  if (end <= start) end += 1;
  if (adjusted < start) adjusted += 1;
  const amount = (adjusted - start) / (end - start);
  const interpolation = previous.interpolation ?? 'smooth';
  const weight =
    interpolation === 'hold' ? 0 : interpolation === 'linear' ? amount : smootherstep(amount);
  return previous.value + (next.value - previous.value) * weight;
}

export function offsetPhase(phase: number, offset: number) {
  return normalizePhase(phase + offset);
}

export function phaseProgress(phase: number, start: number, end: number) {
  const normalized = normalizePhase(phase);
  if (start <= end) return Math.max(0, Math.min(1, (normalized - start) / (end - start)));
  const adjusted = normalized < start ? normalized + 1 : normalized;
  return Math.max(0, Math.min(1, (adjusted - start) / (end + 1 - start)));
}
