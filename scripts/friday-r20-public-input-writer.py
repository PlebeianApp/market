#!/usr/bin/python3
"""Create the fixed public R20 DKG inputs as the service account.

This helper is inert until separately installed and invoked by a reviewed
deployment action.  It accepts no caller-selected path.  Its stdin is public
manifest material, but is still bounded and independently pinned by a SHA-256
argument.  Root must not run it: the intended writer is plebeian-friday after
the service-owned 0700 parent and host enrollment already exist.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from typing import Any


SCHEMA = "PLEBEIAN_FRIDAY_R20_PUBLIC_DKG_INPUT_BUNDLE_V1"
PRE_ENROLLMENT_SCHEMA = "PLEBEIAN_FRIDAY_R20_PRE_ENROLLMENT_PUBLIC_INPUT_BUNDLE_V1"
BOUND_SCHEMA = "PLEBEIAN_FRIDAY_R20_BOUND_DKG_MANIFEST_V1"
STATE_ROOT = Path("/var/lib/plebeian-auctions-friday")
FRESH_PARENT_NAME = "frost-v2"
INPUT_ROOT_NAME = "r20-inputs"
KEYSET_ROOT_NAME = "keyset-v2"
MANIFEST_NAME = "manifest.json"
MANIFEST_DIGEST_NAME = "owner-approved-manifest-digest.txt"
BOUND_MANIFEST_NAME = "bound-manifest.json"
HOST_PIN_NAME = "owner-approved-host-enrollment-pin-v2.json"
FRESH_PROFILE_NAME = "fresh-profile.json"
PREDECESSOR_MANIFEST_NAME = "predecessor-manifest.json"
MAX_STDIN = 1024 * 1024
MAX_MANIFEST = 512 * 1024
MAX_BOUND_MANIFEST = 768 * 1024
HEX_32 = re.compile(r"^[0-9a-f]{64}$")
O_CLOEXEC = getattr(os, "O_CLOEXEC", 0)
O_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)


class ProvisioningError(RuntimeError):
    pass


def exact_object(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise ProvisioningError(f"{label} has missing or unexpected fields")
    return value


def encode_json(value: Any, maximum: int, label: str) -> bytes:
    encoded = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    if len(encoded) < 3 or len(encoded) > maximum:
        raise ProvisioningError(f"{label} size differs")
    return encoded


def parse_bundle(raw: bytes, expected_stdin_sha256: str) -> tuple[bytes, bytes, bytes]:
    if not HEX_32.fullmatch(expected_stdin_sha256):
        raise ProvisioningError("expected stdin SHA-256 is not canonical")
    if len(raw) < 3 or len(raw) > MAX_STDIN:
        raise ProvisioningError("public stdin size differs")
    if hashlib.sha256(raw).hexdigest() != expected_stdin_sha256:
        raise ProvisioningError("public stdin differs from the independent expected hash")
    try:
        decoded = raw.decode("utf-8", "strict")
        value = json.loads(decoded)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ProvisioningError("public stdin is malformed") from error
    bundle = exact_object(value, {"schema", "manifest", "manifestDigest", "boundManifest"}, "bundle")
    if bundle["schema"] != SCHEMA or not isinstance(bundle["manifest"], dict):
        raise ProvisioningError("bundle schema or manifest differs")
    manifest_digest = bundle["manifestDigest"]
    if not isinstance(manifest_digest, str) or not HEX_32.fullmatch(manifest_digest):
        raise ProvisioningError("manifest digest is not canonical")
    bound = exact_object(bundle["boundManifest"], {
        "schema", "profileDigest", "predecessorAbortDigest", "manifest",
        "manifestDigest", "bindingDigest",
    }, "bound manifest")
    if bound["schema"] != BOUND_SCHEMA or bound["manifest"] != bundle["manifest"] \
            or bound["manifestDigest"] != manifest_digest:
        raise ProvisioningError("bound manifest differs from the manifest and digest")
    for key in ("profileDigest", "predecessorAbortDigest", "bindingDigest"):
        if not isinstance(bound[key], str) or not HEX_32.fullmatch(bound[key]):
            raise ProvisioningError(f"bound manifest {key} is not canonical")
    return (
        encode_json(bundle["manifest"], MAX_MANIFEST, "manifest"),
        (manifest_digest + "\n").encode("ascii"),
        encode_json(bound, MAX_BOUND_MANIFEST, "bound manifest"),
    )


def parse_pre_enrollment_bundle(raw: bytes, expected_stdin_sha256: str) -> tuple[bytes, bytes, bytes]:
    if not HEX_32.fullmatch(expected_stdin_sha256):
        raise ProvisioningError("expected stdin SHA-256 is not canonical")
    if len(raw) < 3 or len(raw) > MAX_STDIN or hashlib.sha256(raw).hexdigest() != expected_stdin_sha256:
        raise ProvisioningError("pre-enrollment public stdin differs from its bound")
    try:
        value = json.loads(raw.decode("utf-8", "strict"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ProvisioningError("pre-enrollment public stdin is malformed") from error
    bundle = exact_object(value, {"schema", "hostPin", "freshProfile", "predecessorManifest"},
                          "pre-enrollment bundle")
    if bundle["schema"] != PRE_ENROLLMENT_SCHEMA:
        raise ProvisioningError("pre-enrollment bundle schema differs")
    for key in ("hostPin", "freshProfile", "predecessorManifest"):
        if not isinstance(bundle[key], dict):
            raise ProvisioningError(f"pre-enrollment {key} is not an object")
    return (
        encode_json(bundle["hostPin"], MAX_MANIFEST, "host pin"),
        encode_json(bundle["freshProfile"], MAX_MANIFEST, "fresh profile"),
        encode_json(bundle["predecessorManifest"], MAX_MANIFEST, "predecessor manifest"),
    )


def verify_directory(fd: int, uid: int, gid: int, mode: int, label: str) -> os.stat_result:
    value = os.fstat(fd)
    if not stat.S_ISDIR(value.st_mode) or value.st_uid != uid or value.st_gid != gid \
            or stat.S_IMODE(value.st_mode) != mode or value.st_nlink < 2:
        raise ProvisioningError(f"{label} metadata differs")
    return value


def open_directory_at(parent_fd: int, name: str, uid: int, gid: int, mode: int, label: str) -> int:
    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC, dir_fd=parent_fd)
    try:
        verify_directory(fd, uid, gid, mode, label)
        named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        opened = os.fstat(fd)
        if (named.st_dev, named.st_ino) != (opened.st_dev, opened.st_ino):
            raise ProvisioningError(f"{label} changed while opened")
        return fd
    except Exception:
        os.close(fd)
        raise


def write_new_at(directory_fd: int, name: str, value: bytes, uid: int, gid: int) -> None:
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | O_NOFOLLOW | O_CLOEXEC,
                 0o600, dir_fd=directory_fd)
    try:
        view = memoryview(value)
        while view:
            count = os.write(fd, view)
            if count < 1:
                raise ProvisioningError("public input write made no progress")
            view = view[count:]
        os.fsync(fd)
        written = os.fstat(fd)
        if not stat.S_ISREG(written.st_mode) or written.st_nlink != 1 \
                or written.st_uid != uid or written.st_gid != gid \
                or stat.S_IMODE(written.st_mode) != 0o600 or written.st_size != len(value):
            raise ProvisioningError("created public input metadata differs")
    finally:
        os.close(fd)


def provision(raw: bytes, expected_stdin_sha256: str, *, state_root: Path = STATE_ROOT,
              state_root_uid: int = 0) -> None:
    uid = os.geteuid()
    if uid == 0:
        raise ProvisioningError("root must not write inside the service-owned R20 directories")
    gid = os.getegid()
    manifest, manifest_digest, bound_manifest = parse_bundle(raw, expected_stdin_sha256)
    root_fd = os.open(state_root, os.O_RDONLY | os.O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    fresh_fd = input_fd = keyset_fd = -1
    try:
        root_meta = os.fstat(root_fd)
        if not stat.S_ISDIR(root_meta.st_mode) or root_meta.st_uid != state_root_uid \
                or stat.S_IMODE(root_meta.st_mode) & 0o022:
            raise ProvisioningError("state root metadata differs")
        fresh_fd = open_directory_at(root_fd, FRESH_PARENT_NAME, uid, gid, 0o700, "fresh parent")
        input_fd = open_directory_at(fresh_fd, INPUT_ROOT_NAME, uid, gid, 0o700, "public input root")
        keyset_fd = open_directory_at(fresh_fd, KEYSET_ROOT_NAME, uid, gid, 0o700, "fresh keyset root")

        # The digest pin is the commit marker and is created last.  Any
        # interruption leaves an incomplete, fail-closed create-once set.
        write_new_at(keyset_fd, MANIFEST_NAME, manifest, uid, gid)
        write_new_at(input_fd, BOUND_MANIFEST_NAME, bound_manifest, uid, gid)
        os.fsync(keyset_fd); os.fsync(input_fd); os.fsync(fresh_fd)
        write_new_at(keyset_fd, MANIFEST_DIGEST_NAME, manifest_digest, uid, gid)
        os.fsync(keyset_fd); os.fsync(fresh_fd); os.fsync(root_fd)

        # Revalidate every directory name after the writes.  The opened file
        # descriptors, not caller-controlled absolute paths, selected targets.
        for parent_fd, name, opened_fd, label in (
            (root_fd, FRESH_PARENT_NAME, fresh_fd, "fresh parent"),
            (fresh_fd, INPUT_ROOT_NAME, input_fd, "public input root"),
            (fresh_fd, KEYSET_ROOT_NAME, keyset_fd, "fresh keyset root"),
        ):
            named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            opened = os.fstat(opened_fd)
            if (named.st_dev, named.st_ino) != (opened.st_dev, opened.st_ino):
                raise ProvisioningError(f"{label} changed during provisioning")
    finally:
        for fd in (keyset_fd, input_fd, fresh_fd, root_fd):
            if fd >= 0:
                os.close(fd)


def provision_pre_enrollment(raw: bytes, expected_stdin_sha256: str, *,
                             state_root: Path = STATE_ROOT,
                             state_root_uid: int = 0) -> None:
    uid = os.geteuid()
    if uid == 0:
        raise ProvisioningError("root must not write inside the service-owned R20 directories")
    gid = os.getegid()
    host_pin, fresh_profile, predecessor_manifest = parse_pre_enrollment_bundle(
        raw, expected_stdin_sha256)
    root_fd = os.open(state_root, os.O_RDONLY | os.O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    fresh_fd = input_fd = -1
    try:
        root_meta = os.fstat(root_fd)
        if not stat.S_ISDIR(root_meta.st_mode) or root_meta.st_uid != state_root_uid \
                or stat.S_IMODE(root_meta.st_mode) & 0o022:
            raise ProvisioningError("state root metadata differs")
        fresh_fd = open_directory_at(root_fd, FRESH_PARENT_NAME, uid, gid, 0o700, "fresh parent")
        input_fd = open_directory_at(fresh_fd, INPUT_ROOT_NAME, uid, gid, 0o700, "public input root")
        write_new_at(input_fd, FRESH_PROFILE_NAME, fresh_profile, uid, gid)
        write_new_at(input_fd, PREDECESSOR_MANIFEST_NAME, predecessor_manifest, uid, gid)
        os.fsync(input_fd); os.fsync(fresh_fd)
        write_new_at(fresh_fd, HOST_PIN_NAME, host_pin, uid, gid)
        os.fsync(fresh_fd); os.fsync(root_fd)
        for parent_fd, name, opened_fd, label in (
            (root_fd, FRESH_PARENT_NAME, fresh_fd, "fresh parent"),
            (fresh_fd, INPUT_ROOT_NAME, input_fd, "public input root"),
        ):
            named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            opened = os.fstat(opened_fd)
            if (named.st_dev, named.st_ino) != (opened.st_dev, opened.st_ino):
                raise ProvisioningError(f"{label} changed during provisioning")
    finally:
        for fd in (input_fd, fresh_fd, root_fd):
            if fd >= 0:
                os.close(fd)


def main() -> int:
    if len(sys.argv) != 4 or sys.argv[1] not in {"pre-enrollment", "post-enrollment"} \
            or sys.argv[2] != "--expected-stdin-sha256" or not HEX_32.fullmatch(sys.argv[3]):
        raise ProvisioningError(
            "usage: writer pre-enrollment|post-enrollment --expected-stdin-sha256 HEX")
    raw = sys.stdin.buffer.read(MAX_STDIN + 1)
    if len(raw) > MAX_STDIN or sys.stdin.buffer.read(1):
        raise ProvisioningError("public stdin exceeded the fixed bound")
    if sys.argv[1] == "pre-enrollment":
        provision_pre_enrollment(raw, sys.argv[3])
    else:
        provision(raw, sys.argv[3])
    print("FRIDAY_R20_PUBLIC_INPUT_WRITER|PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ProvisioningError):
        print("FRIDAY_R20_PUBLIC_INPUT_WRITER|STOPPED", file=sys.stderr)
        raise SystemExit(1)
