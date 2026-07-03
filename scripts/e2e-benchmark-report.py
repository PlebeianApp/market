#!/usr/bin/env python3
"""
e2e-benchmark-report.py — summarise Playwright benchmark runs.

Reads the JSON results produced by scripts/e2e-benchmark.sh and prints:

  * an overall pass-rate line per backend
  * a per-spec table comparing NDK vs applesauce (A/B), with the delta
  * a categorisation of every spec as STABLE / FLAKY / BROKEN
  * a list of the worst offenders (lowest pass rates)

Each results file is named ``<spec>__<backend>__run-<n>.json`` and contains the
standard Playwright JSON reporter payload. The spec/backend/repeat are taken from
the filename (authoritative) and the test outcome counts are taken from the JSON
suite tree. A spec's *run pass rate* = fraction of repeats in which every test in
that spec passed — this is what flake detection keys off.

Categories (run-level, per backend):
  STABLE  — 100% of repeats passed
  FLAKY   — 0% < pass rate < 100%
  BROKEN  — 0% of repeats passed

Usage:
  python3 scripts/e2e-benchmark-report.py                 # latest run
  python3 scripts/e2e-benchmark-report.py --run 20260702T181234Z
  python3 scripts/e2e-benchmark-report.py --results-dir path/to/run
  python3 scripts/e2e-benchmark-report.py --all           # aggregate everything
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

# Colour ---------------------------------------------------------------------
_USE_COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")


def _c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _USE_COLOR else text


def GREEN(t: str) -> str:  return _c("32", t)
def RED(t: str) -> str:    return _c("31", t)
def YELLOW(t: str) -> str: return _c("33", t)
def CYAN(t: str) -> str:   return _c("36", t)
def BOLD(t: str) -> str:   return _c("1", t)
def DIM(t: str) -> str:    return _c("2", t)


FAIL_STATES = {"failed", "timedOut", "interrupted"}
PASS_STATES = {"passed", "flaky"}

_FILENAME_RE = re.compile(r"^(?P<spec>.+)__(?P<backend>ndk|applesauce)__run-(?P<repeat>\d+)\.json$")


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------
@dataclass
class RunCounts:
    spec: str
    backend: str
    repeat: int
    passed: bool          # run-level: every test green
    exit_code: int
    duration_s: float
    tests_total: int = 0
    tests_passed: int = 0
    tests_failed: int = 0
    tests_skipped: int = 0
    flaky_tests: int = 0


@dataclass
class SpecAgg:
    runs: int = 0
    passed_runs: int = 0
    tests_total: int = 0
    tests_passed: int = 0
    tests_failed: int = 0
    duration_s: float = 0.0
    repeat_ids: List[int] = field(default_factory=list)

    @property
    def pass_rate(self) -> float:
        return (self.passed_runs / self.runs * 100.0) if self.runs else 0.0

    def category(self) -> str:
        if self.runs == 0:
            return "—"
        if self.passed_runs == self.runs:
            return "STABLE"
        if self.passed_runs == 0:
            return "BROKEN"
        return "FLAKY"


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------
def _walk_suites(node: Any, test_counts: Dict[str, Dict[str, int]]) -> None:
    """Accumulate per-test outcome counts keyed by spec file.

    Playwright's JSON reporter nests ``suites``; each leaf suite carries a
    ``file`` and a ``specs`` array. Each spec has ``tests``; each test has
    ``results`` with a ``status``. A test is counted as passed if any of its
    results is 'passed'/'flaky', failed if it ended in a failure state, skipped
    otherwise. Flaky tests (failed-then-passed) are tracked separately.
    """
    if not isinstance(node, dict):
        return
    file = node.get("file") or ""
    specs = node.get("specs") or []
    for spec in specs:
        spec_file = spec.get("file") or file
        for test in spec.get("tests", []) or []:
            results = test.get("results", []) or []
            if not results:
                continue
            statuses = [r.get("status") for r in results]
            bucket = test_counts.setdefault(spec_file or "(unknown)", {
                "total": 0, "passed": 0, "failed": 0, "skipped": 0, "flaky": 0,
            })
            bucket["total"] += 1
            has_pass = any(s in PASS_STATES for s in statuses)
            has_fail = any(s in FAIL_STATES for s in statuses)
            has_skip = all(s == "skipped" for s in statuses)
            if has_pass and has_fail:
                bucket["flaky"] += 1
                bucket["passed"] += 1
            elif has_pass:
                bucket["passed"] += 1
            elif has_skip:
                bucket["skipped"] += 1
            elif has_fail:
                bucket["failed"] += 1
            else:
                # no pass, not all skipped, no explicit fail -> treat as fail
                bucket["failed"] += 1
    for child in node.get("suites", []) or []:
        _walk_suites(child, test_counts)


def parse_result_file(path: Path) -> Optional[RunCounts]:
    """Return counts for one benchmark result file, or None if unparseable."""
    m = _FILENAME_RE.match(path.name)
    if not m:
        return None  # not a per-run result file
    spec = m.group("spec")
    backend = m.group("backend")
    repeat = int(m.group("repeat"))

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"{YELLOW('warn')}: could not parse {path.name}: {exc}", file=sys.stderr)
        return None

    # Per-test breakdown from the suite tree.
    test_counts: Dict[str, Dict[str, int]] = {}
    for suite in data.get("suites", []) or []:
        _walk_suites(suite, test_counts)

    total = sum(c["total"] for c in test_counts.values())
    passed = sum(c["passed"] for c in test_counts.values())
    failed = sum(c["failed"] for c in test_counts.values())
    skipped = sum(c["skipped"] for c in test_counts.values())
    flaky = sum(c["flaky"] for c in test_counts.values())

    # Fall back to top-level stats when the suite walk found nothing (older
    # reporter payloads may flatten everything into `stats`).
    if total == 0:
        stats = data.get("stats", {}) or {}
        expected = stats.get("expected", 0)
        unexpected = stats.get("unexpected", 0)
        skipped_s = stats.get("skipped", 0)
        flaky_s = stats.get("flaky", 0)
        if expected or unexpected or skipped_s or flaky_s:
            total = expected + unexpected
            passed = expected
            failed = unexpected
            skipped = skipped_s
            flaky = flaky_s

    run_passed = (failed == 0 and total > 0)
    duration = float(data.get("stats", {}).get("duration", 0)) / 1000.0 \
        if isinstance(data.get("stats", {}).get("duration"), (int, float)) else 0.0

    return RunCounts(
        spec=spec, backend=backend, repeat=repeat,
        passed=run_passed, exit_code=0 if run_passed else 1,
        duration_s=duration,
        tests_total=total, tests_passed=passed,
        tests_failed=failed, tests_skipped=skipped, flaky_tests=flaky,
    )


def discover_results(targets: Iterable[Path]) -> List[Path]:
    out: List[Path] = []
    for t in targets:
        if t.is_file():
            out.append(t)
        elif t.is_dir():
            out.extend(sorted(t.glob("*.json")))
    return [p for p in out if p.name not in ("manifest.json",)]


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------
def aggregate(runs: List[RunCounts]) -> Dict[Tuple[str, str], SpecAgg]:
    agg: Dict[Tuple[str, str], SpecAgg] = defaultdict(SpecAgg)
    for r in runs:
        a = agg[(r.spec, r.backend)]
        a.runs += 1
        a.passed_runs += 1 if r.passed else 0
        a.tests_total += r.tests_total
        a.tests_passed += r.tests_passed
        a.tests_failed += r.tests_failed
        a.duration_s += r.duration_s
        a.repeat_ids.append(r.repeat)
    return agg


def pick_run_dir(results_root: Path) -> Optional[Path]:
    latest = results_root / "latest"
    if latest.is_symlink() or latest.is_dir():
        target = latest.resolve()
        if target.is_dir():
            return target
    dirs = [d for d in results_root.iterdir() if d.is_dir()]
    return max(dirs, key=lambda d: d.stat().st_mtime) if dirs else None


def render(runs: List[RunCounts], agg: Dict[Tuple[str, str], SpecAgg], source_label: str) -> int:
    if not runs:
        print(f"{RED('no results')} in {source_label}", file=sys.stderr)
        return 2

    all_specs = sorted({k[0] for k in agg})
    backends = sorted({k[1] for k in agg})

    # --- overall per-backend summary --------------------------------------
    print(BOLD("═══ e2e benchmark report ═══") + f"  {DIM(source_label)}")
    print()
    print(BOLD("per-backend run pass rate"))
    header = f"  {'backend':<12} {'runs':>6} {'passed':>8} {'rate':>8}"
    print(header)
    print(f"  {'-'*12} {'-'*6} {'-'*8} {'-'*8}")
    for b in backends:
        b_runs = [r for r in runs if r.backend == b]
        n = len(b_runs)
        p = sum(1 for r in b_runs if r.passed)
        rate = (p / n * 100.0) if n else 0.0
        colour = GREEN if rate == 100.0 else (RED if rate == 0.0 else YELLOW)
        print(f"  {b:<12} {n:>6} {p:>8} {colour(f'{rate:6.1f}%'):>8}")

    # --- per-spec A/B table -----------------------------------------------
    if len(backends) >= 2:
        print()
        print(BOLD("per-spec A/B (run pass rate)"))
        hdr = f"  {'spec':<32} {'ndk':>8}   {'applesauce':>11}   {'delta':>8}   verdict"
        print(hdr)
        print(f"  {'-'*32} {'-'*8}   {'-'*11}   {'-'*8}   {'-'*16}")
        rows = []
        for spec in all_specs:
            ndk = agg.get((spec, "ndk"))
            apl = agg.get((spec, "applesauce"))
            ndk_rate = ndk.pass_rate if ndk else float("nan")
            apl_rate = apl.pass_rate if apl else float("nan")
            delta = (apl_rate - ndk_rate) if (ndk and apl) else float("nan")
            if ndk and apl:
                if delta < -0.5:
                    verdict = RED(f"applesauce regresses ({delta:+.0f}%)")
                elif delta > 0.5:
                    verdict = GREEN(f"applesauce improves ({delta:+.0f}%)")
                else:
                    verdict = DIM("no change")
            else:
                verdict = DIM("single-backend")
            rows.append((spec, ndk_rate, apl_rate, delta, verdict))
        rows.sort(key=lambda r: (r[3] if r[3] == r[3] else 9999))
        for spec, ndk_rate, apl_rate, delta, verdict in rows:
            def fmt(rate):
                if rate != rate:  # NaN
                    return DIM("   —")
                colour = GREEN if rate == 100.0 else (RED if rate == 0.0 else YELLOW)
                return colour(f"{rate:6.1f}%")
            d = f"{delta:+6.0f}%" if (delta == delta) else DIM("   —")
            print(f"  {spec:<32} {fmt(ndk_rate):>8}   {fmt(apl_rate):>11}   {d:>8}   {verdict}")

    # --- categorisation ---------------------------------------------------
    print()
    print(BOLD("categorisation (run-level, per spec x backend)"))
    by_cat: Dict[str, List[str]] = defaultdict(list)
    for (spec, backend), a in sorted(agg.items()):
        by_cat[a.category()].append(f"{spec} [{backend}]  {a.pass_rate:5.1f}% ({a.passed_runs}/{a.runs})")
    for cat in ("BROKEN", "FLAKY", "STABLE"):
        items = by_cat.get(cat, [])
        if not items:
            continue
        colour = {"BROKEN": RED, "FLAKY": YELLOW, "STABLE": GREEN}[cat]
        print(f"  {colour(BOLD(cat)):<14} ({len(items)})")
        for line in items:
            print(f"      {line}")

    # --- worst offenders --------------------------------------------------
    offenders = sorted(agg.items(), key=lambda kv: (kv[1].pass_rate, -kv[1].runs))
    worst = [kv for kv in offenders if kv[1].pass_rate < 100.0][:10]
    if worst:
        print()
        print(BOLD("worst pass rates"))
        for (spec, backend), a in worst:
            colour = RED if a.pass_rate == 0 else YELLOW
            print(f"  {spec:<32} {backend:<11} {colour(f'{a.pass_rate:5.1f}%'):>8}  "
                  f"({a.passed_runs}/{a.runs} runs, {a.tests_failed} test failures)")

    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Summarise e2e benchmark results.")
    here = Path(__file__).resolve().parent
    default_root = (here.parent / "e2e-benchmark-results").resolve()
    p.add_argument("--results-dir", type=Path,
                   help=f"results run directory (default: latest under {default_root})")
    p.add_argument("--run", help="specific timestamped run under the results root")
    p.add_argument("--all", action="store_true",
                   help="aggregate every result under the results root")
    p.add_argument("--json", action="store_true", help="emit machine-readable JSON summary")
    args = p.parse_args(argv)

    if args.results_dir:
        source = args.results_dir
        source_label = str(source)
    elif args.run:
        source = default_root / args.run
        source_label = f"{default_root} / {args.run}"
    elif args.all:
        source = default_root
        source_label = f"{default_root} (all runs)"
    else:
        source = pick_run_dir(default_root)
        if source is None:
            print(f"{RED('no results')} under {default_root}", file=sys.stderr)
            return 2
        source_label = str(source)

    if not source.exists():
        print(f"{RED('not found')}: {source}", file=sys.stderr)
        return 2

    files = discover_results([source] if not source.is_file() else [source])
    runs = [c for c in (parse_result_file(f) for f in files) if c is not None]
    agg = aggregate(runs)

    if args.json:
        summary = {
            "source": str(source),
            "backends": sorted({k[1] for k in agg}),
            "specs": sorted({k[0] for k in agg}),
            "by_spec_backend": [
                {
                    "spec": spec, "backend": backend,
                    "runs": a.runs, "passed_runs": a.passed_runs,
                    "pass_rate": round(a.pass_rate, 2),
                    "category": a.category(),
                    "tests_total": a.tests_total,
                    "tests_failed": a.tests_failed,
                }
                for (spec, backend), a in sorted(agg.items())
            ],
        }
        json.dump(summary, sys.stdout, indent=2)
        print()
        return 0

    return render(runs, agg, source_label)


if __name__ == "__main__":
    sys.exit(main())
