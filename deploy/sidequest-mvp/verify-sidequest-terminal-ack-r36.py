#!/usr/bin/env python3
"""Verify the R36 authority/coordinator terminal-ack successor."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import runpy
import stat


RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-terminal-ack-r36")
R21_VERIFY = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-comet-stage-r21/bin/verify-friday-separated-target.py")
R10_RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-backend-r10")
ARTIFACTS = {
    "plebeian-friday-authority": (
        99_602_801,
        "0369e443008ee4527e186a3690c2e1d1c90d5263105eecb94d75bf19b009c5df",
    ),
    "plebeian-friday-coordinator": (
        98_657_241,
        "34a91af63d4a86701daf2fdafaf5279c684c7c37c77cdf94523b307b68a80fb4",
    ),
    "plebeian-friday-terminal-executor": (
        99_082_439,
        "4598dac4336348878db61d8f4ea8f5e8e57b459ac2563fea0b5a2005ef46f222",
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
    require(service in {"plebeian-friday-authority.service", "plebeian-friday-coordinator.service"}, "SERVICE")
    owner = os.geteuid() if fixture else 0
    for name, expected in ARTIFACTS.items():
        inspect(release / "bin" / name, expected, owner)
    if fixture:
        return
    if service == "plebeian-friday-authority.service":
        namespace = runpy.run_path(str(R21_VERIFY))
        runtime = namespace["verify"].__globals__
        runtime["RELEASE"] = RELEASE
        runtime["AUTHORITY"] = ARTIFACTS["plebeian-friday-authority"]
        runtime["__file__"] = str(RELEASE / "bin/verify-friday-separated-target.py")
        namespace["verify"](environment, application, service)
        return
    namespace = runpy.run_path(str(R10_RELEASE / "bin/verify-friday-separated-target.py"))
    namespace["verify"](environment, application, service, R10_RELEASE)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--service", required=True)
    parser.add_argument("--fixture-release-root", type=Path)
    args = parser.parse_args()
    release = RELEASE if args.fixture_release_root is None else args.fixture_release_root.resolve()
    verify(args.environment, args.application, args.service, release)
    print("SIDEQUEST_TERMINAL_ACK_R36_TARGET=PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop) as error:
        print("SIDEQUEST_TERMINAL_ACK_R36_TARGET=STOPPED:" + str(error))
        raise SystemExit(1)
