#!/usr/bin/python3
"""Reject accidental Friday startup against any Wednesday deployment path.

This verifier reads public configuration only. It does not source the
environment file, inspect credentials, create state, or contact a service.
"""

from __future__ import annotations

import argparse
import json
import os
import pwd
import re
import stat
from pathlib import Path


ENVIRONMENT = Path("/etc/plebeian-auctions-friday/friday.env")
APPLICATION = Path("/etc/plebeian-auctions-friday/application.json")
CONFIG_ROOT = Path("/etc/plebeian-auctions-friday")
CODE_ROOT = Path("/opt/plebeian-auctions-friday")
R20_RELEASE_ROOT = CODE_ROOT / "releases/r20-deploy-v1"
STATE_ROOT = Path("/var/lib/plebeian-auctions-friday")
ANCHOR_ROOT = Path("/var/lib/plebeian-auctions-friday-anchor")
R20_SIGNER_DROPIN = Path("/etc/systemd/system/plebeian-friday-signer.service.d/20-r20-state.conf")
R20_ANCHOR_ROOT = Path("/var/lib/plebeian-auctions-friday-anchor-r20")
ALLOWED_SERVICES = {
    "plebeian-friday-authority.service",
    "plebeian-friday-coordinator.service",
    "plebeian-friday-fips.service",
    "plebeian-friday-mint.service",
    "plebeian-friday-signer.service",
    "plebeian-friday-site.service",
    "plebeian-friday-validator.service",
}
SERVICE_EXECUTABLES = {
    "plebeian-friday-authority.service": "/opt/plebeian-auctions-friday/bin/plebeian-friday-authority",
    "plebeian-friday-coordinator.service": "/opt/plebeian-auctions-friday/bin/plebeian-friday-coordinator",
    "plebeian-friday-fips.service": "/opt/plebeian-auctions-friday/bin/fips",
    "plebeian-friday-mint.service": "/opt/plebeian-auctions-friday/.venv/bin/python",
    "plebeian-friday-signer.service": "/opt/plebeian-auctions-friday/bin/plebeian-friday-signer",
    "plebeian-friday-site.service": "/opt/plebeian-auctions-friday/bin/plebeian-auctions-poc",
    "plebeian-friday-validator.service": "/opt/plebeian-auctions-friday/bin/plebeian-auctions-poc",
}
R20_SERVICE_EXECUTABLES = {
    "plebeian-friday-authority.service": str(R20_RELEASE_ROOT / "bin/plebeian-friday-authority"),
    "plebeian-friday-coordinator.service": str(R20_RELEASE_ROOT / "bin/plebeian-friday-coordinator"),
    "plebeian-friday-fips.service": str(R20_RELEASE_ROOT / "bin/fips"),
    # The Python environment is an external activation gate, never resolved here.
    "plebeian-friday-mint.service": "/opt/plebeian-auctions-friday/.venv/bin/python",
    "plebeian-friday-signer.service": str(R20_RELEASE_ROOT / "bin/plebeian-friday-signer"),
    "plebeian-friday-site.service": str(R20_RELEASE_ROOT / "bin/plebeian-auctions-poc"),
    "plebeian-friday-validator.service": str(R20_RELEASE_ROOT / "bin/plebeian-auctions-poc"),
}
EXPECTED_ENVIRONMENT_PATHS = {
    "FRIDAY_NETWORK_ROOT": "/var/lib/plebeian-auctions-friday/network",
    "FRIDAY_APPLICATION": str(APPLICATION),
    "FRIDAY_DKG_RESULT": "/var/lib/plebeian-auctions-friday/frost/public/dkg-result.json",
    "FRIDAY_NETWORK_FACTS": "/var/lib/plebeian-auctions-friday/network/network-facts.json",
    "FRIDAY_PARTICIPANT_BIN": "/opt/plebeian-auctions-friday/bin/coco-demo-frost-participant-3of4",
    "FRIDAY_COORDINATOR_DB": "/var/lib/plebeian-auctions-friday/coordinator/operations.sqlite3",
    "FRIDAY_COORDINATOR_ANCHOR_DB": "/var/lib/plebeian-auctions-friday-anchor/coordinator.sqlite3",
    "FRIDAY_FUNDING_ABORT_ANCHOR_DB": "/var/lib/plebeian-auctions-friday-anchor/funding-abort.sqlite3",
    "FRIDAY_TERMINAL_EXECUTOR_BIN": "/opt/plebeian-auctions-friday/bin/plebeian-friday-terminal-executor",
    "FRIDAY_FIPS_CONFIG": "/var/lib/plebeian-auctions-friday/fips/identity/fips.yaml",
    "FRIDAY_FIPS_IDENTITY_KEY": "/var/lib/plebeian-auctions-friday/fips/identity/fips.key",
}
R20_ENVIRONMENT_PATHS = {
    **EXPECTED_ENVIRONMENT_PATHS,
    "FRIDAY_NETWORK_ROOT": "/var/lib/plebeian-auctions-friday/network-r20",
    "FRIDAY_NETWORK_FACTS": "/var/lib/plebeian-auctions-friday/network-r20/network-facts.json",
    "FRIDAY_DKG_RESULT": "/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2/runtime-binding.json",
    "FRIDAY_COORDINATOR_DB": "/var/lib/plebeian-auctions-friday/coordinator-v2/operations.sqlite3",
    "FRIDAY_COORDINATOR_ANCHOR_DB": "/var/lib/plebeian-auctions-friday-anchor-r20/coordinator.sqlite3",
    "FRIDAY_FUNDING_ABORT_ANCHOR_DB": "/var/lib/plebeian-auctions-friday-anchor-r20/funding-abort.sqlite3",
    "FRIDAY_PARTICIPANT_BIN": str(R20_RELEASE_ROOT / "bin/coco-demo-frost-participant-3of4"),
    "FRIDAY_TERMINAL_EXECUTOR_BIN": str(R20_RELEASE_ROOT / "bin/plebeian-friday-terminal-executor"),
    "FRIDAY_R20_PROFILE": "/var/lib/plebeian-auctions-friday/frost-v2/r20-inputs/fresh-profile.json",
    "FRIDAY_R20_PREDECESSOR_MANIFEST": "/var/lib/plebeian-auctions-friday/frost-v2/r20-inputs/predecessor-manifest.json",
    "FRIDAY_R20_MANIFEST": "/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2/manifest.json",
    "FRIDAY_R20_MANIFEST_DIGEST": "/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2/owner-approved-manifest-digest.txt",
    "FRIDAY_R20_BOUND_MANIFEST": "/var/lib/plebeian-auctions-friday/frost-v2/r20-inputs/bound-manifest.json",
}
EXPECTED_ENVIRONMENT_NAMES = set(EXPECTED_ENVIRONMENT_PATHS) | {
    "FRIDAY_SLOT",
    "FRIDAY_DKG_MANIFEST_DIGEST",
    "FRIDAY_FIPS_UNDERLAY_IPV4",
    "FRIDAY_FIPS_ULA",
    "FRIDAY_P2P_PORT",
    "FRIDAY_RPC_PORT",
    "FRIDAY_SIGNER_PORT",
    "FRIDAY_MINT_PORT",
    "FRIDAY_SITE_PORT",
    "POC_FRIDAY_BROWSER_READY",
    "POC_FRIDAY_RECOVERY_ONLY",
}
R20_ENVIRONMENT_NAMES = set(R20_ENVIRONMENT_PATHS) | {
    "FRIDAY_SLOT",
    "FRIDAY_DKG_MANIFEST_DIGEST",
    "FRIDAY_R20_MANIFEST_BINDING_DIGEST",
    "FRIDAY_R20_RUNTIME_BINDING_DIGEST",
    "FRIDAY_FIPS_UNDERLAY_IPV4",
    "FRIDAY_FIPS_ULA",
    "FRIDAY_P2P_PORT",
    "FRIDAY_RPC_PORT",
    "FRIDAY_SIGNER_PORT",
    "FRIDAY_MINT_PORT",
    "FRIDAY_SITE_PORT",
    "POC_FRIDAY_BROWSER_READY",
    "POC_FRIDAY_BROWSER_PINS_SHA256",
    "POC_FRIDAY_HEALTH_PINS_SHA256",
    "POC_FRIDAY_RECOVERY_ONLY",
    "POC_FRIDAY_R20_CLOSE_TRIGGER",
}
EXPECTED_APPLICATION_PATHS = {
    "network_root": "/var/lib/plebeian-auctions-friday/network",
    "dkg_root": "/var/lib/plebeian-auctions-friday/frost/keyset-v1",
    "coordinator_root": "/var/lib/plebeian-auctions-friday/coordinator",
    "coordinator_rpc_identity_path": "/var/lib/plebeian-auctions-friday/coordinator/coordinator-rpc-identity.key",
}
R20_APPLICATION_PATHS = {
    "network_root": "/var/lib/plebeian-auctions-friday/network-r20",
    "dkg_root": "/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2",
    "coordinator_root": "/var/lib/plebeian-auctions-friday/coordinator-v2",
    "coordinator_rpc_identity_path": "/var/lib/plebeian-auctions-friday/coordinator-v2/coordinator-rpc-identity.key",
}
EXPECTED_APPLICATION_NAMES = set(EXPECTED_APPLICATION_PATHS) | {
    "schema",
    "deployment_id",
    "run_id",
    "application_host_slot",
    "fips_ulas",
    "comet_p2p_port",
    "comet_rpc_port",
    "signer_rpc_port",
    "mint_port",
    "cashu_mint_url",
    "site_port",
}
FORBIDDEN_WEDNESDAY_PATHS = (
    "/opt/plebeian-auctions-poc",
    "/etc/plebeian-auctions-poc",
    "/var/lib/plebeian-auctions-poc",
)
ENVIRONMENT_NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")


