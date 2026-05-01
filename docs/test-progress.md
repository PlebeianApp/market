# Test Progress Checklist

Branch: `fix/auction-trusted-mint-state-ownership`
Ports: app=34568, relay=10548

## Unit Tests (`make test-unit`)

| # | Test | Status |
|---|------|--------|
| 1 | syncMintSelection — adds newly available mints | ✅ pass |
| 2 | syncMintSelection — does not auto-remove mints that leave availableMints | ✅ pass |
| 3 | syncMintSelection — preserves user explicit removals when available is unchanged | ✅ pass |
| 4 | syncMintSelection — handles add and keep simultaneously | ✅ pass |
| 5 | syncMintSelection — empty selection with new available mints | ✅ pass |
| 6 | syncMintSelection — all mints removed from available but kept in selection | ✅ pass |
| 7 | syncMintSelection — no change when available is identical reference | ✅ pass |
| 8 | syncMintSelection — returning mint is not re-added when user explicitly removed it | ✅ pass |
| 9 | syncMintSelection — returning mint IS re-added when user did not remove it | ✅ pass |
| 10 | syncMintSelection — custom mint not in availableMints is preserved in selection | ✅ pass |
| 11 | syncMintSelection — does not duplicate mints already in selection | ✅ pass |

## Playwright E2E Tests (`make test-e2e-mint`)

| # | Test | Status |
|---|------|--------|
| 1 | trusted mints initialize with available mints | ✅ pass (5.4s) |
| 2 | user can remove a mint and the form stays valid | ✅ pass (4.7s) |
| 3 | user can add a custom mint URL via text input | ✅ pass (4.5s) |
| 4 | user can re-add a previously removed mint via text input | ✅ pass (4.7s) |
| 5 | empty text input does not add a mint | ✅ pass (4.5s) |

## Format Check (`make test-format`)

| Check | Status |
|-------|--------|
| prettier --check all changed files | ✅ pass |

## Infrastructure

| Step | Status |
|------|--------|
| bun install | ✅ done |
| playwright install chromium | ✅ done |
| nak relay on port 10548 | ✅ running (PID from nohup) |
| dev server on port 34568 | ✅ running (PID from /tmp/mint-test-dev.pid) |

## Manual Happy Path (`docs/manual-happy-path-validation.md`)

| # | Scenario | Status |
|---|----------|--------|
| 1 | Mint initialization | ✅ pass |
| 2 | Remove a mint | ✅ pass |
| 3 | Cannot remove last mint | ✅ pass |
| 4 | Re-add a mint via suggestion button | ✅ pass |
| 5 | Add a custom mint via text input | ✅ pass |
| 6 | Empty input doesn't add | ✅ pass |
| 7 | Re-add a removed mint via text input | ✅ pass |
| 8 | Full form submission (publish auction) | ⏭️ skipped — requires NIP-60 wallet seed data (out of scope) |
