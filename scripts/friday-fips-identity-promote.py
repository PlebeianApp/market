#!/usr/bin/python3
"""Atomically promote one already-validated Friday FIPS identity directory.

This helper generates no key material and never reads key contents.  The only
successful mutation is a same-directory renameat2(RENAME_NOREPLACE), followed
by durability and inode checks.  A failure deliberately leaves the exclusive
operation lock and all private identity directories in place for inspection.
"""

from __future__ import annotations

import argparse
import ctypes
import errno
import hashlib
import os
import pwd
import re
import stat
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


FIPS_PARENT = Path("/var/lib/plebeian-auctions-friday/fips")
FINAL_NAME = "identity"
LOCK_PATH = Path("/run/lock/plebeian-auctions-friday/fips-identity-promotion.lock")
SERVICE_USER = "plebeian-friday"
STAGING_NAME = re.compile(r"^identity\.staging\.[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")
MAX_IDENTITY_FILE_BYTES = 64 * 1024
RENAME_NOREPLACE = 1


class PromotionRefusal(RuntimeError):
    """A fixed-vocabulary, secret-free refusal."""


class PromotionInterrupted(RuntimeError):
    """Test-only interruption injected at a named crash boundary."""


@dataclass(frozen=True)
class PromotionPolicy:
    fips_parent: Path
    final_name: str
    lock_path: Path
    root_uid: int
    root_gid: int
    service_uid: int
    service_gid: int
    require_root_process: bool = True


PhaseHook = Callable[[str], None]


def refuse(message: str) -> None:
    raise PromotionRefusal(message)


def _open_absolute_directory_no_symlinks(path: Path) -> int:
    if not path.is_absolute() or ".." in path.parts:
        refuse("directory path is not an absolute normalized path")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    descriptor = os.open("/", flags)
    try:
        for component in path.parts[1:]:
            if component in ("", ".", ".."):
                refuse("directory path contains a forbidden component")
            try:
                child = os.open(component, flags, dir_fd=descriptor)
            except OSError as error:
                if error.errno in (errno.ELOOP, errno.ENOTDIR):
                    refuse("directory path contains a symlink or non-directory")
                refuse("directory path could not be opened safely")
            os.close(descriptor)
            descriptor = child
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _open_root_controlled_directory_no_symlinks(path: Path) -> int:
    if not path.is_absolute() or ".." in path.parts:
        refuse("helper directory path is not an absolute normalized path")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    descriptor = os.open("/", flags)
    try:
        for component in path.parts[1:]:
            try:
                child = os.open(component, flags, dir_fd=descriptor)
            except OSError:
                refuse("helper directory path could not be opened safely")
            metadata = os.fstat(child)
            if metadata.st_uid != 0 or metadata.st_gid != 0 or stat.S_IMODE(metadata.st_mode) & 0o022:
                os.close(child)
                refuse("helper directory path is not root-controlled")
            os.close(descriptor)
            descriptor = child
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _require_directory(descriptor: int, uid: int, gid: int, mode: int, label: str) -> os.stat_result:
    metadata = os.fstat(descriptor)
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != uid or metadata.st_gid != gid \
            or stat.S_IMODE(metadata.st_mode) != mode:
        refuse(f"{label} ownership, mode, or type differs")
    return metadata


def _entry_metadata(directory: int, name: str) -> os.stat_result | None:
    try:
        return os.stat(name, dir_fd=directory, follow_symlinks=False)
    except FileNotFoundError:
        return None
    except OSError:
        refuse("directory entry could not be inspected safely")


def _open_identity_file(directory: int, name: str, uid: int, gid: int, private: bool) -> int:
    try:
        descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
    except OSError as error:
        if error.errno in (errno.ELOOP, errno.ENOTDIR):
            refuse("identity file is a symlink or non-file")
        refuse("identity file could not be opened safely")
    try:
        metadata = os.fstat(descriptor)
        mode = stat.S_IMODE(metadata.st_mode)
        forbidden_public_mode = mode & (stat.S_ISUID | stat.S_ISGID | stat.S_ISVTX | 0o133)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != uid or metadata.st_gid != gid \
                or metadata.st_nlink != 1 or metadata.st_size < 1 \
                or metadata.st_size > MAX_IDENTITY_FILE_BYTES:
            refuse("identity file ownership, link count, type, or size differs")
        if private and mode != 0o600:
            refuse("private identity file mode differs from 0600")
        if not private and ((mode & 0o400) == 0 or forbidden_public_mode != 0):
            refuse("public identity file mode is unsafe")
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _rename_noreplace(directory: int, source: str, destination: str) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        refuse("renameat2 is unavailable")
    renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    renameat2.restype = ctypes.c_int
    ctypes.set_errno(0)
    result = renameat2(directory, os.fsencode(source), directory, os.fsencode(destination), RENAME_NOREPLACE)
    if result == 0:
        return
    failure = ctypes.get_errno()
    if failure == errno.EEXIST:
        refuse("final identity appeared; source and destination were preserved")
    if failure == errno.EXDEV:
        refuse("identity promotion crossed a filesystem")
    if failure in (errno.ENOSYS, errno.EINVAL, errno.EOPNOTSUPP):
        refuse("atomic no-replace rename is unsupported")
    refuse("atomic no-replace identity promotion failed")


