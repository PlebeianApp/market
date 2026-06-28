"""Tests for the scraper daemon (scraper.py).

The daemon's network plumbing (websocket I/O, relay connections) is I/O; this
suite pins down the *logic* that decides what gets mirrored:

  * ``track_pubkey`` / ``harvest_event`` — which pubkeys join the tracked WoT
    set (and the 64-hex + MAX_PUBKEYS guards).
  * ``_mark_seen`` — per-event dedup with bounded LRU eviction (so the same
    event is never republished twice, and memory can't grow unbounded).
  * ``parse_follows`` / ``parse_relay_list`` — bootstrap/discovery parsing.
  * ``write_allowed`` — emitting the WoT set the write-policy gates on.
  * ``prune`` — expiring stale pubkeys.
  * ``discover_pubkeys`` — building the (pubkey -> relay) index.
  * ``relay_worker`` — end-to-end mirror path: subscription REQ construction
    (chunked authors + #p filter over SCRAPE_KINDS) and the receive -> dedup ->
    harvest -> republish loop.
"""
import json
import time
import types

import pytest

import scraper

PK1 = "1" * 64
PK2 = "2" * 64
PK3 = "3" * 64
PK_BAD = "not-hex-!"     # invalid characters / wrong length
PK_SHORT = "a" * 32      # wrong length


# --------------------------------------------------------------------------- #
# Shared state reset between every test (scraper uses module-level dicts).
# --------------------------------------------------------------------------- #
@pytest.fixture(autouse=True)
def reset_state():
    scraper.PUBKEYS.clear()
    scraper.RELAY_INDEX.clear()
    scraper.DISCOVERY_QUEUE.clear()
    scraper.ROOT_FOLLOWS.clear()
    with scraper._SEEN_IDS_LOCK:
        scraper._SEEN_IDS.clear()
    # drain republish queue
    while True:
        try:
            scraper.REPUBLISH_QUEUE.get_nowait()
        except scraper.queue.Empty:
            break
    yield


# --------------------------------------------------------------------------- #
# track_pubkey
# --------------------------------------------------------------------------- #
def test_track_pubkey_adds_new():
    assert scraper.track_pubkey(PK1) is True
    assert PK1 in scraper.PUBKEYS
    assert PK1 in scraper.DISCOVERY_QUEUE


def test_track_pubkey_rejects_invalid():
    assert scraper.track_pubkey(PK_BAD) is False
    assert scraper.track_pubkey(PK_SHORT) is False
    assert scraper.track_pubkey("") is False
    assert scraper.track_pubkey("   ") is False
    assert scraper.PUBKEYS == {}


def test_track_pubkey_normalises_case():
    assert scraper.track_pubkey(PK1.upper()) is True
    assert PK1 in scraper.PUBKEYS            # stored lowercase


def test_track_pubkey_duplicate_returns_false_and_refreshes_ts():
    scraper.track_pubkey(PK1, when=100.0)
    assert scraper.PUBKEYS[PK1] == 100.0
    assert scraper.track_pubkey(PK1, when=999.0) is False
    assert scraper.PUBKEYS[PK1] == 999.0


def test_track_pubkey_respects_max_cap(monkeypatch):
    monkeypatch.setattr(scraper, "MAX_PUBKEYS", 2)
    assert scraper.track_pubkey(PK1) is True
    assert scraper.track_pubkey(PK2) is True
    assert scraper.track_pubkey(PK3) is False        # capped
    assert PK3 not in scraper.PUBKEYS


# --------------------------------------------------------------------------- #
# touch_pubkey
# --------------------------------------------------------------------------- #
def test_touch_pubkey_updates_known_timestamp():
    scraper.track_pubkey(PK1, when=1.0)
    scraper.touch_pubkey(PK1)
    assert scraper.PUBKEYS[PK1] > 1.0


def test_touch_pubkey_ignores_unknown():
    scraper.touch_pubkey(PK2)
    assert PK2 not in scraper.PUBKEYS


# --------------------------------------------------------------------------- #
# harvest_event
# --------------------------------------------------------------------------- #
def _ev(author, p_tags=(), kind=1, eid=None):
    return {"id": eid or (author + "0"), "pubkey": author, "kind": kind,
            "tags": [["p", p] for p in p_tags]}


