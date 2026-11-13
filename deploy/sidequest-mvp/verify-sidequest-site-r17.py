#!/usr/bin/env python3
"""Verify the R17 no-per-bid-seller-approval site through deployed R14."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import runpy
import stat


RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r17")
R14_VERIFY = Path(
    "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-site-r14/bin/verify-friday-separated-target.py"
)
PINNED_R14_VERIFY = (
    5_679,
    "d589c4f697c4feb226eb60c7fbbe04c857f9c1f263eb05ceb2774e1117f0347f",
)
SITE = (
    46_625_128,
    "ae6f901b9f3fdc20686c6cd954522561f9b0252916cfbd9587606ee432488dec",
)
FRESHNESS = {
    "PLEBEIAN_AUCTION_PAYOUT_MAX_HEAD_AGE_SECONDS": "10",
    "PLEBEIAN_AUCTION_PAYOUT_MAX_FUTURE_SKEW_SECONDS": "2",
}
ENVIRONMENT_PATH = "/etc/plebeian-auctions-friday/friday.env"
PREDECESSOR_ENVIRONMENT = (
    2_281,
    "0f01031a9ad89cb55bcdd401acb0860a03a3c7b4015bd876ff6fd9c6d2ce538f",
)
SUCCESSOR_ENVIRONMENT = (
    2_379,
    "0ee688038d56985fc7fe8f2a9970619fa36afdca5fd1bd9bf1c1e40c3b8a3f74",
)


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


@contextmanager
def predecessor_environment_compatibility():
    """Allow only R38's two pinned fields through the predecessor contract."""
    original = runpy.run_path

    def compatible(path: str, *args, **kwargs):
        namespace = original(path, *args, **kwargs)
        common = namespace.get("COMMON")
        verify_values = namespace.get("verify_values")
        if isinstance(common, set) and "FRIDAY_ROLE" in common and callable(verify_values):
            extended = common | set(FRESHNESS)
            namespace["COMMON"] = extended
            verify_values.__globals__["COMMON"] = extended
        public_config = namespace.get("PUBLIC_CONFIG")
        verify = namespace.get("verify")
        if isinstance(public_config, dict) and ENVIRONMENT_PATH in public_config and callable(verify):
            require(public_config[ENVIRONMENT_PATH] == PREDECESSOR_ENVIRONMENT, "PREDECESSOR_ENVIRONMENT_PIN")
            successor_config = {**public_config, ENVIRONMENT_PATH: SUCCESSOR_ENVIRONMENT}
            namespace["PUBLIC_CONFIG"] = successor_config
            verify.__globals__["PUBLIC_CONFIG"] = successor_config
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
    require(service == "plebeian-friday-site.service", "SERVICE")
    inspect(release / "bin" / "plebeian-auctions-mvp", SITE, os.geteuid() if fixture else 0)
    exact_environment(environment)
    if fixture:
        return
    inspect(R14_VERIFY, PINNED_R14_VERIFY, 0)
    with predecessor_environment_compatibility():
        namespace = runpy.run_path(str(R14_VERIFY))
        runtime = namespace["verify"].__globals__
        runtime["PATCH_RELEASE"] = RELEASE
        runtime["SITE"] = SITE
        runtime["__file__"] = str(RELEASE / "bin/verify-friday-separated-target.py")
        namespace["verify"](
            environment,
            application,
            service,
            RELEASE,
            runtime["R11_GUARD"],
            runtime["R10_GUARD"],
            runtime["R9_GUARD"],
            runtime["R8_GUARD"],
            runtime["R7_GUARD"],
            runtime["R6_GUARD"],
            runtime["R5_GUARD"],
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--service", required=True)
    parser.add_argument("--fixture-release-root", type=Path)
    args = parser.parse_args()
    release = RELEASE if args.fixture_release_root is None else args.fixture_release_root.resolve()
    verify(args.environment, args.application, args.service, release)
    print("SIDEQUEST_SITE_R17_TARGET=PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop) as error:
        print("SIDEQUEST_SITE_R17_TARGET=STOPPED:" + str(error))
        raise SystemExit(1)
