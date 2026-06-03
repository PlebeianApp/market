# PR Review Plan — Landing PRs in Order

## Reviewer Expertise

| Reviewer | Domain |
|----------|--------|
| **Franchovy** | ContextVM, checkout flow, security, architecture |
| **maximotodev** | Cart internals, payment/wallet, orders, shipping |
| **hkarani** | Auctions UI, CI workflows, frontend |

## Wave 1 — Send Now (2 PRs per reviewer max)

### Franchovy
- [ ] **#975** — Security: secrets, `.gitignore`, CI, contextvm/server.ts (11 files)
  - CI GREEN, MERGEABLE
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
