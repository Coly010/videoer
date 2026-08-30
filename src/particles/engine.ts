export type NumberRange = number | { min: number; max: number };
export interface CurvePoint {
  at: number;
  value: number;
}
export type EvolutionCurve = CurvePoint[];
export type SpawnRegion =
  | { type: 'point'; x: number; y: number }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'box' | 'full-frame'; x?: number; y?: number; width?: number; height?: number }
  | { type: 'circle'; x: number; y: number; radius: number }
  | { type: 'edge'; edge: 'top' | 'right' | 'bottom' | 'left'; inset?: number };

export interface ParticleEmitter {
  spawnRate: number;
  maxParticles: number;
  burst?: number;
  start?: number;
  end?: number;
  region: SpawnRegion;
  particle: {
    lifetime: NumberRange;
    size: NumberRange;
    opacity: NumberRange;
    rotation?: NumberRange;
    color: string;
    blur?: number;
    glow?: number;
    shape?: 'circle' | 'streak' | 'square';
  };
  physics: {
    velocityX?: NumberRange;
    velocityY?: NumberRange;
    accelerationX?: number;
    accelerationY?: number;
    gravity?: number;
    drag?: number;
    turbulence?: number;
    angularVelocity?: NumberRange;
  };
  evolution: {
    opacity?: EvolutionCurve;
    scale?: EvolutionCurve;
    rotation?: EvolutionCurve;
  };
}

export interface ParticleState {
  id: number;
  x: number;
  y: number;
  size: number;
  opacity: number;
  rotation: number;
  color: string;
  blur: number;
  glow: number;
  shape: 'circle' | 'streak' | 'square';
  age: number;
  lifetime: number;
}

export function hashSeed(seed: string | number): number {
  const text = String(seed);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function seededRandom(seed: number, index: number, channel = 0): number {
  let value = (seed + Math.imul(index + 1, 0x9e3779b1) + Math.imul(channel + 1, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

const ranged = (value: NumberRange | undefined, random: number, fallback = 0) =>
  value === undefined
    ? fallback
    : typeof value === 'number'
      ? value
      : value.min + (value.max - value.min) * random;
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function evaluateCurve(
  curve: EvolutionCurve | undefined,
  progress: number,
  fallback = 1,
): number {
  if (!curve?.length) return fallback;
  const p = clamp(progress);
  if (p <= curve[0]!.at) return curve[0]!.value;
  for (let index = 1; index < curve.length; index++) {
    const right = curve[index]!;
    const left = curve[index - 1]!;
    if (p <= right.at) {
      const span = Math.max(Number.EPSILON, right.at - left.at);
      const t = (p - left.at) / span;
      return left.value + (right.value - left.value) * t;
    }
  }
  return curve.at(-1)!.value;
}

export function spawnPosition(
  region: SpawnRegion,
  randomX: number,
  randomY: number,
  width: number,
  height: number,
) {
  switch (region.type) {
    case 'point':
      return { x: region.x * width, y: region.y * height };
    case 'line':
      return {
        x: (region.x1 + (region.x2 - region.x1) * randomX) * width,
        y: (region.y1 + (region.y2 - region.y1) * randomX) * height,
      };
    case 'circle': {
      const angle = randomX * Math.PI * 2;
      const radius = Math.sqrt(randomY) * region.radius;
      return {
        x: (region.x + Math.cos(angle) * radius) * width,
        y: (region.y + Math.sin(angle) * radius) * height,
      };
    }
    case 'edge': {
      const inset = region.inset ?? 0;
      if (region.edge === 'top') return { x: randomX * width, y: inset * height };
      if (region.edge === 'bottom') return { x: randomX * width, y: (1 - inset) * height };
      if (region.edge === 'left') return { x: inset * width, y: randomY * height };
      return { x: (1 - inset) * width, y: randomY * height };
    }
    default: {
      const x = region.type === 'full-frame' ? 0 : (region.x ?? 0);
      const y = region.type === 'full-frame' ? 0 : (region.y ?? 0);
      const w = region.type === 'full-frame' ? 1 : (region.width ?? 1);
      const h = region.type === 'full-frame' ? 1 : (region.height ?? 1);
      return { x: (x + randomX * w) * width, y: (y + randomY * h) * height };
    }
  }
}

export function particlesAt(
  emitter: ParticleEmitter,
  seedInput: string | number,
  seconds: number,
  width: number,
  height: number,
): ParticleState[] {
  if (emitter.spawnRate < 0 || emitter.maxParticles < 0)
    throw new Error('Particle spawnRate and maxParticles must be non-negative');
  const start = emitter.start ?? 0;
  if (seconds < start) return [];
  const elapsed = Math.max(0, Math.min(seconds, emitter.end ?? seconds) - start);
  const continuous = Math.floor(elapsed * emitter.spawnRate);
  const totalSpawned = (emitter.burst ?? 0) + continuous;
  const firstId = Math.max(0, totalSpawned - emitter.maxParticles);
  const seed = hashSeed(seedInput);
  const states: ParticleState[] = [];
  for (let id = firstId; id < totalSpawned; id++) {
    const spawnTime =
      id < (emitter.burst ?? 0)
        ? start
        : start + (id - (emitter.burst ?? 0)) / Math.max(Number.EPSILON, emitter.spawnRate);
    const age = seconds - spawnTime;
    const lifetime = ranged(emitter.particle.lifetime, seededRandom(seed, id, 0));
    if (age < 0 || age >= lifetime) continue;
    const origin = spawnPosition(
      emitter.region,
      seededRandom(seed, id, 1),
      seededRandom(seed, id, 2),
      width,
      height,
    );
    const velocityX = ranged(emitter.physics.velocityX, seededRandom(seed, id, 3));
    const velocityY = ranged(emitter.physics.velocityY, seededRandom(seed, id, 4));
    const drag = Math.max(0, emitter.physics.drag ?? 0);
    const travel = drag ? (1 - Math.exp(-drag * age)) / drag : age;
    const turbulence =
      (emitter.physics.turbulence ?? 0) *
      Math.sin(age * 3.7 + seededRandom(seed, id, 5) * Math.PI * 2);
    const progress = age / lifetime;
    const baseSize = ranged(emitter.particle.size, seededRandom(seed, id, 6));
    const baseOpacity = ranged(emitter.particle.opacity, seededRandom(seed, id, 7), 1);
    const baseRotation = ranged(emitter.particle.rotation, seededRandom(seed, id, 8));
    const angularVelocity = ranged(emitter.physics.angularVelocity, seededRandom(seed, id, 9));
    states.push({
      id,
      x:
        origin.x +
        velocityX * travel +
        0.5 * (emitter.physics.accelerationX ?? 0) * age * age +
        turbulence,
      y:
        origin.y +
        velocityY * travel +
        0.5 * ((emitter.physics.accelerationY ?? 0) + (emitter.physics.gravity ?? 0)) * age * age,
      size: Math.max(0, baseSize * evaluateCurve(emitter.evolution.scale, progress)),
      opacity: clamp(baseOpacity * evaluateCurve(emitter.evolution.opacity, progress)),
      rotation:
        baseRotation +
        angularVelocity * age +
        evaluateCurve(emitter.evolution.rotation, progress, 0),
      color: emitter.particle.color,
      blur: emitter.particle.blur ?? 0,
      glow: emitter.particle.glow ?? 0,
      shape: emitter.particle.shape ?? 'circle',
      age,
      lifetime,
    });
  }
  return states;
}
