# ADR-013: NIP-17 Order Message Transport

## Status

Proposed

## Related

- Issue: #1084
- Broader feature/security scope: #966
- Read-path overlap to avoid: #1068

## Scope

This ADR defines the transport architecture for moving buyer-seller order communication from raw public order/message events toward NIP-17 encrypted gift-wrapped messages.

This ADR is a foundation plan, not the full production behavior change. The first implementation PR should establish the tested NIP-17/Gamma order-message boundary only. Relay resolution, publish wiring, read/unwrapping integration, and migration behavior should follow in smaller reviewable PRs.

## Context

Current `master` has partial NIP-59 support for private buyer delivery details, but the broader buyer-seller order-processing flow still publishes and reads several raw events.

Verified current repo behavior:

- Conversations still query raw kind `14`, kind `16`, and kind `17` events.
- Chat sends raw plaintext kind `14`.
- Order creation, payment request, status, and shipping flows still use raw kind `16` events.
- Checkout payment receipts still use raw kind `17`.
- Private buyer delivery details have partial NIP-59 gift-wrap handling.
- The repo has kind `10002` / NIP-65 relay-list support, but no strict kind `10050` NIP-17 DM relay resolver.
- Global publish uses `ndkActions.publishEvent`, which routes through current app/default relay behavior.

The PM direction is to move forward with applying gift wrapping to the order-processing flow after the earlier PII/infrastructure fixes.

## External compatibility targets

NIP-17 encrypted direct messages use:

- NIP-44 encryption
- NIP-59 sealing and gift wrapping
- unsigned inner rumors
- kind `13` seal events
- kind `1059` gift-wrap events
- one gift wrap per receiver
- one sender self-wrap
- randomized timestamps up to two days in the past
- recipient kind `10050` DM relay lists for strict delivery

Gamma Market compatibility target:

- inner kind `14`: order-related general communication
- inner kind `16`, type `1`: order creation
- inner kind `16`, type `2`: payment request
- inner kind `16`, type `3`: order status update
- inner kind `16`, type `4`: shipping update
- inner kind `17`: payment receipt

Gamma is treated as an external compatibility target. It is not proof of current Plebeian behavior.

## Decisions

### Decision 1: Add a dedicated NIP-17/Gamma order-message boundary

Add a focused boundary for order-message transport instead of spreading NIP-17 logic across checkout, order queries, payment publishing, and global NDK state.

Initial production files:

```text
src/lib/nostr/nip17.ts
src/lib/orders/orderMessageRumor.ts
```

Later integration files:

```text
src/lib/nostr/nip17Relays.ts
src/publish/orders.tsx
src/publish/payment.tsx
src/queries/orderGiftWraps.tsx
src/queries/messages.tsx
src/queries/orders.tsx
```

### Decision 2: Do not mutate global NDK publish behavior

Do not change these global paths for this work:

```text
ndkActions.publishEvent
getWriteRelaySet
getRelayUrls
global NDK relay initialization
```

Reason: many unrelated publish paths depend on global NDK behavior. NIP-17 order transport needs per-recipient DM relay routing, which should be explicit and local to the NIP-17/order-message boundary.

### Decision 3: Reuse existing NIP-59 helpers

Reuse existing NIP-59 crypto helpers for sealing and gift wrapping.

The new NIP-17 boundary should sit above the existing NIP-59 helper and add:

- sender self-wrap support
- timestamp randomization policy
- recipient/sender wrap grouping
- validation around unsigned rumors
- integration with kind `10050` relay resolution

### Decision 4: Add sender self-wrap support

Every NIP-17 order message should produce:

```text
recipient wrap -> p tag = recipient pubkey
sender self-wrap -> p tag = sender pubkey
```

Relay routing target:

```text
recipient wrap -> recipient DM relays
sender self-wrap -> sender DM relays
```

The recipient wrap is for the counterparty. The sender self-wrap allows the sender to recover and display their own sent message from another client/device.

### Decision 5: Preserve Gamma-compatible inner event shapes

The encrypted rumor should preserve the Gamma marketplace message shape.

Inner event targets:

```text
kind 14: order-related general communication
kind 16 type 1: order creation
kind 16 type 2: payment request
kind 16 type 3: order status update
kind 16 type 4: shipping update
kind 17: payment receipt
```

These fields belong inside the encrypted inner rumor, not on the public gift-wrap event.

### Decision 6: Keep legacy raw reads during migration

Existing raw kind `14`, kind `16`, and kind `17` events must continue to render during migration.

The read path should eventually become:

