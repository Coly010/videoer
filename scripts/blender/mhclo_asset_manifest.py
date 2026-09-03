"""Licence/clearance manifest scanner for CC0 MakeHuman ``.mhclo`` clothes packs.

Pure Python 3, no ``bpy``: this walks an extracted MakeHuman clothes-asset root
(``clothes/<name>/<name>.mhclo`` + ``packs/<pack>.json``, per ADR 023's
licensing-dependency policy) and produces a deterministic, content-addressed
licence/clearance record. It never renders or touches Blender; it is the
scanner half of the pair, the other half being
``scripts/install-makehuman-clothes-packs.sh``, which uses ``--check`` as a
drift gate after extracting the pinned packs.

Usage::

    python3 scripts/blender/mhclo_asset_manifest.py <asset-root>
    python3 scripts/blender/mhclo_asset_manifest.py <asset-root> --write assets/wardrobe/makehuman-cc0-clothes-packs-v1.json
    python3 scripts/blender/mhclo_asset_manifest.py <asset-root> --check assets/wardrobe/makehuman-cc0-clothes-packs-v1.json

Environment:
    None.
"""

import argparse
import glob
import hashlib
import json
import os
import re
import sys

# hm08's unmodified `body` group is base vertex indices 0..13379 inclusive;
# anything at or above this is helper geometry (tights/skirt/hair helpers etc).
SKIN_MAX_VERTEX = 13379

# The original spec's literal 7 keys, plus every "*Texture"-named key MPFB's
# own material parser accepts: the canonical `MhMatFileKey` entries and the
# `MHMAT_ALIAS` spellings from MPFB's `entities/material/mhmatkeys.py` (e.g.
# `bumpTexture` is itself an MPFB alias for the canonical `bumpmapTexture`).
TEX_KEYS = (
    "diffuseTexture",
    "bumpTexture",
    "normalmapTexture",
    "specularTexture",
    "aomapTexture",
    "displacementTexture",
    "transparencymapTexture",
    # MPFB canonical MhMatFileKey texture keys.
    "bumpmapTexture",
    "displacementmapTexture",
    "specularmapTexture",
    "transmissionmapTexture",
    "opacitymapTexture",
    "roughnessmapTexture",
    "metallicmapTexture",
    "emissionColorMapTexture",
    "emissionStrengthMapTexture",
    "subsurfaceColorMapTexture",
    "subsurfaceStrengthMapTexture",
    "litsphereTexture",
    # MPFB MHMAT_ALIAS texture-key spellings.
    "diffusemapTexture",
    "albedoTexture",
    "albedoMapTexture",
    "basecolorTexture",
    "basecolorMapTexture",
    "opacityTexture",
    "opacityMapTexture",
    "emissiveTexture",
    "emissionTexture",
    "sssTexture",
    "sssMapTexture",
)

# Fixed, canonical location label. Deliberately NOT derived from the scanned
# root: the scanner is run against both a throwaway development copy and the
# installer's `work/sources/...` root, and both must produce byte-identical
# records (the installer's `--check` drift gate depends on it).
CANONICAL_ROOT_LABEL = "work/sources/makehuman-cc0-clothes-packs-v1"