def _path_metadata(path: Path, label: str) -> list[tuple[Path, os.stat_result]]:
    """Return an lstat-only absolute chain, rejecting every symlink component."""
    if not path.is_absolute():
        raise ValueError(f"{label} is not absolute")
    current = Path(path.anchor)
    chain: list[tuple[Path, os.stat_result]] = []
    for component in path.parts[1:]:
        current = current / component
        try:
            metadata = current.lstat()
        except FileNotFoundError as exc:
            raise ValueError(f"{label} is absent at {current}") from exc
        if stat.S_ISLNK(metadata.st_mode):
            raise ValueError(f"{label} has a symlink component: {current}")
        if current != path and not stat.S_ISDIR(metadata.st_mode):
            raise ValueError(f"{label} has a non-directory parent: {current}")
        chain.append((current, metadata))
    if not chain or chain[-1][0] != path:
        raise ValueError(f"{label} has no canonical path chain")
    return chain


def _managed_path(
    path: Path,
    label: str,
    managed_root: Path,
    allowed_uids: set[int],
    leaf_kind: str,
) -> None:
    """Verify a canonical, non-writable path rooted in one reviewed tree."""
    try:
        path.relative_to(managed_root)
    except ValueError as exc:
        raise ValueError(f"{label} escapes its reviewed Friday root") from exc
    chain = _path_metadata(path, label)
    managed = False
    for component, metadata in chain:
        if component == managed_root:
            managed = True
        if managed:
            if metadata.st_uid not in allowed_uids:
                raise ValueError(f"{label} has an unapproved owner at {component}")
            if stat.S_IMODE(metadata.st_mode) & 0o022:
                raise ValueError(f"{label} is group/world writable at {component}")
    if not managed:
        raise ValueError(f"{label} does not traverse its reviewed Friday root")
    final_mode = chain[-1][1].st_mode
    if leaf_kind == "file" and not stat.S_ISREG(final_mode):
        raise ValueError(f"{label} is not a regular file")
    if leaf_kind == "directory" and not stat.S_ISDIR(final_mode):
        raise ValueError(f"{label} is not a directory")


