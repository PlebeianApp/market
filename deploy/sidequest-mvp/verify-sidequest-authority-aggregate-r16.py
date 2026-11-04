#!/usr/bin/env python3
"""Verify the APP-only R16 authority aggregate successor and base topology."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import runpy
import stat


RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-aggregate-r16")
R10_RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-backend-r10")
AUTHORITY_CONFIG = Path("/etc/plebeian-auctions-friday/authority.json")
AUTHORITY_CONFIG_EXPECTED = (363, "141603382ea90a7079402bc74fbf28e26cc71cddae1d1b55a118268dcdf7e435")
ARTIFACTS = {
    "plebeian-friday-authority": (
        100_435_438,
        "1c9f2e05aa2fa4bca71f70122330abb894bcd5c4278eda50b21e77ad43bf4f82",
    ),
    "coco-demo-frost-participant-3of4": (
        2_411_344,
        "9158e90fe9807f65fadc121d5296cf29d4328928fd7bf3cb5df016202d97b993",
    ),
}


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def inspect(
    path: Path,
    expected: tuple[int, str],
    mode: int,
    owner: int,
    group: int | None = None,
) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "UNSAFE_FILE:" + str(path))
        require(before.st_size == expected[0], "BYTES:" + str(path))
        require(stat.S_IMODE(before.st_mode) == mode and before.st_uid == owner, "METADATA:" + str(path))
        if group is not None:
            require(before.st_gid == group, "GROUP:" + str(path))
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


def verify(
    release: Path,
    environment: Path,
    application: Path,
    service: str,
    fixture_config: Path | None,
) -> None:
    fixture = release != RELEASE
    if fixture:
        require(release != Path("/tmp") and Path("/tmp") in release.parents, "FIXTURE_ROOT")
    else:
        require(Path(__file__) == RELEASE / "bin/verify-friday-separated-target.py", "FIXED_INVOCATION")
    require(service == "plebeian-friday-authority.service", "SERVICE")
    owner = os.geteuid() if fixture else 0
    for name, expected in ARTIFACTS.items():
        inspect(release / "bin" / name, expected, 0o755, owner)
    config = fixture_config if fixture else AUTHORITY_CONFIG
    require(config is not None, "CONFIG")
    inspect(config, AUTHORITY_CONFIG_EXPECTED, 0o640 if not fixture else 0o600, owner, None if fixture else 988)
    if fixture:
        return
    base = runpy.run_path(str(R10_RELEASE / "bin/verify-friday-separated-target.py"))
    base["verify"](environment, application, service, R10_RELEASE)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--service", required=True)
    parser.add_argument("--fixture-release-root", type=Path)
    parser.add_argument("--fixture-config", type=Path)
    args = parser.parse_args()
    release = RELEASE if args.fixture_release_root is None else args.fixture_release_root.resolve()
    verify(release, args.environment, args.application, args.service, args.fixture_config)
    print("SIDEQUEST_AUTHORITY_AGGREGATE_R16_TARGET=PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop) as error:
        print("SIDEQUEST_AUTHORITY_AGGREGATE_R16_TARGET=STOPPED:" + str(error))
        raise SystemExit(1)
