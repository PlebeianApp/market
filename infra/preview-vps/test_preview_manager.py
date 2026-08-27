#!/usr/bin/env python3
"""Unit tests for infra/preview-vps/preview_manager.py.

Runs locally without a VPS. The manager is designed so every external effect
(docker, gh/curl, Cloudflare, Caddy access logs) is isolated behind pure
functions or Runner shims, so the decision logic — idle detection, wake logic,
recency ranking, cleanup — is fully testable here.

Run:  python3 -m pytest infra/preview-vps/test_preview_manager.py
"""

from __future__ import annotations

import datetime as dt
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(
    0,
    str(Path(__file__).resolve().parent),
)

import preview_manager as pm  # noqa: E402


def _ts(hour: int, minute: int = 0) -> dt.datetime:
    return dt.datetime(2026, 8, 27, hour, minute, tzinfo=dt.timezone.utc)


# ── parse_access_log_lines ────────────────────────────────────────────────────

def test_parses_json_caddy_log_line():
    line = (
        '{"level":"info","ts":1787851800.0,"logger":"http.log.access",'
        '"request":{"host":"pr42.test-market.orangesync.tech"},'
        '"time":"2026-08-27T12:00:00Z"}'
    )
    result = pm.parse_access_log_lines([line])
    assert result == [(42, dt.datetime(2026, 8, 27, 12, 0, tzinfo=dt.timezone.utc))]


def test_parses_bare_rfc3339_line():
    line = "pr7.test-market.orangesync.tech 2026-08-27T09:30:00+00:00 GET /"
    result = pm.parse_access_log_lines([line])
    assert result[0][0] == 7


def test_ignores_non_preview_lines():
    lines = [
        "2026-08-27T12:00:00Z some.other.domain /",
        "2026-08-27T12:00:00Z /favicon.ico",
        "",
    ]
    assert pm.parse_access_log_lines(lines) == []


def test_sorts_newest_first():
    lines = [
        '{"request":{"host":"pr1.test-market.orangesync.tech"},"time":"2026-08-27T08:00:00Z"}',
        '{"request":{"host":"pr2.test-market.orangesync.tech"},"time":"2026-08-27T10:00:00Z"}',
        '{"request":{"host":"pr3.test-market.orangesync.tech"},"time":"2026-08-27T09:00:00Z"}',
    ]
    result = pm.parse_access_log_lines(lines)
    assert [p for p, _ in result] == [2, 3, 1]


# ── is_idle ───────────────────────────────────────────────────────────────────

def test_idle_when_no_access():
    assert pm.is_idle(None, now=_ts(12), idle_hours=4) is True


def test_not_idle_when_recently_accessed():
    assert pm.is_idle(_ts(10), now=_ts(12), idle_hours=4) is False


def test_idle_when_older_than_threshold():
    # Accessed at 07:00, now 12:00 → 5h > 4h idle threshold.
    assert pm.is_idle(_ts(7), now=_ts(12), idle_hours=4) is True


def test_boundary_not_idle():
    # Exactly at the threshold is not yet idle.
    assert pm.is_idle(_ts(8), now=_ts(12), idle_hours=4) is False


# ── last_access_by_pr ─────────────────────────────────────────────────────────

def test_last_access_by_pr_keeps_newest_per_pr():
    previews = [
        pm.Preview(pr_number=1, directory=Path("pr-1"), last_access=None, running=True),
        pm.Preview(pr_number=2, directory=Path("pr-2"), last_access=None, running=True),
    ]
    entries = [
        (1, _ts(8)),
        (1, _ts(10)),  # newer entry for the same PR
        (2, _ts(9)),
    ]
    result = pm.last_access_by_pr(previews, entries)
    assert result[1] == _ts(10)
    assert result[2] == _ts(9)


def test_last_access_by_pr_defaults_none_for_unseen():
    previews = [
        pm.Preview(pr_number=1, directory=Path("pr-1"), last_access=None, running=True),
        pm.Preview(pr_number=2, directory=Path("pr-2"), last_access=None, running=True),
    ]
    result = pm.last_access_by_pr(previews, [(1, _ts(10))])
    assert result[1] == _ts(10)
    assert result[2] is None


# ── wake_preview_by_domain ────────────────────────────────────────────────────

def test_wake_matches_subdomain_and_starts_stopped(monkeypatch):
    previews = [
        pm.Preview(pr_number=42, directory=Path("pr-42"), last_access=None, running=False),
    ]
    started: list[int] = []

    def fake_start(p: pm.Preview) -> bool:
        started.append(p.pr_number)
        return True

    ok = pm.wake_preview_by_domain(
        "pr42.test-market.orangesync.tech", previews, "test-market.orangesync.tech", start_fn=fake_start
    )
    assert ok is True
    assert started == [42]


def test_wake_noop_when_already_running(monkeypatch):
    previews = [
        pm.Preview(pr_number=42, directory=Path("pr-42"), last_access=None, running=True),
    ]
    started: list[int] = []

    def fake_start(p: pm.Preview) -> bool:
        started.append(p.pr_number)
        return True

    ok = pm.wake_preview_by_domain(
        "pr42.test-market.orangesync.tech", previews, "test-market.orangesync.tech", start_fn=fake_start
    )
    assert ok is True
    assert started == []


def test_wake_ignores_non_preview_domain():
    previews = [
        pm.Preview(pr_number=42, directory=Path("pr-42"), last_access=None, running=False),
    ]
    started: list[int] = []

    def fake_start(p: pm.Preview) -> bool:
        started.append(p.pr_number)
        return True

    ok = pm.wake_preview_by_domain(
        "nsite.orangesync.tech", previews, "test-market.orangesync.tech", start_fn=fake_start
    )
    assert ok is False
    assert started == []


