#!/usr/bin/python3
"""Single-run R2 controller for the isolated Friday FIPS/FROST lab.

This remains inert until its exact manifest is independently reviewed and has
``approval_ready: true``.  It imports only the SHA-pinned R1 controller's
generic namespace/process/cleanup primitives; all R2 application ordering,
ports, identities, and evidence checks are defined here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
import types
from pathlib import Path
from typing import Any


SOURCE_REPO = Path("/home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc")
TRUSTED_REPO = Path("/var/lib/plebeian-friday-fips-r2-reviewed")
REPO = Path(__file__).resolve().parent.parent
BASE_PATH = REPO / "scripts/friday-fips-lab.py"
SELF_PATH = Path(__file__).resolve()
CAPTURE_PATH = REPO / "scripts/friday-fips-capture.py"
MINT_BOOTSTRAP = REPO / "scripts/friday-fips-mint-bootstrap.py"
MANIFEST_PATH = REPO / "FIPS-LOCAL-LAB-R2-EXECUTION.json"
RUN_ID = "friday-fips-lab-20261022-r2"
RUN_ROOT = Path("/tmp/plebeian-friday-fips-lab.20261022-r2")
EVIDENCE_PATH = Path("/tmp/plebeian-friday-fips-lab.20261022-r2-success.json")
FAILURE_PATH = Path("/tmp/plebeian-friday-fips-lab.20261022-r2-failure.json")
HEX32 = re.compile(r"^[0-9a-f]{64}$")
BASE_SOURCE_SHA256 = "c7b3a55d00cb3fd27c40530f9a62fce028b8e366e11b4f6ad90467c7ec31d306"

VALIDATOR = REPO / "lab-bin/plebeian-auctions-poc"
DKG = REPO / "lab-bin/plebeian-friday-frost-dkg"
SIGNER = REPO / "lab-bin/plebeian-friday-signer"
DRIVER = REPO / "lab-bin/plebeian-friday-integrated-driver"
PARTICIPANT = REPO / "lab-bin/coco-demo-frost-participant-3of4"
INSPECTOR = REPO / "lab-bin/coco-demo-frost-public-inspect"
NUTSHELL_SITE = REPO / ".venv/lib/python3.12/site-packages"
PYTHON = Path("/usr/bin/python3.12")
MINT_PORT = 3338
SITE_PORT = 8080
VALIDATOR_READINESS_SOURCE = (
    "import json,urllib.request;"
    "print(urllib.request.urlopen('http://127.0.0.1:8080/api/validators',timeout=3).read().decode())"
)


def load_base():
    descriptor = os.open(BASE_PATH, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(descriptor)
        if os.geteuid() == 0 and (metadata.st_uid != 0 or metadata.st_gid != 0 or metadata.st_mode & 0o022):
            raise RuntimeError("R1 primitive source is mutable or non-root before import")
        source = b""
        while chunk := os.read(descriptor, 1024 * 1024):
            source += chunk
    finally:
        os.close(descriptor)
    if hashlib.sha256(source).hexdigest() != BASE_SOURCE_SHA256:
        raise RuntimeError("R1 primitive source differs before safe import")
    name = "plebeian_fips_r1_primitives"
    module = types.ModuleType(name)
    module.__file__ = str(BASE_PATH)
    sys.modules[name] = module
    exec(compile(source, str(BASE_PATH), "exec"), module.__dict__)
    return module


base = load_base()
base.RUN_ID = RUN_ID
base.RUN_ROOT = RUN_ROOT
base.MARKER_PATH = RUN_ROOT / ".plebeian-friday-fips-lab-owned"
base.EVIDENCE_PATH = EVIDENCE_PATH
base.FAILURE_EVIDENCE_PATH = FAILURE_PATH
base.VALIDATOR = str(VALIDATOR)
base.DKG = str(DKG)
base.SIGNER = str(SIGNER)
base.DRIVER = str(DRIVER)
base.FROST_PARTICIPANT = str(PARTICIPANT)
base.FROST_INSPECTOR = str(INSPECTOR)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def assert_trusted_root_copy() -> None:
    if os.geteuid() != 0:
        return
    if REPO != TRUSTED_REPO or SELF_PATH != TRUSTED_REPO / "scripts/friday-fips-lab-r2.py":
        refuse("privileged execution requires the exact root-owned reviewed staging tree")
    for path in (TRUSTED_REPO, TRUSTED_REPO / "scripts", TRUSTED_REPO / "lab-bin",
                 TRUSTED_REPO / ".venv", TRUSTED_REPO / ".venv/lib",
                 TRUSTED_REPO / ".venv/lib/python3.12",
                 TRUSTED_REPO / ".venv/lib/python3.12/site-packages",
                 SELF_PATH, MANIFEST_PATH, BASE_PATH, CAPTURE_PATH, MINT_BOOTSTRAP):
        stat = path.stat(follow_symlinks=False)
        if path.is_symlink() or stat.st_uid != 0 or stat.st_gid != 0 or stat.st_mode & 0o022:
            refuse(f"reviewed staging path is symlinked, not root-owned, or writable: {path}")


def nutshell_tree_sha256() -> str:
    if not NUTSHELL_SITE.is_dir() or NUTSHELL_SITE.is_symlink():
        refuse(f"Nutshell site-packages root is absent or symlinked: {NUTSHELL_SITE}")
    entries: list[Path] = []
    for path in NUTSHELL_SITE.rglob("*"):
        stat = path.stat(follow_symlinks=False)
        # Reject directory symlinks too.  Filtering with Path.is_dir() first
        # would follow them and could silently omit an imported subtree.
        if path.is_symlink() or stat.st_uid != 0 or stat.st_gid != 0 or stat.st_mode & 0o022:
            refuse(f"Nutshell site-packages contains a symlink or writable/non-root entry: {path}")
        if path.is_dir():
            continue
        if not path.is_file():
            refuse(f"Nutshell site-packages contains a non-file entry: {path}")
        entries.append(path)
    digest = hashlib.sha256()
    for path in sorted(entries, key=lambda item: str(item.relative_to(NUTSHELL_SITE))):
        relative = str(path.relative_to(NUTSHELL_SITE))
        digest.update(f"file:{sha256_file(path)}  {relative}\n".encode())
    return digest.hexdigest()


def refuse(message: str) -> None:
    raise base.LabRefusal(message)


def exact_object(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        refuse(f"{label} has missing or unexpected fields")
    return value


def load_manifest(expected_manifest_hash: str, expected_self_hash: str) -> dict[str, Any]:
    if not HEX32.fullmatch(expected_manifest_hash) or not HEX32.fullmatch(expected_self_hash):
        refuse("reviewed hash argument is malformed")
    if sha256_file(MANIFEST_PATH) != expected_manifest_hash or sha256_file(SELF_PATH) != expected_self_hash:
        refuse("R2 manifest/controller differs from reviewed bytes")
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    exact_object(manifest, {
        "schema", "approval_ready", "reason_not_ready", "run_id", "run_root", "host", "limits",
        "fixed_network", "binary_pins", "dependency_pins", "source_pins", "evidence_path", "failure_evidence_path",
    }, "manifest")
    if manifest["schema"] != "PLEBEIAN_FRIDAY_FIPS_LAB_EXECUTION_V2" or manifest["approval_ready"] is not True:
        refuse(f"R2 execution manifest is inert: {manifest.get('reason_not_ready')}")
    if manifest["run_id"] != RUN_ID or manifest["run_root"] != str(RUN_ROOT):
        refuse("reviewed run identity differs")
    if manifest["evidence_path"] != str(EVIDENCE_PATH) or manifest["failure_evidence_path"] != str(FAILURE_PATH):
        refuse("reviewed evidence paths differ")
    if manifest["host"] != {
        "hostname": socket.gethostname(), "kernel_release": os.uname().release,
        "uid": 1000, "gid": 1000, "user": "maximoto",
    }:
        refuse("reviewed host identity differs")
    if manifest["limits"] != {
        "wall_seconds": 1800, "startup_seconds": 60, "shutdown_seconds": 15,
        "max_log_bytes_per_process": 10_485_760,
    }:
        refuse("reviewed R2 limits differ")
    network = manifest["fixed_network"]
    expected_network = {
        "namespaces": list(base.ALL_NAMESPACES), "underlay_cidr": "198.18.242.0/29",
        "underlay_addresses": list(base.UNDERLAY_CIDR_ADDRESSES), "udp_port": 32121,
        "comet_p2p_port": 26656, "comet_rpc_port": 26657, "signer_rpc_port": 39101,
        "mint_port": 3338, "site_port": 8080, "external_egress": False,
        "host_routes": False, "host_firewall_changes": False, "host_file_capabilities": False,
    }
    if network != expected_network:
        refuse("reviewed isolated network differs")
    source_paths = {str(SELF_PATH), str(BASE_PATH), str(CAPTURE_PATH), str(MINT_BOOTSTRAP)}
    sources = exact_object(manifest["source_pins"], source_paths | {"reviewed_integration_commit"}, "source pins")
    for path_text in source_paths:
        if not HEX32.fullmatch(str(sources[path_text])) or sha256_file(Path(path_text)) != sources[path_text]:
            refuse(f"source differs from reviewed bytes: {path_text}")
    if sources[str(SELF_PATH)] != expected_self_hash:
        refuse("manifest and invocation disagree on R2 controller hash")
    expected_binaries = {
        str(PYTHON), base.FIPS, base.FIPSCTL, base.IP, base.NFT, base.SETPRIV, base.PRLIMIT,
        base.SS, base.ENV, str(VALIDATOR), str(DKG), str(SIGNER), str(DRIVER),
        str(PARTICIPANT), str(INSPECTOR),
    }
    pins = exact_object(manifest["binary_pins"], expected_binaries, "binary pins")
    for path_text in expected_binaries:
        path = Path(path_text)
        stat = path.stat(follow_symlinks=False)
        if not path.is_file() or path.is_symlink() or not os.access(path, os.X_OK) \
                or stat.st_uid != 0 or stat.st_gid != 0 or stat.st_mode & 0o022 \
                or not HEX32.fullmatch(str(pins[path_text])) or sha256_file(path) != pins[path_text]:
            refuse(f"binary is absent, mutable/non-root, symlinked, non-executable, or differs: {path_text}")
    dependency = exact_object(manifest["dependency_pins"], {
        "nutshell_distribution", "nutshell_version", "site_packages_tree_sha256", "entry_module",
        "nutshell_record_sha256", "nutshell_metadata_sha256",
    }, "dependency pins")
    if dependency != {
        "nutshell_distribution": "cashu", "nutshell_version": "0.19.2",
        "site_packages_tree_sha256": nutshell_tree_sha256(), "entry_module": "cashu.mint",
        "nutshell_record_sha256": sha256_file(NUTSHELL_SITE / "cashu-0.19.2.dist-info/RECORD"),
        "nutshell_metadata_sha256": sha256_file(NUTSHELL_SITE / "cashu-0.19.2.dist-info/METADATA"),
    }:
        refuse("installed Nutshell dependency tree differs from the reviewed FakeWallet mint")
    return manifest


def process_group_exists(process_group: int) -> bool:
    try:
        os.killpg(process_group, 0)
        return True
    except ProcessLookupError:
        return False


def stop_synchronous_group(child: subprocess.Popen[bytes], start_ticks: int | None, timeout: float = 15) -> None:
    process_group = child.pid
    if child.poll() is None:
        # With a recorded start tick, require exact PID identity. When startup
        # itself failed before /proc identity could be read, the still-live
        # Popen child is the directly owned identity and is safe to stop.
        if start_ticks is not None and base.process_start_ticks(child.pid) != start_ticks:
            refuse(f"refusing to signal reused synchronous PID {child.pid}")
        try:
            os.killpg(process_group, signal.SIGTERM)
        except ProcessLookupError:
            pass
    deadline = time.monotonic() + timeout
    while process_group_exists(process_group) and time.monotonic() < deadline:
        time.sleep(0.05)
    if process_group_exists(process_group):
        if child.poll() is None and start_ticks is not None and base.process_start_ticks(child.pid) != start_ticks:
            refuse(f"refusing forced termination of reused synchronous PID {child.pid}")
        try:
            os.killpg(process_group, signal.SIGKILL)
        except ProcessLookupError:
            pass
        deadline = time.monotonic() + 5
        while process_group_exists(process_group) and time.monotonic() < deadline:
            time.sleep(0.05)
    try:
        child.wait(timeout=1)
    except subprocess.TimeoutExpired:
        pass
    if process_group_exists(process_group):
        refuse(f"synchronous process group {process_group} remains after bounded cleanup")


def run_synchronous_owned(
    role: str,
    argv: list[str],
    records: list[dict[str, Any]],
    *,
    timeout: float,
) -> subprocess.CompletedProcess[bytes]:
    if not argv or not argv[0].startswith("/") or not re.fullmatch(r"[a-z0-9-]{1,48}", role):
        refuse("synchronous helper identity is not exact")
    index = len(records) + 1
    stdout_path = RUN_ROOT / f"sync-{index:02d}-{role}.stdout"
    stderr_path = RUN_ROOT / f"sync-{index:02d}-{role}.stderr"
    child: subprocess.Popen[bytes] | None = None
    start_ticks: int | None = None
    record: dict[str, Any] | None = None
    stdout_descriptor: int | None = None
    stderr_descriptor: int | None = None
    timed_out = False
    descendants_remained = False
    # A handled SIGINT/SIGTERM cannot land between Popen and durable in-memory
    # registration. The prior mask is restored immediately after PID/start
    # identity is in `records`; a pending signal is then handled by the outer
    # exception/finally path, which owns this exact new-session group.
    previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
    try:
        try:
            stdout_descriptor = os.open(stdout_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            stderr_descriptor = os.open(stderr_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            child = subprocess.Popen(
                argv, stdin=subprocess.DEVNULL, stdout=stdout_descriptor, stderr=stderr_descriptor,
                env={}, close_fds=True, start_new_session=True,
            )
            record = {
                "role": role, "pid": child.pid, "procStartTicks": None,
                "processGroup": child.pid, "exitCode": None,
                "timedOut": False, "descendantsRequiredCleanup": False,
                "groupAbsentAfterCleanup": False, "registrationState": "spawned",
            }
            records.append(record)
            start_ticks = base.process_start_ticks(child.pid)
            record["procStartTicks"] = start_ticks
            record["registrationState"] = "registered"
        finally:
            if stdout_descriptor is not None:
                os.close(stdout_descriptor)
            if stderr_descriptor is not None:
                os.close(stderr_descriptor)
            signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)

        assert child is not None and record is not None
        try:
            child.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
        descendants_remained = process_group_exists(child.pid)
        if timed_out or descendants_remained:
            stop_synchronous_group(child, start_ticks)
        stdout = stdout_path.read_bytes()
        stderr = stderr_path.read_bytes()
        if len(stdout) > 10_485_760 or len(stderr) > 10_485_760:
            refuse(f"synchronous {role} exceeded its reviewed 10 MiB output bound")
        if timed_out:
            refuse(f"synchronous {role} exceeded its reviewed timeout")
        if descendants_remained:
            refuse(f"synchronous {role} left descendant processes after its leader exited")
        if child.returncode != 0:
            raise subprocess.CalledProcessError(child.returncode or 1, argv, output=stdout, stderr=stderr)
        return subprocess.CompletedProcess(argv, child.returncode, stdout, stderr)
    except BaseException:
        if child is not None and process_group_exists(child.pid):
            stop_synchronous_group(child, start_ticks)
        raise
    finally:
        # This finally also covers a pending signal delivered while restoring
        # the pre-spawn mask. No synchronous invocation can return or unwind
        # while its process group still exists.
        if child is not None and process_group_exists(child.pid):
            stop_synchronous_group(child, start_ticks)
        if record is not None:
            record.update({
                "procStartTicks": start_ticks, "exitCode": child.returncode if child is not None else None,
                "timedOut": timed_out, "descendantsRequiredCleanup": descendants_remained,
                "groupAbsentAfterCleanup": child is not None and not process_group_exists(child.pid),
                "registrationState": "cleaned" if child is not None and not process_group_exists(child.pid) else record["registrationState"],
            })


def create_topology_owned(created_namespaces: list[str], created_host_links: set[str]) -> None:
    """Create the exact topology while retaining host-link cleanup identity.

    The pinned R1 primitive creates the veth peer in the host before moving
    either end.  Recording both names immediately after the successful add
    lets cleanup remove only links that preflight proved absent and this run
    created, even if a subsequent move fails.
    """
    base.run([base.IP, "netns", "add", base.SWITCH_NAMESPACE])
    created_namespaces.append(base.SWITCH_NAMESPACE)
    base.run([base.IP, "-n", base.SWITCH_NAMESPACE, "link", "add", "br0", "type", "bridge"])
    base.run([base.IP, "-n", base.SWITCH_NAMESPACE, "link", "set", "br0", "up"])
    base.run([base.IP, "-n", base.SWITCH_NAMESPACE, "link", "set", "lo", "up"])
    for node in range(1, 5):
        namespace = base.NODE_NAMESPACES[node - 1]
        host_temp = base.HOST_TEMP_LINKS[node - 1]
        switch_link = base.SWITCH_LINKS[node - 1]
        base.run([base.IP, "netns", "add", namespace])
        created_namespaces.append(namespace)
        base.run([base.IP, "link", "add", host_temp, "type", "veth", "peer", "name", "under0"])
        created_host_links.update((host_temp, "under0"))
        base.run([base.IP, "link", "set", host_temp, "netns", base.SWITCH_NAMESPACE])
        base.run([base.IP, "link", "set", "under0", "netns", namespace])
        base.run([base.IP, "-n", base.SWITCH_NAMESPACE, "link", "set", host_temp, "name", switch_link])
        base.run([base.IP, "-n", base.SWITCH_NAMESPACE, "link", "set", switch_link, "master", "br0"])
        base.run([base.IP, "-n", base.SWITCH_NAMESPACE, "link", "set", switch_link, "up"])
        base.run([base.IP, "-n", namespace, "link", "set", "lo", "up"])
        base.run([base.IP, "-n", namespace, "addr", "add", base.UNDERLAY_CIDR_ADDRESSES[node - 1], "dev", "under0"])
        base.run([base.IP, "-n", namespace, "link", "set", "under0", "up"])
        base.run([base.IP, "netns", "exec", namespace, base.NFT, "-f", str(RUN_ROOT / f"node-{node}/nft.conf")])
        routes = base.run([base.IP, "-n", namespace, "route", "show"]).stdout.decode()
        if "default" in routes or "198.18.242.0/29 dev under0" not in routes:
            refuse(f"node {node} has an unexpected route or lacks its sole connected route")


def host_link_names() -> set[str]:
    links = json.loads(base.run([base.IP, "-j", "link", "show"]).stdout)
    if not isinstance(links, list) or any(not isinstance(item, dict) or not isinstance(item.get("ifname"), str) for item in links):
        refuse("host link inventory is malformed")
    return {item["ifname"] for item in links}


def cleanup_owned(
    owned: list[Any], created_namespaces: list[str], rules_before: str | None,
    created_host_links: set[str],
) -> list[str]:
    errors = base.cleanup(owned, created_namespaces, rules_before)
    # Preflight proved these fixed names absent. Delete only names recorded
    # immediately after this run successfully created their veth pair.
    try:
        present = host_link_names()
    except Exception as error:
        errors.append(f"pre-delete host-link inventory: {error}")
        present = set()
    for name in sorted(created_host_links.intersection(present)):
        try:
            base.run([base.IP, "link", "delete", name])
        except Exception as error:
            errors.append(f"delete recorded host veth {name}: {error}")
    try:
        reserved = set(base.HOST_TEMP_LINKS) | set(base.SWITCH_LINKS) | {"br0", "under0", "fips0"}
        remaining = reserved.intersection(host_link_names())
        if remaining:
            errors.append(f"fixed lab host links remain: {sorted(remaining)}")
    except Exception as error:
        errors.append(f"postflight host-link inventory: {error}")
    return errors


def render_application_config(ulas: list[str], _manifest: dict[str, Any]) -> None:
    value = {
        "schema": "PLEBEIAN_FRIDAY_FIPS_LAB_APPLICATION_V2", "run_id": RUN_ID,
        "fips_ulas": ulas, "comet_p2p_port": 26656, "comet_rpc_port": 26657,
        "signer_rpc_port": 39101, "mint_port": MINT_PORT,
        "network_root": str(RUN_ROOT / "network"), "dkg_root": str(RUN_ROOT / "dkg"),
        "driver_result": str(RUN_ROOT / "driver-result.json"),
    }
    base.write_owned(RUN_ROOT / "application.json", json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n", 0o600)


def render_namespace_filters(ulas: list[str]) -> None:
    underlay = ", ".join(base.UNDERLAY_ADDRESSES)
    ula_set = ", ".join(ulas)
    for node in range(1, 5):
        content = f"""table inet plebeian_fips_lab {{
  chain input {{
    type filter hook input priority filter; policy drop;
    iifname \"lo\" accept
    ct state established,related accept
    iifname \"under0\" ip saddr {{ {underlay} }} udp sport 32121 udp dport 32121 accept
    iifname \"fips0\" ip6 nexthdr ipv6-icmp accept
    iifname \"fips0\" ip6 saddr {{ {ula_set} }} tcp dport 26656 accept
    iifname \"fips0\" ip6 saddr {ulas[0]} tcp dport 39101 accept
    iifname \"fips0\" ip6 saddr {{ {ula_set} }} tcp dport 3338 accept
  }}
  chain output {{
    type filter hook output priority filter; policy drop;
    oifname \"lo\" accept
    ct state established,related accept
    oifname \"under0\" ip daddr {{ {underlay} }} udp sport 32121 udp dport 32121 accept
    oifname \"fips0\" ip6 nexthdr ipv6-icmp accept
    oifname \"fips0\" ip6 daddr {{ {ula_set} }} tcp dport {{ 26656, 39101, 3338 }} accept
  }}
}}\n"""
        base.write_owned(RUN_ROOT / f"node-{node}/nft.conf", content, 0o600)


base.render_application_config = render_application_config
base.render_namespace_filters = render_namespace_filters


def provision_application(ulas: list[str], synchronous: list[dict[str, Any]]) -> dict[str, Any]:
    application = RUN_ROOT / "application.json"
    dkg_result = RUN_ROOT / "dkg-result.json"
    run_synchronous_owned("dkg-provision", base.dropped_argv(str(DKG), [
        "provision", "--config", str(application), "--participant-binary", str(PARTICIPANT),
        "--inspector-binary", str(INSPECTOR), "--output", str(dkg_result),
    ], node_root=RUN_ROOT), synchronous, timeout=120)
    dkg = json.loads(dkg_result.read_text(encoding="utf-8"))
    committee = dkg.get("committeePublicKey")
    if not isinstance(committee, str) or re.fullmatch(r"02[0-9a-f]{64}", committee) is None:
        refuse("DKG result lacks an even-Y threshold public key")
    run_synchronous_owned("comet-init", base.dropped_argv(str(VALIDATOR), [
        "init-remote", "--home", str(RUN_ROOT / "network"), "--hosts", ",".join(ulas),
        "--committee-public-key", committee,
    ], node_root=RUN_ROOT), synchronous, timeout=45)
    facts = run_synchronous_owned("comet-facts", base.dropped_argv(str(VALIDATOR), [
        "network-facts", "--home", str(RUN_ROOT / "network"),
    ], node_root=RUN_ROOT), synchronous, timeout=20).stdout.decode()
    base.write_owned(RUN_ROOT / "network-facts.json", facts, 0o600)
    seed = os.urandom(32).hex() + "\n"
    base.write_owned(RUN_ROOT / "node-1/mint.seed", seed, 0o600)
    return dkg


def read_validator_readiness() -> dict[str, Any]:
    result = base.run(base.dropped_argv(str(PYTHON), [
        "-I", "-S", "-B", "-c", VALIDATOR_READINESS_SOURCE,
    ], namespace=base.NODE_NAMESPACES[0], node_root=RUN_ROOT / "node-1"), timeout=5)
    value = json.loads(result.stdout)
    validators = value.get("validators") if isinstance(value, dict) else None
    if not isinstance(validators, list) or len(validators) != 4:
        refuse("validator readiness response lacks four validators")
    online = [entry for entry in validators if isinstance(entry, dict) and entry.get("online") is True]
    nodes = {entry.get("node_id") for entry in online}
    consensus = {entry.get("validator_address") for entry in online}
    heights = {entry.get("canonical_commit_height") for entry in online}
    signatures = {entry.get("commit_signatures") for entry in online}
    if len(online) != 4 or len(nodes) != 4 or None in nodes or len(consensus) != 4 or None in consensus \
            or len(heights) != 1 or next(iter(heights), 0) < 1 or signatures != {4} \
            or any(entry.get("error", "") not in ("", None) for entry in online):
        refuse("four validators lack distinct identities, peers, or a four-signature canonical commit")
    return {
        "canonicalCommitHeight": next(iter(heights)), "commitSignatures": 4,
        "nodeIds": sorted(nodes), "validatorAddresses": sorted(consensus),
    }


def start_application(owned: list[Any], ulas: list[str]) -> dict[str, Any]:
    for node in range(1, 5):
        owned.append(base.start_owned("validator", node, str(VALIDATOR), [
            "node", "--home", str(RUN_ROOT / "network"), "--slot", str(node),
        ]))
    owned.append(base.start_owned("site", 1, str(VALIDATOR), [
        "serve", "--home", str(RUN_ROOT / "network"), "--listen", f"127.0.0.1:{SITE_PORT}",
    ]))
    owned.append(base.start_owned("mint", 1, str(PYTHON), [
        "-I", str(MINT_BOOTSTRAP), "--config", str(RUN_ROOT / "application.json"),
        "--seed-file", str(RUN_ROOT / "node-1/mint.seed"), "--python-executable", str(PYTHON),
        "--site-packages", str(NUTSHELL_SITE),
    ]))
    for node in range(1, 5):
        owned.append(base.start_owned("signer", node, str(SIGNER), [
            "serve", "--application", str(RUN_ROOT / "application.json"),
            "--dkg-result", str(RUN_ROOT / "dkg-result.json"),
            "--network-facts", str(RUN_ROOT / "network-facts.json"), "--slot", str(node),
            "--participant-binary", str(PARTICIPANT),
        ]))
    readiness: dict[str, Any] | None = None
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if all((RUN_ROOT / f"node-{node}/signer-enrollment-public.json").is_file() for node in range(1, 5)):
            try:
                if all(base.socket_ownership(node, owned)["signer"] for node in range(1, 5)):
                    readiness = read_validator_readiness()
                    break
            except Exception:
                pass
        time.sleep(0.1)
    else:
        refuse("four signers and validators did not prove enrollment, listeners, peers and a canonical commit within 60 seconds")
    assert readiness is not None
    stopped: dict[str, Any] = {}
    for role in ("signer", "validator"):
        target = next(item for item in owned if item.role == role and item.node == 4)
        base.verify_owned_process(target)
        base.stop_owned(target, 15)
        if target.process.returncode is None:
            refuse(f"node 4 {role} did not exit after the deliberate stop")
        stopped[role] = {"pid": target.process.pid, "procStartTicks": target.start_ticks, "exitCode": target.process.returncode}
    readiness["deliberatelyStoppedNode4"] = stopped
    return readiness


def run_driver(synchronous: list[dict[str, Any]]) -> dict[str, Any]:
    path = RUN_ROOT / "driver-result.json"
    prepared_path = RUN_ROOT / "driver-prepared.json"
    context_path = RUN_ROOT / "driver-recovery-context.json"
    run_synchronous_owned("driver-run", base.dropped_argv(str(DRIVER), [
        "run", "--application", str(RUN_ROOT / "application.json"),
        "--dkg-result", str(RUN_ROOT / "dkg-result.json"),
        "--network-facts", str(RUN_ROOT / "network-facts.json"),
        "--participant-binary", str(PARTICIPANT), "--output", str(prepared_path),
    ], namespace=base.NODE_NAMESPACES[0], node_root=RUN_ROOT / "node-1"), synchronous, timeout=600)
    prepared = json.loads(prepared_path.read_text(encoding="utf-8"))
    exact_object(prepared, {
        "schema", "contextPath", "operationId", "operationRoot", "status",
        "displacedBidderActorKeyAvailable", "displacedBidderMainKeyAvailable",
        "displacedBidderEmergencyRefundKeyAvailable", "admissionPrivateStoreReopened",
    }, "driver prepared result")
    if prepared["schema"] != "PLEBEIAN_FRIDAY_FIPS_DRIVER_PREPARED_V1" \
            or prepared["contextPath"] != str(context_path) or prepared["status"] != "response_unknown" \
            or any(prepared[field] is not False for field in (
                "displacedBidderActorKeyAvailable", "displacedBidderMainKeyAvailable",
                "displacedBidderEmergencyRefundKeyAvailable",
            )) or prepared["admissionPrivateStoreReopened"] is not True:
        refuse("first driver process did not stop at the durable response-unknown boundary")
    # The first process has exited. A new process with no bidder key or mint
    # inputs reconstructs only the exact persisted NUT-07/NUT-09/import state.
    run_synchronous_owned("driver-recover", base.dropped_argv(str(DRIVER), [
        "recover", "--context", str(context_path), "--output", str(path),
    ], namespace=base.NODE_NAMESPACES[0], node_root=RUN_ROOT / "node-1"), synchronous, timeout=180)
    value = json.loads(path.read_text(encoding="utf-8"))
    exact_object(value, {
        "schema", "operation_root", "comet_transaction_digest", "signer_request_digest",
        "comet_plaintext_probe_committed", "signer_plaintext_probe_authenticated",
        "direct_underlay_comet_refused", "direct_underlay_signer_refused", "fake_mint_settlement",
        "recipient_imported_amount", "one_signer_unavailable", "threshold_signature_verified",
        "nut07_inputs", "nut07_outputs", "nut09_outputs", "participant_ids", "recovery_process_boundary",
    }, "driver result")
    if value["schema"] != "PLEBEIAN_FRIDAY_FIPS_DRIVER_RESULT_V2" or value["participant_ids"] != [1, 2, 3] \
            or value["recovery_process_boundary"] is not True:
        refuse("driver did not use the exact three available participants")
    if any(value[field] is not True for field in (
        "comet_plaintext_probe_committed", "signer_plaintext_probe_authenticated",
        "direct_underlay_comet_refused", "direct_underlay_signer_refused",
        "one_signer_unavailable", "threshold_signature_verified",
    )):
        refuse("driver did not prove isolation and genuine one-signer unavailability")
    if value["fake_mint_settlement"] != "finalized" or value["recipient_imported_amount"] != 1000 \
            or not value["nut07_inputs"] or set(value["nut07_inputs"]) != {"SPENT"} \
            or not value["nut07_outputs"] or set(value["nut07_outputs"]) != {"UNSPENT"}:
        refuse("driver did not prove exact fake-mint input spend and recipient ownership")
    return value


def process_record(item: Any) -> dict[str, Any]:
    running = item.process.poll() is None
    if running:
        base.verify_owned_process(item)
    return {
        "role": item.role, "node": item.node, "pid": item.process.pid,
        "procStartTicks": item.start_ticks, "runningBeforeCleanup": running,
        "exitCodeBeforeCleanup": item.process.returncode,
        "executableSha256": sha256_file(Path(item.executable)), "namespaceInode": item.namespace_inode,
    }


def main() -> int:
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--expected-manifest-sha256", required=True)
    parser.add_argument("--expected-harness-sha256", required=True)
    arguments = parser.parse_args()
    if arguments.manifest != str(MANIFEST_PATH):
        refuse("only the exact reviewed R2 manifest is accepted")
    assert_trusted_root_copy()
    manifest = load_manifest(arguments.expected_manifest_sha256, arguments.expected_harness_sha256)
    def request_stop(signum: int, _frame: object) -> None:
        raise base.LabRefusal(f"received signal {signum}; cleanup required")

    previous_handlers = {
        signal.SIGINT: signal.signal(signal.SIGINT, request_stop),
        signal.SIGTERM: signal.signal(signal.SIGTERM, request_stop),
    }
    started = int(time.time()); started_monotonic = time.monotonic(); owned: list[Any] = []; namespaces: list[str] = []
    created_host_links: set[str] = set()
    synchronous: list[dict[str, Any]] = []
    rules_before: str | None = None; failure: str | None = None
    pending_evidence: dict[str, Any] | None = None
    try:
        rules_before = base.preflight(); base.new_run_root()
        ulas = base.keygen_and_addresses(manifest)
        provision_application(ulas, synchronous)
        create_topology_owned(namespaces, created_host_links)
        for node in range(1, 5):
            owned.append(base.start_owned("capture", node, str(PYTHON), [
                "-I", "-S", str(CAPTURE_PATH), "--output", str(RUN_ROOT / f"node-{node}/capture.json"),
                "--comet-marker-hex", "504c45424549414e2d4652494441592d434f4d45542d5452414e53504f52542d5631",
                "--signer-marker-hex", "504c45424549414e2d4652494441592d5349474e45522d5452414e53504f52542d5631",
            ], capability="net_raw"))
            owned.append(base.start_owned("fips", node, base.FIPS, [
                "-c", str(RUN_ROOT / f"node-{node}/fips.yaml"),
                "--log-file", str(RUN_ROOT / f"node-{node}/fips-daemon.log"),
            ], capability="net_admin"))
        base.wait_for_fips([item for item in owned if item.role == "fips"])
        validator_readiness = start_application(owned, ulas)
        before = [base.interface_counters(node) for node in range(1, 5)]
        driver = run_driver(synchronous)
        after = [base.interface_counters(node) for node in range(1, 5)]
        if time.monotonic() - started_monotonic > manifest["limits"]["wall_seconds"]:
            refuse("R2 wall clock bound expired")
        for capture in [item for item in owned if item.role == "capture"]:
            base.stop_owned(capture, 15)
        captures = [base.read_capture(node) for node in range(1, 5)]
        sockets = [base.socket_ownership(node, owned) for node in range(1, 5)]
        counters_advanced = all(
            after[node][field] > before[node][field]
            for node in range(4) for field in ("under0_rx", "under0_tx", "fips0_rx", "fips0_tx")
        )
        if not counters_advanced:
            refuse("underlay and FIPS counters did not all advance")
        pending_evidence = {
            "schema": "COCO_DEMO_FIPS_R2_INTEGRATION_EVIDENCE_V1", "runId": RUN_ID,
            "startedAt": started, "finishedAt": int(time.time()),
            "harnessSha256": arguments.expected_harness_sha256,
            "manifestSha256": arguments.expected_manifest_sha256,
            "reviewedIntegrationCommit": manifest["source_pins"]["reviewed_integration_commit"],
            "binaryPins": manifest["binary_pins"], "dependencyPins": manifest["dependency_pins"],
            "hostRulesetSha256Before": rules_before, "hostRulesetSha256After": "pending-cleanup",
            "operationRoot": driver["operation_root"], "participantIds": driver["participant_ids"],
            "cometTransactionDigest": driver["comet_transaction_digest"],
            "signerRequestDigest": driver["signer_request_digest"],
            "cometPlaintextProbeCommitted": driver["comet_plaintext_probe_committed"],
            "signerPlaintextProbeAuthenticated": driver["signer_plaintext_probe_authenticated"],
            "directUnderlayCometRefused": driver["direct_underlay_comet_refused"],
            "directUnderlaySignerRefused": driver["direct_underlay_signer_refused"],
            "oneSignerUnavailable": driver["one_signer_unavailable"],
            "thresholdSignatureVerified": driver["threshold_signature_verified"],
            "recoveryProcessBoundary": driver["recovery_process_boundary"],
            "fakeMintSettlement": driver["fake_mint_settlement"],
            "recipientImportedAmount": driver["recipient_imported_amount"],
            "nut07Inputs": driver["nut07_inputs"], "nut07Outputs": driver["nut07_outputs"],
            "nut09Outputs": driver["nut09_outputs"],
            "validatorFourReadinessBeforeFault": validator_readiness,
            "processes": [process_record(item) for item in owned if item.role != "capture"],
            "synchronousProcesses": synchronous,
            "nodes": [{
                "node": index + 1, "fipsUla": ulas[index], "underlayAddress": base.UNDERLAY_ADDRESSES[index],
                "underlayRxBytesBefore": before[index]["under0_rx"], "underlayRxBytesAfter": after[index]["under0_rx"],
                "underlayTxBytesBefore": before[index]["under0_tx"], "underlayTxBytesAfter": after[index]["under0_tx"],
                "fipsRxBytesBefore": before[index]["fips0_rx"], "fipsRxBytesAfter": after[index]["fips0_rx"],
                "fipsTxBytesBefore": before[index]["fips0_tx"], "fipsTxBytesAfter": after[index]["fips0_tx"],
                "cometFipsSocketOwned": sockets[index]["comet"], "signerFipsSocketOwned": sockets[index]["signer"],
                "encryptedUdpPackets": value["packets"], "encryptedUdpBytes": value["payload_bytes"],
                "plaintextMarkerMatches": value["plaintext_marker_matches"],
            } for index, value in enumerate(captures)],
            "secretsOrRawPacketsIncluded": False,
        }
    except BaseException as error:
        failure = f"{type(error).__name__}: {error}"
    # A second interactive signal must not interrupt bounded identity-checked
    # cleanup. SIGKILL remains inherently uncatchable and is disclosed.
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    try:
        cleanup_errors = cleanup_owned(owned, namespaces, rules_before, created_host_links)
    except BaseException as cleanup_error:
        cleanup_errors = [f"cleanup controller failed: {type(cleanup_error).__name__}: {cleanup_error}"]
    if cleanup_errors:
        failure = f"{failure + '; ' if failure else ''}cleanup failed: {'; '.join(cleanup_errors)}"
    if failure is None:
        if pending_evidence is None:
            failure = "success evidence was not prepared"
        else:
            pending_evidence["hostRulesetSha256After"] = base.host_ruleset_hash()
            if pending_evidence["hostRulesetSha256Before"] != pending_evidence["hostRulesetSha256After"]:
                failure = "host nftables ruleset changed during or after cleanup"
        if failure is None and pending_evidence is not None:
            pending_evidence["cleanupComplete"] = True
            pending_evidence["finishedAt"] = int(time.time())
            # Success becomes durable only after every owned process,
            # namespace, listener, run root, and host-ruleset cleanup check has
            # completed.  A cleanup failure can therefore never coexist with
            # a success artifact.
            base.write_evidence(EVIDENCE_PATH, pending_evidence)
    if failure is not None:
        try:
            base.write_evidence(FAILURE_PATH, {
                "schema": "PLEBEIAN_FRIDAY_FIPS_LAB_FAILURE_V2", "runId": RUN_ID,
                "startedAt": started, "finishedAt": int(time.time()), "error": failure,
                "cleanupComplete": not cleanup_errors, "cleanupErrors": cleanup_errors,
                "synchronousProcesses": synchronous,
                "secretsOrRawPacketsIncluded": False,
            })
        except FileExistsError:
            pass
        print(f"Friday FIPS R2 lab failed closed: {failure}", file=sys.stderr)
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)
        return 1
    for signum, handler in previous_handlers.items():
        signal.signal(signum, handler)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except base.LabRefusal as error:
        print(f"Friday FIPS R2 lab refused before execution: {error}", file=sys.stderr)
        raise SystemExit(2)
