#!/usr/bin/env python3
"""Fence the two known pre-swap R33 operations and authorize their exact retries."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import pwd
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request


ROOT = Path("/var/lib/plebeian-auctions-friday/coordinator-v3/runtime")
RECOVERY_DB = ROOT / "recovery.sqlite3"
OPERATIONS_DB = ROOT / "operations.sqlite3"
RECEIPT = ROOT / "mint-seal-r33-no-effect-fence.json"
MINT_TRANSPORT = "http://[fdb2:77a9:c591:3ac6:3513:5bf8:cc3b:5a04]:3438"
EXPECTED_ROWS = 2
EXPECTED_PROOFS = 3
EXPECTED_OUTPUTS = 3
MINIMUM_RETRY_MARGIN_SECONDS = 120


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def service_state(name: str) -> str:
    result = subprocess.run(
        ["/usr/bin/systemctl", "is-active", name],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=10,
    )
    return result.stdout.decode("ascii", "replace").strip()


def terminal_executor_running() -> bool:
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            command = (entry / "cmdline").read_bytes().replace(b"\x00", b" ")
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
        if b"plebeian-friday-terminal-executor" in command:
            return True
    return False


def latest_swap_time() -> float:
    result = subprocess.run(
        [
            "/usr/bin/journalctl",
            "--namespace=plebeian-friday-separated",
            "-u",
            "plebeian-friday-mint.service",
            "--since",
            "2026-11-05 03:00:00 UTC",
            "--no-pager",
            "-o",
            "json",
        ],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=20,
    )
    require(result.returncode == 0, "MINT_JOURNAL")
    observed = []
    for line in result.stdout.splitlines():
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        message = entry.get("MESSAGE")
        stamp = entry.get("__REALTIME_TIMESTAMP")
        if isinstance(message, str) and '"POST /v1/swap ' in message and isinstance(stamp, str) and stamp.isdigit():
            observed.append(int(stamp) / 1_000_000)
    require(len(observed) > 0, "MINT_SWAP_JOURNAL_ABSENT")
    return max(observed)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, msg, headers, fp)


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)


def post(path: str, body: dict) -> tuple[int, object]:
    request = urllib.request.Request(
        MINT_TRANSPORT + path,
        data=json.dumps(body, separators=(",", ":")).encode(),
        headers={"Content-Type": "application/json", "Accept-Encoding": "identity"},
        method="POST",
    )
    with OPENER.open(request, timeout=10) as response:
        raw = response.read(262145)
        require(len(raw) <= 262144, "MINT_RESPONSE_BOUND")
        return response.status, json.loads(raw)


def exact_rows(database: sqlite3.Connection) -> list[dict]:
    rows = [json.loads(raw) for (raw,) in database.execute(
        "SELECT record_json FROM demo_sigall_recovery ORDER BY scope"
    ).fetchall()]
    require(len(rows) == EXPECTED_ROWS, "RECOVERY_ROW_COUNT")
    for record in rows:
        require(record.get("schema") == "COCO_DEMO_SIGALL_RECOVERY_V1", "RECOVERY_SCHEMA")
        require(record.get("state") == "ambiguous", "RECOVERY_STATE")
        require(record.get("revision") == 2 and record.get("attemptNumber") == 1, "RECOVERY_REVISION")
        require(len(record.get("proofStateRefs", [])) == EXPECTED_PROOFS, "RECOVERY_PROOF_COUNT")
        require(len(record.get("blindedOutputs", [])) == EXPECTED_OUTPUTS, "RECOVERY_OUTPUT_COUNT")
        require("terminal" not in record and "reconciliationDigest" not in record, "RECOVERY_ALREADY_TERMINAL")
    return rows


def main() -> int:
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    require(not RECEIPT.exists(), "RECEIPT_EXISTS")
    require(service_state("plebeian-friday-authority.service") == "inactive", "AUTHORITY_NOT_INACTIVE")
    require(service_state("plebeian-friday-coordinator.service") == "inactive", "COORDINATOR_NOT_INACTIVE")
    require(service_state("plebeian-friday-mint.service") == "active", "MINT_NOT_ACTIVE")
    require(not terminal_executor_running(), "TERMINAL_EXECUTOR_RUNNING")
    last_swap = latest_swap_time()

    service = pwd.getpwnam("plebeian-friday")
    os.chdir("/")
    os.setgroups([])
    os.setgid(service.pw_gid)
    os.setuid(service.pw_uid)

    recovery = sqlite3.connect(RECOVERY_DB)
    operations = sqlite3.connect(f"file:{OPERATIONS_DB}?mode=ro", uri=True)
    try:
        rows = exact_rows(recovery)
        nonterminal = [json.loads(raw) for (raw,) in operations.execute(
            "SELECT record_json FROM friday_coordinator_operations WHERE phase != 'completed' ORDER BY scope"
        ).fetchall()]
        require(len(nonterminal) == EXPECTED_ROWS, "COORDINATOR_ROW_COUNT")
        require(all(row.get("phase") == "mint_unknown" and row.get("attempts") == 1 for row in nonterminal), "COORDINATOR_STATE")
        require({row["scope"] for row in rows} == {row["scope"] for row in nonterminal}, "COORDINATOR_SCOPE_SET")
        earliest_prepared = min(record["preparedAt"] for record in rows) / 1000
        require(last_swap < earliest_prepared, "PRIOR_REQUEST_REACHED_MINT")
        now = int(time.time())
        require(all(now + MINIMUM_RETRY_MARGIN_SECONDS < record["locktime"] - 60 for record in rows), "RETRY_MARGIN")

        evidence_rows = []
        for record in rows:
            state_status, state_payload = post("/v1/checkstate", {"Ys": record["proofStateRefs"]})
            require(state_status == 200 and isinstance(state_payload, dict), "NUT07_HTTP")
            states = state_payload.get("states")
            require(isinstance(states, list) and len(states) == EXPECTED_PROOFS, "NUT07_COUNT")
            by_y = {entry.get("Y"): entry.get("state") for entry in states if isinstance(entry, dict)}
            require(len(by_y) == EXPECTED_PROOFS, "NUT07_UNIQUENESS")
            require(all(by_y.get(value) == "UNSPENT" for value in record["proofStateRefs"]), "NUT07_NOT_UNSPENT")
            restore_status, restore_payload = post("/v1/restore", {"outputs": record["blindedOutputs"]})
            require(restore_status == 200 and isinstance(restore_payload, dict), "NUT09_HTTP")
            signatures = restore_payload.get("signatures")
            require(isinstance(signatures, list) and len(signatures) == 0, "NUT09_OUTPUT_EXISTS")
            evidence_rows.append({
                "scopeSha256": hashlib.sha256(record["scope"].encode()).hexdigest(),
                "operationRoot": record["operationRoot"],
                "requestDigest": record["requestDigest"],
                "priorRevision": record["revision"],
                "attemptNumber": record["attemptNumber"],
                "proofStates": dict(Counter(by_y.values())),
                "restoredSignatureCount": 0,
            })

        receipt = {
            "schema": "PLEBEIAN_MINT_SEAL_R33_NO_EFFECT_FENCE_V1",
            "observedAt": datetime.now(timezone.utc).isoformat(),
            "mintTransport": MINT_TRANSPORT,
            "coordinatorInactive": True,
            "authorityInactive": True,
            "terminalExecutorAbsent": True,
            "latestSwapBeforeEveryPreparedAttempt": True,
            "rows": evidence_rows,
        }
        canonical = json.dumps(receipt, sort_keys=True, separators=(",", ":")).encode()
        receipt_digest = hashlib.sha256(canonical).hexdigest()
        descriptor = os.open(RECEIPT, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC, 0o600)
        try:
            os.write(descriptor, canonical + b"\n")
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

        recovery.execute("BEGIN IMMEDIATE")
        try:
            current = exact_rows(recovery)
            require(
                [(row["scope"], row["revision"], row["state"]) for row in current]
                == [(row["scope"], row["revision"], row["state"]) for row in rows],
                "RECOVERY_CHANGED",
            )
            updated_at = int(time.time() * 1000)
            for record in current:
                prior_revision = record["revision"]
                record["state"] = "retry_ready"
                record["revision"] = prior_revision + 1
                record["updatedAt"] = updated_at
                record["reconciliationDigest"] = receipt_digest
                changed = recovery.execute(
                    "UPDATE demo_sigall_recovery SET revision=?,record_json=? "
                    "WHERE scope=? AND revision=? AND operation_root=? AND request_digest=?",
                    (
                        record["revision"],
                        json.dumps(record, separators=(",", ":")),
                        record["scope"],
                        prior_revision,
                        record["operationRoot"],
                        record["requestDigest"],
                    ),
                )
                require(changed.rowcount == 1, "RECOVERY_CAS")
            recovery.commit()
        except Exception:
            recovery.rollback()
            raise
    finally:
        operations.close()
        recovery.close()
    print(json.dumps({
        "schema": "PLEBEIAN_MINT_SEAL_R33_NO_EFFECT_FENCE_RESULT_V1",
        "rows": EXPECTED_ROWS,
        "receiptSha256": receipt_digest,
        "status": "retry_ready",
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, sqlite3.Error, Stop) as error:
        print("PLEBEIAN_MINT_SEAL_R33_NO_EFFECT_FENCE=STOPPED:" + str(error))
        raise SystemExit(1)
