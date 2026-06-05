# PR Review Plan — Landing PRs in Order

## Reviewer Expertise

| Reviewer | Domain |
|----------|--------|
| **Franchovy** | ContextVM, checkout flow, security, architecture |
| **maximotodev** | Cart internals, payment/wallet, orders, shipping |
| **hkarani** | Auctions UI, CI workflows, frontend |

---

## Priority 1: Review PRs Others Asked Us To Review

Review these before requesting reviews on our own PRs. Builds goodwill with the same people we need reviews from.

### maximotodev requested review
- [x] **#988** — `feat(auctions): add comments tab to auction detail` (+35/-10, 2 files)
  - Base: `auctions/p2pk-path-oracle-via-cvm-v1`
  - Approved. Should merge **before** #991 (both touch same file).
- [x] **#991** — `feat(auctions): improve description and shipping tabs` (+238/-64, 1 file)
  - Base: `auctions/p2pk-path-oracle-via-cvm-v1`
  - Approved. Should merge **after** #988 (will need rebase).

### hkarani — NOT ready, changes requested
- [ ] **#951** — `feat(auctions): auctions form draft` (16 commits, 5 files, +801/-22)
  - Base: `auctions/p2pk-path-oracle-via-cvm-v1`
  - **CHANGES_REQUESTED** from Franchovy and maximotodev (latest review)
  - maximotodev's last review: `isMeaningfulDraft` should cover all persisted fields
  - 15 inline review comments, author needs to address feedback first
  - Our PR #956 (isMeaningfulDraft tests) is based on this branch — blocked until it stabilizes
  - Wait for hkarani to update before reviewing

---

## Priority 2: Request Reviews on Our PRs

After completing Priority 1 reviews, ask for reciprocal reviews.

### Franchovy
- [ ] **#975** — Security: secrets, `.gitignore`, CI, contextvm/server.ts (11 files)
  - CI GREEN, MERGEABLE, e2e regression check passed, VPS deployed
  - **https://pr975.test-market.orangesync.tech**
- [ ] **#982** — ContextVM singleton test isolation (2 files, +12/-3)
  - CI GREEN, MERGEABLE, closes #963

### maximotodev
- [ ] **#983** — Cart persistence fix (1 file, +12 lines)
  - CI GREEN, MERGEABLE, closes #964
- [ ] **#984** — Alby LNURL proxy + NDK relay isolation (2 files, +3/-5)
  - CI GREEN, MERGEABLE, addresses #703

### hkarani
- [ ] **#981** — CI infra: bun pin, 8-shard e2e, unit test glob (6 files)
  - CI: prettier + unit GREEN, 2 e2e shards RED (pre-existing on master)

---

## Priority 3: Wave 2 — After Wave 1 Merges

- [ ] **#985** → hkarani — Shipping selectors for auctions branch (9 files, CI GREEN)
- [ ] **#957** → maximotodev — Order privacy tests (authored #955, same domain)
- [ ] **#947** — NIP-53 already in Franchovy's queue (CHANGES_REQUESTED, awaiting re-review)
  - VPS deployed at **https://pr947.test-market.orangesync.tech**

---

## Priority 4: Wave 3 — After Waves 1+2

- [ ] **#987** — Nsite E2E dashboard (depends on #947 split)
- [ ] **#956** — isMeaningfulDraft (CONFLICTING, needs rebase first)

---

## Completed

### E2E Regression Check for #975
- [x] Triggered e2e-full (run `26900247013`): 82 passed, 11 failed — all pre-existing
- [x] Comment posted: https://github.com/PlebeianApp/market/pull/975#issuecomment-4615257284

### VPS Deployments
- [x] **#975** live at https://pr975.test-market.orangesync.tech
- [x] **#947** live at https://pr947.test-market.orangesync.tech
- [ ] Teardown #975 after review: `make teardown-pr PR=975`
- [ ] Teardown #947 after review: `make teardown-pr PR=947`

### PR Descriptions Strengthened
- [x] #982, #983, #984 — problem/solution, CI verification, diff walkthrough

---

## Blocked / Deferred

- **#986** — Key rotation (manual, needs coordination)
- **#772** — NDK subscription flakiness (architectural, deferred)
