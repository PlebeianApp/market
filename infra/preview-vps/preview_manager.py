#!/usr/bin/env python3
"""preview_manager.py — lazy-start manager for per-PR preview deployments.

Runs on the preview VPS alongside Caddy, Docker and preview_gateway.py. It keeps
the finite set of live previews in check:

  1. IDLE STOP — running containers for a preview whose subdomain has not been
     accessed (Caddy access log) for IDLE_HOURS are stopped with
     `docker compose stop` (containers + volumes retained, DNS kept). This is
     why a stopped preview can be woken cheaply with `docker compose start`.
     Unknown last access is NOT idle (see `idle_decision`): a preview with no
     recorded access is skipped with a loud log — misconfiguring (or forgetting)
     the access log must not stop every preview on the VPS.

  2. WAKE ON ACCESS — preview_gateway.py (the VPS-local HTTP front) pokes this
     manager with `--wake <pr_number>` on EVERY request to a preview subdomain,
     so a stopped preview boots even when Caddy already holds the cached
     certificate. Wake never blocks the gateway request.

  3. RECENCY RANKING — for open PRs the manager queries the GitHub API
     (anonymous, public repo, sorted by pushed_at) and keeps only the top K most
     recently pushed previews *running*; the rest are stopped (still wakeable).

  4. CLEANUP (fail-closed) — for preview directories whose PR is no longer open
     (closed or merged), the manager runs `docker compose down
     --remove-orphans --volumes`, deletes the Cloudflare A record (when
     credentials are configured via the manager's EnvironmentFile) and removes
     the preview directory. The open-PR list is fetched with FULL pagination;
     any fetch error, rate limit or unexpected truncation returns None and the
     cycle then SKIPS every teardown and recency-stop decision (idle-stop, which
     is recoverable, still runs). Never trust a partial listing for destruction.

Port allocation: preview ports are 3000 + (PR % 100) * 10. PRs congruent mod 100
share an offset, so deploys claim the marker file preview_root/ports/<offset>
before compose up and release it on teardown; the manager releases markers whose
preview directory has disappeared.

The manager is VPS-agnostic: every external effect (docker, gh/curl, Cloudflare,
Caddy log reading) is isolated behind functions that can be stubbed in unit
tests. It is safe to run repeatedly (idempotent) and safe to run as a cron job
(`--cron`) or interactively.

Environment / CLI knobs (all optional):
  PREVIEW_ROOT          — directory holding one folder per PR, default ~/previews
  IDLE_HOURS            — idle threshold before a preview is stopped, default 4
  TOP_K                 — number of most-recent previews kept running, default 5
  PREVIEW_DOMAIN        — base domain for previews, default test-market.orangesync.tech
  CLOUDFLARE_ZONE_ID    — Cloudflare zone id for DNS cleanup (manager.env on the VPS)
  CLOUDFLARE_API_TOKEN  — Cloudflare API token for DNS cleanup (manager.env on the VPS)
  GITHUB_REPO           — owner/repo for open-PR recency ranking (public repo; no
                          token needed — the API is called anonymously)
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple

DictPreview = Dict[int, Optional[dt.datetime]]

DOCKER_STOP_TIMEOUT = 60
DOCKER_DOWN_TIMEOUT = 180
DOCKER_START_TIMEOUT = 180


def _log(message: str) -> None:
    print(message, file=sys.stderr)


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
    last_access: Optional[dt.datetime]  # None => unknown, never accessed or no logs
    running: bool  # true if compose services are currently up

    @property
    def subdomain(self) -> str:
        return f"pr{self.pr_number}.test-market.orangesync.tech"


def parse_access_log_lines(
    lines: Iterable[str], base_domain: str = "test-market.orangesync.tech"
) -> List[Tuple[int, dt.datetime]]:
    """Extract (pr_number, access_time) from Caddy access-log lines.

    Caddy's JSON access log has a `request.host` field with the subdomain and a
    `time` field in RFC3339. We accept either that JSON shape or a plain
    `host <timestamp>` line. Lines that don't mention a preview subdomain are
    ignored. Returns tuples sorted newest-first.
    """
    host_re = re.compile(rf"pr(\d+)\.{re.escape(base_domain)}")
    out: List[Tuple[int, dt.datetime]] = []
    for line in lines:
        m = host_re.search(line)
        if not m:
            continue
        pr_number = int(m.group(1))
        # Try JSON `"time":"2026-08-27T12:00:00Z"` first.
        ts: Optional[dt.datetime] = None
        tm = re.search(r'"time"\s*:\s*"([^"]+)"', line)
        if tm:
            ts = _parse_rfc3339(tm.group(1))
        else:
            # Fall back to a bare RFC3339 token anywhere in the line.
            bm = re.search(
                r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})",
                line,
            )
            if bm:
                ts = _parse_rfc3339(bm.group(0))
        if ts is not None:
            out.append((pr_number, ts))
    out.sort(key=lambda item: item[1], reverse=True)
    return out


def _parse_rfc3339(s: str) -> dt.datetime:
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
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
    """A preview is idle only if it has a RECORDED access older than idle_hours.

    last_access=None means the access data is missing/unknown (no log files, no
    entries) — that is NOT idle. Idle decisions with unknown data are skipped by
    `idle_decision` so a misconfigured access log can never stop every preview
    (B4). Never call this with None to justify a stop.
    """
    if last_access is None:
        return False
    return (now - last_access) > dt.timedelta(hours=idle_hours)


def idle_decision(
    last_access: Optional[dt.datetime],
    now: dt.datetime,
    idle_hours: float,
    pr_number: int,
    log: Callable[[str], None],
) -> bool:
    """Decide whether a preview may be idle-stopped, loudly skipping unknowns.

    No/missing log data => last_access UNKNOWN => NOT idle-stopped; only a
    recorded access older than idle_hours idles the preview.
    """
    if last_access is None:
        log(
            f"preview-manager: skipping idle decision for pr{pr_number}: "
            "no recorded access (unknown) — access log not configured or no "
            "entries for this preview"
        )
        return False
    return is_idle(last_access, now, idle_hours)


# ── Environment / subprocess shims (stubbed in tests) ────────────────────────

class Runner:
    """Thin wrapper around subprocess so tests can inject fake output.

    `run` returns (stdout, returncode). Real runs capture stdout; tests
    monkeypatch this class or inject a runner to record argv and return canned
    output — including the returncode, which callers must respect (m2).
    """

    def run(self, argv: Sequence[str], timeout: int = 60) -> Tuple[str, int]:
        proc = subprocess.run(
            list(argv),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return proc.stdout, proc.returncode

    def curl_json(
        self,
        method: str,
        url: str,
        headers: Sequence[Tuple[str, str]] = (),
        data: Optional[str] = None,
        timeout: int = 60,
    ) -> Tuple[str, int]:
        """Run curl with headers passed via stdin (`curl -H @-`) so tokens never
        appear in argv (visible in the process table otherwise, see m4)."""
        argv = ["curl", "-sS", "--max-time", str(timeout), "-X", method, url]
        if data is not None:
            argv += ["--data", data]
        argv += ["-H", "@-"]
        header_block = "".join(f"{k}: {v}\n" for k, v in headers)
        proc = subprocess.run(
            argv,
            input=header_block,
            capture_output=True,
            text=True,
            timeout=timeout + 30,
            check=False,
        )
        return proc.stdout, proc.returncode


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
            out, _rc = runner.run(
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
    """Stop a preview's containers WITHOUT removing them or their volumes.

    Uses `docker compose stop` (not `down`): containers and volumes are retained
    so `docker compose start` can wake the preview later (B2). Returns True only
    when the subprocess exited 0 (m2).
    """
    compose = preview.directory / "docker-compose.yml"
    if not compose.is_file():
        return False
    try:
        proc = subprocess.run(
            [
                "docker",
                "compose",
                "-f",
                str(compose),
                "stop",
            ],
            capture_output=True,
            text=True,
            timeout=DOCKER_STOP_TIMEOUT,
            check=False,
        )
        return proc.returncode == 0
    except (subprocess.SubprocessError, OSError):
        return False


def start_preview(preview: Preview) -> bool:
    """`docker compose start` for a stopped preview (wake). True only on rc==0."""
    compose = preview.directory / "docker-compose.yml"
    if not compose.is_file():
        return False
    try:
        proc = subprocess.run(
            ["docker", "compose", "-f", str(compose), "start"],
            capture_output=True,
            text=True,
            timeout=DOCKER_START_TIMEOUT,
            check=False,
        )
        return proc.returncode == 0
    except (subprocess.SubprocessError, OSError):
        return False


def teardown_preview(
    preview: Preview,
    cf_zone: Optional[str] = None,
    cf_token: Optional[str] = None,
    base_domain: str = "test-market.orangesync.tech",
    ports_dir: Optional[Path] = None,
    runner: Runner | None = None,
    log: Callable[[str], None] = _log,
) -> bool:
    """Full teardown: `down --remove-orphans --volumes` + DNS delete + rmtree
    + release of the port marker. Returns True when every step that ran
    succeeded (DNS delete is best-effort and skipped without credentials)."""
    runner = runner or Runner()
    ok = True
    # 1. Remove containers AND volumes (unlike stop, this is irreversible —
    #    only used for previews whose PR is closed/merged).
    compose = preview.directory / "docker-compose.yml"
    if compose.is_file():
        try:
            proc = subprocess.run(
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
                timeout=DOCKER_DOWN_TIMEOUT,
                check=False,
            )
            ok = ok and proc.returncode == 0
        except (subprocess.SubprocessError, OSError):
            ok = False
    # 2. DNS delete (best-effort; only when credentials are configured).
    if cf_zone and cf_token:
        if not delete_cloudflare_record(
            preview.pr_number, cf_zone, cf_token, base_domain, runner=runner, log=log
        ):
            ok = False
    # 3. Remove the directory to reclaim disk.
    try:
        shutil.rmtree(str(preview.directory), ignore_errors=False)
    except OSError:
        ok = False
    # 4. Release the port marker.
    if ports_dir is not None:
        release_port_marker(preview.pr_number, ports_dir, log=log)
    return ok


# ── Port-marker registry (M6) ─────────────────────────────────────────────────

PORT_OFFSET_RE = re.compile(r"^pr-(\d+)$")


def port_offset_for_pr(pr_number: int) -> int:
    """Host-port offset for a PR — mirrors the workflow: (PR % 100) * 10."""
    return (pr_number % 100) * 10


def claim_port_marker(
    pr_number: int,
    ports_dir: Path,
    log: Callable[[str], None] = _log,
) -> bool:
    """Claim the shared host-port offset for this PR in preview_root/ports/.

    PRs congruent mod 100 (e.g. 1157 and 1257) share the same offset and would
    otherwise race on host-port binds. The deploy claims the marker file
    <offset> (containing the owning PR number) BEFORE compose up and fails
    loudly if another PR holds it. Manager cleanup releases markers whose owner
    preview directory has disappeared.
    """
    try:
        ports_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        log(f"preview-manager: cannot create ports dir {ports_dir}: {e}")
        return False
    marker = ports_dir / str(port_offset_for_pr(pr_number))
    try:
        owner = marker.read_text(encoding="utf-8").strip()
        if owner:
            if owner == str(pr_number):
                return True  # already ours (redeploy)
            log(
                f"preview-manager: PORT COLLISION — offset "
                f"{port_offset_for_pr(pr_number)} is held by PR {owner}, "
                f"refusing to deploy PR {pr_number} on shared host ports. "
                "The other preview must be torn down first."
            )
            return False
    except FileNotFoundError:
        pass
    except OSError as e:
        log(f"preview-manager: cannot read port marker {marker}: {e}")
        return False
    try:
        marker.write_text(f"{pr_number}\n", encoding="utf-8")
    except OSError as e:
        log(f"preview-manager: cannot write port marker {marker}: {e}")
        return False
    return True


def release_port_marker(
    pr_number: int,
    ports_dir: Path,
    log: Callable[[str], None] = _log,
) -> bool:
    """Release this PR's port marker, but only if WE still own it."""
    marker = ports_dir / str(port_offset_for_pr(pr_number))
    try:
        owner = marker.read_text(encoding="utf-8").strip()
        if owner and owner != str(pr_number):
            log(
                f"preview-manager: port marker {marker} owned by PR {owner}, "
                f"not releasing for PR {pr_number}"
            )
            return False
        marker.unlink(missing_ok=True)
        return True
    except OSError as e:
        log(f"preview-manager: cannot release port marker {marker}: {e}")
        return False


