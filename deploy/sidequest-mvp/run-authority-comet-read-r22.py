#!/usr/bin/env python3
"""Bind the reviewed R18 controller to the R22 payload-free Comet read diagnostic successor."""

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
    raise SystemExit("R22_BASE_CONTROLLER_STOPPED")

module = runpy.run_path(str(BASE))
runtime = module["main"].__globals__
PathClass = runtime["Path"]
stage = PathClass("/tmp/plebeian-r22-stage-8137524")
release = PathClass("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-comet-read-r22")
config = PathClass("/etc/plebeian-auctions-friday/authority.json")
unit = PathClass("/etc/systemd/system/plebeian-friday-authority.service")
runtime["STAGE"] = stage
runtime["RELEASE"] = release
runtime["CONFIG"] = config
runtime["UNIT"] = unit
runtime["PRESERVED_UNIT"] = PathClass("/etc/systemd/system/plebeian-friday-authority.pre-r22-15b30bf59844.service")
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
    "plebeian-friday-authority": (100_438_909, "ff807aa74a3f6340785d6e3f93b4a632290c61ebfa38be231d5870bcc54692ba"),
    "verify-friday-separated-target.py": (1_215, "2b43c23960413991c80b5b534d9be2a12cbf75d604dae8d484955654a3daaa26"),
    "authority-activation.service": (1_854, "a6940f83112601587888093ddeefb93f9ba3877cbb259fd8a0fbf0d9de6b904d"),
    "authority-final.service": (1_862, "e42152a2844f43b227b1cab8fee067f527a6932551fc1f4f85e5817647bc4616"),
}
runtime["CURRENT"] = {
    PathClass("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-comet-stage-r21/bin/plebeian-friday-authority"):
        (100_438_243, "923bd3421fa0eda693933ddbd53518a11a1a53e177cb91c8cbef7e1ae5af9af7"),
    config: (363, "141603382ea90a7079402bc74fbf28e26cc71cddae1d1b55a118268dcdf7e435"),
    unit: (1_865, "15b30bf598443975a5b96cbf1bf4f4f5eb198bf03772bd98ee360f7e2c28fb90"),
}
raise SystemExit(runtime["main"]())
