#!/usr/bin/env python3
"""strfry writePolicy plugin: market-kind gate for Plebeian Market.

Accepts market-relevant events from ANY pubkey (the marketplace is open to
all sellers), plus the root npub's non-market events for bootstrap/personal
use. This replaces the original WoT-social gate which only accepted events
from the root npub's 2-hop follow set -- that excluded sellers outside the
operator's social graph, making their products invisible through the
aggregator (the primary production read relay).

strfry invokes this plugin as a long-lived process and feeds it one JSON
object per line on stdin (see strfry docs/plugins.md). Each input line:

    {"type":"new","event":{"id":...,"pubkey":...,"kind":...,"tags":...,...},
     "receivedAt":...,"sourceType":"...","sourceInfo":"..."}

For every line we print a single minified JSON object with ``id`` (echoed),
``action`` ("accept"|"reject") and an optional ``msg``.

The optional allowlist (one hex pubkey per line) at
``$STRFRY_AGG_ALLOWED`` is still hot-reloaded on mtime change; it serves as
an ADDITIONAL allowlist on top of the kind gate for future use cases
(verified sellers, premium tier, etc.). It defaults to empty.

The root npub ($STRFRY_AGG_ROOT_HEX) is always accepted to bootstrap the
relay before any scrape/reconcile has populated the allowlist.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ALLOWED_PATH = Path(os.environ.get("STRFRY_AGG_ALLOWED", "/opt/strfry-agg/state/allowed.npubs"))
ROOT_HEX = os.environ.get("STRFRY_AGG_ROOT_HEX", "").strip().lower()

# ---------------------------------------------------------------------------
# Market-relevant kind set
#
# Discovered from the Plebeian Market codebase (src/queries/, src/lib/schemas/,
# src/publish/). Every kind the app reads or writes must be here, otherwise
# the aggregator will reject it and buyers won't see that data.
# ---------------------------------------------------------------------------

MARKET_KINDS = {
    # --- Identity & social ---
    0,       # Metadata (user profiles)
    3,       # Contacts / follow lists (relay discovery)
    5,       # Deletions

    # --- Communication ---
    1,       # Text notes (used for bug reports)
    4,       # DMs (NIP-04)
    7,       # Reactions
    13,      # NIP-59 seals (private order details)
    14,      # General communication (order messages between buyer/seller)
    16,      # Order processing and status updates
    17,      # Payment receipts and verification
    1059,    # NIP-59 gift wraps (private order details)
    1111,    # Comments (product reviews, discussion)

    # --- Marketplace ---
    30018,   # NIP-15 products (legacy format)
    30402,   # NIP-99 classified listings (products)
    30405,   # Collections
    30406,   # Shipping options
    31989,   # NIP-89 handler recommendation
    31990,   # NIP-89 app handler info

    # --- Payments ---
    9735,    # Zap receipts (NIP-57)

    # --- Lists & app settings ---
    10000,   # Mute lists (NIP-51)
    10002,   # Relay lists (NIP-65)
    30000,   # App settings, vanity URLs, NIP-05 names
    30078,   # Cart persistence, relay preferences, v4v data
    9775,    # App-specific data (NDKKind.AppSpecificData, e.g. NWC wallet lists)

    # --- Misc app kinds ---
    25910,   # ctxvm client messages
}


# ---------------------------------------------------------------------------
# Allowlist hot-reload (additional trust layer, not the primary gate)
# ---------------------------------------------------------------------------

def _load_allowlist() -> tuple[set[str], float]:
    try:
        st = ALLOWED_PATH.stat()
        with ALLOWED_PATH.open() as f:
            pks = {line.strip().lower() for line in f if line.strip() and not line.startswith("#")}
        return pks, st.st_mtime
    except FileNotFoundError:
        return set(), 0.0


# ---------------------------------------------------------------------------
# Main plugin loop
# ---------------------------------------------------------------------------

def main() -> int:
    allowed: set[str] = set()
    mtime: float = 0.0

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue

        # Hot-reload allowlist on mtime change
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
        kind = event.get("kind")

        if not eid or not pubkey:
            continue

        # --- Gate logic ---
        # 1. Market-relevant kind from ANY pubkey -> accept (marketplace is open)
        if kind in MARKET_KINDS:
            action = "accept"
            msg = ""
        # 2. Root npub's own events -> accept (bootstrap, personal non-market events)
        elif pubkey == ROOT_HEX:
            action = "accept"
            msg = ""
        # 3. Allowlisted pubkey -> accept (verified sellers, future use)
        elif pubkey in allowed:
            action = "accept"
            msg = ""
        # 4. Everything else -> reject
        else:
            action = "reject"
            msg = f"blocked: kind {kind} not in market set and pubkey not trusted"

        resp = {"id": eid, "action": action}
        if msg:
            resp["msg"] = msg
        print(json.dumps(resp, separators=(",", ":")), flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
