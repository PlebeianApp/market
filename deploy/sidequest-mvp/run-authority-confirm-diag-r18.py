#!/usr/bin/env python3
"""Install and activate the APP-only R18 confirmation diagnostic once."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


STAGE = Path("/tmp/plebeian-r18-stage-6631081")
RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-confirm-diag-r18")
R17_RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-aggregate-diag-r17")
CONFIG = Path("/etc/plebeian-auctions-friday/authority.json")
UNIT = Path("/etc/systemd/system/plebeian-friday-authority.service")
PRESERVED_UNIT = Path("/etc/systemd/system/plebeian-friday-authority.pre-r18-23a76cc6939b.service")
SCRATCH = Path("/var/lib/plebeian-auctions-friday/coordinator-v3/runtime/scratch")
BROADCAST_DB = Path("/var/lib/plebeian-auctions-friday/coordinator-v3/runtime/funding-broadcast.sqlite3")
SERVICE = "plebeian-friday-authority.service"
PRIOR_OPERATION = "838f9a82d9d99bb008319bd5d6e8a62e04e031eba97ae24e440f4ba8fab3535a"

FILES = {
    "plebeian-friday-authority": (100_438_080, "0f3dfb2f11332ee7b9981540a04e63fc676e73684d0338483ea0b24c9afbad73"),
    "verify-friday-separated-target.py": (3_403, "19bf04801eff913c1bdac72977003624427b954a0a67c1812021c5ed9001a3ed"),
    "authority-activation.service": (1_860, "a28382d71fe5946bc03f2c35439d773c9a4b081fa124286c7b61a73c33558384"),
    "authority-final.service": (1_868, "4de68e987ad94b19070dec5bfc2e2d392a59afc8a039464295c8665f74c1bd40"),
}
CURRENT = {
    R17_RELEASE / "bin/plebeian-friday-authority": (100_435_940, "5bbfc6319a7e1d0f603187d61bfa1a8e69ee0b0e2f978fb8e98f14433869dbb0"),
    CONFIG: (363, "141603382ea90a7079402bc74fbf28e26cc71cddae1d1b55a118268dcdf7e435"),
    UNIT: (1_859, "23a76cc6939b6dc0c59d8fc5c22993a276f4465eee2424257350cfce6a4f3d1b"),
}
OTHER_SERVICES = [
    "plebeian-friday-fips.service",
    "plebeian-friday-mint.service",
    "plebeian-friday-observer.service",
    "plebeian-friday-coordinator.service",
    "plebeian-friday-site.service",
    "nginx.service",
]


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


def inspect(path: Path, expected: tuple[int, str], mode: int | None = None,
            uid: int | None = None, gid: int | None = None) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "UNSAFE:" + str(path))
        require(before.st_size == expected[0], "BYTES:" + str(path))
        require(sha256(Path(f"/proc/self/fd/{descriptor}")) == expected[1], "SHA256:" + str(path))
        if mode is not None:
            require(stat.S_IMODE(before.st_mode) == mode, "MODE:" + str(path))
        if uid is not None:
            require(before.st_uid == uid, "UID:" + str(path))
        if gid is not None:
            require(before.st_gid == gid, "GID:" + str(path))
        after = os.fstat(descriptor)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), "CHANGED:" + str(path))
    finally:
        os.close(descriptor)


def run(args: list[str], timeout: int = 30) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
    require(result.returncode == 0, "COMMAND:" + args[0] + ":" + result.stderr[:500])
    return result


def service_properties(name: str) -> dict[str, str]:
    result = run(["/usr/bin/systemctl", "show", name, "--property=ActiveState,SubState,NRestarts,MainPID"])
    return dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)


def require_active(name: str) -> dict[str, str]:
    props = service_properties(name)
    require(props.get("ActiveState") == "active" and props.get("SubState") == "running", "SERVICE_NOT_ACTIVE:" + name)
    require(props.get("NRestarts") == "0", "SERVICE_RESTARTED:" + name)
    return props


def ready() -> dict[str, object]:
    request = urllib.request.Request("http://127.0.0.1:8181/api/friday/status", headers={"Accept": "application/json"})
    try:
        response = urllib.request.urlopen(request, timeout=4)
    except urllib.error.HTTPError as error:
        require(error.code == 503, "READINESS_HTTP:" + str(error.code))
        return json.loads(error.read(1 << 20))
    with response:
        require(response.status == 200, "READINESS_HTTP:" + str(response.status))
        return json.loads(response.read(1 << 20))


def require_ready(payload: dict[str, object]) -> int:
    require(payload.get("quarantined") is False, "QUARANTINED")
    require(payload.get("queuePending") == 0, "QUEUE_PENDING")
    require(payload.get("consensusAvailable") is True, "NO_CONSENSUS")
    require(payload.get("newOperationsReady") is True, "OPERATIONS_NOT_READY")
    require(payload.get("readinessReason") == "ready", "READINESS_REASON")
    height = payload.get("observedHeight")
    require(isinstance(height, int) and height > 0, "READINESS_HEIGHT")
    return height


def two_advancing_ready(attempts: int) -> list[int]:
    first: int | None = None
    for _ in range(attempts):
        try:
            height = require_ready(ready())
            if first is None:
                first = height
            elif height > first:
                return [first, height]
        except (OSError, ValueError, Stop):
            pass
        time.sleep(1)
    raise Stop("READINESS_TIMEOUT")


def copy_create_once(source: Path, target: Path, mode: int, uid: int, gid: int) -> None:
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode)
    try:
        with source.open("rb") as input_stream, os.fdopen(descriptor, "wb", closefd=False) as output_stream:
            shutil.copyfileobj(input_stream, output_stream, 1 << 20)
            output_stream.flush()
            os.fsync(output_stream.fileno())
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, uid, gid)
    finally:
        os.close(descriptor)


def atomic_replace(source: Path, target: Path, mode: int, uid: int, gid: int) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix="." + target.name + ".r18-", dir=target.parent)
    temp_path = Path(temporary)
    try:
        with source.open("rb") as input_stream, os.fdopen(descriptor, "wb", closefd=False) as output_stream:
            shutil.copyfileobj(input_stream, output_stream, 1 << 20)
            output_stream.flush()
            os.fsync(output_stream.fileno())
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, uid, gid)
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


def require_prior_uncommitted() -> None:
    database = sqlite3.connect(f"file:{BROADCAST_DB}?mode=ro", uri=True)
    try:
        row = database.execute(
            "SELECT phase, revision FROM friday_v4_broadcast_journal WHERE funding_operation_id = ?",
            (PRIOR_OPERATION,),
        ).fetchone()
    finally:
        database.close()
    require(row == ("prepared", 1), "PRIOR_OPERATION_CHANGED")


def main() -> int:
    result: dict[str, object] = {"schema": "PLEBEIAN_AUTHORITY_CONFIRM_DIAG_R18_ACTUAL_V1", "status": "STOPPED"}
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    require(STAGE.is_dir() and not STAGE.is_symlink(), "STAGE")
    for name, expected in FILES.items():
        inspect(STAGE / name, expected, 0o600, 0, 0)
    require(not RELEASE.exists(), "RELEASE_EXISTS")
    require(not PRESERVED_UNIT.exists(), "PRESERVED_EXISTS")
    for path, expected in CURRENT.items():
        inspect(path, expected, 0o755 if path.name == "plebeian-friday-authority" else (0o640 if path == CONFIG else 0o644), 0,
                0 if path.name == "plebeian-friday-authority" or path == UNIT else 988)
    scratch = SCRATCH.stat(follow_symlinks=False)
    require(stat.S_ISDIR(scratch.st_mode) and stat.S_IMODE(scratch.st_mode) == 0o700
            and scratch.st_uid == 999 and scratch.st_gid == 988, "SCRATCH_METADATA")
    require_prior_uncommitted()
    for service in OTHER_SERVICES:
        require_active(service)
    initial = require_active(SERVICE)
    two_advancing_ready(30)

    (RELEASE / "bin").mkdir(parents=True, mode=0o755)
    os.chown(RELEASE, 0, 0)
    os.chown(RELEASE / "bin", 0, 0)
    os.chmod(RELEASE, 0o755)
    os.chmod(RELEASE / "bin", 0o755)
    copy_create_once(STAGE / "plebeian-friday-authority", RELEASE / "bin/plebeian-friday-authority", 0o755, 0, 0)
    copy_create_once(STAGE / "verify-friday-separated-target.py", RELEASE / "bin/verify-friday-separated-target.py", 0o755, 0, 0)
    copy_create_once(UNIT, PRESERVED_UNIT, 0o644, 0, 0)
    atomic_replace(STAGE / "authority-activation.service", UNIT, 0o644, 0, 0)
    run(["/usr/bin/systemctl", "daemon-reload"])
    run(["/usr/bin/systemctl", "stop", SERVICE], timeout=40)
    require(service_properties(SERVICE).get("ActiveState") == "inactive", "STOP_FAILED")
    run(["/usr/bin/systemctl", "start", SERVICE], timeout=40)
    active = require_active(SERVICE)
    heights = two_advancing_ready(30)
    pid = active.get("MainPID")
    atomic_replace(STAGE / "authority-final.service", UNIT, 0o644, 0, 0)
    run(["/usr/bin/systemctl", "daemon-reload"])
    final = require_active(SERVICE)
    require(final.get("MainPID") == pid, "FINAL_UNIT_RESTARTED_SERVICE")
    require_ready(ready())
    require_prior_uncommitted()
    for service in OTHER_SERVICES:
        require_active(service)
    result.update({
        "status": "COMPLETE",
        "initialMainPID": initial.get("MainPID"),
        "finalMainPID": final.get("MainPID"),
        "readinessHeights": heights,
        "release": str(RELEASE),
        "priorFailedOperationPreservedPrepared": True,
    })
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop, sqlite3.Error, subprocess.SubprocessError) as error:
        print(json.dumps({"schema": "PLEBEIAN_AUTHORITY_CONFIRM_DIAG_R18_ACTUAL_V1", "status": "STOPPED", "error": str(error)[:1000]}, sort_keys=True, separators=(",", ":")))
        raise SystemExit(1)
