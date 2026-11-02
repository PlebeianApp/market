#!/usr/bin/python3
"""Exact-current R6 backend FIPS lab controller.

R6 deliberately reuses the reviewed R5 lifecycle, namespace, privilege,
deadline, outcome-reservation and cleanup machinery while rebinding every
artifact to the current Friday service/driver build.  It proves the backend
FIPS/Comet/FROST/fake-mint paths only.  Browser Coco acceptance remains a
separate same-origin HTTPS deployment gate and is never inferred from this
controller.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import socket
import stat
import sys
import types
from pathlib import Path
from typing import Any


R5_SHA256 = "4534e85e5357915892e782212a688b1428473d3dad0c76c68a05437a70379dc7"
TRUSTED_REPO = Path("/var/lib/plebeian-friday-fips-r6-reviewed")
REPO = Path(__file__).resolve().parent.parent
SELF_PATH = Path(__file__).resolve()
R5_PATH = REPO / "scripts/friday-fips-lab-r5.py"
MANIFEST_PATH = REPO / "FIPS-LOCAL-LAB-R6-EXECUTION.json"
BUILD_RECEIPT_PATH = REPO / "FIPS-LOCAL-LAB-R6-BUILD-RECEIPT.json"
ACTION_SCOPE_PATH = REPO / "FIPS-LOCAL-LAB-R6-ACTION-SCOPE.md"
RUN_ID = "friday-fips-lab-20261023-r6"
RUN_ROOT = Path("/tmp/plebeian-friday-fips-lab.20261023-r6")
EVIDENCE_ROOT = TRUSTED_REPO / "evidence"
EVIDENCE_PENDING = EVIDENCE_ROOT / "outcome.pending"
EVIDENCE_RESULT = EVIDENCE_ROOT / "outcome.json"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def load_r5() -> types.ModuleType:
    descriptor = os.open(R5_PATH, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(descriptor)
        if os.geteuid() == 0 and (metadata.st_uid != 0 or metadata.st_gid != 0 or metadata.st_mode & 0o022):
            raise RuntimeError("R5 controller is mutable or non-root before import")
        source = b""
        while chunk := os.read(descriptor, 1024 * 1024):
            source += chunk
    finally:
        os.close(descriptor)
    if sha256_bytes(source) != R5_SHA256:
        raise RuntimeError("R5 controller differs before safe import")
    module = types.ModuleType("plebeian_fips_r5_controller_for_r6")
    module.__file__ = str(R5_PATH)
    sys.modules[module.__name__] = module
    exec(compile(source, str(R5_PATH), "exec"), module.__dict__)
    return module


r5 = load_r5()
r3 = r5.r3
r2 = r5.r2
base = r5.base

# Rebind the complete inherited graph before main can inspect or mutate state.
for module in (r5, r3, r2):
    module.TRUSTED_REPO = TRUSTED_REPO
    module.REPO = REPO
    module.SELF_PATH = SELF_PATH
    module.MANIFEST_PATH = MANIFEST_PATH
    module.RUN_ID = RUN_ID
    module.RUN_ROOT = RUN_ROOT
    module.EVIDENCE_PATH = EVIDENCE_RESULT
    module.FAILURE_PATH = EVIDENCE_RESULT
r5.BUILD_RECEIPT_PATH = BUILD_RECEIPT_PATH
r5.ACTION_SCOPE_PATH = ACTION_SCOPE_PATH
r5.EVIDENCE_ROOT = EVIDENCE_ROOT
r5.EVIDENCE_PENDING = EVIDENCE_PENDING
r5.EVIDENCE_RESULT = EVIDENCE_RESULT
r5.EVIDENCE_PATH = EVIDENCE_RESULT
r5.FAILURE_PATH = EVIDENCE_RESULT
r5.PHASE_JOURNAL = RUN_ROOT / "dkg-phase.jsonl"
r5.TERMINAL_DRIVER = REPO / "lab-bin/plebeian-friday-terminal-driver-r6"
r2.DKG = REPO / "lab-bin/plebeian-friday-frost-dkg"
r2.VALIDATOR = REPO / "lab-bin/plebeian-auctions-poc"
r2.SIGNER = REPO / "lab-bin/plebeian-friday-signer"
r2.DRIVER = REPO / "lab-bin/plebeian-friday-integrated-driver-r6"
r2.PARTICIPANT = REPO / "lab-bin/coco-demo-frost-participant-3of4"
r2.INSPECTOR = REPO / "lab-bin/coco-demo-frost-public-inspect"
r2.NUTSHELL_SITE = REPO / ".venv/lib/python3.12/site-packages"
base.RUN_ID = RUN_ID
base.RUN_ROOT = RUN_ROOT
base.MARKER_PATH = RUN_ROOT / ".plebeian-friday-fips-lab-owned"
base.EVIDENCE_PATH = EVIDENCE_RESULT
base.FAILURE_EVIDENCE_PATH = EVIDENCE_RESULT
base.VALIDATOR = str(r2.VALIDATOR)
base.DKG = str(r2.DKG)
base.SIGNER = str(r2.SIGNER)
base.DRIVER = str(r2.DRIVER)
base.FROST_PARTICIPANT = str(r2.PARTICIPANT)
base.FROST_INSPECTOR = str(r2.INSPECTOR)


def assert_trusted_root_copy_r6() -> None:
    if os.geteuid() != 0:
        return
    if REPO != TRUSTED_REPO or SELF_PATH != TRUSTED_REPO / "scripts/friday-fips-lab-r6.py":
        base.refuse("privileged R6 execution requires the exact root-owned reviewed staging tree")
    paths = (
        TRUSTED_REPO, TRUSTED_REPO / "scripts", TRUSTED_REPO / "lab-bin", EVIDENCE_ROOT,
        TRUSTED_REPO / ".venv/lib/python3.12/site-packages", SELF_PATH, R5_PATH,
        r5.R3_PATH, r3.R2_PATH, r2.BASE_PATH, r2.CAPTURE_PATH, r2.MINT_BOOTSTRAP,
        MANIFEST_PATH, BUILD_RECEIPT_PATH, ACTION_SCOPE_PATH, r2.DKG, r2.VALIDATOR,
        r2.SIGNER, r2.DRIVER, r5.TERMINAL_DRIVER, r2.PARTICIPANT, r2.INSPECTOR,
    )
    for path in paths:
        metadata = path.stat(follow_symlinks=False)
        if path.is_symlink() or metadata.st_uid != 0 or metadata.st_gid != 0 or metadata.st_mode & 0o022:
            base.refuse(f"reviewed R6 staging path is symlinked, non-root, or writable: {path}")
    evidence = EVIDENCE_ROOT.stat(follow_symlinks=False)
    if not stat.S_ISDIR(evidence.st_mode) or stat.S_IMODE(evidence.st_mode) != 0o700:
        base.refuse("reviewed R6 evidence directory is not root-only mode 0700")


def load_manifest_r6(expected_manifest_hash: str, expected_self_hash: str) -> dict[str, Any]:
    if re.fullmatch(r"[0-9a-f]{64}", expected_manifest_hash) is None \
            or re.fullmatch(r"[0-9a-f]{64}", expected_self_hash) is None:
        base.refuse("reviewed R6 hash argument is malformed")
    if r2.sha256_file(MANIFEST_PATH) != expected_manifest_hash or r2.sha256_file(SELF_PATH) != expected_self_hash:
        base.refuse("R6 manifest/controller differs from reviewed bytes")
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    r2.exact_object(manifest, {
        "schema", "approval_ready", "reason_not_ready", "run_id", "run_root", "host", "limits",
        "fixed_network", "binary_pins", "dependency_pins", "source_pins", "evidence_result",
        "claim_boundary",
    }, "R6 manifest")
    if manifest["schema"] != "PLEBEIAN_FRIDAY_FIPS_LAB_EXECUTION_V6" or manifest["approval_ready"] is not True:
        base.refuse(f"R6 execution manifest is inert: {manifest.get('reason_not_ready')}")
    if manifest["run_id"] != RUN_ID or manifest["run_root"] != str(RUN_ROOT) \
            or manifest["evidence_result"] != str(EVIDENCE_RESULT):
        base.refuse("reviewed R6 run or evidence identity differs")
    if manifest["host"] != {"hostname": socket.gethostname(), "kernel_release": os.uname().release,
                             "uid": 1000, "gid": 1000, "user": "maximoto"}:
        base.refuse("reviewed R6 host identity differs")
    expected_limits = {
        "wall_seconds": r5.R5_DRIVER_DEADLINE_SECONDS,
        "outer_timeout_seconds": r5.R5_OUTER_TIMEOUT_SECONDS,
        "cleanup_budget_seconds": r5.R5_CLEANUP_BUDGET_SECONDS,
        "terminal_prepare_deadline_seconds": r5.R5_TERMINAL_PREPARE_DEADLINE_SECONDS,
        "outbid_deadline_seconds": r5.R5_OUTBID_DEADLINE_SECONDS,
        "startup_seconds": 60, "shutdown_seconds": 15,
        "max_log_bytes_per_process": 10_485_760, "child_nproc": r5.R4_CHILD_NPROC,
    }
    if manifest["limits"] != expected_limits:
        base.refuse("reviewed R6 limits differ")
    expected_network = {
        "namespaces": list(base.ALL_NAMESPACES), "underlay_cidr": "198.18.242.0/29",
        "underlay_addresses": list(base.UNDERLAY_CIDR_ADDRESSES), "udp_port": 32121,
        "comet_p2p_port": 26656, "comet_rpc_port": 26657, "signer_rpc_port": 39101,
        "mint_port": 3338, "site_port": 8080, "external_egress": False,
        "host_routes": False, "host_firewall_changes": False, "host_file_capabilities": False,
    }
    if manifest["fixed_network"] != expected_network:
        base.refuse("reviewed R6 isolated network differs")
    if manifest["claim_boundary"] != {
        "backend_fips": True, "browser_coco_v2": False, "live_vps": False,
        "real_value": False, "requires_separate_same_origin_browser_acceptance": True,
    }:
        base.refuse("reviewed R6 claim boundary differs")
    source_paths = {
        str(SELF_PATH), str(R5_PATH), str(r5.R3_PATH), str(r3.R2_PATH), str(r2.BASE_PATH),
        str(r2.CAPTURE_PATH), str(r2.MINT_BOOTSTRAP), str(BUILD_RECEIPT_PATH), str(ACTION_SCOPE_PATH),
    }
    sources = r2.exact_object(manifest["source_pins"], source_paths | {"reviewed_integration_commit"}, "R6 source pins")
    for path_text in source_paths:
        if re.fullmatch(r"[0-9a-f]{64}", str(sources[path_text])) is None \
                or r2.sha256_file(Path(path_text)) != sources[path_text]:
            base.refuse(f"R6 source differs from reviewed bytes: {path_text}")
    if sources[str(SELF_PATH)] != expected_self_hash:
        base.refuse("manifest and invocation disagree on R6 controller hash")
    binaries = {
        str(r2.PYTHON), base.FIPS, base.FIPSCTL, base.IP, base.NFT, base.SETPRIV, base.PRLIMIT,
        base.SS, base.ENV, str(r2.VALIDATOR), str(r2.DKG), str(r2.SIGNER), str(r2.DRIVER),
        str(r5.TERMINAL_DRIVER), str(r2.PARTICIPANT), str(r2.INSPECTOR),
    }
    pins = r2.exact_object(manifest["binary_pins"], binaries, "R6 binary pins")
    for path_text in binaries:
        path = Path(path_text)
        metadata = path.stat(follow_symlinks=False)
        if not path.is_file() or path.is_symlink() or not os.access(path, os.X_OK) \
                or metadata.st_uid != 0 or metadata.st_gid != 0 or metadata.st_mode & 0o022 \
                or r2.sha256_file(path) != pins[path_text]:
            base.refuse(f"R6 binary is absent, mutable, non-root or differs: {path_text}")
    dependency = r2.exact_object(manifest["dependency_pins"], {
        "nutshell_distribution", "nutshell_version", "site_packages_tree_sha256", "entry_module",
        "nutshell_record_sha256", "nutshell_metadata_sha256",
    }, "R6 dependency pins")
    if dependency != {
        "nutshell_distribution": "cashu", "nutshell_version": "0.19.2",
        "site_packages_tree_sha256": r2.nutshell_tree_sha256(), "entry_module": "cashu.mint",
        "nutshell_record_sha256": r2.sha256_file(r2.NUTSHELL_SITE / "cashu-0.19.2.dist-info/RECORD"),
        "nutshell_metadata_sha256": r2.sha256_file(r2.NUTSHELL_SITE / "cashu-0.19.2.dist-info/METADATA"),
    }:
        base.refuse("R6 Nutshell dependency differs")
    return manifest


def write_evidence_r6(path: Path, value: dict[str, Any]) -> None:
    enriched = dict(value)
    if enriched.get("schema") == "COCO_DEMO_FIPS_R2_INTEGRATION_EVIDENCE_V1":
        enriched["schema"] = "COCO_DEMO_FIPS_R6_BACKEND_EVIDENCE_V1"
    elif str(enriched.get("schema", "")).startswith("PLEBEIAN_FRIDAY_FIPS_LAB_FAILURE"):
        enriched["schema"] = "PLEBEIAN_FRIDAY_FIPS_LAB_FAILURE_V6"
    enriched["claimBoundary"] = {
        "backendFips": True, "browserCocoV2": False, "liveVps": False,
        "realValue": False, "requiresSeparateSameOriginBrowserAcceptance": True,
    }
    enriched["dkgPhaseRecords"] = r5._dkg_phase_records
    enriched["dkgPhaseJournal"] = r5._dkg_phase_journal_evidence
    enriched["dkgResult"] = r5._dkg_result_evidence
    enriched["normalTerminalBranches"] = r5._terminal_result_evidence
    enriched["normalTerminalArtifacts"] = r5._terminal_artifact_evidence
    enriched["phaseTiming"] = list(r5._phase_timing_evidence)
    enriched["emergencyRefundAuthority"] = {
        "status": "not_composed", "reason": "distinct admitted-pool unilateral authority is absent",
    }
    r5.persist_reserved_outcome(path, enriched)


r2.assert_trusted_root_copy = assert_trusted_root_copy_r6
r2.load_manifest = load_manifest_r6
base.write_evidence = write_evidence_r6


if __name__ == "__main__":
    raise SystemExit(r2.main())
