import { motionDesignSchema } from './design.js';

export const naturalWalkDesign = motionDesignSchema.parse({
  schemaVersion: 1,
  id: 'motion-design.human-walk-v4',
  category: 'locomotion',
  description:
    'Healthy-gait-calibrated human walking with measured pelvis/foot waveforms, explicit whole-foot swing clearance, planted contacts, phase-delayed whole-body counter-motion, and proportion-aware synthesis.',
  parameters: [
    { id: 'stride-length', default: 1, minimum: 0.45, maximum: 1.45, unit: 'meters' },
    { id: 'cadence', default: 108, minimum: 65, maximum: 150, unit: 'steps-per-minute' },
    { id: 'pelvis-rotation', default: 0.5, minimum: 0, maximum: 1, unit: 'ratio' },
    { id: 'lateral-shift', default: 0.38, minimum: 0, maximum: 1, unit: 'ratio' },
    { id: 'step-width', default: 0.08, minimum: 0.04, maximum: 0.12, unit: 'ratio' },
    { id: 'vertical-motion', default: 0.4, minimum: 0, maximum: 1, unit: 'ratio' },
    { id: 'arm-swing', default: 0.55, minimum: 0, maximum: 1.2, unit: 'ratio' },
  ],
  phases: [
    { id: 'initial-contact', start: 0, end: 0.02, description: 'Heel establishes contact.' },
    {
      id: 'loading-response',
      start: 0.02,
      end: 0.12,
      description: 'Heel rocker lowers the forefoot and accepts weight.',
    },
    { id: 'mid-stance', start: 0.12, end: 0.3, description: 'Body advances over a planted foot.' },
    {
      id: 'terminal-stance',
      start: 0.3,
      end: 0.5,
      description: 'Heel rises around the forefoot rocker.',
    },
    {
      id: 'pre-swing',
      start: 0.5,
      end: 0.6,
      description: 'Forefoot rolls through push-off; fixed toe contact releases before toe-off.',
    },
    {
      id: 'initial-swing',
      start: 0.6,
      end: 0.73,
      description: 'Knee flexion accelerates the limb and creates clearance.',
    },
    {
      id: 'mid-swing',
      start: 0.73,
      end: 0.87,
      description: 'Tibia advances with a dorsiflexed foot.',
    },
    {
      id: 'terminal-swing',
      start: 0.87,
      end: 1,
      description: 'Knee extends and heel prepares for contact.',
    },
  ],
  contacts: [
    {
      id: 'heel-ground',
      effector: 'heel-contact',
      target: { kind: 'ground-plane', height: 0 },
      phases: ['initial-contact', 'loading-response', 'mid-stance'],
      mode: 'pivot',
    },
    {
      id: 'toe-ground',
      effector: 'toe-contact',
      target: { kind: 'ground-plane', height: 0 },
      phases: ['mid-stance', 'terminal-stance', 'pre-swing'],
      mode: 'pivot',
    },
  ],
  layers: [
    {
      id: 'locomotion',
      role: 'base',
      joints: [
        'root',
        'left-thigh',
        'right-thigh',
        'left-shin',
        'right-shin',
        'left-foot',
        'right-foot',
        'left-toe',
        'right-toe',
      ],
      description: 'Root progression and contact-constrained legs.',
    },
    {
      id: 'pelvis',
      role: 'additive',
      joints: ['hips'],
      description: 'Yaw, obliquity, and weight transfer.',
    },
    {
      id: 'counter-motion',
      role: 'additive',
      joints: ['spine', 'chest'],
      description:
        'Accumulated global thorax counter-rotation and posture; local chest opposition alone is insufficient.',
    },
    {
      id: 'arms',
      role: 'additive',
      joints: [
        'left-clavicle',
        'right-clavicle',
        'left-upper-arm',
        'right-upper-arm',
        'left-forearm',
        'right-forearm',
      ],
      description:
        'Opposite-leg upper-arm swing, subtle clavicle/scapular counter-motion, and elbow modulation.',
    },
    {
      id: 'head-stabilisation',
      role: 'additive',
      joints: ['neck', 'head'],
      description: 'Compensation against inherited torso motion.',
    },
  ],
  invariants: [
    {
      id: 'stance-contact',
      type: 'contact-lock',
      tolerance: 0.01,
      unit: 'meters',
      description: 'Active heel or toe contact remains fixed.',
    },
    {
      id: 'swing-clearance',
      type: 'ground-clearance',
      tolerance: 0.015,
      unit: 'meters',
      description: 'Swing foot remains above the floor.',
    },
    {
      id: 'joint-safety',
      type: 'joint-limit',
      tolerance: 0,
      unit: 'radians',
      description: 'Hip, knee, ankle, and toe curves stay within cinematic human bounds.',
    },
    {
      id: 'anatomical-foot-direction',
      type: 'joint-limit',
      tolerance: 0,
      unit: 'meters',
      description:
        'The toe remains anatomically ahead of the heel, with the leading heel ahead of the body and the trailing heel behind it.',
    },
    {
      id: 'lateral-walking-base',
      type: 'joint-limit',
      tolerance: 0,
      unit: 'meters',
      description:
        'A production-rest leg spread is retargeted to a height-normalized, style-specific walking base; feet remain on their anatomical sides without crossing or straddling.',
    },
    {
      id: 'continuous-root',
      type: 'root-continuity',
      tolerance: 0.03,
      unit: 'meters-per-second',
      description: 'Root velocity contains no visible discontinuity.',
    },
    {
      id: 'continuous-com',
      type: 'centre-of-mass-continuity',
      tolerance: 0.015,
      unit: 'meters',
      description: 'Pelvis translation remains smooth across the loop.',
    },
    {
      id: 'visible-support-transfer',
      type: 'centre-of-mass-continuity',
      tolerance: 0.35,
      unit: 'ratio',
      description:
        'During single support the pelvis travels at least 35% of the half walking-base width toward the stance foot.',
    },
    {
      id: 'global-thorax-opposition',
      type: 'joint-limit',
      tolerance: 0.5,
      unit: 'ratio',
      description:
        'The accumulated hips + spine + chest yaw is phase-opposed to pelvis yaw rather than merely hiding opposition in a local chest track.',
    },
    {
      id: 'thorax-phase-lag',
      type: 'joint-limit',
      tolerance: 0.025,
      unit: 'ratio',
      description:
        'Thorax opposition includes a measurable 2.5–10% cycle delay instead of being a mechanically inverted copy of pelvis yaw.',
    },
  ],
  research: {
    sources: [
      'https://peerj.com/articles/4640/',
      'https://figshare.com/articles/dataset/A_public_data_set_of_overground_and_treadmill_walking_kinematics_and_kinetics_of_healthy_individuals/5722711',
      'https://pmc.ncbi.nlm.nih.gov/articles/PMC4994968/',
      'https://pmc.ncbi.nlm.nih.gov/articles/PMC5545133/',
      'https://pmc.ncbi.nlm.nih.gov/articles/PMC2843703/',
      'https://pmc.ncbi.nlm.nih.gov/articles/PMC10192365/',
    ],
    notes: [
      'Stance occupies approximately 60% and swing approximately 40% of a normal cycle.',
      'Stance uses heel, ankle, and forefoot rockers rather than a permanently flat rigid foot.',
      'Pelvis, thorax, arms, and head participate in coordinated whole-body motion.',
      'Coupled segments retain small temporal delays and asymmetric acceleration rather than sharing one sinusoid.',
      'Pelvis rotation, obliquity, tilt, and foot-segment pitch use a six-harmonic population-median calibration from 24 young adults walking overground at comfortable speed.',
    ],
  },
});
