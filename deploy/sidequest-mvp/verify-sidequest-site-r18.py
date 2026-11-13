#!/usr/bin/env python3
"""Verify the R18 canonical auction-payout browser boundary through deployed R17."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import runpy
import stat


RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r18")
R17_VERIFY = Path(
    "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r17/bin/verify-friday-separated-target.py"
)
PINNED_R17_VERIFY = (
    6_165,
    "e9a8e86e2a33a01c9b2e10d2a9b60c32561f1aafd27c88d9c6c8c3e4e2c80dce",
)
SITE = (
    46_625_136,
    "b10e57405cba0ca920f206519776b2ad8da85915cca5ff6409cfca4961047a0b",
)
FRESHNESS = {
    "PLEBEIAN_AUCTION_PAYOUT_MAX_HEAD_AGE_SECONDS": "10",
    "PLEBEIAN_AUCTION_PAYOUT_MAX_FUTURE_SKEW_SECONDS": "2",
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


def exact_environment(path: Path) -> None:
    settings: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if separator:
            settings[key] = value
    for key, expected in FRESHNESS.items():
        require(settings.get(key) == expected, "FRESHNESS:" + key)


def verify(environment: Path, application: Path, service: str, release: Path) -> None:
    fixture = release != RELEASE
    if fixture:
        require(release != Path("/tmp") and Path("/tmp") in release.parents, "FIXTURE_ROOT")
    else:
        require(Path(__file__) == RELEASE / "bin/verify-friday-separated-target.py", "FIXED_INVOCATION")
    require(service == "plebeian-friday-site.service", "SERVICE")
    inspect(release / "bin" / "plebeian-auctions-mvp", SITE, os.geteuid() if fixture else 0)
    exact_environment(environment)
    if fixture:
        return
    inspect(R17_VERIFY, PINNED_R17_VERIFY, 0)
    namespace = runpy.run_path(str(R17_VERIFY))
    runtime = namespace["verify"].__globals__
    runtime["RELEASE"] = RELEASE
    runtime["SITE"] = SITE
    runtime["__file__"] = str(RELEASE / "bin/verify-friday-separated-target.py")
    namespace["verify"](environment, application, service, RELEASE)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--service", required=True)
    parser.add_argument("--fixture-release-root", type=Path)
    args = parser.parse_args()
    release = RELEASE if args.fixture_release_root is None else args.fixture_release_root.resolve()
    verify(args.environment, args.application, args.service, release)
    print("SIDEQUEST_SITE_R18_TARGET=PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop) as error:
        print("SIDEQUEST_SITE_R18_TARGET=STOPPED:" + str(error))
        raise SystemExit(1)
