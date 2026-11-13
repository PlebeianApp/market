#!/usr/bin/env python3
"""Verify the R38 offline-seller/read-transport successor at the 10s/2s policy."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import runpy
import stat


RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-seller-patch-r38")
R36_VERIFY = Path(
    "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-terminal-ack-r36/bin/verify-friday-separated-target.py"
)
PINNED_R36_VERIFY = (
    4_264,
    "6139bc6c533d268d7d19cabec85e6c697a0029a1c9cc8568d6328732a654a314",
)
ARTIFACTS = {
    "plebeian-friday-authority": (
        99_653_664,
        "07733396fef23b1c5284a354ef35bfe73174994a1bd0f91a1993d17ab5a6024f",
    ),
    "plebeian-friday-coordinator": (
        98_658_046,
        "5630653421cf411290ba0adbbc26472ed971143f98bab5eccb188c0bb271d1b3",
    ),
    "plebeian-friday-terminal-executor": (
        99_116_862,
        "cf5f3d016ef68b26ac45b8a16539a4169d628629e405414dad9fa6fc673d92d0",
    ),
}
FRESHNESS = {
    "PLEBEIAN_AUCTION_PAYOUT_MAX_HEAD_AGE_SECONDS": "10",
    "PLEBEIAN_AUCTION_PAYOUT_MAX_FUTURE_SKEW_SECONDS": "2",
}


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def inspect(path: Path, expected: tuple[int, str], owner: int, mode: int = 0o755) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "UNSAFE_FILE:" + str(path))
        require(before.st_size == expected[0], "BYTES:" + str(path))
        require(stat.S_IMODE(before.st_mode) == mode and before.st_uid == owner, "METADATA:" + str(path))
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


@contextmanager
def predecessor_environment_compatibility():
    """Allow only R38's two pinned fields through the predecessor contract.

    The pinned R10 base guard requires an exact environment field set. R38
    adds two reviewed policy fields, so invoking that predecessor unchanged
    would reject the successor environment before checking its existing
    values. Intercept only loaded predecessor namespaces exposing the known
    COMMON/verify_values contract and extend that exact set by the R38 keys.
    The predecessor still reads and validates the real environment, while this
    guard independently pins both new values above.
    """
    original = runpy.run_path

    def compatible(path: str, *args, **kwargs):
        namespace = original(path, *args, **kwargs)
        common = namespace.get("COMMON")
        verify_values = namespace.get("verify_values")
        if isinstance(common, set) and "FRIDAY_ROLE" in common and callable(verify_values):
            extended = common | set(FRESHNESS)
            namespace["COMMON"] = extended
            verify_values.__globals__["COMMON"] = extended
        return namespace

    runpy.run_path = compatible
    try:
        yield
    finally:
        runpy.run_path = original


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
    exact_environment(environment)
    if fixture:
        return
    inspect(R36_VERIFY, PINNED_R36_VERIFY, 0)
    with predecessor_environment_compatibility():
        namespace = runpy.run_path(str(R36_VERIFY))
        runtime = namespace["verify"].__globals__
        runtime["RELEASE"] = RELEASE
        runtime["ARTIFACTS"] = ARTIFACTS
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
    print("SIDEQUEST_SELLER_PATCH_R38_TARGET=PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop) as error:
        print("SIDEQUEST_SELLER_PATCH_R38_TARGET=STOPPED:" + str(error))
        raise SystemExit(1)
