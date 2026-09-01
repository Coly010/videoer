import type { LightingRig } from './model.js';

export function blackbodyRgb(kelvin: number): [number, number, number] {
  const temperature = Math.max(1000, Math.min(12_000, kelvin)) / 100;
  const red = temperature <= 66 ? 255 : 329.698727446 * (temperature - 60) ** -0.1332047592;
  const green =
    temperature <= 66
      ? 99.4708025861 * Math.log(temperature) - 161.1195681661
      : 288.1221695283 * (temperature - 60) ** -0.0755148492;
  const blue =
    temperature <= 19
      ? 0
      : temperature >= 66
        ? 255
        : 138.5177312231 * Math.log(temperature - 10) - 305.044792731;
  return [red, green, blue].map((value) => Math.max(0, Math.min(255, value)) / 255) as [
    number,
    number,
    number,
  ];
}

function close(first: number, second: number, tolerance = 1e-6) {
  return Number.isFinite(first) && Number.isFinite(second) && Math.abs(first - second) <= tolerance;
}

export function temporalLightingEvidencePass(report: Record<string, unknown>, rig: LightingRig) {
  if (report.schemaVersion !== 1 || !Number.isInteger(report.frameCount)) return false;
  const frameCount = report.frameCount as number;
  if (frameCount < 12 || !Array.isArray(report.lights)) return false;
  const evidenceLights = report.lights;
  const modulated = rig.lights.filter((light) => light.temporalModulation);
  if (modulated.length === 0) return evidenceLights.length === 0;
  if (evidenceLights.length !== modulated.length) return false;
  const individuallyValid = modulated.every((light) => {
    const modulation = light.temporalModulation!;
    const evidence = evidenceLights.find(
      (value) =>
        typeof value === 'object' &&
        value !== null &&
        'lightId' in value &&
        value.lightId === light.id,
    );
    if (!evidence || typeof evidence !== 'object') return false;
    const row = evidence as Record<string, unknown>;
    if (
      row.kind !== modulation.kind ||
      row.seed !== modulation.seed ||
      row.frequencyHz !== modulation.frequencyHz ||
      row.temporalSignalId !== light.temporalSignalId ||
      (row.visibleSourceRole ?? undefined) !== light.visibleSourceRole ||
      row.baseEnergy !== light.energy ||
      !Array.isArray(row.baseColor) ||
      row.baseColor.length !== 3 ||
      !Array.isArray(row.samples) ||
      row.samples.length !== frameCount
    )
      return false;
    let minimum = Infinity;
    let maximum = -Infinity;
    let sourceRatio: number | undefined;
    for (const [index, value] of row.samples.entries()) {
      if (typeof value !== 'object' || value === null) return false;
      const sample = value as Record<string, unknown>;
      const multiplier = sample.intensityMultiplier;
      const power = sample.powerWatts;
      const kelvin = sample.colorTemperatureKelvin;
      const color = sample.lightColor;
      const sourceEmissionStrength = sample.sourceEmissionStrength;
      if (
        sample.frame !== index + 1 ||
        typeof multiplier !== 'number' ||
        typeof power !== 'number' ||
        !Array.isArray(color) ||
        color.length !== 3 ||
        color.some((channel) => typeof channel !== 'number') ||
        multiplier < modulation.intensityMinimumMultiplier - 1e-8 ||
        multiplier > modulation.intensityMaximumMultiplier + 1e-8 ||
        !close(power, light.energy * multiplier, 1e-5)
      )
        return false;
      if (light.visibleSourceRole) {
        if (typeof sourceEmissionStrength !== 'number') return false;
        const ratio = sourceEmissionStrength / multiplier;
        if (sourceRatio === undefined) sourceRatio = ratio;
        else if (!close(ratio, sourceRatio, 1e-5)) return false;
      } else if (sourceEmissionStrength !== null) return false;
      if (modulation.kind === 'seeded-flicker') {
        if (
          typeof kelvin !== 'number' ||
          kelvin < modulation.colorTemperatureMinimumKelvin - 1e-8 ||
          kelvin > modulation.colorTemperatureMaximumKelvin + 1e-8
        )
          return false;
        const expected = blackbodyRgb(kelvin);
        if (
          color.some((channel, channelIndex) => !close(channel as number, expected[channelIndex]!))
        )
          return false;
      } else {
        if (kelvin !== null) return false;
        if (
          color.some(
            (channel, channelIndex) => !close(channel as number, light.color[channelIndex]!),
          )
        )
          return false;
      }
      minimum = Math.min(minimum, multiplier);
      maximum = Math.max(maximum, multiplier);
    }
    return maximum - minimum >= 0.01;
  });
  if (!individuallyValid) return false;
  const signalSamples = new Map<string, number[]>();
  for (const light of modulated) {
    const evidence = evidenceLights.find(
      (value) =>
        typeof value === 'object' &&
        value !== null &&
        'lightId' in value &&
        value.lightId === light.id,
    ) as Record<string, unknown>;
    const multipliers = (evidence.samples as Record<string, unknown>[]).map(
      (sample) => sample.intensityMultiplier as number,
    );
    const signalId = light.temporalSignalId!;
    const existing = signalSamples.get(signalId);
    if (
      existing &&
      existing.some((multiplier, index) => !close(multiplier, multipliers[index]!, 1e-8))
    )
      return false;
    signalSamples.set(signalId, multipliers);
  }
  return true;
}
