# Streamline to NIP-53 Focus

> Supersedes the full plan in #979. Narrowed scope to reduce reviewer noise and unblock NIP-53.

## Goal

Keep only security + NIP-53 + CVM worker on the upstream repo. Move all test cleanup and smaller bugfix PRs to the fork (`c03rad0r/market`) to be re-opened gradually as reviewer bandwidth frees up.

---

## Phase 1: Create replacement tracking issue on upstream

- [ ] Create new issue on `PlebeianApp/market` — title: `tracking: security remediation + NIP-53 live chat + CVM worker`
- [ ] Close #979 with comment pointing to new issue

## Phase 2: Close upstream PRs

Each closed with: "Moved to fork to reduce reviewer noise during NIP-53 push. Will re-open here as bandwidth frees up. Tracked in #<new_issue>."

- [ ] Close #981 (CI + Unit Test Infrastructure)
- [ ] Close #982 (ContextVM Singleton Fix)
- [ ] Close #983 (Cart Persistence Fix)
- [ ] Close #984 (Alby LNURL Proxy Bypass)
- [ ] Close #985 (Shipping Selector Updates)
- [ ] Close #957 (Order edge-case tests)

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

- [ ] Open fork PR for #981 equivalent
- [ ] Open fork PR for #982 equivalent
- [ ] Open fork PR for #983 equivalent
- [ ] Open fork PR for #984 equivalent
- [ ] Open fork PR for #985 equivalent
- [ ] Open fork PR for #957 equivalent

## Phase 4: Update cross-references

- [ ] Update #986 — replace #979 reference with new issue number
- [ ] Update #996 — replace #979 reference with new issue number

## Phase 5: Update local tracking docs

- [ ] Update REVIEW-PLAN.md to reflect new scope
- [ ] Update REVIEWER-MESSAGES.md to focus on #975 and #947 only

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
