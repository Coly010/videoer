# Human gait kinematic acceptance

Videoer's naturalistic-motion gate is calibrated against healthy motion rather than a hand-picked procedural clip. It is an engineering and perceptual acceptance policy, not a clinical diagnostic model.

## Reference population and licence

The reference is Fukuchi, Fukuchi, and Duarte's public walking-biomechanics dataset, version 5, DOI `10.6084/m9.figshare.5722711.v5`. The dataset is CC BY 4.0. Its `WBDSascii.zip` artifact is Figshare file `10058986`, MD5 `ad9e6311d9b84b53acaf58d114d51c6d`. The associated paper describes 42 healthy volunteers and provides processed 101-point gait-cycle curves. Videoer's calibration selects the 24 young-adult comfortable overground `walkOCang` records and evaluates pelvis, hip, knee, ankle, and foot XYZ angle vectors: 120 reference tracks in total.

- [Dataset and licence](https://figshare.com/articles/dataset/A_public_data_set_of_overground_and_treadmill_walking_kinematics_and_kinetics_of_healthy_individuals/5722711)
- [Peer-reviewed dataset paper](https://peerj.com/articles/4640/)

Third differences amplify measurement and cycle-boundary noise. Before derivative measurement, each 100-interval periodic curve is therefore reconstructed from harmonics −6 through +6. That retains ordinary gait bandwidth while removing components that cannot support a stable jerk comparison. The conditioned values receive the same explicit C² quintic representation and 240 Hz analysis used by Videoer motion clips.

Run the reproducible calibration after extracting `WBDSascii.zip`:

```sh
npm run build
node scripts/research/calibrate-gait-kinematics.mjs path/to/WBDSascii
```

## Reference results and policy

| Measurement          | Median |    P95 | Maximum | Videoer limit |
| -------------------- | -----: | -----: | ------: | ------------: |
| Normalized peak jerk |  6,545 | 16,271 |  18,768 |        20,000 |
| Jerk peak / P95      |   1.57 |   1.94 |    2.08 |          2.50 |

Normalized jerk is `peak jerk × duration³ ÷ track span`, making the comparison independent of units, cadence, and motion magnitude. The impulse ratio rejects isolated spikes even when the overall waveform range is large. Loop velocity and acceleration are compared from the explicit endpoint derivatives and each must differ by no more than 10% of that track's peak derivative. These seam limits are engineering tolerances; a properly periodic C² reference or generated track normally measures approximately zero.

The policy does not prove naturalism. It rejects discontinuity and excessive high-frequency motion. Contact, clearance, penetration, joint limits, travel direction, anatomical foot order, and repeated side/three-quarter visual inspection remain independent requirements.

## Current generated styles

After C² swing reconstruction, support-knee reserve, gait-bandwidth conditioning, and final-clip ground correction, the current default styles measure:

| Style     | Maximum normalized jerk | Maximum impulse ratio | Velocity seam | Acceleration seam |
| --------- | ----------------------: | --------------------: | ------------: | ----------------: |
| Neutral   |                  13,579 |                  2.11 |       < 1e−12 |           < 1e−12 |
| Cautious  |                  17,561 |                  2.08 |       < 1e−12 |           < 1e−12 |
| Confident |                  13,660 |                  1.86 |       < 1e−12 |           < 1e−12 |

The persisted clip is also reconstructed through the leg chain at 401 phases. All three styles retain forward-facing feet, correct leading/trailing heel order, at least 20 mm measured swing clearance, less than 5 mm ground penetration, and less than 10 mm planted-contact error after conditioning. These are mechanical prerequisites only; no gait receives visual acceptance from this report.
