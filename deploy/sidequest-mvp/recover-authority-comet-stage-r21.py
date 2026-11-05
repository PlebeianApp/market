#!/usr/bin/env python3
"""Idempotently re-confirm one already-broadcast public journal identity."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sqlite3
import urllib.error
import urllib.request

BROADCAST_DB = Path("/var/lib/plebeian-auctions-friday/coordinator-v3/runtime/funding-broadcast.sqlite3")
OPERATION = "bb0ebdbf39afe15fb8ef5981af3ce19e864c0494db1a4e9a9073c2262b2b7113"
AUTHORIZATION = "8d4f92cd1de35aff462ba45ec64ced234cb7705dcf14ebfdbb25db13585345b6"
BID = "1860f012ec621188c79b231be74ae41ae595f6a4e9f21aabedbcc2a679948947"
TRANSACTION = "433169ba1897591198fb3361d7d714350bc047265faeca6172dc7430904e9a78"

class Stop(RuntimeError):
    pass

def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)

def read_row() -> tuple[str, int, dict[str, object]]:
    database = sqlite3.connect(f"file:{BROADCAST_DB}?mode=ro", uri=True)
    try:
        row = database.execute(
            "SELECT phase, revision, record_json FROM friday_v4_broadcast_journal WHERE funding_operation_id = ?",
            (OPERATION,),
        ).fetchone()
    finally:
        database.close()
    require(row is not None, "ROW_ABSENT")
    phase, revision, raw = row
    record = json.loads(raw)
    require(record["authorizationEventId"] == AUTHORIZATION, "AUTHORIZATION_CHANGED")
    require(record["fundingOperationId"] == OPERATION, "OPERATION_CHANGED")
    require(record["signed"]["event"]["id"] == BID, "BID_CHANGED")
    require(record["broadcast"]["transactionHash"] == TRANSACTION, "TRANSACTION_CHANGED")
    require(record["broadcast"]["committedHeight"] == 83260, "HEIGHT_CHANGED")
    return phase, revision, record

def main() -> int:
    phase, revision, record = read_row()
    require((phase, revision) == ("broadcast", 4), "ROW_NOT_RECOVERABLE")
    body = json.dumps({
        "schema": "PLEBEIAN_FRIDAY_V4_FUNDING_CONFIRMATION_V1",
        "fundingAuthorizationEventId": AUTHORIZATION,
        "signedEvent": record["signed"]["event"],
    }, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        "http://127.0.0.1:8181/api/friday/funding/confirm",
        data=body,
        headers={"Accept": "application/json", "Content-Type": "application/json", "Origin": "https://139.162.161.233"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            status = response.status
            response_body = response.read(65_537)
    except urllib.error.HTTPError as error:
        status = error.code
        response_body = error.read(65_537)
    after_phase, after_revision, after = read_row()
    require(after["broadcast"]["transactionHash"] == TRANSACTION, "POST_TRANSACTION_CHANGED")
    print(json.dumps({
        "schema": "PLEBEIAN_FRIDAY_R21_EXACT_CONFIRM_RECOVERY_V1",
        "httpStatus": status,
        "responseBytes": len(response_body),
        "responseSha256": hashlib.sha256(response_body).hexdigest(),
        "beforePhase": phase,
        "beforeRevision": revision,
        "afterPhase": after_phase,
        "afterRevision": after_revision,
        "transactionUnchanged": True,
    }, separators=(",", ":"), sort_keys=True))
    return 0 if status in (201, 422) else 1

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop) as error:
        print("PLEBEIAN_FRIDAY_R21_EXACT_CONFIRM_RECOVERY_STOPPED:" + str(error))
        raise SystemExit(1)
