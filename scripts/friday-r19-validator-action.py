#!/usr/bin/python3
"""Create-once staging and one bounded R19 validator invocation on V1 only."""

from __future__ import annotations

import ctypes
import hashlib
import json
import os
import pwd
import re
import stat
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

EXPECTED_SHA256 = "243910674f59a3cbb4c22a9ef3e351bd35fd75d6bd8fc49101ffdba1bddb9098"
EXPECTED_SIZE = 762544
ARTIFACT_NAME = "plebeian-friday-dkg-input-validator"
R18_MANIFEST_DIGEST = "5c91cffa47f0cc90412472b7401b42f02a3416c68a70099357c2cf4cd6f87a87"
BOOT_ID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


@dataclass(frozen=True)
class Profile:
    release_parent: Path
    final_dir: Path
    staging_dir: Path
    operator_parent: Path
    operation_root: Path
    config: Path
    transport: Path
    service_user: str = "plebeian-friday"
    owner_uid: int = 0
    owner_gid: int = 0
    dependency_uid: int = 0
    dependency_gid: int = 0
    service_uid: int = 997
    service_gid: int = 986


@dataclass(frozen=True)
class PreservedRunProfile:
    exchange: Path
    journal: Path
    lock: Path
    state: Path
    round1_output: Path
    config: Path
    transport: Path
    journal_sha256: str = ""
    journal_size: int = 0
    journal_nlink: int = 1
    participant_id: int = 1
    service_uid: int = 997
    service_gid: int = 986
    dead_pid: int = 123609
    dead_boot_id: str = "15a02667-f822-4d53-88bf-6cc7a518dda5"
    dead_start_ticks: str = "74886913"
    proc_root: Path = Path("/proc")
    host_executable: Path = Path("/opt/plebeian-auctions-friday/bin/plebeian-friday-dkg-host")
    participant_executable: Path = Path("/opt/plebeian-auctions-friday/bin/coco-demo-frost-participant")


PRODUCTION = Profile(
    release_parent=Path("/opt/plebeian-auctions-friday/releases"),
    final_dir=Path("/opt/plebeian-auctions-friday/releases/r19-input-validator"),
    staging_dir=Path("/opt/plebeian-auctions-friday/releases/.r19-input-validator.staging"),
    operator_parent=Path("/var/lib/plebeian-auctions-friday-operator"),
    operation_root=Path("/var/lib/plebeian-auctions-friday-operator/r19-input-validator"),
    config=Path("/var/lib/plebeian-auctions-friday/frost/keyset-v1/participant.config.json"),
    transport=Path("/var/lib/plebeian-auctions-friday/frost/keyset-v1/transport-secrets.json"),
)

R18 = PreservedRunProfile(
    exchange=Path("/var/lib/plebeian-auctions-friday/frost/keyset-v1/exchange/friday-demo-20261023-r14-dkg1"),
    journal=Path("/var/lib/plebeian-auctions-friday/frost/keyset-v1/exchange/friday-demo-20261023-r14-dkg1/participant-1.host-journal.jsonl"),
    lock=Path("/var/lib/plebeian-auctions-friday/frost/keyset-v1/exchange/friday-demo-20261023-r14-dkg1/participant-1.host.lock"),
    state=Path("/var/lib/plebeian-auctions-friday/frost/keyset-v1/state"),
    round1_output=Path("/var/lib/plebeian-auctions-friday/frost/keyset-v1/exchange/friday-demo-20261023-r14-dkg1/participant-1.round1.json"),
    config=Path("/var/lib/plebeian-auctions-friday/frost/keyset-v1/participant.config.json"),
    transport=Path("/var/lib/plebeian-auctions-friday/frost/keyset-v1/transport-secrets.json"),
)


def fail(message: str) -> None:
    raise RuntimeError(f"FRIDAY_R19_VALIDATOR_ACTION: {message}")