# ── run_cycle: idle stop + recency ranking + teardown ────────────────────────

class _FakeRunner:
    """In-memory subprocess shim: records argv, returns canned output."""

    def __init__(self) -> None:
        self.calls: list[list[str]] = []
        self._responses: dict[str, str] = {}

    def respond(self, argv_contains: str, output: str) -> None:
        self._responses[argv_contains] = output

    def run(self, argv, timeout=60):
        self.calls.append(list(argv))
        joined = " ".join(argv)
        for key, out in self._responses.items():
            if key in joined:
                return out
        return ""


@pytest.fixture
def preview_tree(tmp_path: Path) -> Path:
    """Create pr-1 (running) and pr-2 (running) preview dirs with compose files."""
    for n in (1, 2):
        d = tmp_path / f"pr-{n}"
        d.mkdir()
        (d / "docker-compose.yml").write_text("services: {}\n")
    return tmp_path


def test_run_cycle_stops_idle_preview(tmp_path, monkeypatch):
    root = tmp_path / "previews"
    (root / "pr-1").mkdir(parents=True)
    (root / "pr-2").mkdir(parents=True)
    (root / "pr-1" / "docker-compose.yml").write_text("services: {}\n")
    (root / "pr-2" / "docker-compose.yml").write_text("services: {}\n")

    fake = _FakeRunner()
    fake.respond("compose", "running")
    monkeypatch.setattr(pm, "Runner", lambda: fake)
    # Both pr-1 and pr-2 are open; pr-1 recently accessed, pr-2 idle.
    monkeypatch.setattr(
        pm, "open_pr_numbers", lambda *a, **k: [1, 2]
    )

    log = root / "access.log"
    log.write_text(
        '{"request":{"host":"pr1.test-market.orangesync.tech"},"time":"2026-08-27T11:00:00Z"}\n'
        '{"request":{"host":"pr2.test-market.orangesync.tech"},"time":"2026-08-27T07:00:00Z"}\n'
    )

    result = pm.run_cycle(
        root,
        now=_ts(12),
        idle_hours=4,
        top_k=5,
        log_paths=[log],
        gh_repo="org/repo",
        dry_run=True,
    )
    # pr-2 accessed at 07:00, now 12:00 → idle (5h). pr-1 accessed 11:00 → not idle.
    assert 2 in result["stopped"]
    assert 1 not in result["stopped"]
    assert result["torn_down"] == []


def test_run_cycle_recency_stops_non_top_k(tmp_path, monkeypatch):
    root = tmp_path / "previews"
    for n in (1, 2, 3):
        d = root / f"pr-{n}"
        d.mkdir(parents=True)
        (d / "docker-compose.yml").write_text("services: {}\n")

    fake = _FakeRunner()
    fake.respond("compose", "running")
    monkeypatch.setattr(pm, "Runner", lambda: fake)
    # All three open, all recently accessed (none idle), top_k=2 → pr-3 is
    # the least recently pushed and should be stopped despite being non-idle.
    monkeypatch.setattr(pm, "open_pr_numbers", lambda *a, **k: [1, 2, 3])
    log = root / "access.log"
    log.write_text(
        '{"request":{"host":"pr1.test-market.orangesync.tech"},"time":"2026-08-27T11:50:00Z"}\n'
        '{"request":{"host":"pr2.test-market.orangesync.tech"},"time":"2026-08-27T11:55:00Z"}\n'
        '{"request":{"host":"pr3.test-market.orangesync.tech"},"time":"2026-08-27T11:45:00Z"}\n'
    )
    result = pm.run_cycle(
        root,
        now=_ts(12),
        idle_hours=4,
        top_k=2,
        log_paths=[log],
        gh_repo="org/repo",
        dry_run=True,
    )
    assert 3 in result["stopped"]
    assert 1 not in result["stopped"]
    assert 2 not in result["stopped"]


def test_run_cycle_tears_down_closed_pr(tmp_path, monkeypatch):
    root = tmp_path / "previews"
    d = root / "pr-9"
    d.mkdir(parents=True)
    (d / "docker-compose.yml").write_text("services: {}\n")

    fake = _FakeRunner()
    fake.respond("compose", "running")
    monkeypatch.setattr(pm, "Runner", lambda: fake)
    # pr-9 is NOT in the open list → should be torn down.
    monkeypatch.setattr(pm, "open_pr_numbers", lambda *a, **k: [1, 2])

    result = pm.run_cycle(
        root,
        now=_ts(12),
        idle_hours=4,
        top_k=5,
        gh_repo="org/repo",
        dry_run=True,
    )
    assert 9 in result["torn_down"]


def test_run_cycle_dry_run_no_side_effects(tmp_path, monkeypatch):
    root = tmp_path / "previews"
    d = root / "pr-5"
    d.mkdir(parents=True)
    (d / "docker-compose.yml").write_text("services: {}\n")

    fake = _FakeRunner()
    fake.respond("compose", "running")
    monkeypatch.setattr(pm, "Runner", lambda: fake)
    monkeypatch.setattr(pm, "open_pr_numbers", lambda *a, **k: [])
    stop_calls: list[int] = []
    monkeypatch.setattr(
        pm,
        "stop_preview",
        lambda p: stop_calls.append(p.pr_number) or True,
    )

    result = pm.run_cycle(
        root,
        now=_ts(12),
        idle_hours=4,
        top_k=5,
        gh_repo="org/repo",
        dry_run=True,
    )
    # dry_run: pr-5 is closed (not in open list) → reported for teardown, but
    # stop_preview must NOT have been invoked.
    assert result["dry_run"] is True
    assert 5 in result["torn_down"]
    assert stop_calls == []
