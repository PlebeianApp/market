#!/usr/bin/env python3
"""Unit tests for infra/preview-vps/preview_manager.py.

Runs locally without a VPS and with NO network calls (ADR-0005): the manager is
designed so every external effect (docker, curl/GitHub/Cloudflare, Caddy access
logs) is isolated behind pure functions or Runner shims. These tests pin the
exact docker argv (`stop` for idle, `down --remove-orphans --volumes` for
teardown), the fail-closed open-PR semantics, the unknown-is-not-idle semantics,
the port-marker registry, and run the real (non-dry-run) execution path with
injected fakes.

Run:  python3 -m pytest infra/preview-vps/test_preview_manager.py
"""

from __future__ import annotations

import datetime as dt
import json
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


def _quiet():
    return lambda msg: None


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


# ── is_idle / idle_decision (B4: unknown is NOT idle) ─────────────────────────

def test_unknown_access_is_not_idle():
    # B4: no/missing log data => last_access UNKNOWN => must NOT idle-stop.
    assert pm.is_idle(None, now=_ts(12), idle_hours=4) is False


def test_not_idle_when_recently_accessed():
    assert pm.is_idle(_ts(10), now=_ts(12), idle_hours=4) is False


def test_idle_when_older_than_threshold():
    # Accessed at 07:00, now 12:00 → 5h > 4h idle threshold.
    assert pm.is_idle(_ts(7), now=_ts(12), idle_hours=4) is True


def test_boundary_not_idle():
    # Exactly at the threshold is not yet idle.
    assert pm.is_idle(_ts(8), now=_ts(12), idle_hours=4) is False


def test_idle_decision_skips_unknown_loudly():
    messages: list[str] = []

    def loud(msg: str) -> None:
        messages.append(msg)

    # Unknown last_access → skip the idle decision, log loudly, no stop.
    assert pm.idle_decision(None, _ts(12), 4.0, 42, loud) is False
    assert any("no recorded access" in m for m in messages)
    # Stale recorded access → idle.
    assert pm.idle_decision(_ts(7), _ts(12), 4.0, 42, loud) is True
    # Recent recorded access → not idle.
    assert pm.idle_decision(_ts(11), _ts(12), 4.0, 42, loud) is False


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


def test_wake_ignores_non_preview_domain(monkeypatch):
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


# ── Runner / subprocess stubs ────────────────────────────────────────────────

class _FakeRunner:
    """In-memory subprocess shim: records argv, returns canned (stdout, rc)."""

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
                return out, 0
        return "", 0

    # curl_json shape used by open_pr_numbers/delete_cloudflare_record.
    def curl_json(self, method, url, headers=(), data=None, timeout=60):
        self.calls.append([method, url])
        for key, out in self._responses.items():
            if key in url:
                return out, 0
        return "", 0


def _make_running_tree(root: Path, numbers) -> None:
    for n in numbers:
        d = root / f"pr-{n}"
        d.mkdir(parents=True)
        (d / "docker-compose.yml").write_text("services: {}\n")


# ── run_cycle: decision layer (dry-run) ───────────────────────────────────────

def test_run_cycle_stops_idle_preview(tmp_path, monkeypatch):
    root = tmp_path / "previews"
    root.mkdir()
    _make_running_tree(root, [1, 2])

    fake = _FakeRunner()
    fake.respond("compose", "running")
    monkeypatch.setattr(pm, "Runner", lambda: fake)
    # Both pr-1 and pr-2 are open; pr-1 recently accessed, pr-2 idle.
    monkeypatch.setattr(pm, "open_pr_numbers", lambda *a, **k: [1, 2])

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
        runner=fake,
        log=_quiet(),
    )
    # pr-2 accessed at 07:00, now 12:00 → idle (5h). pr-1 accessed 11:00 → not idle.
    assert 2 in result["stopped"]
    assert 1 not in result["stopped"]
    assert result["torn_down"] == []


def test_run_cycle_recency_stops_non_top_k(tmp_path, monkeypatch):
    root = tmp_path / "previews"
    root.mkdir()
    _make_running_tree(root, [1, 2, 3])

    fake = _FakeRunner()
    fake.respond("compose", "running")
    monkeypatch.setattr(pm, "Runner", lambda: fake)
    # All three open, all recently accessed (none idle), top_k=2 → the PRs
    # ranked 3rd+ by pushed_at are stopped despite being non-idle.
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
        runner=fake,
        log=_quiet(),
    )
    assert 3 in result["stopped"]
    assert 1 not in result["stopped"]
    assert 2 not in result["stopped"]