def _service_uid() -> int:
    try:
        return pwd.getpwnam("plebeian-friday").pw_uid
    except KeyError as exc:
        # The installed units must never guess another account. The fallback
        # exists solely so the uninstalled template can be exercised by its
        # ordinary unprivileged regression test.
        if os.geteuid() != 0:
            return os.geteuid()
        raise ValueError("plebeian-friday service account is absent") from exc


def _verify_fixed_code_and_config() -> None:
    _managed_path(ENVIRONMENT, "Friday environment", CONFIG_ROOT, {0}, "file")
    _managed_path(APPLICATION, "Friday application manifest", CONFIG_ROOT, {0}, "file")
    # Keep the actual invocation path: resolving it first would hide a
    # forbidden `current`/symlink release selector from _managed_path().
    verifier = Path(__file__)
    if verifier not in {
        CODE_ROOT / "bin/verify-friday-runtime-target.py",
        R20_RELEASE_ROOT / "bin/verify-friday-runtime-target.py",
    }:
        raise ValueError("Friday runtime verifier is not installed at a reviewed release path")
    _managed_path(
        verifier,
        "Friday runtime verifier",
        CODE_ROOT,
        {0},
        "file",
    )


def _required_service_paths(
    values: dict[str, str], application: dict[str, object], service: str,
) -> list[tuple[str, str]]:
    """Return only this unit's stage-appropriate immutable prerequisites."""
    r20 = application["schema"] == "PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3"
    executable_map = R20_SERVICE_EXECUTABLES if r20 else SERVICE_EXECUTABLES
    required: list[tuple[str, str]] = [(executable_map[service], "file")]
    if service == "plebeian-friday-fips.service":
        required.extend([
            (values["FRIDAY_FIPS_CONFIG"], "file"),
            (values["FRIDAY_FIPS_IDENTITY_KEY"], "file"),
            (str(R20_RELEASE_ROOT / "bin/verify-friday-fips-identity.py") if r20
             else "/opt/plebeian-auctions-friday/bin/verify-friday-fips-identity.py", "file"),
        ])
    elif service == "plebeian-friday-validator.service":
        required.append((values["FRIDAY_NETWORK_ROOT"], "directory"))
    elif service == "plebeian-friday-signer.service":
        required.extend([
            (values["FRIDAY_NETWORK_ROOT"], "directory"),
            (values["FRIDAY_DKG_RESULT"], "file"),
            (values["FRIDAY_NETWORK_FACTS"], "file"),
            (values["FRIDAY_PARTICIPANT_BIN"], "file"),
            (str(application["dkg_root"]), "directory"),
        ])
        if r20:
            required.append((r20_signer_node_root(application, values["FRIDAY_SLOT"]), "directory"))
            required.extend([
                (values["FRIDAY_R20_PROFILE"], "file"),
                (values["FRIDAY_R20_PREDECESSOR_MANIFEST"], "file"),
                (values["FRIDAY_R20_MANIFEST"], "file"),
                (values["FRIDAY_R20_MANIFEST_DIGEST"], "file"),
                (values["FRIDAY_R20_BOUND_MANIFEST"], "file"),
            ])
    elif service == "plebeian-friday-mint.service":
        required.extend([
            ("/etc/plebeian-auctions-friday/mint.env", "file"),
            ("/var/lib/plebeian-auctions-friday/mint", "directory"),
        ])
    elif service == "plebeian-friday-coordinator.service":
        required.extend([
            (str(application["coordinator_root"]), "directory"),
            (str(application["coordinator_rpc_identity_path"]), "file"),
            (values["FRIDAY_COORDINATOR_DB"], "file"),
            (values["FRIDAY_COORDINATOR_ANCHOR_DB"], "file"),
            (values["FRIDAY_TERMINAL_EXECUTOR_BIN"], "file"),
        ])
    elif service == "plebeian-friday-authority.service":
        anchor_root = (
            "/var/lib/plebeian-auctions-friday-anchor-r20"
            if application["schema"] == "PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3"
            else "/var/lib/plebeian-auctions-friday-anchor"
        )
        required.extend([
            (str(application["coordinator_root"]), "directory"),
            (str(application["coordinator_rpc_identity_path"]), "file"),
            (values["FRIDAY_COORDINATOR_DB"], "file"),
            (values["FRIDAY_COORDINATOR_ANCHOR_DB"], "file"),
            (values["FRIDAY_FUNDING_ABORT_ANCHOR_DB"], "file"),
            (f"{anchor_root}/funding-replay.sqlite3", "file"),
            (f"{anchor_root}/funding-broadcast.sqlite3", "file"),
            (f"{anchor_root}/seller-plan.sqlite3", "file"),
        ])
    elif service == "plebeian-friday-site.service":
        required.append((values["FRIDAY_NETWORK_ROOT"], "directory"))
        if r20:
            required.append(("/etc/plebeian-auctions-friday/browser-r20-pins.json", "file"))
    else:
        raise ValueError("runtime verifier has no reviewed dependency stage for this service")
    return required


