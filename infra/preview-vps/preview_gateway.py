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
     with a JSON error body. A BROWSER (`Accept: text/html`) instead gets a small
     self-reloading page saying the preview is starting, so a lazy-started
     preview does not look broken; every other client keeps the JSON contract
     that the CI health check and scripts rely on. The proxy is a deliberately
     TOLERANT HTTP client:
     it ignores leading blank line(s) before the upstream status line (RFC 9112
     §2.2 — the preview app emits one, and strict clients such as urllib raise
     BadStatusLine on it), and any upstream/proxy failure is answered as a JSON
     503 rather than escaping the handler as an empty reply (which Caddy shows
     as 502 Bad Gateway).

Everything is a small pure function over `dataclass RouteDecision` so the
routing logic is unit-testable without sockets (test_preview_gateway.py).
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import http.client
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


# ── Tolerant upstream HTTP client (RFC 9112 §2.2) ────────────────────────────
#
# The preview app answers with a stray blank line BEFORE the status line (raw
# socket read: b"\r\n" then "HTTP/1.1 200 OK ..."). RFC 9112 §2.2 says a client
# MAY ignore at least one empty line before the status line, and curl does —
# but http.client/urllib do not: `urlopen` raises
# http.client.BadStatusLine('\r\n'), which is an HTTPException and NOT an
# OSError. The gateway must behave like curl here.


class _LeadingBlankLineSkippingFile:
    """Socket-file wrapper that swallows leading empty line(s).

    It alters ONLY the first read: leading b"\\r\\n" / b"\\n" lines are consumed
    until a non-empty line arrives, which is then returned as the status line.
    Every subsequent read — header lines and the body, chunked bodies included —
    is delegated untouched to the original socket file, so the response is still
    parsed and the body still decoded by http.client's own parser (no
    intermediate buffer, no hand-rolled HTTP parsing).
    """

    def __init__(self, fp) -> None:
        self._fp = fp
        self._skipped = False

    def readline(self, *args, **kwargs) -> bytes:
        line = self._fp.readline(*args, **kwargs)
        if not self._skipped:
            while line in (b"\r\n", b"\n"):
                line = self._fp.readline(*args, **kwargs)
            self._skipped = True
        return line

    def __getattr__(self, name):
        # close/gettimeout/read/readinto/... all behave exactly as before.
        return getattr(self._fp, name)


class _TolerantHTTPResponse(http.client.HTTPResponse):
    """HTTPResponse that tolerates leading empty line(s) before the status
    line by wrapping the socket file before http.client parses the reply."""

    def begin(self):
        if not isinstance(self.fp, _LeadingBlankLineSkippingFile):
            self.fp = _LeadingBlankLineSkippingFile(self.fp)
        return super().begin()


class _TolerantHTTPConnection(http.client.HTTPConnection):
    response_class = _TolerantHTTPResponse


class _TolerantHTTPHandler(urllib.request.HTTPHandler):
    """urllib handler that builds tolerant connections.

    `build_opener` drops the stock HTTPHandler because this is a subclass of
    it, so every http:// urlopen below goes through _TolerantHTTPConnection.
    """

    def http_open(self, req):
        return self.do_open(_TolerantHTTPConnection, req)


