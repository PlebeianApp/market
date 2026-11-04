#!/usr/bin/env python3
"""Verify the R10 Coco-canonical NUT-11 release through the pinned R9 guard."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import runpy
import stat


PATCH_RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r10")
R9_GUARD = Path(
    "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r9/bin/verify-friday-separated-target.py"
)
R8_GUARD = Path(
    "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r8/bin/verify-friday-separated-target.py"
)
R7_GUARD = Path(
    "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r7/bin/verify-friday-separated-target.py"
)
R6_GUARD = Path(
    "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r6/bin/verify-friday-separated-target.py"
)
R5_GUARD = Path(
    "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r5/bin/verify-friday-separated-target.py"
)
PINNED_R9_GUARD = (4_569, "aedf39cc0c8b2afd1269bea6f23aeb77d1ec8ac9740fb443f907bc031c8d64e7")
SITE = (46_588_464, "9933c80eb52f48b99b970faa5d810610723cb20238f77ffa75f094506e15baee")


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def inspect_r9(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "UNSAFE_R9_GUARD")
        require(before.st_size == PINNED_R9_GUARD[0], "R9_GUARD_BYTES")
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
        require(identity(before) == identity(after), "R9_GUARD_CHANGED")
        require(value.hexdigest() == PINNED_R9_GUARD[1], "R9_GUARD_SHA256")
    finally:
        os.close(descriptor)


def verify(
    environment: Path,
    application: Path,
    service: str,
    release: Path,
    r9: Path,
    r8: Path,
    r7: Path,
    r6: Path,
    r5: Path,
) -> None:
    fixture = release != PATCH_RELEASE
    if fixture:
        require(Path("/tmp") in release.parents and release != Path("/tmp"), "FIXTURE_ROOT")
    else:
        require(Path(__file__) == PATCH_RELEASE / "bin/verify-friday-separated-target.py", "FIXED_INVOCATION")
        require(r9 == R9_GUARD and r8 == R8_GUARD and r7 == R7_GUARD and r6 == R6_GUARD
                and r5 == R5_GUARD, "FIXED_PREDECESSORS")
    inspect_r9(r9)
    namespace = runpy.run_path(str(r9))
    target = namespace["verify"].__globals__
    target["PATCH_RELEASE"] = PATCH_RELEASE
    target["SITE"] = SITE
    target["__file__"] = str(PATCH_RELEASE / "bin/verify-friday-separated-target.py")
    namespace["verify"](environment, application, service, release, r8, r7, r6, r5)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--service", required=True)
    parser.add_argument("--fixture-release-root", type=Path)
    parser.add_argument("--fixture-r9-guard", type=Path)
    parser.add_argument("--fixture-r8-guard", type=Path)
    parser.add_argument("--fixture-r7-guard", type=Path)
    parser.add_argument("--fixture-r6-guard", type=Path)
    parser.add_argument("--fixture-r5-guard", type=Path)
    args = parser.parse_args()
    fixture = args.fixture_release_root is not None
    require(fixture == (args.fixture_r9_guard is not None) == (args.fixture_r8_guard is not None)
            == (args.fixture_r7_guard is not None) == (args.fixture_r6_guard is not None)
            == (args.fixture_r5_guard is not None), "FIXTURE_ARGUMENTS")
    release = PATCH_RELEASE if not fixture else args.fixture_release_root.resolve()
    r9 = R9_GUARD if not fixture else args.fixture_r9_guard.resolve()
    r8 = R8_GUARD if not fixture else args.fixture_r8_guard.resolve()
    r7 = R7_GUARD if not fixture else args.fixture_r7_guard.resolve()
    r6 = R6_GUARD if not fixture else args.fixture_r6_guard.resolve()
    r5 = R5_GUARD if not fixture else args.fixture_r5_guard.resolve()
    verify(args.environment, args.application, args.service, release, r9, r8, r7, r6, r5)
    print("SIDEQUEST_SITE_R10_TARGET=PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop) as error:
        print("SIDEQUEST_SITE_R10_TARGET=STOPPED:" + str(error))
        raise SystemExit(1)