def reap_orphan_port_markers(
    preview_root: Path,
    log: Callable[[str], None] = _log,
) -> List[int]:
    """Release markers whose owning preview directory no longer exists.

    Returns the list of offsets reaped. Called from every manager cycle so
    leftover markers from crashed teardowns don't wedge PRs congruent mod 100
    forever.
    """
    ports_dir = preview_root / "ports"
    if not ports_dir.is_dir():
        return []
    reaped: List[int] = []
    for entry in sorted(ports_dir.iterdir()):
        if not entry.name.isdigit():
            continue
        try:
            owner = entry.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if not owner.isdigit():
            continue
        if (preview_root / f"pr-{owner}").is_dir():
            continue
        try:
            entry.unlink()
            reaped.append(int(entry.name))
            log(
                f"preview-manager: reaped orphan port marker offset {entry.name} "
                f"(owner PR {owner} has no preview directory)"
            )
        except OSError as e:
            log(f"preview-manager: cannot remove orphan marker {entry}: {e}")
    return reaped


# ── GitHub open-PR listing (B5: fail-closed) ──────────────────────────────────

GITHUB_API = "https://api.github.com"
GITHUB_PAGE_SIZE = 100


def _gh_pulls_url(repo: str, page: int) -> str:
    return (
        f"{GITHUB_API}/repos/{repo}/pulls"
        "?state=open&sort=pushed_at&direction=desc&per_page=100"
        f"&page={page}"
    )


