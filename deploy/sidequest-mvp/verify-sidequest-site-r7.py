#!/usr/bin/env python3
"""Verify the R7 one-consent NIP-07 site release through the pinned R6 guard."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import runpy
import stat


PATCH_RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r7")
R6_GUARD = Path(
    "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r6/bin/verify-friday-separated-target.py"
)
R5_GUARD = Path(
    "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r5/bin/verify-friday-separated-target.py"
)
PINNED_R6_GUARD = (3_689, "5c67182fcc5de23e43001ce42776901b204213c5979559b30e089b5dcdfc5920")
SITE = (46_588_456, "4a26a5052c38c8ce2ac150cd14cf5ba19376b6bc1f3ef4533eb275b9d3ac5fb8")


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def inspect_r6(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "UNSAFE_R6_GUARD")
        require(before.st_size == PINNED_R6_GUARD[0], "R6_GUARD_BYTES")
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
        require(identity(before) == identity(after), "R6_GUARD_CHANGED")
        require(value.hexdigest() == PINNED_R6_GUARD[1], "R6_GUARD_SHA256")
    finally:
        os.close(descriptor)


def verify(environment: Path, application: Path, service: str, release: Path, r6: Path, r5: Path) -> None:
    fixture = release != PATCH_RELEASE
    if fixture:
        require(Path("/tmp") in release.parents and release != Path("/tmp"), "FIXTURE_ROOT")
    else:
        require(Path(__file__) == PATCH_RELEASE / "bin/verify-friday-separated-target.py", "FIXED_INVOCATION")
        require(r6 == R6_GUARD and r5 == R5_GUARD, "FIXED_PREDECESSORS")
    inspect_r6(r6)
    namespace = runpy.run_path(str(r6))
    target = namespace["verify"].__globals__
    target["PATCH_RELEASE"] = PATCH_RELEASE
    target["SITE"] = SITE
    target["__file__"] = str(PATCH_RELEASE / "bin/verify-friday-separated-target.py")
    namespace["verify"](environment, application, service, release, r5)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--service", required=True)
    parser.add_argument("--fixture-release-root", type=Path)
    parser.add_argument("--fixture-r6-guard", type=Path)
    parser.add_argument("--fixture-r5-guard", type=Path)
    args = parser.parse_args()
    fixture = args.fixture_release_root is not None
    require(fixture == (args.fixture_r6_guard is not None) == (args.fixture_r5_guard is not None), "FIXTURE_ARGUMENTS")
    release = PATCH_RELEASE if not fixture else args.fixture_release_root.resolve()
    r6 = R6_GUARD if not fixture else args.fixture_r6_guard.resolve()
    r5 = R5_GUARD if not fixture else args.fixture_r5_guard.resolve()
    verify(args.environment, args.application, args.service, release, r6, r5)
    print("SIDEQUEST_SITE_R7_TARGET=PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop) as error:
        print("SIDEQUEST_SITE_R7_TARGET=STOPPED:" + str(error))
        raise SystemExit(1)
