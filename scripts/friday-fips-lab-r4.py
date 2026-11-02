#!/usr/bin/python3
"""R4 full-lab controller: R3 isolation, phase-journal DKG and terminal branches.

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
TRUSTED_REPO = Path("/var/lib/plebeian-friday-fips-r4-reviewed")
REPO = Path(__file__).resolve().parent.parent
R3_PATH = REPO / "scripts/friday-fips-lab-r3.py"
SELF_PATH = Path(__file__).resolve()
MANIFEST_PATH = REPO / "FIPS-LOCAL-LAB-R4-EXECUTION.json"
BUILD_RECEIPT_PATH = REPO / "FIPS-LOCAL-LAB-R4-BUILD-RECEIPT.json"
ACTION_SCOPE_PATH = REPO / "FIPS-LOCAL-LAB-R4-ACTION-SCOPE.md"
RUN_ID = "friday-fips-lab-20261022-r4"
RUN_ROOT = Path("/tmp/plebeian-friday-fips-lab.20261022-r4")
EVIDENCE_PATH = Path("/tmp/plebeian-friday-fips-lab.20261022-r4-success.json")
FAILURE_PATH = Path("/tmp/plebeian-friday-fips-lab.20261022-r4-failure.json")
PHASE_JOURNAL = RUN_ROOT / "dkg-phase.jsonl"
TERMINAL_DRIVER = REPO / "lab-bin/plebeian-friday-terminal-driver-r4"
R4_CHILD_NPROC = 512

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


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


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


def dropped_argv_r4(
        executable: str, arguments: list[str], *, namespace: str | None = None,
        capability: str | None = None, node_root: Path | None = None) -> list[str]:
    """R4 child boundary with a bounded UID-global thread/process allowance.

    The separately approved DKG diagnostic's Bun launcher received SIGILL
    before its first source-level phase record while using the prior 128-task
    limit. RLIMIT_NPROC is UID-global across PID namespaces, so 128 is not a
    stable per-lab cap on this shared host and could have contributed. R4 keeps
    every other privilege/resource restriction and raises only this bound;
    process identity cleanup remains authoritative. Causality remains unproven
    until the reviewed R4 run.
    """
    if namespace is not None and namespace not in base.NODE_NAMESPACES:
        base.refuse("R4 privilege drop requested for a non-node namespace")
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


def assert_trusted_root_copy_r4() -> None:
    if os.geteuid() != 0:
        return
    if REPO != TRUSTED_REPO or SELF_PATH != TRUSTED_REPO / "scripts/friday-fips-lab-r4.py":
        base.refuse("privileged R4 execution requires the exact root-owned reviewed staging tree")
    paths = (
        TRUSTED_REPO, TRUSTED_REPO / "scripts", TRUSTED_REPO / "lab-bin",
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
            base.refuse(f"reviewed R4 staging path is symlinked, non-root, or writable: {path}")


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


def load_manifest_r4(expected_manifest_hash: str, expected_self_hash: str) -> dict[str, Any]:
    """Verify the exact R4 packet, including its longer fixed terminal window."""
    if re.fullmatch(r"[0-9a-f]{64}", expected_manifest_hash) is None \
            or re.fullmatch(r"[0-9a-f]{64}", expected_self_hash) is None:
        base.refuse("reviewed R4 hash argument is malformed")
    if r2.sha256_file(MANIFEST_PATH) != expected_manifest_hash or r2.sha256_file(SELF_PATH) != expected_self_hash:
        base.refuse("R4 manifest/controller differs from reviewed bytes")
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    r2.exact_object(manifest, {
        "schema", "approval_ready", "reason_not_ready", "run_id", "run_root", "host", "limits",
        "fixed_network", "binary_pins", "dependency_pins", "source_pins", "evidence_path", "failure_evidence_path",
    }, "R4 manifest")
    if manifest["schema"] != "PLEBEIAN_FRIDAY_FIPS_LAB_EXECUTION_V4" or manifest["approval_ready"] is not True:
        base.refuse(f"R4 execution manifest is inert: {manifest.get('reason_not_ready')}")
    if manifest["run_id"] != RUN_ID or manifest["run_root"] != str(RUN_ROOT) \
            or manifest["evidence_path"] != str(EVIDENCE_PATH) or manifest["failure_evidence_path"] != str(FAILURE_PATH):
        base.refuse("reviewed R4 run or evidence identity differs")
    if manifest["host"] != {
        "hostname": socket.gethostname(), "kernel_release": os.uname().release,
        "uid": 1000, "gid": 1000, "user": "maximoto",
    }:
        base.refuse("reviewed R4 host identity differs")
    if manifest["limits"] != {
        "wall_seconds": 3600, "outer_timeout_seconds": 4200, "startup_seconds": 60,
        "shutdown_seconds": 15, "max_log_bytes_per_process": 10_485_760,
        "child_nproc": R4_CHILD_NPROC,
    }:
        base.refuse("reviewed R4 limits differ")
    expected_network = {
        "namespaces": list(base.ALL_NAMESPACES), "underlay_cidr": "198.18.242.0/29",
        "underlay_addresses": list(base.UNDERLAY_CIDR_ADDRESSES), "udp_port": 32121,
        "comet_p2p_port": 26656, "comet_rpc_port": 26657, "signer_rpc_port": 39101,
        "mint_port": 3338, "site_port": 8080, "external_egress": False,
        "host_routes": False, "host_firewall_changes": False, "host_file_capabilities": False,
    }
    if manifest["fixed_network"] != expected_network:
        base.refuse("reviewed R4 isolated network differs")
    source_paths = {
        str(SELF_PATH), str(R3_PATH), str(r3.R2_PATH), str(r2.BASE_PATH),
        str(r2.CAPTURE_PATH), str(r2.MINT_BOOTSTRAP), str(BUILD_RECEIPT_PATH), str(ACTION_SCOPE_PATH),
    }
    sources = r2.exact_object(manifest["source_pins"], source_paths | {"reviewed_integration_commit"}, "R4 source pins")
    for path_text in source_paths:
        if re.fullmatch(r"[0-9a-f]{64}", str(sources[path_text])) is None \
                or r2.sha256_file(Path(path_text)) != sources[path_text]:
            base.refuse(f"R4 source differs from reviewed bytes: {path_text}")
    if sources[str(SELF_PATH)] != expected_self_hash:
        base.refuse("manifest and invocation disagree on R4 controller hash")
    expected_binaries = {
        str(r2.PYTHON), base.FIPS, base.FIPSCTL, base.IP, base.NFT, base.SETPRIV,
        base.PRLIMIT, base.SS, base.ENV, str(r2.VALIDATOR), str(r2.DKG), str(r2.SIGNER),
        str(r2.DRIVER), str(TERMINAL_DRIVER), str(r2.PARTICIPANT), str(r2.INSPECTOR),
    }
    pins = r2.exact_object(manifest["binary_pins"], expected_binaries, "R4 binary pins")
    for path_text in expected_binaries:
        path = Path(path_text)
        metadata = path.stat(follow_symlinks=False)
        if not path.is_file() or path.is_symlink() or not os.access(path, os.X_OK) \
                or metadata.st_uid != 0 or metadata.st_gid != 0 or metadata.st_mode & 0o022 \
                or re.fullmatch(r"[0-9a-f]{64}", str(pins[path_text])) is None \
                or r2.sha256_file(path) != pins[path_text]:
            base.refuse(f"R4 binary is absent, mutable/non-root, symlinked, non-executable, or differs: {path_text}")
    dependency = r2.exact_object(manifest["dependency_pins"], {
        "nutshell_distribution", "nutshell_version", "site_packages_tree_sha256", "entry_module",
        "nutshell_record_sha256", "nutshell_metadata_sha256",
    }, "R4 dependency pins")
    if dependency != {
        "nutshell_distribution": "cashu", "nutshell_version": "0.19.2",
        "site_packages_tree_sha256": r2.nutshell_tree_sha256(), "entry_module": "cashu.mint",
        "nutshell_record_sha256": r2.sha256_file(r2.NUTSHELL_SITE / "cashu-0.19.2.dist-info/RECORD"),
        "nutshell_metadata_sha256": r2.sha256_file(r2.NUTSHELL_SITE / "cashu-0.19.2.dist-info/METADATA"),
    }:
        base.refuse("R4 Nutshell dependency tree differs from the reviewed FakeWallet mint")
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


def run_driver_r4(synchronous: list[dict[str, Any]]) -> dict[str, Any]:
    """Prepare terminal cases, retain R2 outbid recovery, then close both cases."""
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
    ], namespace=base.NODE_NAMESPACES[0], node_root=RUN_ROOT / "node-1"), synchronous, timeout=300)
    prepared = _terminal_prepare_result(read_owned_json_artifact(
        prepare_result, "terminalPrepare", prepare_process.stdout,
    ))
    outbid = _run_driver_r2(synchronous)
    settle_process = run_terminal_owned("terminal-settle", base.dropped_argv(str(TERMINAL_DRIVER), [
        "settle", *common, "--output", str(terminal_result),
    ], namespace=base.NODE_NAMESPACES[0], node_root=RUN_ROOT / "node-1"), synchronous, timeout=2700)
    terminal = _terminal_result(read_owned_json_artifact(
        terminal_result, "terminalResult", settle_process.stdout,
    ), prepared)
    global _terminal_result_evidence
    _terminal_result_evidence = terminal
    return outbid


_write_evidence_r3 = base.write_evidence


def write_evidence_r4(path: Path, value: dict[str, Any]) -> None:
    enriched = dict(value)
    schema = enriched.get("schema")
    if schema == "COCO_DEMO_FIPS_R2_INTEGRATION_EVIDENCE_V1":
        enriched["schema"] = "COCO_DEMO_FIPS_R4_INTEGRATION_EVIDENCE_V1"
    elif schema in {"PLEBEIAN_FRIDAY_FIPS_LAB_FAILURE_V2", "PLEBEIAN_FRIDAY_FIPS_LAB_FAILURE_V3"}:
        enriched["schema"] = "PLEBEIAN_FRIDAY_FIPS_LAB_FAILURE_V4"
    enriched["r3ControllerSha256"] = R3_CONTROLLER_SHA256
    enriched["dkgPhaseRecords"] = _dkg_phase_records
    enriched["dkgPhaseJournal"] = _dkg_phase_journal_evidence
    enriched["dkgResult"] = _dkg_result_evidence
    enriched["normalTerminalBranches"] = _terminal_result_evidence
    enriched["normalTerminalArtifacts"] = _terminal_artifact_evidence
    enriched["emergencyRefundAuthority"] = {
        "status": "not_composed",
        "reason": "distinct admitted-pool unilateral authority is absent",
    }
    _write_evidence_r3(path, enriched)


r2.assert_trusted_root_copy = assert_trusted_root_copy_r4
r2.load_manifest = load_manifest_r4
r2.provision_application = provision_application_r4
r2.run_driver = run_driver_r4
base.dropped_argv = dropped_argv_r4
base.write_evidence = write_evidence_r4


if __name__ == "__main__":
    raise SystemExit(r2.main())
