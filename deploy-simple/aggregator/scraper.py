#!/usr/bin/env python3
"""strfry market aggregator scraper daemon (personal mode).

Why this exists
---------------
PR #1066 deployed a strfry relay on vps2 (market-agg.orangesync.tech) gated by
a write-policy. But strfry only stores events that are *published to it*. This
daemon actively scrapes market-relevant events from upstream Nostr relays and
re-publishes them into the local strfry so the relay mirrors a complete view of
the root npub's market network. The write-policy on strfry still gets the final
say on what is persisted.

Phases
------
  1. BOOTSTRAP  — query the seed relays for the root npub's kind 3 (follows)
                  and kind 10002 (relay list).
  2. DISCOVER   — for each followed pubkey, fetch their kind 10002 to learn
                  which relays they publish to. Builds a (pubkey, relay) index.
  3. SCRAPE     — one worker thread per relay holds a persistent subscription
                  (chunked author filters + a #p filter for the root npub) and
                  re-publishes every received EVENT to the local strfry.
  4. EXPAND     — every 30 min, harvest new pubkeys seen in 'p' tags and fetch
                  their follows/relay lists (capped at MAX_PUBKEYS).
  5. MAINTAIN   — every 5 min refresh the root npub's replaceable events;
                  every 1 h prune pubkeys unseen for PRUNE_AGE_DAYS; rewrite
                  state/allowed.npubs (the WoT set the write-policy gates on).

Design notes
------------
  * Uses the ``websocket-client`` library (``import websocket``). It handles
    permessage-deflate, ping/pong and framing for us — important because most
    relays advertise compression.
  * Thread-per-relay model: each relay worker owns one socket and multiplexes
    many subscriptions over it (distinguished by subid). Simpler than asyncio
    for a long-lived scraper and maps cleanly to "reconnect = close + reopen".
  * A single publisher thread owns the strfry socket so republishing is
    serialized and never interleaves partial frames.
  * Pure stdlib for everything else (no nostr library needed).

Config comes from environment variables (see docker-compose.yml).
"""

from __future__ import annotations

import json
import logging
import os
import queue
import random
import signal
import ssl
import sys
import threading
import time
from collections import defaultdict

try:
    import websocket  # websocket-client
except ImportError:  # pragma: no cover - surfaced at startup with a clear msg
    websocket = None

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
ROOT_HEX = os.environ.get("ROOT_HEX", "").strip().lower()
STRFRY_URL = os.environ.get("STRFRY_URL", "ws://localhost:7777")
SEED_RELAYS = [r.strip() for r in os.environ.get(
    "SEED_RELAYS", "wss://relay.plebeian.market,wss://relay.damus.io,wss://nos.lol"
).split(",") if r.strip()]
MAX_PUBKEYS = int(os.environ.get("MAX_PUBKEYS", "2000"))
PRUNE_AGE_DAYS = int(os.environ.get("PRUNE_AGE_DAYS", "30"))
STATE_DIR = os.environ.get("STATE_DIR", "/opt/strfry-agg/state")
ALLOWED_PATH = os.environ.get("ALLOWED_PATH", os.path.join(STATE_DIR, "allowed.npubs"))

# How many authors to pack into a single REQ filter. Upstream relays cap the
# size of a filter; 200 is a safe ceiling that keeps the payload well under the
# ~8 KB limit most relays enforce.
MAX_AUTH_PER_REQ = int(os.environ.get("MAX_AUTH_PER_REQ", "200"))
# Cap on relays we will actively scrape (seed relays + discovered relays).
MAX_RELAYS = int(os.environ.get("MAX_RELAYS", "10"))

# Refresh / maintenance intervals (seconds).
ROOT_REFRESH_INTERVAL = int(os.environ.get("ROOT_REFRESH_INTERVAL", str(5 * 60)))   # 5 min
EXPAND_INTERVAL = int(os.environ.get("EXPAND_INTERVAL", str(30 * 60)))               # 30 min
PRUNE_INTERVAL = int(os.environ.get("PRUNE_INTERVAL", str(60 * 60)))                  # 1 hour
RELAY_RECONNECT_BASE = float(os.environ.get("RELAY_RECONNECT_BASE", "5"))             # backoff base

