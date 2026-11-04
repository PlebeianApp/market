#!/usr/bin/env python3
"""Verify the R10 APP backend release and exact separated runtime binding."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import runpy
import stat


RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-backend-r10")
APPLICATION_RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4")
ARTIFACTS = {
    "plebeian-friday-authority": (99_590_439, "e7ffeb9dfbb359eefa2da5c5efffd68c0ef03c7f050c93653e460be7c682795c"),
    "plebeian-friday-coordinator": (98_656_833, "bac336f7fbd5a272a1801243819156e070dc8542046afcd2e1730a4fa7cff8bd"),
    "plebeian-friday-terminal-executor": (99_079_785, "7e0fdc542801c8d55697d79a31d56f2a54ee0f50c783a3513d7d68a9257a21c2"),
    "verify-friday-separated-base.py": (14_659, "36bc33672b1cd2bef0961c7a7df160686cb2674e62242784303a64d652515f1d"),
    "verify-friday-runtime-target.py": (24_764, "d5c7031676fa3e5dc15a5da5c11a8d20c44e5f5e53242b3407df90b1c026b206"),
}
SERVICES = {
    "plebeian-friday-authority.service",
    "plebeian-friday-coordinator.service",
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
            item.st_dev, item.st_ino, item.st_mode, item.st_size,
            item.st_mtime_ns, item.st_ctime_ns, item.st_nlink,
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
    require(service in SERVICES, "SERVICE")
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
        # Preserve the shared environment contract used by the still-running
        # observer/site guards.  The R10 coordinator unit passes its separately
        # pinned executor path literally and this guard verifies that binary.
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
    print("SIDEQUEST_BACKEND_R10_TARGET=PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop) as error:
        print("SIDEQUEST_BACKEND_R10_TARGET=STOPPED:" + str(error))
        raise SystemExit(1)
