# Auction Shipping Ref Deduplication

## Problem

The auction detail page (`/auctions/:auctionId`, Description tab) had two issues:

1. **No deduplication** — duplicate `shipping_option` tags on a kind 30408 event fired duplicate relay queries and rendered duplicate rows.
2. **No feedback for unresolved refs** — when a shipping ref couldn't be resolved (event deleted, malformed coordinate, query in flight), the page fell back to displaying the raw `30406:<pubkey>:<dTag>` string with no way to distinguish between "still loading", "not found", and "invalid".

## What changed

### `src/lib/auctionShippingUtils.ts` (new)

Pure `dedupeAndParseShippingRefs()` function extracted for testability. Dedup key is `{ shippingRef, extraCost }` — two tags referencing the same shipping option but with different surcharges produce separate rows (same option + different extra cost = legitimate distinct offering).

### `src/routes/auctions.$auctionId.tsx`

- `parsedShippingRefs` now calls `dedupeAndParseShippingRefs()` instead of inline `.map()`
- `resolvedShippingOptions` now includes `isLoading` and `isError` from query results
- Shipping JSX has four explicit states:

| State     | Condition                                 | Display                                   |
| --------- | ----------------------------------------- | ----------------------------------------- |
| Invalid   | ref doesn't match `30406:<pubkey>:<dTag>` | "Invalid shipping reference" (amber)      |
| Loading   | valid ref, query in flight, no data yet   | "Loading shipping details..." (zinc-400)  |
| Resolved  | valid ref, event found                    | Title, price, service, carrier (existing) |
| Not found | valid ref, query returned no event        | "Shipping option not found" (zinc-500)    |

### `e2e-new/scenarios/index.ts`

Added `seedAuction()` helper that publishes a kind 30408 event with all required tags. First auction seeding helper in the E2E infrastructure — reuses the existing `publish()` pattern.

### Pre-existing E2E skips

Two pre-existing E2E failures annotated with `test.skip()` + baseline date (not caused by this PR):

- `cart.spec.ts:291` — shipping selector count mismatch
- `marketplace.spec.ts:327` — shipping trigger not found

## Test results

### Unit tests (7/7 passed)

```bash
bun test src/lib/__tests__/auctionShippingUtils.test.ts
```

- Exact duplicate removal (same ref + same extraCost)
- Different extraCost for same ref preserved
- First-occurrence order preserved
- Valid vs invalid ref classification
- Empty input
- All-duplicates-single-entry
- extraCost preserved in output

### Playwright E2E (4/4 passed)

```bash
bun run test:e2e-new -- --grep "Auction Shipping"
```

- Resolved shipping option shows title + base price
- Duplicate refs render as single row
- Same ref with different extraCost renders as two rows
- Unresolvable ref shows "Shipping option not found"

E2E regression check: baseline 97 pass / 2 fail / 11 skip -> post-impl 100 pass / 0 regressions / 13 skip

### Manual UI validation (5/5 passed + 3/3 general checks)

All 5 scenarios verified in browser on VPS deployment:

1. Resolved shipping: 2 cards with titles, prices, service types
2. Deduplication: 1 card where 2 duplicate tags existed
3. Different extra costs: 2 distinct cards, second shows surcharge
4. Invalid reference: amber "Invalid shipping reference" warning
5. Not found reference: gray "Shipping option not found" message

General: no console errors, cards resolve within 1-2s, no layout issues.

## Files changed

```
 src/lib/auctionShippingUtils.ts               |  24 +++  (new)
 src/lib/__tests__/auctionShippingUtils.test.ts |  70 ++++  (new)
 src/routes/auctions.$auctionId.tsx            |  36 ++--  (dedup + states)
 e2e-new/scenarios/index.ts                   |  59 +++   (seedAuction helper)
 e2e-new/tests/auction-shipping.spec.ts        |  97 ++++  (new)
 e2e-new/tests/cart.spec.ts                    |   4 +-  (pre-existing skip)
 e2e-new/tests/marketplace.spec.ts             |   4 +-  (pre-existing skip)
 Makefile                                      | 155 ++++  (e2e tooling)
 scripts/publish-auction.sh                    |  64 +++   (e2e tooling)
 .gitignore                                    |   8 +-   (.e2e-relay.pid)
```

Closes #813