_TOLERANT_OPENER = urllib.request.build_opener(_TolerantHTTPHandler)


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
    the caller maps that to the retry loop or the 503 JSON error. A malformed
    upstream reply raises http.client.HTTPException (BadStatusLine,
    RemoteDisconnected, ...); the caller answers 503 rather than crashing.
    """
    target = f"http://127.0.0.1:{port}{path}"
    req = urllib.request.Request(target, data=body if method in ("POST", "PUT", "PATCH") else None, method=method)
    for key, value in headers.items():
        if key.lower() in ("host", "content-length", "connection", "transfer-encoding"):
            continue  # rewritten by urllib for the new upstream
        req.add_header(key, value)
    try:
        with _TOLERANT_OPENER.open(req, timeout=connect_timeout + read_timeout) as resp:
            return resp.status, resp.read(), resp.headers.get("Content-Type", "application/octet-stream")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get("Content-Type", "text/plain")
    except (urllib.error.URLError, OSError) as e:
        raise OSError(str(e)) from e


# ── The 503 body: machines get JSON, humans get a page they can watch ─────────
#
# A preview is lazy-started: the first visit to a stopped preview pokes the
# manager, the app boots, and until it does the gateway has nothing to proxy to.
# Answering that window with a JSON blob looks like a broken site, so browsers
# get a small self-contained page (no external assets — the app is not up yet)
# that explains the wait and reloads itself every few seconds.
#
# Content negotiation is deliberately crude: `Accept: text/html` means a browser.
# curl, `fetch()` in a script, uptime probes and the CI health check send `*/*`
# or nothing and MUST keep the machine-readable JSON contract — the health check
# greps the status and body size, and the deploy comments quote `detail`.

STARTING_PAGE_REFRESH_SECONDS = 5

STARTING_PAGE_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="__REFRESH_SECONDS__">
<meta name="robots" content="noindex">
<title>PR __PR_NUMBER__ preview is starting</title>
<style>
  :root { color-scheme: dark }
  * { box-sizing: border-box }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0a0a0a; color: #ededed;
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  main { width: min(32rem, 92vw); padding: 3rem 1.5rem; text-align: center }
  .pulse {
    width: .7rem; height: .7rem; border-radius: 99px; background: #f7931a;
    display: inline-block; margin-right: .55rem;
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: .25 } 50% { opacity: 1 } }
  h1 { font-size: 1.3rem; margin: 0 0 .75rem; font-weight: 600 }
  p { margin: .5rem 0; color: #b4b4b4 }
  .bar {
    height: 4px; border-radius: 99px; overflow: hidden; background: #232323;
    margin: 1.75rem auto 0; width: min(18rem, 70vw);
  }
  .bar > i { display: block; height: 100%; width: 0; background: #f7931a;
             transition: width 1s linear }
  a { color: #f7931a }
  small { display: block; margin-top: 1.5rem; color: #7b7b7b; font-size: .82rem }
  .detail { word-break: break-word }
</style>
</head>
<body>
<main>
  <span class="pulse" aria-hidden="true"></span>
  <h1>PR __PR_NUMBER__ preview is starting</h1>
  <p>The container for this pull-request preview is booting. The first start
     takes a little while, so this page will reload itself every
     __REFRESH_SECONDS__ seconds — nothing to do on your end.</p>
  <div class="bar"><i id="bar"></i></div>
  <small><a href="">Reload now</a></small>
  <small>Still seeing this after a minute? The preview may have failed to
     start — check the “Deploy preview” check on the pull request for the run
     log.</small>
  __DETAIL__
</main>
<script>
  // Cosmetic only: the <meta http-equiv="refresh"> above performs the reload.
  var left = __REFRESH_SECONDS__, total = __REFRESH_SECONDS__;
  var bar = document.getElementById('bar');
  setInterval(function () {
    left = left > 0 ? left - 1 : 0;
    bar.style.width = (100 * (total - left) / total) + '%';
  }, 1000);
</script>
</body>
</html>
"""


def prefers_html(accept: Optional[str]) -> bool:
    """True when the client is a browser rather than a script/probe (pure)."""
    if not accept:
        return False
    return "text/html" in accept.lower()


def starting_page(
    pr_number: int,
    detail: str = "",
    refresh_seconds: int = STARTING_PAGE_REFRESH_SECONDS,
) -> bytes:
    """The self-reloading "preview is starting" page (pure).

    `detail` is exception text from an untrusted upstream, so it is HTML-escaped
    and only rendered when present.
    """
    detail_html = ""
    if detail:
        detail_html = (
            '<small class="detail">Technical detail: '
            f"{html.escape(detail)}</small>"
        )
    page = (
        STARTING_PAGE_TEMPLATE.replace("__PR_NUMBER__", str(int(pr_number)))
        .replace("__REFRESH_SECONDS__", str(int(refresh_seconds)))
        .replace("__DETAIL__", detail_html)
    )
    return page.encode("utf-8")


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
            except http.client.HTTPException as e:
                # A malformed upstream reply (leading garbage, empty reply,
                # truncated headers, ...) is an HTTPException, NOT an OSError.
                # Letting it escape closes the connection with no response at
                # all, which Caddy renders as 502 Bad Gateway. Answer a JSON
                # 503 instead: a debuggable error beats an empty reply.
                log(f"proxy to pr{pr_number} got a malformed upstream response: {e!r}")
                self._send_503(
                    pr_number, detail=f"upstream returned a malformed HTTP response: {e}"
                )
                return
            except Exception as e:
                # Defensive: a proxy that returns a 503 is debuggable; an
                # exception escaping the handler (→ 502) is not.
                log(f"proxy to pr{pr_number} failed: {e!r}")
                self._send_503(pr_number, detail=f"proxy failed: {e}")
                return
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(resp_body)))
            self.end_headers()
            self.wfile.write(resp_body)

        def _send_503(self, pr_number: int, detail: str = "") -> None:
            """Answer "not ready yet".

            Browsers (`Accept: text/html`) get a self-reloading page; every other
            client gets the JSON body it already expects. Either way the status is
            503 and `Retry-After` says when to come back.
            """
            detail = detail or "preview app did not accept connections within the boot budget"
            if prefers_html(self.headers.get("Accept")):
                body = starting_page(pr_number, detail)
                content_type = "text/html; charset=utf-8"
            else:
                payload = {
                    "error": "preview not ready",
                    "pr": pr_number,
                    "detail": detail,
                }
                body = json.dumps(payload).encode()
                content_type = "application/json"
            self.send_response(503)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Retry-After", str(STARTING_PAGE_REFRESH_SECONDS))
            self.end_headers()
            self.wfile.write(body)

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