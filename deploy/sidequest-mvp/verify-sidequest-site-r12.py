#!/usr/bin/env python3
"""Verify the R12 expired-prelock-recovery site through the pinned R11 guard."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import runpy
import stat


PATCH_RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r12")
R11_GUARD = Path(
    "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r11/bin/verify-friday-separated-target.py"
)
R10_GUARD = Path(
    "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r10/bin/verify-friday-separated-target.py"
)
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
PINNED_R11_GUARD = (5_334, "8597848a93e75646b7af51000839f087bd7471a6c62571a153f5a6ae11db43ef")
SITE = (46_596_616, "f0ef4483681c9208cfa0efc25ebf42d01b333476f7888f8ba55b7909f25bb898")


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def inspect_r11(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "UNSAFE_R11_GUARD")
        require(before.st_size == PINNED_R11_GUARD[0], "R11_GUARD_BYTES")
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
        require(identity(before) == identity(after), "R11_GUARD_CHANGED")
        require(value.hexdigest() == PINNED_R11_GUARD[1], "R11_GUARD_SHA256")
    finally:
        os.close(descriptor)


def verify(
    environment: Path,
    application: Path,
    service: str,
    release: Path,
    r11: Path,
    r10: Path,
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
        require(
            r11 == R11_GUARD and r10 == R10_GUARD and r9 == R9_GUARD and r8 == R8_GUARD
            and r7 == R7_GUARD and r6 == R6_GUARD and r5 == R5_GUARD,
            "FIXED_PREDECESSORS",
        )
    inspect_r11(r11)
    namespace = runpy.run_path(str(r11))
    target = namespace["verify"].__globals__
    target["PATCH_RELEASE"] = PATCH_RELEASE
    target["SITE"] = SITE
    target["__file__"] = str(PATCH_RELEASE / "bin/verify-friday-separated-target.py")
    namespace["verify"](environment, application, service, release, r10, r9, r8, r7, r6, r5)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--service", required=True)
    parser.add_argument("--fixture-release-root", type=Path)
    parser.add_argument("--fixture-r11-guard", type=Path)
    parser.add_argument("--fixture-r10-guard", type=Path)
    parser.add_argument("--fixture-r9-guard", type=Path)
    parser.add_argument("--fixture-r8-guard", type=Path)
    parser.add_argument("--fixture-r7-guard", type=Path)
    parser.add_argument("--fixture-r6-guard", type=Path)
    parser.add_argument("--fixture-r5-guard", type=Path)
    args = parser.parse_args()
    fixture = args.fixture_release_root is not None
    require(
        fixture == (args.fixture_r11_guard is not None) == (args.fixture_r10_guard is not None)
        == (args.fixture_r9_guard is not None) == (args.fixture_r8_guard is not None)
        == (args.fixture_r7_guard is not None) == (args.fixture_r6_guard is not None)
        == (args.fixture_r5_guard is not None),
        "FIXTURE_ARGUMENTS",
    )
    release = PATCH_RELEASE if not fixture else args.fixture_release_root.resolve()
    r11 = R11_GUARD if not fixture else args.fixture_r11_guard.resolve()
    r10 = R10_GUARD if not fixture else args.fixture_r10_guard.resolve()
    r9 = R9_GUARD if not fixture else args.fixture_r9_guard.resolve()
    r8 = R8_GUARD if not fixture else args.fixture_r8_guard.resolve()
    r7 = R7_GUARD if not fixture else args.fixture_r7_guard.resolve()
    r6 = R6_GUARD if not fixture else args.fixture_r6_guard.resolve()
    r5 = R5_GUARD if not fixture else args.fixture_r5_guard.resolve()
    verify(args.environment, args.application, args.service, release, r11, r10, r9, r8, r7, r6, r5)
    print("SIDEQUEST_SITE_R12_TARGET=PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop) as error:
        print("SIDEQUEST_SITE_R12_TARGET=STOPPED:" + str(error))
        raise SystemExit(1)
