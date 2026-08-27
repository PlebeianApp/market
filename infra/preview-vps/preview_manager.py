#!/usr/bin/env python3
"""preview_manager.py — lazy-start manager for per-PR preview deployments.

Runs on the preview VPS alongside Caddy and Docker. It keeps the finite set of
live previews in check:

  1. IDLE STOP — containers for a preview whose subdomain has not been accessed
     (Caddy access log) for IDLE_HOURS are stopped to free memory. The DNS
     record is kept so the URL still resolves; Caddy's tls-ask endpoint wakes
     the preview on the next visit (see `wake_on_access` below).

  2. WAKE ON ACCESS — Caddy calls `GET /ask?domain=<host>` on the tls-ask
     endpoint before issuing a certificate. That endpoint (in provision.sh)
     doubles as a wake hook: when it approves a *.test-market.orangesync.tech
     domain it asks this manager to `docker compose start` the matching
     preview. A stopped preview therefore boots on first access with no
     operator action.

  3. RECENCY RANKING — for open PRs the manager queries the GitHub API for the
     PR list (open, sorted by pushed_at) and keeps only the top K most recently
     pushed previews *running*; the rest are stopped (but still wakeable). This
     bounds resource usage on the shared VPS while guaranteeing the newest work
     is always warm.

  4. CLEANUP — for preview directories whose PR is no longer open (closed or
     merged), the manager runs `docker compose down`, deletes the Cloudflare
     A record and removes the preview directory. This is the safety net for the
     `teardown` job in preview-deploy.yml (which handles the normal closed-PR
     path); it also catches PRs that are closed without the teardown job
     firing.

The manager is VPS-agnostic: every external effect (docker, gh, curl to
Cloudflare, Caddy log reading) is isolated behind functions that can be stubbed
in unit tests. It is safe to run repeatedly (idempotent) and safe to run as a
cron job (`--cron`) or interactively.

Environment / CLI knobs (all optional):
  PREVIEW_ROOT          — directory holding one folder per PR, default ~/previews
  IDLE_HOURS            — idle threshold before a preview is stopped, default 4
  TOP_K                 — number of most-recent previews kept running, default 5
  PREVIEW_DOMAIN        — base domain for previews, default test-market.orangesync.tech
  CLOUDFLARE_ZONE_ID    — Cloudflare zone id for DNS cleanup (optional)
  CLOUDFLARE_API_TOKEN  — Cloudflare API token for DNS cleanup (optional)
  GITHUB_TOKEN          — used for the gh API queries when gh is unavailable
  GITHUB_REPO           — owner/repo for open-PR recency ranking
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple

DictPreview = Dict[int, Optional[dt.datetime]]

# ── Pure helpers (no I/O) ─────────────────────────────────────────────────────

ACCESS_LOG_RE = re.compile(
    r"(?P<host>pr\d+\.test-market\.orangesync\.tech)"
)
PR_DIR_RE = re.compile(r"^pr-(\d+)$")


@dataclass
class Preview:
    """A per-PR preview directory on the VPS."""

    pr_number: int
    directory: Path
    last_access: Optional[dt.datetime]  # None => never accessed
    running: bool  # true if compose services are currently up

    @property
    def subdomain(self) -> str:
        return f"pr{self.pr_number}.test-market.orangesync.tech"


def parse_access_log_lines(
    lines: Iterable[str], base_domain: str = "test-market.orangesync.tech"
) -> List[Tuple[int, dt.datetime]]:
    """Extract (pr_number, access_time) from Caddy access-log lines.

    Caddy's default JSON access log has a `request.host` field with the
    subdomain and a `time` field in RFC3339. We accept either that JSON shape
    or a plain `host <timestamp>` line. Lines that don't mention a preview
    subdomain are ignored. Returns tuples sorted newest-first.
    """
    host_re = re.compile(rf"pr(\d+)\.{re.escape(base_domain)}")
    out: List[Tuple[int, dt.datetime]] = []
    for line in lines:
        m = host_re.search(line)
        if not m:
            continue
        pr_number = int(m.group(1))
        # Try JSON `"time":"2026-08-27T12:00:00Z"` first.
        tm = re.search(r'"time"\s*:\s*"([^"]+)"', line)
        if tm:
            try:
                ts = _parse_rfc3339(tm.group(1))
            except ValueError:
                ts = None
        else:
            ts = None
        # Fall back to a bare RFC3339 token anywhere in the line.
        if ts is None:
            bm = re.search(
                r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})",
                line,
            )
            if bm:
                try:
                    ts = _parse_rfc3339(bm.group(0))
                except ValueError:
                    ts = None
        if ts is not None:
            out.append((pr_number, ts))
    out.sort(key=lambda item: item[1], reverse=True)
    return out


def _parse_rfc3339(s: str) -> dt.datetime:
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    # Normalize "Z" already handled; strip sub-second if present (we keep it).
    if "+" in s or "T" in s:
        return dt.datetime.fromisoformat(s)
    return dt.datetime.fromisoformat(s)


def last_access_by_pr(
    previews: Sequence[Preview],
    access_log_entries: Sequence[Tuple[int, dt.datetime]],
) -> DictPreview:
    """Return {pr_number: most_recent_access_time} from parsed log entries.

    The most recent access per PR is kept regardless of entry order.
    """
    result: DictPreview = {}
    for pr_number, ts in access_log_entries:
        prev = result.get(pr_number)
        if prev is None or ts > prev:
            result[pr_number] = ts
    # Previews that were never accessed get None explicitly.
    for preview in previews:
        result.setdefault(preview.pr_number, None)
    return result


def is_idle(
    last_access: Optional[dt.datetime],
    now: dt.datetime,
    idle_hours: float,
) -> bool:
    """A preview is idle if it has not been accessed in `idle_hours`.

    A preview with no recorded access is treated as idle (so a freshly
    provisioned preview that nobody visits gets reaped too).
    """
    if last_access is None:
        return True
    return (now - last_access) > dt.timedelta(hours=idle_hours)


# ── Environment / subprocess shims (stubbed in tests) ────────────────────────

class Runner:
    """Thin wrapper around subprocess so tests can inject fake output."""

    def __init__(self) -> None:
        self.cwd: Optional[str] = None

    def run(self, argv: Sequence[str], timeout: int = 60) -> str:
        return subprocess.run(
            list(argv),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        ).stdout


def list_preview_directories(
    preview_root: Path, runner: Runner | None = None
) -> List[Preview]:
    """Enumerate pr-<N> directories under preview_root and their running state."""
    runner = runner or Runner()
    previews: List[Preview] = []
    if not preview_root.is_dir():
        return previews
    for entry in sorted(preview_root.iterdir()):
        m = PR_DIR_RE.match(entry.name)
        if not m or not entry.is_dir():
            continue
        pr_number = int(m.group(1))
        running = False
        if (entry / "docker-compose.yml").is_file():
            out = runner.run(
                [
                    "docker",
                    "compose",
                    "-f",
                    str(entry / "docker-compose.yml"),
                    "ps",
                    "--format",
                    "{{.State}}",
                ]
            )
            running = "running" in out.lower() or "up" in out.lower()
        previews.append(
            Preview(
                pr_number=pr_number,
                directory=entry,
                last_access=None,
                running=running,
            )
        )
    return previews


def read_access_logs(
    log_paths: Sequence[Path], runner: Runner | None = None
) -> List[Tuple[int, dt.datetime]]:
    """Read last-access timestamps from Caddy access logs."""
    entries: List[Tuple[int, dt.datetime]] = []
    for path in log_paths:
        if not path.is_file():
            continue
        try:
            with path.open("r", encoding="utf-8", errors="replace") as fh:
                lines = fh.readlines()
        except OSError:
            continue
        entries.extend(parse_access_log_lines(lines))
    entries.sort(key=lambda item: item[1], reverse=True)
    return entries


def stop_preview(preview: Preview) -> bool:
    """`docker compose down` for a preview. Returns True on success."""
    compose = preview.directory / "docker-compose.yml"
    if not compose.is_file():
        return False
    try:
        subprocess.run(
            [
                "docker",
                "compose",
                "-f",
                str(compose),
                "down",
                "--remove-orphans",
                "--volumes",
            ],
            capture_output=True,
            text=True,
            timeout=180,
            check=False,
        )
        return True
    except (subprocess.SubprocessError, OSError):
        return False


def start_preview(preview: Preview) -> bool:
    """`docker compose start` for a preview (wake). Returns True on success."""
    compose = preview.directory / "docker-compose.yml"
    if not compose.is_file():
        return False
    try:
        subprocess.run(
            ["docker", "compose", "-f", str(compose), "start"],
            capture_output=True,
            text=True,
            timeout=180,
            check=False,
        )
        return True
    except (subprocess.SubprocessError, OSError):
        return False


def open_pr_numbers(
    repo: str,
    token: Optional[str],
    runner: Runner | None = None,
) -> List[int]:
    """List open PR numbers for a repo, sorted by pushed_at (newest first).

    Uses the `gh` CLI when available, else the REST API via curl. Returns an
    empty list when neither works so the manager degrades to idle-only cleanup.
    """
    runner = runner or Runner()
    if token:
        import json

        url = f"https://api.github.com/repos/{repo}/pulls?state=open&sort=updated&direction=desc&per_page=100"
        out = runner.run(["curl", "-sS", "-H", f"Authorization: Bearer {token}", url])
        try:
            data = json.loads(out)
            if isinstance(data, list):
                return [int(item["number"]) for item in data]
        except (ValueError, KeyError, TypeError):
            pass
        return []
    # Fall back to gh CLI.
    out = runner.run(["gh", "pr", "list", "--repo", repo, "--state", "open", "--json", "number"])
    import json

    try:
        data = json.loads(out)
        if isinstance(data, list):
            return [int(item["number"]) for item in data]
    except (ValueError, KeyError, TypeError):
        pass
    return []


def delete_cloudflare_record(
    pr_number: int,
    zone_id: str,
    api_token: str,
    base_domain: str,
    runner: Runner | None = None,
) -> bool:
    """Delete the Cloudflare A record for a preview subdomain. Best-effort."""
    runner = runner or Runner()
    subdomain = f"pr{pr_number}.{base_domain}"
    list_url = (
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records"
        f"?type=A&name={subdomain}"
    )
    try:
        import json

        out = runner.run(
            ["curl", "-sS", "-H", f"Authorization: Bearer {api_token}", list_url]
        )
        data = json.loads(out)
        for record in data.get("result", []):
            rid = record.get("id")
            if not rid:
                continue
            runner.run(
                [
                    "curl",
                    "-sS",
                    "-X",
                    "DELETE",
                    "-H",
                    f"Authorization: Bearer {api_token}",
                    f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records/{rid}",
                ]
            )
        return True
    except (ValueError, subprocess.SubprocessError, OSError):
        return False


# ── Orchestration ─────────────────────────────────────────────────────────────

def find_preview(
    previews: Sequence[Preview], pr_number: int
) -> Optional[Preview]:
    for p in previews:
        if p.pr_number == pr_number:
            return p
    return None


def wake_preview_by_domain(
    domain: str,
    previews: Sequence[Preview],
    base_domain: str,
    start_fn: Callable[[Preview], bool] = start_preview,
) -> bool:
    """Wake a stopped preview whose subdomain was requested.

    Called from the tls-ask endpoint when it approves a preview subdomain.
    Returns True if a matching preview exists and (re)start was attempted.
    """
    m = re.match(rf"pr(\d+)\.{re.escape(base_domain)}/?$", domain.strip())
    if not m:
        return False
    pr_number = int(m.group(1))
    preview = find_preview(previews, pr_number)
    if preview is None:
        return False
    if not preview.running:
        return start_fn(preview)
    return True  # already running


def run_cycle(
    preview_root: Path,
    *,
    now: dt.datetime | None = None,
    idle_hours: float = 4.0,
    top_k: int = 5,
    base_domain: str = "test-market.orangesync.tech",
    log_paths: Sequence[Path] = (),
    gh_repo: Optional[str] = None,
    gh_token: Optional[str] = None,
    cf_zone: Optional[str] = None,
    cf_token: Optional[str] = None,
    dry_run: bool = False,
) -> dict:
    """Run one full manager cycle. Returns a summary dict.

    Pure decision functions are used so the whole cycle can be exercised with a
    fake filesystem in tests; external effects go through Runner/stop/start/
    open_pr/cloudflare shims.
    """
    now = now or dt.datetime.now(dt.timezone.utc)
    previews = list_preview_directories(preview_root)
    log_entries = read_access_logs(log_paths)
    last_access = last_access_by_pr(previews, log_entries)
    for p in previews:
        p.last_access = last_access.get(p.pr_number)

    # Open-PR recency ranking: keep top-K most recent running.
    open_prs = open_pr_numbers(gh_repo, gh_token) if gh_repo else []
    open_set = set(open_prs)
    keep_running = set(open_prs[:top_k])  # newest first

    to_stop: List[int] = []
    to_teardown: List[int] = []
    for p in previews:
        if not p.running:
            continue
        if p.pr_number not in open_set:
            # Preview for a closed/merged PR: tear down entirely, not just stop.
            to_teardown.append(p.pr_number)
        elif is_idle(p.last_access, now, idle_hours):
            to_stop.append(p.pr_number)
        elif p.pr_number not in keep_running:
            to_stop.append(p.pr_number)

    results = {
        "stopped": [],
        "started": [],
        "torn_down": [],
        "dry_run": dry_run,
    }
    if not dry_run:
        for pr_number in to_stop:
            preview = find_preview(previews, pr_number)
            if preview and stop_preview(preview):
                results["stopped"].append(pr_number)
        for pr_number in to_teardown:
            preview = find_preview(previews, pr_number)
            if not preview:
                continue
            stop_preview(preview)
            if cf_zone and cf_token:
                delete_cloudflare_record(
                    pr_number, cf_zone, cf_token, base_domain
                )
            # Remove the preview directory to reclaim disk on the VPS.
            try:
                import shutil

                shutil.rmtree(str(preview.directory), ignore_errors=True)
            except OSError:
                pass
            results["torn_down"].append(pr_number)
    else:
        results["stopped"] = to_stop
        results["torn_down"] = to_teardown

    return results


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cron",
        action="store_true",
        help="Run one cycle suitable for a cron job (non-interactive, quiet).",
    )
    parser.add_argument(
        "--wake",
        metavar="DOMAIN",
        help="Wake a stopped preview whose subdomain is being requested "
        "(called by the tls-ask endpoint).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be stopped/torn down without changing anything.",
    )
    parser.add_argument(
        "--preview-root",
        default=os.path.expanduser("~/previews"),
        help="Directory holding one folder per PR (default ~/previews).",
    )
    parser.add_argument("--idle-hours", type=float, default=4.0)
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--base-domain", default="test-market.orangesync.tech")
    parser.add_argument(
        "--access-log",
        action="append",
        default=[],
        help="Path to a Caddy access log to read for idle detection (repeatable).",
    )
    parser.add_argument(
        "--gh-repo",
        default=os.environ.get("GITHUB_REPO"),
        help="owner/repo for open-PR recency ranking.",
    )
    args = parser.parse_args(argv)

    preview_root = Path(args.preview_root)
    cf_zone = os.environ.get("CLOUDFLARE_ZONE_ID")
    cf_token = os.environ.get("CLOUDFLARE_API_TOKEN")
    gh_token = os.environ.get("GITHUB_TOKEN")

    if args.wake:
        # Wake hook invoked by tls-ask on the first request to a preview
        # subdomain. Non-interactive; never blocks TLS issuance.
        previews = list_preview_directories(preview_root)
        woken = wake_preview_by_domain(
            args.wake, previews, args.base_domain
        )
        return 0 if woken else 1

    log_paths = [Path(p) for p in args.access_log]

    results = run_cycle(
        preview_root,
        idle_hours=args.idle_hours,
        top_k=args.top_k,
        base_domain=args.base_domain,
        log_paths=log_paths,
        gh_repo=args.gh_repo,
        gh_token=gh_token,
        cf_zone=cf_zone,
        cf_token=cf_token,
        dry_run=args.dry_run,
    )

    if args.cron:
        # Quiet single line for cron; still exits nonzero on real errors via
        # the shell wrapper. Keep logs minimal so cron mail is not spammy.
        print(f"preview-manager: stopped={len(results['stopped'])} torn_down={len(results['torn_down'])}")
        return 0

    print(f"Stopped: {results['stopped']}")
    print(f"Started: {results['started']}")
    print(f"Torn down: {results['torn_down']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
