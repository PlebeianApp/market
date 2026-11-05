#!/usr/bin/env python3
"""Adopt four exact monotonic public signer enrollments and restart R30 once."""

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

STAGE = Path("/tmp/plebeian-r30-enrollment-stage-523804")
UNIT = Path("/etc/systemd/system/plebeian-friday-authority.service")
SERVICE = "plebeian-friday-authority.service"
PUBLIC_GID = 988
OTHER_SERVICES = [
    "plebeian-friday-fips.service", "plebeian-friday-mint.service",
    "plebeian-friday-observer.service", "plebeian-friday-coordinator.service",
    "plebeian-friday-site.service", "nginx.service",
]
NEW = {
    1: (1_177, "69633f444a42558bb86a4994a22a762a6fc2ba9c0e36869e53f628b2193d39e4"),
    2: (1_177, "aa7772fbe9de6785d0f4bb4bd07ab9e6e924c8b380aa9686b71c53bcc6376d3e"),
    3: (1_177, "e5f55db2da5c9b98d09a2bd1bafc9b61e42ae2020a2ff86a38cf0c3e63e1ae0e"),
    4: (1_177, "9d680b4015a0674a3a82741141cf407659df56d08bf6a95a4eabfeb4ffdbaa6c"),
}
CURRENT = {
    1: (1_177, "072bb6fa2683ef84c99daeeea1fd424d1de8aee6590b72a49b39d5125bbd9c2c", 4),
    2: (1_177, "af5c7e806d377246d36e7a81a65393825b1c61579e7dbfbcfefd9fa35c726e59", 3),
    3: (1_177, "12cec7416c9de85c2093abb1ba52a438556739743b0e336cb100b72eee08dcd1", 3),
    4: (1_177, "69dc086e440d142a0110220d7623ea3d800fcd60ccad3ba5b9c8a9af9d0de3b4", 3),
}
ACTIVATION = (1_818, "228a2a83ac51999ff7eb12b1911e238746067d100ea05645961b74859ef316de")
FINAL = (1_840, "5e9aaff019a8fe9b633e5af58fe2dece50edd153465a97374cb9dddae0eaab6f")


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


def inspect(path: Path, expected: tuple[int, str], mode: int, uid: int, gid: int) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
                and stat.S_IMODE(before.st_mode) == mode and before.st_uid == uid and before.st_gid == gid,
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


def copy_create_once(source: Path, target: Path, mode: int, gid: int) -> None:
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode)
    try:
        with source.open("rb") as input_stream, os.fdopen(descriptor, "wb", closefd=False) as output_stream:
            shutil.copyfileobj(input_stream, output_stream, 1 << 20)
            output_stream.flush()
            os.fsync(output_stream.fileno())
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, 0, gid)
    finally:
        os.close(descriptor)


def atomic_replace(source: Path, target: Path, mode: int, gid: int) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix="." + target.name + ".r30-", dir=target.parent)
    temp_path = Path(temporary)
    try:
        with source.open("rb") as input_stream, os.fdopen(descriptor, "wb", closefd=False) as output_stream:
            shutil.copyfileobj(input_stream, output_stream, 1 << 20)
            output_stream.flush()
            os.fsync(output_stream.fileno())
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, 0, gid)
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
    for slot, expected in NEW.items():
        inspect(STAGE / f"signer-{slot}.json", expected, 0o600, 0, 0)
    inspect(STAGE / "authority-activation.service", ACTIVATION, 0o600, 0, 0)
    inspect(STAGE / "authority-final.service", FINAL, 0o600, 0, 0)
    inspect(UNIT, FINAL, 0o644, 0, 0)
    current_service = active(SERVICE)
    require(current_service.get("NRestarts") == "0", "AUTHORITY_RESTARTED")
    for service in OTHER_SERVICES:
        active(service)
    for slot, (size, digest, epoch) in CURRENT.items():
        target = Path(f"/var/lib/plebeian-auctions-friday/frost-v3/node-{slot}/signer-enrollment-public.json")
        backup = target.with_name(target.name + f".pre-r30-epoch-{epoch}")
        require(not backup.exists(), "BACKUP_EXISTS:" + str(backup))
        inspect(target, (size, digest), 0o640, 0, PUBLIC_GID)

    run(["/usr/bin/systemctl", "stop", SERVICE])
    stopped = props(SERVICE)
    require(stopped.get("ActiveState") == "inactive" and stopped.get("MainPID") == "0", "AUTHORITY_NOT_STOPPED")
    for slot, (size, digest, epoch) in CURRENT.items():
        target = Path(f"/var/lib/plebeian-auctions-friday/frost-v3/node-{slot}/signer-enrollment-public.json")
        backup = target.with_name(target.name + f".pre-r30-epoch-{epoch}")
        copy_create_once(target, backup, 0o640, PUBLIC_GID)
        atomic_replace(STAGE / f"signer-{slot}.json", target, 0o640, PUBLIC_GID)
        inspect(target, NEW[slot], 0o640, 0, PUBLIC_GID)

    atomic_replace(STAGE / "authority-activation.service", UNIT, 0o644, 0)
    run(["/usr/bin/systemctl", "daemon-reload"])
    run(["/usr/bin/systemctl", "reset-failed", SERVICE])
    run(["/usr/bin/systemctl", "start", SERVICE])
    initial = active(SERVICE)
    prior_height = 0
    ready_samples = 0
    observed: dict[str, object] = {}
    for _ in range(12):
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
    atomic_replace(STAGE / "authority-final.service", UNIT, 0o644, 0)
    run(["/usr/bin/systemctl", "daemon-reload"])
    final = active(SERVICE)
    require(final.get("MainPID") == initial.get("MainPID") and final.get("NRestarts") == "0", "FINAL_UNIT_RESTARTED")
    for service in OTHER_SERVICES:
        active(service)
    print(json.dumps({
        "schema": "PLEBEIAN_AUTHORITY_ENROLLMENT_R30_ACTUAL_V1", "status": "COMPLETE",
        "mainPID": final.get("MainPID"), "nRestarts": final.get("NRestarts"),
        "readySamples": ready_samples, "height": prior_height, "queuePending": observed.get("queuePending"),
    }, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop, subprocess.SubprocessError) as error:
        print(json.dumps({
            "schema": "PLEBEIAN_AUTHORITY_ENROLLMENT_R30_ACTUAL_V1", "status": "STOPPED",
            "error": str(error)[:500],
        }, sort_keys=True, separators=(",", ":")))
        raise SystemExit(1)
