#!/usr/bin/env bash
set -euo pipefail

# Reproducible OSS humanoid-retargeting dependency (ADR 075). Expy Kit maps the
# Quaternius CC0 Unreal-Mannequin actions onto the MPFB/Rigify production human
# via its Unreal_Mannequin -> Rigify_Controls preset. Expy Kit is GPL-licensed
# (GPL v3; source headers carry the GPL block, matching Videoer's GPL Blender
# tooling — see ADR 023). It is a legacy bl_info addon, so it is pinned by commit
# and registered from a repo-local, git-ignored path rather than the Blender
# extension repository used for MPFB.

expykit_commit="3c4d5d7b8b9aa585e9e304f6b9ed35c2690238ae" # v0.6.1
blender_binary="${VIDEOER_BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install_parent="$repo_root/.venv-blender"
package_dir="$install_parent/expy_kit"

if [[ ! -x "$blender_binary" ]]; then
  echo "Blender executable not found: $blender_binary" >&2
  exit 1
fi

mkdir -p "$install_parent"
rm -rf "$package_dir"
git clone --quiet https://github.com/pKrime/Expy-Kit.git "$package_dir"
git -C "$package_dir" checkout --quiet "$expykit_commit"

# The package imports as `expy_kit` with its parent on sys.path; verify it
# registers headlessly (this is the capability check — a clone alone is not
# sufficient, exactly as the doctor treats other Blender tooling).
"$blender_binary" --background --factory-startup --python-expr \
  "import sys; sys.path.insert(0, '$install_parent'); import expy_kit; expy_kit.register(); print('VIDEOER_EXPYKIT_READY', '.'.join(map(str, expy_kit.bl_info['version'])))"

echo "Installed Expy Kit commit $expykit_commit (GPL) at $package_dir and verified headless registration."
