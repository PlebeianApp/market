#!/usr/bin/env python3
"""Create-once R31 APP authority adoption with bounded H+2 finality."""

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

STAGE = Path("/tmp/plebeian-r31-authority-stage-294171")
RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-finality-r31")
UNIT = Path("/etc/systemd/system/plebeian-friday-authority.service")
PRESERVED_UNIT = Path("/etc/systemd/system/plebeian-friday-authority.pre-r31-5e9aaff019a8.service")
R30 = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-finality-r30/bin/plebeian-friday-authority")
SERVICE = "plebeian-friday-authority.service"
OTHER_SERVICES = [
    "plebeian-friday-fips.service", "plebeian-friday-mint.service",
    "plebeian-friday-observer.service", "plebeian-friday-coordinator.service",
    "plebeian-friday-site.service", "nginx.service",
]
FILES = {
    "plebeian-friday-authority": (100_444_474, "55f7ca93e681d204c0b724e564525b504456d41896cb89752cea17541e229391"),
    "verify-friday-separated-target.py": (1_201, "db54ee72dcde88fff024e3b8d6c23c5e36e0f44cb5d9ac15e37b3bea4cd0a34a"),
    "authority-activation.service": (1_813, "9b5a99c9a189bc80ba9f151e1dd7f0754feb927fec7e8ca3acba4b9cad3cbf16"),
    "authority-final.service": (1_880, "c3f30d0489c062f76f64c96d4d4e06380465d6ebb3bcc73a8931c29819195813"),
}
R30_AUTHORITY = (100_443_589, "af5c488c90f85a5829ffc524e46af8b44d24b442813ae6896e504b0aafe7ea72")
R30_UNIT = (1_840, "5e9aaff019a8fe9b633e5af58fe2dece50edd153465a97374cb9dddae0eaab6f")


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


def inspect(path: Path, expected: tuple[int, str], mode: int) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
                and stat.S_IMODE(before.st_mode) == mode and before.st_uid == 0 and before.st_gid == 0,
                "UNSAFE:" + str(path))
        require(before.st_size == expected[0] and sha256(Path(f"/proc/self/fd/{descriptor}")) == expected[1],
                "CONTENT:" + str(path))
        after = os.fstat(descriptor)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                "CHANGED:" + str(path))
    finally:
        os.close(descriptor)


def run(args: list[str], timeout: int = 45) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
    require(result.returncode == 0, "COMMAND:" + args[0] + ":" + result.stderr[:300])
    return result


def props(name: str) -> dict[str, str]:
    result = run(["/usr/bin/systemctl", "show", name,
                  "--property=ActiveState,SubState,NRestarts,MainPID,ExecMainStatus"])
    return dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)


def active(name: str) -> dict[str, str]:
    value = props(name)
    require(value.get("ActiveState") == "active" and value.get("SubState") == "running", "SERVICE:" + name)
    return value


def copy_create_once(source: Path, target: Path, mode: int) -> None:
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode)
    try:
        with source.open("rb") as input_stream, os.fdopen(descriptor, "wb", closefd=False) as output_stream:
            shutil.copyfileobj(input_stream, output_stream, 1 << 20)
            output_stream.flush()
            os.fsync(output_stream.fileno())
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, 0, 0)
    finally:
        os.close(descriptor)


def atomic_replace(source: Path, target: Path, mode: int) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix="." + target.name + ".r31-", dir=target.parent)
    temp_path = Path(temporary)
    try:
        with source.open("rb") as input_stream, os.fdopen(descriptor, "wb", closefd=False) as output_stream:
            shutil.copyfileobj(input_stream, output_stream, 1 << 20)
            output_stream.flush()
            os.fsync(output_stream.fileno())
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, 0, 0)
        os.close(descriptor)
        descriptor = -1
        os.replace(temp_path, target)
        directory = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if temp_path.exists():
            temp_path.unlink()


def status() -> dict[str, object]:
    request = urllib.request.Request("http://127.0.0.1:8181/api/friday/status", headers={"Accept": "application/json"})
    try:
        response = urllib.request.urlopen(request, timeout=4)
    except urllib.error.HTTPError as error:
        return json.loads(error.read(1 << 20))
    with response:
        return json.loads(response.read(1 << 20))


def main() -> int:
    require(os.geteuid() == 0 and STAGE.is_dir() and not STAGE.is_symlink(), "ROOT_OR_STAGE")
    for name, expected in FILES.items():
        inspect(STAGE / name, expected, 0o600)
    require(not RELEASE.exists() and not PRESERVED_UNIT.exists(), "CREATE_ONCE_TARGET_EXISTS")
    inspect(R30, R30_AUTHORITY, 0o755)
    inspect(UNIT, R30_UNIT, 0o644)
    current = active(SERVICE)
    require(current.get("NRestarts") == "0", "AUTHORITY_RESTARTED")
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

    run(["/usr/bin/systemctl", "stop", SERVICE])
    stopped = props(SERVICE)
    require(stopped.get("ActiveState") == "inactive" and stopped.get("MainPID") == "0", "AUTHORITY_NOT_STOPPED")
    atomic_replace(STAGE / "authority-activation.service", UNIT, 0o644)
    run(["/usr/bin/systemctl", "daemon-reload"])
    run(["/usr/bin/systemctl", "reset-failed", SERVICE])
    run(["/usr/bin/systemctl", "start", SERVICE])
    initial = active(SERVICE)
    prior_height = 0
    ready_samples = 0
    observed: dict[str, object] = {}
    for _ in range(16):
        time.sleep(3)
        active(SERVICE)
        observed = status()
        height = observed.get("lastCommittedHeight")
        if observed.get("newOperationsReady") is True and isinstance(height, int) and height > prior_height:
            ready_samples += 1
            prior_height = height
            if ready_samples >= 2:
                break
        else:
            ready_samples = 0
            if isinstance(height, int):
                prior_height = height
    require(ready_samples >= 2, "READINESS:" + str(observed.get("readinessReason")))
    atomic_replace(STAGE / "authority-final.service", UNIT, 0o644)
    run(["/usr/bin/systemctl", "daemon-reload"])
    final = active(SERVICE)
    require(final.get("MainPID") == initial.get("MainPID") and final.get("NRestarts") == "0", "FINAL_UNIT_RESTARTED")
    for service in OTHER_SERVICES:
        active(service)
    print(json.dumps({
        "schema": "PLEBEIAN_AUTHORITY_FINALITY_R31_ACTUAL_V1", "status": "COMPLETE",
        "mainPID": final.get("MainPID"), "nRestarts": final.get("NRestarts"),
        "readySamples": ready_samples, "height": prior_height,
        "queuePending": observed.get("queuePending"), "release": str(RELEASE),
    }, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop, subprocess.SubprocessError) as error:
        print(json.dumps({
            "schema": "PLEBEIAN_AUTHORITY_FINALITY_R31_ACTUAL_V1", "status": "STOPPED",
            "error": str(error)[:500],
        }, sort_keys=True, separators=(",", ":")))
        raise SystemExit(1)
