#!/usr/bin/env python3
"""Create-once R30 APP authority adoption after the settled R29 wrapper stop."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import runpy
import stat

STAGE = Path("/tmp/plebeian-r30-authority-stage-110537")
BASE = STAGE / "controller-base-r26.py"
RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-finality-r30")
UNIT = Path("/etc/systemd/system/plebeian-friday-authority.service")
PRESERVED_UNIT = Path("/etc/systemd/system/plebeian-friday-authority.pre-r30-8c7e89e95ddb.service")
R29 = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-finality-r29/bin/plebeian-friday-authority")
SERVICE = "plebeian-friday-authority.service"
OTHER_SERVICES = [
    "plebeian-friday-fips.service", "plebeian-friday-mint.service",
    "plebeian-friday-observer.service", "plebeian-friday-coordinator.service",
    "plebeian-friday-site.service", "nginx.service",
]
FILES = {
    "plebeian-friday-authority": (100_443_589, "af5c488c90f85a5829ffc524e46af8b44d24b442813ae6896e504b0aafe7ea72"),
    "verify-friday-separated-target.py": (1_197, "12eeb12a06848388c9b0b21240d88b918a8d2c0433b88bd416774b6e8a559501"),
    "authority-activation.service": (1_818, "228a2a83ac51999ff7eb12b1911e238746067d100ea05645961b74859ef316de"),
    "authority-final.service": (1_840, "5e9aaff019a8fe9b633e5af58fe2dece50edd153465a97374cb9dddae0eaab6f"),
}
BASE_EXPECTED = (7_737, "2e4a2875dda6b8095c7b3edb46b4cccf774e62ef8e133a56ff0a0b5fb7c7aa39")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_base() -> None:
    descriptor = os.open(BASE, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        metadata = os.fstat(descriptor)
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1
                or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_size != BASE_EXPECTED[0]
                or sha256(Path(f"/proc/self/fd/{descriptor}")) != BASE_EXPECTED[1]):
            raise RuntimeError("CONTROLLER_BASE")
    finally:
        os.close(descriptor)


def main() -> int:
    if os.geteuid() != 0 or not STAGE.is_dir() or STAGE.is_symlink():
        raise RuntimeError("ROOT_OR_STAGE")
    verify_base()
    base = runpy.run_path(str(BASE))
    inspect = base["inspect"]
    require = base["require"]
    props = base["props"]
    active = base["active"]
    copy_create_once = base["copy_create_once"]
    atomic_replace = base["atomic_replace"]
    run = base["run"]
    status = base["status"]

    for name, expected in FILES.items():
        inspect(STAGE / name, expected, 0o600)
    require(not RELEASE.exists() and not PRESERVED_UNIT.exists(), "CREATE_ONCE_TARGET_EXISTS")
    inspect(R29, (100_443_505, "6b42d3c44433ed0b55c8d31fdb603c841a68583e7a4e76b5d789f45ea9f07e38"), 0o755)
    inspect(UNIT, (1_823, "8c7e89e95ddb7fda06d3dfad355eb9170fcdcf52637a49b45590913f544a14ed"), 0o644)
    current = props(SERVICE)
    require(current.get("ActiveState") == "failed" and current.get("MainPID") == "0"
            and current.get("NRestarts") == "0", "AUTHORITY_STATE_CHANGED")
    for service in OTHER_SERVICES:
        active(service)

    (RELEASE / "bin").mkdir(parents=True, mode=0o755)
    os.chown(RELEASE, 0, 0)
    os.chown(RELEASE / "bin", 0, 0)
    os.chmod(RELEASE, 0o755)
    os.chmod(RELEASE / "bin", 0o755)
    copy_create_once(STAGE / "plebeian-friday-authority", RELEASE / "bin/plebeian-friday-authority", 0o755)
    copy_create_once(STAGE / "verify-friday-separated-target.py", RELEASE / "bin/verify-friday-separated-target.py", 0o755)
    copy_create_once(UNIT, PRESERVED_UNIT, 0o644)
    atomic_replace(STAGE / "authority-activation.service", UNIT, 0o644)
    run(["/usr/bin/systemctl", "daemon-reload"])
    run(["/usr/bin/systemctl", "reset-failed", SERVICE])
    run(["/usr/bin/systemctl", "start", SERVICE])
    initial = active(SERVICE)
    for _ in range(20):
        base["time"].sleep(1)
        active(SERVICE)
    observed = status()
    atomic_replace(STAGE / "authority-final.service", UNIT, 0o644)
    run(["/usr/bin/systemctl", "daemon-reload"])
    final = active(SERVICE)
    require(final.get("MainPID") == initial.get("MainPID"), "FINAL_UNIT_RESTARTED")
    for service in OTHER_SERVICES:
        active(service)
    print(json.dumps({
        "schema": "PLEBEIAN_AUTHORITY_FINALITY_R30_ACTUAL_V1", "status": "COMPLETE",
        "mainPID": final.get("MainPID"), "nRestarts": final.get("NRestarts"),
        "queuePending": observed.get("queuePending"),
        "newOperationsReady": observed.get("newOperationsReady"), "release": str(RELEASE),
    }, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({
            "schema": "PLEBEIAN_AUTHORITY_FINALITY_R30_ACTUAL_V1", "status": "STOPPED",
            "error": str(error)[:500],
        }, sort_keys=True, separators=(",", ":")))
        raise SystemExit(1)
