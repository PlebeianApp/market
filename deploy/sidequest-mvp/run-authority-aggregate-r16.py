#!/usr/bin/env python3
"""Install and activate the APP-only R16 authority successor exactly once."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


STAGE = Path("/tmp/plebeian-r16-stage-2847030")
RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-aggregate-r16")
CONFIG = Path("/etc/plebeian-auctions-friday/authority.json")
UNIT = Path("/etc/systemd/system/plebeian-friday-authority.service")
PRESERVED_CONFIG = Path("/etc/plebeian-auctions-friday/authority.pre-r16-9cf014030b9e.json")
PRESERVED_UNIT = Path("/etc/systemd/system/plebeian-friday-authority.pre-r16-f3c6c7035669.service")
SERVICE = "plebeian-friday-authority.service"
PUBLIC_GID = 988

FILES = {
    "plebeian-friday-authority": (100_435_438, "1c9f2e05aa2fa4bca71f70122330abb894bcd5c4278eda50b21e77ad43bf4f82"),
    "coco-demo-frost-participant-3of4": (2_411_344, "9158e90fe9807f65fadc121d5296cf29d4328928fd7bf3cb5df016202d97b993"),
    "verify-friday-separated-target.py": (4_217, "9ef1041d1fd6e0ac2e05d3d890211759a74a7eddf2d5d1e60ff292245de28e65"),
    "authority.json": (363, "141603382ea90a7079402bc74fbf28e26cc71cddae1d1b55a118268dcdf7e435"),
    "authority-activation.service": (1_843, "ccf57fdacff4107cef023e48c408c19c24b22f2a45847c6c5afd9069fa535098"),
    "authority-final.service": (1_851, "e10272a465481ac98f3706df341ea766b82f2a9975fdad24bbcbd1ce6faa6abb"),
}
CURRENT = {
    CONFIG: (363, "9cf014030b9ed39f30631d4c2435f21cf63b115036dfc9f0ac818cec16f7cc26"),
    UNIT: (1_847, "f3c6c7035669f2bb25594a7fa649f2f5f84356baeefa232a488f90004ca3a670"),
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


def inspect(path: Path, expected: tuple[int, str], mode: int | None = None, uid: int | None = None, gid: int | None = None) -> None:
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


def require_ready(payload: dict[str, object]) -> None:
    require(payload.get("quarantined") is False, "QUARANTINED")
    require(payload.get("queuePending") == 0, "QUEUE_PENDING")
    require(payload.get("consensusAvailable") is True, "NO_CONSENSUS")
    require(payload.get("newOperationsReady") is True, "OPERATIONS_NOT_READY")
    require(payload.get("readinessReason") == "ready", "READINESS_REASON")


def wait_ready(attempts: int) -> list[dict[str, object]]:
    samples: list[dict[str, object]] = []
    for _ in range(attempts):
        try:
            sample = ready()
            samples.append(sample)
            require_ready(sample)
            return samples
        except (OSError, ValueError, Stop):
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
    descriptor, temporary = tempfile.mkstemp(prefix="." + target.name + ".r16-", dir=target.parent)
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


def main() -> int:
    result: dict[str, object] = {"schema": "PLEBEIAN_AUTHORITY_AGGREGATE_R16_ACTUAL_V1", "status": "STOPPED"}
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    require(STAGE.is_dir() and not STAGE.is_symlink(), "STAGE")
    for name, expected in FILES.items():
        inspect(STAGE / name, expected, 0o600, 0, 0)
    require(not RELEASE.exists(), "RELEASE_EXISTS")
    require(not PRESERVED_CONFIG.exists() and not PRESERVED_UNIT.exists(), "PRESERVED_EXISTS")
    inspect(CONFIG, CURRENT[CONFIG], 0o640, 0, PUBLIC_GID)
    inspect(UNIT, CURRENT[UNIT], 0o644, 0, 0)
    for service in OTHER_SERVICES:
        require_active(service)
    initial = require_active(SERVICE)
    wait_ready(6)

    (RELEASE / "bin").mkdir(parents=True, mode=0o755)
    os.chown(RELEASE, 0, 0)
    os.chown(RELEASE / "bin", 0, 0)
    os.chmod(RELEASE, 0o755)
    os.chmod(RELEASE / "bin", 0o755)
    for name in ("plebeian-friday-authority", "coco-demo-frost-participant-3of4", "verify-friday-separated-target.py"):
        copy_create_once(STAGE / name, RELEASE / "bin" / name, 0o755, 0, 0)
    copy_create_once(CONFIG, PRESERVED_CONFIG, 0o640, 0, PUBLIC_GID)
    copy_create_once(UNIT, PRESERVED_UNIT, 0o644, 0, 0)
    atomic_replace(STAGE / "authority.json", CONFIG, 0o640, 0, PUBLIC_GID)
    atomic_replace(STAGE / "authority-activation.service", UNIT, 0o644, 0, 0)
    run(["/usr/bin/systemctl", "daemon-reload"])
    run(["/usr/bin/systemctl", "stop", SERVICE], timeout=40)
    require(service_properties(SERVICE).get("ActiveState") == "inactive", "STOP_FAILED")
    run(["/usr/bin/systemctl", "start", SERVICE], timeout=40)
    active = require_active(SERVICE)
    samples = wait_ready(12)
    pid = active.get("MainPID")
    atomic_replace(STAGE / "authority-final.service", UNIT, 0o644, 0, 0)
    run(["/usr/bin/systemctl", "daemon-reload"])
    final = require_active(SERVICE)
    require(final.get("MainPID") == pid, "FINAL_UNIT_RESTARTED_SERVICE")
    require_ready(ready())
    for service in OTHER_SERVICES:
        require_active(service)
    result.update({
        "status": "COMPLETE",
        "initialMainPID": initial.get("MainPID"),
        "finalMainPID": final.get("MainPID"),
        "readinessSamples": len(samples),
        "release": str(RELEASE),
    })
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop, subprocess.SubprocessError) as error:
        print(json.dumps({"schema": "PLEBEIAN_AUTHORITY_AGGREGATE_R16_ACTUAL_V1", "status": "STOPPED", "error": str(error)[:1000]}, sort_keys=True, separators=(",", ":")))
        raise SystemExit(1)
