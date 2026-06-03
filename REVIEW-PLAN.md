# PR Review Plan — Landing PRs in Order

## Reviewer Expertise

| Reviewer | Domain |
|----------|--------|
| **Franchovy** | ContextVM, checkout flow, security, architecture |
| **maximotodev** | Cart internals, payment/wallet, orders, shipping |
| **hkarani** | Auctions UI, CI workflows, frontend |

## E2E Regression Verification for #975

**Run ID:** `26900247013` (fork: c03rad0r/market, branch: `security/critical-remediation`)
**Started:** 2026-06-03T17:01:54Z
**Check status:** `gh run view 26900247013 --repo c03rad0r/market`

Note: No master e2e-full baseline exists (e2e-full only runs on workflow_dispatch/schedule, never triggered on master). Instead, compare failures against known issues:
- Shipping selector failures (#985) — pre-existing on master
- Auth timeout flakiness (#772) — pre-existing on master
- Payment failures (#772) — pre-existing, tests are skipped

- [x] Trigger e2e-full on #975 branch (`security/critical-remediation`)
- [ ] Wait for run to complete (~120 min)
- [ ] Analyze failures — are they all pre-existing known issues?
- [ ] Post regression check comment on #975
- [ ] Confirm no regressions before asking Franchovy to review

## Wave 1 — After E2E Regression Check Passes (2 PRs per reviewer max)

### Franchovy
- [ ] **#975** — Security: secrets, `.gitignore`, CI, contextvm/server.ts (11 files)
  - CI GREEN (prettier, unit-integration, e2e-pricing), MERGEABLE
  - E2E regression check: pending
- [ ] **#982** — ContextVM singleton test isolation (2 files, +12/-3)
  - CI GREEN, MERGEABLE, closes #963

### maximotodev
- [ ] **#983** — Cart persistence fix (1 file, +12 lines)
  - CI GREEN, MERGEABLE, closes #964
- [ ] **#984** — Alby LNURL proxy + NDK relay isolation (2 files, +3/-5)
  - CI GREEN, MERGEABLE, addresses #703

### hkarani
- [ ] **#981** — CI infra: bun pin, 8-shard e2e, unit test glob (6 files)
  - CI: prettier + unit GREEN, 2 e2e shards RED (pre-existing on master, not caused by this PR)

## Wave 2 — After Wave 1 Merges

- [ ] **#985** → hkarani — Shipping selectors for auctions branch (9 files, CI GREEN)
- [ ] **#957** → maximotodev — Order privacy tests (authored #955, same domain)
- [ ] **#947** — NIP-53 already in Franchovy's queue (CHANGES_REQUESTED, awaiting re-review)

## Wave 3 — After Waves 1+2

- [ ] **#987** — Nsite E2E dashboard (depends on #947 split)
- [ ] **#956** — isMeaningfulDraft (CONFLICTING, needs rebase first)

## Blocked / Deferred

- **#986** — Key rotation (manual, needs coordination)
- **#772** — NDK subscription flakiness (architectural, deferred)
