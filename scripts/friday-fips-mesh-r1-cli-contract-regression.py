#!/usr/bin/python3
"""Check every mesh command-line option against the pinned executables."""

from __future__ import annotations

import hashlib
import shlex
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
FIPS = ROOT / "live-bin-friday-candidate-r13/fips"
FIPSCTL = ROOT / "live-bin-friday-candidate-r13/fipsctl"
UNIT = ROOT / "deploy/friday/fips-mesh-r1/plebeian-friday-fips-mesh-r1.service"
REMOTE = ROOT / "scripts/friday-fips-mesh-r1-remote.sh"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def help_text(argv: list[str]) -> str:
    result = subprocess.run(argv, check=True, text=True, capture_output=True)
    return result.stdout + result.stderr


def main() -> int:
    assert sha256(FIPS) == "7b26e81e2607483d46b716a330c88ee18c881e3adaefc0542909e6f2a9a287f2"
    assert sha256(FIPSCTL) == "15df75d3d9942747c62f690b0f4f5d5a2f9df45c976a96f4799a9574b988fab3"

    fips_help = help_text([str(FIPS), "--help"])
    assert "-c, --config <FILE>" in fips_help
    assert "--log-file" not in fips_help

    unit_lines = UNIT.read_text(encoding="utf-8").splitlines()
    exec_start = next(line.removeprefix("ExecStart=") for line in unit_lines if line.startswith("ExecStart="))
    assert shlex.split(exec_start) == [
        "/opt/plebeian-auctions-friday/releases/fips-identity-20261023-r1/bin/fips",
        "-c",
        "/var/lib/plebeian-auctions-friday/fips/identity/fips.yaml",
    ]
    assert "--log-file" not in UNIT.read_text(encoding="utf-8")

    cli_help = help_text([str(FIPSCTL), "--help"])
    assert "-s, --socket <SOCKET>" in cli_help
    cases = [
        (["show", "status", "--help"], "Node status overview"),
        (["show", "peers", "--help"], "Authenticated peers"),
        (["show", "links", "--help"], "Active links"),
        (["show", "transports", "--help"], "Transport instances"),
        (["show", "routing", "--help"], "Routing table summary"),
        (["acl", "show", "--help"], "Loaded peer ACL state"),
    ]
    for suffix, expected in cases:
        assert expected in help_text([str(FIPSCTL), *suffix])
    probe_help = help_text([str(FIPSCTL), "probe", "--help"])
    assert "--json" in probe_help
    assert "--timeout <TIMEOUT>" in probe_help

    sha_help = help_text(["/usr/bin/sha256sum", "--help"])
    assert "-c, --check" in sha_help
    assert "--strict" in sha_help
    subprocess.run(
        ["/usr/bin/python3", "-I", "-S", "-B", "-c", "pass"],
        check=True,
    )

    remote = REMOTE.read_text(encoding="utf-8")
    assert "--log-file" not in remote
    for fragment in (
        'show status', 'show peers', 'show links', 'show transports',
        'show routing', 'acl show', 'probe --json --timeout 10',
        '/usr/bin/sha256sum --strict --check',
        '/usr/bin/python3 -I -S -B',
    ):
        assert fragment in remote

    print("Friday FIPS mesh CLI contract: PASS (daemon, preflights, inspection, probes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
