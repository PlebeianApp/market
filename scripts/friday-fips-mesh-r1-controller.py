#!/usr/bin/python3
"""Argument-safe local controller primitives for Friday FIPS mesh R1.

No remote shell source is assembled dynamically. The reviewed literal script
is delivered on stdin to `/bin/bash -s --`; every varying value is a distinct
argv element. This module deliberately exposes bounded phases rather than an
automatic retry loop.
"""

from __future__ import annotations

import argparse
import hashlib
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
REMOTE_SCRIPT = ROOT / "scripts/friday-fips-mesh-r1-remote.sh"
SSH_BIN = "/usr/bin/ssh"
SCP_BIN = "/usr/bin/scp"
SSH_AUTH_SOCK = "/tmp/plebeian-poc-owner-agent.sock"
KNOWN_HOSTS = "/home/maximoto/.ssh/known_hosts"

HOSTS = {
    1: {
        "ip": "172.105.64.142",
        "config": "v1-fips.yaml",
        "manifest": "v1-fips-mesh-r1.sha256",
        "create_parent": "yes",
        "wednesday_pid": "91863",
    },
    2: {
        "ip": "172.105.95.57",
        "config": "v2-fips.yaml",
        "manifest": "v2-fips-mesh-r1.sha256",
        "create_parent": "no",
        "wednesday_pid": "65966",
    },
    3: {
        "ip": "172.104.240.217",
        "config": "v3-fips.yaml",
        "manifest": "v3-fips-mesh-r1.sha256",
        "create_parent": "yes",
        "wednesday_pid": "65081",
    },
    4: {
        "ip": "172.104.253.247",
        "config": "v4-fips.yaml",
        "manifest": "v4-fips-mesh-r1.sha256",
        "create_parent": "yes",
        "wednesday_pid": "66255",
    },
}

SSH_OPTIONS = [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", f"UserKnownHostsFile={KNOWN_HOSTS}",
    "-o", "ConnectTimeout=10",
    "-o", "ForwardAgent=no",
    "-o", "ClearAllForwardings=yes",
    "-o", "RequestTTY=no",
    "-o", "SendEnv=-*",
]


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _remote_argv(slot: int, phase: str, target_npub: str = "") -> list[str]:
    host = HOSTS[slot]
    return [
        SSH_BIN,
        *SSH_OPTIONS,
        f"root@{host['ip']}",
        "/bin/bash", "-s", "--",
        phase,
        str(slot),
        host["config"],
        host["manifest"],
        host["create_parent"],
        host["wednesday_pid"],
        target_npub,
    ]


def run_remote(slot: int, phase: str, target_npub: str = "") -> subprocess.CompletedProcess[bytes]:
    if slot not in HOSTS:
        raise ValueError("slot must be 1..4")
    allowed = {"prepare", "install", "prestart", "start", "inspect", "probe", "stop", "postcheck"}
    if phase not in allowed:
        raise ValueError("unsupported phase")
    return subprocess.run(
        _remote_argv(slot, phase, target_npub),
        input=REMOTE_SCRIPT.read_bytes(),
        env={"SSH_AUTH_SOCK": SSH_AUTH_SOCK, "PATH": "/usr/bin:/bin"},
        check=True,
    )


def transfer_public_packet(slot: int) -> subprocess.CompletedProcess[bytes]:
    host = HOSTS[slot]
    mesh = ROOT / "deploy/friday/fips-mesh-r1"
    stage = f"/tmp/plebeian-friday-fips-mesh-r1-stage-v{slot}/"
    argv = [
        SCP_BIN,
        "-q",
        *SSH_OPTIONS,
        str(ROOT / "deploy/friday/plebeian-friday.slice"),
        str(mesh / "plebeian-friday-fips-mesh-r1.service"),
        str(ROOT / "deploy/friday/verify-friday-fips-identity.py"),
        str(mesh / host["config"]),
        str(mesh / host["manifest"]),
        f"root@{host['ip']}:{stage}",
    ]
    return subprocess.run(
        argv,
        env={"SSH_AUTH_SOCK": SSH_AUTH_SOCK, "PATH": "/usr/bin:/bin"},
        check=True,
    )


def assert_local_packet() -> None:
    expected = {
        ROOT / "deploy/friday/plebeian-friday.slice": "704133a7c0572d1bf8e2f73fc328773813605993170e9031f5c20af4d94018d6",
        ROOT / "deploy/friday/fips-mesh-r1/plebeian-friday-fips-mesh-r1.service": "15f18917bfe35e4d5b772e8eb591a96718a95990b73550f515c2ec3b938d1051",
        ROOT / "deploy/friday/verify-friday-fips-identity.py": "5753d4c95aa55ec91ecb1ac0be0b4729f65808cee59f59431fb9d5f327295808",
    }
    for path, digest in expected.items():
        if _sha256(path) != digest:
            raise RuntimeError(f"local packet hash mismatch: {path}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["prepare", "transfer", "install", "prestart", "start", "inspect", "probe", "stop", "postcheck"])
    parser.add_argument("slot", type=int, choices=HOSTS)
    parser.add_argument("--target-npub", default="")
    args = parser.parse_args()
    assert_local_packet()
    if args.phase == "transfer":
        transfer_public_packet(args.slot)
    else:
        run_remote(args.slot, args.phase, args.target_npub)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
