# Human gait research basis

This note records the biomechanical evidence used to design Videoer's naturalistic procedural walk. It is an engineering translation for perceptually believable cinematic motion, not a clinical gait model and not copied animation data.

Quantitative derivative calibration, its reproducible CC BY workflow, and the current velocity/acceleration/jerk policy are recorded in [Human gait kinematic acceptance](human-gait-kinematics.md).

## Phase model

A normal gait cycle is approximately 60% stance and 40% swing. The implementation uses these phase landmarks for each foot:

| Phase            | Normalised interval | Production meaning                                          |
| ---------------- | ------------------: | ----------------------------------------------------------- |
| Initial contact  |           0.00–0.02 | Heel reaches the next planted position; toe remains raised. |
| Loading response |           0.02–0.12 | Heel rocker lowers the forefoot and accepts weight.         |
| Mid stance       |           0.12–0.30 | Foot is planted while the body advances over the ankle.     |
| Terminal stance  |           0.30–0.50 | Heel rises and the body pivots over the forefoot.           |
| Pre-swing        |           0.50–0.60 | Toe remains briefly planted, then pushes off.               |
| Initial swing    |           0.60–0.73 | Knee flexion and ankle dorsiflexion create clearance.       |
| Mid swing        |           0.73–0.87 | Tibia advances while the foot clears the ground.            |
| Terminal swing   |           0.87–1.00 | Knee extends and the foot prepares for heel contact.        |

The timing follows the phase summary in the gait-analysis literature. The ankle implementation follows the three stance rockers: heel rocker, ankle rocker, then forefoot rocker. Heel contact must therefore not be represented as a rigid, flat foot for the whole stance interval.

## Whole-body principles

- Pelvic vertical motion has two cycles per gait cycle: the centre of mass is highest during single support and lowest during double support.
- Pelvic transverse rotation contributes to stride length; normal walking research reports roughly 10° total excursion as a useful upper reference, not a mandatory target.
- Pelvic obliquity and lateral translation represent weight transfer and must be phase-locked to the support leg.
- The thorax counter-rotates relative to the pelvis with limited range. Global trunk motion should remain smaller than pelvis-relative motion.
- Arm swing is coordinated with the opposite leg and contributes to regulation of whole-body angular momentum. Elbows remain flexed and change angle subtly rather than acting as rigid rods.
- Head compensation should reduce inherited pelvis/chest roll and yaw rather than adding another full-amplitude oscillation.

## Production-rest walking base

A production A-pose may abduct the legs as well as lower the arms. That rest geometry is useful for skinning and clothing, but it is not a walking base. The pinned hm08 template places its ankle joints about 446 mm apart at rest for a 1.69 m body. Carrying that spread into locomotion produced approximately 400 mm evaluated sole separation on MPFB/Rigify and a visibly straddled gait.

The canonical solver now measures thigh and shin lateral rest offsets and solves a coronal thigh rotation toward a height-normalized, style-specific step width while the root transfers over the support foot. Verification is deliberately two-level:

- renderer-independent reconstruction rejects crossing, anatomical side reversal, an inherited over-wide rest stance, insufficient support transfer, and pelvis/thorax yaw that is not phase-opposed;
- production-backend verification repeats width, side-order, and support-transfer measurements on evaluated sole regions.

The first 94 mm canonical target was rejected because the full Rigify result narrowed to 45 mm and one sole crossed the centreline by 11 mm. The accepted mechanical target for the current neutral 1.69 m fixture is 135 mm; MPFB/Rigify retains at least 86 mm evaluated separation and 10.8 mm anatomical-side margin. These are reusable guardrails, not visual acceptance: the current walk remains rejected for whole-body performance.

## Whole-body phase coordination

Phase-gait v2 corrected a structural verification error: a locally counter-rotating chest can still leave the accumulated hips + spine + chest following the pelvis. The verifier therefore grades accumulated global thorax yaw, not one local Euler channel, and uses quaternion geodesic sweep for arm and clavicle amplitude so A-pose rest correction cannot change the measurement.

Phase-gait v3 then removed a second procedural artifact. Pelvis, thorax, shoulder, arm, and elbow no longer share one waveform or exact sign inversion. Separate C2-continuous curves introduce small inertial delays and asymmetric acceleration. The neutral fixture measures a strongest global thorax opposition delay of 4/64 samples, or 0.0625 cycle, with -0.898 zero-lag correlation and -0.998 correlation at the delayed opposition. Verification rejects both zero-delay mechanical inversion and delay beyond 10% of a cycle.

This is necessary but not sufficient. Reduced v13 and MPFB/Rigify v22 remain visually rejected: arm carriage still reads as a mannequin, the frontal base appears narrow with excessive hip sway, and loading/release remains weak. The next synthesis step is to fit normalized project-owned curves against the public healthy-walking dataset's pelvis/trunk/limb waveform relationships rather than increasing amplitude or adding benchmark-specific offsets.

Backend support transfer must be calibrated on the final evaluated soles. MPFB v19 correctly failed at 1.32–1.38 of the support-sole offset; v22 passes at 1.17–1.22. Probe images sample within each named phase rather than only at phase boundaries, because a boundary frame can conceal the action the phase is meant to verify.

## Data and sources

- Fukuchi, Fukuchi, and Duarte's public healthy-walking dataset contains 101-point normalised pelvis, hip, knee, ankle, foot, moment, and ground-reaction-force curves across speeds. Videoer uses its channel conventions and broad waveform relationships as a research reference; it does not redistribute or invoke the dataset at render time. [PeerJ paper](https://peerj.com/articles/4640/) · [CC BY 4.0 dataset](https://figshare.com/articles/dataset/A_public_data_set_of_overground_and_treadmill_walking_kinematics_and_kinetics_of_healthy_individuals/5722711)
- Brockett and Chapman describe heel, ankle, and forefoot rockers; controlled plantarflexion after heel strike; dorsiflexion through stance; plantarflexion into toe-off; and swing dorsiflexion for clearance. [Biomechanics of the ankle](https://pmc.ncbi.nlm.nih.gov/articles/PMC4994968/)
- Lewis et al. report pelvic tilt, obliquity, and rotation during healthy walking and the twice-per-cycle vertical centre-of-mass pattern. [The human pelvis during gait](https://pmc.ncbi.nlm.nih.gov/articles/PMC5545133/)
- Chung et al. measured trunk motion in healthy adults and found phase-related pelvic/trunk rotation with smaller global than pelvis-relative ranges. [Kinematic aspects of trunk motion](https://pmc.ncbi.nlm.nih.gov/articles/PMC2843703/)
- Nakakubo et al. measured whole-body angular momentum with and without arm swing; arm swing altered transverse angular-momentum regulation without changing the nominal stride task. [Whole-body angular momentum during walking](https://pmc.ncbi.nlm.nih.gov/articles/PMC10192365/)

## Translation rules

1. Research determines phase topology, contacts, curve landmarks, counter-motion, and validation bounds.
2. All runtime curves and solvers are project-owned, parameterised code.
3. Rendering remains deterministic and provider-free.
4. Quantitative checks are guardrails; multi-angle video inspection remains authoritative.
5. A gait cannot pass because its ankles touch the floor. Direction, heel/toe sequencing, planted contact, clearance, joint polarity, centre-of-mass continuity, and whole-body participation are all required.
6. At initial contact, the landing heel must be ahead of the travelling root, the opposite heel must trail it, and every sampled toe must remain anatomically forward of its heel. This explicitly prevents the backwards-walk and backwards-foot failures found in the first probe.