PINNED_PACKS = [
    {
        "pack": "shirts01",
        "url": "https://files.makehumancommunity.org/asset_packs/shirts01/shirts01_cc0.zip",
        "bytes": 24479483,
        "sha256": "a5a723b0e84a109bb190fcfeac7f1de4138d875da3e30fe5b3340eac9f38bcd3",
    },
    {
        "pack": "pants01",
        "url": "https://files.makehumancommunity.org/asset_packs/pants01/pants01_cc0.zip",
        "bytes": 21908723,
        "sha256": "e4e0ec60db34f279be291a83cfd7b342a7c5cf09bb7676682a5f39f4f6ac4ad9",
    },
    {
        "pack": "dress01",
        "url": "https://files.makehumancommunity.org/asset_packs/dress01/dress01_cc0.zip",
        "bytes": 46598791,
        "sha256": "f49ba54a3c93acd3c3307cc5a96cfc65daf8abfed9212a7e580791d821c9e93a",
    },
    {
        "pack": "skirts01",
        "url": "https://files.makehumancommunity.org/asset_packs/skirts01/skirts01_cc0.zip",
        "bytes": 29554534,
        "sha256": "293fa0c15e28e8dcea8dfff20cae31aa4b0d1268a6e6ba0a53a92ebb0f36c882",
    },
    {
        "pack": "shoes01",
        "url": "https://files.makehumancommunity.org/asset_packs/shoes01/shoes01_cc0.zip",
        "bytes": 82953569,
        "sha256": "ded3f70428505eabbf1f6d7b5f61196a7366ef20757103d276ad0ed336c35ada",
    },
    {
        "pack": "suits01",
        "url": "https://files.makehumancommunity.org/asset_packs/suits01/suits01_cc0.zip",
        "bytes": 42624017,
        "sha256": "2b1d8676f3863b188e9eea98c1d8f234543d54c440e791d92b819f8ee1861f19",
    },
]

_LICENCE_INFO = {
    "CC0-1.0": ("CC0 1.0 Universal", "https://creativecommons.org/publicdomain/zero/1.0/"),
    "AGPL-3.0-or-later": (
        "GNU Affero General Public License v3.0 or later",
        "https://www.gnu.org/licenses/agpl-3.0.html",
    ),
    "GPL-3.0-or-later": (
        "GNU General Public License v3.0 or later",
        "https://www.gnu.org/licenses/gpl-3.0.html",
    ),
}


def _is_number(token):
    try:
        float(token)
        return True
    except ValueError:
        return False


