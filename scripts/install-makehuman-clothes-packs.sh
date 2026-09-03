#!/usr/bin/env bash
set -euo pipefail

# Reproducible, hash-verified installer for six CC0 MakeHuman clothes packs
# (ADR 023 licensing-dependency policy). Downloads + extracts the pinned pack
# zips, then runs scripts/blender/mhclo_asset_manifest.py --check as a drift
# gate against the committed licence/clearance record.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

dest_root="${VIDEOER_MH_CLOTHES_ROOT:-$repo_root/work/sources/makehuman-cc0-clothes-packs-v1}"
zips_dir="$dest_root/zips"
mkdir -p "$zips_dir"

record_path="$repo_root/assets/wardrobe/makehuman-cc0-clothes-packs-v1.json"
manifest_script="$repo_root/scripts/blender/mhclo_asset_manifest.py"

# pack | bytes | sha256
pack_pins="
shirts01 24479483 a5a723b0e84a109bb190fcfeac7f1de4138d875da3e30fe5b3340eac9f38bcd3
pants01 21908723 e4e0ec60db34f279be291a83cfd7b342a7c5cf09bb7676682a5f39f4f6ac4ad9
dress01 46598791 f49ba54a3c93acd3c3307cc5a96cfc65daf8abfed9212a7e580791d821c9e93a
skirts01 29554534 293fa0c15e28e8dcea8dfff20cae31aa4b0d1268a6e6ba0a53a92ebb0f36c882
shoes01 82953569 ded3f70428505eabbf1f6d7b5f61196a7366ef20757103d276ad0ed336c35ada
suits01 42624017 2b1d8676f3863b188e9eea98c1d8f234543d54c440e791d92b819f8ee1861f19
"

file_size() {
  local path="$1"
  # macOS/BSD stat first; fall back to `wc -c` (portable, e.g. Linux/GNU stat's
  # incompatible -f%z meaning makes the BSD form fail there).
  stat -f%z "$path" 2>/dev/null || wc -c < "$path" | tr -d '[:space:]'
}

verify_zip() {
  local zip_path="$1" expected_bytes="$2" expected_sha="$3"
  local actual_bytes actual_sha
  actual_bytes="$(file_size "$zip_path")"
  [[ "$actual_bytes" == "$expected_bytes" ]] || return 1
  actual_sha="$(shasum -a 256 "$zip_path" | awk '{print $1}')"
  [[ "$actual_sha" == "$expected_sha" ]]
}

download_pack() {
  local pack="$1" expected_bytes="$2" expected_sha="$3"
  local zip_path="$zips_dir/${pack}_cc0.zip"
  local primary="https://files.makehumancommunity.org/asset_packs/${pack}/${pack}_cc0.zip"
  local mirror="https://files2.makehumancommunity.org/asset_packs/${pack}/${pack}_cc0.zip"

  if [[ -f "$zip_path" ]] && verify_zip "$zip_path" "$expected_bytes" "$expected_sha"; then
    echo "Reusing verified $pack zip at $zip_path"
    return 0
  fi

  echo "Downloading $pack from $primary"
  if ! curl -fsSL --retry 2 -o "$zip_path" "$primary"; then
    echo "Primary download failed for $pack; retrying via mirror $mirror" >&2
    curl -fsSL --retry 2 -o "$zip_path" "$mirror"
  fi

  local actual_bytes
  actual_bytes="$(file_size "$zip_path")"
  if [[ "$actual_bytes" != "$expected_bytes" ]]; then
    echo "MakeHuman clothes pack size mismatch for $pack: $actual_bytes != $expected_bytes bytes" >&2
    exit 1
  fi

  local actual_sha
  actual_sha="$(shasum -a 256 "$zip_path" | awk '{print $1}')"
  if [[ "$actual_sha" != "$expected_sha" ]]; then
    echo "MakeHuman clothes pack hash mismatch for $pack: $actual_sha != $expected_sha" >&2
    exit 1
  fi
}

extract_pack() {
  local pack="$1"
  local zip_path="$zips_dir/${pack}_cc0.zip"
  local has_macos
  # `unzip -l | grep -q` is nondeterministic under `pipefail`: grep -q exits
  # as soon as it finds a match, which can SIGPIPE unzip before it finishes
  # writing, and pipefail then reports that SIGPIPE as the pipeline's
  # failure. `-Z1` (bare filenames) + `grep -c` (reads to EOF, always exits
  # 0 or 1 on its own count, never early) avoids that race.
  has_macos="$(unzip -Z1 "$zip_path" | grep -c '^__MACOSX/' || true)"
  if [[ "$has_macos" != "0" ]]; then
    unzip -q -o "$zip_path" -d "$dest_root" -x '__MACOSX/*'
  else
    unzip -q -o "$zip_path" -d "$dest_root"
  fi
}

while read -r pack bytes sha; do
  [[ -z "$pack" ]] && continue
  download_pack "$pack" "$bytes" "$sha"
done <<< "$pack_pins"

while read -r pack bytes sha; do
  [[ -z "$pack" ]] && continue
  extract_pack "$pack"
done <<< "$pack_pins"

check_stdout_file="$(mktemp)"
check_stderr_file="$(mktemp)"
cleanup_check_files() {
  rm -f "$check_stdout_file" "$check_stderr_file"
}
trap cleanup_check_files EXIT

set +e
python3 "$manifest_script" "$dest_root" --check "$record_path" >"$check_stdout_file" 2>"$check_stderr_file"
check_status=$?
set -e

check_output="$(cat "$check_stdout_file")"
check_stderr="$(cat "$check_stderr_file")"

# The scanner distinguishes operator errors (exit 2: missing root, no
# packs/, unreadable file) from actual drift (exit 1: MHCLO_MANIFEST_DRIFT
# lines on stdout); surface each distinctly instead of a single generic
# "drift" message, and always show the real stderr.
if [[ "$check_status" -eq 2 ]]; then
  echo "scanner error: $check_stderr" >&2
  exit 2
fi

echo "$check_output"

if [[ "$check_status" -eq 1 ]]; then
  if grep -q '^MHCLO_MANIFEST_DRIFT ' <<< "$check_output"; then
    echo "Drift between $dest_root and $record_path; see MHCLO_MANIFEST_DRIFT lines above." >&2
  else
    echo "Scanner exited 1 without any MHCLO_MANIFEST_DRIFT lines in its output." >&2
    [[ -n "$check_stderr" ]] && echo "$check_stderr" >&2
  fi
  exit 1
fi

total="$(grep -o 'total=[0-9]*' <<< "$check_output" | cut -d= -f2)"
approved="$(grep -o 'approved=[0-9]*' <<< "$check_output" | cut -d= -f2)"
review_required="$(grep -o 'reviewRequired=[0-9]*' <<< "$check_output" | cut -d= -f2)"
rejected="$(grep -o 'rejected=[0-9]*' <<< "$check_output" | cut -d= -f2)"

echo "Installed 6 CC0 MakeHuman clothes packs ($total assets: $approved approved, $review_required review-required, $rejected rejected) at $dest_root."