def _verify_installed_path_boundaries(
    values: dict[str, str], application: dict[str, object], service: str,
) -> None:
    service_uid = _service_uid()
    for raw_path, leaf_kind in _required_service_paths(values, application, service):
        path = Path(raw_path)
        if path == CONFIG_ROOT or CONFIG_ROOT in path.parents:
            _managed_path(path, f"Friday config path {path}", CONFIG_ROOT, {0}, leaf_kind)
        elif path == CODE_ROOT or CODE_ROOT in path.parents:
            _managed_path(path, f"Friday code path {path}", CODE_ROOT, {0}, leaf_kind)
        elif path == STATE_ROOT or STATE_ROOT in path.parents:
            _managed_path(path, f"Friday state path {path}", STATE_ROOT, {0, service_uid}, leaf_kind)
        elif path == ANCHOR_ROOT or ANCHOR_ROOT in path.parents:
            _managed_path(path, f"Friday anchor path {path}", ANCHOR_ROOT, {0, service_uid}, leaf_kind)
        elif path == R20_ANCHOR_ROOT or R20_ANCHOR_ROOT in path.parents:
            _managed_path(path, f"Friday R20 anchor path {path}", R20_ANCHOR_ROOT, {0, service_uid}, leaf_kind)
        else:
            raise ValueError(f"Friday managed path is outside every reviewed root: {path}")