def test_run_cycle_tears_down_closed_pr(tmp_path, monkeypatch):
    root = tmp_path / "previews"
    root.mkdir()
    _make_running_tree(root, [9])

    fake = _FakeRunner()
    fake.respond("compose", "running")
    monkeypatch.setattr(pm, "Runner", lambda: fake)
    # pr-9 is NOT in the open list → torn down (clean, verified open set).
    monkeypatch.setattr(pm, "open_pr_numbers", lambda *a, **k: [1, 2])

    result = pm.run_cycle(
        root,
        now=_ts(12),
        idle_hours=4,
        top_k=5,
        gh_repo="org/repo",
        dry_run=True,
        runner=fake,
        log=_quiet(),
    )
    assert 9 in result["torn_down"]


def test_run_cycle_dry_run_no_side_effects(tmp_path, monkeypatch):
    root = tmp_path / "previews"
    root.mkdir()
    _make_running_tree(root, [5])

    fake = _FakeRunner()
    fake.respond("compose", "running")
    monkeypatch.setattr(pm, "Runner", lambda: fake)
    monkeypatch.setattr(pm, "open_pr_numbers", lambda *a, **k: [1])
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
        runner=fake,
        log=_quiet(),
    )
    # dry_run: pr-5 is closed (not in open list) → reported for teardown, but
    # stop_preview must NOT have been invoked.
    assert result["dry_run"] is True
    assert 5 in result["torn_down"]
    assert stop_calls == []


# ── run_cycle: idle semantics from access logs (B4) ───────────────────────────

def test_run_cycle_no_log_paths_means_no_idle_stop(tmp_path, monkeypatch):
    # B4: no log paths → last access UNKNOWN → nothing is idle-stopped,
    # regardless of the open-PR set.
    root = tmp_path / "previews"
    root.mkdir()
    _make_running_tree(root, [1, 2])

    fake = _FakeRunner()
    fake.respond("compose", "running")
    monkeypatch.setattr(pm, "open_pr_numbers", lambda *a, **k: [1, 2])

    messages: list[str] = []

    def loud(msg: str) -> None:
        messages.append(msg)

    result = pm.run_cycle(
        root,
        now=_ts(12),
        idle_hours=4,
        top_k=5,
        log_paths=[],
        gh_repo="org/repo",
        dry_run=True,
        runner=fake,
        log=loud,
    )
    assert result["stopped"] == []
    assert result["torn_down"] == []
    # And the skip must be loud.
    assert any("no recorded access" in m for m in messages)


def test_run_cycle_recent_access_no_stop(tmp_path, monkeypatch):
    root = tmp_path / "previews"
    root.mkdir()
    _make_running_tree(root, [1])

    fake = _FakeRunner()
    fake.respond("compose", "running")
    monkeypatch.setattr(pm, "open_pr_numbers", lambda *a, **k: [1])
    log = root / "access.log"
    log.write_text(
        '{"request":{"host":"pr1.test-market.orangesync.tech"},"time":"2026-08-27T11:30:00Z"}\n'
    )
    result = pm.run_cycle(
        root,
        now=_ts(12),
        idle_hours=4,
        top_k=5,
        log_paths=[log],
        gh_repo="org/repo",
        dry_run=True,
        runner=fake,
        log=_quiet(),
    )
    assert result["stopped"] == []
    assert result["torn_down"] == []


def test_run_cycle_stale_access_stops(tmp_path, monkeypatch):
    root = tmp_path / "previews"
    root.mkdir()
    _make_running_tree(root, [1])

    fake = _FakeRunner()
    fake.respond("compose", "running")
    monkeypatch.setattr(pm, "open_pr_numbers", lambda *a, **k: [1])
    log = root / "access.log"
    log.write_text(
        '{"request":{"host":"pr1.test-market.orangesync.tech"},"time":"2026-08-27T06:00:00Z"}\n'
    )
    result = pm.run_cycle(
        root,
        now=_ts(12),
        idle_hours=4,
        top_k=5,
        log_paths=[log],
        gh_repo="org/repo",
        dry_run=True,
        runner=fake,
        log=_quiet(),
    )
    assert result["stopped"] == [1]


# ── run_cycle: fail-closed open-PR fetch (B5) ─────────────────────────────────

