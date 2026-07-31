# Implementation Plan: V4V Dev Splits for Auctions

**Branch:** `feat/v4v-dev-splits-implementation` (from `docs/adr-proposals-index`)
**Worktree:** `~/worktrees/market-v4v-impl`
**ADR:** `docs/adr/proposals/v4v-dev-splits-auction.md`
**Decisions:** `docs/adr/proposals/adr-v4v-dev-splits-DECISIONS.md` (all 15 locked)
**Status:** AWAITING FELIX APPROVAL

---

## Quality Gates (apply to EVERY task)

Every task MUST pass all 6 gates before completion:

| Gate | What | Evidence Required |
|------|------|-------------------|
| G1: TDD | Write failing test FIRST, watch it fail (RED), then implement (GREEN) | Test output showing RED → GREEN |
| G2: Tests Pass | `bun run test:unit` — zero failures, no skip/xfail/.only. Coverage ≥ 80% | Pasted test output |
| G2.5: Cold Review | Fresh subagent reviews git diff with ZERO context. Manager dispatches this. | Reviewer verdict (APPROVED or issues addressed) |
| G3: Docs Updated | If source changes, at least one .md changes in same commit | Commit shows .md alongside .ts/.tsx |
| G4: Atomic Commit | One concern per commit, conventional message, `git status` clean | `git log --oneline` output |
| G5: Pushed | `git push` succeeds, exit code 0 | Push output pasted |
| G6: Manager Review | Worker sets status to `review`. Manager validates before `done` | Manager sign-off |

**Anti-patterns that fail gates automatically:**
- Writing implementation before test
- Using `skip`/`xfail`/`.only` to force green
- Committing without running test suite
- Marking task done without pushing
- Self-approving (worker never sets own task to `done`)

---

## Project Constraints (every task)

1. Bun runtime — NOT Node. Use `bun install`, `bun run`, `bun test`
2. No `@nostr-dev-kit` imports in new code. Route Nostr I/O through `src/lib/nostr/io.ts`
3. Payment states stay DISTINCT (10-state lifecycle: requested, attempted, wallet_acknowledged, settled, receipt_published, confirmed, expired, failed, refunded, fulfilled)
4. NEVER publish raw `cashu_token` or proof data in event tags/content — only references/commitments
5. No secrets, private keys, Cashu seed material in commits
6. `bun run format:check` must pass before commit
7. Read `AGENTS.md` (repo root + `src/`) before writing code

---

## Task Breakdown

### T1: Foundation — Shared Types + Kind 30409 Schema
**Priority:** 0 (blocking all others)
**Worker:** `worker-plebeian`
**Depends on:** nothing

**Scope:**
- `src/lib/schemas/auction-kinds.ts` — Kind constants (30408, 30409, 1023, 1024), `TOTAL_BPS=10000`, `DEFAULT_MAX_DURATION_SECONDS=2592000`
- `src/lib/schemas/validator-fee-announcement.ts` — Zod schema for kind 30409 with:
  - Required tags: `d` (validator id), `fee_min_bps` (min 1), `mint` (string array)
  - Optional tags: `auction_type`, `locking_scheme`, `max_duration` (default 2592000)
  - NO WOT/endorsement tags
  - Tag builder + event parser functions
- Add kind 30409 to any existing kind registry/enum in codebase

**Tests (write FIRST, watch fail, then implement):**
- `src/lib/schemas/validator-fee-announcement.test.ts`:
  1. Valid event with all required tags passes
  2. Missing `d` tag fails
  3. Missing `fee_min_bps` fails
  4. `fee_min_bps` = 0 fails (min is 1)
  5. Missing `mint` tags fail
  6. Optional tags (`auction_type`, `locking_scheme`, `max_duration`) accepted
  7. `max_duration` defaults to 2592000 when omitted
  8. WOT/endorsement tags NOT in schema (adding them is a no-op or error)
  9. Tag builder produces correct Nostr tag array format

**Commit:** `feat(v4v): add kind 30409 validator fee announcement schema + shared types`
**Gate 3 doc:** Update `AUCTIOINS.md` or create `docs/adr/proposals/v4v-kind-30409-spec.md` documenting the new kind

---

### T2: Kind 30409 — Publish + Query Hook
**Priority:** 1
**Worker:** `worker-plebeian`
**Depends on:** T1

**Scope:**
- `src/publish/validator-announcement.tsx` — Publish function for validators to announce fees. Routes through `src/lib/nostr/io.ts`. No NDK imports.
- `src/queries/validators.tsx` — Query hook `useValidators()` to discover validators:
  - Fetch kind 30409 events from relays
  - Filter by mint compatibility
  - Filter by auction_type compatibility (optional)
  - Filter by locking_scheme compatibility (optional)
  - Return latest event per validator (NIP-33 replaceable)
