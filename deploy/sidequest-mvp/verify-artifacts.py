#!/usr/bin/env python3
"""Verify the locally built side-quest release without executing it."""

import hashlib
import json
import stat
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def main() -> None:
    manifest = json.loads((HERE / "artifacts.json").read_text(encoding="utf-8"))
    assert manifest["schema"] == "PLEBEIAN_SIDEQUEST_MVP_ARTIFACTS_V1"
    assert manifest["valueProfile"] == "FAKE_MONEY_ONLY"
    for record in manifest["artifacts"]:
        path = ROOT / record["path"]
        metadata = path.stat()
        assert stat.S_ISREG(metadata.st_mode), f"not a regular file: {path}"
        assert metadata.st_size == record["bytes"], f"byte count changed: {path}"
        assert f"{stat.S_IMODE(metadata.st_mode):04o}" == record["mode"], f"mode changed: {path}"
        assert digest(path) == record["sha256"], f"SHA-256 changed: {path}"
    for record in manifest["publicOutputArtifacts"]:
        path = ROOT / record["path"]
        metadata = path.stat()
        assert stat.S_ISREG(metadata.st_mode), f"not a regular file: {path}"
        assert metadata.st_size == record["bytes"], f"byte count changed: {path}"
        assert f"{stat.S_IMODE(metadata.st_mode):04o}" == record["mode"], f"mode changed: {path}"
        assert digest(path) == record["sha256"], f"SHA-256 changed: {path}"
    for record in manifest["sourcePins"]:
        path = ROOT / record["path"]
        assert digest(path) == record["sha256"], f"source SHA-256 changed: {path}"
    print("SIDEQUEST_ARTIFACTS=PASS")


if __name__ == "__main__":
    main()
