#!/usr/bin/env python3
"""Focused fixture tests for the R13 signer release guard."""

from __future__ import annotations

import hashlib
from pathlib import Path
import runpy
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
GUARD = HERE / "verify-sidequest-signer-r13.py"


class SignerR13GuardTests(unittest.TestCase):
    def fixture(self) -> tuple[tempfile.TemporaryDirectory[str], Path, dict[str, object]]:
        temporary = tempfile.TemporaryDirectory(prefix="signer-r13-", dir="/tmp")
        release = Path(temporary.name) / "release"
        (release / "bin").mkdir(parents=True)
        namespace = runpy.run_path(str(GUARD))
        artifacts: dict[str, tuple[int, str]] = {}
        for index, name in enumerate(namespace["ARTIFACTS"]):
            content = (name + f":{index}\n").encode()
            path = release / "bin" / name
            path.write_bytes(content)
            path.chmod(0o755)
            artifacts[name] = (len(content), hashlib.sha256(content).hexdigest())
        namespace["ARTIFACTS"].clear()
        namespace["ARTIFACTS"].update(artifacts)
        return temporary, release, namespace

    def test_accepts_exact_fixture_and_signer_service_only(self) -> None:
        temporary, release, namespace = self.fixture()
        self.addCleanup(temporary.cleanup)
        namespace["verify"](
            Path("/unused/environment"),
            Path("/unused/application"),
            "plebeian-friday-signer.service",
            release,
        )
        with self.assertRaisesRegex(namespace["Stop"], "SERVICE"):
            namespace["verify"](
                Path("/unused/environment"),
                Path("/unused/application"),
                "plebeian-friday-authority.service",
                release,
            )

    def test_rejects_changed_artifact(self) -> None:
        temporary, release, namespace = self.fixture()
        self.addCleanup(temporary.cleanup)
        target = release / "bin/plebeian-friday-signer"
        target.write_bytes(target.read_bytes() + b"changed")
        target.chmod(0o755)
        with self.assertRaisesRegex(namespace["Stop"], "BYTES"):
            namespace["verify"](
                Path("/unused/environment"),
                Path("/unused/application"),
                "plebeian-friday-signer.service",
                release,
            )

    def test_rejects_unsafe_fixture_root(self) -> None:
        namespace = runpy.run_path(str(GUARD))
        with self.assertRaisesRegex(namespace["Stop"], "FIXTURE_ROOT"):
            namespace["verify"](
                Path("/unused/environment"),
                Path("/unused/application"),
                "plebeian-friday-signer.service",
                Path("/var/tmp/not-approved"),
            )


if __name__ == "__main__":
    unittest.main()