def test_run_cycle_fetch_failure_no_teardown_no_recency_stop(tmp_path, monkeypatch):
    # B5: open_pr_numbers returns None (fetch failed/rate-limited) → zero
    # teardown AND zero recency-stop; idle-stop (recoverable) may still run.
    root = tmp_path / "previews"
    root.mkdir()
    _make_running_tree(root, [1, 2])

    fake = _FakeRunner()
    fake.respond("compose", "running")
    monkeypatch.setattr(pm, "open_pr_numbers", lambda *a, **k: None)

    teardown_calls: list[int] = []

    def fake_teardown(p, **kwargs):
        teardown_calls.append(p.pr_number)
        return True

    log = root / "access.log"
    log.write_text(
        '{"request":{"host":"pr1.test-market.orangesync.tech"},"time":"2026-08-27T06:00:00Z"}\n'
        '{"request":{"host":"pr2.test-market.orangesync.tech"},"time":"2026-08-27T11:00:00Z"}\n'
    )

    result = pm.run_cycle(
        root,
        now=_ts(12),
        idle_hours=4,
        top_k=5,
        log_paths=[log],
        gh_repo="org/repo",
        dry_run=False,  # REAL path — fail-closed must hold under execution
        runner=fake,
        stop_fn=lambda p: True,
        teardown_fn=fake_teardown,
        log=_quiet(),
    )
    # pr-1 has a STALE recorded access → idle-stop still runs (recoverable).
    assert result["stopped"] == [1]
    # pr-2 recent access, and open-PR unknown → NO teardown at all.
    assert teardown_calls == []
    assert result["torn_down"] == []
    assert result["skip_reason"] is not None
    assert "fail-closed" in result["skip_reason"]


def test_run_cycle_fetch_failure_truncation_teardown_skipped(tmp_path, monkeypatch):
    # Same fail-closed guarantee, but with previews that LOOK closed (they'd be
    # torn down if the open list were trusted) — must NOT be.
    root = tmp_path / "previews"
    root.mkdir()
    _make_running_tree(root, [7, 8])

    fake = _FakeRunner()
    fake.respond("compose", "running")
    monkeypatch.setattr(pm, "open_pr_numbers", lambda *a, **k: None)

    teardown_calls: list[int] = []

    def fake_teardown(p, **kwargs):
        teardown_calls.append(p.pr_number)
        return True

    result = pm.run_cycle(
        root,
        now=_ts(12),
        gh_repo="org/repo",
        dry_run=False,
        runner=fake,
        teardown_fn=fake_teardown,
        log=_quiet(),
    )
    assert teardown_calls == []
    assert result["torn_down"] == []
    assert result["skip_reason"] is not None


# ── run_cycle: NON-dry-run real execution path ────────────────────────────────

def test_run_cycle_real_execution_uses_compose_stop_not_down(tmp_path, monkeypatch):
    # (1) The required non-dry-run run_cycle test. Stubbed subprocess functions
    # injected via run_cycle(runner=..., stop_fn=..., teardown_fn=...).
    root = tmp_path / "previews"
    root.mkdir()
    _make_running_tree(root, [1, 2])

    fake = _FakeRunner()
    fake.respond("compose", "running")
    monkeypatch.setattr(pm, "open_pr_numbers", lambda *a, **k: [1, 2])

    log = root / "access.log"
    log.write_text(
        '{"request":{"host":"pr1.test-market.orangesync.tech"},"time":"2026-08-27T11:00:00Z"}\n'
        '{"request":{"host":"pr2.test-market.orangesync.tech"},"time":"2026-08-27T07:00:00Z"}\n'
    )

    stop_argv: list[list[str]] = []

    def fake_stop(p):
        stop_argv.append(["docker", "compose", "-f", str(p.directory / "docker-compose.yml"), "stop"])
        return True

    result = pm.run_cycle(
        root,
        now=_ts(12),
        idle_hours=4,
        top_k=5,
        log_paths=[log],
        gh_repo="org/repo",
        dry_run=False,
        runner=fake,
        stop_fn=fake_stop,
        log=_quiet(),
    )
    # pr-2 idle → stopped via the REAL path; pr-1 untouched.
    assert result["stopped"] == [2]
    assert result["torn_down"] == []
    assert len(stop_argv) == 1
    # (2) Pin the exact idle-stop docker argv: `stop`, never `down --volumes`.
    assert stop_argv[0] == [
        "docker",
        "compose",
        "-f",
        str(root / "pr-2" / "docker-compose.yml"),
        "stop",
    ]
    assert "--volumes" not in stop_argv[0]


