#!/usr/bin/env python3
"""Verify the R13 no-effect-recovery signer release.

R13 keeps the reviewed separated-host guard and the R12 signer/recovery
executables, but binds them to the actual successor release root.  This file
exists because the first R12 unit accidentally installed the base guard as the
derived target, whose fixed predecessor path correctly failed closed.
"""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import runpy
import stat


RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-signer-recovery-r13")
APPLICATION_RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4")
ARTIFACTS = {
    "plebeian-friday-signer": (
        100_058_644,
        "45f27e32b0745993e705f4e1373acf66ce12ae6f13644834807ab19c28967e38",
    ),
    "plebeian-friday-signer-no-effect-recovery": (
        99_352_569,
        "5770ad9a69a5fd48c23ca6ec71191e0daf0fbe1a99930bff3478e91a879fc30e",
    ),
    "verify-friday-separated-base.py": (
        14_659,
        "36bc33672b1cd2bef0961c7a7df160686cb2674e62242784303a64d652515f1d",
    ),
    "verify-friday-runtime-target.py": (
        24_764,
        "d5c7031676fa3e5dc15a5da5c11a8d20c44e5f5e53242b3407df90b1c026b206",
    ),
}


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def inspect(path: Path, expected: tuple[int, str], owner: int) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "UNSAFE_FILE:" + str(path))
        require(before.st_size == expected[0], "BYTES:" + str(path))
        require(stat.S_IMODE(before.st_mode) == 0o755 and before.st_uid == owner, "METADATA:" + str(path))
        digest = hashlib.sha256()
        while True:
            block = os.read(descriptor, 1 << 20)
            if not block:
                break
            digest.update(block)
        after = os.fstat(descriptor)
        identity = lambda item: (
            item.st_dev,
            item.st_ino,
            item.st_mode,
            item.st_size,
            item.st_mtime_ns,
            item.st_ctime_ns,
            item.st_nlink,
        )
        require(identity(before) == identity(after), "CHANGED:" + str(path))
        require(digest.hexdigest() == expected[1], "SHA256:" + str(path))
    finally:
        os.close(descriptor)


def verify(environment: Path, application: Path, service: str, release: Path) -> None:
    fixture = release != RELEASE
    if fixture:
        require(release != Path("/tmp") and Path("/tmp") in release.parents, "FIXTURE_ROOT")
    else:
        require(Path(__file__) == RELEASE / "bin/verify-friday-separated-target.py", "FIXED_INVOCATION")
    require(service == "plebeian-friday-signer.service", "SERVICE")
    owner = os.geteuid() if fixture else 0
    for name, expected in ARTIFACTS.items():
        inspect(release / "bin" / name, expected, owner)
    if fixture:
        return
    namespace = runpy.run_path(str(release / "bin/verify-friday-separated-base.py"))
    target = namespace["verify"].__globals__
    target["RELEASE"] = release
    target["__file__"] = str(release / "bin/verify-friday-separated-target.py")
    target["PATHS"] = {
        **target["PATHS"],
        "FRIDAY_TERMINAL_EXECUTOR_BIN": str(APPLICATION_RELEASE / "bin/plebeian-friday-terminal-executor"),
    }
    namespace["verify"](environment, application, service)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--service", required=True)
    parser.add_argument("--fixture-release-root", type=Path)
    args = parser.parse_args()
    release = RELEASE if args.fixture_release_root is None else args.fixture_release_root.resolve()
    verify(args.environment, args.application, args.service, release)
    print("SIDEQUEST_SIGNER_R13_TARGET=PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop) as error:
        print("SIDEQUEST_SIGNER_R13_TARGET=STOPPED:" + str(error))
        raise SystemExit(1)