def _parse_pr_page(payload: object) -> Optional[List[dict]]:
    """Validate one page of the PR list API; None on malformed payloads."""
    if not isinstance(payload, list):
        return None
    page: List[dict] = []
    for item in payload:
        if not isinstance(item, dict):
            return None
        number = item.get("number")
        if not isinstance(number, int):
            return None
        page.append(item)
    return page


def open_pr_numbers(
    repo: str,
    runner: Runner | None = None,
    log: Callable[[str], None] = _log,
) -> Optional[List[int]]:
    """List open PR numbers for a repo, sorted by pushed_at (newest first).

    Full pagination: fetches per_page=100 pages until a short page. The repo is
    public, so the API is called anonymously (no GITHUB_TOKEN) — no gh CLI
    fallback that silently returns partial data.

    Fail-closed (B5): returns None on ANY error — network failure, non-2xx,
    rate-limit (403/429), malformed or truncated payloads. Callers must treat
    None as "open-PR data unknown" and skip teardown/recency decisions; an
    empty list is returned ONLY for a clean, complete listing with no open PRs.
    """
    runner = runner or Runner()
    numbers: List[int] = []
    page = 1
    while True:
        body, rc = runner.curl_json("GET", _gh_pulls_url(repo, page))
        if rc != 0:
            log(
                f"preview-manager: open-PR fetch failed for {repo} "
                f"(curl rc={rc}); treating open-PR set as UNKNOWN"
            )
            return None
        # Rate-limit / server errors: fail closed.
        try:
            payload = json.loads(body)
        except ValueError:
            log(f"preview-manager: open-PR fetch for {repo} returned non-JSON; "
                "treating open-PR set as UNKNOWN")
            return None
        if isinstance(payload, dict):
            message = str(payload.get("message", "")).lower()
            if "rate limit" in message or "api rate" in message:
                log(f"preview-manager: open-PR fetch for {repo} hit the GitHub "
                    "anonymous rate limit; treating open-PR set as UNKNOWN")
                return None
            log(f"preview-manager: open-PR fetch for {repo} returned an error "
                f"object ({message}); treating open-PR set as UNKNOWN")
            return None
        items = _parse_pr_page(payload)
        if items is None:
            log(f"preview-manager: open-PR fetch for {repo} returned a malformed "
                "page; treating open-PR set as UNKNOWN")
            return None
        numbers.extend(item["number"] for item in items)
        if len(items) < GITHUB_PAGE_SIZE:
            return numbers
        page += 1
        if page > 100:  # defensive bound (50k open PRs)
            log(f"preview-manager: open-PR fetch for {repo} exceeded pagination "
                "bound; treating open-PR set as UNKNOWN")
            return None


