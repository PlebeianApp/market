#!/usr/bin/env python3
"""preview_gateway.py — Caddy front for PR previews: TLS-ask + HTTP router.

Runs on the preview VPS as a systemd service (preview-gateway.service, running
as the provisioned user — NOT root, B3) listening on localhost only; Caddy
fronts it for the public internet. It serves two roles:

  1. TLS-ASK ENDPOINT  — `GET/POST /ask?domain=<host>` is called by Caddy's
     on_demand_tls module before issuing any certificate. It approves
     *.nsite.orangesync.tech and pr{N}.test-market.orangesync.tech hosts and
     rejects everything else (403). Approval never blocks: the wake poke below
     is fired from the routing path, not from here.

  2. HTTP ROUTER       — any other request is proxied by Caddy
     (`*.test-market.orangesync.tech` site block) to this process. It parses the
     Host header: `pr{N}.test-market.orangesync.tech` routes to the preview app
     on localhost port 3000 + (N % 100) * 10. On EVERY request it first pokes
     the lazy-start manager (`preview_manager.py --wake <N>`) so stopped
     previews boot — including repeat visits where Caddy already holds the
     cached certificate (m3). The poke is non-fatal: errors are logged and the
     request still proceeds to a bounded-connect-retry proxy (~up to 15 s while
     the preview boots). If the preview never comes up, the client gets a 503
     with a JSON error body.

Everything is a small pure function over `dataclass RouteDecision` so the
routing logic is unit-testable without sockets (test_preview_gateway.py).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import socket
import subprocess
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, Optional, Sequence, Tuple

DEFAULT_BASE_DOMAIN = "test-market.orangesync.tech"
DEFAULT_GATEWAY_PORT = 6799
PREVIEW_APP_BASE_PORT = 3000
PREVIEW_PORT_OFFSET = 10  # mirrors the workflow: offset = (PR % 100) * 10
WAKE_TIMEOUT_SECONDS = 15.0
ASK_PATH = "/ask"
WAKE_POLL_SECONDS = 0.3

# Subdomains Caddy may obtain on-demand certificates for.
TLS_ASK_ALLOWED_SUFFIXES = (
    "nsite.orangesync.tech",
    ".nsite.orangesync.tech",
    "test-market.orangesync.tech",
    ".test-market.orangesync.tech",
)


def log(message: str) -> None:
    print(f"preview-gateway: {message}", file=sys.stderr)


# ── Pure routing logic (unit-tested) ──────────────────────────────────────────


def preview_host_re(base_domain: str) -> re.Pattern:
    return re.compile(rf"^pr(\d+)\.{re.escape(base_domain)}$")


@dataclass
class RouteDecision:
    """Decision for one HTTP request to the router."""

    host: str
    matched: bool
    pr_number: Optional[int]
    port: Optional[int]

    @classmethod
    def unmatched(cls, host: str) -> "RouteDecision":
        return cls(host=host, matched=False, pr_number=None, port=None)


def parse_preview_host(host: str, base_domain: str) -> RouteDecision:
    """Map a Host header to a preview PR number + app port (pure).

    `pr42.test-market.orangesync.tech` → PR 42 → app port 3000 + (42 % 100) * 10.
    Unknown hosts are matched=False (the router answers 404).
    """
    host = host.strip().lower()
    # Strip an optional :port.
    if ":" in host:
        host = host.split(":", 1)[0]
    m = preview_host_re(base_domain).match(host)
    if not m:
        return RouteDecision.unmatched(host)
    pr_number = int(m.group(1))
    return RouteDecision(
        host=host,
        matched=True,
        pr_number=pr_number,
        port=app_port_for_pr(pr_number),
    )


def app_port_for_pr(pr_number: int) -> int:
    """Host app port for a PR — mirrors the workflow: 3000 + (PR % 100) * 10."""
    return PREVIEW_APP_BASE_PORT + (pr_number % 100) * PREVIEW_PORT_OFFSET


def ask_decision(domain: str, allowed_suffixes: Sequence[str] = TLS_ASK_ALLOWED_SUFFIXES) -> bool:
    """Caddy on-demand-TLS ask approval (pure)."""
    domain = domain.strip().lower()
    return any(domain.endswith(suffix) for suffix in allowed_suffixes)


def is_ask_path(path: str) -> bool:
    return urllib.parse.urlparse(path).path == ASK_PATH


# ── External effects (stubbed in tests) ───────────────────────────────────────


def poke_wake(pr_number: int, manager_path: Path, python_bin: str) -> bool:
    """Fire-and-forget wake of the lazy-start manager. Non-fatal (logged).

    The gateway calls this on EVERY routed request so repeat visits to a
    stopped preview still wake it even when Caddy holds the cached certificate
    (m3). Popen errors are logged, never raised — the gateway must keep
    serving.
    """
    argv = [python_bin, str(manager_path), "--wake", str(pr_number)]
    try:
        subprocess.Popen(
            argv,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
        )
        return True
    except OSError as e:
        log(f"wake poke failed for pr{pr_number}: {e}")
        return False


def probe_port(port: int, timeout: float = 1.0) -> bool:
    """True when something is listening on the local port (used with retries
    while a preview boots)."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except OSError:
        return False


def wait_for_port(
    port: int,
    budget_seconds: float = WAKE_TIMEOUT_SECONDS,
    poll_seconds: float = WAKE_POLL_SECONDS,
    probe: Optional[callable] = None,
) -> bool:
    """Bounded retry while the preview boots (~up to 15 s by default)."""
    import time

    probe = probe or probe_port
    deadline = dt.datetime.now() + dt.timedelta(seconds=budget_seconds)
    while True:
        if probe(port):
            return True
        if dt.datetime.now() >= deadline:
            return False
        time.sleep(poll_seconds)