def read_mhclo_header(path):
    """Parse a MakeClothes ``.mhclo`` file's header comments, scale/keyword
    metadata, body-vertex correspondences and delete-vertex ranges.

    A ``verts`` block row is either the 9-field weighted correspondence
    (``v1 v2 v3 w1 w2 w3 dx dy dz``) or MakeClothes' single-index shorthand
    (a bare vertex index, an exact 1:1 match with weight 1 and zero offset —
    the same two shapes MPFB's own ``entities/clothes/mhclo.py`` recognises).
    The first row that is shaped like neither ends the block; if that leaves
    zero correspondences, a ``parseWarnings`` entry records exactly why
    rather than silently reporting a wrong ``0``/``skin`` classification.

    A header comment license is normally read from an explicit ``# license
    ...`` key. When no such key exists, the header comments are scanned for
    any line that free-form names a recognisable licence (e.g. some assets'
    only header line is an author signature like
    ``# Cortu Johnstone - CC0``); the whole matching line becomes
    ``licenceRaw``. Only when no header comment line names a licence at all
    does ``licenceRaw`` stay ``None`` (true header silence) — this is
    recorded in ``licenceStatus`` as one of ``"no-licence-line"``,
    ``"recognised"`` or ``"unrecognised"`` (an explicit ``# license`` key
    whose value ``normalise_licence`` cannot map, e.g. ``MIT`` or ``All
    rights reserved`` — never treated as silence, and its raw text is always
    preserved).
    """
    if not os.path.isfile(path):
        raise RuntimeError(f"missing .mhclo file: {path}")

    with open(path, encoding="utf-8", errors="replace") as handle:
        lines = handle.read().splitlines()

    header = {
        "author": None,
        "licenceRaw": None,
        "licenceStatus": "no-licence-line",
        "homepage": None,
        "uuid": None,
        "basemesh": None,
        "name": None,
        "tags": [],
        "objFile": None,
        "material": None,
        "xScale": None,
        "yScale": None,
        "zScale": None,
        "zDepth": None,
        "maxPole": None,
        "vertsFirst": None,
        "vertexCorrespondences": [],
        "deleteVerts": [],
        "deleteVertsPresent": False,
        "parseWarnings": [],
    }

    line_index = 0
    header_comment_lines = []
    explicit_licence_value = None
    while line_index < len(lines) and lines[line_index].strip().startswith("#"):
        body = lines[line_index].strip()[1:].strip()
        header_comment_lines.append(body)
        key, _, value = body.partition(" ")
        key = key.rstrip(":").lower()
        value = value.strip()
        if key == "author" and value:
            header["author"] = value
        elif key == "license" and value:
            explicit_licence_value = value
        elif key == "homepage" and value:
            header["homepage"] = value
        line_index += 1

    if explicit_licence_value:
        header["licenceRaw"] = explicit_licence_value
        header["licenceStatus"] = (
            "recognised" if normalise_licence(explicit_licence_value) is not None else "unrecognised"
        )
    else:
        for body in header_comment_lines:
            if normalise_licence(body) is not None:
                header["licenceRaw"] = body
                header["licenceStatus"] = "recognised"
                break

    j = line_index
    while j < len(lines):
        words = lines[j].split()
        if not words:
            j += 1
            continue
        key = words[0]
        if key == "obj_file" and len(words) > 1:
            header["objFile"] = words[1]
        elif key == "material" and len(words) > 1:
            header["material"] = words[1]
        elif key == "name" and len(words) > 1:
            header["name"] = " ".join(words[1:])
        elif key == "uuid" and len(words) > 1:
            header["uuid"] = words[1]
        elif key == "basemesh" and len(words) > 1:
            header["basemesh"] = words[1]
        elif key == "tag" and len(words) > 1:
            header["tags"].append(words[1].lower())
        elif key == "x_scale" and len(words) > 3:
            header["xScale"] = [int(words[1]), int(words[2]), float(words[3])]
        elif key == "y_scale" and len(words) > 3:
            header["yScale"] = [int(words[1]), int(words[2]), float(words[3])]
        elif key == "z_scale" and len(words) > 3:
            header["zScale"] = [int(words[1]), int(words[2]), float(words[3])]
        elif key == "z_depth" and len(words) > 1:
            header["zDepth"] = int(words[1])
        elif key == "max_pole" and len(words) > 1:
            header["maxPole"] = int(words[1])
        elif key == "verts":
            if len(words) > 1:
                header["vertsFirst"] = int(words[1])
            k = j + 1
            while k < len(lines):
                vwords = lines[k].strip().split()
                if len(vwords) == 9 and all(_is_number(w) for w in vwords):
                    v0, v1, v2 = int(vwords[0]), int(vwords[1]), int(vwords[2])
                    w0, w1, w2 = float(vwords[3]), float(vwords[4]), float(vwords[5])
                    d0, d1, d2 = float(vwords[6]), float(vwords[7]), float(vwords[8])
                    header["vertexCorrespondences"].append((v0, v1, v2, w0, w1, w2, d0, d1, d2))
                    k += 1
                elif len(vwords) == 1 and vwords[0].isdigit():
                    # MakeClothes single-index shorthand: exact 1:1 match, weight 1, zero offset.
                    v = int(vwords[0])
                    header["vertexCorrespondences"].append((v, v, v, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0))
                    k += 1
                else:
                    break
            if not header["vertexCorrespondences"]:
                stopped_on = lines[k].strip() if k < len(lines) else "<end of file>"
                header["parseWarnings"].append(
                    "verts block: no vertex-correspondence rows were found "
                    f"before parsing stopped at row {k - j!r}: {stopped_on!r}"
                )
            j = k
            continue
        elif key == "delete_verts":
            header["deleteVertsPresent"] = True
            k = j + 1
            tokens = []
            while k < len(lines):
                dwords = lines[k].strip().split()
                if not dwords or not all(w == "-" or w.lstrip("-").isdigit() for w in dwords):
                    break
                tokens.extend(dwords)
                k += 1
            # A "N - M" range's start N must not be appended both as a bare
            # token and as range(N, M+1)'s first element: look ahead for the
            # "-" before deciding whether a number is a lone index or a
            # range start, rather than appending eagerly.
            i = 0
            while i < len(tokens):
                token = tokens[i]
                if token == "-":
                    header["parseWarnings"].append(
                        "delete_verts: unexpected '-' without a preceding start value"
                    )
                    i += 1
                    continue
                value = int(token)
                if i + 1 < len(tokens) and tokens[i + 1] == "-":
                    if i + 2 < len(tokens) and tokens[i + 2].isdigit():
                        end_value = int(tokens[i + 2])
                        header["deleteVerts"].extend(range(value, end_value + 1))
                        i += 3
                    else:
                        header["parseWarnings"].append(
                            f"delete_verts: range start {value} with no following end value"
                        )
                        header["deleteVerts"].append(value)
                        i += 2
                else:
                    header["deleteVerts"].append(value)
                    i += 1
            j = k
            continue
        j += 1

    if not header["objFile"]:
        header["parseWarnings"].append("no obj_file keyword found in .mhclo header")
    if header["basemesh"] and header["basemesh"] != "hm08":
        header["parseWarnings"].append(f"unexpected basemesh {header['basemesh']!r} (expected 'hm08')")

    return header


