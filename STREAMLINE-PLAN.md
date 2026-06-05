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

## Phase 6: CVM Worker — Cherry-pick onto NIP-53 branch

Re-open #968 by cherry-picking the 2 CVM worker commits onto a fresh branch from `feat/nip53-auction-live-chat`, then targeting the PR at #947's branch.

- [ ] Create `feat/cvm-worker-nip53-cherry-pick` from `feat/nip53-auction-live-chat`
- [ ] Cherry-pick `52bd6848` (feat: add live activity worker with CVM-signed 30311 events)
- [ ] Cherry-pick `0487cb78` (docs: update CVM-WORKER-PLAN.md checklist)
- [ ] Resolve conflicts — keep #947's current code as base, add only worker-specific changes
- [ ] Verify tests pass locally (worker tests, liveChat tests, nip53 tests)
- [ ] Push branch to fork
- [ ] Re-open #968 targeting `feat/nip53-auction-live-chat` with description
- [ ] Update #997 and #947 with cross-references

## Phase 7: VPS Deployment — Fix for NIP-60 Wallet + Redeploy

Fix the "nip60 wallet not ready" error by updating the VPS deployment config.

### 7a: Update `docker-compose.yml.j2`

- [ ] Pin Bun image to `oven/bun:1.3.10` (currently `oven/bun:latest`)
- [ ] Add `CVM_SERVER_KEY` env var (ephemeral test key for CVM worker)
- [ ] Add NIP-60 test mint config (`testnut.cashu.space`) via env vars

### 7b: Update `defaults/main.yml`

- [ ] Add default CVM_SERVER_KEY
- [ ] Add default test mint URL

### 7c: Redeploy PR #947

- [ ] Run `./scripts/deploy-pr.sh --pr 947 --branch feat/nip53-auction-live-chat`
- [ ] Verify deployment succeeds
- [ ] Verify Caddy TLS cert provisioned for `pr947.test-market.orangesync.tech`

### 7d: Smoke test at https://pr947.test-market.orangesync.tech

- [ ] Log in with Nostr identity
- [ ] Dashboard → receiving payments → verify NIP-60 wallet connects to test mint
- [ ] Create auction → verify publish succeeds (no "nip60 wallet not ready" error)
- [ ] Verify live chat panel appears on auction page
- [ ] Verify CVM worker running — check `kind:30311` events being published
- [ ] Check browser console for errors

### 7e: Commit infra changes

- [ ] Commit updated `docker-compose.yml.j2` and `defaults/main.yml` to `plebeian-market-e2e-infra`

---

## What stays on upstream

| PR | Target | Status |
|----|--------|--------|
| **#975** | master | Security — CI GREEN, awaiting review |
| **#947** | auctions | NIP-53 — CHANGES_REQUESTED, awaiting Franchovy re-review |
| **#968** (re-opened) | `feat/nip53-auction-live-chat` (#947) | CVM worker — cherry-picked onto #947 branch |

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