def test_run_cycle_real_execution_teardown_argv(tmp_path, monkeypatch):
    # (2) Teardown argv pinned: down --remove-orphans --volumes (irreversible,
    # closed-PR cleanup only) — and the directory is removed.
    root = tmp_path / "previews"
    root.mkdir()
    _make_running_tree(root, [9])

    fake = _FakeRunner()
    fake.respond("compose", "running")
    monkeypatch.setattr(pm, "open_pr_numbers", lambda *a, **k: [1, 2])
    monkeypatch.setattr(
        pm, "start_preview", lambda p: True
    )  # not used; defensive

    result = pm.run_cycle(
        root,
        now=_ts(12),
        idle_hours=4,
        top_k=5,
        gh_repo="org/repo",
        dry_run=False,
        runner=fake,
        stop_fn=lambda p: True,
        log=_quiet(),
    )
    # pr-9 closed → torn down via the REAL path.
    assert result["torn_down"] == [9]
    # The preview directory is gone.
    assert not (root / "pr-9").exists()
    # The docker down argv seen by the fake runner (teardown_preview's own
    # subprocess call is NOT runner-mediated; it runs real subprocess — so pin
    # it separately in test_teardown_preview_* below).


def test_run_cycle_real_execution_stopped_pr_closed_teardown(tmp_path, monkeypatch):
    # M5: cleanup considers ALL preview directories (stopped previews whose PR
    # closed are torn down, not just running ones).
    root = tmp_path / "previews"
    root.mkdir()
    _make_running_tree(root, [3])

    fake = _FakeRunner()
    # pr-3 is STOPPED (compose ps reports nothing running).
    monkeypatch.setattr(pm, "Runner", lambda: fake)
    monkeypatch.setattr(pm, "open_pr_numbers", lambda *a, **k: [1, 2])

    result = pm.run_cycle(
        root,
        now=_ts(12),
        gh_repo="org/repo",
        dry_run=True,
        runner=fake,
        log=_quiet(),
    )
    # pr-3 is not running, but its PR is closed → still queued for teardown.
    assert 3 in result["torn_down"]


# ── stop_preview / start_preview / teardown_preview argv + returncode (m2) ────

class _FakeCompletedProcess:
    def __init__(self, rc: int) -> None:
        self.returncode = rc
        self.stdout = ""
        self.stderr = ""


def test_stop_preview_argv_is_compose_stop(monkeypatch, tmp_path):
    compose = tmp_path / "pr-42" / "docker-compose.yml"
    compose.parent.mkdir(parents=True)
    compose.write_text("services: {}\n")
    calls: list[list[str]] = []

    def fake_run(argv, **kwargs):
        calls.append(list(argv))
        return _FakeCompletedProcess(0)

    monkeypatch.setattr(pm.subprocess, "run", fake_run)
    assert pm.stop_preview(pm.Preview(42, compose.parent, None, True)) is True
    assert calls == [["docker", "compose", "-f", str(compose), "stop"]]


def test_stop_preview_never_removes_volumes(monkeypatch, tmp_path):
    compose = tmp_path / "pr-42" / "docker-compose.yml"
    compose.parent.mkdir(parents=True)
    compose.write_text("services: {}\n")
    calls: list[list[str]] = []

    def fake_run(argv, **kwargs):
        calls.append(list(argv))
        return _FakeCompletedProcess(0)

    monkeypatch.setattr(pm.subprocess, "run", fake_run)
    pm.stop_preview(pm.Preview(42, compose.parent, None, True))
    assert calls[0][-1] == "stop"
    joined = " ".join(calls[0])
    assert "down" not in joined
    assert "--volumes" not in joined


def test_teardown_preview_argv_is_down_remove_orphans_volumes(monkeypatch, tmp_path):
    compose = tmp_path / "pr-42" / "docker-compose.yml"
    compose.parent.mkdir(parents=True)
    compose.write_text("services: {}\n")
    calls: list[list[str]] = []

    def fake_run(argv, **kwargs):
        calls.append(list(argv))
        return _FakeCompletedProcess(0)

    monkeypatch.setattr(pm.subprocess, "run", fake_run)
    ok = pm.teardown_preview(pm.Preview(42, compose.parent, None, True), log=_quiet())
    assert ok is True
    assert calls == [
        [
            "docker",
            "compose",
            "-f",
            str(compose),
            "down",
            "--remove-orphans",
            "--volumes",
        ]
    ]
    # Directory removed.
    assert not compose.parent.exists()