# Creative Commons modifier tokens, in canonical SPDX ordering (NC before SA/ND).
_CC_MODIFIER_ORDER = ("nc", "sa", "nd")
_CC_MODIFIER_WORDS = {"NC": "NonCommercial", "SA": "ShareAlike", "ND": "NoDerivatives"}


def normalise_licence(text):
    """Normalise a free-text licence string to an SPDX identifier, or ``None``
    if nothing recognisable is present (the caller — see ``licenceStatus`` on
    ``read_mhclo_header`` and ``clearance_for``'s ``header_status`` — is
    responsible for not silently treating "unmappable" as "absent")."""
    if not text:
        return None
    lower = text.lower()
    if "agpl" in lower:
        return "AGPL-3.0-or-later"
    if re.search(r"cc[\s-]*0\b", lower) or re.search(r"cc[\s-]*zero", lower):
        return "CC0-1.0"
    cc_by_match = re.search(r"cc[\s-]?by\b(.*)", lower)
    if cc_by_match:
        # Scan the tokens right after "cc by" for NC/SA/ND modifiers (any
        # spelling/order, e.g. "CC-BY-NC-SA 4.0", "CC BY-SA 3.0") and an
        # optional version number; anything else ends the licence descriptor.
        modifiers = []
        version = None
        for token in re.findall(r"[a-z]+|\d+(?:\.\d+)?", cc_by_match.group(1)):
            if token in _CC_MODIFIER_ORDER:
                if token not in modifiers:
                    modifiers.append(token)
                continue
            if re.fullmatch(r"\d+(?:\.\d+)?", token):
                version = token
                break
            break
        if version is None:
            version = "4.0"
        elif "." not in version:
            version += ".0"
        ordered_modifiers = [m.upper() for m in _CC_MODIFIER_ORDER if m in modifiers]
        if ordered_modifiers:
            return f"CC-BY-{'-'.join(ordered_modifiers)}-{version}"
        return f"CC-BY-{version}"
    if "gpl" in lower:
        return "GPL-3.0-or-later"
    return None


def _cc_by_modifiers(spdx):
    """``["NC", "SA"]``-style modifier list for a ``CC-BY-...`` SPDX id."""
    if not (spdx and spdx.startswith("CC-BY-")):
        return []
    return spdx[len("CC-BY-"):].split("-")[:-1]


def _licence_name_and_url(spdx):
    if spdx in _LICENCE_INFO:
        return _LICENCE_INFO[spdx]
    if spdx and spdx.startswith("CC-BY-"):
        version = spdx.split("-")[-1]
        modifiers = _cc_by_modifiers(spdx)
        slug = "-".join(m.lower() for m in modifiers)
        if modifiers:
            name = (
                "Creative Commons Attribution-"
                + "-".join(_CC_MODIFIER_WORDS.get(m, m) for m in modifiers)
                + f" {version} International"
            )
            url = f"https://creativecommons.org/licenses/by-{slug}/{version}/"
        else:
            name = f"Creative Commons Attribution {version} International"
            url = f"https://creativecommons.org/licenses/by/{version}/"
        return (name, url)
    return ("Unrecognised", None)


