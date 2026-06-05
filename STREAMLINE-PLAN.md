# Streamline to NIP-53 Focus

> Supersedes the full plan in #979. Narrowed scope to reduce reviewer noise and unblock NIP-53.

## Goal

Keep only security + NIP-53 + CVM worker on the upstream repo. Move all test cleanup and smaller bugfix PRs to the fork (`c03rad0r/market`) to be re-opened gradually as reviewer bandwidth frees up.

---

## Phase 1: Create replacement tracking issue on upstream

- [x] Create new issue on `PlebeianApp/market` — **#997**
- [x] Close #979 with comment pointing to #997

## Phase 2: Close upstream PRs

Each closed with: "Moved to fork to reduce reviewer noise during NIP-53 push. Will re-open here as bandwidth frees up. Tracked in #997."

- [x] Close #981 (CI + Unit Test Infrastructure)
- [x] Close #982 (ContextVM Singleton Fix)
- [x] Close #983 (Cart Persistence Fix)
- [x] Close #984 (Alby LNURL Proxy Bypass)
- [x] Close #985 (Shipping Selector Updates)
- [x] Close #957 (Order edge-case tests)
- [x] Close #956 (isMeaningfulDraft — superseded by #951's version but covers fewer fields)
- [x] Close #987 (Nsite E2E dashboard — premature, re-open after #947 merges)

## Phase 3: Re-open PRs on fork

Each PR on `c03rad0r/market` includes original PR body + `Originally opened as PlebeianApp/market#XXX`.

| Branch | Original PR | Fork PR title | Base |
|--------|-------------|---------------|------|
| `fix/ci-unit-infrastructure` | #981 | CI + Unit Test Infrastructure | `master` |
| `fix/contextvm-singleton-test` | #982 | ContextVM Singleton Fix | `master` |
| `fix/cart-persistence-re-read-guard` | #983 | Cart Persistence Fix | `master` |
| `fix/alby-lnurl-proxy-bypass` | #984 | Alby LNURL Proxy Bypass | `master` |
| `fix/shipping-selectors-cart-redesign` | #985 | Shipping Selector Updates | `auctions/p2pk-path-oracle-via-cvm-v1` |
| `fix/test-cleanup-green-suite` | #957 | Order edge-case tests for public order privacy guard | `master` |
| `test/951-auction-draft-meaningful-check` | #956 | isMeaningfulDraft full field coverage | `master` |
| `feat/nsite-e2e-dashboard` | #987 | Nsite E2E dashboard + 3-way sharding | `master` |

- [x] Open fork PR for #981 equivalent (c03rad0r/market#7)
- [x] Open fork PR for #982 equivalent (c03rad0r/market#8)
- [x] Open fork PR for #983 equivalent (c03rad0r/market#5)
- [x] Open fork PR for #984 equivalent (c03rad0r/market#4)
- [x] Open fork PR for #985 equivalent (c03rad0r/market#3)
- [x] Open fork PR for #957 equivalent (c03rad0r/market#6)
- [x] Open fork PR for #956 equivalent (c03rad0r/market#9)
- [x] Open fork PR for #987 equivalent (c03rad0r/market#10)

## Phase 4: Update cross-references

- [x] Update #986 — replace #979 reference with #997
- [x] Update #996 — replace #979 reference with #997

## Phase 5: Update local tracking docs

- [x] Update REVIEW-PLAN.md to reflect new scope
- [x] Update REVIEWER-MESSAGES.md to focus on #975 and #947 only

---

## What stays on upstream

| PR | Target | Status |
|----|--------|--------|
| **#975** | master | Security — CI GREEN, awaiting review |
| **#947** | auctions | NIP-53 — CHANGES_REQUESTED, awaiting Franchovy re-review |
| **#967** PR (TBD) | auctions | CVM worker — to be created after #947 merges |

## What moved to fork

| Original | Branch | Description |
|----------|--------|-------------|
| #981 | `fix/ci-unit-infrastructure` | CI + unit test infrastructure |
| #982 | `fix/contextvm-singleton-test` | ContextVM singleton test fix |
| #983 | `fix/cart-persistence-re-read-guard` | Cart persistence re-read guard |
| #984 | `fix/alby-lnurl-proxy-bypass` | Alby LNURL proxy bypass |
| #985 | `fix/shipping-selectors-cart-redesign` | Shipping selector e2e updates |
| #957 | `fix/test-cleanup-green-suite` | Order edge-case tests |
| #956 | `test/951-auction-draft-meaningful-check` | isMeaningfulDraft full field coverage (re-open after #951 merges) |
| #987 | `feat/nsite-e2e-dashboard` | Nsite E2E dashboard + 3-way sharding (re-open after #947 merges) |
