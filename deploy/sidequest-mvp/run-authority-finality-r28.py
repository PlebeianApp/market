#!/usr/bin/env python3
"""Create-once R28 APP authority adoption after the settled R27 cutoff stop."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import runpy
import stat

STAGE = Path("/tmp/plebeian-r28-authority-stage-849233")
BASE = STAGE / "controller-base-r26.py"
RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-finality-r28")
UNIT = Path("/etc/systemd/system/plebeian-friday-authority.service")
PRESERVED_UNIT = Path("/etc/systemd/system/plebeian-friday-authority.pre-r28-3a1cdf12fab3.service")
R27 = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-finality-r27/bin/plebeian-friday-authority")
SERVICE = "plebeian-friday-authority.service"
OTHER_SERVICES = [
    "plebeian-friday-fips.service", "plebeian-friday-mint.service",
    "plebeian-friday-observer.service", "plebeian-friday-coordinator.service",
    "plebeian-friday-site.service", "nginx.service",
]
FILES = {
    "plebeian-friday-authority": (100_442_979, "adc8dd63c58018f7857a7939c779bcbdaf0432f6843296b88eb68a62f2814045"),
    "verify-friday-separated-target.py": (1_196, "9e7f6a095ec7fb1571554f058796d551c2308cc14d642e65a988371f72be72fb"),
    "authority-activation.service": (1_818, "74473a7e7b1a5fd447a7f0d9128cab96788a90d073a305c5f492d5cf4cbd5c8e"),
    "authority-final.service": (1_840, "619ee9e346bcb435d836825bcab002e04026ed0aea96782ca8760efb68f8d71c"),
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
    inspect(R27, (100_441_805, "bed004568fbd10211cede9e47a77b4078a1880108ef28f4acb3046c4094847cd"), 0o755)
    inspect(UNIT, (1_820, "3a1cdf12fab3fd6eb35419634a49fed0f1cdaab645f8467a6af3f41a31ec2b0b"), 0o644)
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
        "schema": "PLEBEIAN_AUTHORITY_FINALITY_R28_ACTUAL_V1", "status": "COMPLETE",
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
            "schema": "PLEBEIAN_AUTHORITY_FINALITY_R28_ACTUAL_V1", "status": "STOPPED",
            "error": str(error)[:500],
        }, sort_keys=True, separators=(",", ":")))
        raise SystemExit(1)
