#!/usr/bin/env python3
"""Verify the exact fake-money Auctions MVP recovery release."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import runpy
import stat


RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-recovery")
ARTIFACTS = {
    "plebeian-friday-authority": (
        99_654_044,
        "be3246e9de909e13bb7de0795cd39ca4c162b247a12d2a5476107a3b0a8fccbc",
    ),
    "plebeian-friday-coordinator": (
        98_658_332,
        "d9e5311b8baa025504e0db53d55aa327476e4e909a1224e1df285449e3611386",
    ),
    "plebeian-friday-terminal-executor": (
        99_117_242,
        "4b6a1dfdc40420b2db59301be9b2d7aefa5bfa21f368723ec1de69640b18c958",
    ),
    "plebeian-auctions-mvp": (
        46_633_336,
        "8239bc91b29a04a24f089a2479bd0d1757cb4f2825deafa9c3634f2553314935",
    ),
}
BASE_GUARD = (
    14_659,
    "36bc33672b1cd2bef0961c7a7df160686cb2674e62242784303a64d652515f1d",
)
FRESHNESS = {
    "PLEBEIAN_AUCTION_PAYOUT_MAX_HEAD_AGE_SECONDS": "10",
    "PLEBEIAN_AUCTION_PAYOUT_MAX_FUTURE_SKEW_SECONDS": "2",
}
SERVICES = {
    "plebeian-friday-authority.service",
    "plebeian-friday-coordinator.service",
    "plebeian-friday-site.service",
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
        require(stat.S_IMODE(before.st_mode) == 0o755 and before.st_uid == owner,
                "METADATA:" + str(path))
        digest = hashlib.sha256()
        while True:
            block = os.read(descriptor, 1 << 20)
            if not block:
                break
            digest.update(block)
        after = os.fstat(descriptor)
        identity = lambda item: (
            item.st_dev, item.st_ino, item.st_mode, item.st_size,
            item.st_mtime_ns, item.st_ctime_ns, item.st_nlink,
        )
        require(identity(before) == identity(after), "CHANGED:" + str(path))
        require(digest.hexdigest() == expected[1], "SHA256:" + str(path))
    finally:
        os.close(descriptor)


def exact_configuration(environment: Path, application: Path, release: Path, service: str) -> None:
    settings: dict[str, str] = {}
    for raw in environment.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        require(bool(separator) and key not in settings, "ENVIRONMENT_FIELD:" + key)
        settings[key] = value
    for key, expected in FRESHNESS.items():
        require(settings.get(key) == expected, "FRESHNESS:" + key)

    def unique(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            require(key not in result, "APPLICATION_DUPLICATE:" + key)
            result[key] = value
        return result

    with application.open("r", encoding="utf-8") as source:
        manifest = json.load(source, object_pairs_hook=unique)
    require(isinstance(manifest, dict), "APPLICATION_OBJECT")
    namespace = runpy.run_path(str(release / "bin" / "verify-friday-separated-base.py"))
    common = namespace.get("COMMON")
    verify_values = namespace.get("verify_values")
    require(isinstance(common, set) and callable(verify_values), "BASE_GUARD_CONTRACT")
    extended = common | set(FRESHNESS)
    verify_values.__globals__["COMMON"] = extended
    verify_values(settings, manifest, service)


def verify(environment: Path, application: Path, service: str, release: Path) -> None:
    fixture = release != RELEASE
    if fixture:
        require(release != Path("/tmp") and Path("/tmp") in release.parents, "FIXTURE_ROOT")
    else:
        require(Path(__file__) == RELEASE / "bin" / "verify-friday-separated-target.py",
                "FIXED_INVOCATION")
    require(service in SERVICES, "SERVICE")
    owner = os.geteuid() if fixture else 0
    for name, expected in ARTIFACTS.items():
        inspect(release / "bin" / name, expected, owner)
    inspect(release / "bin" / "verify-friday-separated-base.py", BASE_GUARD, owner)
    exact_configuration(environment, application, release, service)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--service", required=True)
    parser.add_argument("--fixture-release-root", type=Path)
    args = parser.parse_args()
    release = RELEASE if args.fixture_release_root is None else args.fixture_release_root.resolve()
    verify(args.environment, args.application, args.service, release)
    print("SIDEQUEST_RECOVERY_TARGET=PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError, Stop) as error:
        print("SIDEQUEST_RECOVERY_TARGET=STOPPED:" + str(error))
        raise SystemExit(1)
