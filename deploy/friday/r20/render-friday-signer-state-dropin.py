#!/usr/bin/python3
"""Render one exact public R20 state drop-in to stdout; never install it."""
from __future__ import annotations
import argparse
import json
import runpy
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slot", required=True, choices=["1", "2", "3", "4"])
    args = parser.parse_args()
    here = Path(__file__).absolute()
    verifier = (here.parent.parent / "verify-friday-runtime-target.py"
                if here.parent.name == "r20" else here.with_name("verify-friday-runtime-target.py"))
    guard = runpy.run_path(str(verifier))
    def strict_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate application key")
            result[key] = value
        return result
    try:
        data = sys.stdin.buffer.read(65537)
        if len(data) > 65536:
            raise ValueError("public application exceeds 64KiB")
        application = json.loads(data, object_pairs_hook=strict_object)
        text = guard["render_r20_signer_state_dropin"](application, args.slot)
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.error(str(error))
    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
