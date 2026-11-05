#!/usr/bin/env python3
"""Create-once R26 APP authority adoption from the settled R25 diagnostic stop."""

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
import urllib.error
import urllib.request

STAGE = Path("/tmp/plebeian-r26-authority-stage-481072")
RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-finality-r26")
UNIT = Path("/etc/systemd/system/plebeian-friday-authority.service")
PRESERVED_UNIT = Path("/etc/systemd/system/plebeian-friday-authority.pre-r26-d6edd8f09767.service")
R25 = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-close-diag-r25/bin/plebeian-friday-authority")
SERVICE = "plebeian-friday-authority.service"
OTHER_SERVICES = ["plebeian-friday-fips.service", "plebeian-friday-mint.service",
                  "plebeian-friday-observer.service", "plebeian-friday-coordinator.service",
                  "plebeian-friday-site.service", "nginx.service"]
FILES = {
    "plebeian-friday-authority": (100_441_878, "e0e9d7b68f193ab7abad26fac7c0c991e155b84a5c72b88a20f3f86307ce392c"),
    "verify-friday-separated-target.py": (1_199, "8df6d25cc3c25780d36ba3d0505ea6229c9315e7692cd7ef59b262bfc69a1178"),
    "authority-activation.service": (1_820, "5c79a9674ad12a76ae742e44aaca13c2bb7ed5dc9eeccb1d6eb6fecb53eb373f"),
    "authority-final.service": (1_842, "ab8a473ab7f4e9c1fd8245f455bc4645dfdebd6f77bd3cf5c94287c561a2ff52"),
}


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value: raise Stop(category)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""): digest.update(block)
    return digest.hexdigest()


def inspect(path: Path, expected: tuple[int, str], mode: int) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and stat.S_IMODE(before.st_mode) == mode,
                "UNSAFE:" + str(path))
        require(before.st_size == expected[0] and sha256(Path(f"/proc/self/fd/{descriptor}")) == expected[1],
                "CONTENT:" + str(path))
        after = os.fstat(descriptor)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), "CHANGED:" + str(path))
    finally: os.close(descriptor)


def run(args: list[str], timeout: int = 45) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
    require(result.returncode == 0, "COMMAND:" + args[0] + ":" + result.stderr[:300])
    return result


def props(name: str) -> dict[str, str]:
    result = run(["/usr/bin/systemctl", "show", name, "--property=ActiveState,SubState,NRestarts,MainPID,ExecMainStatus"])
    return dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)


def active(name: str) -> dict[str, str]:
    state = props(name); require(state.get("ActiveState") == "active" and state.get("SubState") == "running", "SERVICE:" + name)
    return state


def copy_create_once(source: Path, target: Path, mode: int) -> None:
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode)
    try:
        with source.open("rb") as input_stream, os.fdopen(descriptor, "wb", closefd=False) as output_stream:
            shutil.copyfileobj(input_stream, output_stream, 1 << 20); output_stream.flush(); os.fsync(output_stream.fileno())
        os.fchmod(descriptor, mode); os.fchown(descriptor, 0, 0)
    finally: os.close(descriptor)


def atomic_replace(source: Path, target: Path, mode: int) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix="." + target.name + ".r26-", dir=target.parent); temp_path = Path(temporary)
    try:
        with source.open("rb") as input_stream, os.fdopen(descriptor, "wb", closefd=False) as output_stream:
            shutil.copyfileobj(input_stream, output_stream, 1 << 20); output_stream.flush(); os.fsync(output_stream.fileno())
        os.fchmod(descriptor, mode); os.fchown(descriptor, 0, 0); os.close(descriptor); descriptor = -1
        os.replace(temp_path, target)
        directory = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if descriptor >= 0: os.close(descriptor)
        if temp_path.exists(): temp_path.unlink()


def status() -> dict[str, object]:
    request = urllib.request.Request("http://127.0.0.1:8181/api/friday/status", headers={"Accept": "application/json"})
    try: response = urllib.request.urlopen(request, timeout=4)
    except urllib.error.HTTPError as error: return json.loads(error.read(1 << 20))
    with response: return json.loads(response.read(1 << 20))


def main() -> int:
    result: dict[str, object] = {"schema": "PLEBEIAN_AUTHORITY_FINALITY_R26_ACTUAL_V1", "status": "STOPPED"}
    require(os.geteuid() == 0 and STAGE.is_dir() and not STAGE.is_symlink(), "ROOT_OR_STAGE")
    for name, expected in FILES.items(): inspect(STAGE / name, expected, 0o600)
    require(not RELEASE.exists() and not PRESERVED_UNIT.exists(), "CREATE_ONCE_TARGET_EXISTS")
    inspect(R25, (100_441_389, "d33a912ee65b1239773834c92d1b52a6871b5e4f47cf7dd3a7fc5881f1e2b8d5"), 0o755)
    inspect(UNIT, (1_834, "d6edd8f09767bd5d1e7d791e6b9899f264504fd908545fa4a0a0cac3b59dbf30"), 0o644)
    current = props(SERVICE)
    require(current.get("ActiveState") == "failed" and current.get("MainPID") == "0" and current.get("NRestarts") == "18",
            "AUTHORITY_STATE_CHANGED")
    for service in OTHER_SERVICES: active(service)
    (RELEASE / "bin").mkdir(parents=True, mode=0o755)
    os.chown(RELEASE, 0, 0); os.chown(RELEASE / "bin", 0, 0); os.chmod(RELEASE, 0o755); os.chmod(RELEASE / "bin", 0o755)
    copy_create_once(STAGE / "plebeian-friday-authority", RELEASE / "bin/plebeian-friday-authority", 0o755)
    copy_create_once(STAGE / "verify-friday-separated-target.py", RELEASE / "bin/verify-friday-separated-target.py", 0o755)
    copy_create_once(UNIT, PRESERVED_UNIT, 0o644)
    atomic_replace(STAGE / "authority-activation.service", UNIT, 0o644)
    run(["/usr/bin/systemctl", "daemon-reload"]); run(["/usr/bin/systemctl", "reset-failed", SERVICE])
    run(["/usr/bin/systemctl", "start", SERVICE])
    initial = active(SERVICE)
    for _ in range(20):
        time.sleep(1); active(SERVICE)
    observed = status()
    atomic_replace(STAGE / "authority-final.service", UNIT, 0o644)
    run(["/usr/bin/systemctl", "daemon-reload"])
    final = active(SERVICE); require(final.get("MainPID") == initial.get("MainPID"), "FINAL_UNIT_RESTARTED")
    for service in OTHER_SERVICES: active(service)
    result.update({"status": "COMPLETE", "mainPID": final.get("MainPID"), "nRestarts": final.get("NRestarts"),
                   "queuePending": observed.get("queuePending"), "newOperationsReady": observed.get("newOperationsReady"),
                   "release": str(RELEASE)})
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try: raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop, subprocess.SubprocessError) as error:
        print(json.dumps({"schema": "PLEBEIAN_AUTHORITY_FINALITY_R26_ACTUAL_V1", "status": "STOPPED", "error": str(error)[:500]}, sort_keys=True, separators=(",", ":")))
        raise SystemExit(1)
