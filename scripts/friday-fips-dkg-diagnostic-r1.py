#!/usr/bin/python3
"""One-shot privileged-context DKG diagnostic; no networking or FIPS services.

The controller reproduces only the R3 DKG process boundary. It creates one
identity-bound temporary root, drops the DKG child to the reviewed UID/GID with
no groups/capabilities, records a fixed-vocabulary phase journal, and removes
only that positively identified root. Evidence never contains keys, protocol
payloads, stderr text, or raw DKG output.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


TRUSTED_REPO = Path("/var/lib/plebeian-friday-fips-dkg-r1-reviewed")
SELF_PATH = Path(__file__).resolve()
MANIFEST_PATH = TRUSTED_REPO / "FIPS-DKG-DIAGNOSTIC-R1-EXECUTION.json"
RUN_ID = "friday-fips-dkg-diagnostic-20261022-r1"
RUN_ROOT = Path("/tmp/plebeian-friday-fips-lab.20261022-dkg-r1")
MARKER = RUN_ROOT / ".plebeian-friday-fips-dkg-diagnostic-owned"
PHASE_JOURNAL = RUN_ROOT / "dkg-phase.jsonl"
RESULT = RUN_ROOT / "dkg-result.json"
EVIDENCE_ROOT = TRUSTED_REPO / "evidence"
EVIDENCE_PENDING = EVIDENCE_ROOT / "outcome.pending"
EVIDENCE_RESULT = EVIDENCE_ROOT / "outcome.json"
UID = 1000
GID = 1000
HEX32 = re.compile(r"^[0-9a-f]{64}$")
PHASES = {
    "cli_start", "config_validation", "dkg_root_creation", "dkg_identity_material",
    "dkg_round1", "dkg_agreement", "dkg_round2", "dkg_finalize",
    "dkg_public_validation", "dkg_public_inspection", "rpc_identity_persistence",
    "result_persistence", "cli_complete",
}
STATUSES = {"begin", "ok", "failed"}
SUCCESS_PHASES = (
    "cli_start", "config_validation", "dkg_root_creation", "dkg_identity_material",
    "dkg_round1", "dkg_agreement", "dkg_round2", "dkg_finalize",
    "dkg_public_validation", "dkg_public_inspection", "rpc_identity_persistence",
    "result_persistence", "cli_complete",
)


class DiagnosticRefusal(RuntimeError):
    pass


class DiagnosticInterrupted(RuntimeError):
    pass


def refuse(message: str) -> None:
    raise DiagnosticRefusal(message)


def sha256_file(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def exact_object(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        refuse(f"{label} has missing or unexpected fields")
    return value


def write_exclusive(path: Path, value: bytes, mode: int, uid: int, gid: int) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        offset = 0
        while offset < len(value):
            offset += os.write(descriptor, value[offset:])
        os.fsync(descriptor)
        os.fchown(descriptor, uid, gid)
        os.fchmod(descriptor, mode)
    finally:
        os.close(descriptor)


def reserve_evidence() -> tuple[int, tuple[int, int]]:
    directory = EVIDENCE_ROOT.lstat()
    if not stat.S_ISDIR(directory.st_mode) or directory.st_uid != 0 or directory.st_gid != 0 \
            or stat.S_IMODE(directory.st_mode) != 0o700:
        refuse("evidence directory ownership, mode, or type differs")
    if os.path.lexists(EVIDENCE_PENDING) or os.path.lexists(EVIDENCE_RESULT):
        refuse("single-run evidence destination already exists")
    descriptor = os.open(
        EVIDENCE_PENDING, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600,
    )
    os.fchown(descriptor, 0, 0)
    os.fchmod(descriptor, 0o600)
    return descriptor, (directory.st_dev, directory.st_ino)


def persist_reserved_evidence(
        descriptor: int, directory_identity: tuple[int, int], value: dict[str, Any]) -> None:
    directory = EVIDENCE_ROOT.lstat()
    pending = EVIDENCE_PENDING.lstat()
    if (directory.st_dev, directory.st_ino) != directory_identity \
            or not stat.S_ISDIR(directory.st_mode) or directory.st_uid != 0 or directory.st_gid != 0 \
            or stat.S_IMODE(directory.st_mode) != 0o700:
        refuse("reserved evidence directory identity changed")
    descriptor_metadata = os.fstat(descriptor)
    if (pending.st_dev, pending.st_ino) != (descriptor_metadata.st_dev, descriptor_metadata.st_ino) \
            or not stat.S_ISREG(pending.st_mode) or pending.st_uid != 0 or pending.st_gid != 0 \
            or stat.S_IMODE(pending.st_mode) != 0o600:
        refuse("reserved evidence file identity changed")
    payload = (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()
    os.ftruncate(descriptor, 0)
    os.lseek(descriptor, 0, os.SEEK_SET)
    offset = 0
    while offset < len(payload):
        offset += os.write(descriptor, payload[offset:])
    os.fsync(descriptor)
    os.link(EVIDENCE_PENDING, EVIDENCE_RESULT, follow_symlinks=False)
    os.unlink(EVIDENCE_PENDING)
    directory_descriptor = os.open(EVIDENCE_ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory_descriptor)
    finally:
        os.close(directory_descriptor)


def process_identity(pid: int) -> tuple[int, int, int]:
    raw = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8")
    close = raw.rfind(")")
    if close < 0 or not raw[:raw.find("(")].strip().isdigit():
        refuse("child process stat is malformed")
    fields = raw[close + 2:].split()
    if len(fields) < 20:
        refuse("child process stat is malformed")
    return int(fields[19]), int(fields[2]), int(fields[3])


def exact_child_is_live(pid: int, start_ticks: int) -> bool:
    try:
        current_start, process_group, session = process_identity(pid)
    except FileNotFoundError:
        return False
    if current_start != start_ticks:
        return False
    if process_group != pid or session != pid:
        refuse("child lost its reviewed process-group or session identity")
    return True


def process_group_exists(process_group: int) -> bool:
    try:
        os.killpg(process_group, 0)
        return True
    except ProcessLookupError:
        return False


def validate_phase_journal(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != UID or metadata.st_gid != GID \
            or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_size > 64 * 1024:
        refuse("phase journal ownership, mode, type, or size differs")
    result: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        value = exact_object(json.loads(line), {"schema", "stage", "status", "unix_ms"}, "phase record")
        if value["schema"] != "PLEBEIAN_FRIDAY_FIPS_DKG_PHASE_V1" \
                or value["stage"] not in PHASES or value["status"] not in STATUSES \
                or not isinstance(value["unix_ms"], int) or value["unix_ms"] < 0:
            refuse("phase journal contains a non-fixed or malformed value")
        result.append(value)
    if not result:
        refuse("existing phase journal is empty")
    return result


def validate_success_phase_order(records: list[dict[str, Any]]) -> None:
    expected: list[tuple[str, str]] = [("cli_start", "ok")]
    for stage in SUCCESS_PHASES[1:-1]:
        expected.extend(((stage, "begin"), (stage, "ok")))
    expected.append(("cli_complete", "ok"))
    observed = [(record["stage"], record["status"]) for record in records]
    if observed != expected:
        refuse("successful DKG phase sequence is incomplete or out of order")


def bounded_regular_file_info(
        path: Path, identity: tuple[int, int] | None, uid: int, gid: int,
        max_bytes: int, label: str) -> dict[str, Any]:
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != uid or metadata.st_gid != gid \
            or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_size > max_bytes \
            or (identity is not None and (metadata.st_dev, metadata.st_ino) != identity):
        refuse(f"{label} identity, ownership, mode, type, or size differs")
    return {"size": metadata.st_size, "sha256": sha256_file(path)}


def load_manifest(expected_manifest: str, expected_controller: str) -> dict[str, Any]:
    if not HEX32.fullmatch(expected_manifest) or not HEX32.fullmatch(expected_controller):
        refuse("expected hash argument is malformed")
    if sha256_file(MANIFEST_PATH) != expected_manifest or sha256_file(SELF_PATH) != expected_controller:
        refuse("manifest or controller differs from reviewed bytes")
    value = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    exact_object(value, {
        "schema", "approval_ready", "reason_not_ready", "run_id", "run_root", "host",
        "limits", "effects", "binary_pins", "source_pins", "evidence_result",
    }, "manifest")
    if value["schema"] != "PLEBEIAN_FRIDAY_FIPS_DKG_DIAGNOSTIC_EXECUTION_V1" \
            or value["approval_ready"] is not True or value["reason_not_ready"] != "":
        refuse(f"diagnostic packet is inert: {value.get('reason_not_ready')}")
    if value["run_id"] != RUN_ID or value["run_root"] != str(RUN_ROOT):
        refuse("run identity differs")
    if value["host"] != {
        "hostname": socket.gethostname(), "kernel_release": os.uname().release,
        "uid": UID, "gid": GID, "user": "maximoto",
    }:
        refuse("host identity differs")
    if value["limits"] != {
        "soft_action_seconds": 300, "hard_kill_grace_seconds": 60,
        "child_seconds": 240, "shutdown_seconds": 5,
        "max_log_bytes": 10_485_760, "nofile": 256, "nproc": 128,
    }:
        refuse("diagnostic limits differ")
    if value["effects"] != {
        "namespaces": False, "network": False, "listeners": False, "external_egress": False,
        "fips_services": False, "host_firewall_changes": False, "host_routes": False,
        "file_capabilities": False, "persistent_credentials": False,
    }:
        refuse("diagnostic effect boundary differs")
    if value["evidence_result"] != str(EVIDENCE_RESULT):
        refuse("evidence destination differs")
    pins = exact_object(value["binary_pins"], {
        "/usr/bin/python3.12", "/usr/bin/timeout", "/usr/bin/env", "/usr/bin/setpriv", "/usr/bin/prlimit",
        str(TRUSTED_REPO / "lab-bin/plebeian-friday-frost-dkg"),
        str(TRUSTED_REPO / "lab-bin/coco-demo-frost-participant-3of4"),
        str(TRUSTED_REPO / "lab-bin/coco-demo-frost-public-inspect"),
    }, "binary pins")
    for path, expected in pins.items():
        if not isinstance(expected, str) or not HEX32.fullmatch(expected) or sha256_file(Path(path)) != expected:
            refuse(f"binary pin differs: {path}")
    sources = exact_object(value["source_pins"], {str(SELF_PATH), "reviewed_source_commit"}, "source pins")
    if sources[str(SELF_PATH)] != expected_controller or not isinstance(sources["reviewed_source_commit"], str) \
            or not re.fullmatch(r"[0-9a-f]{40}", sources["reviewed_source_commit"]):
        refuse("source pins differ")
    return value


def assert_trusted_staging() -> None:
    if os.geteuid() != 0 or os.getegid() != 0:
        refuse("controller requires one exact root invocation")
    if TRUSTED_REPO != Path("/var/lib/plebeian-friday-fips-dkg-r1-reviewed") \
            or SELF_PATH != TRUSTED_REPO / "scripts/friday-fips-dkg-diagnostic-r1.py":
        refuse("controller is outside the reviewed staging root")
    for path in (
        TRUSTED_REPO, TRUSTED_REPO / "scripts", TRUSTED_REPO / "lab-bin",
        EVIDENCE_ROOT,
        SELF_PATH, MANIFEST_PATH,
        TRUSTED_REPO / "lab-bin/plebeian-friday-frost-dkg",
        TRUSTED_REPO / "lab-bin/coco-demo-frost-participant-3of4",
        TRUSTED_REPO / "lab-bin/coco-demo-frost-public-inspect",
    ):
        metadata = path.stat(follow_symlinks=False)
        if path.is_symlink() or metadata.st_uid != 0 or metadata.st_gid != 0 or metadata.st_mode & 0o022:
            refuse(f"staging path is symlinked, non-root, or writable: {path}")


def create_owned_root() -> tuple[tuple[int, int], tuple[int, int]]:
    prior = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
    try:
        os.mkdir(RUN_ROOT, 0o700)
        root_descriptor = os.open(RUN_ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fchown(root_descriptor, 0, GID)
            os.fchmod(root_descriptor, 0o770)
            root_metadata = os.fstat(root_descriptor)
        finally:
            os.close(root_descriptor)
        write_exclusive(MARKER, (RUN_ID + "\n").encode(), 0o600, 0, 0)
        marker_metadata = MARKER.lstat()
        for node in range(1, 5):
            path = RUN_ROOT / f"node-{node}"
            path.mkdir(mode=0o700)
            os.chown(path, UID, GID)
        runtime = RUN_ROOT / "runtime"
        runtime.mkdir(mode=0o700)
        os.chown(runtime, UID, GID)
        application = {
            "schema": "PLEBEIAN_FRIDAY_FIPS_LAB_APPLICATION_V2",
            "run_id": RUN_ID,
            "fips_ulas": ["fd00:250::1", "fd00:250::2", "fd00:250::3", "fd00:250::4"],
            "comet_p2p_port": 26656, "comet_rpc_port": 26657, "signer_rpc_port": 39101,
            "mint_port": 3338, "network_root": str(RUN_ROOT / "network"),
            "dkg_root": str(RUN_ROOT / "dkg"), "driver_result": str(RUN_ROOT / "unused-driver-result.json"),
        }
        write_exclusive(
            RUN_ROOT / "application.json", (json.dumps(application, sort_keys=True) + "\n").encode(),
            0o600, UID, GID,
        )
        return (root_metadata.st_dev, root_metadata.st_ino), (marker_metadata.st_dev, marker_metadata.st_ino)
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, prior)


def remove_owned_root(root_identity: tuple[int, int], marker_identity: tuple[int, int]) -> list[str]:
    errors: list[str] = []
    try:
        root_metadata = RUN_ROOT.lstat()
        marker_metadata = MARKER.lstat()
        if not stat.S_ISDIR(root_metadata.st_mode) or (root_metadata.st_dev, root_metadata.st_ino) != root_identity \
                or root_metadata.st_uid != 0 or root_metadata.st_gid != GID \
                or stat.S_IMODE(root_metadata.st_mode) != 0o770:
            return ["run root identity, owner, group, or mode changed; refusing deletion"]
        if not stat.S_ISREG(marker_metadata.st_mode) or (marker_metadata.st_dev, marker_metadata.st_ino) != marker_identity \
                or marker_metadata.st_uid != 0 or marker_metadata.st_gid != 0 \
                or stat.S_IMODE(marker_metadata.st_mode) != 0o600 \
                or MARKER.read_text(encoding="utf-8") != RUN_ID + "\n":
            return ["run root marker changed; refusing deletion"]
        shutil.rmtree(RUN_ROOT)
    except Exception as error:
        errors.append(f"remove exact DKG diagnostic root: {type(error).__name__}: {error}")
    if RUN_ROOT.exists() or RUN_ROOT.is_symlink():
        errors.append("DKG diagnostic root remains")
    return errors


def wait_group_absent(process_group: int, seconds: float) -> bool:
    deadline = time.monotonic() + seconds
    while process_group_exists(process_group) and time.monotonic() < deadline:
        time.sleep(0.05)
    return not process_group_exists(process_group)


def stop_owned_group(child: subprocess.Popen[bytes], start_ticks: int | None, seconds: float) -> bool:
    """Signal a group only while its exact reviewed leader identity is live.

    Once that leader exits, the numeric PGID is never signalled again. A
    surviving group therefore blocks secret-root deletion and requires a
    separate inspected cleanup, rather than risking a reused PGID.
    """
    if start_ticks is None or not exact_child_is_live(child.pid, start_ticks):
        return wait_group_absent(child.pid, seconds)
    deadline = time.monotonic() + seconds
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        return wait_group_absent(child.pid, max(0.0, deadline - time.monotonic()))
    if wait_group_absent(child.pid, max(0.0, (deadline - time.monotonic()) / 2)):
        return True
    if not exact_child_is_live(child.pid, start_ticks):
        return False
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    return wait_group_absent(child.pid, max(0.0, deadline - time.monotonic()))


def interrupt_handler(signum: int, _frame: Any) -> None:
    name = signal.Signals(signum).name
    raise DiagnosticInterrupted(f"controller received {name}")


def diagnostic_argv() -> list[str]:
    """Return the complete, allowlisted child boundary without executing it."""
    return [
        "/usr/bin/env", "-i", f"HOME={RUN_ROOT}", "LOGNAME=maximoto", "PATH=/usr/bin:/bin",
        "USER=maximoto", f"XDG_RUNTIME_DIR={RUN_ROOT / 'runtime'}", "RUST_LOG=info",
        "/usr/bin/setpriv", "--reuid=1000", "--regid=1000", "--clear-groups",
        "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs",
        "--pdeathsig=TERM", "--", "/usr/bin/prlimit", "--core=0:0",
        "--fsize=10485760:10485760", "--nofile=256:256", "--nproc=128:128", "--",
        str(TRUSTED_REPO / "lab-bin/plebeian-friday-frost-dkg"), "provision",
        "--config", str(RUN_ROOT / "application.json"),
        "--participant-binary", str(TRUSTED_REPO / "lab-bin/coco-demo-frost-participant-3of4"),
        "--inspector-binary", str(TRUSTED_REPO / "lab-bin/coco-demo-frost-public-inspect"),
        "--phase-journal", str(PHASE_JOURNAL), "--output", str(RESULT),
    ]


def main() -> int:
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--expected-manifest-sha256", required=True)
    parser.add_argument("--expected-controller-sha256", required=True)
    arguments = parser.parse_args()
    if arguments.manifest != str(MANIFEST_PATH):
        refuse("only the exact reviewed manifest is accepted")
    assert_trusted_staging()
    manifest = load_manifest(arguments.expected_manifest_sha256, arguments.expected_controller_sha256)
    if os.path.lexists(RUN_ROOT):
        refuse("single-run root already exists")
    prior_signal_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
    old_sigint = signal.signal(signal.SIGINT, interrupt_handler)
    old_sigterm = signal.signal(signal.SIGTERM, interrupt_handler)
    try:
        evidence_descriptor, evidence_directory_identity = reserve_evidence()
    except BaseException:
        signal.signal(signal.SIGINT, old_sigint)
        signal.signal(signal.SIGTERM, old_sigterm)
        signal.pthread_sigmask(signal.SIG_SETMASK, prior_signal_mask)
        raise

    started = int(time.time())
    action_started = time.monotonic()
    action_deadline = action_started + manifest["limits"]["soft_action_seconds"]
    root_identity: tuple[int, int] | None = None
    marker_identity: tuple[int, int] | None = None
    child: subprocess.Popen[bytes] | None = None
    child_start_ticks: int | None = None
    timed_out = False
    failure: str | None = None
    return_code: int | None = None
    phase_records: list[dict[str, Any]] = []
    group_absent = True
    stop_attempted = False
    stdout_identity: tuple[int, int] | None = None
    stderr_identity: tuple[int, int] | None = None
    stdout_path = RUN_ROOT / "dkg.stdout"
    stderr_path = RUN_ROOT / "dkg.stderr"
    try:
        signal.pthread_sigmask(signal.SIG_SETMASK, prior_signal_mask)
        root_identity, marker_identity = create_owned_root()
        argv = diagnostic_argv()
        stdout_descriptor = os.open(stdout_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        stderr_descriptor = os.open(stderr_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        stdout_metadata = os.fstat(stdout_descriptor)
        stderr_metadata = os.fstat(stderr_descriptor)
        stdout_identity = (stdout_metadata.st_dev, stdout_metadata.st_ino)
        stderr_identity = (stderr_metadata.st_dev, stderr_metadata.st_ino)
        prior = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
        try:
            child = subprocess.Popen(
                argv, stdin=subprocess.DEVNULL, stdout=stdout_descriptor, stderr=stderr_descriptor,
                env={}, close_fds=True, start_new_session=True, cwd="/home/maximoto",
            )
            child_start_ticks, process_group, session = process_identity(child.pid)
            if process_group != child.pid or session != child.pid:
                refuse("child did not create its reviewed process group and session")
        finally:
            os.close(stdout_descriptor)
            os.close(stderr_descriptor)
            signal.pthread_sigmask(signal.SIG_SETMASK, prior)
        try:
            return_code = child.wait(timeout=manifest["limits"]["child_seconds"])
        except subprocess.TimeoutExpired:
            timed_out = True
            stop_attempted = True
            group_absent = stop_owned_group(child, child_start_ticks, manifest["limits"]["shutdown_seconds"])
            return_code = child.poll()
            if return_code is None:
                failure = "DKG leader did not exit within the shutdown budget"
        group_absent = not process_group_exists(child.pid)
        if not group_absent:
            failure = "child process group remained after leader exit"
        phase_records = validate_phase_journal(PHASE_JOURNAL)
        if timed_out:
            failure = "DKG diagnostic timed out"
        elif return_code != 0:
            failure = f"DKG diagnostic exited {return_code}"
        elif not phase_records:
            failure = "DKG diagnostic lacked a terminal result or phase evidence"
        else:
            bounded_regular_file_info(RESULT, None, UID, GID, 64 * 1024, "DKG terminal result")
            validate_success_phase_order(phase_records)
    except BaseException as error:
        failure = f"{type(error).__name__}: {error}"
        if PHASE_JOURNAL.exists():
            try:
                phase_records = validate_phase_journal(PHASE_JOURNAL)
            except BaseException as phase_error:
                failure += f"; phase validation failed: {type(phase_error).__name__}: {phase_error}"
    finally:
        signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
        if child is not None:
            if child.poll() is None and not stop_attempted:
                try:
                    stop_attempted = True
                    group_absent = stop_owned_group(
                        child, child_start_ticks, manifest["limits"]["shutdown_seconds"],
                    )
                except BaseException as stop_error:
                    group_absent = False
                    failure = f"{failure + '; ' if failure else ''}stop failed: {type(stop_error).__name__}: {stop_error}"
            elif child.poll() is not None:
                group_absent = not process_group_exists(child.pid)
            if not group_absent:
                failure = f"{failure + '; ' if failure else ''}owned process group absence was not proved"

    try:
        stdout_info = None if not os.path.lexists(stdout_path) else bounded_regular_file_info(
            stdout_path, stdout_identity, 0, 0, manifest["limits"]["max_log_bytes"], "stdout",
        )
        stderr_info = None if not os.path.lexists(stderr_path) else bounded_regular_file_info(
            stderr_path, stderr_identity, 0, 0, manifest["limits"]["max_log_bytes"], "stderr",
        )
    except BaseException as stream_error:
        stdout_info = None
        stderr_info = None
        failure = f"{failure + '; ' if failure else ''}stream validation failed: {type(stream_error).__name__}: {stream_error}"
    if not os.path.lexists(RUN_ROOT):
        cleanup_errors: list[str] = []
    elif not group_absent:
        cleanup_errors = ["owned process group absence was not proved; run root preserved"]
    elif root_identity is None or marker_identity is None:
        cleanup_errors = ["run root identity was not completely recorded; run root preserved"]
    else:
        cleanup_errors = remove_owned_root(root_identity, marker_identity)
    if cleanup_errors:
        failure = f"{failure + '; ' if failure else ''}cleanup failed: {'; '.join(cleanup_errors)}"
    elapsed = time.monotonic() - action_started
    if time.monotonic() > action_deadline:
        failure = f"{failure + '; ' if failure else ''}300-second soft action limit exceeded"
    evidence = {
        "schema": "PLEBEIAN_FRIDAY_FIPS_DKG_DIAGNOSTIC_RESULT_V1",
        "runId": RUN_ID, "startedAt": started, "finishedAt": int(time.time()),
        "manifestSha256": arguments.expected_manifest_sha256,
        "controllerSha256": arguments.expected_controller_sha256,
        "sourceCommit": manifest["source_pins"]["reviewed_source_commit"],
        "binaryPins": manifest["binary_pins"], "returnCode": return_code,
        "signal": -return_code if isinstance(return_code, int) and return_code < 0 else None,
        "timedOut": timed_out, "pid": None if child is None else child.pid,
        "procStartTicks": child_start_ticks, "processGroupAbsent": group_absent,
        "phaseRecords": phase_records, "stdout": stdout_info, "stderr": stderr_info,
        "cleanupComplete": not cleanup_errors, "cleanupErrors": cleanup_errors,
        "success": failure is None, "failure": failure,
        "elapsedMilliseconds": int(elapsed * 1000),
        "networkExecutionBoundary": "static_allowlisted_dkg_path_not_kernel_observed",
        "secretsProofsConfigPayloadsOrRawOutputIncluded": False,
    }
    try:
        persist_reserved_evidence(evidence_descriptor, evidence_directory_identity, evidence)
    except BaseException as evidence_error:
        print(
            f"DKG diagnostic evidence persistence failed after execution: {type(evidence_error).__name__}",
            file=sys.stderr,
        )
        return 3
    finally:
        os.close(evidence_descriptor)
        signal.signal(signal.SIGINT, old_sigint)
        signal.signal(signal.SIGTERM, old_sigterm)
    return 0 if failure is None else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except DiagnosticRefusal as error:
        print(f"DKG diagnostic refused before execution: {error}", file=sys.stderr)
        raise SystemExit(2)