def test_stop_preview_returncode_propagates(monkeypatch, tmp_path):
    # (8) m2: failed docker stop is reported as failure, not success.
    compose = tmp_path / "pr-42" / "docker-compose.yml"
    compose.parent.mkdir(parents=True)
    compose.write_text("services: {}\n")

    def fake_run(argv, **kwargs):
        return _FakeCompletedProcess(1)

    monkeypatch.setattr(pm.subprocess, "run", fake_run)
    assert pm.stop_preview(pm.Preview(42, compose.parent, None, True)) is False


def test_start_preview_returncode_propagates(monkeypatch, tmp_path):
    compose = tmp_path / "pr-42" / "docker-compose.yml"
    compose.parent.mkdir(parents=True)
    compose.write_text("services: {}\n")
    calls: list[list[str]] = []

    def fake_run(argv, **kwargs):
        calls.append(list(argv))
        return _FakeCompletedProcess(1)

    monkeypatch.setattr(pm.subprocess, "run", fake_run)
    assert pm.start_preview(pm.Preview(42, compose.parent, None, False)) is False
    assert calls == [["docker", "compose", "-f", str(compose), "start"]]


def test_run_cycle_stop_failure_recorded(tmp_path, monkeypatch):
    # m2: a failed stop shows up in results['failed'], not in 'stopped'.
    root = tmp_path / "previews"
    root.mkdir()
    _make_running_tree(root, [1])

    fake = _FakeRunner()
    fake.respond("compose", "running")
    monkeypatch.setattr(pm, "open_pr_numbers", lambda *a, **k: [1])
    log = root / "access.log"
    log.write_text(
        '{"request":{"host":"pr1.test-market.orangesync.tech"},"time":"2026-08-27T06:00:00Z"}\n'
    )
    messages: list[str] = []

    result = pm.run_cycle(
        root,
        now=_ts(12),
        idle_hours=4,
        log_paths=[log],
        gh_repo="org/repo",
        dry_run=False,
        runner=fake,
        stop_fn=lambda p: False,  # docker compose stop fails
        log=messages.append,
    )
    assert result["stopped"] == []
    assert result["failed"] == [1]
    assert any("FAILED" in m for m in messages)


# ── open_pr_numbers: pagination + sort + fail-closed (B5, m1) ──────────────────

class _PagedRunner:
    """Runner stub that serves successive pages of the PR list API."""

    def __init__(self, pages: list[str], rcs: list[int] | None = None) -> None:
        self.pages = pages
        self.rcs = rcs or [0] * len(pages)
        self.urls: list[str] = []
        self.headers_seen: list[list[tuple[str, str]]] = []
        self._i = 0

    def run(self, argv, timeout=60):
        raise AssertionError("open_pr_numbers must use curl_json, not run()")

    def curl_json(self, method, url, headers=(), data=None, timeout=60):
        self.urls.append(url)
        self.headers_seen.append(list(headers))
        page = self.pages[min(self._i, len(self.pages) - 1)]
        rc = self.rcs[min(self._i, len(self.rcs) - 1)]
        self._i += 1
        return page, rc


def _pr_page(numbers: list[int]) -> str:
    return json.dumps([{"number": n} for n in numbers])


def test_open_pr_numbers_paginates_until_short_page():
    # (5) Full pagination: two full pages of 100 then a short page.
    pages = [
        _pr_page(list(range(1, 101))),   # page 1: full (100 items)
        _pr_page(list(range(101, 201))),  # page 2: full
        _pr_page([999]),                  # page 3: short → done
    ]
    runner = _PagedRunner(pages)
    numbers = pm.open_pr_numbers("org/repo", runner=runner, log=_quiet())
    assert numbers == list(range(1, 201)) + [999]
    # Sort + pagination params are in the URL.
    assert len(runner.urls) == 3
    assert "sort=pushed_at" in runner.urls[0]
    assert "per_page=100" in runner.urls[0]
    assert "page=1" in runner.urls[0]
    assert "page=2" in runner.urls[1]
    assert "page=3" in runner.urls[2]


