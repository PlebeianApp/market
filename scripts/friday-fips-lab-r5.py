#!/usr/bin/python3
"""R5 full-lab controller: bounded phases and pre-reserved durable outcome.

It does not alter the independently accepted DKG-only diagnostic packet or
either failed R2/R3 staging tree.  Execution remains fail-closed until this
controller, its exact manifest and binary set are independently reviewed and
receive fresh owner action-time approval.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import signal
import socket
import stat
import subprocess
import sys
import time
import types
from pathlib import Path
from typing import Any


R3_CONTROLLER_SHA256 = "cc0c0b6b254a38d483b109bd072817be4685cf98d0de83dc338213f7af975dd3"
TRUSTED_REPO = Path("/var/lib/plebeian-friday-fips-r5-reviewed")
REPO = Path(__file__).resolve().parent.parent
R3_PATH = REPO / "scripts/friday-fips-lab-r3.py"
SELF_PATH = Path(__file__).resolve()
MANIFEST_PATH = REPO / "FIPS-LOCAL-LAB-R5-EXECUTION.json"
BUILD_RECEIPT_PATH = REPO / "FIPS-LOCAL-LAB-R5-BUILD-RECEIPT.json"
ACTION_SCOPE_PATH = REPO / "FIPS-LOCAL-LAB-R5-ACTION-SCOPE.md"
RUN_ID = "friday-fips-lab-20261022-r5"
RUN_ROOT = Path("/tmp/plebeian-friday-fips-lab.20261022-r5")
EVIDENCE_ROOT = TRUSTED_REPO / "evidence"
EVIDENCE_PENDING = EVIDENCE_ROOT / "outcome.pending"
EVIDENCE_RESULT = EVIDENCE_ROOT / "outcome.json"
# The inherited main has separate success/failure call sites.  R5 deliberately
# maps both to one pre-reserved, schema-discriminated outcome identity.
EVIDENCE_PATH = EVIDENCE_RESULT
FAILURE_PATH = EVIDENCE_RESULT
PHASE_JOURNAL = RUN_ROOT / "dkg-phase.jsonl"
TERMINAL_DRIVER = REPO / "lab-bin/plebeian-friday-terminal-driver-r4"
R4_CHILD_NPROC = 512
R5_TERMINAL_PREPARE_DEADLINE_SECONDS = 1_200
R5_OUTBID_DEADLINE_SECONDS = 2_100
R5_DRIVER_DEADLINE_SECONDS = 4_200
# Leave one second for the inherited main's slightly earlier monotonic anchor.
R5_DRIVER_PHASE_DEADLINE_SECONDS = 4_199
R5_OUTER_TIMEOUT_SECONDS = 4_800
R5_CLEANUP_BUDGET_SECONDS = 600

PHASES = (
    "cli_start", "config_validation", "dkg_root_creation", "dkg_identity_material",
    "dkg_round1", "dkg_agreement", "dkg_round2", "dkg_finalize",
    "dkg_public_validation", "dkg_public_inspection", "rpc_identity_persistence",
    "result_persistence", "cli_complete",
)
_dkg_phase_records: list[dict[str, Any]] = []
_dkg_phase_journal_evidence: dict[str, Any] | None = None
_dkg_result_evidence: dict[str, Any] | None = None
_terminal_result_evidence: dict[str, Any] | None = None
_terminal_artifact_evidence: dict[str, Any] = {}
_phase_zero: float | None = None
_phase_timing_evidence: list[dict[str, Any]] = []
_outcome_descriptor: int | None = None
_evidence_directory_identity: tuple[int, int] | None = None
_registered_owned: list[Any] = []


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def reserve_outcome_descriptor(
        evidence_root: Path, pending: Path, result: Path, *, owner_uid: int, owner_gid: int,
) -> tuple[int, tuple[int, int]]:
    """Reserve the one outcome inode before any mutable lab effect."""
    directory = evidence_root.lstat()
    if not stat.S_ISDIR(directory.st_mode) or directory.st_uid != owner_uid or directory.st_gid != owner_gid \
            or stat.S_IMODE(directory.st_mode) != 0o700:
        base.refuse("R5 evidence directory ownership, mode, or type differs")
    if os.path.lexists(pending) or os.path.lexists(result):
        base.refuse("single-run R5 outcome destination already exists")
    descriptor = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    os.fchown(descriptor, owner_uid, owner_gid)
    os.fchmod(descriptor, 0o600)
    return descriptor, (directory.st_dev, directory.st_ino)


def persist_reserved_outcome_descriptor(
        evidence_root: Path, pending_path: Path, result_path: Path, descriptor: int,
        directory_identity: tuple[int, int], *, owner_uid: int, owner_gid: int,
        value: dict[str, Any],
) -> None:
    """Write through one identity-checked descriptor and atomically publish it."""
    directory = evidence_root.lstat()
    pending = pending_path.lstat()
    descriptor_metadata = os.fstat(descriptor)
    if (directory.st_dev, directory.st_ino) != directory_identity \
            or not stat.S_ISDIR(directory.st_mode) or directory.st_uid != owner_uid \
            or directory.st_gid != owner_gid \
            or stat.S_IMODE(directory.st_mode) != 0o700:
        base.refuse("reserved R5 evidence directory identity changed")
    if (pending.st_dev, pending.st_ino) != (descriptor_metadata.st_dev, descriptor_metadata.st_ino) \
            or not stat.S_ISREG(pending.st_mode) or pending.st_uid != owner_uid \
            or pending.st_gid != owner_gid \
            or stat.S_IMODE(pending.st_mode) != 0o600 or pending.st_nlink != 1 \
            or os.path.lexists(result_path):
        base.refuse("reserved R5 outcome identity changed")
    payload = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    os.ftruncate(descriptor, 0)
    os.lseek(descriptor, 0, os.SEEK_SET)
    offset = 0
    while offset < len(payload):
        offset += os.write(descriptor, payload[offset:])
    os.fsync(descriptor)
    os.link(pending_path, result_path, follow_symlinks=False)
    os.unlink(pending_path)
    directory_descriptor = os.open(evidence_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory_descriptor)
    finally:
        os.close(directory_descriptor)


def persist_reserved_outcome(path: Path, value: dict[str, Any]) -> None:
    """Publish the single production outcome that preflight reserved."""
    global _outcome_descriptor
    if path != EVIDENCE_RESULT or _outcome_descriptor is None or _evidence_directory_identity is None:
        base.refuse("R5 outcome was not reserved before effects")
    persist_reserved_outcome_descriptor(
        EVIDENCE_ROOT, EVIDENCE_PENDING, EVIDENCE_RESULT, _outcome_descriptor,
        _evidence_directory_identity, owner_uid=0, owner_gid=0, value=value,
    )
    os.close(_outcome_descriptor)
    _outcome_descriptor = None


def register_outcome_reservation(*, owner_uid: int | None = None, owner_gid: int | None = None) -> None:
    """Create and register the outcome inode while handled signals are blocked."""
    global _outcome_descriptor, _evidence_directory_identity, _phase_zero
    if _outcome_descriptor is not None or _phase_zero is not None:
        base.refuse("R5 outcome reservation is single-use")
    uid = os.geteuid() if owner_uid is None else owner_uid
    gid = os.getegid() if owner_gid is None else owner_gid
    previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
    try:
        descriptor, directory_identity = reserve_outcome_descriptor(
            EVIDENCE_ROOT, EVIDENCE_PENDING, EVIDENCE_RESULT, owner_uid=uid, owner_gid=gid,
        )
        _outcome_descriptor = descriptor
        _evidence_directory_identity = directory_identity
        _phase_zero = time.monotonic()
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)


def elapsed_seconds() -> float:
    if _phase_zero is None:
        base.refuse("R5 phase clock was not established before effects")
    return time.monotonic() - _phase_zero


def bounded_phase_timeout(elapsed: float, deadline_seconds: int, maximum_seconds: int, label: str) -> float:
    if elapsed < 0 or deadline_seconds < 1 or maximum_seconds < 1:
        base.refuse(f"R5 {label} phase bound is invalid")
    remaining = deadline_seconds - elapsed
    if remaining <= 0:
        base.refuse(f"R5 {label} phase deadline expired")
    return min(float(maximum_seconds), remaining)


def phase_timeout(deadline_seconds: int, maximum_seconds: int, label: str) -> float:
    return bounded_phase_timeout(elapsed_seconds(), deadline_seconds, maximum_seconds, label)


def record_phase(label: str, deadline_seconds: int) -> None:
    elapsed_ms = int(elapsed_seconds() * 1000)
    if elapsed_ms > deadline_seconds * 1000:
        base.refuse(f"R5 {label} phase exceeded its reviewed deadline")
    _phase_timing_evidence.append({
        "phase": label, "elapsedMilliseconds": elapsed_ms,
        "deadlineMilliseconds": deadline_seconds * 1000,
    })


def _load_r3() -> types.ModuleType:
    descriptor = os.open(R3_PATH, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(descriptor)
        if os.geteuid() == 0 and (metadata.st_uid != 0 or metadata.st_gid != 0 or metadata.st_mode & 0o022):
            raise RuntimeError("R3 controller is mutable or non-root before import")
        source = b""
        while chunk := os.read(descriptor, 1024 * 1024):
            source += chunk
    finally:
        os.close(descriptor)
    if _sha256_bytes(source) != R3_CONTROLLER_SHA256:
        raise RuntimeError("R3 controller differs before safe import")
    name = "plebeian_fips_r3_controller"
    module = types.ModuleType(name)
    module.__file__ = str(R3_PATH)
    sys.modules[name] = module
    exec(compile(source, str(R3_PATH), "exec"), module.__dict__)
    return module


r3 = _load_r3()
r2 = r3.r2
base = r3.base

# Rebind every path before main() can inspect, create or remove anything.
for module in (r3, r2):
    module.TRUSTED_REPO = TRUSTED_REPO
    module.REPO = REPO
    module.SELF_PATH = SELF_PATH
    module.MANIFEST_PATH = MANIFEST_PATH
    module.RUN_ID = RUN_ID
    module.RUN_ROOT = RUN_ROOT
    module.EVIDENCE_PATH = EVIDENCE_PATH
    module.FAILURE_PATH = FAILURE_PATH
r2.DKG = REPO / "lab-bin/plebeian-friday-frost-dkg-r4"
r2.VALIDATOR = REPO / "lab-bin/plebeian-auctions-poc"
r2.SIGNER = REPO / "lab-bin/plebeian-friday-signer"
r2.DRIVER = REPO / "lab-bin/plebeian-friday-integrated-driver"
r2.PARTICIPANT = REPO / "lab-bin/coco-demo-frost-participant-3of4"
r2.INSPECTOR = REPO / "lab-bin/coco-demo-frost-public-inspect"
r2.NUTSHELL_SITE = REPO / ".venv/lib/python3.12/site-packages"
base.RUN_ID = RUN_ID
base.RUN_ROOT = RUN_ROOT
base.MARKER_PATH = RUN_ROOT / ".plebeian-friday-fips-lab-owned"
base.EVIDENCE_PATH = EVIDENCE_PATH
base.FAILURE_EVIDENCE_PATH = FAILURE_PATH
base.VALIDATOR = str(r2.VALIDATOR)
base.DKG = str(r2.DKG)
base.SIGNER = str(r2.SIGNER)
base.DRIVER = str(r2.DRIVER)
base.FROST_PARTICIPANT = str(r2.PARTICIPANT)
base.FROST_INSPECTOR = str(r2.INSPECTOR)


def dropped_argv_r5(
        executable: str, arguments: list[str], *, namespace: str | None = None,
        capability: str | None = None, node_root: Path | None = None) -> list[str]:
    """R5 child boundary with a bounded UID-global thread/process allowance.

    The separately approved DKG diagnostic's Bun launcher received SIGILL
    before its first source-level phase record while using the prior 128-task
    limit. RLIMIT_NPROC is UID-global across PID namespaces, so 128 is not a
    stable per-lab cap on this shared host and could have contributed. R5 keeps
    every other privilege/resource restriction and raises only this bound;
    process identity cleanup remains authoritative. Causality remains unproven
    until a reviewed R5 run.
    """
    if namespace is not None and namespace not in base.NODE_NAMESPACES:
        base.refuse("R5 privilege drop requested for a non-node namespace")
    root = node_root or RUN_ROOT
    environment = [
        base.ENV, "-i", f"HOME={root}", f"LOGNAME={base.USER}", "PATH=/usr/bin:/bin",
        f"USER={base.USER}", f"XDG_RUNTIME_DIR={root / 'runtime'}", "RUST_LOG=info",
    ]
    capabilities = "-all" if capability is None else f"-all,+{capability}"
    privilege = [
        base.SETPRIV, f"--reuid={base.UID}", f"--regid={base.GID}", "--clear-groups",
        f"--inh-caps={capabilities}", f"--ambient-caps={capabilities}",
        f"--bounding-set={capabilities}", "--no-new-privs", "--pdeathsig=TERM", "--",
        base.PRLIMIT, "--fsize=10485760:10485760", "--nofile=256:256",
        f"--nproc={R4_CHILD_NPROC}:{R4_CHILD_NPROC}", "--", executable, *arguments,
    ]
    return [*environment, *privilege] if namespace is None \
        else [base.IP, "netns", "exec", namespace, *environment, *privilege]


def _terminate_unregistered_child(child: subprocess.Popen[bytes], start_ticks: int | None) -> None:
    """Boundedly reap a child that failed before becoming an OwnedProcess."""
    if child.poll() is not None:
        child.wait(timeout=1)
        return
    if start_ticks is not None and base.process_start_ticks(child.pid) != start_ticks:
        base.refuse(f"refusing to signal reused unregistered PID {child.pid}")
    os.killpg(child.pid, signal.SIGTERM)
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if start_ticks is not None and base.process_start_ticks(child.pid) != start_ticks:
            base.refuse(f"refusing forced termination of reused unregistered PID {child.pid}")
        os.killpg(child.pid, signal.SIGKILL)
        child.wait(timeout=5)


def start_owned_r5(
        role: str, node: int, executable: str, arguments: list[str], *,
        capability: str | None = None,
) -> Any:
    """Launch and globally register one long-lived child before signals resume.

    The inherited callers append the returned object to their local cleanup
    list. R5 additionally registers it here while SIGINT/SIGTERM are blocked,
    so a signal delivered immediately after return cannot strand the child.
    Any exception before registration reaps the exact child before signals are
    restored.
    """
    if node < 1 or node > len(base.NODE_NAMESPACES):
        base.refuse("R5 long-lived process requested an invalid node")
    node_root = RUN_ROOT / f"node-{node}"
    log_path = node_root / f"{role}.log"
    child: subprocess.Popen[bytes] | None = None
    start_ticks: int | None = None
    registered: Any | None = None
    previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
    try:
        log_descriptor = os.open(
            log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600,
        )
        try:
            child = subprocess.Popen(
                base.dropped_argv(
                    executable, arguments, namespace=base.NODE_NAMESPACES[node - 1],
                    capability=capability, node_root=node_root,
                ),
                stdin=subprocess.DEVNULL, stdout=log_descriptor, stderr=subprocess.STDOUT,
                env={}, close_fds=True, start_new_session=True,
            )
        finally:
            os.close(log_descriptor)
        start_ticks = base.process_start_ticks(child.pid)
        deadline = time.monotonic() + 5
        expected_executable_hash = base.sha256_file(Path(executable))
        while time.monotonic() < deadline:
            if child.poll() is not None:
                base.refuse(f"{role} node {node} exited during privilege drop")
            try:
                current_executable = Path(os.readlink(f"/proc/{child.pid}/exe"))
                if base.sha256_file(current_executable) == expected_executable_hash:
                    break
            except (FileNotFoundError, PermissionError):
                pass
            time.sleep(0.05)
        else:
            base.refuse(f"{role} node {node} never reached the reviewed executable")
        cap = base.NO_CAPS_HEX
        if capability == "net_admin":
            cap = base.CAP_NET_ADMIN_HEX
        elif capability == "net_raw":
            cap = base.CAP_NET_RAW_HEX
        registered = base.OwnedProcess(
            role=role, node=node, process=child, start_ticks=start_ticks,
            namespace_inode=base.namespace_inode(child.pid), executable=executable,
            expected_cap_eff=cap,
        )
        _registered_owned.append(registered)
        base.verify_owned_process(registered)
        return registered
    except BaseException:
        if registered is not None and registered in _registered_owned:
            _registered_owned.remove(registered)
        if child is not None:
            _terminate_unregistered_child(child, start_ticks)
        raise
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)


def merged_owned_for_cleanup(owned: list[Any]) -> list[Any]:
    """Return each locally or pre-return registered process exactly once."""
    merged: list[Any] = []
    identities: set[tuple[int, int]] = set()
    for item in [*owned, *_registered_owned]:
        identity = (item.process.pid, item.start_ticks)
        if identity not in identities:
            identities.add(identity)
            merged.append(item)
    return merged


def assert_trusted_root_copy_r5() -> None:
    if os.geteuid() != 0:
        return
    if REPO != TRUSTED_REPO or SELF_PATH != TRUSTED_REPO / "scripts/friday-fips-lab-r5.py":
        base.refuse("privileged R5 execution requires the exact root-owned reviewed staging tree")
    paths = (
        TRUSTED_REPO, TRUSTED_REPO / "scripts", TRUSTED_REPO / "lab-bin", EVIDENCE_ROOT,
        TRUSTED_REPO / ".venv", TRUSTED_REPO / ".venv/lib",
        TRUSTED_REPO / ".venv/lib/python3.12",
        TRUSTED_REPO / ".venv/lib/python3.12/site-packages",
        SELF_PATH, R3_PATH, r3.R2_PATH, MANIFEST_PATH, BUILD_RECEIPT_PATH, ACTION_SCOPE_PATH,
        r2.BASE_PATH, r2.CAPTURE_PATH,
        r2.MINT_BOOTSTRAP, r2.DKG, r2.VALIDATOR, r2.SIGNER, r2.DRIVER, TERMINAL_DRIVER,
        r2.PARTICIPANT, r2.INSPECTOR,
    )
    for path in paths:
        metadata = path.stat(follow_symlinks=False)
        if path.is_symlink() or metadata.st_uid != 0 or metadata.st_gid != 0 or metadata.st_mode & 0o022:
            base.refuse(f"reviewed R5 staging path is symlinked, non-root, or writable: {path}")
    evidence_metadata = EVIDENCE_ROOT.stat(follow_symlinks=False)
    if not stat.S_ISDIR(evidence_metadata.st_mode) or stat.S_IMODE(evidence_metadata.st_mode) != 0o700:
        base.refuse("reviewed R5 evidence directory is not a root-only 0700 directory")


def validate_phase_journal(path: Path, *, require_success: bool) -> list[dict[str, Any]]:
    global _dkg_phase_journal_evidence
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != base.UID or metadata.st_gid != base.GID \
                or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_size > 64 * 1024:
            base.refuse("R4 DKG phase journal ownership, mode, type, or size differs")
        content = b""
        while chunk := os.read(descriptor, 64 * 1024 + 1 - len(content)):
            content += chunk
            if len(content) > 64 * 1024:
                base.refuse("R4 DKG phase journal exceeds its evidence bound")
    finally:
        os.close(descriptor)
    _dkg_phase_journal_evidence = {
        "device": metadata.st_dev, "inode": metadata.st_ino, "size": len(content),
        "sha256": _sha256_bytes(content),
    }
    records: list[dict[str, Any]] = []
    for line in content.decode("utf-8").splitlines():
        value = json.loads(line)
        if not isinstance(value, dict) or set(value) != {"schema", "stage", "status", "unix_ms"} \
                or value["schema"] != "PLEBEIAN_FRIDAY_FIPS_DKG_PHASE_V1" \
                or value["stage"] not in PHASES or value["status"] not in {"begin", "ok", "failed"} \
                or not isinstance(value["unix_ms"], int) or value["unix_ms"] < 0:
            base.refuse("R4 DKG phase journal contains a non-fixed or malformed value")
        records.append(value)
    if not records:
        base.refuse("R4 DKG phase journal is empty")
    if require_success:
        expected: list[tuple[str, str]] = [("cli_start", "ok")]
        for stage in PHASES[1:-1]:
            expected.extend(((stage, "begin"), (stage, "ok")))
        expected.append(("cli_complete", "ok"))
        if [(record["stage"], record["status"]) for record in records] != expected:
            base.refuse("R4 DKG phase sequence is incomplete or out of order")
    return records


def read_dkg_result(path: Path) -> dict[str, Any]:
    """Hash and parse the exact same bounded, identity-checked byte buffer."""
    global _dkg_result_evidence
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != base.UID or metadata.st_gid != base.GID \
                or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_size > 256 * 1024:
            base.refuse("R4 DKG result ownership, mode, type, or size differs")
        content = b""
        while chunk := os.read(descriptor, 256 * 1024 + 1 - len(content)):
            content += chunk
            if len(content) > 256 * 1024:
                base.refuse("R4 DKG result exceeds its public evidence bound")
    finally:
        os.close(descriptor)
    _dkg_result_evidence = {
        "device": metadata.st_dev, "inode": metadata.st_ino, "size": len(content),
        "sha256": _sha256_bytes(content),
    }
    value = json.loads(content)
    if not isinstance(value, dict):
        base.refuse("R4 DKG result is not a JSON object")
    return value


def read_owned_json_artifact(path: Path, label: str, expected: bytes) -> dict[str, Any]:
    """Read one exact bounded audit copy and require identity plus pipe equality."""
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != base.UID or metadata.st_gid != base.GID \
                or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_nlink != 1 \
                or metadata.st_size > 256 * 1024:
            base.refuse(f"{label} ownership, mode, links, type, or size differs")
        content = b""
        while chunk := os.read(descriptor, 256 * 1024 + 1 - len(content)):
            content += chunk
            if len(content) > 256 * 1024:
                base.refuse(f"{label} exceeds its evidence bound")
    finally:
        os.close(descriptor)
    if content != expected:
        base.refuse(f"{label} audit copy differs from the child-to-parent pipe")
    _terminal_artifact_evidence[label] = {
        "transport": "child_stdout_pipe_with_matching_audit_copy",
        "device": metadata.st_dev, "inode": metadata.st_ino, "size": len(content),
        "sha256": _sha256_bytes(content),
    }
    value = json.loads(content)
    if not isinstance(value, dict):
        base.refuse(f"{label} is not a JSON object")
    return value


def run_terminal_owned(
        role: str, argv: list[str], records: list[dict[str, Any]], *, timeout: float,
) -> subprocess.CompletedProcess[bytes]:
    """Run one terminal child with an identity-bound stdout pipe.

    Unlike the inherited generic helper, this path never reopens stdout by a
    pathname after child exit.  The pipe bytes are therefore the authoritative
    result; the 0600 file written by the child is admitted only when identical.
    """
    if not argv or not argv[0].startswith("/") or re.fullmatch(r"[a-z0-9-]{1,48}", role) is None:
        base.refuse("terminal helper identity is not exact")
    child: subprocess.Popen[bytes] | None = None
    start_ticks: int | None = None
    record: dict[str, Any] | None = None
    timed_out = False
    descendants_remained = False
    previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
    try:
        try:
            child = subprocess.Popen(
                argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                env={}, close_fds=True, start_new_session=True,
            )
            record = {
                "role": role, "pid": child.pid, "procStartTicks": None,
                "processGroup": child.pid, "exitCode": None, "timedOut": False,
                "descendantsRequiredCleanup": False, "groupAbsentAfterCleanup": False,
                "registrationState": "spawned",
            }
            records.append(record)
            start_ticks = base.process_start_ticks(child.pid)
            record["procStartTicks"] = start_ticks
            record["registrationState"] = "registered"
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)
        assert child is not None and record is not None
        try:
            stdout, stderr = child.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            r2.stop_synchronous_group(child, start_ticks)
            stdout, stderr = child.communicate(timeout=5)
        descendants_remained = r2.process_group_exists(child.pid)
        if descendants_remained:
            r2.stop_synchronous_group(child, start_ticks)
        if len(stdout) > 256 * 1024 or len(stderr) > 10_485_760:
            base.refuse(f"terminal {role} exceeded its reviewed output bound")
        if timed_out:
            base.refuse(f"terminal {role} exceeded its reviewed timeout")
        if descendants_remained:
            base.refuse(f"terminal {role} left descendant processes after its leader exited")
        if child.returncode != 0:
            raise subprocess.CalledProcessError(child.returncode or 1, argv, output=stdout, stderr=stderr)
        if not stdout.endswith(b"\n") or stdout.count(b"\n") != 1:
            base.refuse(f"terminal {role} did not emit one canonical result line")
        return subprocess.CompletedProcess(argv, child.returncode, stdout, stderr)
    except BaseException:
        if child is not None and r2.process_group_exists(child.pid):
            r2.stop_synchronous_group(child, start_ticks)
        raise
    finally:
        if child is not None and r2.process_group_exists(child.pid):
            r2.stop_synchronous_group(child, start_ticks)
        if record is not None:
            record.update({
                "procStartTicks": start_ticks, "exitCode": child.returncode if child is not None else None,
                "timedOut": timed_out, "descendantsRequiredCleanup": descendants_remained,
                "groupAbsentAfterCleanup": child is not None and not r2.process_group_exists(child.pid),
                "registrationState": "cleaned" if child is not None and not r2.process_group_exists(child.pid)
                else record["registrationState"],
            })


def load_manifest_r5(expected_manifest_hash: str, expected_self_hash: str) -> dict[str, Any]:
    """Verify the exact R5 packet and its enforced phase/cleanup budgets."""
    if re.fullmatch(r"[0-9a-f]{64}", expected_manifest_hash) is None \
            or re.fullmatch(r"[0-9a-f]{64}", expected_self_hash) is None:
        base.refuse("reviewed R5 hash argument is malformed")
    if r2.sha256_file(MANIFEST_PATH) != expected_manifest_hash or r2.sha256_file(SELF_PATH) != expected_self_hash:
        base.refuse("R5 manifest/controller differs from reviewed bytes")
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    r2.exact_object(manifest, {
        "schema", "approval_ready", "reason_not_ready", "run_id", "run_root", "host", "limits",
        "fixed_network", "binary_pins", "dependency_pins", "source_pins", "evidence_result",
    }, "R5 manifest")
    if manifest["schema"] != "PLEBEIAN_FRIDAY_FIPS_LAB_EXECUTION_V5" or manifest["approval_ready"] is not True:
        base.refuse(f"R5 execution manifest is inert: {manifest.get('reason_not_ready')}")
    if manifest["run_id"] != RUN_ID or manifest["run_root"] != str(RUN_ROOT) \
            or manifest["evidence_result"] != str(EVIDENCE_RESULT):
        base.refuse("reviewed R5 run or evidence identity differs")
    if manifest["host"] != {
        "hostname": socket.gethostname(), "kernel_release": os.uname().release,
        "uid": 1000, "gid": 1000, "user": "maximoto",
    }:
        base.refuse("reviewed R5 host identity differs")
    if manifest["limits"] != {
        "wall_seconds": R5_DRIVER_DEADLINE_SECONDS, "outer_timeout_seconds": R5_OUTER_TIMEOUT_SECONDS,
        "cleanup_budget_seconds": R5_CLEANUP_BUDGET_SECONDS,
        "terminal_prepare_deadline_seconds": R5_TERMINAL_PREPARE_DEADLINE_SECONDS,
        "outbid_deadline_seconds": R5_OUTBID_DEADLINE_SECONDS, "startup_seconds": 60,
        "shutdown_seconds": 15, "max_log_bytes_per_process": 10_485_760,
        "child_nproc": R4_CHILD_NPROC,
    }:
        base.refuse("reviewed R5 limits differ")
    expected_network = {
        "namespaces": list(base.ALL_NAMESPACES), "underlay_cidr": "198.18.242.0/29",
        "underlay_addresses": list(base.UNDERLAY_CIDR_ADDRESSES), "udp_port": 32121,
        "comet_p2p_port": 26656, "comet_rpc_port": 26657, "signer_rpc_port": 39101,
        "mint_port": 3338, "site_port": 8080, "external_egress": False,
        "host_routes": False, "host_firewall_changes": False, "host_file_capabilities": False,
    }
    if manifest["fixed_network"] != expected_network:
        base.refuse("reviewed R5 isolated network differs")
    source_paths = {
        str(SELF_PATH), str(R3_PATH), str(r3.R2_PATH), str(r2.BASE_PATH),
        str(r2.CAPTURE_PATH), str(r2.MINT_BOOTSTRAP), str(BUILD_RECEIPT_PATH), str(ACTION_SCOPE_PATH),
    }
    sources = r2.exact_object(manifest["source_pins"], source_paths | {"reviewed_integration_commit"}, "R5 source pins")
    for path_text in source_paths:
        if re.fullmatch(r"[0-9a-f]{64}", str(sources[path_text])) is None \
                or r2.sha256_file(Path(path_text)) != sources[path_text]:
            base.refuse(f"R5 source differs from reviewed bytes: {path_text}")
    if sources[str(SELF_PATH)] != expected_self_hash:
        base.refuse("manifest and invocation disagree on R5 controller hash")
    expected_binaries = {
        str(r2.PYTHON), base.FIPS, base.FIPSCTL, base.IP, base.NFT, base.SETPRIV,
        base.PRLIMIT, base.SS, base.ENV, str(r2.VALIDATOR), str(r2.DKG), str(r2.SIGNER),
        str(r2.DRIVER), str(TERMINAL_DRIVER), str(r2.PARTICIPANT), str(r2.INSPECTOR),
    }
    pins = r2.exact_object(manifest["binary_pins"], expected_binaries, "R5 binary pins")
    for path_text in expected_binaries:
        path = Path(path_text)
        metadata = path.stat(follow_symlinks=False)
        if not path.is_file() or path.is_symlink() or not os.access(path, os.X_OK) \
                or metadata.st_uid != 0 or metadata.st_gid != 0 or metadata.st_mode & 0o022 \
                or re.fullmatch(r"[0-9a-f]{64}", str(pins[path_text])) is None \
                or r2.sha256_file(path) != pins[path_text]:
            base.refuse(f"R5 binary is absent, mutable/non-root, symlinked, non-executable, or differs: {path_text}")
    dependency = r2.exact_object(manifest["dependency_pins"], {
        "nutshell_distribution", "nutshell_version", "site_packages_tree_sha256", "entry_module",
        "nutshell_record_sha256", "nutshell_metadata_sha256",
    }, "R5 dependency pins")
    if dependency != {
        "nutshell_distribution": "cashu", "nutshell_version": "0.19.2",
        "site_packages_tree_sha256": r2.nutshell_tree_sha256(), "entry_module": "cashu.mint",
        "nutshell_record_sha256": r2.sha256_file(r2.NUTSHELL_SITE / "cashu-0.19.2.dist-info/RECORD"),
        "nutshell_metadata_sha256": r2.sha256_file(r2.NUTSHELL_SITE / "cashu-0.19.2.dist-info/METADATA"),
    }:
        base.refuse("R5 Nutshell dependency tree differs from the reviewed FakeWallet mint")
    return manifest


def provision_application_r4(ulas: list[str], synchronous: list[dict[str, Any]]) -> dict[str, Any]:
    global _dkg_phase_records
    application = RUN_ROOT / "application.json"
    dkg_result = RUN_ROOT / "dkg-result.json"
    try:
        r2.run_synchronous_owned("dkg-provision", base.dropped_argv(str(r2.DKG), [
            "provision", "--config", str(application), "--participant-binary", str(r2.PARTICIPANT),
            "--inspector-binary", str(r2.INSPECTOR), "--phase-journal", str(PHASE_JOURNAL),
            "--output", str(dkg_result),
        ], node_root=RUN_ROOT), synchronous, timeout=240)
    except BaseException:
        if PHASE_JOURNAL.exists():
            _dkg_phase_records = validate_phase_journal(PHASE_JOURNAL, require_success=False)
        raise
    _dkg_phase_records = validate_phase_journal(PHASE_JOURNAL, require_success=True)
    dkg = read_dkg_result(dkg_result)
    committee = dkg.get("committeePublicKey")
    if not isinstance(committee, str) or r2.re.fullmatch(r"02[0-9a-f]{64}", committee) is None:
        base.refuse("R4 DKG result lacks an even-Y threshold public key")
    r2.run_synchronous_owned("comet-init", base.dropped_argv(str(r2.VALIDATOR), [
        "init-remote", "--home", str(RUN_ROOT / "network"), "--hosts", ",".join(ulas),
        "--committee-public-key", committee,
    ], node_root=RUN_ROOT), synchronous, timeout=45)
    facts = r2.run_synchronous_owned("comet-facts", base.dropped_argv(str(r2.VALIDATOR), [
        "network-facts", "--home", str(RUN_ROOT / "network"),
    ], node_root=RUN_ROOT), synchronous, timeout=20).stdout.decode()
    base.write_owned(RUN_ROOT / "network-facts.json", facts, 0o600)
    base.write_owned(RUN_ROOT / "node-1/mint.seed", os.urandom(32).hex() + "\n", 0o600)
    return dkg


_run_driver_r2 = r2.run_driver


def _terminal_prepare_result(value: Any) -> dict[str, Any]:
    result = r2.exact_object(value, {"schema", "prepared", "branches"}, "R4 terminal prepare result")
    if result["schema"] != "PLEBEIAN_FRIDAY_FIPS_R4_TERMINAL_PREPARE_RESULT_V1" \
            or result["prepared"] is not True or not isinstance(result["branches"], list) \
            or len(result["branches"]) != 2:
        base.refuse("R4 terminal prepare did not create both normal branches")
    expected = (("winner_payout", 2500), ("reserve_unmet_return", 3000))
    for branch, (name, amount) in zip(result["branches"], expected, strict=True):
        r2.exact_object(branch, {"branch", "auctionId", "operationId", "amount"}, "R4 prepared branch")
        if branch["branch"] != name or branch["amount"] != amount \
                or re.fullmatch(r"[0-9a-f]{64}", str(branch["operationId"])) is None \
                or not isinstance(branch["auctionId"], str) or not branch["auctionId"]:
            base.refuse("R4 prepared branch identity or amount differs")
    return result


def _terminal_result(value: Any, prepared: dict[str, Any]) -> dict[str, Any]:
    result = r2.exact_object(value, {
        "schema", "terminalBranches", "emergencyRefund", "fakeMoneyOnly",
        "fipsTransportRequired", "oneSignerUnavailable",
    }, "R4 terminal result")
    if result["schema"] != "PLEBEIAN_FRIDAY_FIPS_R4_TERMINAL_RESULT_V1" \
            or result["fakeMoneyOnly"] is not True or result["fipsTransportRequired"] is not True \
            or result["oneSignerUnavailable"] is not True \
            or result["emergencyRefund"] != {
                "status": "not_composed", "reason": "distinct admitted-pool unilateral authority is absent",
            } or not isinstance(result["terminalBranches"], list) or len(result["terminalBranches"]) != 2:
        base.refuse("R4 terminal result changed its reviewed scope or emergency limitation")
    for branch, expected in zip(result["terminalBranches"], prepared["branches"], strict=True):
        r2.exact_object(branch, {
            "branch", "auctionId", "operationId", "amount", "closeHeight", "lifecycle",
            "participantIds", "thresholdSignatureVerified", "inputStates", "recipientAmount",
            "recipientProofCount", "recipientStates",
        }, "R4 terminal branch")
        if branch["branch"] != expected["branch"] or branch["auctionId"] != expected["auctionId"] \
                or branch["operationId"] != expected["operationId"] or branch["amount"] != expected["amount"] \
                or branch["recipientAmount"] != expected["amount"] or branch["lifecycle"] != "recipient_imported" \
                or branch["thresholdSignatureVerified"] is not True \
                or branch["participantIds"] != [1, 2, 3] \
                or not isinstance(branch["closeHeight"], int) or branch["closeHeight"] < 1 \
                or not isinstance(branch["recipientProofCount"], int) or branch["recipientProofCount"] < 1 \
                or not isinstance(branch["inputStates"], list) or not branch["inputStates"] \
                or set(branch["inputStates"]) != {"SPENT"} \
                or not isinstance(branch["recipientStates"], list) or not branch["recipientStates"] \
                or set(branch["recipientStates"]) != {"UNSPENT"}:
            base.refuse("R4 terminal branch lacks exact threshold, spend, import, or ownership evidence")
    return result


def run_driver_r5(synchronous: list[dict[str, Any]]) -> dict[str, Any]:
    """Run the reviewed branches under explicit controller-relative deadlines."""
    context = RUN_ROOT / "r4-terminal-context.json"
    prepare_result = RUN_ROOT / "r4-terminal-prepared.json"
    terminal_result = RUN_ROOT / "r4-terminal-result.json"
    common = [
        "--application", str(RUN_ROOT / "application.json"),
        "--dkg-result", str(RUN_ROOT / "dkg-result.json"),
        "--network-facts", str(RUN_ROOT / "network-facts.json"),
        "--participant-binary", str(r2.PARTICIPANT), "--context", str(context),
    ]
    prepare_process = run_terminal_owned("terminal-prepare", base.dropped_argv(str(TERMINAL_DRIVER), [
        "prepare", *common, "--output", str(prepare_result),
    ], namespace=base.NODE_NAMESPACES[0], node_root=RUN_ROOT / "node-1"), synchronous,
        timeout=phase_timeout(R5_TERMINAL_PREPARE_DEADLINE_SECONDS, 300, "terminal prepare"))
    prepared = _terminal_prepare_result(read_owned_json_artifact(
        prepare_result, "terminalPrepare", prepare_process.stdout,
    ))
    record_phase("terminal_prepare_complete", R5_TERMINAL_PREPARE_DEADLINE_SECONDS)
    # The inherited path has two sequential maximums (600 + 180 seconds).
    # Refuse before it begins unless the whole reviewed allowance remains.
    if R5_OUTBID_DEADLINE_SECONDS - elapsed_seconds() < 780:
        base.refuse("R5 outbid path lacks its complete reviewed time allowance")
    outbid = _run_driver_r2(synchronous)
    record_phase("outbid_recovery_complete", R5_OUTBID_DEADLINE_SECONDS)
    settle_process = run_terminal_owned("terminal-settle", base.dropped_argv(str(TERMINAL_DRIVER), [
        "settle", *common, "--output", str(terminal_result),
    ], namespace=base.NODE_NAMESPACES[0], node_root=RUN_ROOT / "node-1"), synchronous,
        timeout=phase_timeout(R5_DRIVER_PHASE_DEADLINE_SECONDS, 2_700, "terminal settlement"))
    terminal = _terminal_result(read_owned_json_artifact(
        terminal_result, "terminalResult", settle_process.stdout,
    ), prepared)
    record_phase("normal_terminal_complete", R5_DRIVER_PHASE_DEADLINE_SECONDS)
    global _terminal_result_evidence
    _terminal_result_evidence = terminal
    return outbid


def write_evidence_r5(path: Path, value: dict[str, Any]) -> None:
    enriched = dict(value)
    schema = enriched.get("schema")
    if schema == "COCO_DEMO_FIPS_R2_INTEGRATION_EVIDENCE_V1":
        enriched["schema"] = "COCO_DEMO_FIPS_R5_INTEGRATION_EVIDENCE_V1"
    elif schema in {"PLEBEIAN_FRIDAY_FIPS_LAB_FAILURE_V2", "PLEBEIAN_FRIDAY_FIPS_LAB_FAILURE_V3"}:
        enriched["schema"] = "PLEBEIAN_FRIDAY_FIPS_LAB_FAILURE_V5"
    enriched["r3ControllerSha256"] = R3_CONTROLLER_SHA256
    enriched["dkgPhaseRecords"] = _dkg_phase_records
    enriched["dkgPhaseJournal"] = _dkg_phase_journal_evidence
    enriched["dkgResult"] = _dkg_result_evidence
    enriched["normalTerminalBranches"] = _terminal_result_evidence
    enriched["normalTerminalArtifacts"] = _terminal_artifact_evidence
    enriched["phaseTiming"] = list(_phase_timing_evidence)
    enriched["emergencyRefundAuthority"] = {
        "status": "not_composed",
        "reason": "distinct admitted-pool unilateral authority is absent",
    }
    persist_reserved_outcome(path, enriched)


_preflight_r3 = base.preflight
_cleanup_owned_r3 = r2.cleanup_owned


def preflight_r5() -> str:
    """Reserve durable outcome identity before the first mutable lab effect."""
    if os.geteuid() != 0 or os.getegid() != 0:
        base.refuse("R5 controller requires the exact reviewed root invocation")
    if _outcome_descriptor is not None or _phase_zero is not None:
        base.refuse("R5 preflight is single-use")
    register_outcome_reservation(owner_uid=0, owner_gid=0)
    return _preflight_r3()


def cleanup_owned_r5(
        owned: list[Any], created_namespaces: list[str], rules_before: str | None,
        created_host_links: set[str],
) -> list[str]:
    return _cleanup_owned_r3(
        merged_owned_for_cleanup(owned), created_namespaces, rules_before, created_host_links,
    )


r2.assert_trusted_root_copy = assert_trusted_root_copy_r5
r2.load_manifest = load_manifest_r5
r2.provision_application = provision_application_r4
r2.run_driver = run_driver_r5
base.dropped_argv = dropped_argv_r5
base.start_owned = start_owned_r5
base.preflight = preflight_r5
base.write_evidence = write_evidence_r5
r2.cleanup_owned = cleanup_owned_r5


if __name__ == "__main__":
    raise SystemExit(r2.main())
