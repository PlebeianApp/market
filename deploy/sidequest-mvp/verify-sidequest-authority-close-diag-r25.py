#!/usr/bin/env python3
"""Verify the exact R25 authority diagnostic against the installed target."""

from __future__ import annotations

import argparse
from pathlib import Path
import runpy

RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-close-diag-r25")
BASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-comet-stage-r21/bin/verify-friday-separated-target.py")
AUTHORITY = (100_441_389, "d33a912ee65b1239773834c92d1b52a6871b5e4f47cf7dd3a7fc5881f1e2b8d5")


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
    print("SIDEQUEST_AUTHORITY_CLOSE_DIAG_R25_TARGET=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
