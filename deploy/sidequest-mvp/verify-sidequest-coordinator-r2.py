#!/usr/bin/env python3
"""Verify the create-once coordinator R2 patch release and separated topology."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import runpy
import stat


PATCH_RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-coordinator-r2")
BASE_RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4")
COORDINATOR = (98_656_234, "f3a60bfe025c2fcee2438442a2c466fb985322f955c62310a790cecce9f24ce0")
EXECUTOR = (98_846_552, "630f63ed3549812d43f585aa019b20aa90ffa863119f5b505406eaa47a518460")
BASE_GUARD = (14_659, "36bc33672b1cd2bef0961c7a7df160686cb2674e62242784303a64d652515f1d")
RUNTIME_GUARD = (24_764, "d5c7031676fa3e5dc15a5da5c11a8d20c44e5f5e53242b3407df90b1c026b206")


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
        value = hashlib.sha256()
        while True:
            block = os.read(descriptor, 1 << 20)
            if not block:
                break
            value.update(block)
        after = os.fstat(descriptor)
        identity = lambda item: (
            item.st_dev, item.st_ino, item.st_mode, item.st_size,
            item.st_mtime_ns, item.st_ctime_ns, item.st_nlink,
        )
        require(identity(before) == identity(after), "CHANGED:" + str(path))
        require(value.hexdigest() == expected[1], "SHA256:" + str(path))
    finally:
        os.close(descriptor)


def verify(environment: Path, application: Path, service: str, patch_release: Path) -> None:
    fixture = patch_release != PATCH_RELEASE
    if fixture:
        require(Path("/tmp") in patch_release.parents and patch_release != Path("/tmp"), "FIXTURE_ROOT")
    else:
        require(Path(__file__) == PATCH_RELEASE / "bin/verify-friday-separated-target.py", "FIXED_INVOCATION")
    require(service == "plebeian-friday-coordinator.service", "SERVICE")
    owner = os.geteuid() if fixture else 0
    inspect(patch_release / "bin/plebeian-friday-coordinator", COORDINATOR, owner)
    inspect(patch_release / "bin/verify-friday-separated-base.py", BASE_GUARD, owner)
    inspect(patch_release / "bin/verify-friday-runtime-target.py", RUNTIME_GUARD, owner)
    if fixture:
        return
    inspect(BASE_RELEASE / "bin/plebeian-friday-terminal-executor", EXECUTOR, 0)
    namespace = runpy.run_path(str(patch_release / "bin/verify-friday-separated-base.py"))
    target = namespace["verify"].__globals__
    target["RELEASE"] = patch_release
    target["__file__"] = str(patch_release / "bin/verify-friday-separated-target.py")
    target["PATHS"] = {
        **target["PATHS"],
        "FRIDAY_TERMINAL_EXECUTOR_BIN": str(BASE_RELEASE / "bin/plebeian-friday-terminal-executor"),
    }
    namespace["verify"](environment, application, service)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--service", required=True)
    parser.add_argument("--fixture-release-root", type=Path)
    args = parser.parse_args()
    release = PATCH_RELEASE if args.fixture_release_root is None else args.fixture_release_root.resolve()
    verify(args.environment, args.application, args.service, release)
    print("SIDEQUEST_COORDINATOR_R2_TARGET=PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop) as error:
        print("SIDEQUEST_COORDINATOR_R2_TARGET=STOPPED:" + str(error))
        raise SystemExit(1)
