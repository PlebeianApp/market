#!/usr/bin/env python3
"""Bind the reviewed R18 controller to the R23 exact genesis pin successor."""

from __future__ import annotations

import hashlib
from pathlib import Path
import runpy

BASE = Path("/tmp/run-authority-confirm-diag-r18-6631081-r3.py")
BASE_SHA256 = "d3f3648034f1e776eee86b7f8ef02cdbf0930d19cf81436ae62428e2fd63ef35"

def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()

if sha256(BASE) != BASE_SHA256:
    raise SystemExit("R23_BASE_CONTROLLER_STOPPED")

module = runpy.run_path(str(BASE))
runtime = module["main"].__globals__
PathClass = runtime["Path"]
stage = PathClass("/tmp/plebeian-r23-stage-2519468")
release = PathClass("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-genesis-pin-r23")
config = PathClass("/etc/plebeian-auctions-friday/authority.json")
unit = PathClass("/etc/systemd/system/plebeian-friday-authority.service")
runtime["STAGE"] = stage
runtime["RELEASE"] = release
runtime["CONFIG"] = config
runtime["UNIT"] = unit
runtime["PRESERVED_UNIT"] = PathClass("/etc/systemd/system/plebeian-friday-authority.pre-r23-e42152a2844f.service")
runtime["PRIOR_OPERATION"] = "bb0ebdbf39afe15fb8ef5981af3ce19e864c0494db1a4e9a9073c2262b2b7113"

def require_prior_broadcast() -> None:
    database = runtime["sqlite3"].connect(f"file:{runtime['BROADCAST_DB']}?mode=ro", uri=True)
    try:
        row = database.execute(
            "SELECT phase, revision FROM friday_v4_broadcast_journal WHERE funding_operation_id = ?",
            (runtime["PRIOR_OPERATION"],),
        ).fetchone()
    finally:
        database.close()
    runtime["require"](row == ("broadcast", 4), "PRIOR_OPERATION_CHANGED")

runtime["require_prior_uncommitted"] = require_prior_broadcast
runtime["FILES"] = {
    "plebeian-friday-authority": (100_439_680, "aee4e5d4516e364ce8f0c196dfb3c773d1c31a283bd545b3f4d533f3ab75fe2e"),
    "verify-friday-separated-target.py": (1_217, "b13c6044ac73f416d1aa977816f99bc2c266c1b970e263842ed518ce3852c4ac"),
    "authority-activation.service": (1_850, "8f86d037af8bdc1564a31afba9d0fa3d455ce0a4a246b2d0f644121709f59042"),
    "authority-final.service": (1_858, "d5bacf4ff32ff7b10b5c300e021380317717b703289592d2b958a175089e6109"),
}
runtime["CURRENT"] = {
    PathClass("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-comet-read-r22/bin/plebeian-friday-authority"):
        (100_438_909, "ff807aa74a3f6340785d6e3f93b4a632290c61ebfa38be231d5870bcc54692ba"),
    config: (363, "141603382ea90a7079402bc74fbf28e26cc71cddae1d1b55a118268dcdf7e435"),
    unit: (1_862, "e42152a2844f43b227b1cab8fee067f527a6932551fc1f4f85e5817647bc4616"),
}
raise SystemExit(runtime["main"]())