# Kinds we scrape for tracked pubkeys. (kind 0 metadata, 1 text, 3 follows,
# 7 reaction, 9735 zap receipt, 1985 relay review, 10000 mute list, 10002
# relay list, 1023-1026 plebeian market kinds, 30402 stall, 30405/06/08
# product/auction, 30440-30442 ratings, 31555/31990 curated content, 30078
# app data.) Matches the write-policy's PUBLIC + RESTRICTED market sets.
SCRAPE_KINDS = [
    0, 1, 3, 7, 9735, 1985, 10000, 10002,
    1023, 1024, 1025, 1026,
    13, 14, 16, 17, 17375,          # seals, order comms/status, payment receipt, NIP-60 wallet
    30402, 30405, 30406, 30408,
    30440, 30441, 30442,
    31555, 31990, 30078,
]
# Kinds to subscribe to via the #p filter (events that *mention* the root npub).
P_TAG_KINDS = [1, 3, 7, 9735, 30402, 30405, 30406, 30408, 30440, 30441, 30442, 14, 16, 17, 13]

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s [%(threadName)s] %(message)s",
)
log = logging.getLogger("scraper")

# --------------------------------------------------------------------------- #
# Shared state (guarded by STATE_LOCK)
# --------------------------------------------------------------------------- #
STATE_LOCK = threading.RLock()
# pubkey (hex) -> last_seen timestamp. Every pubkey we track lives here.
PUBKEYS: dict[str, float] = {}
# relay_url -> set of pubkeys we expect to find there.
RELAY_INDEX: dict[str, set[str]] = defaultdict(set)
# pubkeys whose kind 3 / 10002 we still need to fetch.
DISCOVERY_QUEUE: set[str] = set()
# root npub's direct follows (the WoT core).
ROOT_FOLLOWS: set[str] = set()

# Republish queue: the publisher thread drains this and forwards to strfry.
REPUBLISH_QUEUE: "queue.Queue[dict]" = queue.Queue(maxsize=50000)
# Recently-republished event ids (capped dedup) so we don't spam strfry.
_SEEN_IDS: dict[str, None] = {}
_SEEN_IDS_LOCK = threading.Lock()
_SEEN_IDS_MAX = 200000


