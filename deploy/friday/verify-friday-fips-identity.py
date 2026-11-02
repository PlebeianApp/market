#!/usr/bin/python3
"""Fail closed unless FIPS will load the pre-provisioned Friday identity.

jmcorgan/fips derives ``fips.key`` from the directory containing the exact
``-c`` configuration file.  In persistent mode it generates a new key when
that file is absent.  The Friday service must never take that generation path:
the four operators provision their own identities in a separately approved
ceremony, and this preflight proves the exact existing file before startup.

The verifier reads metadata only.  It never opens or prints the private key.
"""

from __future__ import annotations

import argparse
import os
import stat
from pathlib import Path


def _regular_nosymlink(path: Path, label: str) -> os.stat_result:
    try:
        metadata = path.lstat()
    except FileNotFoundError as exc:
        raise ValueError(f"{label} is absent") from exc
    if not stat.S_ISREG(metadata.st_mode) or path.is_symlink():
        raise ValueError(f"{label} is not a regular non-symlink file")
    return metadata


def verify(config: Path, key: Path) -> None:
    if not config.is_absolute() or not key.is_absolute():
        raise ValueError("config and key paths must be absolute")
    if key.name != "fips.key" or key.parent != config.parent:
        raise ValueError("FIPS key must be config-adjacent fips.key")

    directory = config.parent
    try:
        directory_metadata = directory.lstat()
    except FileNotFoundError as exc:
        raise ValueError("FIPS identity directory is absent") from exc
    if not stat.S_ISDIR(directory_metadata.st_mode) or directory.is_symlink():
        raise ValueError("FIPS identity directory is not a non-symlink directory")
    if directory_metadata.st_uid != os.geteuid() or directory_metadata.st_gid != os.getegid():
        raise ValueError("FIPS identity directory is not owned by the service identity")
    if stat.S_IMODE(directory_metadata.st_mode) != 0o700:
        raise ValueError("FIPS identity directory mode is not 0700")

    config_metadata = _regular_nosymlink(config, "FIPS config")
    key_metadata = _regular_nosymlink(key, "FIPS private key")
    for label, metadata in (("FIPS config", config_metadata), ("FIPS private key", key_metadata)):
        if metadata.st_uid != os.geteuid() or metadata.st_gid != os.getegid():
            raise ValueError(f"{label} is not owned by the service identity")
        if stat.S_IMODE(metadata.st_mode) != 0o600:
            raise ValueError(f"{label} mode is not 0600")
    if key_metadata.st_size < 1 or key_metadata.st_size > 256:
        raise ValueError("FIPS private key size is outside the reviewed bound")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--key", required=True, type=Path)
    args = parser.parse_args()
    try:
        verify(args.config, args.key)
    except ValueError as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
