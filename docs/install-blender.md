# Blender installation and Metal diagnostics

Blender is a required production backend. Videoer uses it headlessly for geometry processing, skeleton/skin probes, animation, constraints, simulation, conversion, and rendered verification. A missing or non-starting Blender is a failed installation; it is not permission to substitute a lower-quality renderer or skip assets.

## Supported installation

Install Blender 4.5 LTS or newer. On macOS:

```bash
brew install --cask blender
npm run video -- doctor
```

Videoer prefers the canonical application binary at `/Applications/Blender.app/Contents/MacOS/Blender`, then falls back to `blender` on `PATH`. A nonstandard installation can set `VIDEOER_BLENDER` to the executable path. `video doctor` performs a real background `bpy` startup, not only `--version`, and verifies the bundled `openvdb` and `numpy` Python modules required by deterministic sparse smoke simulation.

### New-machine checklist

1. Install the repository's Node version and run `npm install`; do not substitute globally installed Remotion packages.
2. Install Homebrew `ffmpeg-full`, link it ahead of the minimal `ffmpeg` formula, and run `npx remotion browser ensure`.
3. Install Blender 4.5 LTS or newer with `brew install --cask blender`.
4. Install the pinned open-source MPFB production-rig extension with `scripts/install-mpfb-extension.sh`. The script verifies the exact hm08 base, default rig/weights, and Rigify-with-toes rig/weights before installing MPFB into Blender's `user_default` extension repository. It enables Blender's bundled Rigify addon only inside the verification process; no paid DCC or asset licence is required.
5. Install the open-source production typeface with `brew install --cask font-cormorant-garamond`. `npm install` supplies the pinned web copy through `@fontsource/cormorant-garamond`; the cask supplies Blender and FFmpeg. Both use OFL-1.1.
6. Run `npm run video -- doctor`. Every FFmpeg feature, encoder, decoder, browser dependency, Blender startup, and Blender OpenVDB/NumPy capability is required.
7. On macOS under Codex, if Blender reports the Metal signature below, rerun the same doctor/probe command with host/GPU permission. Do not reinstall Blender, switch to `bpy`, patch the renderer, or accept a skipped probe merely because the sandboxed run failed.
8. Run the MPFB rig audit below and require `status: pass`. This separately proves that the extension can build the full default deform rig and generate Rigify's human-with-toes rig on the installed Blender version.
9. Run the same-motion MPFB probe below with `VIDEOER_MPFB_DETAIL_PROBES=1` and require its direction, elbow preservation, heel/forefoot support, lateral walking base, anatomical side order, support under/overshoot, pelvis-over-support, four-finger flexion, thumb opposition, and evaluated-surface grounding checks to pass. Inspect all five side, three-quarter, frontal, hand, and foot outputs. This catches an installation or profile mismatch that startup and rig generation cannot detect.
10. Run a real geometry or interaction probe and inspect its contact sheet. Startup success alone is not production acceptance.
11. Run an authoritative cinematic scene twice with the default fixed-seed `cycles-cpu` profile and compare decoded-frame or final MP4 hashes. A successful Eevee preview is not deterministic-final acceptance.

No commercial licence is required: Blender, FFmpeg, Remotion's pinned browser, and the Videoer verification scripts are all usable without a commercial DCC dependency.

## MPFB and Rigify production-character backend

Videoer pins MPFB 2.0.17 at commit `437dd513888a92399d1d3200d2e80859fae55abc`. MPFB code is GPL-3.0-or-later; its bundled rigs, weights, meshes, poses, expressions, and other output data are explicitly CC0-1.0. Blender's bundled Rigify addon is GPL-2.0-or-later. These licences permit commercial rendering without a commercial runtime licence. Preserve GPL notices/source if distributing program code or generated rig scripts; rendered media is not thereby forced under the GPL.

Install or repair the pinned extension:

```bash
scripts/install-mpfb-extension.sh
```

Then run the objective rig-generation audit with host/GPU access on macOS:

```bash
VIDEOER_MPFB_DETAIL_PROBES=1 /Applications/Blender.app/Contents/MacOS/Blender \
  --background --factory-startup \
  --python scripts/blender/probe_mpfb_rigs.py \
  -- work/rig-audit
```

Acceptance requires `mpfb-rig-audit.json` to report the byte-identical hm08 base, 163-bone default rig, `rigify_generated.human_toes`, and the pinned source hashes. `mpfb-rigify-human-toes.blend` is evidence, not a production character approval.

The rig profile, not Blender globally, owns coordinate conversion. The pinned hm08 import faces Blender `-Y`; `assets/rig-profiles/mpfb-rigify-human-toes-v1.json` therefore maps canonical left/up/forward to Blender `+X/+Z/-Y`. Do not replace it with Videoer's generic Blender geometry mapping. The same-motion probe fail-closes on travel direction and sampled elbow angles specifically to detect that regression.

