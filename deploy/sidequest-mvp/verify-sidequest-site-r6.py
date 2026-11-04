#!/usr/bin/env python3
"""Verify the create-once site R6 safe-denomination browser release."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import runpy
import stat


PATCH_RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r6")
PREDECESSOR_GUARD = Path(
    "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r5/bin/verify-friday-separated-target.py"
)
PREDECESSOR = (6_091, "c43daa4a5ba0b7e824a9e6756a611de02a9424e94bd8212bbbf04e0fa4b66602")
SITE = (46_588_456, "a49e15c46f9fca93429d7b515dc0167fe35c6bca7d4daf93777af33eb14109ca")


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def inspect_predecessor(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "UNSAFE_PREDECESSOR")
        require(before.st_size == PREDECESSOR[0], "PREDECESSOR_BYTES")
        value = hashlib.sha256()
        while True:
            block = os.read(descriptor, 1 << 20)
            if not block:
                break
            value.update(block)
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
        require(identity(before) == identity(after), "PREDECESSOR_CHANGED")
        require(value.hexdigest() == PREDECESSOR[1], "PREDECESSOR_SHA256")
    finally:
        os.close(descriptor)


def verify(
    environment: Path,
    application: Path,
    service: str,
    release: Path,
    predecessor_guard: Path,
) -> None:
    fixture = release != PATCH_RELEASE
    if fixture:
        require(Path("/tmp") in release.parents and release != Path("/tmp"), "FIXTURE_ROOT")
    else:
        require(Path(__file__) == PATCH_RELEASE / "bin/verify-friday-separated-target.py", "FIXED_INVOCATION")
        require(predecessor_guard == PREDECESSOR_GUARD, "FIXED_PREDECESSOR")
    inspect_predecessor(predecessor_guard)
    namespace = runpy.run_path(str(predecessor_guard))
    target = namespace["verify"].__globals__
    target["PATCH_RELEASE"] = PATCH_RELEASE
    target["SITE"] = SITE
    target["__file__"] = str(PATCH_RELEASE / "bin/verify-friday-separated-target.py")
    namespace["verify"](environment, application, service, release)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--service", required=True)
    parser.add_argument("--fixture-release-root", type=Path)
    parser.add_argument("--fixture-predecessor-guard", type=Path)
    args = parser.parse_args()
    fixture = args.fixture_release_root is not None
    require(fixture == (args.fixture_predecessor_guard is not None), "FIXTURE_ARGUMENTS")
    release = PATCH_RELEASE if not fixture else args.fixture_release_root.resolve()
    predecessor = PREDECESSOR_GUARD if not fixture else args.fixture_predecessor_guard.resolve()
    verify(args.environment, args.application, args.service, release, predecessor)
    print("SIDEQUEST_SITE_R6_TARGET=PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop) as error:
        print("SIDEQUEST_SITE_R6_TARGET=STOPPED:" + str(error))
        raise SystemExit(1)