def _reserve_lock(policy: PromotionPolicy) -> tuple[int, int, tuple[int, int]]:
    lock_parent = policy.lock_path.parent
    lock_parent_descriptor = _open_absolute_directory_no_symlinks(lock_parent)
    try:
        _require_directory(lock_parent_descriptor, policy.root_uid, policy.root_gid, 0o700, "lock directory")
        if policy.lock_path.name != "fips-identity-promotion.lock":
            refuse("operation lock name differs")
        try:
            lock_descriptor = os.open(
                policy.lock_path.name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                0o600,
                dir_fd=lock_parent_descriptor,
            )
        except FileExistsError:
            refuse("FIPS identity promotion lock already exists")
        except OSError:
            refuse("FIPS identity promotion lock could not be reserved")
        try:
            os.fchmod(lock_descriptor, 0o600)
            os.fchown(lock_descriptor, policy.root_uid, policy.root_gid)
            metadata = os.fstat(lock_descriptor)
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != policy.root_uid \
                    or metadata.st_gid != policy.root_gid or stat.S_IMODE(metadata.st_mode) != 0o600 \
                    or metadata.st_nlink != 1 or metadata.st_size != 0:
                refuse("reserved operation lock identity differs")
            os.fsync(lock_descriptor)
            os.fsync(lock_parent_descriptor)
            return lock_parent_descriptor, lock_descriptor, (metadata.st_dev, metadata.st_ino)
        except BaseException:
            os.close(lock_descriptor)
            raise
    except BaseException:
        os.close(lock_parent_descriptor)
        raise


def _release_success_lock(
        policy: PromotionPolicy, lock_parent: int, lock_descriptor: int,
        lock_identity: tuple[int, int]) -> None:
    path_metadata = _entry_metadata(lock_parent, policy.lock_path.name)
    descriptor_metadata = os.fstat(lock_descriptor)
    if path_metadata is None or (path_metadata.st_dev, path_metadata.st_ino) != lock_identity \
            or (descriptor_metadata.st_dev, descriptor_metadata.st_ino) != lock_identity \
            or not stat.S_ISREG(path_metadata.st_mode) or path_metadata.st_uid != policy.root_uid \
            or path_metadata.st_gid != policy.root_gid or stat.S_IMODE(path_metadata.st_mode) != 0o600 \
            or path_metadata.st_size != 0:
        refuse("operation lock changed before successful release")
    try:
        os.unlink(policy.lock_path.name, dir_fd=lock_parent)
        os.fsync(lock_parent)
    except OSError:
        refuse("completed operation lock could not be released")


