# ADR-0001: Auction Beta Tag as Global Feature Flag

## Status

Accepted

## Date

2026-08-19

## Context

The Plebeian Market auction feature is being launched in beta. During the beta period, all auction events (kind-30408) must carry a marker that identifies them as beta auctions. This marker serves several purposes:

1. **Client-side filtering** — UI components can show or hide beta auctions depending on whether the user is in beta mode.
2. **Relay-side filtering** — Relays supporting NIP-12 tag-based filtering can filter on the beta tag.
3. **Audit trail** — Auctions created during beta are permanently identifiable, even after the platform exits beta.
4. **Live activity worker** — The ContextVM live-activity worker reads the beta tag to decide whether to process an auction for live-activity events.

The consultant audit (2026-08-19) found that the beta tag had **zero implementation**: no constant in `constants.ts`, no field in `AuctionEventTagsInput`, no entry in `ParsedAuctionEvent`, no Zod schema field, and no UI indicator.

The meeting notes raised several open questions about beta tag semantics:
- Should the tag be immutable (set once, never removed) or mutable?
- Should the tag value be `'true'` (string) or `'1'`?
- Should kind-30311 live activity events also get a beta tag?
- Does the beta tag mean "this auction is in beta" (feature flag) or "this auction type is beta" (protocol flag)?

Felix (the operator) has resolved all open questions and this ADR records those decisions.

## Decision

### Beta tag is a global, system-wide feature flag — not per-auction

The beta tag `['beta']` is **auto-emitted on ALL auction events** while `BETA_MODE=true`. There is no per-auction toggle, no form UI, and no `isBeta` field in the auction creation form. The tag is injected unconditionally by the publish path.

### Tag format: `['beta']` (presence-only, no value)

The tag is just `['beta']` — a single-element array where the presence of the tag itself signals beta. There is no second element (no `'true'`, no `'1'`, no value at all). This is simpler than `['beta', 'true']` and avoids ambiguity about what the value means.

### System-wide state via `BETA_MODE`

The tag is controlled by a single environment variable, `BETA_MODE`:
- When `BETA_MODE=true`: all new auction events get the `['beta']` tag.
- When `BETA_MODE=false`: no new auction events get the tag.

This is a **system-wide state**, not a per-auction choice. There is no form field, no checkbox, and no API parameter. The publish path reads `BETA_MODE` and includes or excludes the tag.

### Existing beta-tagged auctions keep their tag

When the market exits beta (`BETA_MODE=false`), existing auctions that already have the `['beta']` tag **keep it**. The tag is not stripped on update. Only **new** auctions stop receiving the tag. This means:
- Legacy beta auctions remain identifiable.
- Updates to beta auctions (via replaceable event re-publishing) do not strip the tag — the tag is part of the event's historical state.
- However, re-publishing an auction after beta exit will NOT re-add the tag if it wasn't there. The tag is only added at creation time based on `BETA_MODE` at publish moment.

### ADR-4 (beta tag semantics) folded into this ADR

The open question about whether "beta tag" means "this auction is in beta" (feature flag) vs "this auction type is beta" (protocol flag) is resolved here: the tag means **this auction was created during the platform's beta period**. It is a feature flag, not a protocol flag. After beta exit, the tag is informational/historical and does not affect auction behavior.

### Tag is NOT immutable in the protocol sense

The beta tag is not added to `AUCTION_IMMUTABLE_SINGLE_TAGS`. Since the publish path always includes it when `BETA_MODE=true`, updates to beta auctions carry the tag. After beta exit, re-published events simply won't have it. This is a non-issue in practice — the tag is a display/audit marker, not a protocol invariant.

### No form UI

The auction creation form (`AuctionFormContent.tsx`) does **not** get a beta toggle or checkbox. Beta is always on for new auctions while `BETA_MODE=true`. An optional read-only "Beta" badge near the publish button is acceptable but not required.

## Consequences

### Positive

- **Simple**: no form state, no user decisions, no API parameter. The publish path checks one env var.
- **Auditable**: all beta-period auctions are permanently identifiable via the tag.
- **Backward compatible**: legacy events without the tag parse fine (`isBeta` defaults to `false` via Zod `.default(false)`).
- **No relay dependency**: the tag is informational. Relays ignore unknown tags per NIP-01. No hard dependency on NIP-12 parameterized tag filtering.
- **Clean exit from beta**: set `BETA_MODE=false` and restart. No migration needed.

### Negative

- **Requires restart to change**: switching between beta and non-beta requires a server restart to change `BETA_MODE`. This is acceptable for a platform-wide flag.
- **Re-publishing after beta exit**: if a beta auction is re-published (replaceable event update) after `BETA_MODE=false`, the update loses the tag. This is acceptable — the original event retains it.
- **No per-auction opt-in/opt-out**: all auctions during beta get the tag. This is by design — beta is a platform state, not an auction-level choice.

## Alternatives Considered

### Alternative 1: Per-auction beta toggle in the form UI

**Rejected.** Beta is a platform state, not an auction-level choice. Letting sellers choose whether their auction is "beta" creates confusion and inconsistent tagging. The tag must be automatic and uniform.

### Alternative 2: Tag value `'true'` or `'1'` instead of presence-only `['beta']`

**Rejected.** Using `['beta', 'true']` or `['beta', '1']` adds a value that is never anything other than "true." Presence-only is simpler and avoids questions about what other values might mean. The tag is a flag, not a key-value pair.

### Alternative 3: Separate kind for beta auctions

**Rejected.** Using a different event kind for beta auctions (e.g., kind-30409) would fragment relay queries, require duplicate parser logic, and complicate the transition out of beta. The tag approach is additive and non-breaking.

### Alternative 4: Companion parameterized replaceable event for beta state

**Rejected.** A kind-30078 companion event with `d='auction-beta-state'` would add a second event to fetch, subscribe to, and synchronize. The tag-on-event approach is self-contained — the auction event itself carries its own beta state.

## Files Affected

- `src/lib/auction/constants.ts` — Add `AUCTION_BETA_TAG = 'beta'` constant.
- `src/publish/auctions.tsx` — In `createAuctionEvent()`, conditionally push `['beta']` tag based on `BETA_MODE` environment variable.
- `src/lib/auction/tagBuilders.ts` — In `buildAuctionEventTags()`, conditionally push `['beta']` tag based on `BETA_MODE`.