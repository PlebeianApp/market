#!/usr/bin/python3
"""Create-once promotion of an already reviewed Friday R18 staging set.

This helper deliberately cannot stage, download, clean, retry, or run a DKG
command.  Its production profile contains only the four fixed validators'
shared local paths and the receipt-pinned artifact hashes.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
import stat
import sys
from typing import Final


ORIGINAL_ACTION_SHA256: Final = (
    "d48e1592ed9e8753e05d4edf66be0309f9cd26cd3ebd3c7784bf4214a0a7a29a"
)
HEX_32: Final = frozenset("0123456789abcdef")


class Refusal(RuntimeError):
    pass


@dataclass(frozen=True)
class Artifact:
    staged_name: str
    destination_name: str
    sha256: str
    size: int
    destination_uid: int
    destination_gid: int
    destination_mode: int


@dataclass(frozen=True)
class Profile:
    slot: int
    action_root: str
    binary_root: str
    keyset_root: str
    root_uid: int
    root_gid: int
    service_uid: int
    service_gid: int
    artifacts: tuple[Artifact, ...]
    retained_inspector: Artifact | None


COMMON_ARTIFACTS: Final = (
    Artifact(
        "plebeian-friday-dkg-host",
        "plebeian-friday-dkg-host",
        "f7b3923f4829acc7a837dc5fa54fe6f332003797dd560e9920bb58ab501baa4c",
        98_653_257,
        0,
        0,
        0o755,
    ),
    Artifact(
        "coco-demo-frost-participant-3of4",
        "coco-demo-frost-participant",
        "ed2014392707a00387570a56708e32dc7f7a50e3ab3acb11fb58672d75c7e578",
        2_381_144,
        0,
        0,
        0o755,
    ),
    Artifact(
        "manifest.json",
        "manifest.json",
        "3c165d655a5a3332fe750a812e499b49c354456c230f175884c19e7e0b1a2985",
        4_086,
        997,
        986,
        0o600,
    ),
    Artifact(
        "owner-approved-manifest-digest.txt",
        "owner-approved-manifest-digest.txt",
        "ba27aae87f25ca1d24482c845c60d9647ff4a36939ad84849f92786ca361c57c",
        65,
        997,
        986,
        0o600,
    ),
)
INSPECTOR: Final = Artifact(
    "coco-demo-frost-public-inspect",
    "coco-demo-frost-public-inspect",
    "ee880c7f376a8d8b2ba6b1dde6388f64b0de36c0857371f656ebabe055d18b0f",
    724_232,
    0,
    0,
    0o755,
)


def production_profile(slot: int) -> Profile:
    if slot not in (1, 2, 3, 4):
        raise Refusal("slot must be one of the fixed four validators")
    artifacts = COMMON_ARTIFACTS if slot == 2 else (*COMMON_ARTIFACTS, INSPECTOR)
    return Profile(
        slot=slot,
        action_root="/var/lib/plebeian-auctions-friday-operator/dkg-ceremony-r18",
        binary_root="/opt/plebeian-auctions-friday/bin",
        keyset_root="/var/lib/plebeian-auctions-friday/frost/keyset-v1",
        root_uid=0,
        root_gid=0,
        service_uid=997,
        service_gid=986,
        artifacts=artifacts,
        retained_inspector=INSPECTOR if slot == 2 else None,
    )


def _mode(metadata: os.stat_result) -> int:
    return stat.S_IMODE(metadata.st_mode)


def _exact_directory(path: str, uid: int, gid: int, mode: int) -> os.stat_result:
    metadata = os.lstat(path)
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid != uid
        or metadata.st_gid != gid
        or _mode(metadata) != mode
    ):
        raise Refusal(f"directory metadata rejected: {path}")
    if os.path.realpath(path) != path:
        raise Refusal(f"directory path is not canonical: {path}")
    return metadata


def _protected_root_chain(path: str, uid: int) -> None:
    current = os.path.dirname(path)
    while True:
        metadata = os.lstat(current)
        if (
            not stat.S_ISDIR(metadata.st_mode)
            or stat.S_ISLNK(metadata.st_mode)
            or metadata.st_uid != uid
            or _mode(metadata) & 0o022
            or os.path.realpath(current) != current
        ):
            raise Refusal(f"parent chain rejected: {current}")
        if current == "/":
            return
        current = os.path.dirname(current)


def _open_verified(path: str, artifact: Artifact, uid: int, gid: int, mode: int) -> int:
    metadata = os.lstat(path)
    if (
        not stat.S_ISREG(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid != uid
        or metadata.st_gid != gid
        or metadata.st_nlink != 1
        or _mode(metadata) != mode
        or metadata.st_size != artifact.size
        or os.path.realpath(path) != path
    ):
        raise Refusal(f"file metadata rejected: {path}")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    before = os.fstat(descriptor)
    digest = hashlib.sha256()
    while True:
        chunk = os.read(descriptor, 1024 * 1024)
        if not chunk:
            break
        digest.update(chunk)
    after = os.fstat(descriptor)
    if (
        (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
        != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
        or digest.hexdigest() != artifact.sha256
    ):
        os.close(descriptor)
        raise Refusal(f"file identity or hash rejected: {path}")
    os.lseek(descriptor, 0, os.SEEK_SET)
    return descriptor


def _sync_directory(path: str) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _create_json(path: str, value: object, uid: int, gid: int) -> None:
    encoded = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.fchown(descriptor, uid, gid)
        os.fchmod(descriptor, 0o600)
        view = memoryview(encoded)
        while view:
            written = os.write(descriptor, view)
            view = view[written:]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    _sync_directory(os.path.dirname(path))


def _destination(profile: Profile, artifact: Artifact) -> str:
    if artifact.staged_name in ("manifest.json", "owner-approved-manifest-digest.txt"):
        return os.path.join(profile.keyset_root, artifact.destination_name)
    return os.path.join(profile.binary_root, artifact.destination_name)


def _validate_pre_effects(profile: Profile) -> dict[str, int]:
    _exact_directory(profile.action_root, profile.root_uid, profile.root_gid, 0o700)
    _exact_directory(profile.keyset_root, profile.service_uid, profile.service_gid, 0o700)
    binary_parent = os.path.dirname(profile.binary_root)
    _exact_directory(binary_parent, profile.root_uid, profile.root_gid, 0o755)
    _protected_root_chain(profile.binary_root, profile.root_uid)

    expected_entries = {artifact.staged_name for artifact in profile.artifacts}
    actual_entries = set(os.listdir(profile.action_root))
    if actual_entries != expected_entries:
        raise Refusal("staging root contains a missing, added, or prior-attempt entry")

    descriptors: dict[str, int] = {}
    try:
        for artifact in profile.artifacts:
            descriptors[artifact.staged_name] = _open_verified(
                os.path.join(profile.action_root, artifact.staged_name),
                artifact,
                profile.root_uid,
                profile.root_gid,
                0o755 if artifact.destination_mode == 0o755 else 0o644,
            )
            if os.path.lexists(_destination(profile, artifact)):
                raise Refusal(f"final destination is not absent: {_destination(profile, artifact)}")

        if profile.retained_inspector is not None:
            _exact_directory(profile.binary_root, profile.root_uid, profile.root_gid, 0o755)
            retained_path = _destination(profile, profile.retained_inspector)
            retained = _open_verified(
                retained_path,
                profile.retained_inspector,
                profile.root_uid,
                profile.root_gid,
                0o755,
            )
            os.close(retained)
        elif os.path.lexists(profile.binary_root):
            raise Refusal("new bin directory is not absent")
        return descriptors
    except BaseException:
        for descriptor in descriptors.values():
            os.close(descriptor)
        raise


def _copy_create_once(profile: Profile, artifact: Artifact, source: int) -> dict[str, object]:
    destination = _destination(profile, artifact)
    destination_uid = profile.service_uid if artifact.destination_uid == 997 else profile.root_uid
    destination_gid = profile.service_gid if artifact.destination_gid == 986 else profile.root_gid
    descriptor = os.open(
        destination,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        artifact.destination_mode,
    )
    try:
        os.fchown(descriptor, destination_uid, destination_gid)
        os.fchmod(descriptor, artifact.destination_mode)
        os.lseek(source, 0, os.SEEK_SET)
        while True:
            chunk = os.read(source, 1024 * 1024)
            if not chunk:
                break
            view = memoryview(chunk)
            while view:
                written = os.write(descriptor, view)
                view = view[written:]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    _sync_directory(os.path.dirname(destination))

    verified = _open_verified(
        destination,
        artifact,
        destination_uid,
        destination_gid,
        artifact.destination_mode,
    )
    try:
        metadata = os.fstat(verified)
        return {
            "path": destination,
            "sha256": artifact.sha256,
            "size": artifact.size,
            "dev": metadata.st_dev,
            "ino": metadata.st_ino,
        }
    finally:
        os.close(verified)


def promote(
    profile: Profile,
    approved_amendment_sha256: str,
    approved_helper_sha256: str,
) -> dict[str, object]:
    if len(approved_amendment_sha256) != 64 or any(char not in HEX_32 for char in approved_amendment_sha256):
        raise Refusal("approved amendment SHA-256 is invalid")
    if len(approved_helper_sha256) != 64 or any(char not in HEX_32 for char in approved_helper_sha256):
        raise Refusal("approved helper SHA-256 is invalid")
    descriptors = _validate_pre_effects(profile)
    with open("/proc/sys/kernel/random/boot_id", encoding="ascii") as boot_file:
        boot_id = boot_file.read().strip()
    claim = {
        "schema": "PLEBEIAN_FRIDAY_R18_PROMOTION_AMENDMENT_CLAIM_V1",
        "slot": profile.slot,
        "bootId": boot_id,
        "originalActionSha256": ORIGINAL_ACTION_SHA256,
        "approvedAmendmentSha256": approved_amendment_sha256,
        "approvedHelperSha256": approved_helper_sha256,
        "manifestDigest": "5c91cffa47f0cc90412472b7401b42f02a3416c68a70099357c2cf4cd6f87a87",
        "stagedSha256": {artifact.staged_name: artifact.sha256 for artifact in profile.artifacts},
    }
    try:
        _create_json(
            os.path.join(profile.action_root, "promotion-amendment-r1.claim.json"),
            claim,
            profile.root_uid,
            profile.root_gid,
        )
        if profile.retained_inspector is None:
            os.mkdir(profile.binary_root, 0o755)
            os.chown(profile.binary_root, profile.root_uid, profile.root_gid)
            os.chmod(profile.binary_root, 0o755)
            _exact_directory(profile.binary_root, profile.root_uid, profile.root_gid, 0o755)
            _sync_directory(profile.binary_root)
            _sync_directory(os.path.dirname(profile.binary_root))

        installed = []
        for artifact in profile.artifacts:
            installed.append(_copy_create_once(profile, artifact, descriptors[artifact.staged_name]))
        if profile.retained_inspector is not None:
            installed.append(
                {
                    "path": _destination(profile, profile.retained_inspector),
                    "sha256": profile.retained_inspector.sha256,
                    "size": profile.retained_inspector.size,
                    "retained": True,
                }
            )
        complete = {
            "schema": "PLEBEIAN_FRIDAY_R18_PROMOTION_AMENDMENT_COMPLETE_V1",
            "slot": profile.slot,
            "bootId": claim["bootId"],
            "originalActionSha256": ORIGINAL_ACTION_SHA256,
            "approvedAmendmentSha256": approved_amendment_sha256,
            "approvedHelperSha256": approved_helper_sha256,
            "installed": sorted(installed, key=lambda item: str(item["path"])),
        }
        _create_json(
            os.path.join(profile.action_root, "promotion-amendment-r1.complete.json"),
            complete,
            profile.root_uid,
            profile.root_gid,
        )
        return complete
    finally:
        for descriptor in descriptors.values():
            os.close(descriptor)


def main(argv: list[str]) -> int:
    if (
        len(argv) != 5
        or argv[1] != "--slot"
        or argv[3].split("=", 1)[0] != "--approved-amendment-sha256"
        or "=" not in argv[3]
        or argv[4].split("=", 1)[0] != "--approved-helper-sha256"
        or "=" not in argv[4]
    ):
        print(
            "usage: friday-r18-staged-promote.py --slot 1..4 "
            "--approved-amendment-sha256=HEX --approved-helper-sha256=HEX",
            file=sys.stderr,
        )
        return 2
    if os.geteuid() != 0:
        print("Friday R18 staged promotion requires root", file=sys.stderr)
        return 1
    try:
        result = promote(
            production_profile(int(argv[2])),
            argv[3].split("=", 1)[1],
            argv[4].split("=", 1)[1],
        )
    except (OSError, Refusal, ValueError):
        print("Friday R18 staged promotion refused; preserve state and inspect", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
