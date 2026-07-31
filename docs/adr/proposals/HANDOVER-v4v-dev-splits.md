# Handover: Implement V4V Dev Splits for Auctions

**To:** Implementing LLM agent / context window
**From:** Felix + ADR discussion session
**Date:** 2026-07-29
**ADR:** `docs/adr/proposals/v4v-dev-splits-auction.md`
**Base branch:** `docs/adr-proposals-index`

## Your Mission

Implement the V4V dev splits mechanism described in the ADR. Create a feature branch, write the code, make it PR-ready — but **DO NOT create a PR yet**. We want to surface the ADR + implementation to colleagues first.

## Branch Setup

1. Clone/fetch the repo from `github.com/felixfelix-bot/market`
2. Branch from `docs/adr-proposals-index` (this has the ADR + bug notes)
3. Create your feature branch: `feat/v4v-dev-splits-implementation`
4. Push to `felixfelix-bot/market` remote

**Important:** The main checkout at `~/repos/market` is in a messy state (merge conflicts, rebase in progress). Use a clean worktree:
```bash
git worktree add ~/worktrees/market-v4v-impl origin/docs/adr-proposals-index
cd ~/worktrees/market-v4v-impl
git checkout -b feat/v4v-dev-splits-implementation
```

## What to Implement

### 1. Kind 30409 — Validator Fee Announcement Event

Create the event schema, publish/query functions, and validation for kind 30409.

**Files to create/modify:**
- `src/lib/schemas/validator-fee-announcement.ts` — Zod schema for kind 30409
- `src/publish/validator-announcement.tsx` — Publish function for validators to announce their fees
- `src/queries/validators.tsx` — Query hook to discover validators (fetch kind 30409 events, filter by mint/auction_type/locking_scheme compatibility)
- Add kind 30409 to any kind registry/enum

**Schema requirements (from ADR section 4):**
```typescript
// Required tags:
d: string              // validator identifier
fee_min_bps: number    // basis points, 100=1%, min 1
mint: string[]         // array of supported mint URLs

// Optional tags:
auction_type?: string  // e.g., "english"
locking_scheme?: string // e.g., "P2PK"
max_duration?: number  // seconds, default 2592000 (30 days)
```

### 2. Auction Event V4V Splits (kind 30408 extension)

Extend the auction listing schema to include V4V splits.

**Files to create/modify:**
- Modify the auction listing schema to add `v4v_splits` array
- Each split: `{ npub: string, bps: number }`
- Bps must sum to exactly 10000 (100%)
- Validator splits must be present with amounts >= their announced `fee_min_bps`
- V4V donation splits (PM, etc.) are optional

**Validation rules:**
- Sum of all bps = 10000
- Each assigned validator's bps >= that validator's `fee_min_bps` from their latest kind 30409
- If no validators assigned OR all assigned validators decline → auction is invalid (client should warn)

### 3. Multi-Note Bid (kind 1023 extension)

Extend the bid commitment to carry multiple locked e-cash notes.

**Files to create/modify:**
- Modify bid schema to support multiple notes, one per recipient
- Each note entry: `{ recipient_npub: string, mint_url: string, locked_note_ref: string }`
- All notes share the same derivation path (secret)
- Notes may be on DIFFERENT mints (cross-mint bidding)

**CRITICAL security rule:** Never publish raw `cashu_token` or proof data in kind 1023 tags/content. Only publish references/commitments.

### 4. Settlement Reveal (kind 1024 extension)

The settlement event publishes the derivation path that unlocks all notes.

**Files to create/modify:**
- Modify settlement event to include the derivation path
- The reveal is a SINGLE public Nostr event
- On reveal, all recipients can verify + redeem their respective notes

### 5. Validator Settlement Verification

Validators need logic to verify bids at settlement time.

**Logic:**
1. On kind 1024 (settlement) event, fetch all notes referenced in the winning bid (kind 1023)
2. For each note: query the mint to verify (a) funds are still valid, (b) note points to correct recipient pubkey
3. Publish validation event confirming/denying the settlement

### 6. Losing Bidder Auto-Refund

After the settlement window expires, losing bidders' locked notes must be auto-refundable.

- No secret was revealed for losing bids
- Notes should automatically become refundable
- Client should surface "refund available" for losing bidders after settlement window ends

## Constraints

- **Use Bun-compatible APIs.** This project uses Bun, not Node.
- **No `@nostr-dev-kit` imports** in new code. Route Nostr I/O through `src/lib/nostr/io.ts` (per ADR-0002).
- **Keep payment states distinct.** Do NOT collapse into a single `paid` boolean. Use the full lifecycle: requested, attempted, wallet_acknowledged, settled, receipt_published, confirmed, expired, failed, refunded, fulfilled.
- **Read AGENTS.md** in the repo root and in `src/` before writing code.
- **Do NOT create a PR.** Push your branch only. We will surface the ADR + implementation to colleagues before opening a PR.
- **Do NOT commit secrets, private keys, or tokens.**
- **Run format check:** `bun run format:check` before committing.

## Testing

- Write unit tests for: kind 30409 schema validation, V4V split validation (sum=10000, bps >= min), multi-note bid schema
- Test the cross-mint case: notes on different mints for different recipients
- Test the V4V optional case: auction with validator fees but no PM donation
- Test losing bidder refund flow
- Run: `bun run test:unit` after implementation

## Existing Code to Reference

- `AUCTIOINS.md` — the auction spec (kind 30408, 1023, 1024 definitions)
- `src/lib/schemas/` — existing Zod schemas for events
- `src/publish/` — existing publish functions
- `src/queries/` — existing query hooks
- `docs/adr/ADR-0002-nostr-io-migration-ndk-to-applesauce.md` — Nostr I/O routing rules

## What NOT to Do

- Do NOT implement the quorum/validator consensus logic (that's a separate concern)
- Do NOT implement WOT/reputation for bidders (tracked in bug-research-and-improvements)
- Do NOT implement bid bonds (tracked in bug-research-and-improvements)
- Do NOT implement the settlement-window-expiry fallback path (separate ADR)
- Do NOT create a PR — just push the branch

## Questions?

The ADR (`docs/adr/proposals/v4v-dev-splits-auction.md`) has all design decisions. The decisions log (`docs/adr/proposals/adr-v4v-dev-splits-DECISIONS.md`) has the full reasoning. Read both before starting.