def delete_cloudflare_record(
    pr_number: int,
    zone_id: str,
    api_token: str,
    base_domain: str,
    runner: Runner | None = None,
    log: Callable[[str], None] = _log,
) -> bool:
    """Delete the Cloudflare A record for a preview subdomain. Best-effort."""
    runner = runner or Runner()
    subdomain = f"pr{pr_number}.{base_domain}"
    auth = ("Authorization", f"Bearer {api_token}")
    list_url = (
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records"
        f"?type=A&name={subdomain}"
    )
    body, rc = runner.curl_json("GET", list_url, headers=[auth])
    if rc != 0:
        log(f"preview-manager: Cloudflare list for {subdomain} failed (rc={rc})")
        return False
    try:
        data = json.loads(body)
    except ValueError:
        log(f"preview-manager: Cloudflare list for {subdomain} returned non-JSON")
        return False
    ok = True
    for record in data.get("result", []) or []:
        rid = record.get("id")
        if not rid:
            continue
        _body, drc = runner.curl_json(
            "DELETE",
            f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records/{rid}",
            headers=[auth],
        )
        if drc != 0:
            log(f"preview-manager: Cloudflare delete {rid} for {subdomain} "
                f"failed (rc={drc})")
            ok = False
    return ok


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

    Called by preview_gateway.py on EVERY request to a preview subdomain.
    Returns True if a matching preview exists and is (or was just) running.
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
    gh_token: Optional[str] = None,  # accepted for backwards compatibility; unused
    cf_zone: Optional[str] = None,
    cf_token: Optional[str] = None,
    dry_run: bool = False,
    runner: Runner | None = None,
    stop_fn: Callable[[Preview], bool] = stop_preview,
    teardown_fn: Optional[Callable[..., bool]] = None,
    log: Callable[[str], None] = _log,
) -> dict:
    """Run one full manager cycle. Returns a summary dict.

    Fail-closed rules (B5):
      - open_prs is None (fetch failed / rate-limited / malformed) → NO
        teardowns and NO recency-stops run this cycle; idle-stops (recoverable)
        still may. Never destroy previews based on an unverified "closed" set.
      - teardown iterates ALL preview directories on disk (running or not), so
        previews already stopped by an earlier idle cycle still get torn down
        once their PR closes (M5).
    """
    now = now or dt.datetime.now(dt.timezone.utc)
    runner = runner or Runner()
    if teardown_fn is None:
        teardown_fn = teardown_preview

    previews = list_preview_directories(preview_root, runner=runner)
    log_entries = read_access_logs(log_paths, runner=runner)
    last_access = last_access_by_pr(previews, log_entries)
    for p in previews:
        p.last_access = last_access.get(p.pr_number)

    results: dict = {
        "stopped": [],
        "started": [],
        "torn_down": [],
        "dry_run": dry_run,
        "skip_reason": None,
        "reaped_port_markers": [],
    }

    # Reap port markers whose preview directory has disappeared (M6).
    results["reaped_port_markers"] = reap_orphan_port_markers(
        preview_root, log=log
    )

    # Open-PR recency ranking: keep top-K most recent running. None => unknown.
    open_prs: Optional[List[int]] = None
    if gh_repo:
        open_prs = open_pr_numbers(repo=gh_repo, runner=runner, log=log)
    if open_prs is None:
        results["skip_reason"] = "open-PR fetch failed — teardown and recency-stop skipped (fail-closed)"
        log(
            "preview-manager: open-PR set UNKNOWN — skipping ALL teardown and "
            "recency-stop decisions this cycle (fail-closed). Idle-stop "
            "(recoverable) still runs. Fix the GitHub API access on the VPS; "
            "previews are NOT being torn down."
        )
    else:
        open_set = set(open_prs)
        keep_running = set(open_prs[:top_k])  # newest first
    can_destruct = open_prs is not None

    to_stop: List[int] = []
    to_teardown: List[int] = []
    for p in previews:
        # M5: consider ALL previews on disk, running or not, for closed-PR
        # teardown. Idle/recency stop only applies to running previews.
        if can_destruct and p.pr_number not in open_set:
            to_teardown.append(p.pr_number)
            continue
        if not p.running:
            continue
        if idle_decision(p.last_access, now, idle_hours, p.pr_number, log):
            to_stop.append(p.pr_number)
        elif can_destruct and p.pr_number not in keep_running:
            to_stop.append(p.pr_number)

    if not dry_run:
        for pr_number in to_stop:
            preview = find_preview(previews, pr_number)
            if preview is None:
                continue
            if stop_fn(preview):
                results["stopped"].append(pr_number)
            else:
                log(
                    f"preview-manager: docker compose stop FAILED for "
                    f"pr{pr_number} (see results['failed'])"
                )
                results.setdefault("failed", []).append(pr_number)
        for pr_number in to_teardown:
            preview = find_preview(previews, pr_number)
            if preview is None:
                continue
            if teardown_fn(
                preview,
                cf_zone=cf_zone,
                cf_token=cf_token,
                base_domain=base_domain,
                ports_dir=preview_root / "ports",
                runner=runner,
                log=log,
            ):
                results["torn_down"].append(pr_number)
            else:
                log(
                    f"preview-manager: teardown FAILED for pr{pr_number} "
                    "(docker/DNS/rmtree error — preview kept for retry)"
                )
                results.setdefault("failed", []).append(pr_number)
    else:
        results["stopped"] = to_stop
        results["torn_down"] = to_teardown

    return results


