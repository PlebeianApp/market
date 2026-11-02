#!/usr/bin/python3
"""One-run controller for the isolated Friday FIPS integration lab.

This file is intentionally inert until the adjacent execution manifest is
frozen with every application binary/source SHA-256 and approval_ready=true.
It does not accept caller-supplied commands, namespace names, addresses, ports,
paths, identities, environment variables, or cleanup targets.

The only approved future invocation shape is documented in
FIPS-LOCAL-LAB-APPROVAL-MANIFEST.md and includes the reviewed hashes of this
file and the manifest.  The controller must run as root only so it can create
the five network namespaces.  Every daemon/test process is privilege-dropped;
FIPS receives only CAP_NET_ADMIN and the capture helper only CAP_NET_RAW inside
its dedicated network namespace.  No host executable receives a file cap.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


REPO = Path("/home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc")
MANIFEST_PATH = REPO / "FIPS-LOCAL-LAB-EXECUTION.json"
SELF_PATH = REPO / "scripts/friday-fips-lab.py"
CAPTURE_PATH = REPO / "scripts/friday-fips-capture.py"
RUN_ID = "friday-fips-lab-20261022-r1"
RUN_ROOT = Path("/tmp/plebeian-friday-fips-lab.20261022-r1")
MARKER_PATH = RUN_ROOT / ".plebeian-friday-fips-lab-owned"
EVIDENCE_PATH = REPO / "evidence/friday-fips-lab-20261022-r1.json"
FAILURE_EVIDENCE_PATH = REPO / "evidence/friday-fips-lab-20261022-r1-failure.json"

UID = 1000
GID = 1000
USER = "maximoto"
SWITCH_NAMESPACE = "poc-friday-fips-sw"
NODE_NAMESPACES = tuple(f"poc-friday-fips-n{index}" for index in range(1, 5))
ALL_NAMESPACES = (SWITCH_NAMESPACE, *NODE_NAMESPACES)
UNDERLAY_ADDRESSES = tuple(f"198.18.242.{index}" for index in range(1, 5))
UNDERLAY_CIDR_ADDRESSES = tuple(f"{address}/29" for address in UNDERLAY_ADDRESSES)
HOST_TEMP_LINKS = tuple(f"pff{index}" for index in range(1, 5))
SWITCH_LINKS = tuple(f"sw{index}" for index in range(1, 5))
UDP_PORT = 32121
COMET_P2P_PORT = 26656
COMET_RPC_PORT = 26657
SIGNER_RPC_PORT = 39101
CAP_NET_ADMIN_HEX = "0000000000001000"
CAP_NET_RAW_HEX = "0000000000002000"
NO_CAPS_HEX = "0000000000000000"
HEX_32 = re.compile(r"^[0-9a-f]{64}$")
ULA = re.compile(r"^(?:fc|fd)[0-9a-f:]+$")

PYTHON = "/usr/bin/python3.12"
FIPS = "/usr/bin/fips"
FIPSCTL = "/usr/bin/fipsctl"
IP = "/usr/bin/ip"
NFT = "/usr/sbin/nft"
SETPRIV = "/usr/bin/setpriv"
PRLIMIT = "/usr/bin/prlimit"
SS = "/usr/bin/ss"
ENV = "/usr/bin/env"

VALIDATOR = str(REPO / "lab-bin/plebeian-auctions-poc")
DKG = str(REPO / "lab-bin/plebeian-friday-frost-dkg")
SIGNER = str(REPO / "lab-bin/plebeian-friday-signer")
DRIVER = str(REPO / "lab-bin/plebeian-friday-integrated-driver")
FROST_PARTICIPANT = str(REPO / "lab-bin/coco-demo-frost-participant-3of4")
FROST_INSPECTOR = str(REPO / "lab-bin/coco-demo-frost-public-inspect")


class LabRefusal(RuntimeError):
    pass


@dataclass(frozen=True)
class OwnedProcess:
    role: str
    node: int
    process: subprocess.Popen[bytes]
    start_ticks: int
    namespace_inode: int
    executable: str
    expected_cap_eff: str


def refuse(message: str) -> None:
    raise LabRefusal(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def exact_object(value: Any, keys: set[str], field: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        refuse(f"{field} has missing or unexpected fields")
    return value


def load_manifest(expected_manifest_hash: str, expected_self_hash: str) -> dict[str, Any]:
    if not HEX_32.fullmatch(expected_manifest_hash) or not HEX_32.fullmatch(expected_self_hash):
        refuse("reviewed SHA-256 arguments are malformed")
    if MANIFEST_PATH.is_symlink() or SELF_PATH.is_symlink() or CAPTURE_PATH.is_symlink():
        refuse("reviewed source paths must not be symlinks")
    if sha256_file(MANIFEST_PATH) != expected_manifest_hash:
        refuse("execution manifest differs from the owner-reviewed bytes")
    if sha256_file(SELF_PATH) != expected_self_hash:
        refuse("lab controller differs from the owner-reviewed bytes")
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    exact_object(manifest, {
        "schema", "approval_ready", "reason_not_ready", "run_id", "run_root", "host", "limits",
        "fixed_network", "binary_pins", "source_pins", "public_test_markers_hex",
        "evidence_path", "failure_evidence_path",
    }, "manifest")
    if manifest["schema"] != "PLEBEIAN_FRIDAY_FIPS_LAB_EXECUTION_V1":
        refuse("execution manifest schema is not approved")
    if manifest["approval_ready"] is not True:
        refuse(f"execution manifest is deliberately inert: {manifest['reason_not_ready']}")
    if manifest["run_id"] != RUN_ID or manifest["run_root"] != str(RUN_ROOT):
        refuse("run identity/root differs from the single approved run")
    if manifest["evidence_path"] != str(EVIDENCE_PATH) or manifest["failure_evidence_path"] != str(FAILURE_EVIDENCE_PATH):
        refuse("evidence destinations differ from the single approved run")
    host = exact_object(manifest["host"], {"hostname", "kernel_release", "uid", "gid", "user"}, "host")
    if host != {"hostname": socket.gethostname(), "kernel_release": os.uname().release, "uid": UID, "gid": GID, "user": USER}:
        refuse("host identity does not match the reviewed host")
    limits = exact_object(manifest["limits"], {
        "wall_seconds", "startup_seconds", "shutdown_seconds", "max_log_bytes_per_process",
    }, "limits")
    if limits != {"wall_seconds": 3600, "startup_seconds": 45, "shutdown_seconds": 15, "max_log_bytes_per_process": 10_485_760}:
        refuse("runtime limits differ from the reviewed bounds")
    network = exact_object(manifest["fixed_network"], {
        "namespaces", "underlay_cidr", "underlay_addresses", "udp_port", "comet_p2p_port",
        "comet_rpc_port", "signer_rpc_port", "external_egress", "host_routes",
        "host_firewall_changes", "host_file_capabilities",
    }, "fixed_network")
    if network != {
        "namespaces": list(ALL_NAMESPACES), "underlay_cidr": "198.18.242.0/29",
        "underlay_addresses": list(UNDERLAY_CIDR_ADDRESSES), "udp_port": UDP_PORT,
        "comet_p2p_port": COMET_P2P_PORT, "comet_rpc_port": COMET_RPC_PORT,
        "signer_rpc_port": SIGNER_RPC_PORT, "external_egress": False,
        "host_routes": False, "host_firewall_changes": False, "host_file_capabilities": False,
    }:
        refuse("fixed network differs from the reviewed isolated topology")
    source_pins = exact_object(manifest["source_pins"], {
        str(SELF_PATH), str(CAPTURE_PATH), "reviewed_integration_commit",
    }, "source_pins")
    if source_pins[str(SELF_PATH)] != expected_self_hash:
        refuse("manifest controller pin differs from the invocation pin")
    capture_hash = source_pins[str(CAPTURE_PATH)]
    if not isinstance(capture_hash, str) or not HEX_32.fullmatch(capture_hash) or sha256_file(CAPTURE_PATH) != capture_hash:
        refuse("capture helper lacks an exact reviewed source pin")
    if source_pins["reviewed_integration_commit"] != "b9f3d48c8cd09393d8a130e793f1707bc02fded9":
        refuse("reviewed integration snapshot pin changed")
    markers = exact_object(manifest["public_test_markers_hex"], {"comet", "signer"}, "public markers")
    if markers != {
        "comet": "504c45424549414e2d4652494441592d434f4d45542d5452414e53504f52542d5631",
        "signer": "504c45424549414e2d4652494441592d5349474e45522d5452414e53504f52542d5631",
    }:
        refuse("public packet markers changed")
    verify_binary_pins(manifest["binary_pins"])
    return manifest


def verify_binary_pins(value: Any) -> None:
    expected_paths = {
        PYTHON, FIPS, FIPSCTL, IP, NFT, SETPRIV, PRLIMIT, SS, ENV,
        VALIDATOR, DKG, SIGNER, DRIVER, FROST_PARTICIPANT, FROST_INSPECTOR,
    }
    pins = exact_object(value, expected_paths, "binary_pins")
    for path_text in sorted(expected_paths):
        pin = pins[path_text]
        if not isinstance(pin, str) or not HEX_32.fullmatch(pin):
            refuse(f"binary has no reviewed SHA-256 pin: {path_text}")
        path = Path(path_text)
        if not path.is_file() or path.is_symlink() or not os.access(path, os.X_OK):
            refuse(f"reviewed binary is absent, non-executable, or a symlink: {path_text}")
        if sha256_file(path) != pin:
            refuse(f"binary differs from reviewed bytes: {path_text}")


def run(argv: list[str], *, check: bool = True, capture: bool = True, timeout: float = 20) -> subprocess.CompletedProcess[bytes]:
    if not argv or not argv[0].startswith("/"):
        refuse("all controller child executables must use absolute paths")
    return subprocess.run(
        argv, check=check, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
        stderr=subprocess.PIPE, timeout=timeout, env={}, close_fds=True,
    )


def dropped_argv(
    executable: str,
    arguments: list[str],
    *,
    namespace: str | None = None,
    capability: str | None = None,
    node_root: Path | None = None,
) -> list[str]:
    if namespace is not None and namespace not in NODE_NAMESPACES:
        refuse("privilege drop requested for a non-node namespace")
    root = node_root or RUN_ROOT
    environment = [
        ENV, "-i", f"HOME={root}", f"LOGNAME={USER}", "PATH=/usr/bin:/bin",
        f"USER={USER}", f"XDG_RUNTIME_DIR={root / 'runtime'}", "RUST_LOG=info",
    ]
    caps = "-all" if capability is None else f"-all,+{capability}"
    privilege = [
        SETPRIV, f"--reuid={UID}", f"--regid={GID}", "--clear-groups",
        f"--inh-caps={caps}", f"--ambient-caps={caps}", f"--bounding-set={caps}",
        "--no-new-privs", "--pdeathsig=TERM", "--", PRLIMIT,
        "--fsize=10485760:10485760", "--nofile=256:256", "--nproc=128:128", "--",
        executable, *arguments,
    ]
    if namespace is None:
        return [*environment, *privilege]
    return [IP, "netns", "exec", namespace, *environment, *privilege]


def process_status(pid: int) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in Path(f"/proc/{pid}/status").read_text(encoding="utf-8").splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            fields[key] = value.strip()
    return fields


def process_start_ticks(pid: int) -> int:
    # comm can contain spaces/parentheses, so split after the final ') '.
    text = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8")
    return int(text[text.rfind(") ") + 2:].split()[19])


def namespace_inode(pid: int) -> int:
    return os.stat(f"/proc/{pid}/ns/net").st_ino


def verify_owned_process(process: OwnedProcess) -> None:
    pid = process.process.pid
    if process.process.poll() is not None or process_start_ticks(pid) != process.start_ticks:
        refuse(f"{process.role} node {process.node} exited or PID identity changed")
    status = process_status(pid)
    uid_values = status.get("Uid", "").split()
    gid_values = status.get("Gid", "").split()
    if uid_values != [str(UID)] * 4 or gid_values != [str(GID)] * 4:
        refuse(f"{process.role} node {process.node} did not drop to the approved uid/gid")
    if status.get("NoNewPrivs") != "1" or status.get("CapEff", "").lower().zfill(16) != process.expected_cap_eff:
        refuse(f"{process.role} node {process.node} has unexpected privileges")
    if namespace_inode(pid) != process.namespace_inode:
        refuse(f"{process.role} node {process.node} left its approved network namespace")
    executable = Path(os.readlink(f"/proc/{pid}/exe"))
    if sha256_file(executable) != sha256_file(Path(process.executable)):
        refuse(f"{process.role} node {process.node} executable identity changed")


def start_owned(
    role: str,
    node: int,
    executable: str,
    arguments: list[str],
    *,
    capability: str | None = None,
) -> OwnedProcess:
    node_root = RUN_ROOT / f"node-{node}"
    log_path = node_root / f"{role}.log"
    log_descriptor = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        child = subprocess.Popen(
            dropped_argv(executable, arguments, namespace=NODE_NAMESPACES[node - 1], capability=capability, node_root=node_root),
            stdin=subprocess.DEVNULL, stdout=log_descriptor, stderr=subprocess.STDOUT,
            env={}, close_fds=True, start_new_session=True,
        )
    finally:
        os.close(log_descriptor)
    deadline = time.monotonic() + 5
    expected_executable_hash = sha256_file(Path(executable))
    while time.monotonic() < deadline:
        if child.poll() is not None:
            refuse(f"{role} node {node} exited during privilege drop")
        try:
            current_executable = Path(os.readlink(f"/proc/{child.pid}/exe"))
            if sha256_file(current_executable) == expected_executable_hash:
                break
        except (FileNotFoundError, PermissionError):
            pass
        time.sleep(0.05)
    else:
        refuse(f"{role} node {node} never reached the reviewed executable")
    cap = NO_CAPS_HEX
    if capability == "net_admin":
        cap = CAP_NET_ADMIN_HEX
    elif capability == "net_raw":
        cap = CAP_NET_RAW_HEX
    owned = OwnedProcess(
        role=role, node=node, process=child, start_ticks=process_start_ticks(child.pid),
        namespace_inode=namespace_inode(child.pid), executable=executable, expected_cap_eff=cap,
    )
    verify_owned_process(owned)
    return owned


def stop_owned(process: OwnedProcess, timeout: float) -> None:
    if process.process.poll() is not None:
        process.process.wait(timeout=1)
        return
    try:
        if process_start_ticks(process.process.pid) != process.start_ticks:
            refuse(f"refusing to signal reused PID {process.process.pid}")
    except FileNotFoundError:
        process.process.wait(timeout=1)
        return
    os.killpg(process.process.pid, signal.SIGTERM)
    try:
        process.process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        if process_start_ticks(process.process.pid) != process.start_ticks:
            refuse(f"refusing forced termination of reused PID {process.process.pid}")
        os.killpg(process.process.pid, signal.SIGKILL)
        process.process.wait(timeout=5)


def host_ruleset_hash() -> str:
    result = run([NFT, "list", "ruleset"], timeout=15)
    return hashlib.sha256(result.stdout).hexdigest()


def namespace_names() -> set[str]:
    result = run([IP, "netns", "list"])
    return {line.split()[0] for line in result.stdout.decode().splitlines() if line.strip()}


def preflight() -> str:
    if os.geteuid() != 0 or os.getegid() != 0:
        refuse("controller requires a single reviewed root invocation")
    if RUN_ROOT.exists() or RUN_ROOT.is_symlink():
        refuse("single approved run root already exists; inspect it instead of retrying")
    if EVIDENCE_PATH.exists() or FAILURE_EVIDENCE_PATH.exists():
        refuse("single-run evidence destination already exists")
    conflicts = namespace_names().intersection(ALL_NAMESPACES)
    if conflicts:
        refuse(f"approved namespace names already exist: {sorted(conflicts)}")
    links = run([IP, "-o", "link", "show"]).stdout.decode()
    for name in (*HOST_TEMP_LINKS, *SWITCH_LINKS, "br0", "under0", "fips0"):
        if re.search(rf"\b{re.escape(name)}(?:@|:)", links):
            refuse(f"host link name conflicts with the isolated lab: {name}")
    listeners = run([SS, "-H", "-ltnup"]).stdout.decode()
    for port in (UDP_PORT, COMET_P2P_PORT, COMET_RPC_PORT, SIGNER_RPC_PORT, 3338, 3339):
        if re.search(rf":{port}\b", listeners):
            refuse(f"host namespace already has a listener on reviewed lab port {port}")
    return host_ruleset_hash()


def new_run_root() -> None:
    RUN_ROOT.mkdir(mode=0o700)
    os.chown(RUN_ROOT, UID, GID)
    descriptor = os.open(MARKER_PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.write(descriptor, (RUN_ID + "\n").encode())
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.chown(MARKER_PATH, UID, GID)
    for node in range(1, 5):
        node_root = RUN_ROOT / f"node-{node}"
        node_root.mkdir(mode=0o700)
        (node_root / "runtime").mkdir(mode=0o700)
        os.chown(node_root, UID, GID)
        os.chown(node_root / "runtime", UID, GID)


def keygen_and_addresses(manifest: dict[str, Any]) -> list[str]:
    addresses: list[str] = []
    for node in range(1, 5):
        node_root = RUN_ROOT / f"node-{node}"
        run(dropped_argv(FIPSCTL, ["keygen", "-d", str(node_root)], node_root=node_root), timeout=20)
        key_path = node_root / "fips.key"
        public_path = node_root / "fips.pub"
        if stat.S_IMODE(key_path.stat().st_mode) != 0o600 or key_path.stat().st_uid != UID:
            refuse(f"node {node} FIPS secret permissions are not 0600/uid {UID}")
        if stat.S_IMODE(public_path.stat().st_mode) != 0o644 or public_path.stat().st_uid != UID:
            refuse(f"node {node} FIPS public key permissions are not 0644/uid {UID}")
        output = run(dropped_argv(FIPSCTL, ["address", "-k", str(public_path)], node_root=node_root)).stdout.decode().strip().lower()
        if not ULA.fullmatch(output):
            refuse(f"node {node} did not derive an exact FIPS ULA")
        addresses.append(output)
    if len(set(addresses)) != 4:
        refuse("fresh FIPS identities did not produce four distinct ULAs")
    render_fips_configs(addresses)
    render_namespace_filters(addresses)
    render_application_config(addresses, manifest)
    return addresses


def write_owned(path: Path, content: str, mode: int) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        os.write(descriptor, content.encode())
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.chown(path, UID, GID)


def render_fips_configs(ulas: list[str]) -> None:
    npubs = [(RUN_ROOT / f"node-{node}" / "fips.pub").read_text(encoding="utf-8").strip() for node in range(1, 5)]
    for node in range(1, 5):
        peers: list[str] = []
        for peer in range(1, 5):
            if peer == node:
                continue
            peers.extend([
                f"  - npub: \"{npubs[peer - 1]}\"",
                f"    alias: \"lab-node-{peer}\"",
                "    addresses:",
                "      - transport: udp",
                f"        addr: \"{UNDERLAY_ADDRESSES[peer - 1]}:{UDP_PORT}\"",
                "    connect_policy: auto_connect",
            ])
        node_root = RUN_ROOT / f"node-{node}"
        content = "\n".join([
            "node:",
            "  identity:",
            "    persistent: true",
            "  control:",
            f"    socket_path: \"{node_root / 'runtime/control.sock'}\"",
            "  rendezvous:",
            "    nostr:",
            "      enabled: false",
            "    lan:",
            "      enabled: false",
            "tun:",
            "  enabled: true",
            "  name: fips0",
            "  mtu: 1280",
            "dns:",
            "  enabled: false",
            "transports:",
            "  udp:",
            f"    bind_addr: \"{UNDERLAY_ADDRESSES[node - 1]}:{UDP_PORT}\"",
            "    advertise_on_nostr: false",
            "    public: false",
            "    accept_connections: true",
            "    outbound_only: false",
            "peers:",
            *peers,
            "",
        ])
        write_owned(node_root / "fips.yaml", content, 0o600)


def render_namespace_filters(ulas: list[str]) -> None:
    underlay_set = ", ".join(UNDERLAY_ADDRESSES)
    ula_set = ", ".join(ulas)
    for node in range(1, 5):
        content = f"""table inet plebeian_fips_lab {{
  chain input {{
    type filter hook input priority filter; policy drop;
    iifname \"lo\" accept
    ct state established,related accept
    iifname \"under0\" ip saddr {{ {underlay_set} }} udp sport {UDP_PORT} udp dport {UDP_PORT} accept
    iifname \"fips0\" ip6 nexthdr ipv6-icmp accept
    iifname \"fips0\" ip6 saddr {{ {ula_set} }} tcp dport {COMET_P2P_PORT} accept
    iifname \"fips0\" ip6 saddr {ulas[0]} tcp dport {SIGNER_RPC_PORT} accept
  }}
  chain output {{
    type filter hook output priority filter; policy drop;
    oifname \"lo\" accept
    ct state established,related accept
    oifname \"under0\" ip daddr {{ {underlay_set} }} udp sport {UDP_PORT} udp dport {UDP_PORT} accept
    oifname \"fips0\" ip6 nexthdr ipv6-icmp accept
    oifname \"fips0\" ip6 daddr {{ {ula_set} }} tcp dport {{ {COMET_P2P_PORT}, {SIGNER_RPC_PORT} }} accept
  }}
}}\n"""
        write_owned(RUN_ROOT / f"node-{node}" / "nft.conf", content, 0o600)


def render_application_config(ulas: list[str], manifest: dict[str, Any]) -> None:
    config = {
        "schema": "PLEBEIAN_FRIDAY_FIPS_LAB_APPLICATION_V1",
        "run_id": RUN_ID,
        "fips_ulas": ulas,
        "comet_p2p_port": COMET_P2P_PORT,
        "comet_rpc_port": COMET_RPC_PORT,
        "signer_rpc_port": SIGNER_RPC_PORT,
        "comet_marker_hex": manifest["public_test_markers_hex"]["comet"],
        "signer_marker_hex": manifest["public_test_markers_hex"]["signer"],
        "network_root": str(RUN_ROOT / "network"),
        "dkg_root": str(RUN_ROOT / "dkg"),
        "driver_result": str(RUN_ROOT / "driver-result.json"),
    }
    write_owned(RUN_ROOT / "application.json", json.dumps(config, sort_keys=True, separators=(",", ":")) + "\n", 0o600)


def generate_application_identities(ulas: list[str]) -> None:
    ula_csv = ",".join(ulas)
    run(dropped_argv(
        VALIDATOR,
        ["init-remote", "--home", str(RUN_ROOT / "network"), "--hosts", ula_csv],
        node_root=RUN_ROOT,
    ), timeout=30)
    run(dropped_argv(
        DKG,
        [
            "provision", "--config", str(RUN_ROOT / "application.json"),
            "--participant-binary", FROST_PARTICIPANT,
            "--inspector-binary", FROST_INSPECTOR,
        ],
        node_root=RUN_ROOT,
    ), timeout=120)


def create_topology(created_namespaces: list[str]) -> None:
    run([IP, "netns", "add", SWITCH_NAMESPACE])
    created_namespaces.append(SWITCH_NAMESPACE)
    run([IP, "-n", SWITCH_NAMESPACE, "link", "add", "br0", "type", "bridge"])
    run([IP, "-n", SWITCH_NAMESPACE, "link", "set", "br0", "up"])
    run([IP, "-n", SWITCH_NAMESPACE, "link", "set", "lo", "up"])
    for node in range(1, 5):
        namespace = NODE_NAMESPACES[node - 1]
        host_temp = HOST_TEMP_LINKS[node - 1]
        switch_link = SWITCH_LINKS[node - 1]
        run([IP, "netns", "add", namespace])
        created_namespaces.append(namespace)
        run([IP, "link", "add", host_temp, "type", "veth", "peer", "name", "under0"])
        run([IP, "link", "set", host_temp, "netns", SWITCH_NAMESPACE])
        run([IP, "link", "set", "under0", "netns", namespace])
        run([IP, "-n", SWITCH_NAMESPACE, "link", "set", host_temp, "name", switch_link])
        run([IP, "-n", SWITCH_NAMESPACE, "link", "set", switch_link, "master", "br0"])
        run([IP, "-n", SWITCH_NAMESPACE, "link", "set", switch_link, "up"])
        run([IP, "-n", namespace, "link", "set", "lo", "up"])
        run([IP, "-n", namespace, "addr", "add", UNDERLAY_CIDR_ADDRESSES[node - 1], "dev", "under0"])
        run([IP, "-n", namespace, "link", "set", "under0", "up"])
        run([IP, "netns", "exec", namespace, NFT, "-f", str(RUN_ROOT / f"node-{node}/nft.conf")])
        routes = run([IP, "-n", namespace, "route", "show"]).stdout.decode()
        if "default" in routes or "198.18.242.0/29 dev under0" not in routes:
            refuse(f"node {node} has an unexpected route or lacks its sole connected route")


def interface_counters(node: int) -> dict[str, int]:
    output = run([IP, "-n", NODE_NAMESPACES[node - 1], "-s", "-j", "link", "show"]).stdout
    links = json.loads(output)
    result: dict[str, int] = {}
    for interface in ("under0", "fips0"):
        matches = [entry for entry in links if entry.get("ifname") == interface]
        if len(matches) != 1:
            refuse(f"node {node} lacks exact interface {interface}")
        stats = matches[0].get("stats64") or matches[0].get("stats")
        if not isinstance(stats, dict) or not isinstance(stats.get("rx"), dict) or not isinstance(stats.get("tx"), dict):
            refuse(f"node {node} interface {interface} lacks counters")
        result[f"{interface}_rx"] = int(stats["rx"]["bytes"])
        result[f"{interface}_tx"] = int(stats["tx"]["bytes"])
    return result


def wait_for_fips(owned: list[OwnedProcess]) -> None:
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        ready = True
        for node in range(1, 5):
            control = RUN_ROOT / f"node-{node}/runtime/control.sock"
            try:
                result = run(dropped_argv(
                    FIPSCTL, ["-s", str(control), "show", "peers"],
                    namespace=NODE_NAMESPACES[node - 1], node_root=RUN_ROOT / f"node-{node}",
                ), check=False, timeout=5)
                ready = ready and result.returncode == 0 and len(json.loads(result.stdout).get("peers", [])) >= 3
            except (subprocess.TimeoutExpired, json.JSONDecodeError, KeyError):
                ready = False
        if ready:
            for process in owned:
                verify_owned_process(process)
            return
        time.sleep(0.25)
    refuse("four-node FIPS mesh did not become ready within 45 seconds")


def start_application_processes(owned: list[OwnedProcess], ulas: list[str]) -> None:
    for node in range(1, 5):
        owned.append(start_owned(
            "validator", node, VALIDATOR,
            ["node", "--home", str(RUN_ROOT / "network"), "--slot", str(node)],
        ))
        owned.append(start_owned(
            "signer", node, SIGNER,
            ["serve", "--config", str(RUN_ROOT / f"node-{node}/signer.json")],
        ))


def run_driver() -> dict[str, Any]:
    result_path = RUN_ROOT / "driver-result.json"
    run(dropped_argv(
        DRIVER,
        ["run", "--config", str(RUN_ROOT / "application.json"), "--output", str(result_path)],
        namespace=NODE_NAMESPACES[0], node_root=RUN_ROOT / "node-1",
    ), timeout=300)
    if result_path.is_symlink() or not result_path.is_file() or result_path.stat().st_uid != UID:
        refuse("integration driver did not create its exact unprivileged result")
    value = json.loads(result_path.read_text(encoding="utf-8"))
    exact_object(value, {
        "schema", "operation_root", "comet_transaction_digest", "signer_request_digest",
        "direct_underlay_comet_refused", "direct_underlay_signer_refused", "fake_mint_settlement",
        "recipient_imported_amount", "one_signer_unavailable", "threshold_signature_verified",
    }, "driver result")
    if value["schema"] != "PLEBEIAN_FRIDAY_FIPS_DRIVER_RESULT_V1":
        refuse("integration driver result schema is wrong")
    for field in ("operation_root", "comet_transaction_digest", "signer_request_digest"):
        if not isinstance(value[field], str) or not HEX_32.fullmatch(value[field]):
            refuse(f"driver result has malformed {field}")
    if value["direct_underlay_comet_refused"] is not True or value["direct_underlay_signer_refused"] is not True:
        refuse("application ports were reachable directly on the underlay")
    if value["fake_mint_settlement"] != "finalized" or value["recipient_imported_amount"] <= 0:
        refuse("driver did not prove a real fake-mint recipient import")
    if value["one_signer_unavailable"] is not True or value["threshold_signature_verified"] is not True:
        refuse("driver did not prove a 3-of-4 threshold authorization")
    return value


def socket_ownership(node: int, owned: list[OwnedProcess]) -> dict[str, bool]:
    output = run([IP, "netns", "exec", NODE_NAMESPACES[node - 1], SS, "-H", "-ltnp"]).stdout.decode()
    validator_pid = next(process.process.pid for process in owned if process.node == node and process.role == "validator")
    signer_pid = next(process.process.pid for process in owned if process.node == node and process.role == "signer")
    return {
        "comet": f":{COMET_P2P_PORT}" in output and f"pid={validator_pid}," in output,
        "signer": f":{SIGNER_RPC_PORT}" in output and f"pid={signer_pid}," in output,
    }


def read_capture(node: int) -> dict[str, Any]:
    path = RUN_ROOT / f"node-{node}/capture.json"
    value = json.loads(path.read_text(encoding="utf-8"))
    exact_object(value, {
        "schema", "interface", "udp_port", "started_ns", "finished_ns", "packets",
        "payload_bytes", "payload_stream_sha256", "plaintext_marker_matches", "raw_packets_persisted",
    }, f"node {node} capture")
    if value["schema"] != "PLEBEIAN_FIPS_UNDERLAY_CAPTURE_V1" or value["interface"] != "under0":
        refuse(f"node {node} capture identity is wrong")
    if value["udp_port"] != UDP_PORT or value["packets"] < 1 or value["payload_bytes"] < 1:
        refuse(f"node {node} captured no encrypted FIPS underlay traffic")
    if value["plaintext_marker_matches"] != 0 or value["raw_packets_persisted"] is not False:
        refuse(f"node {node} exposed a plaintext marker or persisted raw packets")
    return value


def build_evidence(
    manifest: dict[str, Any],
    self_hash: str,
    rules_before: str,
    ulas: list[str],
    owned: list[OwnedProcess],
    before: list[dict[str, int]],
    after: list[dict[str, int]],
    driver: dict[str, Any],
    started_at: int,
) -> dict[str, Any]:
    nodes: list[dict[str, Any]] = []
    for node in range(1, 5):
        processes: list[dict[str, Any]] = []
        for role in ("fips", "validator", "signer"):
            process = next(item for item in owned if item.node == node and item.role == role)
            verify_owned_process(process)
            processes.append({
                "role": role, "pid": process.process.pid, "procStartTicks": process.start_ticks,
                "uid": UID, "gid": GID,
                "executableSha256": sha256_file(Path(process.executable)),
                "namespaceInode": process.namespace_inode,
            })
        capture = read_capture(node)
        sockets = socket_ownership(node, owned)
        counters = {
            "underlayRxBytesBefore": before[node - 1]["under0_rx"],
            "underlayRxBytesAfter": after[node - 1]["under0_rx"],
            "underlayTxBytesBefore": before[node - 1]["under0_tx"],
            "underlayTxBytesAfter": after[node - 1]["under0_tx"],
            "fipsRxBytesBefore": before[node - 1]["fips0_rx"],
            "fipsRxBytesAfter": after[node - 1]["fips0_rx"],
            "fipsTxBytesBefore": before[node - 1]["fips0_tx"],
            "fipsTxBytesAfter": after[node - 1]["fips0_tx"],
        }
        if any(counters[key.replace("After", "Before")] >= value for key, value in counters.items() if "After" in key):
            refuse(f"node {node} counters did not advance on both layers")
        nodes.append({
            "participantId": node, "namespace": NODE_NAMESPACES[node - 1],
            "underlayAddress": UNDERLAY_ADDRESSES[node - 1], "fipsUla": ulas[node - 1],
            "processes": processes, "counters": counters,
            "cometFipsSocketOwned": sockets["comet"], "signerFipsSocketOwned": sockets["signer"],
            "directUnderlayCometRefused": driver["direct_underlay_comet_refused"],
            "directUnderlaySignerRefused": driver["direct_underlay_signer_refused"],
            "underlayEncryptedUdpPackets": capture["packets"],
            "underlayEncryptedUdpBytes": capture["payload_bytes"],
            "underlayPlaintextMarkerMatches": capture["plaintext_marker_matches"],
        })
    return {
        "schema": "COCO_DEMO_FIPS_MESH_EVIDENCE_V1", "runId": RUN_ID,
        "harnessSha256": self_hash,
        "fipsBinarySha256": manifest["binary_pins"][FIPS],
        "fipsctlBinarySha256": manifest["binary_pins"][FIPSCTL],
        "startedAt": started_at, "finishedAt": int(time.time()),
        "operationRoot": driver["operation_root"],
        "cometTransactionDigest": driver["comet_transaction_digest"],
        "signerRequestDigest": driver["signer_request_digest"],
        "hostRulesetSha256Before": rules_before,
        "hostRulesetSha256After": host_ruleset_hash(), "nodes": nodes,
    }


def write_evidence(path: Path, value: dict[str, Any]) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.write(descriptor, (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode())
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.chown(path, UID, GID)


def cleanup(owned: list[OwnedProcess], created_namespaces: list[str], rules_before: str | None) -> list[str]:
    errors: list[str] = []
    for process in reversed(owned):
        try:
            stop_owned(process, 15)
        except Exception as error:  # cleanup records every exact failure and continues its bounded own targets
            errors.append(f"stop {process.role}/n{process.node}/pid{process.process.pid}: {error}")
    for namespace in reversed(created_namespaces):
        try:
            if namespace in namespace_names():
                remaining = run([IP, "netns", "pids", namespace]).stdout.decode().split()
                if remaining:
                    errors.append(f"namespace {namespace} still has PIDs {remaining}")
                    continue
                run([IP, "netns", "delete", namespace])
        except Exception as error:
            errors.append(f"delete namespace {namespace}: {error}")
    try:
        conflicts = namespace_names().intersection(ALL_NAMESPACES)
        if conflicts:
            errors.append(f"namespaces remain: {sorted(conflicts)}")
    except Exception as error:
        errors.append(f"postflight namespace inventory: {error}")
    try:
        if rules_before is not None and host_ruleset_hash() != rules_before:
            errors.append("host nftables ruleset hash changed")
    except Exception as error:
        errors.append(f"postflight host ruleset hash: {error}")
    try:
        listeners = run([SS, "-H", "-ltnup"]).stdout.decode()
        if any(re.search(rf":{port}\b", listeners) for port in (UDP_PORT, COMET_P2P_PORT, COMET_RPC_PORT, SIGNER_RPC_PORT, 3338, 3339)):
            errors.append("a reviewed lab port remains listening in the host namespace")
    except Exception as error:
        errors.append(f"postflight listener inventory: {error}")
    if RUN_ROOT.exists():
        try:
            if RUN_ROOT.is_symlink() or RUN_ROOT.resolve() != RUN_ROOT or not MARKER_PATH.is_file():
                errors.append("run root ownership marker/realpath invalid; refusing deletion")
            elif MARKER_PATH.read_text(encoding="utf-8") != RUN_ID + "\n":
                errors.append("run root marker content invalid; refusing deletion")
            elif any(namespace in namespace_names() for namespace in ALL_NAMESPACES):
                errors.append("namespace remains; refusing run-root deletion")
            else:
                shutil.rmtree(RUN_ROOT)
        except Exception as error:
            errors.append(f"remove exact run root: {error}")
    if RUN_ROOT.exists():
        errors.append(f"run root remains: {RUN_ROOT}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--expected-manifest-sha256", required=True)
    parser.add_argument("--expected-harness-sha256", required=True)
    arguments = parser.parse_args()
    if arguments.manifest != str(MANIFEST_PATH):
        refuse("only the reviewed absolute execution manifest is accepted")

    manifest = load_manifest(arguments.expected_manifest_sha256, arguments.expected_harness_sha256)
    rules_before: str | None = None
    owned: list[OwnedProcess] = []
    created_namespaces: list[str] = []
    started_at = int(time.time())
    deadline = time.monotonic() + manifest["limits"]["wall_seconds"]
    success = False
    failure: str | None = None
    try:
        rules_before = preflight()
        new_run_root()
        ulas = keygen_and_addresses(manifest)
        generate_application_identities(ulas)
        create_topology(created_namespaces)
        for node in range(1, 5):
            owned.append(start_owned(
                "capture", node, PYTHON,
                [
                    "-I", "-S", str(CAPTURE_PATH),
                    "--output", str(RUN_ROOT / f"node-{node}/capture.json"),
                    "--comet-marker-hex", manifest["public_test_markers_hex"]["comet"],
                    "--signer-marker-hex", manifest["public_test_markers_hex"]["signer"],
                ],
                capability="net_raw",
            ))
            owned.append(start_owned(
                "fips", node, FIPS,
                ["-c", str(RUN_ROOT / f"node-{node}/fips.yaml"), "--log-file", str(RUN_ROOT / f"node-{node}/fips-daemon.log")],
                capability="net_admin",
            ))
        wait_for_fips([process for process in owned if process.role == "fips"])
        start_application_processes(owned, ulas)
        time.sleep(2)
        before = [interface_counters(node) for node in range(1, 5)]
        driver = run_driver()
        after = [interface_counters(node) for node in range(1, 5)]
        if time.monotonic() > deadline:
            refuse("one-run 3600-second watchdog expired")
        for capture in [process for process in owned if process.role == "capture"]:
            stop_owned(capture, 15)
        evidence = build_evidence(
            manifest, arguments.expected_harness_sha256, rules_before, ulas, owned,
            before, after, driver, started_at,
        )
        if evidence["hostRulesetSha256Before"] != evidence["hostRulesetSha256After"]:
            refuse("host firewall changed during isolated lab")
        write_evidence(EVIDENCE_PATH, evidence)
        success = True
    except Exception as error:
        failure = f"{type(error).__name__}: {error}"
    cleanup_errors = cleanup(owned, created_namespaces, rules_before)
    if cleanup_errors:
        failure = f"{failure + '; ' if failure else ''}cleanup failed: {'; '.join(cleanup_errors)}"
        success = False
    if failure is not None:
        try:
            write_evidence(FAILURE_EVIDENCE_PATH, {
                "schema": "PLEBEIAN_FRIDAY_FIPS_LAB_FAILURE_V1", "run_id": RUN_ID,
                "started_at": started_at, "finished_at": int(time.time()), "error": failure,
                "cleanup_complete": not cleanup_errors, "cleanup_errors": cleanup_errors,
                "secrets_or_packet_bytes_included": False,
            })
        except FileExistsError:
            pass
        print(f"Friday FIPS lab failed closed: {failure}", file=sys.stderr)
        return 1
    if not success:
        print("Friday FIPS lab did not produce success evidence", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except LabRefusal as error:
        print(f"Friday FIPS lab refused before execution: {error}", file=sys.stderr)
        raise SystemExit(2)