- Add validator query keys to `src/queries/queryKeyFactory.ts`
- Read `src/queries/v4v.tsx` and `src/publish/products.tsx` for existing patterns

**Tests:**
- `src/publish/validator-announcement.test.ts`:
  1. Publish function calls io.ts with correct event structure
  2. Event has kind 30409, correct tags
  3. No NDK imports in the publish module
- `src/queries/__tests__/validators.test.ts`:
  1. Query returns validators matching mint filter
  2. Filters out incompatible auction_type
  3. Filters out incompatible locking_scheme
  4. Returns latest event when validator updates fee (NIP-33 dedup)

**Commit:** `feat(v4v): add validator publish function + discovery query hook`

---

### T3: Auction V4V Splits (kind 30408 extension)
**Priority:** 1
**Worker:** `worker-plebeian`
**Depends on:** T1

**Scope:**
- `src/lib/schemas/auction-v4v.ts` (or modify existing auction schema) — Add `v4v_splits` array:
  - Each split: `{ npub: string, bps: number }`
  - Validation: sum of ALL bps = exactly 10000
  - Validation: each assigned validator's bps >= their `fee_min_bps`
  - V4V donation splits (PM etc.) optional
  - Auction must list assigned validator pubkeys
  - Fee snapshot at creation time (prevent bait-and-switch)
- `src/publish/auction-v4v.tsx` (or modify existing) — Publish function for auction listing with V4V splits

**Tests:**
- `src/lib/schemas/auction-v4v.test.ts` (V4V split portion):
  1. Valid splits (sum=10000) pass
  2. Splits summing to 9999 fail
  3. Splits summing to 10001 fail
  4. Validator bps below their `fee_min_bps` fails
  5. Validator bps equal to `fee_min_bps` passes
  6. Auction with validators but NO PM donation passes (V4V optional)
  7. Auction with zero validators flagged as invalid (client warning)
  8. Empty v4v_splits array fails (must have at least seller)

**Commit:** `feat(v4v): extend auction listing with V4V splits and validator fee validation`
**Gate 3 doc:** Update ADR or create spec doc for V4V split format

---

### T4: Multi-Note Bid (kind 1023 extension)
**Priority:** 2
**Worker:** `worker-plebeian`
**Depends on:** T3

**Scope:**
- Modify bid commitment schema to support multiple locked e-cash notes:
  - Each note entry: `{ recipient_npub: string, mint_url: string, locked_note_ref: string }`
  - All notes share same derivation path (secret)
  - Notes may be on DIFFERENT mints (cross-mint bidding)
  - CRITICAL: `locked_note_ref` is a reference/commitment ONLY — never raw cashu_token or proof data
- Extend `src/publish/auction-v4v.tsx` with bid publish function

**Tests:**
- `src/lib/schemas/auction-v4v.test.ts` (bid portion) or `src/lib/schemas/multi-note-bid.test.ts`:
  1. Valid multi-note bid passes (seller + validator + PM)
  2. Cross-mint case: seller note on mint A, validator on mint B passes
  3. Missing `locked_note_ref` for any recipient fails
  4. Empty notes array fails
  5. Raw cashu_token string in any field fails (security check)
  6. All notes sharing same derivation path passes
  7. Notes with different derivation paths fails

**Commit:** `feat(v4v): extend bid commitment for multi-note cross-mint bidding`

---

### T5: Settlement Reveal (kind 1024 extension)
**Priority:** 3
**Worker:** `worker-plebeian`
**Depends on:** T4

**Scope:**
- Modify settlement event schema to include `derivation_path`
  - SINGLE public Nostr event
  - On reveal, all recipients can verify + redeem their notes
  - Settlement window defined per-auction
- Extend `src/publish/auction-v4v.tsx` with settlement publish function

**Tests:**
- Settlement schema tests:
  1. Valid settlement with derivation_path passes
  2. Missing derivation_path fails
  3. Derivation path is a string (not object/array)
  4. Settlement references winning bid event ID

**Commit:** `feat(v4v): extend settlement event with derivation path reveal`

---

### T6: Validator Settlement Verification
**Priority:** 3
**Worker:** `worker-plebeian`
**Depends on:** T4, T5

**Scope:**
- `src/lib/auction-settlement.ts` — `verifySettlementNotes()` function:
  1. On kind 1024 event, fetch all notes from winning bid (kind 1023)
  2. For each note: query mint via `MintQueryPort` interface to verify (a) funds still valid, (b) note points to correct recipient pubkey
  3. Return verification result per note
