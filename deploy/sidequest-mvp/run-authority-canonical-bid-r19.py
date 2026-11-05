#!/usr/bin/env python3
"""Bind the reviewed R18 controller to the R19 canonical-bid successor."""

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
    raise SystemExit("R19_BASE_CONTROLLER_STOPPED")

module = runpy.run_path(str(BASE))
PathClass = module["Path"]
stage = PathClass("/tmp/plebeian-r19-stage-7752104")
release = PathClass("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-canonical-bid-r19")
config = PathClass("/etc/plebeian-auctions-friday/authority.json")
unit = PathClass("/etc/systemd/system/plebeian-friday-authority.service")
module["STAGE"] = stage
module["RELEASE"] = release
module["CONFIG"] = config
module["UNIT"] = unit
module["PRESERVED_UNIT"] = PathClass("/etc/systemd/system/plebeian-friday-authority.pre-r19-4de68e987ad9.service")
module["PRIOR_OPERATION"] = "24258ab577078934d790715b561977f8f29824255560fd0a3080b2867c489740"
module["FILES"] = {
    "plebeian-friday-authority": (100_438_142, "899d40d1ce7c68a62111cc9e2b5ff5347fe01068e9197f2c09dccd4161cc8c9e"),
    "verify-friday-separated-target.py": (3_397, "9f1e5b72c0c560ffd315e4cfedcbb367be96b3606fa87a7eacfdf5cfea437ab0"),
    "authority-activation.service": (1_852, "893a090ca86e4fa56e50943d0c0fb329ba320de8a38d523bdf146a43cf00423f"),
    "authority-final.service": (1_860, "529db43a993c94f03e30f20e38cb52409abbebe96df2df5d784aeec326a16469"),
}
module["CURRENT"] = {
    PathClass("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-confirm-diag-r18/bin/plebeian-friday-authority"):
        (100_438_080, "0f3dfb2f11332ee7b9981540a04e63fc676e73684d0338483ea0b24c9afbad73"),
    config: (363, "141603382ea90a7079402bc74fbf28e26cc71cddae1d1b55a118268dcdf7e435"),
    unit: (1_868, "4de68e987ad94b19070dec5bfc2e2d392a59afc8a039464295c8665f74c1bd40"),
}
raise SystemExit(module["main"]())
