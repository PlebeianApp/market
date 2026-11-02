from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("friday-fips-identity-promote.py")
SPEC = importlib.util.spec_from_file_location("friday_fips_identity_promote", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class FridayFipsIdentityPromoteTests(unittest.TestCase):
    def fixture(self) -> tuple[Path, Path, Path, MODULE.PromotionPolicy]:
        temporary = tempfile.TemporaryDirectory(prefix="friday-fips-promote-test-")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        lock_parent = root / "run-lock"
        fips_parent = root / "fips"
        staging = fips_parent / "identity.staging.friday-demo-r13-test"
        lock_parent.mkdir(mode=0o700)
        fips_parent.mkdir(mode=0o700)
        staging.mkdir(mode=0o700)
        key = staging / "fips.key"
        public = staging / "fips.pub"
        key.write_bytes(b"dummy-private-test-material\n")
        public.write_bytes(b"dummy-public-test-material\n")
        key.chmod(0o600)
        public.chmod(0o640)
        policy = MODULE.PromotionPolicy(
            fips_parent=fips_parent,
            final_name=MODULE.FINAL_NAME,
            lock_path=lock_parent / "fips-identity-promotion.lock",
            root_uid=os.getuid(),
            root_gid=os.getgid(),
            service_uid=os.getuid(),
            service_gid=os.getgid(),
            require_root_process=False,
        )
        return root, fips_parent, staging, policy

    def assert_failure_preserved(self, fips_parent: Path, staging: Path, policy: MODULE.PromotionPolicy) -> None:
        self.assertTrue(staging.is_dir())
        self.assertTrue((staging / "fips.key").is_file())
        self.assertTrue(policy.lock_path.is_file())
        self.assertFalse((fips_parent / MODULE.FINAL_NAME).exists())

    def test_success_is_no_replace_durable_and_silent(self) -> None:
        _, fips_parent, staging, policy = self.fixture()
        before = staging.stat()
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(MODULE.os, "fsync", wraps=os.fsync) as sync, \
                contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            promoted_identity = MODULE.promote_identity(staging, policy)
        final = fips_parent / MODULE.FINAL_NAME
        self.assertEqual(promoted_identity, (before.st_dev, before.st_ino))
        self.assertFalse(staging.exists())
        self.assertTrue(final.is_dir())
        self.assertEqual((final / "fips.key").read_bytes(), b"dummy-private-test-material\n")
        self.assertEqual((final / "fips.pub").read_bytes(), b"dummy-public-test-material\n")
        self.assertFalse(policy.lock_path.exists())
        self.assertGreaterEqual(sync.call_count, 9)
        self.assertEqual(output.getvalue(), "")
        self.assertEqual(errors.getvalue(), "")

    def test_existing_destination_preserves_source_destination_and_lock(self) -> None:
        _, fips_parent, staging, policy = self.fixture()
        final = fips_parent / MODULE.FINAL_NAME
        final.mkdir(mode=0o700)
        marker = final / "existing"
        marker.write_bytes(b"existing-destination")
        with self.assertRaisesRegex(MODULE.PromotionRefusal, "already exists"):
            MODULE.promote_identity(staging, policy)
        self.assertTrue(staging.is_dir())
        self.assertEqual(marker.read_bytes(), b"existing-destination")
        self.assertTrue(policy.lock_path.is_file())

    def test_destination_race_is_atomic_noreplace(self) -> None:
        _, fips_parent, staging, policy = self.fixture()
        final = fips_parent / MODULE.FINAL_NAME

        def race(phase: str) -> None:
            if phase == "before_rename":
                final.mkdir(mode=0o700)
                (final / "racer").write_bytes(b"racer")

        with self.assertRaisesRegex(MODULE.PromotionRefusal, "appeared"):
            MODULE.promote_identity(staging, policy, race)
        self.assertTrue(staging.is_dir())
        self.assertEqual((final / "racer").read_bytes(), b"racer")
        self.assertTrue(policy.lock_path.is_file())

    def test_symlink_staging_file_and_lock_parent_are_rejected(self) -> None:
        with self.subTest("staging"):
            _, fips_parent, staging, policy = self.fixture()
            real = fips_parent / "real-staging"
            staging.rename(real)
            staging.symlink_to(real, target_is_directory=True)
            with self.assertRaises(MODULE.PromotionRefusal):
                MODULE.promote_identity(staging, policy)
            self.assertTrue(staging.is_symlink())
            self.assertTrue(real.is_dir())
            self.assertTrue(policy.lock_path.is_file())

        with self.subTest("identity-file"):
            root, fips_parent, staging, policy = self.fixture()
            outside = root / "outside-public"
            outside.write_bytes(b"dummy-outside-public")
            (staging / "fips.pub").unlink()
            (staging / "fips.pub").symlink_to(outside)
            with self.assertRaises(MODULE.PromotionRefusal):
                MODULE.promote_identity(staging, policy)
            self.assertTrue((staging / "fips.pub").is_symlink())
            self.assertEqual(outside.read_bytes(), b"dummy-outside-public")
            self.assertTrue(policy.lock_path.is_file())
            self.assertFalse((fips_parent / MODULE.FINAL_NAME).exists())

        with self.subTest("lock-parent"):
            root, fips_parent, staging, policy = self.fixture()
            real_lock_parent = policy.lock_path.parent.with_name("real-lock-parent")
            policy.lock_path.parent.rename(real_lock_parent)
            policy.lock_path.parent.symlink_to(real_lock_parent, target_is_directory=True)
            with self.assertRaises(MODULE.PromotionRefusal):
                MODULE.promote_identity(staging, policy)
            self.assertTrue(staging.is_dir())
            self.assertFalse((fips_parent / MODULE.FINAL_NAME).exists())
            self.assertEqual(list(real_lock_parent.iterdir()), [])
            self.assertTrue(root.is_dir())

    def test_wrong_ownership_and_modes_fail_before_rename(self) -> None:
        cases = ("lock-mode", "parent-mode", "staging-mode", "key-mode", "public-mode", "service-owner")
        for case in cases:
            with self.subTest(case):
                _, fips_parent, staging, policy = self.fixture()
                if case == "lock-mode":
                    policy.lock_path.parent.chmod(0o770)
                elif case == "parent-mode":
                    fips_parent.chmod(0o750)
                elif case == "staging-mode":
                    staging.chmod(0o750)
                elif case == "key-mode":
                    (staging / "fips.key").chmod(0o640)
                elif case == "public-mode":
                    (staging / "fips.pub").chmod(0o660)
                else:
                    policy = MODULE.PromotionPolicy(
                        **{**policy.__dict__, "service_uid": policy.service_uid + 1},
                    )
                with self.assertRaises(MODULE.PromotionRefusal):
                    MODULE.promote_identity(staging, policy)
                self.assertTrue(staging.is_dir())
                self.assertFalse((fips_parent / MODULE.FINAL_NAME).exists())
                if case != "lock-mode":
                    self.assertTrue(policy.lock_path.is_file())

    def test_interruption_preserves_private_state_and_lock_at_each_boundary(self) -> None:
        for boundary, source_exists, final_exists in (
                ("staging_fsynced", True, False),
                ("after_rename", False, True),
                ("promotion_fsynced", False, True)):
            with self.subTest(boundary):
                _, fips_parent, staging, policy = self.fixture()

                def interrupt(phase: str) -> None:
                    if phase == boundary:
                        raise MODULE.PromotionInterrupted(boundary)

                with self.assertRaises(MODULE.PromotionInterrupted):
                    MODULE.promote_identity(staging, policy, interrupt)
                self.assertEqual(staging.exists(), source_exists)
                self.assertEqual((fips_parent / MODULE.FINAL_NAME).exists(), final_exists)
                self.assertTrue(policy.lock_path.is_file())
                identity = staging if source_exists else fips_parent / MODULE.FINAL_NAME
                self.assertTrue((identity / "fips.key").is_file())
                self.assertTrue((identity / "fips.pub").is_file())

    def test_post_rename_inode_substitution_is_detected_without_cleanup(self) -> None:
        with self.subTest("directory"):
            _, fips_parent, staging, policy = self.fixture()
            final = fips_parent / MODULE.FINAL_NAME
            saved = fips_parent / "identity.saved-by-test-racer"

            def substitute_directory(phase: str) -> None:
                if phase == "after_rename":
                    final.rename(saved)
                    final.mkdir(mode=0o700)

            with self.assertRaisesRegex(MODULE.PromotionRefusal, "inode differs"):
                MODULE.promote_identity(staging, policy, substitute_directory)
            self.assertTrue(saved.is_dir())
            self.assertTrue((saved / "fips.key").is_file())
            self.assertTrue(final.is_dir())
            self.assertTrue(policy.lock_path.is_file())

        with self.subTest("identity-file"):
            _, fips_parent, staging, policy = self.fixture()
            final = fips_parent / MODULE.FINAL_NAME
            saved_public = fips_parent / "fips.pub.saved-by-test-racer"

            def substitute_file(phase: str) -> None:
                if phase == "after_rename":
                    (final / "fips.pub").rename(saved_public)
                    (final / "fips.pub").write_bytes(b"dummy-substitute-public\n")
                    (final / "fips.pub").chmod(0o640)

            with self.assertRaisesRegex(MODULE.PromotionRefusal, "file inode differs"):
                MODULE.promote_identity(staging, policy, substitute_file)
            self.assertTrue(final.is_dir())
            self.assertTrue((final / "fips.key").is_file())
            self.assertTrue((final / "fips.pub").is_file())
            self.assertTrue(saved_public.is_file())
            self.assertTrue(policy.lock_path.is_file())

    def test_existing_lock_is_never_followed_or_removed(self) -> None:
        root, fips_parent, staging, policy = self.fixture()
        target = root / "lock-target"
        target.write_bytes(b"do-not-touch")
        policy.lock_path.symlink_to(target)
        with self.assertRaisesRegex(MODULE.PromotionRefusal, "already exists"):
            MODULE.promote_identity(staging, policy)
        self.assertTrue(staging.is_dir())
        self.assertFalse((fips_parent / MODULE.FINAL_NAME).exists())
        self.assertTrue(policy.lock_path.is_symlink())
        self.assertEqual(target.read_bytes(), b"do-not-touch")


if __name__ == "__main__":
    unittest.main()