def test_harvest_tracks_author_and_ptags():
    added = scraper.harvest_event(_ev(PK1, p_tags=[PK2, PK3]), "seed")
    assert added == 3
    assert {PK1, PK2, PK3} <= set(scraper.PUBKEYS)


def test_harvest_dedups_already_tracked():
    scraper.track_pubkey(PK1)
    added = scraper.harvest_event(_ev(PK1, p_tags=[PK1]), "seed")
    assert added == 0


def test_harvest_ignores_invalid_ptags():
    added = scraper.harvest_event(_ev(PK1, p_tags=[PK_BAD, "x"]), "seed")
    assert added == 1            # only the author; bad p-tags dropped


def test_harvest_handles_missing_tags():
    assert scraper.harvest_event({"pubkey": PK1, "kind": 1, "tags": None}, "s") == 1
    assert scraper.harvest_event({"pubkey": PK1, "kind": 1}, "s") == 0  # already tracked


# --------------------------------------------------------------------------- #
# parse_follows (kind-3 contact list)
# --------------------------------------------------------------------------- #
def test_parse_follows_classic_list():
    content = json.dumps([[PK1, "wss://r", "alice"], [PK2, "wss://r2"]])
    assert scraper.parse_follows(content) == {PK1, PK2}


def test_parse_follows_nip51_dict():
    content = json.dumps({"contacts": [PK1, PK2], "pubkeys": [PK3]})
    assert scraper.parse_follows(content) == {PK1, PK2, PK3}


def test_parse_follows_bare_string_list():
    assert scraper.parse_follows(json.dumps([PK1, PK2])) == {PK1, PK2}


def test_parse_follows_filters_non_64hex():
    assert scraper.parse_follows(json.dumps([PK1, "short", "ZZZZ", PK2])) == {PK1, PK2}


def test_parse_follows_empty_and_invalid():
    assert scraper.parse_follows("") == set()
    assert scraper.parse_follows("not json") == set()
    assert scraper.parse_follows(None) == set()


# --------------------------------------------------------------------------- #
# parse_relay_list (kind-10002 r-tags)
# --------------------------------------------------------------------------- #
def test_parse_relay_list_extracts_r_tags():
    evs = [{"tags": [["r", "wss://a"], ["r", "wss://b"], ["p", PK1]]}]
    assert scraper.parse_relay_list(evs) == {"wss://a", "wss://b"}


def test_parse_relay_list_empty_inputs():
    assert scraper.parse_relay_list([]) == set()
    assert scraper.parse_relay_list([{"tags": []}]) == set()
    assert scraper.parse_relay_list([{}]) == set()


# --------------------------------------------------------------------------- #
# chunked
# --------------------------------------------------------------------------- #
def test_chunked_even():
    assert list(scraper.chunked([1, 2, 3, 4], 2)) == [[1, 2], [3, 4]]


def test_chunked_uneven_tail():
    assert list(scraper.chunked([1, 2, 3, 4, 5], 2)) == [[1, 2], [3, 4], [5]]


def test_chunked_empty():
    assert list(scraper.chunked([], 3)) == []


# --------------------------------------------------------------------------- #
# _mark_seen (dedup + bounded LRU eviction)
# --------------------------------------------------------------------------- #
def test_mark_seen_new_then_duplicate():
    assert scraper._mark_seen("id1") is True
    assert scraper._mark_seen("id1") is False
    assert scraper._mark_seen("id2") is True


def test_mark_seen_evicts_oldest_quarter_over_cap(monkeypatch):
    monkeypatch.setattr(scraper, "_SEEN_IDS_MAX", 4)
    with scraper._SEEN_IDS_LOCK:
        scraper._SEEN_IDS.clear()
    for i in range(5):                 # pushes len past cap (4)
        scraper._mark_seen("id%d" % i)
    with scraper._SEEN_IDS_LOCK:
        assert "id0" not in scraper._SEEN_IDS     # oldest 25% evicted
        assert "id4" in scraper._SEEN_IDS
    # An evicted id is "new" again (no unbounded retention).
    assert scraper._mark_seen("id0") is True


