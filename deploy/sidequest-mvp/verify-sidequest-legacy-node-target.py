#!/usr/bin/env python3
"""Guard preserved observer/validator nodes against the successor environment."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import runpy
import stat


PRODUCTION_GUARD_RELEASE = Path(
    "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-legacy-node-guard-v1"
)
PRODUCTION_APPLICATION_RELEASE = Path(
    "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4"
)
PRODUCTION_PREDECESSOR_RELEASE = Path(
    "/opt/plebeian-auctions-friday/releases/separated-deploy-v1"
)
LEGACY_NODE_BYTES = 46_580_232
LEGACY_NODE_SHA256 = "8f501da6c7b054d3b33f98f4be52c0299655fc52756af70cd59cbc5740afd7c4"
BASE_BYTES = 14_659
BASE_SHA256 = "36bc33672b1cd2bef0961c7a7df160686cb2674e62242784303a64d652515f1d"
RUNTIME_BYTES = 24_764
RUNTIME_SHA256 = "d5c7031676fa3e5dc15a5da5c11a8d20c44e5f5e53242b3407df90b1c026b206"
SERVICES = {
    "plebeian-friday-observer.service": "observer",
    "plebeian-friday-validator.service": "validator",
}


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def inspect(
    path: Path,
    expected_bytes: int,
    expected_sha256: str,
    expected_mode: int,
    expected_owner: int,
) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        require(
            stat.S_ISREG(before.st_mode) and before.st_nlink == 1,
            "UNSAFE_FILE:" + str(path),
        )
        require(before.st_size == expected_bytes, "BYTES:" + str(path))
        require(stat.S_IMODE(before.st_mode) == expected_mode, "MODE:" + str(path))
        require(before.st_uid == expected_owner, "OWNER:" + str(path))
        value = hashlib.sha256()
        while True:
            block = os.read(descriptor, 1 << 20)
            if not block:
                break
            value.update(block)
        after = os.fstat(descriptor)
        fields = lambda item: (
            item.st_dev,
            item.st_ino,
            item.st_mode,
            item.st_size,
            item.st_mtime_ns,
            item.st_ctime_ns,
            item.st_nlink,
        )
        require(fields(before) == fields(after), "CHANGED:" + str(path))
        require(value.hexdigest() == expected_sha256, "SHA256:" + str(path))
    finally:
        os.close(descriptor)


def artifact_check(
    guard_release: Path,
    predecessor_release: Path,
    expected_owner: int,
) -> None:
    inspect(
        predecessor_release / "bin/plebeian-auctions-poc",
        LEGACY_NODE_BYTES,
        LEGACY_NODE_SHA256,
        0o755,
        expected_owner,
    )
    inspect(
        guard_release / "bin/verify-friday-separated-base.py",
        BASE_BYTES,
        BASE_SHA256,
        0o755,
        expected_owner,
    )
    inspect(
        guard_release / "bin/verify-friday-runtime-target.py",
        RUNTIME_BYTES,
        RUNTIME_SHA256,
        0o755,
        expected_owner,
    )


def load_base_guard(
    guard_release: Path,
    application_release: Path,
    predecessor_release: Path,
) -> dict:
    base = guard_release / "bin/verify-friday-separated-base.py"
    namespace = runpy.run_path(str(base))
    target = namespace["verify"].__globals__
    target["RELEASE"] = guard_release
    target["__file__"] = str(
        guard_release / "bin/verify-friday-separated-target.py"
    )
    target["PATHS"] = {
        **target["PATHS"],
        "FRIDAY_TERMINAL_EXECUTOR_BIN": str(
            application_release / "bin/plebeian-friday-terminal-executor"
        ),
    }
    legacy_node = str(predecessor_release / "bin/plebeian-auctions-poc")
    target["EXECUTABLE_NAMES"] = {
        **target["EXECUTABLE_NAMES"],
        "observer": legacy_node,
        "validator": legacy_node,
    }
    return namespace


def verify(
    guard_release: Path,
    application_release: Path,
    predecessor_release: Path,
    environment: Path,
    application: Path,
    service: str,
    fixture: bool,
) -> None:
    require(service in SERVICES, "SERVICE_NAME")
    expected_owner = os.geteuid() if fixture else 0
    artifact_check(guard_release, predecessor_release, expected_owner)
    namespace = load_base_guard(
        guard_release, application_release, predecessor_release
    )
    target = namespace["verify"].__globals__
    require(
        Path(target["EXECUTABLE_NAMES"][SERVICES[service]])
        == predecessor_release / "bin/plebeian-auctions-poc",
        "LEGACY_EXECUTABLE_MAPPING",
    )
    if fixture:
        return

    require(guard_release == PRODUCTION_GUARD_RELEASE, "PRODUCTION_GUARD_RELEASE")
    require(
        application_release == PRODUCTION_APPLICATION_RELEASE,
        "PRODUCTION_APPLICATION_RELEASE",
    )
    require(
        predecessor_release == PRODUCTION_PREDECESSOR_RELEASE,
        "PRODUCTION_PREDECESSOR_RELEASE",
    )
    namespace["verify"](environment, application, service)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--service", required=True)
    parser.add_argument("--fixture-guard-release-root", type=Path)
    parser.add_argument("--fixture-application-release-root", type=Path)
    parser.add_argument("--fixture-predecessor-release-root", type=Path)
    args = parser.parse_args()
    fixture_roots = (
        args.fixture_guard_release_root,
        args.fixture_application_release_root,
        args.fixture_predecessor_release_root,
    )
    fixture = any(value is not None for value in fixture_roots)
    require(fixture == all(value is not None for value in fixture_roots), "FIXTURE_ROOTS")
    if fixture:
        guard_release, application_release, predecessor_release = (
            value.resolve() for value in fixture_roots
        )
        for root in (guard_release, application_release, predecessor_release):
            require(root != Path("/tmp") and Path("/tmp") in root.parents, "FIXTURE_ROOT")
    else:
        guard_release = PRODUCTION_GUARD_RELEASE
        application_release = PRODUCTION_APPLICATION_RELEASE
        predecessor_release = PRODUCTION_PREDECESSOR_RELEASE
    verify(
        guard_release,
        application_release,
        predecessor_release,
        args.environment,
        args.application,
        args.service,
        fixture,
    )
    print("SIDEQUEST_LEGACY_NODE_TARGET=PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop) as error:
        print("SIDEQUEST_LEGACY_NODE_TARGET=STOPPED:" + str(error))
        raise SystemExit(1)