def _read_environment(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"environment line {line_number} is not KEY=VALUE")
        name, value = line.split("=", 1)
        if not ENVIRONMENT_NAME.fullmatch(name) or name in values or not value or value != value.strip():
            raise ValueError(f"environment line {line_number} is noncanonical")
        if any(character in value for character in "'\"`$\\"):
            raise ValueError(f"environment line {line_number} contains shell syntax")
        values[name] = value
    return values


def _reject_wednesday(value: object) -> None:
    if isinstance(value, str):
        if any(forbidden in value for forbidden in FORBIDDEN_WEDNESDAY_PATHS) or "plebeian-poc-validator@" in value:
            raise ValueError("Friday configuration references a Wednesday path or unit")
    elif isinstance(value, list):
        for item in value:
            _reject_wednesday(item)
    elif isinstance(value, dict):
        for key, item in value.items():
            _reject_wednesday(key)
            _reject_wednesday(item)


def verify_environment_values(values: dict[str, str]) -> None:
    _reject_wednesday(values)
    r20 = "FRIDAY_R20_RUNTIME_BINDING_DIGEST" in values
    expected_names = R20_ENVIRONMENT_NAMES if r20 else EXPECTED_ENVIRONMENT_NAMES
    expected_paths = R20_ENVIRONMENT_PATHS if r20 else EXPECTED_ENVIRONMENT_PATHS
    if set(values) != expected_names:
        raise ValueError("Friday environment keys are not the exact reviewed set")
    for name, expected in expected_paths.items():
        if values.get(name) != expected:
            raise ValueError(f"{name} does not name the exact Friday target")
    if not re.fullmatch(r"[0-9a-f]{64}", values["FRIDAY_DKG_MANIFEST_DIGEST"]):
        raise ValueError("FRIDAY_DKG_MANIFEST_DIGEST is not an exact lowercase SHA-256 pin")
    if r20:
        for name in ("FRIDAY_R20_MANIFEST_BINDING_DIGEST", "FRIDAY_R20_RUNTIME_BINDING_DIGEST",
                     "POC_FRIDAY_BROWSER_PINS_SHA256", "POC_FRIDAY_HEALTH_PINS_SHA256"):
            if not re.fullmatch(r"[0-9a-f]{64}", values[name]):
                raise ValueError(f"{name} is not an exact lowercase SHA-256 pin")
        if values["POC_FRIDAY_R20_CLOSE_TRIGGER"] not in {"true", "false"}:
            raise ValueError("POC_FRIDAY_R20_CLOSE_TRIGGER must be exactly true or false")


def verify_application_values(application: object) -> None:
    if not isinstance(application, dict) or application.get("schema") not in {
        "PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2", "PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3",
    }:
        raise ValueError("Friday application schema is not exact")
    if set(application) != EXPECTED_APPLICATION_NAMES:
        raise ValueError("Friday application keys are not the exact reviewed set")
    _reject_wednesday(application)
    r20 = application["schema"] == "PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3"
    paths = R20_APPLICATION_PATHS if r20 else EXPECTED_APPLICATION_PATHS
    for name, expected in paths.items():
        if application.get(name) != expected:
            raise ValueError(f"application {name} does not name the exact Friday target")
    if r20 and (
        application.get("deployment_id") != "friday-demo-20261023-r20"
        or application.get("run_id") != "friday-demo-20261023-r20-run1"
    ):
        raise ValueError("R20 application identity is not exact")