# --------------------------------------------------------------------------- #
# write_allowed (emits the WoT set the write-policy gates on)
# --------------------------------------------------------------------------- #
def test_write_allowed_writes_sorted_pubkeys(tmp_path, monkeypatch):
    monkeypatch.setattr(scraper, "ALLOWED_PATH", str(tmp_path / "allowed.npubs"))
    scraper.track_pubkey(PK2)
    scraper.track_pubkey(PK1)
    n = scraper.write_allowed()
    assert n == 2
    lines = (tmp_path / "allowed.npubs").read_text().splitlines()
    assert lines[0].startswith("#")
    assert [l for l in lines if not l.startswith("#")] == [PK1, PK2]   # sorted


def test_write_allowed_leaves_no_tmp_file(tmp_path, monkeypatch):
    monkeypatch.setattr(scraper, "ALLOWED_PATH", str(tmp_path / "allowed.npubs"))
    scraper.write_allowed()
    assert (tmp_path / "allowed.npubs").exists()
    assert not (tmp_path / "allowed.npubs.tmp").exists()


def test_write_allowed_creates_missing_dirs(tmp_path, monkeypatch):
    nested = tmp_path / "state" / "deep" / "allowed.npubs"
    monkeypatch.setattr(scraper, "ALLOWED_PATH", str(nested))
    scraper.write_allowed()
    assert nested.exists()


# --------------------------------------------------------------------------- #
# prune (expire stale pubkeys)
# --------------------------------------------------------------------------- #
def test_prune_removes_stale_only(monkeypatch):
    monkeypatch.setattr(scraper, "PRUNE_AGE_DAYS", 1)
    scraper.PUBKEYS[PK1] = time.time() - 2 * 86400     # 2 days old -> gone
    scraper.PUBKEYS[PK2] = time.time()                 # fresh -> kept
    removed = scraper.prune()
    assert removed == 1
    assert PK1 not in scraper.PUBKEYS and PK2 in scraper.PUBKEYS


def test_prune_cleans_relay_index(monkeypatch):
    monkeypatch.setattr(scraper, "PRUNE_AGE_DAYS", 1)
    scraper.PUBKEYS[PK1] = time.time() - 2 * 86400
    scraper.RELAY_INDEX["wss://r"].add(PK1)
    scraper.prune()
    assert "wss://r" not in scraper.RELAY_INDEX         # emptied -> deleted


# --------------------------------------------------------------------------- #
# discover_pubkeys (build pubkey->relay index; query_relays mocked = no network)
# --------------------------------------------------------------------------- #
def test_discover_pubkeys_builds_relay_index(monkeypatch):
    canned = [
        {"pubkey": PK1, "tags": [["r", "wss://one"]]},
        {"pubkey": PK2, "tags": [["r", "wss://two"]]},
    ]
    monkeypatch.setattr(scraper, "query_relays",
                        lambda relays, filters, timeout=8.0: canned)
    found = scraper.discover_pubkeys([PK1, PK2], ["wss://seed"])
    assert found == 2
    assert scraper.RELAY_INDEX["wss://one"] == {PK1}
    assert scraper.RELAY_INDEX["wss://two"] == {PK2}


def test_discover_pubkeys_chunks_authors(monkeypatch):
    calls = []

    def fake_query(relays, filters, timeout=8.0):
        calls.append(filters)
        return []

    monkeypatch.setattr(scraper, "query_relays", fake_query)
    monkeypatch.setattr(scraper, "MAX_AUTH_PER_REQ", 1)
    scraper.discover_pubkeys([PK1, PK2, PK3], ["wss://seed"])
    assert len(calls) == 3                              # one REQ per author


def test_discover_pubkeys_empty_inputs():
    assert scraper.discover_pubkeys([], ["wss://seed"]) == 0
    assert scraper.discover_pubkeys([PK1], []) == 0


