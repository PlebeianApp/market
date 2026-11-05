#!/usr/bin/env python3
"""Sequential create-once R26 signer adoption for one already-running validator."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile

STAGE = Path("/tmp/plebeian-r26-signer-stage-928115")
RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-signer-finality-r26")
UNIT = Path("/etc/systemd/system/plebeian-friday-signer.service")
PRESERVED_UNIT = Path("/etc/systemd/system/plebeian-friday-signer.pre-r26-e75f5e228499.service")
R13 = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-signer-recovery-r13/bin/plebeian-friday-signer")
SERVICE = "plebeian-friday-signer.service"
FILES = {
    "plebeian-friday-signer": (100_056_993, "a5c9f04c03c46ca339a5a6a2c5cca4cbbf754dde80132740ebfef2c1645cef3a"),
    "verify-friday-separated-base.py": (14_659, "36bc33672b1cd2bef0961c7a7df160686cb2674e62242784303a64d652515f1d"),
    "verify-friday-runtime-target.py": (24_764, "d5c7031676fa3e5dc15a5da5c11a8d20c44e5f5e53242b3407df90b1c026b206"),
    "verify-friday-separated-target.py": (3_787, "20a2a4e102dba10a66fe81cdcb95acd8fd4be7d5eeefa59220c37e3a4c6d3a7a"),
    "signer.service": (1_406, "6ab9dd72cdec50ae887b2bde6b4a576de3a77f81603e33867aa5312234823a6d"),
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
                == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                "CHANGED:" + str(path))
    finally:
        os.close(descriptor)


def run(args: list[str], timeout: int = 40) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
    require(result.returncode == 0, "COMMAND:" + args[0] + ":" + result.stderr[:300])
    return result


def props(name: str) -> dict[str, str]:
    result = run(["/usr/bin/systemctl", "show", name, "--property=ActiveState,SubState,NRestarts,MainPID,ExecMainStatus"])
    return dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)


def active(name: str) -> dict[str, str]:
    state = props(name)
    require(state.get("ActiveState") == "active" and state.get("SubState") == "running", "SERVICE:" + name)
    return state


def copy_create_once(source: Path, target: Path, mode: int) -> None:
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode)
    try:
        with source.open("rb") as input_stream, os.fdopen(descriptor, "wb", closefd=False) as output_stream:
            shutil.copyfileobj(input_stream, output_stream, 1 << 20); output_stream.flush(); os.fsync(output_stream.fileno())
        os.fchmod(descriptor, mode); os.fchown(descriptor, 0, 0)
    finally:
        os.close(descriptor)


def atomic_replace(source: Path, target: Path, mode: int) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix="." + target.name + ".r26-", dir=target.parent)
    temp_path = Path(temporary)
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


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--slot", type=int, required=True); args = parser.parse_args()
    require(args.slot in (1, 2, 3, 4), "SLOT")
    result: dict[str, object] = {"schema": "PLEBEIAN_SIGNER_FINALITY_R26_ACTUAL_V1", "slot": args.slot, "status": "STOPPED"}
    require(os.geteuid() == 0 and STAGE.is_dir() and not STAGE.is_symlink(), "ROOT_OR_STAGE")
    for name, expected in FILES.items(): inspect(STAGE / name, expected, 0o600)
    require(not RELEASE.exists() and not PRESERVED_UNIT.exists(), "CREATE_ONCE_TARGET_EXISTS")
    inspect(R13, (100_058_644, "45f27e32b0745993e705f4e1373acf66ce12ae6f13644834807ab19c28967e38"), 0o755)
    inspect(UNIT, (1_405, "e75f5e2284992a39a6fea6c6d33df4c578b3e246e7c38a7bc114e0c46cf3860c"), 0o644)
    initial = active(SERVICE); require(initial.get("NRestarts") == "0", "SIGNER_RESTARTED")
    active("plebeian-friday-fips.service"); active("plebeian-friday-validator.service")

    (RELEASE / "bin").mkdir(parents=True, mode=0o755)
    os.chown(RELEASE, 0, 0); os.chown(RELEASE / "bin", 0, 0); os.chmod(RELEASE, 0o755); os.chmod(RELEASE / "bin", 0o755)
    for name in FILES:
        copy_create_once(STAGE / name, RELEASE / "bin" / name, 0o755) if name != "signer.service" else None
    copy_create_once(UNIT, PRESERVED_UNIT, 0o644)
    atomic_replace(STAGE / "signer.service", UNIT, 0o644)
    run(["/usr/bin/systemctl", "daemon-reload"])
    run(["/usr/bin/systemctl", "stop", SERVICE])
    require(props(SERVICE).get("ActiveState") == "inactive", "STOP_FAILED")
    run(["/usr/bin/systemctl", "start", SERVICE])
    final = active(SERVICE); require(final.get("NRestarts") == "0" and final.get("MainPID") != initial.get("MainPID"), "START_FAILED")
    active("plebeian-friday-fips.service"); active("plebeian-friday-validator.service")
    result.update({"status": "COMPLETE", "initialMainPID": initial.get("MainPID"), "finalMainPID": final.get("MainPID"),
                   "release": str(RELEASE)})
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try: raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop, subprocess.SubprocessError) as error:
        print(json.dumps({"schema": "PLEBEIAN_SIGNER_FINALITY_R26_ACTUAL_V1", "status": "STOPPED", "error": str(error)[:500]}, sort_keys=True, separators=(",", ":")))
        raise SystemExit(1)