def promote_identity(
        staging_path: Path, policy: PromotionPolicy, phase_hook: PhaseHook | None = None) -> tuple[int, int]:
    """Promote the staging directory or raise without deleting private state."""
    if policy.require_root_process and os.geteuid() != 0:
        refuse("identity promotion requires root")
    if policy.final_name != FINAL_NAME:
        refuse("final identity name differs")
    if not staging_path.is_absolute() or staging_path.parent != policy.fips_parent \
            or not STAGING_NAME.fullmatch(staging_path.name):
        refuse("staging path is not a direct run-specific identity child")

    hook = phase_hook if phase_hook is not None else lambda _phase: None
    lock_parent = lock_descriptor = parent = staging = key = public = final = final_key = final_public = -1
    lock_identity: tuple[int, int] | None = None
    try:
        lock_parent, lock_descriptor, lock_identity = _reserve_lock(policy)
        hook("lock_reserved")
        parent = _open_absolute_directory_no_symlinks(policy.fips_parent)
        parent_metadata = _require_directory(
            parent, policy.service_uid, policy.service_gid, 0o700, "FIPS parent directory",
        )
        if _entry_metadata(parent, policy.final_name) is not None:
            refuse("final FIPS identity already exists")
        try:
            staging = os.open(
                staging_path.name,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=parent,
            )
        except OSError as error:
            if error.errno in (errno.ELOOP, errno.ENOTDIR):
                refuse("staging identity is a symlink or non-directory")
            refuse("staging identity could not be opened safely")
        staging_metadata = _require_directory(
            staging, policy.service_uid, policy.service_gid, 0o700, "staging identity directory",
        )
        if staging_metadata.st_dev != parent_metadata.st_dev:
            refuse("staging identity is not on the final filesystem")
        try:
            entries = set(os.listdir(staging))
        except OSError:
            refuse("staging identity entries could not be enumerated")
        if entries != {"fips.key", "fips.pub"}:
            refuse("staging identity has missing or unexpected entries")
        key = _open_identity_file(staging, "fips.key", policy.service_uid, policy.service_gid, True)
        public = _open_identity_file(staging, "fips.pub", policy.service_uid, policy.service_gid, False)
        key_metadata = os.fstat(key)
        public_metadata = os.fstat(public)
        os.fsync(key)
        os.fsync(public)
        os.fsync(staging)
        hook("staging_fsynced")

        current_source = _entry_metadata(parent, staging_path.name)
        if current_source is None or (current_source.st_dev, current_source.st_ino) != \
                (staging_metadata.st_dev, staging_metadata.st_ino):
            refuse("staging identity changed before promotion")
        hook("before_rename")
        _rename_noreplace(parent, staging_path.name, policy.final_name)
        hook("after_rename")

        try:
            final = os.open(
                policy.final_name,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=parent,
            )
        except OSError:
            refuse("promoted identity could not be opened safely")
        final_metadata = os.fstat(final)
        if not stat.S_ISDIR(final_metadata.st_mode) or (final_metadata.st_dev, final_metadata.st_ino) != \
                (staging_metadata.st_dev, staging_metadata.st_ino):
            refuse("promoted identity inode differs from validated staging")
        if _entry_metadata(parent, staging_path.name) is not None:
            refuse("staging name remained after promotion")
        try:
            final_entries = set(os.listdir(final))
        except OSError:
            refuse("promoted identity entries could not be enumerated")
        if final_entries != {"fips.key", "fips.pub"}:
            refuse("promoted identity has missing or unexpected entries")
        final_key = _open_identity_file(final, "fips.key", policy.service_uid, policy.service_gid, True)
        final_public = _open_identity_file(final, "fips.pub", policy.service_uid, policy.service_gid, False)
        if (os.fstat(final_key).st_dev, os.fstat(final_key).st_ino) != (key_metadata.st_dev, key_metadata.st_ino) \
                or (os.fstat(final_public).st_dev, os.fstat(final_public).st_ino) != \
                (public_metadata.st_dev, public_metadata.st_ino):
            refuse("promoted identity file inode differs from validated staging")
        os.fsync(final_key)
        os.fsync(final_public)
        os.fsync(final)
        os.fsync(parent)
        hook("promotion_fsynced")
        _release_success_lock(policy, lock_parent, lock_descriptor, lock_identity)
        return final_metadata.st_dev, final_metadata.st_ino
    except OSError:
        refuse("identity promotion filesystem operation failed")
    finally:
        for descriptor in (
                final_public, final_key, final, public, key, staging, parent, lock_descriptor, lock_parent):
            if descriptor >= 0:
                os.close(descriptor)
        # No failure cleanup belongs here.  The lock and every private identity
        # directory are intentionally preserved unless success was durable.


def _sha256_descriptor(descriptor: int) -> str:
    digest = hashlib.sha256()
    os.lseek(descriptor, 0, os.SEEK_SET)
    while True:
        chunk = os.read(descriptor, 1024 * 1024)
        if not chunk:
            return digest.hexdigest()
        digest.update(chunk)


def _verify_helper_source(expected_sha256: str) -> None:
    if not HEX_SHA256.fullmatch(expected_sha256):
        refuse("expected helper SHA-256 is malformed")
    source = Path(__file__).absolute()
    if source.name != "friday-fips-identity-promote.py":
        refuse("promotion helper source name differs")
    parent = _open_root_controlled_directory_no_symlinks(source.parent)
    descriptor = -1
    try:
        try:
            descriptor = os.open(source.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        except OSError:
            refuse("promotion helper source could not be opened safely")
        metadata = os.fstat(descriptor)
        mode = stat.S_IMODE(metadata.st_mode)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_gid != 0 \
                or metadata.st_nlink != 1 or metadata.st_size < 1 or metadata.st_size > 128 * 1024 \
                or mode & (stat.S_ISUID | stat.S_ISGID | stat.S_ISVTX | 0o022):
            refuse("promotion helper source ownership or mode is unsafe")
        if _sha256_descriptor(descriptor) != expected_sha256:
            refuse("promotion helper source differs from reviewed bytes")
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        os.close(parent)


def main() -> int:
    parser = argparse.ArgumentParser(description="Promote one validated Friday FIPS identity without replacement")
    parser.add_argument("--staging", required=True, type=Path)
    parser.add_argument("--expected-helper-sha256", required=True)
    arguments = parser.parse_args()
    try:
        _verify_helper_source(arguments.expected_helper_sha256)
        account = pwd.getpwnam(SERVICE_USER)
        policy = PromotionPolicy(
            fips_parent=FIPS_PARENT,
            final_name=FINAL_NAME,
            lock_path=LOCK_PATH,
            root_uid=0,
            root_gid=0,
            service_uid=account.pw_uid,
            service_gid=account.pw_gid,
        )
        promote_identity(arguments.staging, policy)
    except KeyError:
        print("FIPS identity promotion refused: service account is unavailable", file=sys.stderr)
        return 1
    except PromotionRefusal as error:
        print(f"FIPS identity promotion refused: {error}", file=sys.stderr)
        return 1
    print("FIPS identity promotion complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
