#!/usr/bin/python3
"""Fail-closed exec wrapper for the isolated FIPS lab's fake Nutshell mint.

The controller supplies one fresh 0600 seed and a SHA-pinned Nutshell CLI.
This wrapper validates only fixed lab paths/topology, creates private database
directories, clears the inherited environment, and replaces itself with the
mint process. It never prints or copies the seed.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
from pathlib import Path


SCHEMA = "PLEBEIAN_FRIDAY_FIPS_LAB_APPLICATION_V2"
ROOT_PREFIX = "/tmp/plebeian-friday-fips-lab."
HEX_SEED = re.compile(r"^[0-9a-f]{64}$")
ULA = re.compile(r"^(?:fc|fd)[0-9a-f:]+$", re.IGNORECASE)


def canonical_lab_path(value: str, label: str) -> Path:
    path = Path(value)
    if not value.startswith(ROOT_PREFIX) or not path.is_absolute() or path.resolve() != path:
        raise SystemExit(f"mint bootstrap refused: {label} is outside the canonical lab root")
    return path


def exact_config(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    expected = {
        "schema", "run_id", "fips_ulas", "comet_p2p_port", "comet_rpc_port",
        "signer_rpc_port", "mint_port", "network_root", "dkg_root", "driver_result",
    }
    if not isinstance(value, dict) or set(value) != expected or value.get("schema") != SCHEMA:
        raise SystemExit("mint bootstrap refused: application config shape is not reviewed V2")
    ulas = value.get("fips_ulas")
    if not isinstance(ulas, list) or len(ulas) != 4 or len(set(ulas)) != 4 \
            or any(not isinstance(item, str) or ULA.fullmatch(item) is None for item in ulas):
        raise SystemExit("mint bootstrap refused: FIPS ULA roster is malformed")
    if value.get("mint_port") != 3338 or value.get("signer_rpc_port") != 39101 \
            or value.get("comet_p2p_port") != 26656 or value.get("comet_rpc_port") != 26657:
        raise SystemExit("mint bootstrap refused: application ports differ from the reviewed lab")
    for field in ("network_root", "dkg_root", "driver_result"):
        canonical_lab_path(str(value[field]), field)
    return value


def main() -> None:
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("--config", required=True)
    parser.add_argument("--seed-file", required=True)
    parser.add_argument("--python-executable", required=True)
    parser.add_argument("--site-packages", required=True)
    args = parser.parse_args()
    if os.getuid() != 1000 or os.getgid() != 1000:
        raise SystemExit("mint bootstrap refused: process did not drop to uid/gid 1000")
    config_path = canonical_lab_path(args.config, "config")
    seed_path = canonical_lab_path(args.seed_file, "seed file")
    python_path = Path(args.python_executable)
    site_packages = Path(args.site_packages)
    if not python_path.is_absolute() or python_path.is_symlink() or not python_path.is_file() \
            or not os.access(python_path, os.X_OK):
        raise SystemExit("mint bootstrap refused: Python is not the pinned regular executable")
    if not site_packages.is_absolute() or site_packages.is_symlink() or not site_packages.is_dir():
        raise SystemExit("mint bootstrap refused: site-packages is not the pinned directory")
    seed_stat = seed_path.stat()
    if not stat.S_ISREG(seed_stat.st_mode) or stat.S_IMODE(seed_stat.st_mode) != 0o600 \
            or seed_stat.st_uid != 1000 or seed_stat.st_gid != 1000:
        raise SystemExit("mint bootstrap refused: seed is not an owned 0600 regular file")
    seed = seed_path.read_text(encoding="ascii").strip()
    if HEX_SEED.fullmatch(seed) is None:
        raise SystemExit("mint bootstrap refused: seed encoding is malformed")
    config = exact_config(config_path)
    run_root = canonical_lab_path(str(config["dkg_root"]), "dkg root").parent
    mint_root = run_root / "node-1" / "mint"
    auth_root = run_root / "node-1" / "mint-auth"
    mint_root.mkdir(mode=0o700)
    auth_root.mkdir(mode=0o700)
    ula = str(config["fips_ulas"][0])  # type: ignore[index]
    environment = {
        "HOME": str(run_root / "node-1"),
        "LOGNAME": "maximoto",
        "PATH": "/usr/bin:/bin",
        "USER": "maximoto",
        "MINT_PRIVATE_KEY": seed,
        "MINT_BACKEND_BOLT11_SAT": "FakeWallet",
        "MINT_DATABASE": str(mint_root),
        "MINT_AUTH_DATABASE": str(auth_root),
        "MINT_INPUT_FEE_PPK": "0",
        "MINT_INFO_NAME": "Plebeian Friday FIPS Throwaway Mint",
    }
    # -I/-S exclude user/site initialization and every .pth file; -B prevents
    # mutation of the reviewed dependency tree. The sole import root is the
    # controller-hashed site-packages directory.
    launcher = "import runpy,sys;sys.path.insert(0,sys.argv.pop(1));runpy.run_module('cashu.mint',run_name='__main__')"
    os.execve(str(python_path), [
        str(python_path), "-I", "-S", "-B", "-c", launcher, str(site_packages),
        "--host", ula, "--port", "3338",
    ], environment)


if __name__ == "__main__":
    main()
