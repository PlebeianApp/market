#!/usr/bin/env python3
"""Unit tests for infra/preview-vps/preview_gateway.py.

Pure-function tests for the gateway's routing logic (host→port math, ask
approval, non-preview rejection, wake poke, proxy retry/503 behavior) — no
sockets, no network (ADR-0005). The HTTP handler itself is exercised through a
stubbed GatewayState with fake poke/probe/proxy functions.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(
    0,
    str(Path(__file__).resolve().parent),
)

import preview_gateway as gw  # noqa: E402


BASE = "test-market.orangesync.tech"


# ── host → port math (M1) ─────────────────────────────────────────────────────

def test_app_port_math():
    # Mirrors the workflow: 3000 + (N % 100) * 10.
    assert gw.app_port_for_pr(42) == 3000 + (42 % 100) * 10
    assert gw.app_port_for_pr(0) == 3000
    assert gw.app_port_for_pr(100) == 3000
    assert gw.app_port_for_pr(99) == 3990
    assert gw.app_port_for_pr(1257) == 3570
    # PRs congruent mod 100 collide on ports — the port-marker registry (M6)
    # is what prevents two such PRs deploying concurrently.
    assert gw.app_port_for_pr(1257) == gw.app_port_for_pr(1157)


def test_parse_preview_host_matches():
    d = gw.parse_preview_host(f"pr42.{BASE}", BASE)
    assert d.matched is True
    assert d.pr_number == 42
    assert d.port == 3420


def test_parse_preview_host_strips_port_suffix():
    d = gw.parse_preview_host(f"pr7.{BASE}:443", BASE)
    assert d.matched is True
    assert d.pr_number == 7


def test_parse_preview_host_case_insensitive():
    d = gw.parse_preview_host(f"PR42.{BASE.upper()}", BASE)
    assert d.matched is True
    assert d.pr_number == 42


def test_parse_preview_host_rejects_non_preview_host():
    for host in (
        "nsite.orangesync.tech",
        "test-market.orangesync.tech",
        "example.com",
        "pr-42.example.com",
        "evil.test-market.orangesync.tech.evil.com",
        "",
    ):
        d = gw.parse_preview_host(host, BASE)
        assert d.matched is False, host
        assert d.pr_number is None
        assert d.port is None


def test_parse_preview_host_rejects_bare_wildcard():
    # The base domain itself is not a preview host.
    d = gw.parse_preview_host(BASE, BASE)
    assert d.matched is False


# ── TLS ask approval (B3/M1) ─────────────────────────────────────────────────

def test_ask_approves_preview_subdomain():
    assert gw.ask_decision(f"pr1257.{BASE}") is True


def test_ask_approves_nsite():
    assert gw.ask_decision("nsite.orangesync.tech") is True
    assert gw.ask_decision("anything.nsite.orangesync.tech") is True


def test_ask_rejects_other_domains():
    assert gw.ask_decision("evil.example.com") is False
    assert gw.ask_decision("example.com") is False
    assert gw.ask_decision("") is False
    # Substring tricks must not pass.
    assert gw.ask_decision(f"pr1.{BASE}.evil.com") is False


def test_ask_path_detection():
    assert gw.is_ask_path("/ask") is True
    assert gw.is_ask_path("/ask?domain=pr42.test-market.orangesync.tech") is True
    assert gw.is_ask_path("/") is False
    assert gw.is_ask_path("/ask/extra") is False


# ── wake poke (m3: fires on EVERY request) ───────────────────────────────────

def test_poke_wake_invokes_manager(monkeypatch):
    calls: list[list[str]] = []

    def fake_popen(argv, **kwargs):
        calls.append(list(argv))
        return "fake-pid"

    monkeypatch.setattr(gw.subprocess, "Popen", fake_popen)
    manager = Path("/home/debian/preview-infra/preview_manager.py")
    assert gw.poke_wake(42, manager, "/usr/bin/python3") is True
    assert calls == [[
        "/usr/bin/python3",
        str(manager),
        "--wake",
        "42",
    ]]
    assert gw.poke_wake(42, manager, "/usr/bin/python3") is True
    assert len(calls) == 2  # every request pokes again — no caching


def test_poke_wake_non_fatal_on_oserror(monkeypatch):
    def boom(argv, **kwargs):
        raise OSError("spawn failed")

    monkeypatch.setattr(gw.subprocess, "Popen", boom)
    # OSError is swallowed and logged (never raised) — B3.
    assert gw.poke_wake(42, Path("/x/preview_manager.py"), "/usr/bin/python3") is False


# ── proxy retry / 503 behavior ────────────────────────────────────────────────

def test_wait_for_port_immediate_success():
    assert gw.wait_for_port(3420, probe=lambda port: True) is True


def test_wait_for_port_gives_up(monkeypatch):
    # Bounded retry: never connects → False after the budget.
    import time

    sleeps: list[float] = []
    monkeypatch.setattr(time, "sleep", lambda s: sleeps.append(s))
    assert gw.wait_for_port(3420, budget_seconds=0.5, poll_seconds=0.1, probe=lambda port: False) is False
    # It polled repeatedly (bounded).
    assert len(sleeps) >= 1


def test_wait_for_port_connects_after_retries(monkeypatch):
    import time

    attempts: list[bool] = [False, False, True]
    monkeypatch.setattr(time, "sleep", lambda s: None)

    def flaky_probe(port):
        return attempts.pop(0) if attempts else True

    assert gw.wait_for_port(3420, budget_seconds=5, poll_seconds=0.01, probe=flaky_probe) is True


# ── GatewayState wiring / handler behavior (stubs, no sockets) ─────────────────

class _FakeWfile:
    """Collects handler output bytes like a real socket wfile."""

    def __init__(self) -> None:
        self.chunks: list[bytes] = []

    def write(self, data: bytes) -> None:
        self.chunks.append(bytes(data))

    def __bytes__(self) -> bytes:
        return b"".join(self.chunks)

    @property
    def text(self) -> str:
        return b"".join(self.chunks).decode("utf-8", "replace")


class FakeRfile:
    def read(self, n):
        return b""


def _make_fake_handler(handler_cls, host: str):
    class FakeHandler(handler_cls):
        def __init__(self):
            self.command = "GET"
            self.path = "/"
            self.headers = {"Host": host}
            self.wfile = _FakeWfile()
            self._sent = []
            self.rfile = FakeRfile()

        def send_response(self, code, message=None):
            self._sent.append(("status", code))

        def send_header(self, key, value):
            self._sent.append((key, value))

        def end_headers(self):
            pass

    return FakeHandler


def _route_state(pokes, prober_result, proxy_result, boot_budget=0.0):
    def poke(pr, path, py):
        pokes.append(pr)
        return True

    def proxy(method, path, headers, body, port):
        if isinstance(proxy_result, Exception):
            raise proxy_result
        return proxy_result

    return gw.GatewayState(
        base_domain=BASE,
        manager_path=Path("/mgr.py"),
        python_bin="/usr/bin/python3",
        poke=poke,
        prober=lambda port: prober_result,
        proxy=proxy,
        boot_budget=boot_budget,
    )


def test_route_handler_flow_pokes_then_proxies():
    # The router pokes the manager on EVERY request, waits for the port, then
    # proxies. Non-preview hosts never poke.
    pokes: list[int] = []
    state = _route_state(pokes, True, (200, b"OK", "text/plain"))
    handler_cls = gw.make_handler(state)
    FakeHandler = _make_fake_handler(handler_cls, f"pr42.{BASE}")

    h = FakeHandler()
    h._answer_route()
    assert pokes == [42]  # wake fired
    assert ("status", 200) in h._sent
    assert h.wfile.text == "OK"


def test_route_handler_flow_503_when_never_boots():
    pokes: list[int] = []
    # If the handler wrongly calls the proxy, this raises and fails the test.
    state = _route_state(
        pokes,
        False,
        AssertionError("proxy must not be called when boot fails"),
    )
    handler_cls = gw.make_handler(state)
    FakeHandler = _make_fake_handler(handler_cls, f"pr42.{BASE}")

    h = FakeHandler()
    h._answer_route()
    # Wake poked, but the preview never accepted connections → 503 JSON.
    assert pokes == [42]
    assert ("status", 503) in h._sent
    assert "preview not ready" in h.wfile.text


def test_route_handler_flow_503_on_proxy_oserror():
    # Proxy raising OSError after a successful probe → 503 with detail.
    pokes: list[int] = []
    state = _route_state(pokes, True, OSError("connection reset"))
    handler_cls = gw.make_handler(state)
    FakeHandler = _make_fake_handler(handler_cls, f"pr42.{BASE}")

    h = FakeHandler()
    h._answer_route()
    assert ("status", 503) in h._sent
    assert "connection reset" in h.wfile.text


def test_route_handler_flow_rejects_non_preview_host():
    pokes: list[int] = []
    # If the handler wrongly calls the proxy, this raises and fails the test.
    state = _route_state(
        pokes,
        True,
        AssertionError("proxy must not be called for unknown hosts"),
    )
    handler_cls = gw.make_handler(state)
    FakeHandler = _make_fake_handler(handler_cls, "evil.example.com")

    h = FakeHandler()
    h._answer_route()
    assert pokes == []  # never poked
    assert ("status", 404) in h._sent
    assert "no preview route" in h.wfile.text


def test_route_handler_flow_wakes_on_every_request():
    # m3: repeated requests poke the manager each time (cached-cert repeat
    # visits must wake a stopped preview too).
    pokes: list[int] = []
    state = _route_state(pokes, True, (200, b"OK", "text/plain"))
    handler_cls = gw.make_handler(state)
    FakeHandler = _make_fake_handler(handler_cls, f"pr42.{BASE}")

    for _ in range(3):
        FakeHandler()._answer_route()
    assert pokes == [42, 42, 42]


# ── manager --wake <N> compatibility (gateway → manager contract) ─────────────

def test_manager_wake_by_pr_number(tmp_path):
    # The gateway pokes `preview_manager.py --wake <N>`; the manager CLI must
    # accept a bare PR NUMBER and start a matching stopped preview.
    import preview_manager as pm

    previews = [
        pm.Preview(pr_number=42, directory=tmp_path / "pr-42", last_access=None, running=False),
    ]
    started: list[int] = []

    def fake_start(p):
        started.append(p.pr_number)
        return True

    assert pm.wake_preview_by_pr(42, previews, BASE, start_fn=fake_start) is True
    assert started == [42]
    # Unknown PR number → no crash, returns False.
    assert pm.wake_preview_by_pr(999, previews, BASE, start_fn=fake_start) is False


def test_gateway_manager_port_contract():
    # The gateway's computed port MUST equal the workflow's app_port formula
    # for the same PR (3000 + (N%100)*10).
    import preview_manager as pm

    for pr in (0, 1, 42, 99, 100, 1157, 1257, 12345):
        assert gw.app_port_for_pr(pr) == 3000 + pm.port_offset_for_pr(pr)