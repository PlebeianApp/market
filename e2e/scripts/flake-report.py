#!/usr/bin/env python3
"""
Flake Detection Report for Plebeian Market E2E Tests
=====================================================
Runs each Playwright e2e spec N times and produces a per-test
flake report. Classifies each test as STABLE/FLAKY/VERY-FLAKY/BROKEN.

Usage:
    python3 e2e/scripts/flake-report.py                          # 5 runs, all specs
    python3 e2e/scripts/flake-report.py --runs 10                # 10 runs
    python3 e2e/scripts/flake-report.py --specs cart,auth        # specific specs
    python3 e2e/scripts/flake-report.py --grep "reaction"        # grep filter
    python3 e2e/scripts/flake-report.py --json                   # JSON output only
    python3 e2e/scripts/flake-report.py --timing                 # capture I/O timing

Requirements:
    - bun install in the project root
    - Playwright browsers installed (bunx playwright install chromium)
    - Relay (nak serve) and dev server must be running, OR the script
      starts them via playwright webServer config
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]  # e2e/scripts/../../ -> repo root

PW_CONFIG = "e2e/playwright.config.ts"
SPEC_GLOB = "e2e/tests/*.spec.ts"
RESULTS_DIR = "e2e/baseline-results/"
DEFAULT_RUNS = 5
# Per-run timeout. Heavy specs (cart, payments) run under `workers: 1` and can
# legitimately exceed 5 minutes; 30 minutes leaves ample headroom without
# waiting forever on a hung run.
RUN_TIMEOUT_SEC = 1800

# The repo uses Bun; Playwright runs through bunx.
RUNNER_CMD = "bunx"
NODE_OPTIONS = "--dns-result-order=ipv4first"

# Classification thresholds (pass rate).
STABLE_MIN = 1.0  # 100%
FLAKY_MIN = 0.60  # 60-99%
VERY_FLAKY_MIN = 0.01  # 1-59%
# BROKEN: 0%


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------
@dataclass
class TestResult:
    """A single test outcome from a single run."""

    spec_file: str  # "cart.spec.ts"
    test_title: str  # full title incl. describe prefix: "Describe > test"
    run_num: int  # 1..N
    passed: bool
    duration_ms: int
    error_snippet: str = ""  # first 200 chars of error if failed
    status: str = "unknown"  # raw Playwright status (passed/failed/skipped/…)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TestSummary:
    """Aggregated flake summary for one test across N runs."""

    spec_file: str
    test_title: str
    total_runs: int
    pass_count: int
    fail_count: int
    skip_count: int
    pass_rate: float
    classification: str  # STABLE/FLAKY/VERY-FLAKY/BROKEN
    avg_duration_ms: float
    error_snippets: List[str] = field(default_factory=list)
    individual_results: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "spec_file": self.spec_file,
            "test_title": self.test_title,
            "total_runs": self.total_runs,
            "pass_count": self.pass_count,
            "fail_count": self.fail_count,
            "skip_count": self.skip_count,
            "pass_rate": round(self.pass_rate, 4),
            "classification": self.classification,
            "avg_duration_ms": round(self.avg_duration_ms, 1),
            "error_snippets": self.error_snippets,
            "individual_results": self.individual_results,
        }


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------
def discover_specs(spec_filter: Optional[str]) -> List[Path]:
    """Return spec files, optionally filtered by comma-separated names.

    `spec_filter` may be None (all specs) or a comma-separated list of spec
    stems ("cart,auth"). Each stem is matched loosely: a spec matches if its
    filename (without extension) contains the stem.
    """
    spec_dir = REPO_ROOT / "e2e" / "tests"
    all_specs = sorted(spec_dir.glob("*.spec.ts"))
    if not all_specs:
        return []
    if not spec_filter:
        return all_specs
    wanted = [s.strip().lower() for s in spec_filter.split(",") if s.strip()]
    matched: List[Path] = []
    for spec in all_specs:
        stem = spec.stem.lower()  # e.g. "cart.spec"
        # Match stems with or without the ".spec" suffix.
        friendly = stem.replace(".spec", "")
        if any(w in stem or w in friendly for w in wanted):
            matched.append(spec)
    return matched


def spec_arg_for_runner(spec: Path) -> str:
    """Return the spec path relative to the repo root.

    Playwright matches the file basename against its testDir, so the
    e2e/tests/foo.spec.ts path works when invoked from the repo root.
    """
    rel = spec.relative_to(REPO_ROOT)
    return str(rel)


# ---------------------------------------------------------------------------
# Running Playwright
# ---------------------------------------------------------------------------
def check_runner_available() -> bool:
    """Return True if bunx is on PATH."""
    return shutil.which(RUNNER_CMD) is not None


def run_spec_once(
    spec: Path,
    run_num: int,
    grep: Optional[str],
    capture_timing: bool,
) -> Dict[str, Any]:
    """Run a single spec once, returning parsed JSON report (or fallback).

    Returns a dict with keys:
      - "results": List[TestResult]
      - "raw_exit_code": int
      - "parse_ok": bool
      - "duration_sec": float
      - "stderr_tail": str (last ~500 chars of stderr, for diagnostics)
    """
    results: List[TestResult] = []
    spec_rel = spec_arg_for_runner(spec)
    spec_basename = spec.name
    # Sentinels so the fallback path below can never hit an unbound name if
    # subprocess.run raises before assigning them (e.g. OSError on launch).
    exit_code = -1
    stderr_tail = ""

    with tempfile.TemporaryDirectory(prefix="flake-run-") as tmp:
        report_path = Path(tmp) / "report.json"
        env = os.environ.copy()
        # Prepend our flags so any caller-supplied NODE_OPTIONS survive.
        existing_opts = env.get("NODE_OPTIONS", "").strip()
        env["NODE_OPTIONS"] = (
            f"{existing_opts} {NODE_OPTIONS}" if existing_opts else NODE_OPTIONS
        )
        env["PLAYWRIGHT_JSON_OUTPUT_DIR"] = tmp
        env["PLAYWRIGHT_JSON_OUTPUT_NAME"] = "report.json"
        # Do not set CI=1: webServer must auto-start.

        cmd = [
            RUNNER_CMD,
            "playwright",
            "test",
            f"--config={PW_CONFIG}",
            "--reporter=json",
            "--retries=0",
        ]
        if grep:
            cmd.append(f"--grep={grep}")
        cmd.append(spec_rel)

        start = time.monotonic()
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(REPO_ROOT),
                env=env,
                capture_output=True,
                text=True,
                timeout=RUN_TIMEOUT_SEC,
            )
            exit_code = proc.returncode
            stderr_tail = (proc.stderr or "")[-500:]
        except subprocess.TimeoutExpired as e:
            elapsed = time.monotonic() - start
            # Treat the whole spec as failed; per-test results unknown.
            sys.stderr.write(
                f"\n  [run {run_num}] TIMEOUT after {RUN_TIMEOUT_SEC}s on "
                f"{spec_basename}\n"
            )
            return {
                "results": [
                    TestResult(
                        spec_file=spec_basename,
                        test_title="<spec-timed-out>",
                        run_num=run_num,
                        passed=False,
                        duration_ms=int(elapsed * 1000),
                        error_snippet=(
                            f"Spec timed out after {RUN_TIMEOUT_SEC}s"
                        ),
                        status="failed",
                    )
                ],
                "raw_exit_code": 124,
                "parse_ok": False,
                "duration_sec": elapsed,
                "stderr_tail": "timeout",
            }
        except OSError as e:
            elapsed = time.monotonic() - start
            stderr_tail = f"failed to launch {RUNNER_CMD}: {e}"
            sys.stderr.write(f"\n  [run {run_num}] {stderr_tail}\n")

        elapsed = time.monotonic() - start

        parse_ok = False
        if report_path.exists():
            try:
                raw = report_path.read_text(encoding="utf-8", errors="replace")
                report = json.loads(raw)
                results, found_any_spec = extract_test_results(
                    report, spec_basename, run_num
                )
                # A parsed report that contains no tests at all (e.g. a
                # --grep that matched nothing, or every test filtered out)
                # is NOT treated as a successful run — fall through to the
                # exit-code fallback below so it is surfaced, not silent.
                parse_ok = found_any_spec
            except (json.JSONDecodeError, OSError) as e:
                sys.stderr.write(
                    f"\n  [run {run_num}] JSON parse failed for "
                    f"{spec_basename}: {e}\n"
                )

        # Fallback: synthesize a spec-level result from the exit code.
        if not results and not parse_ok:
            results = [
                TestResult(
                    spec_file=spec_basename,
                    test_title="<spec-level>",
                    run_num=run_num,
                    passed=(exit_code == 0),
                    duration_ms=int(elapsed * 1000),
                    error_snippet=(
                        "" if exit_code == 0 else f"exit code {exit_code}"
                    ),
                    status="passed" if exit_code == 0 else "failed",
                )
            ]

        return {
            "results": results,
            "raw_exit_code": exit_code,
            "parse_ok": parse_ok,
            "duration_sec": elapsed,
            "stderr_tail": stderr_tail,
        }


def extract_test_results(
    report: Dict[str, Any], spec_basename: str, run_num: int
) -> Tuple[List[TestResult], bool]:
    """Walk the Playwright JSON suite tree and return TestResult per test.

    Suites can nest arbitrarily (test.describe blocks). We recurse and collect
    every `spec` entry we find, regardless of depth. Titles are prefixed with
    their enclosing describe titles ("Describe A > inner > test name") so
    identical leaf titles in different blocks do not collide.

    Returns (results, found_any_spec); found_any_spec is False when the report
    tree contained no spec entries at all (e.g. --grep matched nothing).
    """
    out: List[TestResult] = []
    found_any_spec = False

    def visit(suite: Dict[str, Any], file_hint: str, title_prefix: str) -> None:
        nonlocal found_any_spec
        suite_file_raw = suite.get("file") or file_hint or spec_basename
        suite_file = (
            os.path.basename(suite_file_raw) if suite_file_raw else spec_basename
        )
        # Playwright titles the top-level suite with the file path itself; that
        # label is the file, not a describe block — exclude it so identities
        # read "Login > should log in" (spec_file already records the file).
        suite_title = suite.get("title", "")
        if suite_title and suite.get("file") and (
            suite_title == suite.get("file")
            or suite_title.endswith("/" + str(suite.get("file")))
            or suite_title == suite_file
        ):
            suite_title = ""
        prefix = " > ".join(p for p in (title_prefix, suite_title) if p)

        for spec in suite.get("specs", []) or []:
            found_any_spec = True
            title = spec.get("title", "<untitled>")
            full_title = " > ".join(p for p in (prefix, title) if p)
            tests = spec.get("tests", []) or []
            if not tests:
                # No project entries at all — nothing to record.
                continue
            for t in tests:
                pw_results = t.get("results", []) or []
                if pw_results:
                    # Retries are off; take the last result.
                    last = pw_results[-1]
                    status = last.get("status", "unknown")
                    duration = int(last.get("duration", 0) or 0)
                    passed = status == "passed"
                    snippet = "" if passed else extract_error_snippet(last)
                elif t.get("status") == "skipped":
                    # Skipped tests carry no results entry; account for them
                    # so they appear in the report instead of vanishing.
                    status = "skipped"
                    duration = 0
                    passed = False
                    snippet = ""
                else:
                    continue
                out.append(
                    TestResult(
                        spec_file=suite_file,
                        test_title=full_title,
                        run_num=run_num,
                        passed=passed,
                        duration_ms=duration,
                        error_snippet=snippet,
                        status=status,
                    )
                )

        for child in suite.get("suites", []) or []:
            visit(child, suite_file, prefix)

    for top_suite in report.get("suites", []) or []:
        visit(top_suite, spec_basename, "")

    return out, found_any_spec


def extract_error_snippet(result: Dict[str, Any]) -> str:
    """Return a short (<=200 char) error string from a Playwright result."""
    errors = result.get("errors", []) or []
    for err in errors:
        msg = ""
        if isinstance(err, dict):
            msg = err.get("message") or err.get("snippet") or ""
        elif isinstance(err, str):
            msg = err
        if msg:
            compact = re.sub(r"\s+", " ", msg).strip()
            return compact[:200]
    # Some Playwright versions stash error text in stdout entries.
    for entry in result.get("stdout", []) or []:
        if isinstance(entry, str) and ("Error" in entry or "error" in entry):
            compact = re.sub(r"\s+", " ", entry).strip()
            return compact[:200]
    return ""


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------
def key_for(spec_file: str, test_title: str) -> Tuple[str, str]:
    """Identity for aggregation. A tuple, not a delimited string, so titles
    containing any separator characters (e.g. "::") can never mis-split."""
    return (spec_file, test_title)


def aggregate(results: List[TestResult]) -> List[TestSummary]:
    """Aggregate per-test results into TestSummary objects."""
    buckets: Dict[Tuple[str, str], List[TestResult]] = {}
    for r in results:
        k = key_for(r.spec_file, r.test_title)
        buckets.setdefault(k, []).append(r)

    summaries: List[TestSummary] = []
    for k, items in buckets.items():
        spec_file, test_title = k
        skipped = sum(1 for i in items if i.status == "skipped")
        executed = [i for i in items if i.status != "skipped"]
        total = len(executed)
        passes = sum(1 for i in executed if i.passed)
        fails = total - passes
        rate = passes / total if total else 0.0
        # A test skipped in every run (test.skip / --grep-invert) is reported
        # as SKIPPED, not counted as a 0%-pass BROKEN test.
        classification = "SKIPPED" if not executed else classify(rate)
        durations = [i.duration_ms for i in executed if i.duration_ms]
        avg = sum(durations) / len(durations) if durations else 0.0
        snippets: List[str] = []
        for i in items:
            if i.error_snippet and i.error_snippet not in snippets:
                snippets.append(i.error_snippet)
        summaries.append(
            TestSummary(
                spec_file=spec_file,
                test_title=test_title,
                total_runs=len(items),
                pass_count=passes,
                fail_count=fails,
                skip_count=skipped,
                pass_rate=rate,
                classification=classification,
                avg_duration_ms=avg,
                error_snippets=snippets[:5],  # cap stored snippets
                individual_results=[i.to_dict() for i in items],
            )
        )

    # Worst pass-rate first.
    summaries.sort(key=lambda s: (s.pass_rate, s.spec_file, s.test_title))
    return summaries


def classify(pass_rate: float) -> str:
    if pass_rate >= STABLE_MIN:
        return "STABLE"
    if pass_rate >= FLAKY_MIN:
        return "FLAKY"
    if pass_rate >= VERY_FLAKY_MIN:
        return "VERY-FLAKY"
    return "BROKEN"


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
CLASS_EMOJI = {
    "STABLE": "✅",
    "FLAKY": "🟡",
    "VERY-FLAKY": "🔴",
    "BROKEN": "💥",
    "SKIPPED": "⏭",
}


def print_terminal_report(
    summaries: List[TestSummary],
    num_runs: int,
    num_specs: int,
    json_only: bool,
) -> None:
    """Print the human-readable table (unless json_only)."""
    if json_only:
        return

    total = len(summaries)
    counts = {
        "STABLE": 0,
        "FLAKY": 0,
        "VERY-FLAKY": 0,
        "BROKEN": 0,
        "SKIPPED": 0,
    }
    for s in summaries:
        counts[s.classification] += 1

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    header = (
        "=" * 76
        + "\n"
        + f"  FLAKE DETECTION REPORT\n"
        + f"  {now} | {num_runs} runs per spec | {num_specs} specs\n"
        + "=" * 76
        + "\n"
    )
    print()
    print(header)

    if not summaries:
        print("  No tests found. Check that specs exist and contain tests.\n")
        return

    test_w = 46
    rate_w = 14
    class_w = 13
    dur_w = 10

    print(
        f"  {'TEST':<{test_w}} {'PASS RATE':<{rate_w}} "
        f"{'CLASS':<{class_w}} {'AVG MS':>{dur_w}}"
    )
    print(
        "  " + "─" * (test_w) + " " + "─" * (rate_w - 1) + " "
        + "─" * (class_w - 1) + " " + "─" * (dur_w - 1)
    )

    for s in summaries:
        pct = int(round(s.pass_rate * 100))
        if s.classification == "SKIPPED":
            label = f"{s.skip_count}/{s.total_runs} skipped"
        else:
            label = f"{s.pass_count}/{s.total_runs} ({pct}%)"
        cls = s.classification
        emoji = CLASS_EMOJI.get(cls, "")
        cls_display = f"{emoji} {cls}" if emoji else cls
        display_title = f"{short_spec(s.spec_file)} > {s.test_title}"
        if len(display_title) > test_w:
            display_title = display_title[: test_w - 1] + "…"
        print(
            f"  {display_title:<{test_w}} {label:<{rate_w}} "
            f"{cls_display:<{class_w}} {int(round(s.avg_duration_ms)):>{dur_w},}"
        )

    print()
    print(
        f"SUMMARY: {counts['STABLE']} stable | {counts['FLAKY']} flaky | "
        f"{counts['VERY-FLAKY']} very flaky | {counts['BROKEN']} broken | "
        f"{counts['SKIPPED']} skipped ({total} tests total)"
    )
    print()


def short_spec(spec_file: str) -> str:
    """e.g. 'auth.spec.ts' -> 'auth'."""
    base = os.path.basename(spec_file)
    if base.endswith(".spec.ts"):
        return base[: -len(".spec.ts")]
    if base.endswith(".ts"):
        return base[: -len(".ts")]
    return base


def save_json_report(
    summaries: List[TestSummary],
    num_runs: int,
) -> Path:
    """Write the JSON report to RESULTS_DIR and return the path."""
    out_dir = REPO_ROOT / RESULTS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = out_dir / f"flake-report-{ts}.json"

    counts = {
        "stable": 0,
        "flaky": 0,
        "very_flaky": 0,
        "broken": 0,
        "skipped": 0,
    }
    for s in summaries:
        key = s.classification.lower().replace("-", "_")
        counts[key] += 1

    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "num_runs": num_runs,
        "total_tests": len(summaries),
        "summary": counts,
        "tests": [s.to_dict() for s in summaries],
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
def preflight() -> Optional[str]:
    """Return an error message if the environment is unusable, else None."""
    if not check_runner_available():
        return (
            f"'{RUNNER_CMD}' not found on PATH. Install Bun first: "
            "https://bun.sh"
        )
    pw_config_path = REPO_ROOT / PW_CONFIG
    if not pw_config_path.exists():
        return (
            f"Playwright config not found at {PW_CONFIG}. "
            "Run this script from the repo root."
        )
    return None


def run_all(
    specs: List[Path],
    runs: int,
    grep: Optional[str],
    json_only: bool,
    capture_timing: bool,
) -> None:
    all_results: List[TestResult] = []
    timing_rows: List[str] = []

    total_specs = len(specs)
    for idx, spec in enumerate(specs, start=1):
        spec_basename = spec.name
        if not json_only:
            print(
                f"\n▶ [{idx}/{total_specs}] {spec_basename} "
                f"({runs} runs)…",
                flush=True,
            )
        for run_num in range(1, runs + 1):
            if not json_only:
                print(f"   run {run_num}/{runs}…", end=" ", flush=True)
            outcome = run_spec_once(
                spec, run_num, grep, capture_timing
            )
            all_results.extend(outcome["results"])
            if not json_only:
                tag = "OK" if outcome["parse_ok"] else "PARSE-FAIL"
                ec = outcome["raw_exit_code"]
                dur = outcome["duration_sec"]
                print(
                    f"{tag} (exit={ec}, {dur:.1f}s, "
                    f"{len(outcome['results'])} tests)"
                )
            if capture_timing:
                timing_rows.append(
                    f"{spec_basename}\trun {run_num}\t"
                    f"{outcome['duration_sec']:.2f}s\t"
                    f"exit={outcome['raw_exit_code']}"
                )

    if capture_timing and not json_only:
        print("\n── TIMING ──")
        for row in timing_rows:
            print(f"  {row}")

    summaries = aggregate(all_results)
    print_terminal_report(summaries, runs, total_specs, json_only)

    report_path = save_json_report(summaries, runs)
    if not json_only:
        print(f"JSON report saved to: {report_path.relative_to(REPO_ROOT)}")
    else:
        print(str(report_path.relative_to(REPO_ROOT)))


def parse_args(argv: List[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Run Playwright e2e specs N times and report per-test flakiness."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--runs",
        type=int,
        default=DEFAULT_RUNS,
        help=f"Number of runs per spec (default: {DEFAULT_RUNS}).",
    )
    p.add_argument(
        "--specs",
        type=str,
        default=None,
        help=(
            "Comma-separated spec stems to include, e.g. 'cart,auth'. "
            "Default: all specs."
        ),
    )
    p.add_argument(
        "--grep",
        type=str,
        default=None,
        help="Pass-through --grep filter to Playwright.",
    )
    p.add_argument(
        "--json",
        action="store_true",
        help="JSON-only output (no terminal table).",
    )
    p.add_argument(
        "--timing",
        action="store_true",
        help="Capture and print per-run I/O timing.",
    )
    return p.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv or sys.argv[1:])

    err = preflight()
    if err:
        sys.stderr.write(f"ERROR: {err}\n")
        return 2

    if args.runs < 1:
        sys.stderr.write("ERROR: --runs must be >= 1\n")
        return 2

    specs = discover_specs(args.specs)
    if not specs:
        msg = (
            "No spec files found. Check that e2e/tests/*.spec.ts exists.\n"
            "If the dev server / relay isn't running, start them first:\n"
            "    nak serve && bun dev"
        )
        sys.stderr.write(f"ERROR: {msg}\n")
        return 2

    try:
        run_all(
            specs=specs,
            runs=args.runs,
            grep=args.grep,
            json_only=args.json,
            capture_timing=args.timing,
        )
    except KeyboardInterrupt:
        sys.stderr.write("\nInterrupted.\n")
        return 130

    return 0


if __name__ == "__main__":
    sys.exit(main())
