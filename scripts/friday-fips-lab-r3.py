#!/usr/bin/python3
"""R3 controller: preserve an unrelated host fips0 across the isolated lab.

R3 imports the reviewed R2 controller from the same root-owned staging tree,
then narrows only host-link attribution and run identities.  A lab fips0 is
created and verified inside each named node namespace; an optional host fips0
is never a cleanup target and its stable, non-counter configuration must be
identical before and after a run.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import signal
import stat
import sys
import types
from pathlib import Path
from typing import Any


R2_CONTROLLER_SHA256 = "ed90e2ae32148f20007694bd1f9a13de090d80142b6ead9ac19c8fce7bb57468"
TRUSTED_REPO = Path("/var/lib/plebeian-friday-fips-r3-reviewed")
REPO = Path(__file__).resolve().parent.parent
R2_PATH = REPO / "scripts/friday-fips-lab-r2.py"
SELF_PATH = Path(__file__).resolve()
MANIFEST_PATH = REPO / "FIPS-LOCAL-LAB-R3-EXECUTION.json"
RUN_ID = "friday-fips-lab-20261022-r3"
RUN_ROOT = Path("/tmp/plebeian-friday-fips-lab.20261022-r3")
EVIDENCE_PATH = Path("/tmp/plebeian-friday-fips-lab.20261022-r3-success.json")
FAILURE_PATH = Path("/tmp/plebeian-friday-fips-lab.20261022-r3-failure.json")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _load_r2() -> types.ModuleType:
    descriptor = os.open(R2_PATH, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(descriptor)
        if os.geteuid() == 0 and (metadata.st_uid != 0 or metadata.st_gid != 0 or metadata.st_mode & 0o022):
            raise RuntimeError("R2 controller is mutable or non-root before import")
        source = b""
        while chunk := os.read(descriptor, 1024 * 1024):
            source += chunk
    finally:
        os.close(descriptor)
    if _sha256_bytes(source) != R2_CONTROLLER_SHA256:
        raise RuntimeError("R2 controller differs before safe import")
    name = "plebeian_fips_r2_controller"
    module = types.ModuleType(name)
    module.__file__ = str(R2_PATH)
    sys.modules[name] = module
    exec(compile(source, str(R2_PATH), "exec"), module.__dict__)
    return module


r2 = _load_r2()
base = r2.base

# Replace every run/staging identity before main() can read a manifest, create
# a run root or write evidence.  Application binaries and protocol bindings are
# unchanged from the reviewed R2 source commit.
r2.TRUSTED_REPO = TRUSTED_REPO
r2.REPO = REPO
r2.SELF_PATH = SELF_PATH
r2.MANIFEST_PATH = MANIFEST_PATH
r2.RUN_ID = RUN_ID
r2.RUN_ROOT = RUN_ROOT
r2.EVIDENCE_PATH = EVIDENCE_PATH
r2.FAILURE_PATH = FAILURE_PATH
r2.VALIDATOR = REPO / "lab-bin/plebeian-auctions-poc"
r2.DKG = REPO / "lab-bin/plebeian-friday-frost-dkg"
r2.SIGNER = REPO / "lab-bin/plebeian-friday-signer"
r2.DRIVER = REPO / "lab-bin/plebeian-friday-integrated-driver"
r2.PARTICIPANT = REPO / "lab-bin/coco-demo-frost-participant-3of4"
r2.INSPECTOR = REPO / "lab-bin/coco-demo-frost-public-inspect"
r2.NUTSHELL_SITE = REPO / ".venv/lib/python3.12/site-packages"
base.RUN_ID = RUN_ID
base.RUN_ROOT = RUN_ROOT
base.MARKER_PATH = RUN_ROOT / ".plebeian-friday-fips-lab-owned"
base.EVIDENCE_PATH = EVIDENCE_PATH
base.FAILURE_EVIDENCE_PATH = FAILURE_PATH
base.VALIDATOR = str(r2.VALIDATOR)
base.DKG = str(r2.DKG)
base.SIGNER = str(r2.SIGNER)
base.DRIVER = str(r2.DRIVER)
base.FROST_PARTICIPANT = str(r2.PARTICIPANT)
base.FROST_INSPECTOR = str(r2.INSPECTOR)

_preflight_completed = False
_host_fips0_before: dict[str, Any] | None = None
_host_fips0_after: dict[str, Any] | None = None
_run_root_identity: tuple[int, int] | None = None
_marker_identity: tuple[int, int] | None = None
_created_host_link_identities: dict[str, int] = {}
_created_namespace_identities: dict[str, tuple[int, int]] = {}
_expected_ulas: list[str] = []
_namespace_fips0_evidence: list[dict[str, Any]] = []


def assert_trusted_root_copy_r3() -> None:
    if os.geteuid() != 0:
        return
    if REPO != TRUSTED_REPO or SELF_PATH != TRUSTED_REPO / "scripts/friday-fips-lab-r3.py":
        base.refuse("privileged R3 execution requires the exact root-owned reviewed staging tree")
    paths = (
        TRUSTED_REPO, TRUSTED_REPO / "scripts", TRUSTED_REPO / "lab-bin",
        TRUSTED_REPO / ".venv", TRUSTED_REPO / ".venv/lib",
        TRUSTED_REPO / ".venv/lib/python3.12",
        TRUSTED_REPO / ".venv/lib/python3.12/site-packages",
        SELF_PATH, R2_PATH, MANIFEST_PATH, r2.BASE_PATH, r2.CAPTURE_PATH, r2.MINT_BOOTSTRAP,
    )
    for path in paths:
        metadata = path.stat(follow_symlinks=False)
        if path.is_symlink() or metadata.st_uid != 0 or metadata.st_gid != 0 or metadata.st_mode & 0o022:
            base.refuse(f"reviewed R3 staging path is symlinked, non-root, or writable: {path}")


def exact_keys(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        base.refuse(f"{label} has missing or unexpected fields")
    return value


_VOLATILE_LINK_KEYS = {
    "stats", "stats64", "operstate", "carrier", "carrier_changes",
    "carrier_up_count", "carrier_down_count", "event",
}
_VOLATILE_ADDRESS_KEYS = {"valid_life_time", "preferred_life_time"}
_VOLATILE_FLAGS = {"LOWER_UP", "RUNNING", "DORMANT"}


def _stable_json(value: Any, *, address: bool = False) -> Any:
    """Strip only enumerated runtime state from an iproute2 JSON value."""
    if isinstance(value, list):
        if all(isinstance(item, str) for item in value):
            return sorted(item for item in value if item not in _VOLATILE_FLAGS)
        return [_stable_json(item, address=address) for item in value]
    if isinstance(value, dict):
        volatile = _VOLATILE_LINK_KEYS | (_VOLATILE_ADDRESS_KEYS if address else set())
        return {
            key: _stable_json(item, address=address)
            for key, item in sorted(value.items()) if key not in volatile
        }
    return value


def stable_host_fips0(link_value: Any, address_value: Any) -> dict[str, Any]:
    """Return full selected stable identity/config, excluding enumerated runtime state."""
    if not isinstance(link_value, list) or len(link_value) != 1:
        base.refuse("host fips0 link inventory is malformed")
    if not isinstance(address_value, list) or len(address_value) != 1:
        base.refuse("host fips0 address inventory is malformed")
    link = link_value[0]
    address = address_value[0]
    if not isinstance(link, dict) or link.get("ifname") != "fips0" \
            or not isinstance(address, dict) or address.get("ifname") != "fips0":
        base.refuse("host fips0 inventory identifies another link")
    linkinfo = link.get("linkinfo")
    if not isinstance(linkinfo, dict):
        base.refuse("host fips0 lacks link type metadata")
    addresses = address.get("addr_info")
    if not isinstance(addresses, list):
        base.refuse("host fips0 lacks address metadata")
    if any(not isinstance(entry, dict) for entry in addresses):
        base.refuse("host fips0 address entry is malformed")
    stable_link = _stable_json(link)
    stable_address = _stable_json(address, address=True)
    # Address ordering is not an ownership signal and may vary across iproute2
    # calls.  Preserve every stable field while canonicalizing its ordering.
    stable_address["addr_info"] = sorted(
        stable_address["addr_info"],
        key=lambda item: json.dumps(item, sort_keys=True, separators=(",", ":")),
    )
    value = {"link": stable_link, "address": stable_address}
    # A canonical digest makes success/failure evidence compact without
    # including packet counters, process environment, keys or payload data.
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return {"present": True, "sha256": _sha256_bytes(canonical), "stable": value}


def host_fips0_snapshot() -> dict[str, Any] | None:
    if "fips0" not in r2.host_link_names():
        return None
    link = json.loads(base.run([base.IP, "-d", "-j", "link", "show", "dev", "fips0"]).stdout)
    address = json.loads(base.run([base.IP, "-j", "addr", "show", "dev", "fips0"]).stdout)
    return stable_host_fips0(link, address)


def validate_preflight_inventory(namespaces: set[str], host_links: set[str], listeners: str) -> None:
    conflicts = namespaces.intersection(base.ALL_NAMESPACES)
    if conflicts:
        base.refuse(f"approved namespace names already exist: {sorted(conflicts)}")
    # fips0 is intentionally absent here: the lab creates that name only
    # inside its node namespaces.  Actual transient host names remain strict.
    reserved = set(base.HOST_TEMP_LINKS) | set(base.SWITCH_LINKS) | {"br0", "under0"}
    conflicts = reserved.intersection(host_links)
    if conflicts:
        base.refuse(f"host link name conflicts with the isolated lab: {sorted(conflicts)[0]}")
    for port in (base.UDP_PORT, base.COMET_P2P_PORT, base.COMET_RPC_PORT, base.SIGNER_RPC_PORT, 3338, 3339):
        if re.search(rf":{port}\b", listeners):
            base.refuse(f"host namespace already has a listener on reviewed lab port {port}")


def preflight_r3() -> str:
    global _preflight_completed, _host_fips0_before
    if os.geteuid() != 0 or os.getegid() != 0:
        base.refuse("controller requires a single reviewed root invocation")
    if RUN_ROOT.exists() or RUN_ROOT.is_symlink():
        base.refuse("single approved R3 run root already exists; inspect it instead of retrying")
    if EVIDENCE_PATH.exists() or FAILURE_PATH.exists():
        base.refuse("single-run R3 evidence destination already exists")
    namespaces = base.namespace_names()
    host_links = r2.host_link_names()
    listeners = base.run([base.SS, "-H", "-ltnup"]).stdout.decode()
    validate_preflight_inventory(namespaces, host_links, listeners)
    snapshot = host_fips0_snapshot()
    rules = base.host_ruleset_hash()
    _host_fips0_before = snapshot
    _preflight_completed = True
    return rules


def _identity(metadata: os.stat_result) -> tuple[int, int]:
    return metadata.st_dev, metadata.st_ino


def new_run_root_r3() -> None:
    """Create and positively identify the only run root R3 may later remove."""
    global _run_root_identity, _marker_identity
    prior_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
    root_descriptor: int | None = None
    marker_descriptor: int | None = None
    try:
        os.mkdir(RUN_ROOT, 0o700)
        root_descriptor = os.open(RUN_ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        root_metadata = os.fstat(root_descriptor)
        if not stat.S_ISDIR(root_metadata.st_mode):
            base.refuse("new R3 run root is not a directory")
        _run_root_identity = _identity(root_metadata)
        # Keep the sticky-/tmp entry owned by root so UID 1000 cannot rename
        # or replace the pathname after the identity check. The exact
        # application group may create its bounded outputs beneath this guard;
        # per-node secrets remain in their narrower UID-owned 0700 children.
        os.fchown(root_descriptor, 0, base.GID)
        os.fchmod(root_descriptor, 0o770)
        marker_descriptor = os.open(
            base.MARKER_PATH.name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=root_descriptor,
        )
        os.write(marker_descriptor, (RUN_ID + "\n").encode())
        os.fsync(marker_descriptor)
        os.fchown(marker_descriptor, 0, 0)
        marker_metadata = os.fstat(marker_descriptor)
        if not stat.S_ISREG(marker_metadata.st_mode):
            base.refuse("new R3 ownership marker is not regular")
        _marker_identity = _identity(marker_metadata)
    finally:
        if marker_descriptor is not None:
            os.close(marker_descriptor)
        if root_descriptor is not None:
            os.close(root_descriptor)
        signal.pthread_sigmask(signal.SIG_SETMASK, prior_mask)
    # The sticky /tmp parent plus root ownership prevents the unprivileged
    # application UID from swapping this exact top-level pathname. A partial
    # failure after this point remains attributable by the recorded identities.
    for node in range(1, 5):
        node_root = RUN_ROOT / f"node-{node}"
        node_root.mkdir(mode=0o700)
        (node_root / "runtime").mkdir(mode=0o700)
        os.chown(node_root, base.UID, base.GID)
        os.chown(node_root / "runtime", base.UID, base.GID)


def host_link_identity(name: str) -> int | None:
    value = json.loads(base.run([base.IP, "-d", "-j", "link", "show", "dev", name]).stdout)
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        base.refuse(f"host link identity for {name} is malformed")
    item = value[0]
    if item.get("ifname") != name or not isinstance(item.get("ifindex"), int):
        base.refuse(f"host link identity for {name} names another interface")
    linkinfo = item.get("linkinfo")
    if not isinstance(linkinfo, dict) or linkinfo.get("info_kind") != "veth":
        base.refuse(f"recorded host link {name} is not a veth")
    return item["ifindex"]


def namespace_identity(name: str) -> tuple[int, int]:
    if name not in base.ALL_NAMESPACES:
        base.refuse("namespace identity request is outside the fixed lab names")
    metadata = Path("/var/run/netns", name).stat(follow_symlinks=False)
    return _identity(metadata)


def create_namespace_owned(name: str, created_namespaces: list[str]) -> None:
    prior_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
    try:
        base.run([base.IP, "netns", "add", name])
        _created_namespace_identities[name] = namespace_identity(name)
        created_namespaces.append(name)
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, prior_mask)


def create_topology_r3(created_namespaces: list[str], created_host_links: set[str]) -> None:
    """Create R2 topology while recording exact host-veth ifindices."""
    create_namespace_owned(base.SWITCH_NAMESPACE, created_namespaces)
    base.run([base.IP, "-n", base.SWITCH_NAMESPACE, "link", "add", "br0", "type", "bridge"])
    base.run([base.IP, "-n", base.SWITCH_NAMESPACE, "link", "set", "br0", "up"])
    base.run([base.IP, "-n", base.SWITCH_NAMESPACE, "link", "set", "lo", "up"])
    for node in range(1, 5):
        namespace = base.NODE_NAMESPACES[node - 1]
        host_temp = base.HOST_TEMP_LINKS[node - 1]
        switch_link = base.SWITCH_LINKS[node - 1]
        create_namespace_owned(namespace, created_namespaces)
        prior_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
        try:
            base.run([base.IP, "link", "add", host_temp, "type", "veth", "peer", "name", "under0"])
            # Both exact identities are registered before a handled signal can
            # invoke cleanup. If inspection itself fails, the untracked link is
            # deliberately left for separate inspection rather than guessed.
            _created_host_link_identities[host_temp] = host_link_identity(host_temp)
            _created_host_link_identities["under0"] = host_link_identity("under0")
            created_host_links.update((host_temp, "under0"))
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, prior_mask)
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
            base.refuse(f"node {node} has an unexpected route or lacks its sole connected route")


def keygen_r3(manifest: dict[str, Any]) -> list[str]:
    global _expected_ulas
    _expected_ulas = _original_keygen(manifest)
    return _expected_ulas


def validate_namespace_fips0(node: int, expected_ula: str) -> dict[str, Any]:
    namespace = base.NODE_NAMESPACES[node - 1]
    link = json.loads(base.run([base.IP, "-n", namespace, "-d", "-j", "link", "show", "dev", "fips0"]).stdout)
    address = json.loads(base.run([base.IP, "-n", namespace, "-j", "addr", "show", "dev", "fips0"]).stdout)
    if not isinstance(link, list) or len(link) != 1 or not isinstance(link[0], dict):
        base.refuse(f"node {node} fips0 link inventory is malformed")
    linkinfo = link[0].get("linkinfo")
    info_data = linkinfo.get("info_data") if isinstance(linkinfo, dict) else None
    if link[0].get("ifname") != "fips0" or not isinstance(link[0].get("ifindex"), int) \
            or not isinstance(linkinfo, dict) or linkinfo.get("info_kind") != "tun" \
            or not isinstance(info_data, dict) or info_data.get("type") != "tun":
        base.refuse(f"node {node} fips0 is not the expected TUN interface")
    if not isinstance(address, list) or len(address) != 1 or not isinstance(address[0], dict):
        base.refuse(f"node {node} fips0 address inventory is malformed")
    entries = address[0].get("addr_info")
    if not isinstance(entries, list) or any(not isinstance(entry, dict) for entry in entries):
        base.refuse(f"node {node} fips0 address entries are malformed")
    non_link_local = [entry for entry in entries if entry.get("scope") != "link"]
    expected_entry = {
        "family": "inet6", "local": expected_ula.lower(), "prefixlen": 128,
    }
    if len(non_link_local) != 1 or any(
        non_link_local[0].get(key) != value for key, value in expected_entry.items()
    ):
        base.refuse(f"node {node} fips0 does not own exactly its derived /128 ULA")
    namespace_dev, namespace_ino = namespace_identity(namespace)
    metadata = {
        "link": _stable_json(link[0]),
        "address": _stable_json(address[0], address=True),
    }
    value = {
        "node": node, "namespace": namespace, "ifname": "fips0", "kind": "tun",
        "ifindex": link[0]["ifindex"],
        "namespaceIdentity": f"{namespace_dev}:{namespace_ino}",
        "derivedUlaSha256": _sha256_bytes(expected_ula.lower().encode()),
        "linkMetadataSha256": _sha256_bytes(json.dumps(metadata, sort_keys=True, separators=(",", ":")).encode()),
    }
    return {**value, "sha256": _sha256_bytes(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())}


def wait_for_fips_r3(processes: list[Any]) -> None:
    global _namespace_fips0_evidence
    _original_wait_for_fips(processes)
    if len(_expected_ulas) != 4:
        base.refuse("R3 expected ULA binding was not retained")
    _namespace_fips0_evidence = [
        validate_namespace_fips0(node, _expected_ulas[node - 1]) for node in range(1, 5)
    ]


def classify_postflight_host_links(created_host_links: set[str], present: set[str]) -> list[str]:
    tracked_remaining = created_host_links.intersection(present)
    if tracked_remaining:
        return [f"recorded lab host links remain: {sorted(tracked_remaining)}"]
    reserved = set(base.HOST_TEMP_LINKS) | set(base.SWITCH_LINKS) | {"br0", "under0"}
    remaining = reserved.intersection(present)
    if remaining:
        return [f"fixed lab host links remain after completed preflight: {sorted(remaining)}"]
    return []


def cleanup_without_run_root(
    owned: list[Any], created_namespaces: list[str], rules_before: str | None,
) -> list[str]:
    """R2 bounded cleanup, deliberately excluding its path-based rmtree."""
    errors: list[str] = []
    for process in reversed(owned):
        try:
            base.stop_owned(process, 15)
        except Exception as error:
            errors.append(f"stop {process.role}/n{process.node}/pid{process.process.pid}: {error}")
    for namespace in reversed(created_namespaces):
        try:
            if namespace in base.namespace_names():
                expected_identity = _created_namespace_identities.get(namespace)
                current_identity = namespace_identity(namespace)
                if expected_identity is None or current_identity != expected_identity:
                    errors.append(f"recorded namespace {namespace} identity changed; refusing deletion")
                    continue
                remaining = base.run([base.IP, "netns", "pids", namespace]).stdout.decode().split()
                if remaining:
                    errors.append(f"namespace {namespace} still has PIDs {remaining}")
                    continue
                base.run([base.IP, "netns", "delete", namespace])
        except Exception as error:
            errors.append(f"delete namespace {namespace}: {error}")
    try:
        conflicts = base.namespace_names().intersection(base.ALL_NAMESPACES)
        if conflicts:
            errors.append(f"namespaces remain: {sorted(conflicts)}")
    except Exception as error:
        errors.append(f"postflight namespace inventory: {error}")
    try:
        if rules_before is not None and base.host_ruleset_hash() != rules_before:
            errors.append("host nftables ruleset hash changed")
    except Exception as error:
        errors.append(f"postflight host ruleset hash: {error}")
    try:
        listeners = base.run([base.SS, "-H", "-ltnup"]).stdout.decode()
        if any(re.search(rf":{port}\b", listeners) for port in (
            base.UDP_PORT, base.COMET_P2P_PORT, base.COMET_RPC_PORT,
            base.SIGNER_RPC_PORT, 3338, 3339,
        )):
            errors.append("a reviewed lab port remains listening in the host namespace")
    except Exception as error:
        errors.append(f"postflight listener inventory: {error}")
    return errors


def run_root_guard_error(root_metadata: os.stat_result, marker_metadata: os.stat_result) -> str | None:
    if root_metadata.st_uid != 0 or root_metadata.st_gid != base.GID \
            or stat.S_IMODE(root_metadata.st_mode) != 0o770:
        return "run root ownership/mode changed; refusing automatic deletion"
    if marker_metadata.st_uid != 0 or marker_metadata.st_gid != 0 \
            or stat.S_IMODE(marker_metadata.st_mode) != 0o600:
        return "run root marker ownership/mode changed; refusing automatic deletion"
    return None


def remove_owned_run_root() -> list[str]:
    """Remove only the exact root+marker inodes successfully registered by R3."""
    errors: list[str] = []
    if not RUN_ROOT.exists() and not RUN_ROOT.is_symlink():
        return errors
    if _run_root_identity is None or _marker_identity is None:
        return ["run root exists without complete recorded identity; refusing automatic deletion"]
    try:
        root_metadata = RUN_ROOT.lstat()
        marker_metadata = base.MARKER_PATH.lstat()
        if not stat.S_ISDIR(root_metadata.st_mode) or _identity(root_metadata) != _run_root_identity:
            return ["run root identity changed; refusing automatic deletion"]
        if not stat.S_ISREG(marker_metadata.st_mode) or _identity(marker_metadata) != _marker_identity:
            return ["run root marker identity changed; refusing automatic deletion"]
        guard_error = run_root_guard_error(root_metadata, marker_metadata)
        if guard_error is not None:
            return [guard_error]
        descriptor = os.open(base.MARKER_PATH, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            content = os.read(descriptor, len(RUN_ID) + 2)
            if os.fstat(descriptor).st_dev != marker_metadata.st_dev or os.fstat(descriptor).st_ino != marker_metadata.st_ino:
                return ["run root marker changed during verification; refusing automatic deletion"]
        finally:
            os.close(descriptor)
        if content != (RUN_ID + "\n").encode():
            return ["run root marker content invalid; refusing automatic deletion"]
        if any(namespace in base.namespace_names() for namespace in base.ALL_NAMESPACES):
            return ["namespace remains; refusing run-root deletion"]
        shutil.rmtree(RUN_ROOT)
    except Exception as error:
        errors.append(f"remove exact identity-bound run root: {error}")
    if RUN_ROOT.exists() or RUN_ROOT.is_symlink():
        errors.append(f"run root remains: {RUN_ROOT}")
    return errors


def cleanup_owned_r3(
    owned: list[Any], created_namespaces: list[str], rules_before: str | None,
    created_host_links: set[str],
) -> list[str]:
    global _host_fips0_after
    # A refusal before preflight completed cannot own a process, namespace,
    # link or run root.  Do not delete or relabel unrelated existing objects.
    if not _preflight_completed:
        if owned or created_namespaces or created_host_links or _run_root_identity is not None:
            return ["preflight did not complete but lab-owned state was recorded; refusing automatic cleanup"]
        return []
    errors = cleanup_without_run_root(owned, created_namespaces, rules_before)
    try:
        present = r2.host_link_names()
    except Exception as error:
        errors.append(f"pre-delete host-link inventory: {error}")
        present = set()
    for name in sorted(created_host_links.intersection(present)):
        try:
            expected_ifindex = _created_host_link_identities.get(name)
            current_ifindex = host_link_identity(name)
            if expected_ifindex is None or current_ifindex != expected_ifindex:
                errors.append(f"recorded host veth {name} identity changed; refusing deletion")
                continue
            base.run([base.IP, "link", "delete", name])
        except Exception as error:
            errors.append(f"delete recorded host veth {name}: {error}")
    try:
        errors.extend(classify_postflight_host_links(created_host_links, r2.host_link_names()))
    except Exception as error:
        errors.append(f"postflight host-link inventory: {error}")
    try:
        _host_fips0_after = host_fips0_snapshot()
        if _host_fips0_after != _host_fips0_before:
            errors.append("preexisting host fips0 stable identity/configuration changed")
    except Exception as error:
        errors.append(f"postflight host fips0 identity/configuration: {error}")
    errors.extend(remove_owned_run_root())
    return errors


_original_write_evidence = base.write_evidence


def write_evidence_r3(path: Path, value: dict[str, Any]) -> None:
    enriched = dict(value)
    if enriched.get("schema") == "COCO_DEMO_FIPS_R2_INTEGRATION_EVIDENCE_V1":
        enriched["schema"] = "COCO_DEMO_FIPS_R3_INTEGRATION_EVIDENCE_V1"
    elif enriched.get("schema") == "PLEBEIAN_FRIDAY_FIPS_LAB_FAILURE_V2":
        enriched["schema"] = "PLEBEIAN_FRIDAY_FIPS_LAB_FAILURE_V3"
    enriched["r2ControllerSha256"] = R2_CONTROLLER_SHA256
    enriched["hostFips0Before"] = _host_fips0_before
    enriched["hostFips0After"] = _host_fips0_after
    enriched["namespaceFips0Bindings"] = _namespace_fips0_evidence
    _original_write_evidence(path, enriched)


_original_keygen = base.keygen_and_addresses
_original_wait_for_fips = base.wait_for_fips
base.preflight = preflight_r3
base.new_run_root = new_run_root_r3
base.keygen_and_addresses = keygen_r3
base.wait_for_fips = wait_for_fips_r3
base.write_evidence = write_evidence_r3
r2.assert_trusted_root_copy = assert_trusted_root_copy_r3
r2.create_topology_owned = create_topology_r3
r2.cleanup_owned = cleanup_owned_r3


if __name__ == "__main__":
    raise SystemExit(r2.main())
