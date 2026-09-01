#!/usr/bin/env bash
set -euo pipefail

# Reproducible OSS production-rig dependency for the MakeHuman hm08 backend.
# MPFB code is GPL-3.0-or-later; its bundled mesh, rig, pose, and weight data
# are CC0-1.0. This installs the addon into Blender's user_default repository.

mpfb_commit="437dd513888a92399d1d3200d2e80859fae55abc"
blender_binary="${VIDEOER_BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"

if [[ ! -x "$blender_binary" ]]; then
  echo "Blender executable not found: $blender_binary" >&2
  exit 1
fi

work_directory="$(mktemp -d /private/tmp/videoer-mpfb-install.XXXXXX)"
cleanup() {
  rm -rf "$work_directory"
}
trap cleanup EXIT

source_directory="$work_directory/mpfb2"
package_path="$work_directory/mpfb-2.0.17-$mpfb_commit.zip"

git clone --quiet https://github.com/makehumancommunity/mpfb2.git "$source_directory"
git -C "$source_directory" checkout --quiet "$mpfb_commit"

verify_asset() {
  local relative_path="$1"
  local expected="$2"
  local actual
  actual="$(shasum -a 256 "$source_directory/$relative_path" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    echo "MPFB asset hash mismatch for $relative_path: $actual" >&2
    exit 1
  fi
}

verify_asset "src/mpfb/data/3dobjs/base.obj" \
  "8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c"
verify_asset "src/mpfb/data/rigs/standard/rig.default.json" \
  "8b949de35c2dd70dbb5094e57a8586c3b9a9f650775a293212581a8f67be6797"
verify_asset "src/mpfb/data/rigs/standard/weights.default.json" \
  "154b866774a8c2b055a8e86419f22a87b76c60440fdcb70bcb78345f00924e89"
verify_asset "src/mpfb/data/rigs/rigify/rig.human_toes.json" \
  "970f19f9e426528052a0f8bfc2cd6f1eea627aa607517ff4e43ae88d96488846"
verify_asset "src/mpfb/data/rigs/rigify/weights.human_toes.json" \
  "edcbca3323b03080fe750caa292c673ecbacdd200ebf0062d00d3b425e13a999"

"$blender_binary" --command extension build \
  --source-dir "$source_directory/src/mpfb" \
  --output-filepath "$package_path"
"$blender_binary" --command extension install-file \
  -r user_default -e "$package_path"

"$blender_binary" --background --factory-startup --python-expr \
  "import bpy; assert bpy.ops.preferences.addon_enable(module='rigify') == {'FINISHED'}; assert bpy.ops.preferences.addon_enable(module='bl_ext.user_default.mpfb') == {'FINISHED'}; import bl_ext.user_default.mpfb as mpfb; print('VIDEOER_MPFB_READY', '.'.join(map(str, mpfb.VERSION)))"

echo "Installed MPFB commit $mpfb_commit and verified its CC0 rig assets."
