#!/usr/bin/env python3
"""Verify exact successor role artifacts, then run the accepted topology guard."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import runpy
import stat


PRODUCTION_RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4")
PREDECESSOR_RELEASE = Path("/opt/plebeian-auctions-friday/releases/separated-deploy-v1")
ARTIFACTS = {
    "site": [("plebeian-auctions-mvp", 46_588_440, "ab92ff6d0552f8de88208636cdad77dff3863ee8ef325eb04352e635e93e20c5")],
    "authority": [("plebeian-friday-authority", 99_171_906, "af51ff40ddafa496169cb15731c1ab8cf2b3b569f707dfd7f69719c9d294755d")],
    "coordinator": [
        ("plebeian-friday-coordinator", 98_655_955, "2671bb59de2b8a63ffd34721f28c97b59098935503f322ac833b0339d6e6a777"),
        ("plebeian-friday-terminal-executor", 98_846_552, "630f63ed3549812d43f585aa019b20aa90ffa863119f5b505406eaa47a518460"),
    ],
    "signer": [("plebeian-friday-signer", 98_923_995, "00c448e172c13b1a9862cd97bf79608e879739c0cc44aba74019bc3df66739d9")],
}
BASE_SHA256 = "08802310fa9d584354ca4a2ce1a24ba290ffba2e10ce6e4007fe46bd9fe136e3"
RUNTIME_SHA256 = "d5c7031676fa3e5dc15a5da5c11a8d20c44e5f5e53242b3407df90b1c026b206"


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def inspect(path: Path, expected_bytes: int, expected_sha256: str, expected_mode: int, expected_owner: int) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "UNSAFE_FILE:" + str(path))
        require(before.st_size == expected_bytes, "BYTES:" + str(path))
        require(stat.S_IMODE(before.st_mode) == expected_mode, "MODE:" + str(path))
        require(before.st_uid == expected_owner, "OWNER:" + str(path))
        value = hashlib.sha256()
        while True:
            block = os.read(descriptor, 1 << 20)
            if not block:
                break
            value.update(block)
        after = os.fstat(descriptor)
        fields = lambda item: (item.st_dev, item.st_ino, item.st_mode, item.st_size, item.st_mtime_ns, item.st_ctime_ns, item.st_nlink)
        require(fields(before) == fields(after), "CHANGED:" + str(path))
        require(value.hexdigest() == expected_sha256, "SHA256:" + str(path))
    finally:
        os.close(descriptor)


def artifact_check(release: Path, kind: str, expected_owner: int) -> None:
    require(kind in ARTIFACTS, "SERVICE_KIND")
    for name, size, sha256 in ARTIFACTS[kind]:
        inspect(release / "bin" / name, size, sha256, 0o755, expected_owner)
    inspect(release / "bin/verify-friday-separated-base.py", 14_508, BASE_SHA256, 0o755, expected_owner)
    inspect(release / "bin/verify-friday-runtime-target.py", 24_764, RUNTIME_SHA256, 0o755, expected_owner)


def verify(release: Path, environment: Path, application: Path, service: str, fixture: bool) -> None:
    kind = service.removeprefix("plebeian-friday-").removesuffix(".service")
    require(service == "plebeian-friday-" + kind + ".service", "SERVICE_NAME")
    artifact_check(release, kind, os.geteuid() if fixture else 0)
    if fixture:
        return

    require(release == PRODUCTION_RELEASE, "PRODUCTION_RELEASE")
    base = release / "bin/verify-friday-separated-base.py"
    namespace = runpy.run_path(str(base))
    target = namespace["verify"].__globals__
    target["RELEASE"] = release
    target["__file__"] = str(release / "bin/verify-friday-separated-target.py")
    target["PATHS"] = {
        **target["PATHS"],
        "FRIDAY_TERMINAL_EXECUTOR_BIN": str(release / "bin/plebeian-friday-terminal-executor"),
    }
    namespace["verify"](environment, application, service)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--service", required=True)
    parser.add_argument("--fixture-release-root", type=Path)
    args = parser.parse_args()
    fixture = args.fixture_release_root is not None
    release = PRODUCTION_RELEASE if not fixture else args.fixture_release_root.resolve()
    if fixture:
        require(release != Path("/tmp") and Path("/tmp") in release.parents, "FIXTURE_ROOT")
    verify(release, args.environment, args.application, args.service, fixture)
    print("SIDEQUEST_ROLE_TARGET=PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop) as error:
        print("SIDEQUEST_ROLE_TARGET=STOPPED:" + str(error))
        raise SystemExit(1)
