# E2E Baseline Results — 2026-06-26

## Overview

Playwright e2e baseline for Plebeian Market, run against `chore/applesauce-foundation`
branch. 17 of 20 specs × 5 runs each. Timestamps: 02:29–05:00 UTC, 2026-06-26.

## Classification Summary

| Classification | Count | Specs |
|---|---|---|
| ✅ STABLE (100%) | 5 | checkout, order-lifecycle, order-messaging, shipping-options, shipping-special |
| 🟡 FLAKY (≥80%) | 1 | collections (4/5) |
| 🔴 VERY FLAKY (>0%) | 1 | app-settings (2/5) |
| ❌ BROKEN (0%) | 10 | auth, buyer-purchase, cart, community.progressive-loading, marketplace, navigation, payments, pii-exposure-remediation, product-page, products |

## Missing Specs

These specs exist in `e2e/tests/` but were NOT included in the baseline run:
- `user-profile.spec.ts`
- `v4v-product-creation.spec.ts`
- `zaps.spec.ts`

`product-page` ran 3/5 runs and `products` ran 4/5 — some runs were skipped.

## A/B Comparison (NDK vs Applesauce)

3 runs per spec per backend, on `chore/applesauce-foundation`:

| Spec | NDK | Applesauce | Verdict |
|---|---|---|---|
| app-settings | 0/3 (0%) | **2/3 (67%)** | 🟢 Applesauce helps (NDK timing race) |
| cart | 0/3 | 0/3 | Both fail (not NDK-related) |
| marketplace | 0/3 | 0/3 | Both fail (not NDK-related) |
| products | 0/3 | 0/3 | Both fail (not NDK-related) |

**Timing data was not captured** — `[io] fetch` logs go to dev-server stdout, not the
Playwright JSON report. Needs instrumentation fix for next A/B run.

## Files

- `full-baseline-2026-06-26.json` — Processed baseline with per-spec summaries and raw stats
- `ab-comparison-2026-06-26.json` — Processed A/B comparison results
- `flake-results/` — Raw Playwright JSON output per spec per run (84 files)
- `ab-results/` — Raw A/B comparison JSON
