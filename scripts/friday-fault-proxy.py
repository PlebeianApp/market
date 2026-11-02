#!/usr/bin/env python3
"""Loopback-only Cashu proxy for a dropped or deliberately stalled swap response.

The upstream receives and completes the request before this proxy closes the client
connection. With a dedicated control directory it can instead hold one response
until released. This is a bounded test fixture for ambiguity/timeout recovery;
it must never be put in front of the live demo or any real-value mint.
"""

from __future__ import annotations

import argparse
import http.client
import http.server
import pathlib
import threading
import time
import urllib.parse


class FaultProxy(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    upstream_host = "127.0.0.1"
    upstream_port = 0
    drop_lock = threading.Lock()
    drop_remaining = 1
    control_dir: pathlib.Path | None = None

    def do_GET(self) -> None:  # noqa: N802
        self._forward()

    def do_POST(self) -> None:  # noqa: N802
        self._forward()

    def _forward(self) -> None:
        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length) if length else None
        headers = {
            key: value
            for key, value in self.headers.items()
            if key.lower() not in {"connection", "host", "content-length", "accept-encoding"}
        }
        headers["Host"] = f"{self.upstream_host}:{self.upstream_port}"
        if body is not None:
            headers["Content-Length"] = str(len(body))
        connection = http.client.HTTPConnection(self.upstream_host, self.upstream_port, timeout=15)
        try:
            connection.request(self.command, self.path, body=body, headers=headers)
            response = connection.getresponse()
            response_body = response.read()
            should_drop = False
            should_stall = False
            if self.command == "POST" and urllib.parse.urlsplit(self.path).path == "/v1/swap":
                with self.drop_lock:
                    control = type(self).control_dir
                    stall_flag = None if control is None else control / "stall-next-swap"
                    drop_flag = None if control is None else control / "drop-next-swap"
                    if stall_flag is not None and stall_flag.exists():
                        stall_flag.unlink()
                        should_stall = True
                    elif drop_flag is not None and drop_flag.exists():
                        drop_flag.unlink()
                        should_drop = True
                    elif control is None and type(self).drop_remaining > 0:
                        type(self).drop_remaining -= 1
                        should_drop = True
            if should_stall:
                control = type(self).control_dir
                assert control is not None
                (control / "swap-completed").write_text("upstream swap completed; response held\n", encoding="utf-8")
                deadline = time.monotonic() + 120
                while not (control / "release-swap").exists() and time.monotonic() < deadline:
                    time.sleep(0.05)
                if not (control / "release-swap").exists():
                    should_drop = True
            if should_drop:
                self.close_connection = True
                try:
                    self.connection.shutdown(2)
                except OSError:
                    pass
                self.connection.close()
                return
            self.send_response(response.status, response.reason)
            for key, value in response.getheaders():
                if key.lower() not in {"connection", "content-length", "transfer-encoding"}:
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(response_body)))
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                self.wfile.write(response_body)
            except (BrokenPipeError, ConnectionResetError):
                self.close_connection = True
        finally:
            connection.close()

    def log_message(self, _format: str, *_args: object) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--listen-port", type=int, required=True)
    parser.add_argument("--upstream-port", type=int, required=True)
    parser.add_argument("--control-dir", type=pathlib.Path)
    args = parser.parse_args()
    if not 1024 <= args.listen_port <= 65535 or not 1024 <= args.upstream_port <= 65535:
        raise SystemExit("ports must be unprivileged TCP ports")
    FaultProxy.upstream_port = args.upstream_port
    if args.control_dir is not None:
        control = args.control_dir.resolve()
        if not str(control).startswith("/tmp/plebeian-friday-") or not control.is_dir():
            raise SystemExit("control directory must be an existing /tmp/plebeian-friday-* directory")
        FaultProxy.control_dir = control
        FaultProxy.drop_remaining = 0
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.listen_port), FaultProxy)
    server.serve_forever()


if __name__ == "__main__":
    main()