```text
legacy raw 14/16/17 reads
+ kind 1059 gift-wrap fetch for current user
+ local unwrap/decrypt
+ filter inner rumors to kind 14/16/17
+ merge/group into existing order and conversation views
```

Do not remove legacy raw-event support until maintainers explicitly decide the migration is complete.

### Decision 7: Treat kind 10050 relay routing as required for strict NIP-17

Strict NIP-17 delivery requires kind `10050` DM relay lists.

Open decision:

```text
Should Plebeian use strict kind 10050-only behavior, meaning send fails/skips when the recipient has no DM relay list, or should Plebeian use a documented compatibility fallback to app/default or kind 10002 relays?
```

Spec-strict behavior is kind `10050` only. A fallback may improve UX, but it must be documented as repo-local compatibility behavior rather than strict NIP-17 behavior.

### Decision 8: Place new tests under src/lib/__tests__

The normal unit script only discovers tests under:

```text
contextvm
src/queries/__tests__
src/lib/__tests__
```

New boundary tests should live under:

```text
src/lib/__tests__/nip17.test.ts
src/lib/__tests__/orderMessageRumor.test.ts
```

This keeps the first PR covered by `bun run test:unit` without changing test discovery or pulling in adjacent legacy tests.

## Encrypted indexing tradeoff

Once order IDs, payment proofs, amounts, message types, status values, addresses, emails, phone numbers, and notes move inside encrypted rumors, they are no longer relay-queryable as public tags.

Read paths must fetch kind `1059` events addressed to the current user, unwrap locally, then filter/group by inner tags.

Wrapper events must not expose public order-specific or payment-specific tags such as:

```text
order
payment
amount
status
shipping
address
email
phone
name
```

The wrapper still includes NIP-17 delivery metadata, primarily the recipient `p` tag. Relay hints may be considered only if they do not expose order-specific metadata.

This tradeoff is intentional. It protects order metadata and PII at the cost of local unwrap/filter work.

## Non-goals

PR 1 should not include:

- checkout wiring
- payment publish wiring
- full order read-path migration
- global NDK relay changes
- removal of legacy raw `14/16/17` reads
- #1068 orders read-path migration work
- broad messaging rewrite
- dependency changes unless strongly justified

## Alternatives considered

### Alternative 1: Mutate global `ndkActions.publishEvent`

Rejected for this work. Global publish is used by many unrelated flows. NIP-17 order-message delivery requires explicit per-recipient DM relay routing and should not change all publishing behavior.

### Alternative 2: Continue wrapping only private delivery details

Rejected as incomplete. It protects one private-order path but leaves order creation, payment requests, status/shipping updates, receipts, and chat on raw public events.

### Alternative 3: Remove raw `14/16/17` reads immediately

Rejected for migration safety. Existing orders and messages must continue to render until maintainers explicitly decide the legacy raw-event migration is complete.

### Alternative 4: Implement all wiring in one PR

Rejected for reviewability. Crypto/message shape, DM relay resolution, publish wiring, and read integration each have separate risks and should be reviewed independently.

## PR plan

### PR 1: NIP-17/Gamma boundary foundation

Files:

```text
docs/adr/ADR-013-nip17-order-message-transport.md
src/lib/nostr/nip17.ts
src/lib/orders/orderMessageRumor.ts
src/lib/__tests__/nip17.test.ts
src/lib/__tests__/orderMessageRumor.test.ts
```

Scope:

- add NIP-17 sender + recipient wrapping boundary
- reuse existing NIP-59 helpers
- add Gamma-shaped inner order-message rumor builders
- prove recipient wrap + sender self-wrap
- prove no plaintext PII/order/payment details in public gift wraps
- prove inner rumor validation
- no checkout/order publish wiring yet

Validation:

```bash
bun test src/lib/__tests__/nip17.test.ts src/lib/__tests__/orderMessageRumor.test.ts
bun run test:unit
```

### PR 2: DM relay resolver

Files:

```text
src/lib/nostr/nip17Relays.ts
src/lib/__tests__/nip17Relays.test.ts
```

Scope:

- fetch latest kind `10050` event for a pubkey
- parse `relay` tags
- construct explicit relay targets for recipient and sender wraps
- implement strict-vs-fallback policy after maintainer decision

Validation:

```bash
bun test src/lib/__tests__/nip17Relays.test.ts
bun run test:unit
```

### PR 3: Publish wiring

Files:

```text
src/publish/orders.tsx
src/publish/payment.tsx
```

Scope:

