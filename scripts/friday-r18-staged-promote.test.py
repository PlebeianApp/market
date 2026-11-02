#!/usr/bin/python3

from __future__ import annotations

import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("friday-r18-staged-promote.py")
SPEC = importlib.util.spec_from_file_location("friday_r18_staged_promote", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


class PromotionTest(unittest.TestCase):
    def profile(self, root: Path, *, retained: bool = False):
        uid = os.getuid()
        gid = os.getgid()
        action = root / "action"
        binary_parent = root / "opt"
        binary = binary_parent / "bin"
        keyset = root / "keyset"
        action.mkdir(mode=0o700)
        binary_parent.mkdir(mode=0o755)
        keyset.mkdir(mode=0o700)
        executable = b"fixed executable\n"
        manifest = b'{"fixed":true}\n'
        artifacts = (
            MODULE.Artifact("host", "host-final", digest(executable), len(executable), 0, 0, 0o755),
            MODULE.Artifact("manifest.json", "manifest-final", digest(manifest), len(manifest), 997, 986, 0o600),
        )
        (action / "host").write_bytes(executable)
        (action / "host").chmod(0o755)
        (action / "manifest.json").write_bytes(manifest)
        (action / "manifest.json").chmod(0o644)
        retained_artifact = None
        if retained:
            binary.mkdir(mode=0o755)
            retained_bytes = b"fixed retained\n"
            retained_artifact = MODULE.Artifact(
                "retained", "retained", digest(retained_bytes), len(retained_bytes), 0, 0, 0o755
            )
            (binary / "retained").write_bytes(retained_bytes)
            (binary / "retained").chmod(0o755)
        return MODULE.Profile(
            slot=2 if retained else 1,
            action_root=str(action),
            binary_root=str(binary),
            keyset_root=str(keyset),
            root_uid=uid,
            root_gid=gid,
            service_uid=uid,
            service_gid=gid,
            artifacts=artifacts,
            retained_inspector=retained_artifact,
        )

    def run_promote(self, profile):
        with patch.object(MODULE, "_protected_root_chain", return_value=None):
            return MODULE.promote(profile, "a" * 64, "b" * 64)

    def test_creates_missing_bin_and_exact_destinations_once(self):
        with tempfile.TemporaryDirectory() as temporary:
            profile = self.profile(Path(temporary))
            result = self.run_promote(profile)
            self.assertEqual(result["slot"], 1)
            self.assertEqual((Path(profile.binary_root) / "host-final").read_bytes(), b"fixed executable\n")
            self.assertEqual((Path(profile.keyset_root) / "manifest-final").read_bytes(), b'{"fixed":true}\n')
            self.assertEqual(stat.S_IMODE(os.stat(profile.binary_root).st_mode), 0o755)
            self.assertEqual(stat.S_IMODE(os.stat(Path(profile.keyset_root) / "manifest-final").st_mode), 0o600)
            self.assertTrue((Path(profile.action_root) / "promotion-amendment-r1.claim.json").is_file())
            self.assertTrue((Path(profile.action_root) / "promotion-amendment-r1.complete.json").is_file())
            with self.assertRaises(MODULE.Refusal):
                self.run_promote(profile)

    def test_retains_exact_existing_inspector(self):
        with tempfile.TemporaryDirectory() as temporary:
            profile = self.profile(Path(temporary), retained=True)
            before = (Path(profile.binary_root) / "retained").stat().st_ino
            self.run_promote(profile)
            self.assertEqual((Path(profile.binary_root) / "retained").stat().st_ino, before)

    def test_bad_staged_hash_refuses_before_claim_or_bin(self):
        with tempfile.TemporaryDirectory() as temporary:
            profile = self.profile(Path(temporary))
            (Path(profile.action_root) / "host").write_bytes(b"mutated executable\n")
            (Path(profile.action_root) / "host").chmod(0o755)
            with self.assertRaises(MODULE.Refusal):
                self.run_promote(profile)
            self.assertFalse(Path(profile.binary_root).exists())
            self.assertFalse((Path(profile.action_root) / "promotion-amendment-r1.claim.json").exists())

    def test_unexpected_entry_refuses_before_claim(self):
        with tempfile.TemporaryDirectory() as temporary:
            profile = self.profile(Path(temporary))
            (Path(profile.action_root) / "unexpected").write_text("stop", encoding="utf-8")
            with self.assertRaises(MODULE.Refusal):
                self.run_promote(profile)
            self.assertFalse((Path(profile.action_root) / "promotion-amendment-r1.claim.json").exists())

    def test_preexisting_bin_refuses_for_new_bin_host(self):
        with tempfile.TemporaryDirectory() as temporary:
            profile = self.profile(Path(temporary))
            Path(profile.binary_root).mkdir(mode=0o755)
            with self.assertRaises(MODULE.Refusal):
                self.run_promote(profile)
            self.assertFalse((Path(profile.action_root) / "promotion-amendment-r1.claim.json").exists())


if __name__ == "__main__":
    unittest.main()
