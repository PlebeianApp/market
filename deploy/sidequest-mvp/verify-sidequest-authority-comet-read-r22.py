#!/usr/bin/env python3
"""Verify R22 by rebinding the installed R21 verifier to the exact successor."""

from __future__ import annotations

import argparse
from pathlib import Path
import runpy

RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-comet-read-r22")
BASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-comet-stage-r21/bin/verify-friday-separated-target.py")
AUTHORITY = (100_438_909, "ff807aa74a3f6340785d6e3f93b4a632290c61ebfa38be231d5870bcc54692ba")

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--service", required=True)
    args = parser.parse_args()
    module = runpy.run_path(str(BASE))
    runtime = module["verify"].__globals__
    runtime["RELEASE"] = RELEASE
    runtime["AUTHORITY"] = AUTHORITY
    runtime["__file__"] = str(RELEASE / "bin/verify-friday-separated-target.py")
    runtime["verify"](args.environment, args.application, args.service)
    print("SIDEQUEST_AUTHORITY_COMET_READ_R22_TARGET=PASS")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