def http_proxy(
    method: str,
    path: str,
    headers: Dict[str, str],
    body: bytes,
    port: int,
    connect_timeout: float = 10.0,
    read_timeout: float = 30.0,
) -> Tuple[int, bytes, str]:
    """Proxy one request to the local preview app (or health endpoint).

    Returns (status, body, content_type). Raises OSError on connect failure —
    the caller maps that to the retry loop or the 503 JSON error.
    """
    target = f"http://127.0.0.1:{port}{path}"
    req = urllib.request.Request(target, data=body if method in ("POST", "PUT", "PATCH") else None, method=method)
    for key, value in headers.items():
        if key.lower() in ("host", "content-length", "connection", "transfer-encoding"):
            continue  # rewritten by urllib for the new upstream
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=connect_timeout + read_timeout) as resp:
            return resp.status, resp.read(), resp.headers.get("Content-Type", "application/octet-stream")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get("Content-Type", "text/plain")
    except (urllib.error.URLError, OSError) as e:
        raise OSError(str(e)) from e


# ── HTTP server ───────────────────────────────────────────────────────────────


class GatewayState:
    """Immutable-ish config shared by request handlers (easy to stub)."""

    def __init__(
        self,
        base_domain: str,
        manager_path: Path,
        python_bin: str,
        poke: Optional[callable] = None,
        prober: Optional[callable] = None,
        proxy: Optional[callable] = None,
        boot_budget: float = WAKE_TIMEOUT_SECONDS,
    ) -> None:
        self.base_domain = base_domain
        self.manager_path = manager_path
        self.python_bin = python_bin
        # Injectable effect functions (tests stub these; production uses the
        # module-level ones). The poke fires on EVERY routed request.
        self.poke = poke or poke_wake
        self.prober = prober or probe_port
        self.proxy_fn = proxy or http_proxy
        # How long the router waits for a booting preview before 503.
        self.boot_budget = boot_budget


def make_handler(state: GatewayState) -> type:
    class GatewayHandler(BaseHTTPRequestHandler):
        server_version = "preview-gateway/1.0"

        # -- ask endpoint --------------------------------------------------
        def _answer_ask(self) -> None:
            params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            domain = (params.get("domain") or [""])[0]
            if ask_decision(domain):
                self.send_response(200)
            else:
                self.send_response(403)
            self.end_headers()

        # -- router ---------------------------------------------------------
        def _answer_route(self) -> None:
            decision = parse_preview_host(self.headers.get("Host", ""), state.base_domain)
            if not decision.matched:
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps({"error": "no preview route for this host"}).encode()
                )
                return
            pr_number = int(decision.pr_number or 0)
            port = int(decision.port or 0)
            # Wake on EVERY request (m3): cached-cert repeat visits wake too.
            state.poke(pr_number, state.manager_path, state.python_bin)
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b""
            if hasattr(self.headers, "items"):
                headers = {k: v for k, v in self.headers.items()}
            else:
                headers = dict(self.headers)  # test doubles may use plain dicts
            if not wait_for_port(port, budget_seconds=state.boot_budget, probe=state.prober):
                self._send_503(pr_number)
                return
            try:
                status, resp_body, ctype = state.proxy_fn(
                    self.command, self.path, headers, body, port
                )
            except OSError as e:
                self._send_503(pr_number, detail=str(e))
                return
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(resp_body)))
            self.end_headers()
            self.wfile.write(resp_body)

        def _send_503(self, pr_number: int, detail: str = "") -> None:
            payload = {
                "error": "preview not ready",
                "pr": pr_number,
                "detail": detail or "preview app did not accept connections within the boot budget",
            }
            self.send_response(503)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(json.dumps(payload).encode())))
            self.end_headers()
            self.wfile.write(json.dumps(payload).encode())

        def _handle(self) -> None:
            try:
                if is_ask_path(self.path):
                    self._answer_ask()
                else:
                    self._answer_route()
            except BrokenPipeError:
                pass

        def do_GET(self):
            self._handle()

        def do_POST(self):
            self._handle()

        def do_HEAD(self):
            self._handle()

        def do_PUT(self):
            self._handle()

        def do_PATCH(self):
            self._handle()

        def do_DELETE(self):
            self._handle()

        def log_message(self, *args):
            pass  # the manager journal owns logging; keep request logs quiet

    return GatewayHandler


def serve(
    base_domain: str,
    listen_port: int,
    manager_path: Path,
    python_bin: str,
    state: Optional[GatewayState] = None,
) -> None:
    state = state or GatewayState(base_domain, manager_path, python_bin)
    httpd = ThreadingHTTPServer(("127.0.0.1", listen_port), make_handler(state))
    log(f"listening on 127.0.0.1:{listen_port} (base_domain={base_domain})")
    httpd.serve_forever()


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-domain", default=DEFAULT_BASE_DOMAIN)
    parser.add_argument("--listen-port", type=int, default=DEFAULT_GATEWAY_PORT)
    parser.add_argument(
        "--manager-path",
        type=Path,
        default=Path("/home/debian/preview-infra/preview_manager.py"),
        help="Path to preview_manager.py (provisioned with an explicit path; "
        "no ~ expansion).",
    )
    parser.add_argument("--python-bin", default="/usr/bin/python3")
    args = parser.parse_args(argv)
    serve(
        base_domain=args.base_domain,
        listen_port=args.listen_port,
        manager_path=args.manager_path,
        python_bin=args.python_bin,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())