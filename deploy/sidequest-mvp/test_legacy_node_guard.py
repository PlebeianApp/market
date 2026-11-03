#!/usr/bin/env python3
"""Focused tests for successor-compatible observer/validator guarding."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
GUARD = HERE / "verify-sidequest-legacy-node-target.py"
BASE = ROOT / "deploy/friday/separated/verify-friday-separated-target.py"
RUNTIME = ROOT / "deploy/friday/verify-friday-runtime-target.py"
OBSERVER = HERE / "plebeian-friday-observer-successor-guard.service"
VALIDATOR = HERE / "plebeian-friday-validator-successor-guard.service"
PREDECESSOR_OBSERVER = ROOT / "deploy/friday/separated/plebeian-friday-observer.service"
PREDECESSOR_VALIDATOR = ROOT / "deploy/friday/separated/plebeian-friday-validator.service"
LEGACY_NODE = Path(
    "/home/maximoto/Documents/Codex/2026-10-28/task-4/"
    "separated-build-final-r4/attempts/b2-r1/artifacts/plebeian-auctions-poc"
)
OLD_GUARD = (
    "/opt/plebeian-auctions-friday/releases/separated-deploy-v1/"
    "bin/verify-friday-separated-target.py"
)
NEW_GUARD = (
    "/opt/plebeian-auctions-friday/releases/"
    "sidequest-mvp-r4-legacy-node-guard-v1/bin/verify-friday-separated-target.py"
)


def load_guard():
    spec = importlib.util.spec_from_file_location("legacy_node_guard", GUARD)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


class LegacyNodeGuardFixture(unittest.TestCase):
    def test_units_change_only_guard_invocation(self) -> None:
        self.assertEqual(
            OBSERVER.read_text(),
            PREDECESSOR_OBSERVER.read_text().replace(OLD_GUARD, NEW_GUARD),
        )
        self.assertEqual(
            VALIDATOR.read_text(),
            PREDECESSOR_VALIDATOR.read_text().replace(OLD_GUARD, NEW_GUARD),
        )
        for unit in (OBSERVER, VALIDATOR):
            text = unit.read_text()
            self.assertEqual(text.count(NEW_GUARD), 1)
            self.assertIn(
                "/releases/separated-deploy-v1/bin/plebeian-auctions-poc",
                text,
            )

    def test_guard_maps_legacy_binary_and_successor_terminal_executor(self) -> None:
        module = load_guard()
        with tempfile.TemporaryDirectory(prefix="legacy-node-guard-", dir="/tmp") as value:
            root = Path(value)
            guard_release = root / "guard"
            application_release = root / "application"
            predecessor_release = root / "predecessor"
            (guard_release / "bin").mkdir(parents=True)
            (application_release / "bin").mkdir(parents=True)
            (predecessor_release / "bin").mkdir(parents=True)
            shutil.copyfile(BASE, guard_release / "bin/verify-friday-separated-base.py")
            shutil.copyfile(RUNTIME, guard_release / "bin/verify-friday-runtime-target.py")
            shutil.copyfile(GUARD, guard_release / "bin/verify-friday-separated-target.py")
            shutil.copyfile(LEGACY_NODE, predecessor_release / "bin/plebeian-auctions-poc")
            for path in (guard_release / "bin").iterdir():
                path.chmod(0o755)
            (predecessor_release / "bin/plebeian-auctions-poc").chmod(0o755)

            namespace = module.load_base_guard(
                guard_release, application_release, predecessor_release
            )
            target = namespace["verify"].__globals__
            self.assertEqual(target["RELEASE"], guard_release)
            self.assertEqual(
                target["PATHS"]["FRIDAY_TERMINAL_EXECUTOR_BIN"],
                str(application_release / "bin/plebeian-friday-terminal-executor"),
            )
            legacy = str(predecessor_release / "bin/plebeian-auctions-poc")
            self.assertEqual(target["EXECUTABLE_NAMES"]["observer"], legacy)
            self.assertEqual(target["EXECUTABLE_NAMES"]["validator"], legacy)

            command = [
                "python3",
                "-I",
                "-S",
                "-B",
                str(guard_release / "bin/verify-friday-separated-target.py"),
                "--environment",
                "/fixture/friday.env",
                "--application",
                "/fixture/application.json",
                "--fixture-guard-release-root",
                str(guard_release),
                "--fixture-application-release-root",
                str(application_release),
                "--fixture-predecessor-release-root",
                str(predecessor_release),
            ]
            for service in (
                "plebeian-friday-observer.service",
                "plebeian-friday-validator.service",
            ):
                completed = subprocess.run(
                    [*command, "--service", service],
                    check=False,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(
                    completed.returncode, 0, completed.stdout + completed.stderr
                )
                self.assertEqual(
                    completed.stdout.strip(), "SIDEQUEST_LEGACY_NODE_TARGET=PASS"
                )

            denied = subprocess.run(
                [*command, "--service", "plebeian-friday-signer.service"],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(denied.returncode, 0)
            self.assertIn("SERVICE_NAME", denied.stdout)


if __name__ == "__main__":
    unittest.main()