def _tier(spdx):
    """Restrictiveness order used to resolve manifest/header disagreement:
    CC0 < CC-BY < CC-BY-SA/ND < CC-BY-NC* < AGPL/GPL/unrecognised."""
    if spdx == "CC0-1.0":
        return 0
    if spdx and spdx.startswith("CC-BY-"):
        modifiers = _cc_by_modifiers(spdx)
        if "NC" in modifiers:
            return 3
        if "SA" in modifiers or "ND" in modifiers:
            return 2
        return 1
    return 4


def _clearance_reason(manifest_spdx, header_spdx, header_status, header_raw, final_spdx, agreement, clearance):
    if header_status == "unrecognised":
        return (
            f"The .mhclo header declares an unrecognised licence ({header_raw!r}); treating it as the "
            f"most restrictive tier gives clearance {clearance} regardless of the pack manifest's "
            f"declared {manifest_spdx or 'unknown'}."
        )
    if agreement == "agree":
        return (
            f"The pack manifest and the .mhclo header both declare {final_spdx}; "
            f"clearance is {clearance}."
        )
    if agreement == "header-silent":
        silent_source = ".mhclo header" if header_spdx is None else "pack manifest"
        return (
            f"The {silent_source} carries no machine-readable licence declaration; "
            f"clearance follows the other source's declared {final_spdx}."
        )
    return (
        f"The pack manifest declares {manifest_spdx or 'unknown'} while the .mhclo header "
        f"declares {header_spdx or 'unknown'}; the more restrictive {final_spdx or 'unknown'} "
        f"governs, giving clearance {clearance}."
    )


def clearance_for(manifest_spdx, header_spdx, header_status="recognised", header_raw=None):
    """Resolve the pack-manifest licence and the .mhclo header licence into a
    single clearance decision, adopting the more restrictive on disagreement.

    ``header_status`` distinguishes a header that names no licence at all
    (``"no-licence-line"``, defers entirely to the manifest) from one that
    names an unmappable licence (``"unrecognised"``, e.g. ``MIT`` or ``All
    rights reserved`` — never silently cleared; forced into the same,
    most-restrictive tier as AGPL/GPL). ``header_raw`` is only used for the
    human-readable ``clearanceReason`` when the header is unrecognised."""
    header_silent = header_status == "no-licence-line"

    if header_silent and manifest_spdx is None:
        final_spdx = None
        agreement = "conflict"
    elif header_silent:
        final_spdx = manifest_spdx
        agreement = "header-silent"
    elif header_status == "unrecognised":
        # An unmappable-but-present header licence is never treated as
        # silence: it is forced through the same restrictiveness comparison
        # as a genuine conflict, checked ahead of "manifest is silent" so an
        # unrecognised header is never mislabelled as header-silent.
        agreement = "conflict"
        final_spdx = manifest_spdx if _tier(manifest_spdx) >= _tier(header_spdx) else header_spdx
    elif manifest_spdx is None:
        final_spdx = header_spdx
        agreement = "header-silent"
    elif manifest_spdx == header_spdx:
        final_spdx = manifest_spdx
        agreement = "agree"
    else:
        agreement = "conflict"
        final_spdx = manifest_spdx if _tier(manifest_spdx) >= _tier(header_spdx) else header_spdx

    name, url = _licence_name_and_url(final_spdx)
    modifiers = _cc_by_modifiers(final_spdx)
    share_alike = "SA" in modifiers
    no_derivatives = "ND" in modifiers
    non_commercial = "NC" in modifiers

    if final_spdx == "CC0-1.0":
        commercial_use = "allowed"
        attribution_required = False
        clearance = "approved"
    elif non_commercial:
        commercial_use = "restricted"
        attribution_required = True
        clearance = "rejected"
    elif final_spdx and final_spdx.startswith("CC-BY-"):
        commercial_use = "allowed"
        attribution_required = True
        clearance = "review-required"
    else:
        commercial_use = "unknown"
        attribution_required = True
        clearance = "rejected"

    return {
        "spdx": final_spdx or "unknown",
        "name": name,
        "commercialUse": commercial_use,
        "attributionRequired": attribution_required,
        "url": url,
        "shareAlike": share_alike,
        "noDerivatives": no_derivatives,
        "agreement": agreement,
        "clearance": clearance,
        "clearanceReason": _clearance_reason(
            manifest_spdx, header_spdx, header_status, header_raw, final_spdx, agreement, clearance
        ),
    }


