# PR Review Plan — Landing PRs in Order

## Reviewer Expertise

| Reviewer | Domain |
|----------|--------|
| **Franchovy** | ContextVM, checkout flow, security, architecture |
| **maximotodev** | Cart internals, payment/wallet, orders, shipping |
| **hkarani** | Auctions UI, CI workflows, frontend |

## E2E Regression Verification for #975

**Result: NO REGRESSIONS.** 82 passed, 11 failed — all failures pre-existing on master.
- [x] Trigger e2e-full on #975 branch (run `26900247013`)
- [x] Analyze failures — all pre-existing (shipping selectors #985, auth flakiness #772, unrelated UI timing)
- [x] Post regression check comment on #975 — https://github.com/PlebeianApp/market/pull/975#issuecomment-4615257284
- [x] Confirmed no regressions — safe to request Franchovy review

## VPS Deployments

### #975 (Security) — Deployed
- [x] Modify `deploy-pr.sh` to support `--repo` flag for fork branches
- [x] Deploy with fork repo: `bash scripts/deploy-pr.sh --pr 975 --branch security/critical-remediation --repo https://github.com/c03rad0r/market.git`
- [x] **Live at: https://pr975.test-market.orangesync.tech**
- [x] **Relay: wss://pr975.test-relay.orangesync.tech**
- [x] Deployment comment posted: https://github.com/PlebeianApp/market/pull/975#issuecomment-4615257284
- [ ] Teardown after review: `make teardown-pr PR=975`

### #947 (NIP-53 Live Chat) — Deployed
- [x] Deploy: `make deploy-pr PR=947 BRANCH=feat/nip53-auction-live-chat` (branch upstream)
- [x] **Live at: https://pr947.test-market.orangesync.tech**
- [x] **Relay: wss://pr947.test-relay.orangesync.tech**
- [x] Deployment comment posted: https://github.com/PlebeianApp/market/pull/947#issuecomment-4615258904
- [ ] Teardown after review: `make teardown-pr PR=947`

## PR Descriptions — Strengthened for Review

- [x] #982 — Updated with problem/solution, CI verification, diff walkthrough, why no VPS
- [x] #983 — Updated with problem/solution, CI verification, diff walkthrough, why no VPS
- [x] #984 — Updated with problem/solution, CI verification, diff walkthrough, why no VPS

## Wave 1 — Ready to Request Reviews (2 PRs per reviewer max)

### Franchovy
- [ ] **#975** — Security: secrets, `.gitignore`, CI, contextvm/server.ts
  - CI GREEN, MERGEABLE, e2e regression check passed, VPS deployed
  - **https://pr975.test-market.orangesync.tech**
- [ ] **#982** — ContextVM singleton test isolation (2 files, +12/-3)
  - CI GREEN, MERGEABLE, closes #963, description strengthened

### maximotodev
- [ ] **#983** — Cart persistence fix (1 file, +12 lines)
  - CI GREEN, MERGEABLE, closes #964, description strengthened
- [ ] **#984** — Alby LNURL proxy + NDK relay isolation (2 files, +3/-5)
  - CI GREEN, MERGEABLE, addresses #703, description strengthened

### hkarani
- [ ] **#981** — CI infra: bun pin, 8-shard e2e, unit test glob (6 files)
  - CI: prettier + unit GREEN, 2 e2e shards RED (pre-existing on master)

## Wave 2 — After Wave 1 Merges

- [ ] **#985** → hkarani — Shipping selectors for auctions branch (9 files, CI GREEN)
- [ ] **#957** → maximotodev — Order privacy tests (authored #955, same domain)
- [ ] **#947** — NIP-53 already in Franchovy's queue (CHANGES_REQUESTED, awaiting re-review)
  - VPS deployed at **https://pr947.test-market.orangesync.tech**

## Wave 3 — After Waves 1+2

- [ ] **#987** — Nsite E2E dashboard (depends on #947 split)
- [ ] **#956** — isMeaningfulDraft (CONFLICTING, needs rebase first)

## Blocked / Deferred

- **#986** — Key rotation (manual, needs coordination)
- **#772** — NDK subscription flakiness (architectural, deferred)

## Infrastructure Changes Made

- `deploy-pr.sh` — Added `--repo` flag for deploying fork branches
- `ansible/roles/pr_instance/defaults/main.yml` — `repo_url` variable override
- `ansible/roles/pr_instance/handlers/main.yml` — Fixed handler name case mismatch, changed to `docker restart`
- `ansible/roles/pr_instance/tasks/main.yml` — Fixed `build: false` → `build: never`
- `ansible/roles/pr_instance/templates/docker-compose.yml.j2` — Added git install, removed error swallowing, added PR_BRANCH env
