# OpenEXR source-inspection installation

Videoer uses the open-source `exrinfo` utility to inspect externally acquired OpenEXR environment maps before they can become lighting inputs. This is an ingestion boundary, not a rendering fallback: the importer verifies the EXR magic, patched tool version, BSD-3-Clause licence evidence, single-part scanline storage, RGB/RGBA half/float channels, matching zero-origin data/display windows, requested pixel dimensions, exact 2:1 projection, and colour interpretation. Explicit chromaticities must match Rec.709. When the attribute is absent, Videoer records the standards-defined `openexr-default-rec709` mode from the [OpenEXR Technical Introduction 3.4](https://openexr.com/en/latest/TechnicalIntroduction.html#rgb-color); it does not infer primaries from the filename or provider. Blender independently rechecks the staged file's hash, byte size, decoded format, and dimensions at render time.

On macOS:

```sh
brew install openexr
npm run video -- doctor
```

The doctor must report `OpenEXR source inspector` as available and `verified -v -s inspection`. It runs a bounded inspection of a project-owned 2×1 RGB OpenEXR smoke fixture, so a version string alone is not sufficient. Videoer currently accepts security-patched OpenEXR releases at or above 3.2.11, 3.3.13, or 3.4.14 on their respective maintained branches; newer major/minor branches are accepted. Do not bypass this gate, relabel an EXR as Radiance HDR, or use the tonemapped JPEG from an HDRI archive.

On Linux, install the distribution package that supplies `exrinfo`, then verify `exrinfo --version` reports a supported version and `License BSD-3-Clause`. Distribution package names and security backports vary, so the Videoer doctor—not the package name alone—is authoritative.

ambientCG's API currently labels HDRI downloads by resolution (`1K`, `2K`, and so on), while the archive's linear master may be named `*_HDR.exr`. The source adapter requires that master filename to carry the exact requested asset ID and resolution, and persists exact API-version, archive, provider-licence, adapter-assessment, inspection, colour-space and image hashes. Explicit OpenEXR `colorInteropID`, `renderingTransform`, or `lookModTransform` metadata is rejected until Videoer can interpret and reproduce it rather than silently mislabelling the pixels. Radiance RGBE inputs must carry an explicit Rec.709-compatible `PRIMARIES` header because the [Radiance format default](https://floyd.lbl.gov/radiance/refer/filefmts.pdf) uses different primaries and white. Online acquisition permits only HTTPS ambientCG or its recorded download CDN, checks every redirect, enforces a total deadline and byte bound while streaming the archive into an immutable content-addressed cache object, and records the final URL. Offline reuse requires the recorded source-identity hash and performs no provider access.
