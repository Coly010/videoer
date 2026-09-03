"""Unit tests for the pure-Python (no ``bpy``) MakeHuman clothes-asset
scanner ``scripts/blender/mhclo_asset_manifest.py``.

Run with either::

    python3 scripts/blender/test_mhclo_asset_manifest.py
    python3 -m unittest scripts.blender.test_mhclo_asset_manifest

Standard library only; every fixture asset root is a throwaway
``tempfile.TemporaryDirectory()``.
"""

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mhclo_asset_manifest.py")

_spec = importlib.util.spec_from_file_location("mhclo_asset_manifest_under_test", SCRIPT_PATH)
manifest = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(manifest)


def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def write_bytes(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(data)


def make_mhclo(root, name, lines):
    path = os.path.join(root, "clothes", name, f"{name}.mhclo")
    write_text(path, "\n".join(lines) + "\n")
    return path


def sha256_of(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def populate_two_asset_root(root):
    """A synthetic ``clothes/`` + ``packs/`` root with two assets split across
    two pinned packs deliberately out of alphabetical order (``bpack`` then
    ``apack``): ``zzz_asset`` (manifest CC0, silent header -> approved) and
    ``aaa_asset`` (manifest CC-BY, header agrees CC-BY -> review-required).
    Returns the ``packs_pinned`` list to pass to ``build_record``."""
    make_mhclo(
        root,
        "aaa_asset",
        [
            "# author Aaa Author",
            "# license CC-BY",
            "name Aaa Shirt",
            "uuid aaa-uuid",
            "tag Shirt",
            "obj_file aaa_asset.obj",
            "material aaa_asset.mhmat",
        ],
    )
    write_text(
        os.path.join(root, "clothes", "aaa_asset", "aaa_asset.obj"),
        "v 0.0 0.0 0.0\nv 1.0 0.0 0.0\nv 0.0 1.0 0.0\nf 1 2 3\n",
    )
    write_text(
        os.path.join(root, "clothes", "aaa_asset", "aaa_asset.mhmat"),
        "diffuseTexture aaa_diffuse.png\n",
    )
    write_bytes(os.path.join(root, "clothes", "aaa_asset", "aaa_diffuse.png"), b"aaa-diffuse-bytes")

    make_mhclo(
        root,
        "zzz_asset",
        [
            "# author Zzz Author",
            "name Zzz Shirt",
            "uuid zzz-uuid",
            "tag Shirt",
            "tag Casual",
            "obj_file zzz_asset.obj",
            "material zzz_asset.mhmat",
        ],
    )
    write_text(
        os.path.join(root, "clothes", "zzz_asset", "zzz_asset.obj"),
        "v 0.0 0.0 0.0\nv 1.0 0.0 0.0\nv 0.0 1.0 0.0\nv 1.0 1.0 0.0\nf 1 2 3\nf 2 4 3\n",
    )
    write_text(
        os.path.join(root, "clothes", "zzz_asset", "zzz_asset.mhmat"),
        "diffuseTexture zzz_diffuse.png\n",
    )
    write_bytes(os.path.join(root, "clothes", "zzz_asset", "zzz_diffuse.png"), b"zzz-diffuse-bytes")

    write_text(
        os.path.join(root, "packs", "bpack.json"),
        json.dumps(
            {
                "zzz_asset": {
                    "license": "CC0",
                    "author": "Zzz Author",
                    "category": "tops",
                    "source": "https://example.com/zzz",
                }
            }
        ),
    )
    write_text(
        os.path.join(root, "packs", "apack.json"),
        json.dumps(
            {
                "aaa_asset": {
                    "license": "CC-BY",
                    "author": "Aaa Author",
                    "category": "tops",
                    "source": "https://example.com/aaa",
                    "original_author": "Aaa Original",
                }
            }
        ),
    )

    return [
        {"pack": "bpack", "url": "https://example.com/bpack.zip", "bytes": 111, "sha256": "b" * 64},
        {"pack": "apack", "url": "https://example.com/apack.zip", "bytes": 222, "sha256": "a" * 64},
    ]


def populate_single_pinned_asset_root(root):
    """A synthetic root using a real ``PINNED_PACKS`` pack name (``shirts01``)
    so it can be scanned through the CLI's hard-coded ``PINNED_PACKS``."""
    make_mhclo(
        root,
        "cli_test_shirt",
        [
            "# author CLI Tester",
            "name CLI Test Shirt",
            "uuid cli-uuid",
            "obj_file cli_test_shirt.obj",
            "material cli_test_shirt.mhmat",
        ],
    )
    write_text(
        os.path.join(root, "clothes", "cli_test_shirt", "cli_test_shirt.obj"),
        "v 0.0 0.0 0.0\nv 1.0 0.0 0.0\nv 0.0 1.0 0.0\nf 1 2 3\n",
    )
    write_text(
        os.path.join(root, "clothes", "cli_test_shirt", "cli_test_shirt.mhmat"),
        "diffuseTexture shirt_diffuse.png\n",
    )
    write_bytes(
        os.path.join(root, "clothes", "cli_test_shirt", "shirt_diffuse.png"), b"cli-diffuse-bytes"
    )
    write_text(
        os.path.join(root, "packs", "shirts01.json"),
        json.dumps({"cli_test_shirt": {"license": "CC0", "author": "CLI Tester"}}),
    )


class NormaliseLicenceTests(unittest.TestCase):
    def test_cc0_spellings(self):
        for text in ("CC0", "CC-0", "cc zero", "CC0-1.0"):
            with self.subTest(text=text):
                self.assertEqual(manifest.normalise_licence(text), "CC0-1.0")

    def test_cc_by_plain(self):
        cases = {
            "CC-BY": "CC-BY-4.0",
            "CC BY 4.0": "CC-BY-4.0",
            "CC-BY 3.0": "CC-BY-3.0",
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(manifest.normalise_licence(text), expected)

    def test_cc_by_modifiers(self):
        cases = {
            "CC-BY-NC 4.0": "CC-BY-NC-4.0",
            "CC BY-NC-SA 4.0": "CC-BY-NC-SA-4.0",
            "CC-BY-SA 3.0": "CC-BY-SA-3.0",
            "CC BY-ND": "CC-BY-ND-4.0",
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(manifest.normalise_licence(text), expected)

    def test_agpl_ignores_trailing_commentary(self):
        self.assertEqual(
            manifest.normalise_licence("AGPL3 (see also http://www.gnu.org/licenses/agpl-3.0.html)"),
            "AGPL-3.0-or-later",
        )

    def test_gpl(self):
        self.assertEqual(manifest.normalise_licence("GPL"), "GPL-3.0-or-later")

    def test_unrecognised_licences_return_none(self):
        for text in ("All rights reserved", "MIT", "proprietary"):
            with self.subTest(text=text):
                self.assertIsNone(manifest.normalise_licence(text))

    def test_empty_and_none_return_none(self):
        self.assertIsNone(manifest.normalise_licence(""))
        self.assertIsNone(manifest.normalise_licence(None))


class ClearanceForTests(unittest.TestCase):
    def test_both_cc0_is_approved(self):
        result = manifest.clearance_for("CC0-1.0", "CC0-1.0", "recognised", "CC0")
        self.assertEqual(result["clearance"], "approved")
        self.assertEqual(result["commercialUse"], "allowed")
        self.assertEqual(result["agreement"], "agree")
        self.assertFalse(result["attributionRequired"])
        self.assertEqual(result["spdx"], "CC0-1.0")

    def test_default_header_status_matches_explicit_recognised(self):
        defaulted = manifest.clearance_for("CC0-1.0", "CC0-1.0")
        explicit = manifest.clearance_for("CC0-1.0", "CC0-1.0", "recognised", None)
        self.assertEqual(defaulted, explicit)
        self.assertEqual(defaulted["clearance"], "approved")

    def test_manifest_cc0_with_header_silent_is_approved_via_header_silent_agreement(self):
        result = manifest.clearance_for("CC0-1.0", None, "no-licence-line", None)
        self.assertEqual(result["clearance"], "approved")
        self.assertEqual(result["agreement"], "header-silent")
        self.assertEqual(result["spdx"], "CC0-1.0")

    def test_manifest_cc_by_beats_header_cc0(self):
        result = manifest.clearance_for("CC-BY-4.0", "CC0-1.0", "recognised", "CC-0")
        self.assertEqual(result["spdx"], "CC-BY-4.0")
        self.assertEqual(result["clearance"], "review-required")
        self.assertTrue(result["attributionRequired"])
        self.assertEqual(result["agreement"], "conflict")

    def test_manifest_cc0_vs_header_agpl_is_rejected_with_unknown_commercial_use(self):
        result = manifest.clearance_for("CC0-1.0", "AGPL-3.0-or-later", "recognised", "AGPL3")
        self.assertEqual(result["clearance"], "rejected")
        self.assertEqual(result["commercialUse"], "unknown")
        self.assertEqual(result["agreement"], "conflict")
        self.assertEqual(result["spdx"], "AGPL-3.0-or-later")

    def test_unrecognised_header_raw_is_rejected_with_raw_preserved_in_reason(self):
        result = manifest.clearance_for("CC0-1.0", None, "unrecognised", "All rights reserved")
        self.assertEqual(result["clearance"], "rejected")
        self.assertEqual(result["commercialUse"], "unknown")
        self.assertEqual(result["agreement"], "conflict")
        self.assertIn("'All rights reserved'", result["clearanceReason"])

    def test_cc_by_nc_is_rejected_with_restricted_commercial_use(self):
        result = manifest.clearance_for("CC-BY-NC-4.0", "CC-BY-NC-4.0", "recognised", "CC-BY-NC 4.0")
        self.assertEqual(result["clearance"], "rejected")
        self.assertEqual(result["commercialUse"], "restricted")
        self.assertTrue(result["attributionRequired"])

    def test_cc_by_sa_is_review_required_with_share_alike_flag(self):
        result = manifest.clearance_for("CC-BY-SA-4.0", "CC-BY-SA-4.0", "recognised", "CC-BY-SA 4.0")
        self.assertEqual(result["clearance"], "review-required")
        self.assertEqual(result["commercialUse"], "allowed")
        self.assertTrue(result["shareAlike"])
        self.assertFalse(result["noDerivatives"])

    def test_cc_by_nd_sets_no_derivatives_flag(self):
        result = manifest.clearance_for("CC-BY-ND-4.0", "CC-BY-ND-4.0", "recognised", "CC-BY-ND 4.0")
        self.assertEqual(result["clearance"], "review-required")
        self.assertTrue(result["noDerivatives"])
        self.assertFalse(result["shareAlike"])

    def test_more_restrictive_manifest_wins(self):
        result = manifest.clearance_for("CC-BY-NC-4.0", "CC0-1.0", "recognised", "CC-0")
        self.assertEqual(result["spdx"], "CC-BY-NC-4.0")
        self.assertEqual(result["commercialUse"], "restricted")

    def test_more_restrictive_header_wins(self):
        result = manifest.clearance_for("CC0-1.0", "CC-BY-NC-4.0", "recognised", "CC-BY-NC 4.0")
        self.assertEqual(result["spdx"], "CC-BY-NC-4.0")
        self.assertEqual(result["commercialUse"], "restricted")

    def test_both_silent_leaves_spdx_unknown_and_conflict(self):
        result = manifest.clearance_for(None, None, "no-licence-line", None)
        self.assertEqual(result["spdx"], "unknown")
        self.assertEqual(result["agreement"], "conflict")
        self.assertEqual(result["clearance"], "rejected")
        self.assertEqual(result["commercialUse"], "unknown")


class TierAndLicenceInfoTests(unittest.TestCase):
    def test_tier_ordering(self):
        self.assertEqual(manifest._tier("CC0-1.0"), 0)
        self.assertEqual(manifest._tier("CC-BY-4.0"), 1)
        self.assertEqual(manifest._tier("CC-BY-SA-4.0"), 2)
        self.assertEqual(manifest._tier("CC-BY-ND-4.0"), 2)
        self.assertEqual(manifest._tier("CC-BY-NC-4.0"), 3)
        self.assertEqual(manifest._tier("CC-BY-NC-SA-4.0"), 3)
        self.assertEqual(manifest._tier("AGPL-3.0-or-later"), 4)
        self.assertEqual(manifest._tier(None), 4)
        self.assertEqual(manifest._tier("some-unknown-spdx"), 4)

    def test_licence_name_and_url_known_entries(self):
        self.assertEqual(
            manifest._licence_name_and_url("CC0-1.0"),
            ("CC0 1.0 Universal", "https://creativecommons.org/publicdomain/zero/1.0/"),
        )
        self.assertEqual(
            manifest._licence_name_and_url("AGPL-3.0-or-later"),
            (
                "GNU Affero General Public License v3.0 or later",
                "https://www.gnu.org/licenses/agpl-3.0.html",
            ),
        )

    def test_licence_name_and_url_cc_by_variants(self):
        self.assertEqual(
            manifest._licence_name_and_url("CC-BY-4.0"),
            ("Creative Commons Attribution 4.0 International", "https://creativecommons.org/licenses/by/4.0/"),
        )
        self.assertEqual(
            manifest._licence_name_and_url("CC-BY-SA-4.0"),
            (
                "Creative Commons Attribution-ShareAlike 4.0 International",
                "https://creativecommons.org/licenses/by-sa/4.0/",
            ),
        )
        self.assertEqual(
            manifest._licence_name_and_url("CC-BY-NC-SA-4.0"),
            (
                "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International",
                "https://creativecommons.org/licenses/by-nc-sa/4.0/",
            ),
        )

    def test_licence_name_and_url_unrecognised(self):
        self.assertEqual(manifest._licence_name_and_url(None), ("Unrecognised", None))
        self.assertEqual(manifest._licence_name_and_url("totally-unknown"), ("Unrecognised", None))


class ReadMhcloHeaderTests(unittest.TestCase):
    def test_header_comments_and_body_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = make_mhclo(
                tmp,
                "asset_a",
                [
                    "# author X",
                    "# license CC0",
                    "name Cool Shirt",
                    "uuid 1234-5678",
                    "tag Shirt",
                    "tag Casual",
                    "z_depth 50",
                    "obj_file model.obj",
                    "material model.mhmat",
                ],
            )
            header = manifest.read_mhclo_header(path)
            self.assertEqual(header["author"], "X")
            self.assertEqual(header["licenceRaw"], "CC0")
            self.assertEqual(header["licenceStatus"], "recognised")
            self.assertIsNone(header["homepage"])
            self.assertEqual(header["name"], "Cool Shirt")
            self.assertEqual(header["uuid"], "1234-5678")
            self.assertEqual(header["tags"], ["shirt", "casual"])
            self.assertEqual(header["zDepth"], 50)
            self.assertEqual(header["objFile"], "model.obj")
            self.assertEqual(header["material"], "model.mhmat")
            self.assertEqual(header["parseWarnings"], [])

    def test_freeform_signature_line_is_recognised_as_licence(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = make_mhclo(tmp, "asset_b", ["# Cortu Johnstone - CC0", "obj_file model.obj"])
            header = manifest.read_mhclo_header(path)
            self.assertEqual(header["licenceRaw"], "Cortu Johnstone - CC0")
            self.assertEqual(header["licenceStatus"], "recognised")

    def test_no_licence_line_anywhere_is_true_silence(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = make_mhclo(
                tmp,
                "asset_c",
                ["# author Jane Doe", "# homepage https://example.com", "uuid abcd", "obj_file thing.obj"],
            )
            header = manifest.read_mhclo_header(path)
            self.assertIsNone(header["licenceRaw"])
            self.assertEqual(header["licenceStatus"], "no-licence-line")

    def test_explicit_unrecognised_licence_key_preserves_raw(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = make_mhclo(tmp, "asset_d", ["# license MIT", "obj_file thing.obj"])
            header = manifest.read_mhclo_header(path)
            self.assertEqual(header["licenceRaw"], "MIT")
            self.assertEqual(header["licenceStatus"], "unrecognised")

    def test_verts_block_mixes_row_shapes_and_classifies_skin_helper_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = make_mhclo(
                tmp,
                "asset_verts_mixed",
                [
                    "obj_file model.obj",
                    "z_depth 40",
                    "verts 0",
                    "100 13379 300 0.5 0.3 0.2 0.0 0.0 0.0",
                    "13380",
                    "18000",
                ],
            )
            header = manifest.read_mhclo_header(path)
            self.assertEqual(len(header["vertexCorrespondences"]), 3)
            summary = manifest._fitting_summary(header, mesh_vertices=10, mesh_faces=5)
            self.assertEqual(summary["fitReference"], "mixed")
            self.assertEqual(summary["matchedBaseVertices"], 5)
            self.assertEqual(summary["matchedSkinVertices"], 3)
            self.assertEqual(summary["matchedHelperVertices"], 2)
            self.assertEqual(summary["zDepth"], 40)
            self.assertEqual(summary["vertices"], 10)
            self.assertEqual(summary["faces"], 5)

    def test_verts_block_all_skin_indices(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = make_mhclo(tmp, "asset_verts_skin", ["obj_file model.obj", "verts 0", "100", "13379"])
            header = manifest.read_mhclo_header(path)
            summary = manifest._fitting_summary(header, mesh_vertices=1, mesh_faces=1)
            self.assertEqual(summary["fitReference"], "skin")
            self.assertEqual(summary["matchedSkinVertices"], 2)
            self.assertEqual(summary["matchedHelperVertices"], 0)

    def test_verts_block_all_helper_indices(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = make_mhclo(tmp, "asset_verts_helper", ["obj_file model.obj", "verts 0", "13380", "18000"])
            header = manifest.read_mhclo_header(path)
            summary = manifest._fitting_summary(header, mesh_vertices=1, mesh_faces=1)
            self.assertEqual(summary["fitReference"], "helper")
            self.assertEqual(summary["matchedSkinVertices"], 0)
            self.assertEqual(summary["matchedHelperVertices"], 2)

    def test_verts_block_with_no_matching_rows_records_warning_and_none_fit_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = make_mhclo(
                tmp,
                "asset_verts_empty",
                ["obj_file model.obj", "verts 0", "not_a_number_or_digit_row here"],
            )
            header = manifest.read_mhclo_header(path)
            self.assertEqual(header["vertexCorrespondences"], [])
            self.assertIn(
                "verts block: no vertex-correspondence rows were found before parsing stopped "
                "at row 1: 'not_a_number_or_digit_row here'",
                header["parseWarnings"],
            )
            summary = manifest._fitting_summary(header, mesh_vertices=1, mesh_faces=1)
            self.assertIsNone(summary["fitReference"])
            self.assertIsNone(summary["matchedBaseVertices"])
            self.assertIsNone(summary["matchedSkinVertices"])
            self.assertIsNone(summary["matchedHelperVertices"])

    def test_delete_verts_plain_indices_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = make_mhclo(tmp, "asset_delete_plain", ["obj_file model.obj", "delete_verts", "10 11 12"])
            header = manifest.read_mhclo_header(path)
            self.assertTrue(header["deleteVertsPresent"])
            self.assertEqual(header["deleteVerts"], [10, 11, 12])

    def test_delete_verts_range_start_is_not_double_counted(self):
        """BUG in read_mhclo_header's delete_verts parser: a "N - M" range's
        start value N is appended once as a bare token (before the "-" token
        is seen) and then AGAIN as the first element of
        range(previous_value, value + 1) once the range closes, so every
        range inflates fitting.deleteVertices by one and duplicates N in
        deleteVerts. Confirmed against a real pinned asset: the extracted
        work/sources root's cortu_jeans_shorts.mhclo has 21 "-" ranges in its
        delete_verts block, and the *committed* record's
        fitting.deleteVertices for that asset is 298 -- exactly the
        de-duplicated total of 277 plus one extra per range (21). This test
        encodes the correct, non-double-counted result and is expected to
        FAIL against the current implementation; it must not be silenced."""
        with tempfile.TemporaryDirectory() as tmp:
            path = make_mhclo(
                tmp,
                "asset_delete_range",
                ["obj_file model.obj", "delete_verts", "10 11 12", "100 - 105"],
            )
            header = manifest.read_mhclo_header(path)
            self.assertTrue(header["deleteVertsPresent"])
            self.assertEqual(
                header["deleteVerts"],
                [10, 11, 12, 100, 101, 102, 103, 104, 105],
            )


class PrivateHelperTests(unittest.TestCase):
    def test_sha256_file_matches_hashlib(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "sample.bin")
            data = b"the quick brown fox jumps over the lazy dog"
            write_bytes(path, data)
            self.assertEqual(manifest._sha256_file(path), hashlib.sha256(data).hexdigest())

    def test_count_obj_vertices_and_faces(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "sample.obj")
            write_text(
                path,
                "v 0.0 0.0 0.0\nv 1.0 0.0 0.0\nv 1.0 1.0 0.0\nvt 0.0 0.0\nvn 0.0 0.0 1.0\nf 1 2 3\nf 1 3 2\n",
            )
            vertices, faces = manifest._count_obj_vertices_and_faces(path)
            self.assertEqual(vertices, 3)
            self.assertEqual(faces, 2)

    def test_hash_material_textures_hashes_present_and_warns_on_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            diffuse_data = b"diffuse-bytes"
            spec_data = b"spec-bytes"
            write_bytes(os.path.join(tmp, "diffuse.png"), diffuse_data)
            write_bytes(os.path.join(tmp, "spec.png"), spec_data)
            material_path = os.path.join(tmp, "model.mhmat")
            write_text(
                material_path,
                "diffuseTexture diffuse.png\n"
                "specularmapTexture spec.png\n"
                "bumpTexture missing_bump.png\n"
                "notaTextureKey somefile.png\n",
            )
            textures, warnings = manifest._hash_material_textures(tmp, material_path)
            self.assertEqual(
                textures,
                {
                    "diffuse.png": hashlib.sha256(diffuse_data).hexdigest(),
                    "spec.png": hashlib.sha256(spec_data).hexdigest(),
                },
            )
            self.assertEqual(
                warnings,
                ["referenced bumpTexture 'missing_bump.png' does not exist on disk; skipped"],
            )


class ReadPackManifestsTests(unittest.TestCase):
    def test_merges_multiple_pack_manifests_with_pack_field(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_text(
                os.path.join(tmp, "packs", "alpha.json"),
                json.dumps({"asset_one": {"license": "CC0"}}),
            )
            write_text(
                os.path.join(tmp, "packs", "beta.json"),
                json.dumps({"asset_two": {"license": "CC-BY"}}),
            )
            result = manifest.read_pack_manifests(tmp)
            self.assertEqual(result["asset_one"], {"pack": "alpha", "license": "CC0"})
            self.assertEqual(result["asset_two"], {"pack": "beta", "license": "CC-BY"})

    def test_missing_packs_directory_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(RuntimeError):
                manifest.read_pack_manifests(tmp)

    def test_duplicate_asset_across_packs_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_text(
                os.path.join(tmp, "packs", "alpha.json"),
                json.dumps({"shared_asset": {"license": "CC0"}}),
            )
            write_text(
                os.path.join(tmp, "packs", "beta.json"),
                json.dumps({"shared_asset": {"license": "CC-BY"}}),
            )
            with self.assertRaises(RuntimeError):
                manifest.read_pack_manifests(tmp)


class BuildRecordTests(unittest.TestCase):
    def test_summary_ordering_and_no_absolute_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            packs_pinned = populate_two_asset_root(tmp)
            record = manifest.build_record(tmp, packs_pinned)

            self.assertEqual(
                record["summary"],
                {"total": 2, "approved": 1, "reviewRequired": 1, "rejected": 0},
            )
            self.assertEqual([a["asset"] for a in record["assets"]], ["aaa_asset", "zzz_asset"])
            self.assertEqual([p["pack"] for p in record["packs"]], ["bpack", "apack"])
            self.assertEqual(record["packs"][0]["assets"], ["zzz_asset"])
            self.assertEqual(record["packs"][1]["assets"], ["aaa_asset"])
            self.assertEqual(record["generatedFromRoot"], manifest.CANONICAL_ROOT_LABEL)

            serialised = json.dumps(record)
            self.assertNotIn(tmp, serialised)

    def test_asset_clearance_and_field_wiring(self):
        with tempfile.TemporaryDirectory() as tmp:
            packs_pinned = populate_two_asset_root(tmp)
            record = manifest.build_record(tmp, packs_pinned)
            by_name = {a["asset"]: a for a in record["assets"]}

            aaa = by_name["aaa_asset"]
            self.assertEqual(aaa["clearance"], "review-required")
            self.assertEqual(aaa["mhcloPath"], "clothes/aaa_asset/aaa_asset.mhclo")
            self.assertEqual(aaa["originalAuthor"], "Aaa Original")
            self.assertEqual(aaa["parseWarnings"], [])
            self.assertEqual(
                aaa["sha256"]["mhclo"],
                sha256_of(os.path.join(tmp, "clothes", "aaa_asset", "aaa_asset.mhclo")),
            )
            self.assertEqual(
                aaa["sha256"]["obj"],
                sha256_of(os.path.join(tmp, "clothes", "aaa_asset", "aaa_asset.obj")),
            )
            self.assertEqual(
                aaa["sha256"]["mhmat"],
                sha256_of(os.path.join(tmp, "clothes", "aaa_asset", "aaa_asset.mhmat")),
            )
            self.assertEqual(
                aaa["sha256"]["textures"],
                {
                    "aaa_diffuse.png": sha256_of(
                        os.path.join(tmp, "clothes", "aaa_asset", "aaa_diffuse.png")
                    )
                },
            )

            zzz = by_name["zzz_asset"]
            self.assertEqual(zzz["clearance"], "approved")
            self.assertEqual(zzz["title"], "Zzz Shirt")
            self.assertEqual(zzz["author"], "Zzz Author")
            self.assertEqual(zzz["category"], "tops")
            self.assertEqual(zzz["sourceUrl"], "https://example.com/zzz")
            self.assertIsNone(zzz["originalAuthor"])
            self.assertEqual(zzz["tags"], ["shirt", "casual"])
            self.assertEqual(zzz["licence"]["agreement"], "header-silent")


class RecordDiffTests(unittest.TestCase):
    def _build_record(self, tmp):
        packs_pinned = populate_two_asset_root(tmp)
        return manifest.build_record(tmp, packs_pinned)

    def test_identical_record_has_no_diff(self):
        with tempfile.TemporaryDirectory() as tmp:
            record = self._build_record(tmp)
            recorded = json.loads(json.dumps(record))
            self.assertEqual(manifest.record_diff(record, recorded), [])

    def test_changed_sha256_mhclo_is_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            record = self._build_record(tmp)
            recorded = json.loads(json.dumps(record))
            for asset in recorded["assets"]:
                if asset["asset"] == "aaa_asset":
                    asset["sha256"]["mhclo"] = "0" * 64
            diffs = manifest.record_diff(record, recorded)
            self.assertTrue(
                any(d.startswith("assets[asset=aaa_asset].sha256.mhclo: differs") for d in diffs),
                diffs,
            )

    def test_changed_clearance_is_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            record = self._build_record(tmp)
            recorded = json.loads(json.dumps(record))
            for asset in recorded["assets"]:
                if asset["asset"] == "zzz_asset":
                    asset["clearance"] = "rejected"
            diffs = manifest.record_diff(record, recorded)
            self.assertTrue(
                any(d.startswith("assets[asset=zzz_asset].clearance: differs") for d in diffs),
                diffs,
            )

    def test_missing_asset_is_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            record = self._build_record(tmp)
            recorded = json.loads(json.dumps(record))
            recorded["assets"] = [a for a in recorded["assets"] if a["asset"] != "aaa_asset"]
            diffs = manifest.record_diff(record, recorded)
            self.assertIn("assets[asset=aaa_asset]: missing in recorded file", diffs)

    def test_extra_asset_is_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            record = self._build_record(tmp)
            recorded = json.loads(json.dumps(record))
            ghost = json.loads(json.dumps(recorded["assets"][0]))
            ghost["asset"] = "ghost_asset"
            recorded["assets"].append(ghost)
            diffs = manifest.record_diff(record, recorded)
            self.assertIn("assets[asset=ghost_asset]: missing in generated record", diffs)


class LoadRecordTests(unittest.TestCase):
    def test_missing_file_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(RuntimeError):
                manifest.load_record(os.path.join(tmp, "does-not-exist.json"))

    def test_round_trips_a_written_record(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "record.json")
            write_text(path, json.dumps({"schemaVersion": 1}))
            self.assertEqual(manifest.load_record(path), {"schemaVersion": 1})


class CliTests(unittest.TestCase):
    def run_cli(self, args):
        return subprocess.run(
            [sys.executable, SCRIPT_PATH, *args],
            capture_output=True,
            text=True,
        )

    def test_check_against_matching_record_exits_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            populate_single_pinned_asset_root(tmp)
            true_record = manifest.build_record(tmp, manifest.PINNED_PACKS)
            record_path = os.path.join(tmp, "record.json")
            write_text(record_path, json.dumps(true_record))

            result = self.run_cli([tmp, "--check", record_path])
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("MHCLO_MANIFEST total=1 approved=1 reviewRequired=0 rejected=0", result.stdout)
            self.assertNotIn("MHCLO_MANIFEST_DRIFT", result.stdout)

    def test_check_against_tampered_record_exits_one_with_drift_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            populate_single_pinned_asset_root(tmp)
            true_record = manifest.build_record(tmp, manifest.PINNED_PACKS)
            tampered = json.loads(json.dumps(true_record))
            for asset in tampered["assets"]:
                asset["sha256"]["mhclo"] = "0" * 64
            record_path = os.path.join(tmp, "tampered.json")
            write_text(record_path, json.dumps(tampered))

            result = self.run_cli([tmp, "--check", record_path])
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertIn(
                "MHCLO_MANIFEST_DRIFT assets[asset=cli_test_shirt].sha256.mhclo: differs",
                result.stdout,
            )

    def test_root_without_packs_directory_exits_two_with_error_on_stderr(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = self.run_cli([tmp])
            self.assertEqual(result.returncode, 2)
            self.assertIn("error: no packs/ directory found under asset root:", result.stderr)
            self.assertEqual(result.stdout, "")

    def test_corrupt_pack_manifest_json_exits_two_with_error_on_stderr(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_text(os.path.join(tmp, "packs", "shirts01.json"), "{not valid json")
            result = self.run_cli([tmp])
            self.assertEqual(result.returncode, 2)
            self.assertIn("error:", result.stderr)


if __name__ == "__main__":
    unittest.main()
