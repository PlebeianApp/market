#!/usr/bin/env python3
"""Create-once inactive APP successor installer with retained unit rollback bytes.

The checked-in manifest is deliberately not production-authorized. It may be
executed only against an explicit /tmp fixture until a separately scoped owner
action changes the authority fields and pins that exact action.
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time


RENAME_NOREPLACE = 1
RENAME_EXCHANGE = 2
AT_FDCWD = -100
MAX_FILE = 134_217_728
MAX_JSON = 1_048_576
EXPECTED_PATHS = {
    "releaseParent": "/opt/plebeian-auctions-friday/releases",
    "predecessorRoot": "/opt/plebeian-auctions-friday/releases/separated-site-browser-r2",
    "finalRoot": "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4",
    "incomingRoot": "/opt/plebeian-auctions-friday/releases/.sidequest-mvp-r4.incoming",
    "unitPath": "/etc/systemd/system/plebeian-friday-site.service",
    "unitIncoming": "/etc/systemd/system/.plebeian-friday-site.sidequest-mvp-r4-incoming.service",
    "unitRetained": "/etc/systemd/system/.plebeian-friday-site.pre-sidequest-mvp-r4.service",
    "journalPath": "/var/lib/plebeian-auctions-friday/placement-receipts/sidequest-mvp-r4-inactive-install.journal",
    "receiptPath": "/var/lib/plebeian-auctions-friday/placement-receipts/sidequest-mvp-r4-inactive-install.json",
}


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def canonical(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode()


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def read_regular(path: Path, limit: int = MAX_FILE) -> tuple[bytes, os.stat_result]:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "UNSAFE_REGULAR:" + str(path))
        require(before.st_size <= limit, "FILE_TOO_LARGE:" + str(path))
        chunks: list[bytes] = []
        total = 0
        while True:
            block = os.read(descriptor, min(1 << 20, limit + 1 - total))
            if not block:
                break
            total += len(block)
            require(total <= limit, "FILE_TOO_LARGE:" + str(path))
            chunks.append(block)
        after = os.fstat(descriptor)
        fields = lambda value: (
            value.st_dev, value.st_ino, value.st_mode, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns, value.st_nlink,
        )
        require(fields(before) == fields(after), "FILE_CHANGED:" + str(path))
        return b"".join(chunks), before
    finally:
        os.close(descriptor)


def record(path: Path, logical_path: str | None = None, limit: int = MAX_FILE) -> dict:
    raw, metadata = read_regular(path, limit)
    return {
        "path": logical_path or str(path),
        "bytes": len(raw),
        "sha256": digest(raw),
        "mode": f"{stat.S_IMODE(metadata.st_mode):04o}",
        "uid": metadata.st_uid,
        "gid": metadata.st_gid,
        "nlink": metadata.st_nlink,
    }


def directory(path: Path, mode: int, owner: int) -> dict:
    metadata = path.lstat()
    require(stat.S_ISDIR(metadata.st_mode) and not path.is_symlink(), "UNSAFE_DIRECTORY:" + str(path))
    require(stat.S_IMODE(metadata.st_mode) == mode, "DIRECTORY_MODE:" + str(path))
    require(metadata.st_uid == owner, "DIRECTORY_OWNER:" + str(path))
    return {"path": str(path), "mode": f"{mode:04o}", "uid": metadata.st_uid, "gid": metadata.st_gid}


def tree_records(root: Path, production: bool) -> list[dict]:
    values: list[dict] = []
    for current, directories, files in os.walk(root, topdown=True, followlinks=False):
        directories.sort()
        files.sort()
        current_path = Path(current)
        for name in directories:
            child = current_path / name
            metadata = child.lstat()
            require(stat.S_ISDIR(metadata.st_mode) and not child.is_symlink(), "UNSAFE_TREE_DIRECTORY:" + str(child))
        for name in files:
            child = current_path / name
            value = record(child, child.relative_to(root).as_posix())
            if not production:
                value["uid"] = 0
                value["gid"] = 0
            values.append(value)
    return values


def renameat2(source: Path, destination: Path, flags: int) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    function = getattr(libc, "renameat2", None)
    require(function is not None, "RENAMEAT2_UNAVAILABLE")
    result = function(AT_FDCWD, os.fsencode(source), AT_FDCWD, os.fsencode(destination), flags)
    if result != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(source), str(destination))


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_create(path: Path, raw: bytes, mode: int, owner: int) -> dict:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode)
    try:
        offset = 0
        while offset < len(raw):
            offset += os.write(descriptor, raw[offset:])
        os.fsync(descriptor)
        os.fchmod(descriptor, mode)
        if os.geteuid() == 0:
            os.fchown(descriptor, owner, owner)
    finally:
        os.close(descriptor)
    return record(path)


def copy_create(source: Path, destination: Path, mode: int, owner: int) -> dict:
    source_descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    destination_descriptor = -1
    try:
        before = os.fstat(source_descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "UNSAFE_SOURCE:" + str(source))
        destination_descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode)
        copied = 0
        while True:
            block = os.read(source_descriptor, 1 << 20)
            if not block:
                break
            offset = 0
            while offset < len(block):
                offset += os.write(destination_descriptor, block[offset:])
            copied += len(block)
        require(copied == before.st_size, "SOURCE_COPY_LENGTH:" + str(source))
        after = os.fstat(source_descriptor)
        fields = lambda value: (value.st_dev, value.st_ino, value.st_mode, value.st_size, value.st_mtime_ns, value.st_ctime_ns, value.st_nlink)
        require(fields(before) == fields(after), "SOURCE_CHANGED_DURING_COPY:" + str(source))
        os.fsync(destination_descriptor)
        os.fchmod(destination_descriptor, mode)
        if os.geteuid() == 0:
            os.fchown(destination_descriptor, owner, owner)
    finally:
        if destination_descriptor >= 0:
            os.close(destination_descriptor)
        os.close(source_descriptor)
    return record(destination)


def run(argv: list[str]) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=60, check=False,
        env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C", "TZ": "UTC"},
    )


def properties(systemctl: Path, service: str) -> dict[str, str]:
    completed = run([str(systemctl), "show", service, "--no-pager", "--property=LoadState", "--property=ActiveState", "--property=SubState", "--property=UnitFileState"])
    require(completed.returncode == 0, "SYSTEMD_SHOW_FAILED:" + service)
    values: dict[str, str] = {}
    for line in completed.stdout.decode("utf-8").splitlines():
        key, separator, value = line.partition("=")
        require(bool(separator) and key not in values, "SYSTEMD_SHOW_FORMAT")
        values[key] = value
    require(set(values) == {"LoadState", "ActiveState", "SubState", "UnitFileState"}, "SYSTEMD_SHOW_FIELDS")
    return values


def verify_service_state(systemctl: Path) -> dict:
    site = properties(systemctl, "plebeian-friday-site.service")
    require(site["LoadState"] == "loaded" and site["ActiveState"] == "inactive" and site["SubState"] == "dead", "SITE_NOT_INACTIVE")
    require(site["UnitFileState"] in {"static", "disabled"}, "SITE_ENABLED")
    fips = properties(systemctl, "plebeian-friday-fips.service")
    require(fips["LoadState"] == "loaded" and fips["ActiveState"] == "active" and fips["SubState"] == "running", "FIPS_NOT_RUNNING")
    jobs = run([str(systemctl), "list-jobs", "--all", "--no-legend", "--no-pager"])
    require(jobs.returncode == 0 and b"plebeian-friday-site.service" not in jobs.stdout, "SITE_JOB_QUEUED")
    return {"site": site, "fips": fips, "siteJobQueued": False}


def mapped(root: Path | None, absolute: str) -> Path:
    path = Path(absolute)
    require(path.is_absolute(), "PATH_NOT_ABSOLUTE:" + absolute)
    return path if root is None else root / path.relative_to("/")


def verify_source(source_root: Path, value: dict) -> Path:
    path = source_root / value["sourcePath"]
    raw, metadata = read_regular(path)
    require(len(raw) == value["bytes"], "SOURCE_BYTES:" + value["name"])
    require(digest(raw) == value["sha256"], "SOURCE_SHA256:" + value["name"])
    require(f"{stat.S_IMODE(metadata.st_mode):04o}" == value["sourceMode"], "SOURCE_MODE:" + value["name"])
    return path


def install(manifest: dict, source_root: Path, fixture_root: Path | None, systemctl: Path, systemd_analyze: Path) -> dict:
    production = fixture_root is None
    if production:
        require(os.geteuid() == 0, "ROOT_REQUIRED")
        require(manifest["status"] == "APPROVED_OWNER_INACTIVE_INSTALL", "INSTALL_NOT_APPROVED")
        require(manifest["authority"]["ownerInactiveInstallApproved"] is True, "OWNER_INSTALL_NOT_APPROVED")
    else:
        fixture_root = fixture_root.resolve()
        require(fixture_root != Path("/tmp") and Path("/tmp") in fixture_root.parents, "FIXTURE_ROOT_NOT_SCOPED")
        require(manifest["status"] == "DRAFT_NOT_AUTHORIZED", "FIXTURE_REQUIRES_DRAFT")

    require(manifest["schema"] == "PLEBEIAN_SIDEQUEST_SUCCESSOR_INSTALL_V1", "MANIFEST_SCHEMA")
    require(manifest["valueProfile"] == "FAKE_MONEY_ONLY", "VALUE_PROFILE")
    require(manifest["target"] == {"role": "APP", "ipv4": "139.162.161.233", "providerId": 109290386}, "TARGET")
    require(manifest["paths"] == EXPECTED_PATHS, "FIXED_PATHS")
    require([(value["name"], value["sourcePath"], value["destination"]) for value in manifest["artifacts"]] == [
        ("plebeian-auctions-mvp", "dist/sidequest/plebeian-auctions-mvp", "bin/plebeian-auctions-mvp"),
        ("plebeian-friday-authority", "dist/sidequest/plebeian-friday-authority", "bin/plebeian-friday-authority"),
        ("plebeian-friday-coordinator", "dist/sidequest/plebeian-friday-coordinator", "bin/plebeian-friday-coordinator"),
        ("plebeian-friday-terminal-executor", "dist/sidequest/plebeian-friday-terminal-executor", "bin/plebeian-friday-terminal-executor"),
        ("verify-sidequest-runtime.py", "deploy/sidequest-mvp/verify-successor-runtime.py", "bin/verify-sidequest-runtime.py"),
        ("verify-friday-separated-target.py", "deploy/sidequest-mvp/verify-sidequest-role-target.py", "bin/verify-friday-separated-target.py"),
        ("verify-friday-separated-base.py", "deploy/friday/separated/verify-friday-separated-target.py", "bin/verify-friday-separated-base.py"),
        ("verify-friday-runtime-target.py", "deploy/friday/verify-friday-runtime-target.py", "bin/verify-friday-runtime-target.py"),
    ], "ARTIFACT_SET")
    require((manifest["unit"]["name"], manifest["unit"]["sourcePath"]) == (
        "plebeian-friday-site.service", "deploy/sidequest-mvp/plebeian-friday-site-successor.service"
    ), "UNIT_SOURCE")
    require(manifest["authority"]["serviceActivationApproved"] is False, "ACTIVATION_MUST_BE_FALSE")
    require(manifest["authority"]["committeeMutationApproved"] is False, "COMMITTEE_MUTATION_MUST_BE_FALSE")
    require(manifest["noRetry"] is True and manifest["automaticCleanupOrRollback"] is False, "FAILURE_SEMANTICS")
    controller = Path(__file__).read_bytes()
    require(digest(controller) == manifest["controllerSha256"], "CONTROLLER_SHA256")

    sources = {value["name"]: verify_source(source_root, value) for value in manifest["artifacts"]}
    unit_value = manifest["unit"]
    unit_path = verify_source(source_root, unit_value)
    unit_raw = unit_path.read_bytes()

    paths = {key: mapped(fixture_root, value) for key, value in manifest["paths"].items()}
    owner = 0 if production else os.geteuid()
    release_parent = paths["releaseParent"]
    predecessor_root = paths["predecessorRoot"]
    final_root = paths["finalRoot"]
    incoming_root = paths["incomingRoot"]
    unit_parent = paths["unitPath"].parent
    receipt_parent = paths["receiptPath"].parent

    for key in ("finalRoot", "incomingRoot", "unitIncoming", "unitRetained", "journalPath", "receiptPath"):
        require(not paths[key].exists() and not paths[key].is_symlink(), "CONTROL_SLOT_OCCUPIED:" + key)
    directory(release_parent, 0o755, owner)
    directory(unit_parent, 0o755, owner)
    directory(receipt_parent, 0o700, owner)

    predecessor_unit = record(paths["unitPath"], manifest["paths"]["unitPath"], MAX_JSON)
    comparable_unit = dict(predecessor_unit)
    if not production:
        comparable_unit["uid"] = 0
        comparable_unit["gid"] = 0
    require(comparable_unit == manifest["expectedPredecessorUnit"], "PREDECESSOR_UNIT_DRIFT")
    predecessor_tree = tree_records(predecessor_root, production)
    require(predecessor_tree == manifest["expectedPredecessorReleaseRecords"], "PREDECESSOR_RELEASE_DRIFT")
    before_tree_digest = digest(canonical(predecessor_tree))
    require(before_tree_digest == manifest["expectedPredecessorReleaseTreeSha256"], "PREDECESSOR_TREE_SHA256")
    pre_state = verify_service_state(systemctl)

    journal_descriptor = os.open(paths["journalPath"], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    def journal(event: dict) -> None:
        raw = canonical(event)
        offset = 0
        while offset < len(raw):
            offset += os.write(journal_descriptor, raw[offset:])
        os.fsync(journal_descriptor)

    try:
        journal({"event": "PREFLIGHT_PASS", "timeNs": time.time_ns(), "site": pre_state, "predecessorTreeSha256": before_tree_digest})
        os.mkdir(incoming_root, 0o755)
        os.mkdir(incoming_root / "bin", 0o755)
        staged: dict[str, dict] = {}
        for value in manifest["artifacts"]:
            destination = incoming_root / value["destination"]
            staged[value["name"]] = copy_create(sources[value["name"]], destination, int(value["installMode"], 8), owner)
        fsync_directory(incoming_root / "bin")
        fsync_directory(incoming_root)
        fsync_directory(release_parent)
        journal({"event": "RELEASE_STAGED", "timeNs": time.time_ns(), "files": staged})

        write_create(paths["unitIncoming"], unit_raw, 0o644, owner)
        verification = run([str(systemd_analyze), "verify", str(paths["unitIncoming"])])
        require(verification.returncode == 0, "SYSTEMD_VERIFY_FAILED")
        journal({"event": "UNIT_VERIFIED", "timeNs": time.time_ns()})

        renameat2(incoming_root, final_root, RENAME_NOREPLACE)
        fsync_directory(release_parent)
        journal({"event": "RELEASE_PUBLISHED", "timeNs": time.time_ns(), "root": str(final_root)})

        current_unit = record(paths["unitPath"], manifest["paths"]["unitPath"], MAX_JSON)
        comparable_current = dict(current_unit)
        if not production:
            comparable_current["uid"] = 0
            comparable_current["gid"] = 0
        require(comparable_current == manifest["expectedPredecessorUnit"], "PREDECESSOR_UNIT_DRIFT_AT_COMMIT")
        renameat2(paths["unitIncoming"], paths["unitPath"], RENAME_EXCHANGE)
        renameat2(paths["unitIncoming"], paths["unitRetained"], RENAME_NOREPLACE)
        fsync_directory(unit_parent)
        journal({"event": "UNIT_PUBLISHED", "timeNs": time.time_ns(), "retained": str(paths["unitRetained"])})

        reload_result = run([str(systemctl), "daemon-reload"])
        require(reload_result.returncode == 0, "DAEMON_RELOAD_FAILED")
        post_state = verify_service_state(systemctl)
        require(tree_records(predecessor_root, production) == predecessor_tree, "PREDECESSOR_RELEASE_CHANGED")

        final_files: dict[str, dict] = {}
        for value in manifest["artifacts"]:
            path = final_root / value["destination"]
            actual = record(path, value["destination"])
            require(actual["bytes"] == value["bytes"] and actual["sha256"] == value["sha256"] and actual["mode"] == value["installMode"], "FINAL_ARTIFACT:" + value["name"])
            final_files[value["name"]] = actual
        result = {
            "schema": "PLEBEIAN_SIDEQUEST_SUCCESSOR_INSTALL_RESULT_V1",
            "status": "PASS_INSTALLED_INACTIVE_NOT_ACTIVATED",
            "manifestSha256": digest(canonical(manifest)),
            "releaseRoot": manifest["paths"]["finalRoot"],
            "files": final_files,
            "unit": record(paths["unitPath"], manifest["paths"]["unitPath"], MAX_JSON),
            "retainedPredecessorUnit": record(paths["unitRetained"], manifest["paths"]["unitRetained"], MAX_JSON),
            "site": post_state["site"],
            "fips": post_state["fips"],
            "serviceStartPerformed": False,
            "serviceEnablePerformed": False,
            "activationPerformed": False,
            "committeeMutationPerformed": False,
            "predecessorReleasePreserved": True,
        }
        write_create(paths["receiptPath"], canonical(result), 0o600, owner)
        fsync_directory(receipt_parent)
        journal({"event": "COMPLETE", "timeNs": time.time_ns(), "receiptSha256": digest(canonical(result))})
        return result
    finally:
        os.close(journal_descriptor)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--fixture-root", type=Path)
    parser.add_argument("--fixture-systemctl", type=Path)
    parser.add_argument("--fixture-systemd-analyze", type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    if args.fixture_root is None:
        require(args.fixture_systemctl is None and args.fixture_systemd_analyze is None, "FIXTURE_COMMAND_WITHOUT_FIXTURE")
        systemctl = Path("/usr/bin/systemctl")
        systemd_analyze = Path("/usr/bin/systemd-analyze")
    else:
        require(args.fixture_systemctl is not None and args.fixture_systemd_analyze is not None, "FIXTURE_COMMAND_REQUIRED")
        systemctl = args.fixture_systemctl
        systemd_analyze = args.fixture_systemd_analyze
    result = install(manifest, args.source_root.resolve(), args.fixture_root, systemctl, systemd_analyze)
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError, subprocess.TimeoutExpired, Stop) as error:
        print(json.dumps({"status": "STOPPED_NO_RETRY", "category": str(error)}, sort_keys=True, separators=(",", ":")))
        raise SystemExit(1)