- Define `MintQueryPort` interface (abstract, no concrete mint client — allows testing)

**Tests:**
- `src/lib/auction-settlement.test.ts` (verification portion):
  1. All notes valid → verification passes
  2. One note spent → verification fails for that note, passes for others
  3. Note points to wrong pubkey → fails
  4. Mint unreachable → returns error state (not crash)
  5. Cross-mint: notes on mint A and mint B both verified

**Commit:** `feat(v4v): add validator settlement verification logic`

---

### T7: Losing Bidder Auto-Refund
**Priority:** 3
**Worker:** `worker-plebeian`
**Depends on:** T5

**Scope:**
- `src/lib/auction-settlement.ts` (extend) — `checkLosingBidderRefund()` function:
  - After settlement window expires, losing bidders' notes auto-refundable
  - No secret revealed for losing bids
  - Returns state transition: `locked` → `refundable` after window ends
  - Client surfaces "refund available" status
  - Uses payment lifecycle states (NOT a boolean)

**Tests:**
- `src/lib/auction-settlement.test.ts` (refund portion):
  1. Losing bidder before window expiry → state stays `locked`
  2. Losing bidder after window expiry → state transitions to `refundable`
  3. Winning bidder after window → NOT refundable (already revealed)
  4. Refund state uses proper lifecycle enum (not boolean)

**Commit:** `feat(v4v): add losing bidder auto-refund after settlement window`

---

### T8: Integration — Format Check, Full Test Run, Cold Review, Final Push
**Priority:** 4
**Worker:** `worker-inspector` (or manager)
**Depends on:** T1-T7 all in `review` status

**Scope:**
1. `bun install` (fresh in worktree)
2. `bun run format:check` — fix any issues
3. `bun run test:unit` — ALL tests pass, zero failures
4. **Cold review:** dispatch fresh subagent with ONLY the git diff. No context about design decisions.
5. Address any cold review blockers/majors
6. Update ADR status if needed
7. Final commit if changes made
8. Verify `git status` clean
9. `git push -u origin feat/v4v-dev-splits-implementation`

**Gate evidence required:**
- Full test output pasted
- Cold review verdict pasted
- `git log --oneline` showing all commits
- `git status` showing clean tree
- `git push` output

**Deliverable:** Branch URL: `https://github.com/felixfelix-bot/market/tree/feat/v4v-dev-splits-implementation`

**NO PR.**

---

## Dependency Graph

```
T1 (Foundation + 30409 Schema)
├── T2 (30409 Publish + Query)
├── T3 (Auction V4V Splits)
│   └── T4 (Multi-Note Bid)
│       ├── T5 (Settlement Reveal)
│       │   ├── T6 (Validator Verification) [also depends T4]
│       │   └── T7 (Auto-Refund)
│       │
└──── T8 (Integration + Cold Review + Push) [depends T1-T7]
```

## Execution Order

Phase 1: T1 (alone — everything blocks on it)
Phase 2: T2, T3 (parallel — both depend only on T1)
Phase 3: T4 (depends on T3)
Phase 4: T5, T6, T7 (T5+T7 parallel, T6 needs T4+T5)
Phase 5: T8 (integration)

## Worker Profile: `worker-plebeian`

All implementation tasks (T1-T7) assigned to `worker-plebeian`:
- Knows the Plebeian Market codebase
- Has `terminal`, `file`, `coding` toolsets
- Quality-gates skill force-loaded

Integration task T8 assigned to `worker-inspector` or handled by manager.

## Existing Work Reference

A previous uncontrolled dispatch created 6 files in the worktree (untracked):
- `src/lib/schemas/auction-kinds.ts`
- `src/lib/schemas/validator-fee-announcement.ts`
- `src/lib/schemas/auction-v4v.ts`
- `src/lib/auction-settlement.ts`
- `src/publish/validator-announcement.tsx`
- `src/publish/auction-v4v.tsx`

These are **reference only**. Under this plan, workers start with TDD (test-first).
If the existing code passes review, it can be salvaged. If not, it's rewritten from tests.

## What This Plan Does NOT Include (explicitly out of scope)

- Quorum/validator consensus logic (separate concern)
- WOT/reputation for bidders (bug-research-and-improvements)
- Bid bonds / anti-griefing collateral (bug-research-and-improvements)
- Settlement-window-expiry fallback path (separate ADR)
- Creating a PR (surface to colleagues first)
- npub rotation / Sybil resistance
- Top-bid oscillation fixes
- Relay order / last-writer-wins fixes
