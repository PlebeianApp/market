#!/usr/bin/python3
"""Unprivileged, no-key/no-network regressions for the inert R5 controller."""

from __future__ import annotations

import importlib.util
import json
import os
import signal
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


CONTROLLER = Path(__file__).with_name("friday-fips-lab-r5.py")


def load_controller():
    specification = importlib.util.spec_from_file_location("plebeian_fips_r5_regression_target", CONTROLLER)
    if specification is None or specification.loader is None:
        raise RuntimeError("R5 controller import specification is unavailable")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


class R5Regression(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.r5 = load_controller()

    def test_phase_timeout_is_clamped_and_fail_closed(self) -> None:
        self.assertEqual(self.r5.bounded_phase_timeout(100, 1_200, 300, "prepare"), 300)
        self.assertEqual(self.r5.bounded_phase_timeout(1_150, 1_200, 300, "prepare"), 50)
        with self.assertRaisesRegex(RuntimeError, "deadline expired"):
            self.r5.bounded_phase_timeout(1_200, 1_200, 300, "prepare")
        with self.assertRaisesRegex(RuntimeError, "bound is invalid"):
            self.r5.bounded_phase_timeout(-1, 1_200, 300, "prepare")
        self.assertEqual(
            self.r5.bounded_phase_timeout(2_000, self.r5.R5_DRIVER_PHASE_DEADLINE_SECONDS, 2_700, "terminal"),
            2_199,
        )
        self.assertEqual(
            self.r5.R5_OUTER_TIMEOUT_SECONDS - self.r5.R5_DRIVER_DEADLINE_SECONDS,
            self.r5.R5_CLEANUP_BUDGET_SECONDS,
        )

    def test_reserved_outcome_is_identity_checked_and_atomically_published(self) -> None:
        with tempfile.TemporaryDirectory(prefix="plebeian-r5-evidence.") as directory_text:
            directory = Path(directory_text)
            directory.chmod(0o700)
            pending = directory / "outcome.pending"
            result = directory / "outcome.json"
            descriptor, identity = self.r5.reserve_outcome_descriptor(
                directory, pending, result, owner_uid=os.getuid(), owner_gid=os.getgid(),
            )
            try:
                self.r5.persist_reserved_outcome_descriptor(
                    directory, pending, result, descriptor, identity,
                    owner_uid=os.getuid(), owner_gid=os.getgid(),
                    value={"schema": "R5_TEST", "success": True},
                )
            finally:
                os.close(descriptor)
            self.assertFalse(pending.exists())
            self.assertEqual(json.loads(result.read_text(encoding="utf-8")), {
                "schema": "R5_TEST", "success": True,
            })

    def test_preexisting_outcome_refuses_before_reservation(self) -> None:
        with tempfile.TemporaryDirectory(prefix="plebeian-r5-existing.") as directory_text:
            directory = Path(directory_text)
            directory.chmod(0o700)
            pending = directory / "outcome.pending"
            result = directory / "outcome.json"
            result.write_text("unrelated\n", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "already exists"):
                self.r5.reserve_outcome_descriptor(
                    directory, pending, result, owner_uid=os.getuid(), owner_gid=os.getgid(),
                )
            self.assertEqual(result.read_text(encoding="utf-8"), "unrelated\n")

    def test_replaced_pending_inode_refuses_without_deleting_replacement(self) -> None:
        with tempfile.TemporaryDirectory(prefix="plebeian-r5-replaced.") as directory_text:
            directory = Path(directory_text)
            directory.chmod(0o700)
            pending = directory / "outcome.pending"
            result = directory / "outcome.json"
            descriptor, identity = self.r5.reserve_outcome_descriptor(
                directory, pending, result, owner_uid=os.getuid(), owner_gid=os.getgid(),
            )
            pending.unlink()
            pending.write_text("replacement\n", encoding="utf-8")
            pending.chmod(0o600)
            try:
                with self.assertRaisesRegex(RuntimeError, "identity changed"):
                    self.r5.persist_reserved_outcome_descriptor(
                        directory, pending, result, descriptor, identity,
                        owner_uid=os.getuid(), owner_gid=os.getgid(), value={"schema": "R5_TEST"},
                    )
            finally:
                os.close(descriptor)
            self.assertEqual(pending.read_text(encoding="utf-8"), "replacement\n")
            self.assertFalse(result.exists())

    def test_result_created_after_reservation_refuses_without_overwrite(self) -> None:
        with tempfile.TemporaryDirectory(prefix="plebeian-r5-result-race.") as directory_text:
            directory = Path(directory_text)
            directory.chmod(0o700)
            pending = directory / "outcome.pending"
            result = directory / "outcome.json"
            descriptor, identity = self.r5.reserve_outcome_descriptor(
                directory, pending, result, owner_uid=os.getuid(), owner_gid=os.getgid(),
            )
            result.write_text("unrelated\n", encoding="utf-8")
            try:
                with self.assertRaisesRegex(RuntimeError, "identity changed"):
                    self.r5.persist_reserved_outcome_descriptor(
                        directory, pending, result, descriptor, identity,
                        owner_uid=os.getuid(), owner_gid=os.getgid(), value={"schema": "R5_TEST"},
                    )
            finally:
                os.close(descriptor)
            self.assertEqual(result.read_text(encoding="utf-8"), "unrelated\n")
            self.assertTrue(pending.exists())

    def test_signal_is_delivered_only_after_reservation_is_registered(self) -> None:
        with tempfile.TemporaryDirectory(prefix="plebeian-r5-signal.") as directory_text:
            directory = Path(directory_text)
            directory.chmod(0o700)
            pending = directory / "outcome.pending"
            result = directory / "outcome.json"
            observed: list[tuple[int | None, bool]] = []
            prior_handler = signal.signal(
                signal.SIGTERM,
                lambda _signum, _frame: observed.append((self.r5._outcome_descriptor, pending.exists())),
            )
            original_reserve = self.r5.reserve_outcome_descriptor

            def reserve_with_pending_signal(*args, **kwargs):
                reservation = original_reserve(*args, **kwargs)
                os.kill(os.getpid(), signal.SIGTERM)
                return reservation

            self.r5._outcome_descriptor = None
            self.r5._evidence_directory_identity = None
            self.r5._phase_zero = None
            try:
                with patch.object(self.r5, "EVIDENCE_ROOT", directory), \
                        patch.object(self.r5, "EVIDENCE_PENDING", pending), \
                        patch.object(self.r5, "EVIDENCE_RESULT", result), \
                        patch.object(self.r5, "reserve_outcome_descriptor", reserve_with_pending_signal):
                    self.r5.register_outcome_reservation()
                self.assertEqual(len(observed), 1)
                self.assertEqual(observed[0], (self.r5._outcome_descriptor, True))
                self.assertIsNotNone(self.r5._phase_zero)
            finally:
                signal.signal(signal.SIGTERM, prior_handler)
                if self.r5._outcome_descriptor is not None:
                    os.close(self.r5._outcome_descriptor)
                self.r5._outcome_descriptor = None
                self.r5._evidence_directory_identity = None
                self.r5._phase_zero = None

    def test_long_lived_child_is_registered_before_pending_signal_delivery(self) -> None:
        with tempfile.TemporaryDirectory(prefix="plebeian-r5-owned.") as directory_text:
            run_root = Path(directory_text)
            (run_root / "node-1").mkdir(mode=0o700)
            observed: list[tuple[int, int]] = []
            prior_handler = signal.signal(
                signal.SIGTERM,
                lambda _signum, _frame: observed.append((
                    self.r5._registered_owned[0].process.pid,
                    len(self.r5.merged_owned_for_cleanup([])),
                )),
            )
            original_namespace_inode = self.r5.base.namespace_inode

            def namespace_with_pending_signal(pid):
                inode = original_namespace_inode(pid)
                # Inject after Popen but before OwnedProcess construction and
                # global registration. Delivery must remain pending until the
                # child has become cleanup-visible.
                os.kill(os.getpid(), signal.SIGTERM)
                return inode

            self.r5._registered_owned.clear()
            item = None
            try:
                with patch.object(self.r5, "RUN_ROOT", run_root), \
                        patch.object(self.r5.base, "dropped_argv", lambda executable, arguments, **_kwargs: [executable, *arguments]), \
                        patch.object(self.r5.base, "namespace_inode", namespace_with_pending_signal), \
                        patch.object(self.r5.base, "verify_owned_process", lambda _item: None):
                    item = self.r5.start_owned_r5("probe", 1, "/usr/bin/sleep", ["30"])
                self.assertEqual(observed, [(item.process.pid, 1)])
                self.assertEqual(self.r5.merged_owned_for_cleanup([]), [item])
                self.assertEqual(self.r5.merged_owned_for_cleanup([item]), [item])
            finally:
                signal.signal(signal.SIGTERM, prior_handler)
                if item is not None:
                    self.r5.base.stop_owned(item, 1)
                self.r5._registered_owned.clear()


if __name__ == "__main__":
    unittest.main()