def _mark_seen(eid: str) -> bool:
    """Return True if this id was newly added (i.e. NOT seen before)."""
    with _SEEN_IDS_LOCK:
        if eid in _SEEN_IDS:
            return False
        _SEEN_IDS[eid] = None
        if len(_SEEN_IDS) > _SEEN_IDS_MAX:
            # Drop the oldest 25% by re-creating the dict (approx LRU).
            keep = list(_SEEN_IDS.keys())[len(_SEEN_IDS) // 4:]
            _SEEN_IDS.clear()
            _SEEN_IDS.update(dict.fromkeys(keep))
        return True


def track_pubkey(pk: str, when: float | None = None) -> bool:
    """Add a pubkey (hex, lowercase) to the tracked set. Returns True if new."""
    pk = pk.strip().lower()
    if len(pk) != 64:
        return False
    with STATE_LOCK:
        if pk in PUBKEYS:
            PUBKEYS[pk] = when or time.time()
            return False
        if len(PUBKEYS) >= MAX_PUBKEYS:
            return False
        PUBKEYS[pk] = when or time.time()
        DISCOVERY_QUEUE.add(pk)
        return True


def touch_pubkey(pk: str) -> None:
    pk = pk.strip().lower()
    with STATE_LOCK:
        if pk in PUBKEYS:
            PUBKEYS[pk] = time.time()


def harvest_event(event: dict, source_relay: str) -> int:
    """Extract the author + all 'p' tag pubkeys from an event. Returns count of
    newly-tracked pubkeys."""
    added = 0
    author = str(event.get("pubkey", "")).lower()
    if author:
        if track_pubkey(author):
            added += 1
        else:
            touch_pubkey(author)
    for tag in event.get("tags", []) or []:
        if len(tag) >= 2 and tag[0] == "p":
            if track_pubkey(str(tag[1])):
                added += 1
    return added


def snapshot_authors() -> list[str]:
    with STATE_LOCK:
        return list(PUBKEYS.keys())


def write_allowed() -> int:
    """Write the tracked (WoT) pubkey set to ALLOWED_PATH for the write-policy."""
    os.makedirs(os.path.dirname(ALLOWED_PATH) or ".", exist_ok=True)
    with STATE_LOCK:
        pks = sorted(PUBKEYS.keys())
    tmp = ALLOWED_PATH + ".tmp"
    with open(tmp, "w") as f:
        f.write("# one hex pubkey per line; managed by scraper.py\n")
        for pk in pks:
            f.write(pk + "\n")
    os.replace(tmp, ALLOWED_PATH)
    return len(pks)


def prune() -> int:
    cutoff = time.time() - PRUNE_AGE_DAYS * 86400
    removed = 0
    with STATE_LOCK:
        for pk in [p for p, t in PUBKEYS.items() if t < cutoff]:
            PUBKEYS.pop(pk, None)
            removed += 1
            ROOT_FOLLOWS.discard(pk)
        for r in list(RELAY_INDEX.keys()):
            RELAY_INDEX[r] = {p for p in RELAY_INDEX[r] if p in PUBKEYS}
            if not RELAY_INDEX[r]:
                del RELAY_INDEX[r]
    return removed


# --------------------------------------------------------------------------- #
# WebSocket helpers
# --------------------------------------------------------------------------- #
def _ws_connect(url: str, timeout: int = 15):
    """Open a websocket with sensible defaults and a short timeout."""
    return websocket.create_connection(
        url,
        timeout=timeout,
        enable_multithread=True,
        ping_interval=30,
        ping_timeout=10,
        sslopt={"cert_reqs": ssl.CERT_NONE} if url.startswith("wss") else {},
    )


def send_req(ws, subid: str, filters: list[dict]) -> None:
    ws.send(json.dumps(["REQ", subid, *filters]))


def close_sub(ws, subid: str) -> None:
    try:
        ws.send(json.dumps(["CLOSE", subid]))
    except Exception:
        pass


def chunked(seq: list, size: int):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


# --------------------------------------------------------------------------- #
# One-shot queries (bootstrap / discover / root refresh)
# --------------------------------------------------------------------------- #
def query_relays(relays: list[str], filters: list[dict], timeout: float = 8.0) -> list[dict]:
    """Fan a REQ out to `relays`, collect EVENTs until EOSE/timeout, return all.
    Best-effort: skips relays that fail."""
    events: list[dict] = []
    threads = []

    def _pull(url: str):
        subid = "q%d" % random.randint(0, 1 << 30)
        try:
            ws = _ws_connect(url, timeout=int(timeout) + 5)
            ws.settimeout(timeout)
            send_req(ws, subid, filters)
            deadline = time.time() + timeout
            while time.time() < deadline:
                try:
                    raw = ws.recv()
                except Exception:
                    break
                if not raw:
                    continue
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if msg and msg[0] == "EVENT" and len(msg) >= 3 and msg[1] == subid:
                    events.append(msg[2])
                elif msg and msg[0] == "EOSE" and len(msg) >= 2 and msg[1] == subid:
                    break
            close_sub(ws, subid)
            ws.close()
        except Exception as e:
            log.debug("query_relays %s failed: %s", url, e)

    for url in relays:
        t = threading.Thread(target=_pull, args=(url,), name="q-%s" % url[:24], daemon=True)
        t.start()
        threads.append(t)
    for t in threads:
        t.join(timeout=timeout + 6)
    return events


def parse_follows(kind3_content: str) -> set[str]:
    """Parse a kind-3 contact list content. Handles both the classic
    [['pubkey', 'relay', 'petname'], ...] list and NIP-51 JSON shapes."""
    out: set[str] = set()
    if not kind3_content:
        return out
    try:
        data = json.loads(kind3_content)
    except json.JSONDecodeError:
        return out
    if isinstance(data, list):
        for entry in data:
            if isinstance(entry, list) and entry and isinstance(entry[0], str):
                out.add(entry[0].strip().lower())
            elif isinstance(entry, str):
                out.add(entry.strip().lower())
    elif isinstance(data, dict):
        for v in (data.get("contacts"), data.get("pubkeys")):
            if isinstance(v, list):
                for pk in v:
                    out.add(str(pk).strip().lower())
    return {p for p in out if len(p) == 64}


def parse_relay_list(events_10002: list[dict]) -> set[str]:
    """From kind 10002 (NIP-65) events, return the set of 'r' tag relay URLs.
    The root npub's relay list tells us where to look for its network."""
    out: set[str] = set()
    for ev in events_10002:
        for tag in ev.get("tags", []) or []:
            if len(tag) >= 2 and tag[0] == "r":
                out.add(str(tag[1]).strip())
    return out


# --------------------------------------------------------------------------- #
# Bootstrap / root refresh
# --------------------------------------------------------------------------- #
def bootstrap_root() -> None:
    """Fetch the root npub's kind 3 + 10002 from the seed relays."""
    if not ROOT_HEX:
        log.error("ROOT_HEX not set; cannot bootstrap")
        return
    log.info("BOOTSTRAP: fetching root npub network from %d seed relays", len(SEED_RELAYS))
    # kind 3 (follows) + kind 10002 (relay list) for the root npub.
    k3 = query_relays(SEED_RELAYS, [{"authors": [ROOT_HEX], "kinds": [3], "limit": 1}])
    k10k = query_relays(SEED_RELAYS, [{"authors": [ROOT_HEX], "kinds": [10002], "limit": 1}])

    follows: set[str] = set()
    for ev in k3:
        if str(ev.get("pubkey", "")).lower() == ROOT_HEX:
            follows |= parse_follows(ev.get("content", ""))
    root_relays = parse_relay_list(k10k) or set()

    track_pubkey(ROOT_HEX)
    with STATE_LOCK:
        ROOT_FOLLOWS.clear()
        ROOT_FOLLOWS.update(follows)
    for pk in follows:
        track_pubkey(pk)

    # Merge the root's own preferred relays into the discover pool.
    for ev in k3 + k10k:
        harvest_event(ev, "seed")

    log.info("BOOTSTRAP: root follows=%d  root relays=%d  total tracked=%d",
             len(follows), len(root_relays), len(snapshot_authors()))


def discover_pubkeys(pubkeys: list[str], relays: list[str]) -> int:
    """For the given pubkeys, fetch their kind 10002 to map pubkeys->relays."""
    if not pubkeys or not relays:
        return 0
    found = 0
    for chunk in chunked(pubkeys, MAX_AUTH_PER_REQ):
        evs = query_relays(relays, [{"authors": chunk, "kinds": [10002]}])
        for ev in evs:
            author = str(ev.get("pubkey", "")).lower()
            relays_for = parse_relay_list([ev])
            if author and relays_for:
                with STATE_LOCK:
                    for r in relays_for:
                        if len(RELAY_INDEX) >= MAX_RELAYS and r not in RELAY_INDEX:
                            break
                        RELAY_INDEX[r].add(author)
                found += 1
                track_pubkey(author)
    return found


# --------------------------------------------------------------------------- #
# Relay scrape worker (long-lived subscription per relay)
# --------------------------------------------------------------------------- #
def relay_worker(relay_url: str, stop: threading.Event) -> None:
    """Own one socket to `relay_url`, subscribe to all tracked authors (chunked)
    + a #p filter for the root npub, and republish received events. Reconnects
    with backoff on failure and re-issues subscriptions against the refreshed
    tracked set each time."""
    if websocket is None:
        log.error("websocket-client not installed; relay_worker cannot run")
        return
    backoff = RELAY_RECONNECT_BASE
    while not stop.is_set():
        try:
            ws = _ws_connect(relay_url)
        except Exception as e:
            log.warning("connect %s failed: %s (retry in %.0fs)", relay_url, e, backoff)
            stop.wait(backoff)
            backoff = min(backoff * 1.7, 120)
            continue
        backoff = RELAY_RECONNECT_BASE

        subs: list[str] = []
        try:
            # (a) chunked author subscriptions for all tracked pubkeys.
            authors = snapshot_authors()
            for i, chunk in enumerate(chunked(authors, MAX_AUTH_PER_REQ)):
                sid = "a%d" % i
                send_req(ws, sid, [{"authors": chunk, "kinds": SCRAPE_KINDS}])
                subs.append(sid)
            # (b) #p filter: events mentioning the root npub on every relay.
            if ROOT_HEX:
                send_req(ws, "proot", [{"#p": [ROOT_HEX], "kinds": P_TAG_KINDS}])
                subs.append("proot")
            log.info("scraping %s  subs=%d  authors=%d", relay_url, len(subs), len(authors))

            ws.settimeout(1.0)
            while not stop.is_set():
                try:
                    raw = ws.recv()
                except websocket.WebSocketTimeoutException:
                    continue
                except Exception as e:
                    log.info("recv %s ended: %s", relay_url, e)
                    break
                if not raw:
                    continue
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not msg:
                    continue
                tag = msg[0]
                if tag == "EVENT" and len(msg) >= 3:
                    event = msg[2]
                    eid = event.get("id")
                    if eid and _mark_seen(eid):
                        harvest_event(event, relay_url)
                        try:
                            REPUBLISH_QUEUE.put_nowait(event)
                        except queue.Full:
                            pass  # queue full; drop to avoid blocking scrape
                elif tag == "EOSE":
                    # Stored events drained — keep the sub open for live events.
                    pass
        except Exception as e:
            log.warning("relay_worker %s error: %s", relay_url, e)
        finally:
            for sid in subs:
                close_sub(ws, sid)
            try:
                ws.close()
            except Exception:
                pass
        if not stop.is_set():
            stop.wait(backoff)


# --------------------------------------------------------------------------- #
# Publisher thread (owns the strfry socket)
# --------------------------------------------------------------------------- #
def publisher_worker(stop: threading.Event) -> None:
    """Drain REPUBLISH_QUEUE and forward each event to the local strfry relay."""
    if websocket is None:
        log.error("websocket-client not installed; publisher cannot run")
        return
    ws = None
    backoff = RELAY_RECONNECT_BASE
    while not stop.is_set():
        if ws is None:
            try:
                ws = _ws_connect(STRFRY_URL, timeout=10)
                ws.settimeout(1.0)
                log.info("publisher connected to strfry %s", STRFRY_URL)
            except Exception as e:
                log.warning("publisher connect %s failed: %s (retry %.0fs)", STRFRY_URL, e, backoff)
                stop.wait(backoff)
                backoff = min(backoff * 1.7, 60)
                continue
            backoff = RELAY_RECONNECT_BASE
        try:
            event = REPUBLISH_QUEUE.get(timeout=1.0)
        except queue.Empty:
            continue
        try:
            ws.send(json.dumps(["EVENT", event]))
        except Exception as e:
            log.warning("publish failed (%s); re-queuing", e)
            try:
                REPUBLISH_QUEUE.put_nowait(event)
            except queue.Full:
                pass
            try:
                ws.close()
            except Exception:
                pass
            ws = None


# --------------------------------------------------------------------------- #
# Maintenance timers
# --------------------------------------------------------------------------- #
def maintenance_loop(stop: threading.Event) -> None:
    last_root = 0.0
    last_expand = 0.0
    last_prune = 0.0
    last_allowed_write = 0.0
    while not stop.is_set():
        now = time.time()

        if now - last_root >= ROOT_REFRESH_INTERVAL:
            last_root = now
            try:
                # Re-fetch root's replaceable kind 3 / 10002 and refresh follows.
                k3 = query_relays(SEED_RELAYS, [{"authors": [ROOT_HEX], "kinds": [3], "limit": 1}])
                for ev in k3:
                    if str(ev.get("pubkey", "")).lower() == ROOT_HEX:
                        new_f = parse_follows(ev.get("content", ""))
                        with STATE_LOCK:
                            ROOT_FOLLOWS.clear()
                            ROOT_FOLLOWS.update(new_f)
                        for pk in new_f:
                            track_pubkey(pk)
                log.info("MAINTAIN: refreshed root follows=%d", len(ROOT_FOLLOWS))
            except Exception as e:
                log.warning("root refresh failed: %s", e)

        if now - last_expand >= EXPAND_INTERVAL:
            last_expand = now
            try:
                with STATE_LOCK:
                    pending = list(DISCOVERY_QUEUE)
                    DISCOVERY_QUEUE.clear()
                relays = list(RELAY_INDEX.keys()) or SEED_RELAYS
                found = discover_pubkeys(pending, relays[:MAX_RELAYS])
                log.info("EXPAND: discovered relay lists for %d/%d pubkeys; relays=%d",
                         found, len(pending), len(RELAY_INDEX))
            except Exception as e:
                log.warning("expand failed: %s", e)

        if now - last_prune >= PRUNE_INTERVAL:
            last_prune = now
            try:
                n = prune()
                log.info("PRUNE: removed %d stale pubkeys (>%d days); tracked=%d",
                         n, PRUNE_AGE_DAYS, len(snapshot_authors()))
            except Exception as e:
                log.warning("prune failed: %s", e)

        if now - last_allowed_write >= 60:
            last_allowed_write = now
            try:
                n = write_allowed()
                log.debug("wrote allowed.npubs: %d pubkeys", n)
            except Exception as e:
                log.warning("write_allowed failed: %s", e)

        stop.wait(15)


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main() -> int:
    if websocket is None:
        log.error("FATAL: 'websocket-client' library not installed. "
                  "Install with: pip install websocket-client  "
                  "(Alpine: apk add py3-websocket-client)")
        return 2
    if not ROOT_HEX:
        log.error("FATAL: ROOT_HEX env var not set")
        return 2

    log.info("scraper starting: root=%s... seed_relays=%s max_pubkeys=%d strfry=%s",
             ROOT_HEX[:12], SEED_RELAYS, MAX_PUBKEYS, STRFRY_URL)
    os.makedirs(STATE_DIR, exist_ok=True)

    # 1. Bootstrap from seed relays (blocking) so workers start with a real set.
    bootstrap_root()

    # 2. Discover relay lists for the initial follow set.
    with STATE_LOCK:
        initial = list(ROOT_FOLLOWS) if ROOT_FOLLOWS else snapshot_authors()
    discover_pubkeys(initial, SEED_RELAYS)

    # 3. Seed the allowed.npubs immediately.
    write_allowed()

    stop = threading.Event()
    threads: list[threading.Thread] = []

    # Publisher thread.
    threads.append(threading.Thread(target=publisher_worker, args=(stop,),
                                    name="publisher", daemon=True))

    # One scrape worker per relay we know about (seed + discovered, capped).
    with STATE_LOCK:
        scrape_relays = list(dict.fromkeys(list(RELAY_INDEX.keys()) + SEED_RELAYS))[:MAX_RELAYS]
    for url in scrape_relays:
        safe = url.replace("wss://", "").replace("ws://", "")[:20]
        threads.append(threading.Thread(target=relay_worker, args=(url, stop),
                                        name="relay:%s" % safe, daemon=True))

    # Maintenance thread.
    threads.append(threading.Thread(target=maintenance_loop, args=(stop,),
                                    name="maintain", daemon=True))

    for t in threads:
        t.start()
    log.info("started %d threads (publisher + %d relay workers + maintain)",
             len(threads), len(scrape_relays))

    def _shutdown(signum, frame):
        log.info("shutdown signal %d received", signum)
        stop.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, _shutdown)
        except Exception:
            pass

    try:
        while not stop.is_set():
            stop.wait(5)
    except KeyboardInterrupt:
        stop.set()

    log.info("scraper stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