def read_pack_manifests(root):
    """Read every ``packs/<pack>.json`` under ``root`` into ``asset -> {pack, ...fields}``."""
    packs_dir = os.path.join(root, "packs")
    if not os.path.isdir(packs_dir):
        raise RuntimeError(f"no packs/ directory found under asset root: {root}")

    result = {}
    for manifest_path in sorted(glob.glob(os.path.join(packs_dir, "*.json"))):
        pack_name = os.path.splitext(os.path.basename(manifest_path))[0]
        with open(manifest_path, encoding="utf-8") as handle:
            data = json.load(handle)
        for asset_name, fields in data.items():
            if asset_name in result:
                raise RuntimeError(
                    f"asset {asset_name!r} appears in more than one pack manifest "
                    f"({result[asset_name]['pack']} and {pack_name})"
                )
            entry = {"pack": pack_name}
            entry.update(fields)
            result[asset_name] = entry
    return result


def _sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _count_obj_vertices_and_faces(path):
    vertices = faces = 0
    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if line.startswith("v "):
                vertices += 1
            elif line.startswith("f "):
                faces += 1
    return vertices, faces


def _hash_material_textures(asset_dir, material_path):
    textures = {}
    warnings = []
    with open(material_path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            words = line.split()
            if len(words) >= 2 and words[0] in TEX_KEYS:
                texture_file = words[1]
                texture_path = os.path.join(asset_dir, texture_file)
                if os.path.isfile(texture_path):
                    textures[texture_file] = _sha256_file(texture_path)
                else:
                    warnings.append(
                        f"referenced {words[0]} {texture_file!r} does not exist on disk; skipped"
                    )
    return textures, warnings


def _fitting_summary(header, mesh_vertices, mesh_faces):
    base_vertices = set()
    for v0, v1, v2, *_rest in header["vertexCorrespondences"]:
        base_vertices.update((v0, v1, v2))

    matched_total = len(base_vertices)
    matched_skin = sum(1 for v in base_vertices if v <= SKIN_MAX_VERTEX)
    matched_helper = matched_total - matched_skin

    if matched_total == 0:
        fit_reference = None
    elif matched_helper == 0:
        fit_reference = "skin"
    elif matched_skin == 0:
        fit_reference = "helper"
    else:
        fit_reference = "mixed"

    return {
        "fitReference": fit_reference,
        "matchedBaseVertices": matched_total or None,
        "matchedSkinVertices": matched_skin if matched_total else None,
        "matchedHelperVertices": matched_helper if matched_total else None,
        "shipsDeleteGroup": header["deleteVertsPresent"],
        "deleteVertices": len(header["deleteVerts"]),
        "zDepth": header["zDepth"],
        "vertices": mesh_vertices,
        "faces": mesh_faces,
    }


def _build_asset_record(root, asset_name, manifest_fields):
    asset_dir = os.path.join(root, "clothes", asset_name)
    mhclo_path = os.path.join(asset_dir, asset_name + ".mhclo")
    header = read_mhclo_header(mhclo_path)
    parse_warnings = list(header["parseWarnings"])

    manifest_spdx = normalise_licence(manifest_fields.get("license"))
    header_spdx = normalise_licence(header["licenceRaw"])
    licence_info = clearance_for(
        manifest_spdx, header_spdx, header["licenceStatus"], header["licenceRaw"]
    )

    obj_path = os.path.join(asset_dir, header["objFile"]) if header["objFile"] else None
    mesh_vertices = mesh_faces = None
    if obj_path and os.path.isfile(obj_path):
        mesh_vertices, mesh_faces = _count_obj_vertices_and_faces(obj_path)
    elif header["objFile"]:
        parse_warnings.append(f"obj file not found: {header['objFile']!r}")

    material_path = os.path.join(asset_dir, header["material"]) if header["material"] else None
    textures = {}
    if material_path and os.path.isfile(material_path):
        textures, texture_warnings = _hash_material_textures(asset_dir, material_path)
        parse_warnings.extend(texture_warnings)
    elif header["material"]:
        parse_warnings.append(f"material file not found: {header['material']!r}")

    sha256 = {
        "mhclo": _sha256_file(mhclo_path),
        "obj": _sha256_file(obj_path) if obj_path and os.path.isfile(obj_path) else None,
        "mhmat": _sha256_file(material_path) if material_path and os.path.isfile(material_path) else None,
        "textures": textures,
    }

    original_author = manifest_fields.get("original_author") or None

    return {
        "asset": asset_name,
        "pack": manifest_fields["pack"],
        "mhcloPath": "/".join(("clothes", asset_name, asset_name + ".mhclo")),
        "sha256": sha256,
        "title": header["name"] or asset_name,
        "author": manifest_fields.get("author") or None,
        "originalAuthor": original_author,
        "category": manifest_fields.get("category") or None,
        "tags": list(header["tags"]),
        "sourceUrl": manifest_fields.get("source") or None,
        "licence": {
            "spdx": licence_info["spdx"],
            "name": licence_info["name"],
            "commercialUse": licence_info["commercialUse"],
            "attributionRequired": licence_info["attributionRequired"],
            "url": licence_info["url"],
            "shareAlike": licence_info["shareAlike"],
            "noDerivatives": licence_info["noDerivatives"],
            "packManifestLicence": manifest_spdx,
            "mhcloHeaderLicence": header_spdx,
            "mhcloHeaderLicenceRaw": header["licenceRaw"],
            "agreement": licence_info["agreement"],
        },
        "clearance": licence_info["clearance"],
        "clearanceReason": licence_info["clearanceReason"],
        "fitting": _fitting_summary(header, mesh_vertices, mesh_faces),
        "parseWarnings": parse_warnings,
    }


def build_record(root, packs_pinned):
    """Scan ``root`` (an extracted ``clothes/`` + ``packs/`` asset root) and
    build the full, deterministic licence/clearance record."""
    manifest_index = read_pack_manifests(root)

    pinned_names = {pin["pack"] for pin in packs_pinned}
    pack_assets = {pin["pack"]: [] for pin in packs_pinned}
    for asset_name, fields in manifest_index.items():
        pack_name = fields["pack"]
        if pack_name not in pinned_names:
            raise RuntimeError(
                f"asset {asset_name!r} belongs to unpinned pack {pack_name!r}; "
                "update PINNED_PACKS before regenerating the manifest"
            )
        pack_assets[pack_name].append(asset_name)

    assets = [
        _build_asset_record(root, asset_name, manifest_index[asset_name])
        for asset_name in sorted(manifest_index)
    ]

    packs = [
        {
            "pack": pin["pack"],
            "url": pin["url"],
            "bytes": pin["bytes"],
            "sha256": pin["sha256"],
            "packManifest": f"packs/{pin['pack']}.json",
            "assets": sorted(pack_assets.get(pin["pack"], [])),
        }
        for pin in packs_pinned
    ]

    approved = sum(1 for asset in assets if asset["clearance"] == "approved")
    review_required = sum(1 for asset in assets if asset["clearance"] == "review-required")
    rejected = sum(1 for asset in assets if asset["clearance"] == "rejected")

    return {
        "schemaVersion": 1,
        "id": "wardrobe.makehuman-cc0-clothes-packs",
        "version": "1.0.0",
        "basemesh": "hm08",
        "generator": "scripts/blender/mhclo_asset_manifest.py",
        "generatedFromRoot": CANONICAL_ROOT_LABEL,
        "packs": packs,
        "assets": assets,
        "summary": {
            "total": len(assets),
            "approved": approved,
            "reviewRequired": review_required,
            "rejected": rejected,
        },
    }


def load_record(path):
    if not os.path.isfile(path):
        raise RuntimeError(f"record file not found: {path}")
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _child_path(path, key):
    return f"{path}.{key}" if path else str(key)


def _walk_diff(path, generated, recorded, diffs):
    if isinstance(generated, dict) and isinstance(recorded, dict):
        for key in sorted(set(generated) | set(recorded)):
            if key not in generated:
                diffs.append(f"{_child_path(path, key)}: missing in generated record (recorded={recorded[key]!r})")
            elif key not in recorded:
                diffs.append(f"{_child_path(path, key)}: missing in recorded file (generated={generated[key]!r})")
            else:
                _walk_diff(_child_path(path, key), generated[key], recorded[key], diffs)
        return

    if isinstance(generated, list) and isinstance(recorded, list):
        if path in ("assets", "packs"):
            key_field = "asset" if path == "assets" else "pack"
            generated_index = {item.get(key_field): item for item in generated if isinstance(item, dict)}
            recorded_index = {item.get(key_field): item for item in recorded if isinstance(item, dict)}
            for name in sorted(set(generated_index) | set(recorded_index)):
                item_path = f"{path}[{key_field}={name}]"
                if name not in generated_index:
                    diffs.append(f"{item_path}: missing in generated record")
                elif name not in recorded_index:
                    diffs.append(f"{item_path}: missing in recorded file")
                else:
                    _walk_diff(item_path, generated_index[name], recorded_index[name], diffs)
            return
        if generated != recorded:
            diffs.append(f"{path}: differs (generated={generated!r} recorded={recorded!r})")
        return

    if generated != recorded:
        diffs.append(f"{path}: differs (generated={generated!r} recorded={recorded!r})")


def record_diff(a, b):
    """List every differing field between generated record ``a`` and recorded ``b``."""
    diffs = []
    _walk_diff("", a, b, diffs)
    return diffs


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("asset_root", help="extracted clothes/ + packs/ asset root")
    parser.add_argument("--write", metavar="RECORD_JSON", help="write the generated record here")
    parser.add_argument(
        "--check", metavar="RECORD_JSON", help="regenerate in memory and diff against this committed record"
    )
    args = parser.parse_args(argv)

    # Any hard failure (missing root, no packs/, an unreadable/corrupt file)
    # is an operator error, not drift: exit 2 with a clear stderr message,
    # distinct from --check's exit 1 (which is reserved for actual drift).
    try:
        root = os.path.abspath(args.asset_root)
        record = build_record(root, PINNED_PACKS)
        recorded = load_record(args.check) if args.check else None
    except (RuntimeError, OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(2)

    summary = record["summary"]

    exit_code = 0
    if args.check:
        diffs = record_diff(record, recorded)
        if diffs:
            for diff in diffs:
                print(f"MHCLO_MANIFEST_DRIFT {diff}")
            exit_code = 1

    if args.write:
        try:
            with open(args.write, "w", encoding="utf-8") as handle:
                handle.write(json.dumps(record, indent=2, ensure_ascii=False) + "\n")
        except OSError as error:
            print(f"error: {error}", file=sys.stderr)
            sys.exit(2)

    print(
        "MHCLO_MANIFEST total=%d approved=%d reviewRequired=%d rejected=%d root=%s"
        % (summary["total"], summary["approved"], summary["reviewRequired"], summary["rejected"], args.asset_root)
    )
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