def test_open_pr_numbers_single_page():
    runner = _PagedRunner([_pr_page([42, 7])])
    assert pm.open_pr_numbers("org/repo", runner=runner, log=_quiet()) == [42, 7]
    assert len(runner.urls) == 1


def test_open_pr_numbers_none_on_curl_failure():
    # B5: any fetch error → None (open-PR set unknown).
    runner = _PagedRunner([_pr_page([1])], rcs=[7])
    assert pm.open_pr_numbers("org/repo", runner=runner, log=_quiet()) is None


def test_open_pr_numbers_none_on_rate_limit():
    runner = _PagedRunner([json.dumps({"message": "API rate limit exceeded"})])
    assert pm.open_pr_numbers("org/repo", runner=runner, log=_quiet()) is None


def test_open_pr_numbers_none_on_malformed():
    runner = _PagedRunner(["not json at all"])
    assert pm.open_pr_numbers("org/repo", runner=runner, log=_quiet()) is None


def test_open_pr_numbers_none_on_error_object():
    runner = _PagedRunner([json.dumps({"message": "Bad credentials"})])
    assert pm.open_pr_numbers("org/repo", runner=runner, log=_quiet()) is None


def test_open_pr_numbers_none_on_malformed_item():
    # A page containing a non-int "number" must NOT be trusted.
    runner = _PagedRunner([json.dumps([{"number": "not-an-int"}])])
    assert pm.open_pr_numbers("org/repo", runner=runner, log=_quiet()) is None


def test_open_pr_numbers_no_token_in_url_or_argv():
    # B5/m4: anonymous API — no Authorization header at all.
    runner = _PagedRunner([_pr_page([1])])
    pm.open_pr_numbers("org/repo", runner=runner, log=_quiet())
    for headers in runner.headers_seen:
        assert all(k.lower() != "authorization" for k, _ in headers)


def test_runner_curl_json_passes_headers_via_stdin_never_argv(monkeypatch):
    # m4: pin the REAL Runner.curl_json argv: headers go through `-H @-` and
    # the header block via stdin (input=), so no token ever appears in argv.
    captured: dict = {}

    def fake_run(argv, **kwargs):
        captured["argv"] = list(argv)
        captured["input"] = kwargs.get("input")
        return _FakeCompletedProcess(0)

    monkeypatch.setattr(pm.subprocess, "run", fake_run)
    runner = pm.Runner()
    runner.curl_json(
        "GET",
        "https://api.example.com/v1",
        headers=[("Authorization", "Bearer sekrit")],
    )
    argv = captured["argv"]
    assert argv[0] == "curl"
    assert argv[-2:] == ["-H", "@-"]
    # The token is in stdin, not in argv.
    assert "sekrit" not in " ".join(argv)
    assert "sekrit" in captured["input"]
    assert "Authorization: Bearer sekrit" in captured["input"]


def test_open_pr_numbers_clean_empty_list_is_empty_not_none():
    # Only a clean, complete listing with zero open PRs yields [].
    runner = _PagedRunner([_pr_page([])])
    assert pm.open_pr_numbers("org/repo", runner=runner, log=_quiet()) == []


def test_delete_cloudflare_record_uses_curl_json_headers():
    # m4: CF token passed via curl_json headers (stdin by construction), and
    # failures propagate as False.
    class _CFRunner:
        def __init__(self, rc_list):
            self.calls = []
            self.rc_list = rc_list

        def curl_json(self, method, url, headers=(), data=None, timeout=60):
            self.calls.append((method, url, list(headers)))
            body = json.dumps({"result": [{"id": "rec123"}]}) if method == "GET" else "{}"
            rc = self.rc_list.pop(0)
            return body, rc

    runner = _CFRunner([0, 0])
    ok = pm.delete_cloudflare_record(
        42, "zone", "sekrit", "test-market.orangesync.tech", runner=runner, log=_quiet()
    )
    assert ok is True
    # Authorization header present (passed to curl via stdin by Runner.curl_json).
    assert any(k == "Authorization" for k, _ in runner.calls[0][2])
    # Failure on the GET → False.
    runner2 = _CFRunner([1])
    assert pm.delete_cloudflare_record(
        42, "zone", "sekrit", "test-market.orangesync.tech", runner=runner2, log=_quiet()
    ) is False


# ── Port-marker registry (M6) ─────────────────────────────────────────────────

