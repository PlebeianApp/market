#!/usr/bin/env python3
"""Install R25 once and capture only its fixed close-policy field category."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import time

STAGE = Path("/tmp/plebeian-r25-stage-113905")
RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-close-diag-r25")
UNIT = Path("/etc/systemd/system/plebeian-friday-authority.service")
PRESERVED_UNIT = Path("/etc/systemd/system/plebeian-friday-authority.pre-r25-b4cfa7d1ab13.service")
R24 = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-terminal-r24/bin/plebeian-friday-authority")
SERVICE = "plebeian-friday-authority.service"
OTHER_SERVICES = [
    "plebeian-friday-fips.service", "plebeian-friday-mint.service",
    "plebeian-friday-observer.service", "plebeian-friday-coordinator.service",
    "plebeian-friday-site.service", "nginx.service",
]

FILES = {
    "plebeian-friday-authority": (100_441_389, "d33a912ee65b1239773834c92d1b52a6871b5e4f47cf7dd3a7fc5881f1e2b8d5"),
    "verify-friday-separated-target.py": (1_214, "c73950607e8ce4fd72f2b0e1de598fabd82db03feee396e8a9a92420f59eed5d"),
    "authority.service": (1_834, "d6edd8f09767bd5d1e7d791e6b9899f264504fd908545fa4a0a0cac3b59dbf30"),
}
CURRENT = {
    R24: (100_440_746, "9c9ba5178ffbcbb35bc699f37877afe7275920b9bc12d30a5fafc01e2ac80531"),
    UNIT: (1_859, "b4cfa7d1ab13cff6b0f83e21fa99bedc5587c973cf2f3c59aebc813aad8a2573"),
}


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def inspect(path: Path, expected: tuple[int, str], mode: int | None = None) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "UNSAFE:" + str(path))
        require(before.st_size == expected[0] and sha256(Path(f"/proc/self/fd/{descriptor}")) == expected[1], "CONTENT:" + str(path))
        if mode is not None:
            require(stat.S_IMODE(before.st_mode) == mode, "MODE:" + str(path))
        after = os.fstat(descriptor)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), "CHANGED:" + str(path))
    finally:
        os.close(descriptor)


def run(args: list[str], timeout: int = 40, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
    if check:
        require(result.returncode == 0, "COMMAND:" + args[0] + ":" + result.stderr[:300])
    return result


def props(name: str) -> dict[str, str]:
    result = run(["/usr/bin/systemctl", "show", name, "--property=ActiveState,SubState,NRestarts,MainPID,ExecMainStatus"])
    return dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)


def copy_create_once(source: Path, target: Path, mode: int) -> None:
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode)
    try:
        with source.open("rb") as input_stream, os.fdopen(descriptor, "wb", closefd=False) as output_stream:
            shutil.copyfileobj(input_stream, output_stream, 1 << 20)
            output_stream.flush(); os.fsync(output_stream.fileno())
        os.fchmod(descriptor, mode); os.fchown(descriptor, 0, 0)
    finally:
        os.close(descriptor)


def atomic_replace(source: Path, target: Path, mode: int) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix="." + target.name + ".r25-", dir=target.parent)
    temp_path = Path(temporary)
    try:
        with source.open("rb") as input_stream, os.fdopen(descriptor, "wb", closefd=False) as output_stream:
            shutil.copyfileobj(input_stream, output_stream, 1 << 20)
            output_stream.flush(); os.fsync(output_stream.fileno())
        os.fchmod(descriptor, mode); os.fchown(descriptor, 0, 0)
        os.close(descriptor); descriptor = -1
        os.replace(temp_path, target)
        directory = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if descriptor >= 0: os.close(descriptor)
        if temp_path.exists(): temp_path.unlink()


def main() -> int:
    result: dict[str, object] = {"schema": "PLEBEIAN_AUTHORITY_CLOSE_DIAG_R25_ACTUAL_V1", "status": "STOPPED"}
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    require(STAGE.is_dir() and not STAGE.is_symlink(), "STAGE")
    for name, expected in FILES.items(): inspect(STAGE / name, expected, 0o600)
    require(not RELEASE.exists() and not PRESERVED_UNIT.exists(), "CREATE_ONCE_TARGET_EXISTS")
    for path, expected in CURRENT.items(): inspect(path, expected, 0o755 if path == R24 else 0o644)
    current = props(SERVICE)
    require(current.get("ActiveState") == "inactive" and current.get("SubState") == "dead"
            and current.get("MainPID") == "0" and current.get("NRestarts") == "18", "AUTHORITY_STATE_CHANGED")
    for service in OTHER_SERVICES:
        state = props(service)
        require(state.get("ActiveState") == "active" and state.get("SubState") == "running", "SERVICE_NOT_ACTIVE:" + service)

    (RELEASE / "bin").mkdir(parents=True, mode=0o755)
    os.chown(RELEASE, 0, 0); os.chown(RELEASE / "bin", 0, 0)
    os.chmod(RELEASE, 0o755); os.chmod(RELEASE / "bin", 0o755)
    copy_create_once(STAGE / "plebeian-friday-authority", RELEASE / "bin/plebeian-friday-authority", 0o755)
    copy_create_once(STAGE / "verify-friday-separated-target.py", RELEASE / "bin/verify-friday-separated-target.py", 0o755)
    copy_create_once(UNIT, PRESERVED_UNIT, 0o644)
    atomic_replace(STAGE / "authority.service", UNIT, 0o644)
    run(["/usr/bin/systemctl", "daemon-reload"])
    start = run(["/usr/bin/systemctl", "start", SERVICE], timeout=45, check=False)
    time.sleep(2)
    final = props(SERVICE)
    require(start.returncode != 0 or final.get("ActiveState") == "failed", "DIAGNOSTIC_UNEXPECTEDLY_STAYED_ACTIVE")
    logs = run(["/usr/bin/journalctl", "-u", SERVICE, "-n", "40", "--no-pager", "--output=cat"]).stdout
    marker = "DEMO_INTEGRATED_T3_CLOSE_POLICY: mismatched fields: "
    categories = sorted({line.split(marker, 1)[1].splitlines()[0].strip() for line in logs.splitlines() if marker in line})
    require(len(categories) == 1 and categories[0] != "", "FIXED_DIAGNOSTIC_ABSENT")
    for service in OTHER_SERVICES:
        state = props(service)
        require(state.get("ActiveState") == "active" and state.get("SubState") == "running", "SERVICE_CHANGED:" + service)
    result.update({"status": "COMPLETE", "mismatchCategories": categories[0],
                   "authorityState": final.get("ActiveState"), "authorityNRestarts": final.get("NRestarts")})
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop, subprocess.SubprocessError) as error:
        print(json.dumps({"schema": "PLEBEIAN_AUTHORITY_CLOSE_DIAG_R25_ACTUAL_V1", "status": "STOPPED", "error": str(error)[:500]}, sort_keys=True, separators=(",", ":")))
        raise SystemExit(1)
