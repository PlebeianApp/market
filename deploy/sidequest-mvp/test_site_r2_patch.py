#!/usr/bin/env python3
from __future__ import annotations

import hashlib
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
GUARD = ROOT / "deploy/sidequest-mvp/verify-sidequest-site-r2.py"
SITE = ROOT / "dist/sidequest/plebeian-auctions-mvp-site-r4-fix"
BASE = ROOT / "deploy/friday/separated/verify-friday-separated-target.py"
RUNTIME = ROOT / "deploy/friday/verify-friday-runtime-target.py"
UNIT = ROOT / "deploy/sidequest-mvp/plebeian-friday-site-r2.service"


class SiteR2PatchTests(unittest.TestCase):
    def fixture(self, parent: Path) -> Path:
        release = parent / "release"
        binary = release / "bin"
        binary.mkdir(parents=True)
        for source, name in (
            (SITE, "plebeian-auctions-mvp"),
            (BASE, "verify-friday-separated-base.py"),
            (RUNTIME, "verify-friday-runtime-target.py"),
        ):
            shutil.copyfile(source, binary / name)
            (binary / name).chmod(0o755)
        return release

    def run_guard(self, release: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                str(GUARD),
                "--environment", "/tmp/not-read-in-fixture",
                "--application", "/tmp/not-read-in-fixture",
                "--service", "plebeian-friday-site.service",
                "--fixture-release-root", str(release),
            ],
            text=True,
            capture_output=True,
            check=False,
        )

    def test_exact_patch_release_passes_and_binary_drift_stops(self) -> None:
        with tempfile.TemporaryDirectory(dir="/tmp") as raw:
            release = self.fixture(Path(raw))
            accepted = self.run_guard(release)
            self.assertEqual(accepted.returncode, 0, accepted.stdout + accepted.stderr)
            self.assertIn("SIDEQUEST_SITE_R2_TARGET=PASS", accepted.stdout)
            with (release / "bin/plebeian-auctions-mvp").open("ab") as output:
                output.write(b"drift")
            rejected = self.run_guard(release)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("BYTES:", rejected.stdout)

    def test_unit_is_loopback_only_and_uses_patch_release(self) -> None:
        raw = UNIT.read_text()
        self.assertIn("/sidequest-mvp-r4-site-r2/bin/plebeian-auctions-mvp", raw)
        self.assertIn("--listen 127.0.0.1:${FRIDAY_SITE_PORT}", raw)
        self.assertIn("RestrictAddressFamilies=AF_INET AF_UNIX", raw)
        self.assertNotIn("0.0.0.0", raw)
        self.assertNotIn("443", raw)
        self.assertEqual(
            hashlib.sha256(SITE.read_bytes()).hexdigest(),
            "75d304d601c94fe3373d92923025cbadb61e915e8ad67b928b5dd88b03077b85",
        )


if __name__ == "__main__":
    unittest.main()
