#!/usr/bin/env python3
"""Bind the reviewed R18 controller to the R20 Comet diagnostic successor."""

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
    raise SystemExit("R20_BASE_CONTROLLER_STOPPED")

module = runpy.run_path(str(BASE))
runtime = module["main"].__globals__
PathClass = runtime["Path"]
stage = PathClass("/tmp/plebeian-r20-stage-8843215")
release = PathClass("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-comet-diag-r20")
config = PathClass("/etc/plebeian-auctions-friday/authority.json")
unit = PathClass("/etc/systemd/system/plebeian-friday-authority.service")
runtime["STAGE"] = stage
runtime["RELEASE"] = release
runtime["CONFIG"] = config
runtime["UNIT"] = unit
runtime["PRESERVED_UNIT"] = PathClass("/etc/systemd/system/plebeian-friday-authority.pre-r20-529db43a993c.service")
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
    "plebeian-friday-authority": (100_439_459, "de7292699d78284f6ff2dee707d175aaa3cf6f85b0e10170449ce23f802d33e7"),
    "verify-friday-separated-target.py": (3_387, "0125ab56c49d16ef88adc470eb353cff11e1c5860700e6d45dca81f05688057d"),
    "authority-activation.service": (1_849, "32ef180717370d4e7e1c1fe50713893cc2b6cfd971bdda362461ce742192e433"),
    "authority-final.service": (1_857, "53b0d762ef1b81dd8515013644892ae14109435a8cef800f561334c827936c94"),
}
runtime["CURRENT"] = {
    PathClass("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-canonical-bid-r19/bin/plebeian-friday-authority"):
        (100_438_142, "899d40d1ce7c68a62111cc9e2b5ff5347fe01068e9197f2c09dccd4161cc8c9e"),
    config: (363, "141603382ea90a7079402bc74fbf28e26cc71cddae1d1b55a118268dcdf7e435"),
    unit: (1_860, "529db43a993c94f03e30f20e38cb52409abbebe96df2df5d784aeec326a16469"),
}
raise SystemExit(runtime["main"]())
