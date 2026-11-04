#!/usr/bin/env python3
"""Verify the create-once site R5 single-signer-loader release and topology."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import runpy
import stat


PATCH_RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r5")
BASE_RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4")
SITE = (46_588_480, "b431cf1281d6709078d8094519789d9816c8904ac9ac8c023c99336dd6053944")
EXECUTOR = (98_846_552, "630f63ed3549812d43f585aa019b20aa90ffa863119f5b505406eaa47a518460")
BASE_GUARD = (14_659, "36bc33672b1cd2bef0961c7a7df160686cb2674e62242784303a64d652515f1d")
RUNTIME_GUARD = (24_764, "d5c7031676fa3e5dc15a5da5c11a8d20c44e5f5e53242b3407df90b1c026b206")
PUBLIC_CONFIG = {
    "/etc/plebeian-auctions-friday/application.json": (
        1_000,
        "253427ca537fb143022d48f4539e939cf01f729cbf444368d9faea75c6badeee",
    ),
    "/etc/plebeian-auctions-friday/friday.env": (
        2_281,
        "0f01031a9ad89cb55bcdd401acb0860a03a3c7b4015bd876ff6fd9c6d2ce538f",
    ),
    "/etc/plebeian-auctions-friday/sidequest-runtime-bindings.json": (
        2_942,
        "26092151896aa424614b8a8c7afe619e2d14bed8cbfbf6ce2fbf425cafe98594",
    ),
}


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def inspect_executable(path: Path, expected: tuple[int, str], owner: int) -> None:
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
            item.st_dev,
            item.st_ino,
            item.st_mode,
            item.st_size,
            item.st_mtime_ns,
            item.st_ctime_ns,
            item.st_nlink,
        )
        require(identity(before) == identity(after), "CHANGED:" + str(path))
        require(value.hexdigest() == expected[1], "SHA256:" + str(path))
    finally:
        os.close(descriptor)


def inspect_public(path: Path, expected: tuple[int, str]) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "UNSAFE_PUBLIC_FILE:" + str(path))
        require(before.st_size == expected[0], "PUBLIC_BYTES:" + str(path))
        require(before.st_uid == 0 and before.st_gid == os.getegid(), "PUBLIC_OWNER:" + str(path))
        require(stat.S_IMODE(before.st_mode) == 0o640, "PUBLIC_MODE:" + str(path))
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
        require(identity(before) == identity(after), "PUBLIC_CHANGED:" + str(path))
        require(value.hexdigest() == expected[1], "PUBLIC_SHA256:" + str(path))
    finally:
        os.close(descriptor)


def verify(environment: Path, application: Path, service: str, patch_release: Path) -> None:
    fixture = patch_release != PATCH_RELEASE
    if fixture:
        require(Path("/tmp") in patch_release.parents and patch_release != Path("/tmp"), "FIXTURE_ROOT")
    else:
        require(Path(__file__) == PATCH_RELEASE / "bin/verify-friday-separated-target.py", "FIXED_INVOCATION")
    require(service == "plebeian-friday-site.service", "SERVICE")
    owner = os.geteuid() if fixture else 0
    inspect_executable(patch_release / "bin/plebeian-auctions-mvp", SITE, owner)
    inspect_executable(patch_release / "bin/verify-friday-separated-base.py", BASE_GUARD, owner)
    inspect_executable(patch_release / "bin/verify-friday-runtime-target.py", RUNTIME_GUARD, owner)
    if fixture:
        return
    inspect_executable(BASE_RELEASE / "bin/plebeian-friday-terminal-executor", EXECUTOR, 0)
    for path, expected in PUBLIC_CONFIG.items():
        inspect_public(Path(path), expected)
    namespace = runpy.run_path(str(patch_release / "bin/verify-friday-separated-base.py"))
    target = namespace["verify"].__globals__
    target["RELEASE"] = patch_release
    target["__file__"] = str(patch_release / "bin/verify-friday-separated-target.py")
    target["PATHS"] = {
        **target["PATHS"],
        "FRIDAY_TERMINAL_EXECUTOR_BIN": str(BASE_RELEASE / "bin/plebeian-friday-terminal-executor"),
    }
    target["EXECUTABLE_NAMES"] = {**target["EXECUTABLE_NAMES"], "site": "plebeian-auctions-mvp"}
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
    print("SIDEQUEST_SITE_R5_TARGET=PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop) as error:
        print("SIDEQUEST_SITE_R5_TARGET=STOPPED:" + str(error))
        raise SystemExit(1)