# ── CLI ───────────────────────────────────────────────────────────────────────

def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cron",
        action="store_true",
        help="Run one cycle suitable for a cron job (non-interactive, quiet).",
    )
    parser.add_argument(
        "--wake",
        metavar="PR_NUMBER",
        type=int,
        help="Wake the preview for a PR number (called by preview_gateway.py "
        "on every request to a preview subdomain).",
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
        help="owner/repo for open-PR recency ranking (public repo; anonymous API).",
    )
    parser.add_argument(
        "--claim-port-offset",
        metavar="PR_NUMBER",
        type=int,
        help="Claim the shared host-port offset for this PR (deploy-time; "
        "exits nonzero on collision with another PR's preview).",
    )
    parser.add_argument(
        "--release-port-offset",
        metavar="PR_NUMBER",
        type=int,
        help="Release the host-port offset held by this PR (teardown-time).",
    )
    args = parser.parse_args(argv)

    preview_root = Path(args.preview_root)
    cf_zone = os.environ.get("CLOUDFLARE_ZONE_ID")
    cf_token = os.environ.get("CLOUDFLARE_API_TOKEN")

    if args.claim_port_offset is not None:
        # Deploy-time port allocation (M6): claim before compose up.
        return 0 if claim_port_marker(
            args.claim_port_offset, preview_root / "ports", log=_log
        ) else 1

    if args.release_port_offset is not None:
        # Teardown-time port release (M6).
        release_port_marker(
            args.release_port_offset, preview_root / "ports", log=_log
        )
        return 0

    if args.wake is not None:
        # Wake hook invoked by preview_gateway.py on EVERY request to a preview
        # subdomain (cached certificates included). Non-interactive; the
        # gateway never blocks on this process.
        previews = list_preview_directories(preview_root)
        woken = wake_preview_by_pr(
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
        cf_zone=cf_zone,
        cf_token=cf_token,
        dry_run=args.dry_run,
    )

    if args.cron:
        # Quiet single line for cron; skip_reason (fail-closed cycles) is part
        # of the line so a broken fetch is visible in journalctl.
        extra = (
            f" skip_reason={results['skip_reason']}"
            if results.get("skip_reason")
            else ""
        )
        print(
            f"preview-manager: stopped={len(results['stopped'])} "
            f"torn_down={len(results['torn_down'])}"
            f"{extra}"
        )
        return 0

    print(f"Stopped: {results['stopped']}")
    print(f"Started: {results['started']}")
    print(f"Torn down: {results['torn_down']}")
    if results.get("skip_reason"):
        print(f"Skipped destructive decisions: {results['skip_reason']}", file=sys.stderr)
    return 0


def wake_preview_by_pr(
    pr_number: int,
    previews: Sequence[Preview],
    base_domain: str,
    start_fn: Callable[[Preview], bool] = start_preview,
) -> bool:
    """Wake the preview for a PR number (gateway --wake <N>)."""
    domain = f"pr{pr_number}.{base_domain}"
    return wake_preview_by_domain(domain, previews, base_domain, start_fn=start_fn)


if __name__ == "__main__":
    sys.exit(main())