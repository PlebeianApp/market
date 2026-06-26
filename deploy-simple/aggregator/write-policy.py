#!/usr/bin/env python3
"""strfry writePolicy plugin: accept events only from served npubs.

strfry invokes this plugin as a long-lived process and feeds it one JSON
object per line on stdin (see strfry docs/plugins.md). Each input line has the
shape::

    {"type":"new","event":{"id":...,"pubkey":...,"kind":...,"tags":...,"content":...,"sig":...},
     "receivedAt":...,"sourceType":"...","sourceInfo":"..."}

For every line we print a single minified JSON object with ``id`` (echoed),
``action`` ("accept"|"reject") and an optional ``msg``.

The allowlist (one hex pubkey per line) is read from
``$STRFRY_AGG_ALLOWED`` (default /opt/strfry-agg/state/allowed.npubs)
and reloaded automatically when its mtime changes, so the reconcile timer can
update the served set without restarting the plugin or strfry.

Special-case: the root npub's own events (and its kind-3 follow list) are
always accepted even before the first reconcile populates the allowlist, so
the relay can bootstrap. The root npub hex is read from ``$STRFRY_AGG_ROOT_HEX``.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ALLOWED_PATH = Path(os.environ.get("STRFRY_AGG_ALLOWED", "/opt/strfry-agg/state/allowed.npubs"))
ROOT_HEX = os.environ.get("STRFRY_AGG_ROOT_HEX", "").strip().lower()


def _load_allowlist() -> tuple[set[str], float]:
    try:
        st = ALLOWED_PATH.stat()
        with ALLOWED_PATH.open() as f:
            pks = {line.strip().lower() for line in f if line.strip() and not line.startswith("#")}
        return pks, st.st_mtime
    except FileNotFoundError:
        return set(), 0.0


def main() -> int:
    allowed: set[str] = set()
    mtime: float = 0.0

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue

        try:
            st = ALLOWED_PATH.stat().st_mtime if ALLOWED_PATH.exists() else 0.0
        except OSError:
            st = 0.0
        if st != mtime:
            allowed, mtime = _load_allowlist()

        try:
            req = json.loads(raw)
        except json.JSONDecodeError:
            continue

        if req.get("type") != "new":
            continue

        event = req.get("event") or {}
        eid = event.get("id")
        pubkey = str(event.get("pubkey", "")).lower()

        if not eid or not pubkey:
            continue

        if pubkey == ROOT_HEX or pubkey in allowed:
            action = "accept"
            msg = ""
        else:
            action = "reject"
            msg = "blocked: not in served follow set"

        resp = {"id": eid, "action": action}
        if msg:
            resp["msg"] = msg
        print(json.dumps(resp, separators=(",", ":")), flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