- wrap order creation
- wrap payment requests
- wrap status updates
- wrap shipping updates
- wrap checkout payment receipts
- avoid publishing new private order/payment content as raw public `14/16/17`
- preserve any explicit compatibility behavior approved by maintainers

Validation:

```bash
bun test src/lib/__tests__/nip17.test.ts src/lib/__tests__/orderMessageRumor.test.ts
bun run test:unit
```

Additional targeted tests may be added under covered test paths. Direct-run tests should be documented if adjacent publish tests remain outside `test:unit`.

### PR 4: Read/unwrapping integration

Files:

```text
src/queries/orderGiftWraps.tsx
src/queries/messages.tsx
src/queries/orders.tsx
```

Scope:

- fetch kind `1059` events addressed to the current user
- unwrap/decrypt with signer
- validate inner author, `p` tag, order id, type/payment/status/shipping tags
- merge decrypted wrapped messages with legacy raw events
- avoid stepping on #1068 read-path migration

Validation:

```bash
bun run test:unit
```

Add focused query tests under:

```text
src/queries/__tests__
```

## Testing strategy

PR 1 tests should prove:

- recipient gift wrap is kind `1059`
- sender self-wrap is kind `1059`
- recipient gift wrap has `[['p', recipientPubkey]]`
- sender self-wrap has `[['p', senderPubkey]]`
- both unwrap back to the same inner rumor
- public gift wraps do not expose PII/order/payment details
- signer without NIP-44 encrypt fails closed
- inner rumor IDs are canonical
- inner rumors remain unsigned
- supplied timestamps are deterministic in tests
- randomized timestamps are covered separately from deterministic fixtures

Order rumor tests should prove:

- kind `14` order chat shape
- kind `16` order creation shape
- kind `16` payment request shape
- kind `16` status update shape
- kind `16` shipping update shape
- kind `17` payment receipt shape
- required tags are validated
- public-wrapper unsafe fields remain inside the rumor only
- direction is validated by author and `p` tag where caller context is available

## Security and privacy notes

- Relay data is untrusted.
- Public wrapper metadata should be minimized.
- PII must never appear in public gift-wrap content or tags.
- Payment proof/reference data should not appear in public wrapper tags.
- Receipt publication is not the same as payment settlement.
- Wallet ACK, preimage/proof, receipt publication, merchant confirmation, fulfillment, expiration, failure, refund, and cancellation are separate lifecycle states.
- Sender self-wraps improve recoverability but double publish volume.
- Missing kind `10050` relay lists are a UX/product decision, not a crypto detail.
- Generic NIP-17 clients may render inner kind `14`; marketplace-specific kind `16` and kind `17` may require Plebeian/Gamma-aware clients.

## Open questions

1. Should strict NIP-17 behavior fail/skip when the recipient has no kind `10050` relay list?

2. If not, what exact fallback is approved?

   - app/default relays
   - kind `10002` / NIP-65 relay list
   - both
   - no fallback

3. Should PR 3 stop publishing raw order-processing events immediately, or dual-publish temporarily during migration?

4. Which inner kind `14` order-chat messages are in scope for the first publish-wiring PR?

5. Should payment receipt wrapping include all existing receipt tags inside the encrypted rumor, including payment proof references such as Lightning invoices/preimages, Bitcoin transaction references, eCash proofs, or other supported payment media?

6. Should readable kind `14` companion messages be added for generic NIP-17 client visibility, or should structured kind `16`/`17` remain Plebeian/Gamma-aware only?

## Consequences

Positive:

- Aligns order transport with NIP-17 and Gamma direction.
- Reduces public leakage of buyer-seller order metadata.
- Keeps the work reviewable by separating crypto boundary, relay resolution, publish wiring, and reads.
- Avoids global relay/publish regressions.
- Preserves legacy raw reads during migration.

Negative / tradeoffs:

- Read paths must unwrap locally before filtering by order id.
- Publish volume increases because each message needs recipient and sender wraps.
- Strict kind `10050` behavior may cause sends to fail for users without DM relay lists.
- Compatibility fallback improves UX but is not strict NIP-17 behavior.
- Generic NIP-17 clients may display only inner kind `14`; marketplace-specific kind `16` and kind `17` may still require Plebeian/Gamma-aware clients.

## References

- NIP-17: https://github.com/nostr-protocol/nips/blob/master/17.md
- NIP-59: https://github.com/nostr-protocol/nips/blob/master/59.md
- NIP-44: https://github.com/nostr-protocol/nips/blob/master/44.md
- Gamma Market spec: https://github.com/GammaMarkets/market-spec/blob/main/spec.md