def test_port_offset_math():
    # M6: PRs congruent mod 100 share an offset — 1257 and 1157 both → 570.
    assert pm.port_offset_for_pr(1257) == (1257 % 100) * 10
    assert pm.port_offset_for_pr(1257) == pm.port_offset_for_pr(1157) == 570
    assert pm.port_offset_for_pr(99) == 990
    assert pm.port_offset_for_pr(100) == 0


def test_claim_port_marker_first_claim_succeeds(tmp_path):
    ports = tmp_path / "ports"
    assert pm.claim_port_marker(1257, ports, log=_quiet()) is True
    assert (ports / "570").read_text().strip() == "1257"


def test_claim_port_marker_reclaim_by_same_pr(tmp_path):
    ports = tmp_path / "ports"
    assert pm.claim_port_marker(1257, ports, log=_quiet()) is True
    # Redeploy of the same PR re-claims idempotently.
    assert pm.claim_port_marker(1257, ports, log=_quiet()) is True


def test_claim_port_marker_collision_fails_loudly(tmp_path):
    ports = tmp_path / "ports"
    assert pm.claim_port_marker(1257, ports, log=_quiet()) is True
    messages: list[str] = []

    # PR 1157 shares the offset (both % 100 == 57) → collision, refused.
    assert pm.claim_port_marker(1157, ports, log=messages.append) is False
    assert any("COLLISION" in m for m in messages)
    # Marker still owned by 1257.
    assert (ports / "570").read_text().strip() == "1257"


def test_release_port_marker_by_owner_only(tmp_path):
    ports = tmp_path / "ports"
    assert pm.claim_port_marker(1257, ports, log=_quiet()) is True
    # A different PR must not release someone else's marker.
    assert pm.release_port_marker(1157, ports, log=_quiet()) is False
    assert (ports / "570").exists()
    # The owner releases cleanly.
    assert pm.release_port_marker(1257, ports, log=_quiet()) is True
    assert not (ports / "570").exists()


def test_reap_orphan_port_markers(tmp_path):
    root = tmp_path / "previews"
    root.mkdir()
    ports = root / "ports"
    ports.mkdir()
    # Marker for a PR whose preview dir is gone → orphaned.
    (ports / "570").write_text("1257\n")
    # Marker for a PR whose preview dir exists → kept.
    (ports / "300").write_text("100\n")
    (root / "pr-100").mkdir()
    (root / "pr-100" / "docker-compose.yml").write_text("services: {}\n")

    reaped = pm.reap_orphan_port_markers(root, log=_quiet())
    assert reaped == [570]
    assert not (ports / "570").exists()
    assert (ports / "300").exists()


def test_run_cycle_reaps_orphan_markers(tmp_path, monkeypatch):
    root = tmp_path / "previews"
    root.mkdir()
    ports = root / "ports"
    ports.mkdir()
    (ports / "570").write_text("1257\n")  # orphan: no pr-1257 dir

    fake = _FakeRunner()
    monkeypatch.setattr(pm, "open_pr_numbers", lambda *a, **k: [1])

    result = pm.run_cycle(
        root,
        now=_ts(12),
        gh_repo="org/repo",
        dry_run=True,
        runner=fake,
        log=_quiet(),
    )
    assert result["reaped_port_markers"] == [570]
    assert not (ports / "570").exists()


def test_teardown_releases_port_marker(tmp_path, monkeypatch):
    compose_dir = tmp_path / "pr-1257"
    compose_dir.mkdir()
    (compose_dir / "docker-compose.yml").write_text("services: {}\n")
    ports = tmp_path / "ports"
    ports.mkdir()
    (ports / "570").write_text("1257\n")

    def fake_run(argv, **kwargs):
        return _FakeCompletedProcess(0)

    monkeypatch.setattr(pm.subprocess, "run", fake_run)
    ok = pm.teardown_preview(
        pm.Preview(1257, compose_dir, None, True),
        ports_dir=ports,
        log=_quiet(),
    )
    assert ok is True
    assert not (ports / "570").exists()


# ── _parse_rfc3339 (m6 cleanup) ───────────────────────────────────────────────

def test_parse_rfc3339_z_and_offsets():
    assert pm._parse_rfc3339("2026-08-27T12:00:00Z") == _ts(12)
    assert pm._parse_rfc3339("2026-08-27T12:00:00+00:00") == _ts(12)
    assert pm._parse_rfc3339(" 2026-08-27 09:30:00+00:00 ") == _ts(9, 30)