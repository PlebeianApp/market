#!/usr/bin/env python3
"""Verify the exact R27 authority immutable-finality successor."""

from __future__ import annotations

import argparse
from pathlib import Path
import runpy

RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-finality-r27")
BASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-comet-stage-r21/bin/verify-friday-separated-target.py")
AUTHORITY = (100_441_805, "bed004568fbd10211cede9e47a77b4078a1880108ef28f4acb3046c4094847cd")


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
    print("SIDEQUEST_AUTHORITY_FINALITY_R27_TARGET=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
