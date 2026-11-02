#!/usr/bin/python3
"""Unprivileged tests for the fixed service-owned public-input writer."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock


SOURCE = Path(__file__).with_name("friday-r20-public-input-writer.py")
SPEC = importlib.util.spec_from_file_location("friday_r20_public_input_writer", SOURCE)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def bundle() -> bytes:
    manifest = {"schema": "PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_MANIFEST_V1", "roster": [1, 2, 3, 4]}
    digest = "11" * 32
    bound = {
        "schema": MODULE.BOUND_SCHEMA,
        "profileDigest": "22" * 32,
        "predecessorAbortDigest": "33" * 32,
        "manifest": manifest,
        "manifestDigest": digest,
        "bindingDigest": "44" * 32,
    }
    return (json.dumps({"schema": MODULE.SCHEMA, "manifest": manifest,
                        "manifestDigest": digest, "boundManifest": bound},
                       sort_keys=True, separators=(",", ":")) + "\n").encode()


def pre_enrollment_bundle() -> bytes:
    return (json.dumps({
        "schema": MODULE.PRE_ENROLLMENT_SCHEMA,
        "hostPin": {"schema": "HOST_PIN"},
        "freshProfile": {"schema": "FRESH_PROFILE"},
        "predecessorManifest": {"schema": "PREDECESSOR_MANIFEST"},
    }, sort_keys=True, separators=(",", ":")) + "\n").encode()


class PublicInputWriterTests(unittest.TestCase):
    def layout(self, root: Path) -> tuple[Path, Path, Path]:
        fresh = root / MODULE.FRESH_PARENT_NAME
        inputs = fresh / MODULE.INPUT_ROOT_NAME
        keyset = fresh / MODULE.KEYSET_ROOT_NAME
        root.chmod(0o755)
        fresh.mkdir(mode=0o700); inputs.mkdir(mode=0o700); keyset.mkdir(mode=0o700)
        return fresh, inputs, keyset

    def run_provision(self, root: Path, raw: bytes) -> None:
        MODULE.provision(raw, hashlib.sha256(raw).hexdigest(), state_root=root,
                         state_root_uid=os.geteuid())

    def test_writes_fixed_create_once_service_owned_inputs(self) -> None:
        if os.geteuid() == 0:
            self.skipTest("unprivileged service-writer test must not run as root")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); _, inputs, keyset = self.layout(root); raw = bundle()
            self.run_provision(root, raw)
            manifest = keyset / MODULE.MANIFEST_NAME
            digest = keyset / MODULE.MANIFEST_DIGEST_NAME
            bound = inputs / MODULE.BOUND_MANIFEST_NAME
            self.assertEqual(digest.read_bytes(), ("11" * 32 + "\n").encode())
            self.assertEqual(stat.S_IMODE(manifest.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(digest.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(bound.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(manifest.stat().st_mode) & 0o022, 0)
            with self.assertRaises(FileExistsError):
                self.run_provision(root, raw)

    def test_pre_enrollment_writer_needs_no_keyset_and_root_creates_no_entry(self) -> None:
        if os.geteuid() == 0:
            self.skipTest("unprivileged service-writer test must not run as root")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); fresh, inputs, keyset = self.layout(root); keyset.rmdir()
            raw = pre_enrollment_bundle()
            MODULE.provision_pre_enrollment(raw, hashlib.sha256(raw).hexdigest(), state_root=root,
                                            state_root_uid=os.geteuid())
            self.assertEqual((fresh / MODULE.HOST_PIN_NAME).stat().st_uid, os.geteuid())
            self.assertEqual(stat.S_IMODE((fresh / MODULE.HOST_PIN_NAME).stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE((inputs / MODULE.FRESH_PROFILE_NAME).stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE((inputs / MODULE.PREDECESSOR_MANIFEST_NAME).stat().st_mode), 0o600)
            self.assertFalse(keyset.exists())

    def test_rejects_hash_digest_and_bound_manifest_mismatch(self) -> None:
        raw = bundle()
        with self.assertRaises(MODULE.ProvisioningError):
            MODULE.parse_bundle(raw, "00" * 32)
        value = json.loads(raw)
        value["manifestDigest"] = "not-hex"
        changed = (json.dumps(value) + "\n").encode()
        with self.assertRaises(MODULE.ProvisioningError):
            MODULE.parse_bundle(changed, hashlib.sha256(changed).hexdigest())

    def test_root_identity_cannot_be_overridden_and_stops_before_parsing(self) -> None:
        raw = bundle()
        with self.assertRaises(TypeError):
            MODULE.provision(raw, hashlib.sha256(raw).hexdigest(), service_uid=1)
        with mock.patch.object(MODULE.os, "geteuid", return_value=0):
            with self.assertRaisesRegex(MODULE.ProvisioningError, "root must not write"):
                MODULE.provision(b"not-json", "00" * 32)
            with self.assertRaisesRegex(MODULE.ProvisioningError, "root must not write"):
                MODULE.provision_pre_enrollment(b"not-json", "00" * 32)
        value = json.loads(raw); value["boundManifest"]["manifest"] = {"different": True}
        changed = (json.dumps(value) + "\n").encode()
        with self.assertRaises(MODULE.ProvisioningError):
            MODULE.parse_bundle(changed, hashlib.sha256(changed).hexdigest())

    def test_rejects_symlinked_service_directory(self) -> None:
        if os.geteuid() == 0:
            self.skipTest("unprivileged service-writer test must not run as root")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); actual = root / "actual"; actual.mkdir(mode=0o700)
            (root / MODULE.FRESH_PARENT_NAME).symlink_to(actual, target_is_directory=True)
            raw = bundle()
            with self.assertRaises(OSError):
                self.run_provision(root, raw)

    def test_rejects_wrong_modes_before_any_file_creation(self) -> None:
        if os.geteuid() == 0:
            self.skipTest("unprivileged service-writer test must not run as root")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); fresh, inputs, keyset = self.layout(root)
            fresh.chmod(0o711); raw = bundle()
            with self.assertRaises(MODULE.ProvisioningError):
                self.run_provision(root, raw)
            self.assertEqual(list(inputs.iterdir()), [])
            self.assertEqual(list(keyset.iterdir()), [])

    def test_production_paths_are_disjoint_from_sealed_r18(self) -> None:
        fresh = MODULE.STATE_ROOT / MODULE.FRESH_PARENT_NAME
        keyset = fresh / MODULE.KEYSET_ROOT_NAME
        sealed = MODULE.STATE_ROOT / "frost/keyset-v1"
        self.assertNotEqual(fresh, sealed.parent)
        self.assertNotEqual(keyset, sealed)
        self.assertEqual(str(keyset), "/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2")

    def test_source_uses_dirfd_exclusive_nofollow_and_fsync(self) -> None:
        source = SOURCE.read_text(encoding="utf-8")
        for required in ("dir_fd=", "os.O_EXCL", "O_NOFOLLOW", "os.fsync", "uid == 0"):
            self.assertIn(required, source)


if __name__ == "__main__":
    unittest.main()