To compare a persisted Videoer motion through the mature rig without changing the canonical motion contract:

```bash
/Applications/Blender.app/Contents/MacOS/Blender \
  --background --factory-startup \
  --python scripts/blender/render_mpfb_motion_probe.py \
  -- path/to/geometry.json path/to/motion.json work/mpfb-motion-probe
```

The adapter is currently experimental and fail-open only as research evidence. Do not replace the accepted renderer path or publish its output until its final-surface foot sequence, limb orientation, deformation, smoothness, and dual-angle visual gates pass.

## Codex sandbox and Apple Metal

Blender's macOS startup creates a Metal device even in background mode. A Codex command confined to the workspace sandbox may not see the host GPU. Blender 4.5.13 and 5.2.1 then call `supports_barycentric_whitelist()` after `MTLCreateSystemDefaultDevice()` yields no usable device/name; the released native binary may crash in `_platform_strstr` with exit 139 before any Videoer Python runs.

Typical backtrace:

```text
_platform_strstr
blender::gpu::supports_barycentric_whitelist
blender::gpu::MTLBackend::metal_is_supported
GPU_backend_type_selection_detect
```

This can look like an unsupported new Apple chip, but first rerun the identical native command with host/GPU permission. In Codex, approve the escalated Blender command. A successful run prints `VIDEOER_BLENDER_READY` and must be followed by an actual rendered probe.

## Confirmed diagnostic history (2026-08-30)

Host: macOS 26.6.1, Apple M5.

- Homebrew Blender 5.2.1 native: `--version` passed; background startup crashed inside Metal when sandboxed.
- Official Blender 4.5.13 LTS native, verified against Blender Foundation checksum: same sandboxed crash.
- Official Blender 4.5.13 Intel under Rosetta: same sandboxed Metal crash.
- Official `bpy==4.5.13` CPython 3.11 module: same sandboxed crash on import.
- The unchanged official Blender 4.5.13 native application, run with host Metal access: passed and rendered all four mannequin views, a 48-frame H.264 turntable, and a `.blend` source file.

Therefore reinstalling, switching CPU architecture, or using the Python wheel does not fix a GPU permission denial. The correct repair is granting the required host/GPU execution permission. If the same native command still fails outside a sandbox, preserve the crash log, compare it with this signature, then investigate the installed Blender build and host driver; do not silently change backends.

## Deterministic final rendering on Apple Metal

The startup permission issue above is distinct from final-output repeatability. On the same Blender 4.5.13/M5 host, two independent Eevee Next renders with identical manifests, fixed Halton sample order, lossless PNG output, and output dithering disabled still produced different decoded pixels. Shadow-off controls were pixel-identical, isolating the drift to Eevee's Metal virtual-shadow-map path. Disabling shadows or accepting a tolerance was rejected.

Videoer's authoritative cinematic profiles therefore use Blender's supported Cycles CPU integrator with a fixed seed, animated and adaptive sampling disabled, declared sample count, and automatic CPU threading. The initial 64-sample control was pixel-identical across processes and thread modes. The current `production-clean` default uses 128 samples plus CPU OpenImageDenoise; an independent same-scene gallery rerender produced byte-identical video and semantic-frame hashes while visibly removing sampling grain. Eevee Next remains available only for explicitly non-authoritative previews. The final boundary is lossless PNG frames followed by project-owned single-thread x264 encoding with stripped/fixed metadata.

For future machines, record Blender version, OS/CPU, scene fingerprint, render profile, sample count, seed, decoded-frame hashes, and final MP4 hash. If Cycles CPU drifts, stop publication and investigate the runtime; do not weaken samples, shadows, or evidence gates. See [ADR 036](adr/036-deterministic-blender-render-profiles.md).

The 4.5.13 source path at `supports_barycentric_whitelist()` was inspected because the crash appeared to be an M5 detector defect. Testing the unchanged official binary with host Metal access proved the released code works on this host, while the official `bpy` module fails at the same native detector only inside the restricted environment. Consequently Videoer carries no private Blender fork or M5 source patch. Future installs must reproduce the host-access diagnostic before considering a source change; if a genuine outside-sandbox crash is later proven, document the exact upstream commit, patch, build flags, checksum, and removal condition here.

## Manual verification

```bash
/Applications/Blender.app/Contents/MacOS/Blender \
  --background \
  --factory-startup \
  --python-expr "import bpy; print('VIDEOER_BLENDER_READY', bpy.app.version_string)"
```

Then run an objective render:

```bash
npm run video -- geometry mannequin work/mannequin
```

Acceptance requires `geometry.json`, passing `validation.json`, four canonical PNG views, `contact-sheet.png`, `turntable.mp4`, `probe.json`, and `mannequin.blend`.
