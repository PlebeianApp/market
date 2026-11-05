#!/usr/bin/env python3
"""Verify the APP-only R21 payload-free Comet stage diagnostic authority."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import runpy
import stat

RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-comet-stage-r21")
R16_RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-aggregate-r16")
R10_RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-backend-r10")
AUTHORITY_CONFIG = Path("/etc/plebeian-auctions-friday/authority.json")
AUTHORITY = (100_438_243, "923bd3421fa0eda693933ddbd53518a11a1a53e177cb91c8cbef7e1ae5af9af7")
PARTICIPANT = (2_411_344, "9158e90fe9807f65fadc121d5296cf29d4328928fd7bf3cb5df016202d97b993")
CONFIG = (363, "141603382ea90a7079402bc74fbf28e26cc71cddae1d1b55a118268dcdf7e435")

class Stop(RuntimeError):
    pass

def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)

def inspect(path: Path, expected: tuple[int, str], mode: int, uid: int, gid: int | None = None) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "UNSAFE:" + str(path))
        require(before.st_size == expected[0], "BYTES:" + str(path))
        require(stat.S_IMODE(before.st_mode) == mode and before.st_uid == uid, "METADATA:" + str(path))
        if gid is not None:
            require(before.st_gid == gid, "GROUP:" + str(path))
        digest = hashlib.sha256()
        while True:
            block = os.read(descriptor, 1 << 20)
            if not block:
                break
            digest.update(block)
        after = os.fstat(descriptor)
        identity = lambda item: (item.st_dev, item.st_ino, item.st_mode, item.st_size, item.st_mtime_ns, item.st_ctime_ns, item.st_nlink)
        require(identity(before) == identity(after), "CHANGED:" + str(path))
        require(digest.hexdigest() == expected[1], "SHA256:" + str(path))
    finally:
        os.close(descriptor)

def verify(environment: Path, application: Path, service: str) -> None:
    require(Path(__file__) == RELEASE / "bin/verify-friday-separated-target.py", "FIXED_INVOCATION")
    require(service == "plebeian-friday-authority.service", "SERVICE")
    inspect(RELEASE / "bin/plebeian-friday-authority", AUTHORITY, 0o755, 0, 0)
    inspect(R16_RELEASE / "bin/coco-demo-frost-participant-3of4", PARTICIPANT, 0o755, 0, 0)
    inspect(AUTHORITY_CONFIG, CONFIG, 0o640, 0, 988)
    base = runpy.run_path(str(R10_RELEASE / "bin/verify-friday-separated-target.py"))
    base["verify"](environment, application, service, R10_RELEASE)

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--service", required=True)
    args = parser.parse_args()
    verify(args.environment, args.application, args.service)
    print("SIDEQUEST_AUTHORITY_COMET_STAGE_R21_TARGET=PASS")
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop) as error:
        print("SIDEQUEST_AUTHORITY_COMET_STAGE_R21_TARGET=STOPPED:" + str(error))
        raise SystemExit(1)
