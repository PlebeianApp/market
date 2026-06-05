# PR Review Plan — Streamlined to NIP-53 Focus

> Supersedes previous plan. See #997 for upstream tracking.
> Deferred PRs moved to fork (`c03rad0r/market`) — see STREAMLINE-PLAN.md.

## Reviewer Expertise

| Reviewer | Domain |
|----------|--------|
| **Franchovy** | ContextVM, checkout flow, security, architecture |
| **maximotodev** | Cart internals, payment/wallet, orders, shipping |
| **hkarani** | Auctions UI, CI workflows, frontend |

---

## Priority 1: Review PRs Others Asked Us To Review

- [x] **#988** — Comments tab — Approved
- [x] **#991** — Description/shipping tabs — Approved
- [x] **#951** — Auctions form draft — Approved (with reserve='0' UX note)

---

## Priority 2: Request Reviews on Upstream PRs

Only 2 PRs remain on upstream:

### Franchovy
- [ ] **#975** — Security: secrets, `.gitignore`, CI, contextvm/server.ts (8 files)
  - CI GREEN, MERGEABLE, e2e regression check passed, VPS deployed
  - **https://pr975.test-market.orangesync.tech**
  - Docs removed, inline C1/C2/C3 summaries in PR description
  - Related: #986 (key rotation), #996 (HIGH findings)

### Franchovy (NIP-53)
- [ ] **#947** — NIP-53 auction live chat — CHANGES_REQUESTED, awaiting re-review
  - All 6 review fixes applied, CI green
  - VPS deployed at **https://pr947.test-market.orangesync.tech**
  - Targets `auctions/p2pk-path-oracle-via-cvm-v1`

---

## Priority 3: After #947 Merges

- [ ] **#967** — CVM worker for NIP-53 live activity status
  - Branch `feat/cvm-worker-nip53-status` pushed, 34 tests passing
  - Must rebase after #947 merges, then create PR
  - Targets `auctions/p2pk-path-oracle-via-cvm-v1`

---

## Deferred to Fork (c03rad0r/market)

| Original | Fork PR | Description |
|----------|---------|-------------|
| #981 | c03rad0r/market#7 | CI + unit test infrastructure |
| #982 | c03rad0r/market#8 | ContextVM singleton test fix |
| #983 | c03rad0r/market#5 | Cart persistence re-read guard |
| #984 | c03rad0r/market#4 | Alby LNURL proxy bypass |
| #985 | c03rad0r/market#3 | Shipping selector e2e updates |
| #957 | c03rad0r/market#6 | Order edge-case tests |

Re-open on upstream as reviewer bandwidth frees up.

---

## VPS Deployments

- [x] **#975** live at https://pr975.test-market.orangesync.tech
- [x] **#947** live at https://pr947.test-market.orangesync.tech
- [ ] Teardown #975 after merge
- [ ] Teardown #947 after merge

---

## Blocked / Deferred

- **#986** — Key rotation (manual, needs coordination after #975 merges)
- **#996** — HIGH severity findings (H1-H8, not urgent)
- **#772** — NDK subscription flakiness (architectural, deferred)