def verify_environment_application_pairing(
    values: dict[str, str], application: dict[str, object],
) -> None:
    """Reject cross-generation environment/application composition.

    LIVE_APPLICATION_V3 is the only reviewed live application configuration
    for the R20 keyset-v2 / NetworkV4 / frost_cashu_v4 deployment.  Conversely,
    the legacy environment is retained solely for LIVE_APPLICATION_V2.  The
    individual validators above deliberately remain useful in isolation, so
    this explicit composition boundary must run before any service-specific
    path is accepted.
    """
    environment_is_r20 = set(values) == R20_ENVIRONMENT_NAMES
    application_is_r20 = application.get("schema") == "PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3"
    if environment_is_r20 != application_is_r20:
        raise ValueError("Friday environment and application generations differ")
    if environment_is_r20:
        for name in (
            "FRIDAY_R20_PROFILE",
            "FRIDAY_R20_PREDECESSOR_MANIFEST",
            "FRIDAY_R20_MANIFEST",
            "FRIDAY_R20_MANIFEST_DIGEST",
            "FRIDAY_R20_BOUND_MANIFEST",
        ):
            if values.get(name) != R20_ENVIRONMENT_PATHS[name]:
                raise ValueError(f"{name} does not name the exact R20 profile target")



def r20_signer_node_root(application: object, slot: object) -> str:
    """Closed V3 path contract, reused by offline renderer and startup guard."""
    verify_application_values(application)
    if application["schema"] != "PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3":
        raise ValueError("R20 signer state requires the exact V3 application")
    if type(slot) is not str or slot not in {"1", "2", "3", "4"}:
        raise ValueError("R20 signer slot must be exactly 1..4")
    for name, expected in {"comet_p2p_port": 27656, "comet_rpc_port": 27657,
                           "signer_rpc_port": 39101, "mint_port": 3438, "site_port": 8180}.items():
        if type(application[name]) is not int or application[name] != expected:
            raise ValueError("R20 application ports differ from the exact topology")
    return f"/var/lib/plebeian-auctions-friday/r20/node-{slot}"


def render_r20_signer_state_dropin(application: object, slot: object) -> str:
    node = r20_signer_node_root(application, slot)
    return ("# Exact R20 signer state confinement; generated for one slot.\n"
            "[Service]\nReadWritePaths=\n"
            f"ReadWritePaths={application['dkg_root']} {node}\n")


def verify_r20_signer_dropin_text(text: str, application: object, slot: object) -> None:
    if text != render_r20_signer_state_dropin(application, slot):
        raise ValueError("R20 signer state drop-in differs from exact application/slot")


def _verify_r20_signer_state(values: dict[str, str], application: dict[str, object]) -> None:
    node = Path(r20_signer_node_root(application, values["FRIDAY_SLOT"]))
    _managed_path(node, "R20 signer auxiliary root", STATE_ROOT, {0, _service_uid()}, "directory")
    if node.lstat().st_uid != _service_uid() or stat.S_IMODE(node.lstat().st_mode) != 0o700:
        raise ValueError("R20 signer auxiliary root must be service-owned 0700")
    # This exact public systemd file alone is admitted here, not a general
    # new managed-root exception. Parent paths and the file must be root-owned.
    _managed_path(R20_SIGNER_DROPIN, "R20 signer state drop-in",
                  Path("/etc/systemd/system"), {0}, "file")
    if stat.S_IMODE(R20_SIGNER_DROPIN.lstat().st_mode) != 0o644:
        raise ValueError("R20 signer state drop-in must be root-owned 0644")
    verify_r20_signer_dropin_text(R20_SIGNER_DROPIN.read_text(encoding="utf-8"),
                                 application, values["FRIDAY_SLOT"])


def verify(environment: Path, application: Path, service: str) -> None:
    if environment != ENVIRONMENT or application != APPLICATION:
        raise ValueError("runtime verifier accepts only the exact Friday config paths")
    if service not in ALLOWED_SERVICES:
        raise ValueError("runtime verifier refuses a non-Friday service")
    # Establish immutable ownership and a non-symlink parent chain before
    # reading even public configuration bytes.
    _verify_fixed_code_and_config()
    environment_values = _read_environment(environment)
    verify_environment_values(environment_values)
    def strict_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
        value: dict[str, object] = {}
        for name, item in pairs:
            if name in value:
                raise ValueError("Friday application contains a duplicate JSON key")
            value[name] = item
        return value

    with application.open("r", encoding="utf-8") as source:
        value = json.load(source, object_pairs_hook=strict_object)
    verify_application_values(value)
    verify_environment_application_pairing(environment_values, value)
    _verify_installed_path_boundaries(environment_values, value, service)
    if service == "plebeian-friday-signer.service" and value["schema"] == "PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3":
        _verify_r20_signer_state(environment_values, value)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", required=True, type=Path)
    parser.add_argument("--application", required=True, type=Path)
    parser.add_argument("--service", required=True)
    args = parser.parse_args()
    try:
        verify(args.environment, args.application, args.service)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