def fsync_dir(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def exact_root_dir(path: Path, mode: int | None = None, owner_uid: int = 0, owner_gid: int = 0) -> None:
    metadata = path.lstat()
    if (not stat.S_ISDIR(metadata.st_mode) or path.is_symlink() or metadata.st_uid != owner_uid
            or metadata.st_gid != owner_gid or path.resolve() != path):
        fail(f"unsafe root directory: {path}")
    if metadata.st_mode & 0o022:
        fail(f"root directory is group/world writable: {path}")
    if mode is not None and stat.S_IMODE(metadata.st_mode) != mode:
        fail(f"root directory has wrong mode: {path}")


def exact_service_dir(path: Path, mode: int, service_uid: int, service_gid: int) -> os.stat_result:
    metadata = path.lstat()
    if (not stat.S_ISDIR(metadata.st_mode) or path.is_symlink() or metadata.st_uid != service_uid
            or metadata.st_gid != service_gid or stat.S_IMODE(metadata.st_mode) != mode
            or path.resolve() != path):
        fail(f"preserved R18 directory metadata differs: {path}")
    return metadata


def read_service_text(path: Path, service_uid: int, service_gid: int, maximum: int = 1024 * 1024,
                      exact_nlink: int = 1) -> str:
    metadata = path.lstat()
    if (not stat.S_ISREG(metadata.st_mode) or path.is_symlink() or metadata.st_uid != service_uid
            or metadata.st_gid != service_gid or metadata.st_nlink != exact_nlink
            or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_size < 2
            or metadata.st_size > maximum or path.resolve() != path):
        fail(f"preserved R18 file metadata differs: {path}")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(descriptor)
        if (opened.st_dev, opened.st_ino) != (metadata.st_dev, metadata.st_ino):
            fail(f"preserved R18 file changed while opened: {path}")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(descriptor, min(65536, maximum + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > maximum:
                fail(f"preserved R18 file exceeds the bounded read: {path}")
        encoded = b"".join(chunks)
        after = os.fstat(descriptor)
        current = path.lstat()
        if ((opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns)
                != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                or (after.st_dev, after.st_ino) != (current.st_dev, current.st_ino)
                or len(encoded) != opened.st_size):
            fail(f"preserved R18 file changed while read: {path}")
    finally:
        os.close(descriptor)
    try:
        return encoded.decode("utf-8")
    except UnicodeDecodeError:
        fail(f"preserved R18 file is not UTF-8: {path}")


def exact_preserved_input(path: Path, service_uid: int, service_gid: int, mode: int = 0o600) -> dict[str, int]:
    metadata = path.lstat()
    if (not stat.S_ISREG(metadata.st_mode) or path.is_symlink() or path.resolve() != path
            or metadata.st_nlink != 1 or metadata.st_uid != service_uid or metadata.st_gid != service_gid
            or stat.S_IMODE(metadata.st_mode) != mode):
        fail(f"preserved R18 input metadata differs: {path}")
    return {"uid": metadata.st_uid, "gid": metadata.st_gid, "mode": stat.S_IMODE(metadata.st_mode),
            "nlink": metadata.st_nlink, "size": metadata.st_size}


def assert_no_dkg_processes(profile: PreservedRunProfile) -> None:
    targets = {str(profile.host_executable), str(profile.participant_executable)}
    target_identities: set[tuple[int, int]] = set()
    for target in targets:
        metadata = Path(target).stat()
        if not stat.S_ISREG(metadata.st_mode):
            fail("a pinned R18 executable path is not a regular file")
        target_identities.add((metadata.st_dev, metadata.st_ino))
    try:
        entries = list(profile.proc_root.iterdir())
    except OSError:
        fail("cannot enumerate the process table for the R18 executable scan")
    for entry in entries:
        if not entry.name.isdigit():
            continue
        try:
            executable = os.readlink(entry / "exe")
            executable_metadata = (entry / "exe").stat()
        except PermissionError:
            fail("cannot inspect a process executable; absence is unproven")
        except (FileNotFoundError, ProcessLookupError):
            continue
        normalized = executable.removesuffix(" (deleted)")
        if normalized in targets or (executable_metadata.st_dev, executable_metadata.st_ino) in target_identities:
            fail("an R18 DKG host or participant executable is still running")


def exact_journal_records(text: str) -> list[dict[str, object]]:
    if not text.endswith("\n"):
        fail("preserved R18 journal has a torn trailing record")
    try:
        records = [json.loads(line) for line in text.rstrip("\n").split("\n")]
    except json.JSONDecodeError:
        fail("preserved R18 journal is not valid JSONL")
    stages = [
        ("enroll", "started"), ("enroll", "completed"),
        ("confirm-transport", "started"), ("confirm-transport", "completed"),
        ("persist-transport", "started"), ("persist-transport", "completed"),
        ("round1", "started"), ("round1", "indeterminate"),
    ]
    if len(records) != len(stages):
        fail("preserved R18 journal does not contain the exact eight recorded transitions")
    for record, (stage, status_value) in zip(records, stages, strict=True):
        if (not isinstance(record, dict) or set(record) != {
                "schema", "manifestDigest", "participantId", "stage", "status", "evidenceDigest"}
                or record.get("schema") != "PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_JOURNAL_V1"
                or record.get("manifestDigest") != R18_MANIFEST_DIGEST
                or record.get("participantId") != 1 or record.get("stage") != stage
                or record.get("status") != status_value):
            fail("preserved R18 journal transition sequence differs")
        evidence = record.get("evidenceDigest")
        if status_value == "completed":
            if not isinstance(evidence, str) or len(evidence) != 64 or any(character not in "0123456789abcdef" for character in evidence):
                fail("preserved R18 completed journal evidence digest is invalid")
        elif evidence is not None:
            fail("preserved R18 incomplete journal transition carries evidence")
    return records


def current_boot_id(profile: PreservedRunProfile) -> string:
    path = profile.proc_root / "sys/kernel/random/boot_id"
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        raw = os.read(descriptor, 128)
        after = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    value = raw.decode("ascii", errors="strict").strip()
    if not stat.S_ISREG(after.st_mode) or not BOOT_ID_PATTERN.fullmatch(value):
        fail("current boot identity is unavailable or malformed")
    return value


def collect_r18_evidence(profile: PreservedRunProfile = R18) -> dict[str, object]:
    """Return bounded metadata pins only; never return input or journal contents."""
    exact_service_dir(profile.exchange, 0o700, profile.service_uid, profile.service_gid)
    exact_service_dir(profile.lock, 0o700, profile.service_uid, profile.service_gid)
    exact_service_dir(profile.state, 0o700, profile.service_uid, profile.service_gid)
    if list(profile.state.iterdir()):
        fail("preserved R18 state directory is no longer empty")
    if profile.round1_output.exists() or profile.round1_output.is_symlink():
        fail("preserved R18 round-one public output appeared")
    assert_no_dkg_processes(profile)
    config = exact_preserved_input(profile.config, profile.service_uid, profile.service_gid)
    transport = exact_preserved_input(profile.transport, profile.service_uid, profile.service_gid)
    journal_metadata = profile.journal.lstat()
    if journal_metadata.st_nlink not in {1, 2}:
        fail("preserved R18 journal link count is outside the historical recovery contract")
    journal_text = read_service_text(profile.journal, profile.service_uid, profile.service_gid,
                                     exact_nlink=journal_metadata.st_nlink)
    exact_journal_records(journal_text)
    encoded = journal_text.encode("utf-8")
    owner_path = profile.lock / "owner.json"
    try:
        owner = json.loads(read_service_text(owner_path, profile.service_uid, profile.service_gid))
    except json.JSONDecodeError:
        fail("preserved R18 lock owner is not valid JSON")
    expected_owner = {
        "schema": "PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_LOCK_V2", "pid": profile.dead_pid,
        "bootId": profile.dead_boot_id, "processStartTicks": profile.dead_start_ticks,
        "manifestDigest": R18_MANIFEST_DIGEST, "participantId": profile.participant_id,
    }
    if owner != expected_owner or (profile.proc_root / str(profile.dead_pid)).exists():
        fail("preserved R18 lock owner differs or its PID is present")
    return {
        "phase": "r18-evidence-collection", "observation": "CURRENT_STATE_NOT_HISTORICAL_PROOF",
        "currentBootId": current_boot_id(profile), "recordedDeadOwnerBootId": profile.dead_boot_id,
        "processesAbsent": True, "stateEntries": 0, "round1OutputAbsent": True,
        "journalTransitionValidation": "EXACT_EIGHT_KNOWN_TRANSITIONS",
        "journal": {"sha256": hashlib.sha256(encoded).hexdigest(), "size": len(encoded),
                    "uid": journal_metadata.st_uid, "gid": journal_metadata.st_gid,
                    "mode": stat.S_IMODE(journal_metadata.st_mode), "nlink": journal_metadata.st_nlink},
        "config": config, "transport": transport,
    }


def composite(profile: Profile = PRODUCTION, preserved: PreservedRunProfile = R18,
              runner=subprocess.run, access_runner=subprocess.run,
              expected_sha256: str = EXPECTED_SHA256, expected_size: int = EXPECTED_SIZE,
              access_use_setpriv: bool = True) -> dict[str, object]:
    """Seal the staged artifact, pin/recheck current evidence, then invoke once."""
    promoted = promote(profile, expected_sha256, expected_size)
    baseline_path = profile.operation_root / "r18-current-baseline.json"
    outcome_path = profile.operation_root / "outcome.json"
    if baseline_path.exists() or baseline_path.is_symlink() or outcome_path.exists() or outcome_path.is_symlink():
        fail("composite evidence already exists; retry is forbidden")
    baseline = collect_r18_evidence(preserved)
    write_new_json(baseline_path, baseline, profile.owner_uid, profile.owner_gid)
    observed_again = collect_r18_evidence(preserved)
    if observed_again != baseline:
        write_new_json(outcome_path, {
            "schema": "PLEBEIAN_FRIDAY_R19_READONLY_DKG_INPUT_VALIDATOR_OUTCOME_V1",
            "success": False, "failureCategory": "current_baseline_changed",
            "validatorInvoked": False, "artifactSha256": expected_sha256,
        }, profile.owner_uid, profile.owner_gid)
        fail("R18 current baseline changed before invocation; retry is forbidden")
    outcome = invoke(profile, runner, expected_sha256, expected_size, access_runner, access_use_setpriv)
    return {"phase": "composite-complete", "promoted": promoted["sha256"],
            "baseline": baseline, "validator": outcome}


def preflight_r18(profile: PreservedRunProfile = R18) -> dict[str, object]:
    exact_service_dir(profile.exchange, 0o700, profile.service_uid, profile.service_gid)
    exact_service_dir(profile.lock, 0o700, profile.service_uid, profile.service_gid)
    exact_service_dir(profile.state, 0o700, profile.service_uid, profile.service_gid)
    if list(profile.state.iterdir()):
        fail("preserved R18 state directory is no longer empty")
    if profile.round1_output.exists() or profile.round1_output.is_symlink():
        fail("preserved R18 round-one public output appeared")
    assert_no_dkg_processes(profile)
    exact_preserved_input(profile.config, profile.service_uid, profile.service_gid)
    exact_preserved_input(profile.transport, profile.service_uid, profile.service_gid)
    owner_path = profile.lock / "owner.json"
    try:
        owner = json.loads(read_service_text(owner_path, profile.service_uid, profile.service_gid))
    except json.JSONDecodeError:
        fail("preserved R18 lock owner is not valid JSON")
    expected_owner = {
        "schema": "PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_LOCK_V2",
        "pid": profile.dead_pid,
        "bootId": profile.dead_boot_id,
        "processStartTicks": profile.dead_start_ticks,
        "manifestDigest": R18_MANIFEST_DIGEST,
        "participantId": profile.participant_id,
    }
    if owner != expected_owner:
        fail("preserved R18 lock owner differs from the pinned dead process")
    if Path(f"/proc/{profile.dead_pid}").exists():
        fail("preserved R18 lock owner PID is present; stop for inspection")
    if not profile.journal_sha256 or profile.journal_size <= 0:
        fail("full R18 journal pin is unavailable; bounded read-only evidence collection is required")
    journal_text = read_service_text(profile.journal, profile.service_uid, profile.service_gid,
                                     exact_nlink=profile.journal_nlink)
    exact_journal_records(journal_text)
    encoded = journal_text.encode("utf-8")
    if len(encoded) != profile.journal_size or hashlib.sha256(encoded).hexdigest() != profile.journal_sha256:
        fail("complete preserved R18 journal bytes differ from the reviewed pin")
    return {"phase": "r18-preflight", "preserved": True, "deadPid": profile.dead_pid,
            "stateEntries": 0, "round1OutputAbsent": True, "processesAbsent": True,
            "journalSha256": profile.journal_sha256}


def exact_artifact(path: Path, expected_sha256: str = EXPECTED_SHA256, expected_size: int = EXPECTED_SIZE,
                   owner_uid: int = 0, owner_gid: int = 0) -> None:
    metadata = path.lstat()
    if (not stat.S_ISREG(metadata.st_mode) or path.is_symlink() or metadata.st_uid != owner_uid
            or metadata.st_gid != owner_gid or metadata.st_nlink != 1 or metadata.st_size != expected_size
            or stat.S_IMODE(metadata.st_mode) != 0o755 or path.resolve() != path):
        fail("validator artifact identity, ownership, size or mode differs")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(descriptor)
        if opened.st_dev != metadata.st_dev or opened.st_ino != metadata.st_ino or opened.st_nlink != 1:
            fail("validator artifact changed while opened")
        with os.fdopen(os.dup(descriptor), "rb") as duplicate:
            digest = hashlib.file_digest(duplicate, "sha256").hexdigest()
        after = os.fstat(descriptor)
        current = path.lstat()
        if ((opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns)
                != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                or (after.st_dev, after.st_ino) != (current.st_dev, current.st_ino)):
            fail("validator artifact changed while hashed")
    finally:
        os.close(descriptor)
    if digest != expected_sha256:
        fail("validator artifact hash differs")


def create_dir(path: Path, mode: int, owner_uid: int = 0, owner_gid: int = 0) -> None:
    os.mkdir(path, mode)
    os.chmod(path, mode)
    fsync_dir(path.parent)
    exact_root_dir(path, mode, owner_uid, owner_gid)


def prepare(profile: Profile = PRODUCTION) -> dict[str, object]:
    exact_root_dir(profile.release_parent, owner_uid=profile.owner_uid, owner_gid=profile.owner_gid)
    exact_root_dir(profile.operator_parent, 0o700, profile.owner_uid, profile.owner_gid)
    for path in (profile.final_dir, profile.staging_dir, profile.operation_root):
        if path.exists() or path.is_symlink():
            fail(f"create-once destination already exists: {path}")
    create_dir(profile.staging_dir, 0o700, profile.owner_uid, profile.owner_gid)
    create_dir(profile.operation_root, 0o700, profile.owner_uid, profile.owner_gid)
    return {"phase": "prepared", "staging": str(profile.staging_dir), "operationRoot": str(profile.operation_root)}


def rename_no_replace(source: Path, destination: Path) -> None:
    libc = ctypes.CDLL("libc.so.6", use_errno=True)
    renameat2 = libc.renameat2
    renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    renameat2.restype = ctypes.c_int
    if renameat2(-100, os.fsencode(source), -100, os.fsencode(destination), 1) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(destination))


def promote(profile: Profile = PRODUCTION, expected_sha256: str = EXPECTED_SHA256,
            expected_size: int = EXPECTED_SIZE) -> dict[str, object]:
    exact_root_dir(profile.release_parent, owner_uid=profile.owner_uid, owner_gid=profile.owner_gid)
    exact_root_dir(profile.staging_dir, 0o700, profile.owner_uid, profile.owner_gid)
    exact_root_dir(profile.operation_root, 0o700, profile.owner_uid, profile.owner_gid)
    if profile.final_dir.exists() or profile.final_dir.is_symlink():
        fail("final validator release already exists")
    entries = list(profile.staging_dir.iterdir())
    artifact = profile.staging_dir / ARTIFACT_NAME
    if entries != [artifact]:
        fail("staging directory does not contain exactly the validator artifact")
    os.chown(artifact, profile.owner_uid, profile.owner_gid)
    os.chmod(artifact, 0o755)
    descriptor = os.open(artifact, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    fsync_dir(profile.staging_dir)
    exact_artifact(artifact, expected_sha256, expected_size, profile.owner_uid, profile.owner_gid)
    os.chmod(profile.staging_dir, 0o755)
    fsync_dir(profile.staging_dir)
    exact_root_dir(profile.staging_dir, 0o755, profile.owner_uid, profile.owner_gid)
    rename_no_replace(profile.staging_dir, profile.final_dir)
    fsync_dir(profile.release_parent)
    final_artifact = profile.final_dir / ARTIFACT_NAME
    exact_root_dir(profile.final_dir, 0o755, profile.owner_uid, profile.owner_gid)
    exact_artifact(final_artifact, expected_sha256, expected_size, profile.owner_uid, profile.owner_gid)
    return {"phase": "promoted", "artifact": str(final_artifact), "sha256": expected_sha256}


def exact_input_metadata(path: Path, private: bool) -> dict[str, int]:
    metadata = path.lstat()
    if (not stat.S_ISREG(metadata.st_mode) or path.is_symlink() or metadata.st_nlink != 1
            or path.resolve() != path or metadata.st_size < 2 or metadata.st_size > 1024 * 1024):
        fail(f"unsafe validator input metadata: {path}")
    if private and stat.S_IMODE(metadata.st_mode) & 0o077:
        fail("private transport input is accessible to group or world")
    return {"device": metadata.st_dev, "inode": metadata.st_ino, "mode": stat.S_IMODE(metadata.st_mode),
            "uid": metadata.st_uid, "gid": metadata.st_gid, "size": metadata.st_size,
            "mtimeNs": metadata.st_mtime_ns, "ctimeNs": metadata.st_ctime_ns}


def write_new_json(path: Path, value: object, owner_uid: int = 0, owner_gid: int = 0) -> None:
    encoded = (json.dumps(value, separators=(",", ":"), sort_keys=True) + "\n").encode()
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.write(descriptor, encoded)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.chown(path, owner_uid, owner_gid)
    os.chmod(path, 0o600)
    fsync_dir(path.parent)


def verify_service_artifact_access(profile: Profile, artifact: Path, runner=subprocess.run,
                                   use_setpriv: bool = True) -> None:
    argv = ["/usr/bin/test", "-x", str(artifact)]
    if use_setpriv:
        argv = [
            "/usr/bin/setpriv", f"--reuid={profile.service_uid}", f"--regid={profile.service_gid}",
            "--clear-groups", "--no-new-privs", "--bounding-set=-all", "--inh-caps=-all",
            "--ambient-caps=-all", *argv,
        ]
    completed = runner(argv, stdin=subprocess.DEVNULL, capture_output=True, timeout=5, check=False)
    if completed.returncode != 0 or completed.stdout != b"" or completed.stderr != b"":
        fail("Friday service identity cannot traverse and execute the sealed validator release")


def invoke(profile: Profile = PRODUCTION, runner=subprocess.run,
           expected_sha256: str = EXPECTED_SHA256, expected_size: int = EXPECTED_SIZE,
           access_runner=subprocess.run, access_use_setpriv: bool = True) -> dict[str, object]:
    exact_root_dir(profile.final_dir, 0o755, profile.owner_uid, profile.owner_gid)
    exact_root_dir(profile.operation_root, 0o700, profile.owner_uid, profile.owner_gid)
    artifact = profile.final_dir / ARTIFACT_NAME
    exact_artifact(artifact, expected_sha256, expected_size, profile.owner_uid, profile.owner_gid)
    outcome = profile.operation_root / "outcome.json"
    if outcome.exists() or outcome.is_symlink():
        fail("validator outcome already exists; retry is forbidden")
    before = {"config": exact_input_metadata(profile.config, False),
              "transport": exact_input_metadata(profile.transport, True)}
    account = pwd.getpwnam(profile.service_user)
    if account.pw_uid != profile.service_uid or account.pw_gid != profile.service_gid:
        fail("Friday service account identity differs")
    verify_service_artifact_access(profile, artifact, access_runner, access_use_setpriv)
    argv = [
        "/usr/bin/prlimit", "--core=0:0", "--",
        "/usr/bin/timeout", "--signal=TERM", "--kill-after=5s", "30s",
        "/usr/bin/unshare", "--net", "--",
        "/usr/bin/setpriv", f"--reuid={profile.service_uid}", f"--regid={profile.service_gid}", "--clear-groups",
        "--no-new-privs", "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all",
        str(artifact), str(profile.config), str(profile.transport),
    ]
    for dependency in (
        "/usr/bin/prlimit", "/usr/bin/timeout", "/usr/bin/unshare", "/usr/bin/setpriv",
        "/usr/bin/test",
        "/lib64/ld-linux-x86-64.so.2", "/lib/x86_64-linux-gnu/libc.so.6",
        "/lib/x86_64-linux-gnu/libgcc_s.so.1",
    ):
        path = Path(dependency)
        metadata = path.stat()
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != profile.dependency_uid
                or metadata.st_gid != profile.dependency_gid or metadata.st_mode & 0o022):
            fail(f"unsafe runtime dependency: {dependency}")
    try:
        completed = runner(argv, stdin=subprocess.DEVNULL, capture_output=True, timeout=40, check=False)
    except subprocess.TimeoutExpired:
        after = {"config": exact_input_metadata(profile.config, False),
                 "transport": exact_input_metadata(profile.transport, True)}
        record = {
            "schema": "PLEBEIAN_FRIDAY_R19_READONLY_DKG_INPUT_VALIDATOR_OUTCOME_V1",
            "success": False, "returnCode": None, "stdoutContract": "unavailable",
            "stderrContract": "unavailable", "failureCategory": "wrapper_timeout",
            "inputsUnchanged": before == after, "artifactSha256": expected_sha256,
        }
        write_new_json(outcome, record, profile.owner_uid, profile.owner_gid)
        fail("validator wrapper timed out; evidence preserved and retry forbidden")
    after = {"config": exact_input_metadata(profile.config, False),
             "transport": exact_input_metadata(profile.transport, True)}
    success = completed.returncode == 0 and completed.stdout == b"DKG_INPUT_VALIDATION_OK\n" and completed.stderr == b""
    allowed_failures = {
        b"DKG_INPUT_VALIDATION_FAILED:ARGUMENTS\n": "arguments",
        b"DKG_INPUT_VALIDATION_FAILED:CONFIG_READ\n": "config_read",
        b"DKG_INPUT_VALIDATION_FAILED:CONFIG_INVALID\n": "config_invalid",
        b"DKG_INPUT_VALIDATION_FAILED:TRANSPORT_READ\n": "transport_read",
        b"DKG_INPUT_VALIDATION_FAILED:TRANSPORT_INVALID\n": "transport_invalid",
    }
    record = {
        "schema": "PLEBEIAN_FRIDAY_R19_READONLY_DKG_INPUT_VALIDATOR_OUTCOME_V1",
        "success": success,
        "returnCode": completed.returncode,
        "stdoutContract": "ok" if completed.stdout == b"DKG_INPUT_VALIDATION_OK\n" else "unexpected",
        "stderrContract": "empty" if completed.stderr == b"" else "fixed_failure" if completed.stderr in allowed_failures else "unexpected",
        "failureCategory": allowed_failures.get(completed.stderr),
        "inputsUnchanged": before == after,
        "artifactSha256": expected_sha256,
    }
    write_new_json(outcome, record, profile.owner_uid, profile.owner_gid)
    if not success or before != after:
        fail("validator invocation or immutable-input check failed; evidence preserved and retry forbidden")
    return record


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in {"collect-r18-evidence", "preflight-r18", "prepare", "promote", "invoke", "composite"}:
        print("Friday R19 validator action rejected", file=sys.stderr)
        return 1
    try:
        result = {"collect-r18-evidence": collect_r18_evidence, "preflight-r18": preflight_r18,
                  "prepare": prepare, "promote": promote, "invoke": invoke,
                  "composite": composite}[sys.argv[1]]()
        print(json.dumps(result, separators=(",", ":"), sort_keys=True))
        return 0
    except Exception:
        print("Friday R19 validator action failed closed", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
