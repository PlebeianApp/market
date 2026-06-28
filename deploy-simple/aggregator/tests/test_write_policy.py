"""Tests for the dual-mode write-policy plugin (write-policy.py).

Covers the core contract the PR introduces:

  * PUBLIC market kinds are accepted from ANY pubkey (stranger included).
  * RESTRICTED kinds (gift-wrap 1059/1060, NIP-78 30078, seals/order-comms/
    payment 13/14/16/17, NIP-60 17375) are accepted ONLY from the root npub or
    the WoT allowlist, rejected from anyone else.
  * Every other kind is rejected.
  * The allowlist file hot-reloads on mtime change (no restart needed).
  * The real ``main()`` entrypoint honours all of the above over stdin/stdout,
    matching strfry's plugin protocol.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

# write-policy.py is hyphenated and therefore not importable by name; load it
# explicitly from its file path under the name "write_policy".
HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / "write-policy.py"
import importlib.util as _ilu

_spec = _ilu.spec_from_file_location("write_policy", SCRIPT)
write_policy = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(write_policy)

ROOT_HEX = "a" * 64        # the configured root npub (lowercase hex)
STRANGER = "b" * 64        # an arbitrary, untrusted pubkey
WOT_MEMBER = "c" * 64      # a pubkey listed in allowed.npubs


# --------------------------------------------------------------------------- #
# _decide(): the pure kind gate
# --------------------------------------------------------------------------- #
@pytest.fixture
def wp(monkeypatch):
    """write_policy module pinned to a known ROOT_HEX."""
    monkeypatch.setattr(write_policy, "ROOT_HEX", ROOT_HEX)
    return write_policy


# PUBLIC market kinds MUST be accepted from anyone (the whole point of the
# relay: mirror public market data broadly).
PUBLIC_SAMPLES = [
    0, 1, 3, 5, 7, 4, 1111,                  # identity / social
    30018, 30402, 30405, 30406, 30408,       # marketplace listings
    30440, 30441, 30442, 31555,              # auction / curated
    31989, 31990,                            # app handlers
    9735, 1985,                              # payments & trust
    10000, 10002, 30000,                     # lists & settings
    1023, 1024, 1025, 1026,                  # NWC endpoints
    25910,                                   # misc app
]


@pytest.mark.parametrize("kind", PUBLIC_SAMPLES)
def test_public_kinds_accepted_from_stranger(wp, kind):
    action, msg = wp._decide(STRANGER, kind, allowed=set())
    assert action == "accept"
    assert msg == ""


# RESTRICTED kinds: gated to root + WoT allowlist.
RESTRICTED_SAMPLES = [1059, 1060, 30078, 13, 14, 16, 17, 17375]


@pytest.mark.parametrize("kind", RESTRICTED_SAMPLES)
def test_restricted_rejected_from_stranger(wp, kind):
    action, msg = wp._decide(STRANGER, kind, allowed=set())
    assert action == "reject"
    assert "restricted" in msg.lower()


@pytest.mark.parametrize("kind", RESTRICTED_SAMPLES)
def test_restricted_accepted_from_root(wp, kind):
    assert wp._decide(ROOT_HEX, kind, allowed=set()) == ("accept", "")


@pytest.mark.parametrize("kind", RESTRICTED_SAMPLES)
def test_restricted_accepted_from_wot_member(wp, kind):
    assert wp._decide(WOT_MEMBER, kind, allowed={WOT_MEMBER}) == ("accept", "")


# Unknown kinds are rejected even from root (root is not a free pass for junk).
UNKNOWN_SAMPLES = [2, 6, 8, 40, 1000, 9999, 30019, 40000, -1]


@pytest.mark.parametrize("kind", UNKNOWN_SAMPLES)
def test_unknown_kinds_rejected_even_from_root(wp, kind):
    action, msg = wp._decide(ROOT_HEX, kind, allowed={ROOT_HEX})
    assert action == "reject"
    assert "not in market set" in msg.lower()


def test_public_and_restricted_sets_are_disjoint(wp):
    """A kind can never be both public (anyone) and restricted (gated)."""
    assert write_policy.PUBLIC_MARKET_KINDS.isdisjoint(write_policy.RESTRICTED_KINDS)


# --------------------------------------------------------------------------- #
# _load_allowlist()
# --------------------------------------------------------------------------- #
def test_load_allowlist_reads_hex_pubkeys(wp, tmp_path):
    f = tmp_path / "allowed.npubs"
    f.write_text("# comment line\n\n" + WOT_MEMBER + "\n" + ROOT_HEX + "\n")
    write_policy.ALLOWED_PATH = f  # read at call time
    allowed, mtime = wp._load_allowlist()
    assert allowed == {WOT_MEMBER, ROOT_HEX}
    assert mtime > 0


def test_load_allowlist_missing_file_returns_empty(wp, tmp_path):
    write_policy.ALLOWED_PATH = tmp_path / "does-not-exist"
    allowed, mtime = wp._load_allowlist()
    assert allowed == set()
    assert mtime == 0.0


def test_load_allowlist_ignores_comments_and_blanks(wp, tmp_path):
    f = tmp_path / "allowed.npubs"
    f.write_text("# header\n   \n" + ROOT_HEX + "\n#not a pubkey\n")
    write_policy.ALLOWED_PATH = f
    allowed, _ = wp._load_allowlist()
    assert allowed == {ROOT_HEX}


# --------------------------------------------------------------------------- #
# main(): the real strfry plugin protocol over stdin/stdout
# --------------------------------------------------------------------------- #
def _event(eid, pubkey, kind):
    return {"id": eid, "pubkey": pubkey, "kind": kind,
            "content": "", "tags": [], "sig": ""}


def _line(ev):
    return json.dumps({"type": "new", "event": ev,
                       "receivedAt": int(time.time()),
                       "sourceType": "IP4", "sourceInfo": "1.2.3.4"})


def _env(tmp_path, allowed_content=""):
    allowed = tmp_path / "allowed.npubs"
    allowed.write_text(allowed_content)
    env = dict(os.environ)
    env["STRFRY_AGG_ROOT_HEX"] = ROOT_HEX
    env["STRFRY_AGG_ALLOWED"] = str(allowed)
    return env


def _run_policy(env, lines):
    """Feed JSON lines to write-policy.py, return parsed stdout responses."""
    proc = subprocess.run(
        [sys.executable, str(SCRIPT)],
        input="\n".join(lines) + "\n",
        capture_output=True, text=True, env=env, timeout=30,
    )
    assert proc.returncode == 0, f"stderr: {proc.stderr!r}"
    return [json.loads(l) for l in proc.stdout.splitlines() if l.strip()]


def test_main_accepts_public_kind_from_stranger(tmp_path):
    resps = _run_policy(_env(tmp_path), [_line(_event("e1", STRANGER, 30402))])
    assert resps == [{"id": "e1", "action": "accept"}]


def test_main_rejects_restricted_kind_from_stranger(tmp_path):
    resps = _run_policy(_env(tmp_path), [_line(_event("e2", STRANGER, 1060))])
    assert resps[0]["id"] == "e2"
    assert resps[0]["action"] == "reject"
    assert "msg" in resps[0]


def test_main_accepts_restricted_kind_from_root(tmp_path):
    resps = _run_policy(_env(tmp_path), [_line(_event("e3", ROOT_HEX, 1060))])
    assert resps == [{"id": "e3", "action": "accept"}]


def test_main_lowercases_pubkey_so_uppercase_root_is_accepted(tmp_path):
    # main() lowercases the incoming pubkey before _decide; ROOT_HEX is stored
    # lowercased, so an all-caps root pubkey must still match.
    resps = _run_policy(_env(tmp_path), [_line(_event("e4", ROOT_HEX.upper(), 30078))])
    assert resps == [{"id": "e4", "action": "accept"}]


def test_main_accepts_restricted_kind_from_wot_member(tmp_path):
    env = _env(tmp_path, allowed_content=WOT_MEMBER + "\n")
    resps = _run_policy(env, [_line(_event("e5", WOT_MEMBER, 1059))])
    assert resps == [{"id": "e5", "action": "accept"}]


def test_main_rejects_restricted_kind_after_wot_member_removed(tmp_path):
    env = _env(tmp_path, allowed_content="")  # allowlist empty
    resps = _run_policy(env, [_line(_event("e5b", WOT_MEMBER, 1059))])
    assert resps[0]["action"] == "reject"


def test_main_ignores_non_new_messages_and_garbage(tmp_path):
    lines = [
        json.dumps({"type": "old", "event": _event("x", STRANGER, 1)}),  # wrong type
        "this is not json {",                                              # garbage
        "",                                                                # blank
        _line(_event("e6", STRANGER, 30405)),                             # valid
    ]
    resps = _run_policy(_env(tmp_path), lines)
    assert [r["id"] for r in resps] == ["e6"]


def test_main_skips_events_without_id_or_pubkey(tmp_path):
    lines = [
        _line({"id": "", "pubkey": STRANGER, "kind": 1}),   # missing id
        _line({"id": "e7", "pubkey": "", "kind": 1}),        # missing pubkey
        _line(_event("e8", STRANGER, 1)),                    # valid
    ]
    resps = _run_policy(_env(tmp_path), lines)
    assert [r["id"] for r in resps] == ["e8"]


def test_main_response_is_minified_json(tmp_path):
    resps = _run_policy(_env(tmp_path), [_line(_event("e9", STRANGER, 0))])
    # re-serialise minified and compare: confirms no pretty-print whitespace.
    assert json.dumps(resps[0], separators=(",", ":")) == '{"id":"e9","action":"accept"}'


def test_main_hot_reloads_allowlist_on_mtime_change(tmp_path):
    """A mid-stream change to allowed.npubs is picked up without restart.

    This is the contract the scraper's maintain timer relies on: it rewrites
    allowed.npubs in place and the running plugin must serve the new set.
    """
    allowed = tmp_path / "allowed.npubs"
    allowed.write_text("# empty allowlist\n")
    env = dict(os.environ)
    env["STRFRY_AGG_ROOT_HEX"] = ROOT_HEX
    env["STRFRY_AGG_ALLOWED"] = str(allowed)

    proc = subprocess.Popen(
        [sys.executable, str(SCRIPT)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=env,
    )
    try:
        # Stranger's gift-wrap is rejected while the allowlist is empty.
        proc.stdin.write(_line(_event("h1", STRANGER, 1060)) + "\n")
        proc.stdin.flush()
        r1 = json.loads(proc.stdout.readline())
        assert r1["id"] == "h1" and r1["action"] == "reject"

        # Scraper rewrites the allowlist to include the stranger.
        time.sleep(0.3)  # ensure mtime differs on coarse-grained filesystems
        allowed.write_text(STRANGER + "\n")

        # Same event kind is now accepted — no restart happened.
        proc.stdin.write(_line(_event("h2", STRANGER, 1060)) + "\n")
        proc.stdin.flush()
        assert json.loads(proc.stdout.readline()) == {"id": "h2", "action": "accept"}
    finally:
        proc.stdin.close()
        proc.wait(timeout=10)