# --------------------------------------------------------------------------- #
# Mirror pipeline: the receive -> dedup -> harvest -> republish path that
# relay_worker runs for every EVENT. Tested directly (deterministic) and then
# end-to-end through relay_worker itself.
# --------------------------------------------------------------------------- #
def test_mirror_pipeline_dedups_and_harvests():
    ev = _ev(PK1, p_tags=[PK2], kind=30402, eid="evt-123")
    # first sighting: new -> harvest (tracks PK2) -> enqueue
    assert scraper._mark_seen(ev["id"]) is True
    scraper.harvest_event(ev, "wss://r")
    scraper.REPUBLISH_QUEUE.put_nowait(ev)
    # duplicate sighting: dedup blocks the second enqueue
    assert scraper._mark_seen(ev["id"]) is False
    assert scraper.REPUBLISH_QUEUE.qsize() == 1
    out = scraper.REPUBLISH_QUEUE.get_nowait()
    assert out["id"] == "evt-123"
    assert PK2 in scraper.PUBKEYS                        # harvested p-tag


# A fake websocket + fake `websocket` module so relay_worker runs without the
# real websocket-client dependency installed.
class _FakeWS:
    def __init__(self, frames):
        self._frames = list(frames)
        self.sent = []

    def send(self, data):
        self.sent.append(data)

    def settimeout(self, _t):
        pass

    def recv(self):
        if self._frames:
            return self._frames.pop(0)
        raise ConnectionError("simulated disconnect")   # breaks the recv loop

    def close(self):
        pass


@pytest.fixture
def fake_ws_module(monkeypatch):
    """Stand in for the optional `websocket` import so relay_worker proceeds."""
    mod = types.SimpleNamespace()

    class WebSocketTimeoutException(Exception):
        pass

    mod.WebSocketTimeoutException = WebSocketTimeoutException
    monkeypatch.setattr(scraper, "websocket", mod)
    return mod


def test_relay_worker_subscribes_and_mirrors(monkeypatch, fake_ws_module):
    """relay_worker issues chunked-author + #p subscriptions over SCRAPE_KINDS,
    then mirrors received events (deduped) into the republish queue and harvests
    their p-tags into the tracked set."""
    monkeypatch.setattr(scraper, "ROOT_HEX", PK3)
    monkeypatch.setattr(scraper, "RELAY_RECONNECT_BASE", 0.01)
    scraper.track_pubkey(PK1)

    ev_a = {"id": "a" * 64, "pubkey": PK1, "kind": 30402, "tags": [["p", PK2]]}
    ev_b = {"id": "b" * 64, "pubkey": PK2, "kind": 30405, "tags": []}
    frames = [
        json.dumps(["EVENT", "s", ev_a]),
        json.dumps(["EVENT", "s", ev_a]),   # duplicate -> must not re-mirror
        json.dumps(["EOSE", "s"]),
        json.dumps(["EVENT", "s", ev_b]),
    ]
    fake = _FakeWS(frames)
    monkeypatch.setattr(scraper, "_ws_connect", lambda url, timeout=15: fake)

    stop = scraper.threading.Event()
    t = scraper.threading.Thread(target=scraper.relay_worker,
                                 args=("wss://x", stop), daemon=True)
    t.start()

    # wait for the worker to mirror the two unique events
    deadline = time.time() + 5
    while time.time() < deadline and scraper.REPUBLISH_QUEUE.qsize() < 2:
        time.sleep(0.02)
    stop.set()
    t.join(timeout=2)
    assert not t.is_alive(), "relay_worker did not shut down"

    mirrored = []
    while not scraper.REPUBLISH_QUEUE.empty():
        mirrored.append(scraper.REPUBLISH_QUEUE.get_nowait()["id"])
    assert mirrored.count("a" * 64) == 1     # deduped
    assert "b" * 64 in mirrored
    assert PK2 in scraper.PUBKEYS            # p-tag harvested

    # filtering: at least one REQ carried an authors filter over SCRAPE_KINDS
    reqs = [json.loads(s) for s in fake.sent if s]
    subs = [r for r in reqs if r and r[0] == "REQ"]
    assert subs, "relay_worker never issued a subscription"
    author_subs = [r for r in subs if any("authors" in f for f in r[2:])]
    assert author_subs, "no chunked-author subscription was sent"
    kinds = author_subs[0][2]["kinds"]
    assert set(scraper.SCRAPE_KINDS) <= set(kinds)
    # and a #p filter for the root npub was issued
    assert any(any("#p" in f for f in r[2:]) for r in subs)
