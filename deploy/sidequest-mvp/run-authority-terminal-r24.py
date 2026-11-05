#!/usr/bin/env python3
"""Bind the reviewed R18 controller to the R24 terminal admission successor."""

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
    raise SystemExit("R24_BASE_CONTROLLER_STOPPED")

module = runpy.run_path(str(BASE))
runtime = module["main"].__globals__
PathClass = runtime["Path"]
stage = PathClass("/tmp/plebeian-r24-stage-4375801")
release = PathClass("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-terminal-r24")
config = PathClass("/etc/plebeian-auctions-friday/authority.json")
unit = PathClass("/etc/systemd/system/plebeian-friday-authority.service")
runtime["STAGE"] = stage
runtime["RELEASE"] = release
runtime["CONFIG"] = config
runtime["UNIT"] = unit
runtime["PRESERVED_UNIT"] = PathClass("/etc/systemd/system/plebeian-friday-authority.pre-r24-d5bacf4ff32f.service")
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
    "plebeian-friday-authority": (100_440_746, "9c9ba5178ffbcbb35bc699f37877afe7275920b9bc12d30a5fafc01e2ac80531"),
    "verify-friday-separated-target.py": (1_211, "3198760859ac0ddc866d4ca3b6ecb06edf205d44e1613934fc3bc994a2ad2b57"),
    "authority-activation.service": (1_851, "c323424fadf5a75709444f676bac1991bb54e56b26fcaea9e681422165052384"),
    "authority-final.service": (1_859, "b4cfa7d1ab13cff6b0f83e21fa99bedc5587c973cf2f3c59aebc813aad8a2573"),
}
runtime["CURRENT"] = {
    PathClass("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-genesis-pin-r23/bin/plebeian-friday-authority"):
        (100_439_680, "aee4e5d4516e364ce8f0c196dfb3c773d1c31a283bd545b3f4d533f3ab75fe2e"),
    config: (363, "141603382ea90a7079402bc74fbf28e26cc71cddae1d1b55a118268dcdf7e435"),
    unit: (1_858, "d5bacf4ff32ff7b10b5c300e021380317717b703289592d2b958a175089e6109"),
}
raise SystemExit(runtime["main"]())
