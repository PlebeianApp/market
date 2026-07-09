# ADR-014: NIP-17 Order Transport Migration and Cutover Criteria

## Status

Proposed

## Related

- ADR-013: NIP-17 Order Message Transport
- Issue: #1084
- Broader encrypted buyer-seller communication scope: #966
- Read-path overlap to avoid: #1068
- Foundation PRs:
  - #1095: NIP-17 order-message rumor boundary
  - #1096: kind 10050 DM relay resolver
  - #1098: NIP-17 order publish helper boundary
  - #1099: NIP-17 order read/unwrapping helper boundary

## Scope

This ADR extends ADR-013. It does not replace the NIP-17/Gamma order-message foundation already documented there.

ADR-014 defines the staged migration plan, transport orchestration seam, failure semantics, compatibility constraints, and flow-level cutover criteria for moving buyer-seller order communication from raw public kind 14/16/17 events toward NIP-17 encrypted gift-wrapped messages.

This ADR does not itself authorize disabling legacy raw writes, removing legacy raw reads, or changing live checkout/query behavior.

## Context

ADR-013 established the foundation architecture for moving buyer-seller order communication from raw public kind 14/16/17 events toward NIP-17 encrypted gift-wrapped messages.

That foundation now exists in focused boundaries:

- Gamma-compatible unsigned order-message rumors
- kind 10050 DM relay resolution
- NIP-17 order publish helper
- NIP-17 order read/unwrapping helper

The remaining problem is staged migration and production cutover, not the base cryptographic message shape.

Current live app surfaces still rely on legacy raw public order/message reads and writes. During migration, those legacy paths must remain readable so existing orders do not disappear.

The orders read path is also an active overlap area because #1068 changes `src/queries/orders.tsx` for the NDK-to-Applesauce migration. Therefore NIP-17 integration should proceed through narrow seams and avoid broad query rewrites until that stack settles or maintainers explicitly approve the collision.

## Decision

Adopt a staged NIP-17 order transport migration and cutover plan.

### Decision 1: ADR-013 remains the foundation

ADR-013 defines the NIP-17 order-message foundation:

- Gamma-compatible unsigned inner rumors
- NIP-59 gift wrapping
- kind 1059 public wrapper events
- sender self-wraps
- kind 10050 DM relay targeting
- legacy raw reads during migration
- encrypted-indexing tradeoffs

ADR-014 does not re-decide those foundation choices. ADR-014 defines orchestration, integration order, failure semantics, and cutover criteria.

### Decision 2: Add a transport orchestration seam before live UI/query wiring

Add a helper-only transport boundary before wiring checkout, order detail pages, conversations, or payment flows.

Future target files:

```text
src/lib/orders/nip17OrderTransport.ts
src/lib/__tests__/nip17OrderTransport.test.ts
```

The transport seam should orchestrate existing boundaries:

- order-message rumor validation
- kind 10050 sender/recipient relay resolution
- sender self-wrap publish
- recipient gift-wrap publish
- kind 1059 gift-wrap fetch
- unwrap and validation
- dedupe by inner rumor id
- deterministic sorting

The seam must use dependency injection for relay reads/writes. It must not import React Query, checkout UI, `ndkActions`, or `src/queries/orders.tsx`.

The transport seam should return protocol/domain records, not require UI-compatible `NDKEvent` objects. If existing views need `NDKEvent`-like objects, that adaptation should happen in a later query/view adapter.

### Decision 3: Sender self-wrap is mandatory

Every NIP-17 order message must produce:

```text
recipient gift wrap -> recipient pubkey
sender self-wrap -> sender pubkey
```

The sender self-wrap must be published before recipient delivery.

Reason: if recipient delivery succeeds but sender self-wrap fails, callers may treat the send as failed while the counterparty already received the message. Publishing the sender self-wrap first reduces orphaned recipient deliveries and preserves the sender's own message history.

### Decision 4: kind 10050 relay targets are required

Both sender and recipient kind 10050 DM relay lists are required for strict NIP-17 order transport.

Missing or empty kind 10050 relay targets fail closed.

The app must not silently fall back to app/default relays or kind 10002 relays unless maintainers explicitly approve that compatibility behavior in a later ADR or PR.

### Decision 5: Single unwrap is strict; batch reads are best-effort

Single-message unwrapping should throw on malformed, unrelated, undecryptable, or invalid order-message gift wraps.

Batch reads from relays should ignore malformed, unrelated, or undecryptable gift wraps and return the valid unwrapped order messages.

Reason: relay batches are adversarial/untrusted and may contain unrelated events. UI reads should remain usable, but lower-level strict functions must still exist for tests and targeted callers.

### Decision 6: Inner rumor id is the canonical transport identity

The canonical unsigned inner rumor id is the primary identity for dedupe and retry handling.

Multiple wrapper events may exist for the same inner rumor because sender/recipient wraps are separate and retries may republish the same canonical inner rumor. Read integration should dedupe by inner rumor id after successful unwrap, not by wrapper event id.

### Decision 7: Legacy raw reads remain during migration

Raw kind 14/16/17 order-message reads remain supported during migration.

Future read integration should merge:

```text
legacy raw kind 14/16/17 events
+ unwrapped NIP-17 inner order-message rumors
```

Legacy raw reads must not be removed until maintainers explicitly decide the migration is complete.

### Decision 8: Legacy raw writes are not removed yet

Legacy raw writes should not be removed until:

- NIP-17 publish path is wired
- NIP-17 read path is wired
- sender self-wrap visibility is proven
- recipient delivery is proven
- missing kind 10050 UX is decided
- maintainers approve the cutover

Cutover is flow-scoped. Order chat, order creation, payment requests, payment receipts, status updates, and shipping updates may migrate at different times. A successful cutover for one flow does not imply that legacy raw writes can be removed for all flows.

### Decision 9: Avoid the #1068 orders read-path collision

Do not broadly rewrite `src/queries/orders.tsx` as part of the transport seam.

If read integration is needed before #1068 lands, it should live in a narrow helper or adapter that can be merged later with either the NDK-backed or Applesauce-backed read path.

### Decision 10: Wrapper events must not leak order metadata

Public gift-wrap events must not expose order-specific or payment-specific tags such as:

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
item
```

Those fields belong inside the encrypted inner rumor.

### Decision 11: Transport results must preserve partial delivery state

The transport layer must preserve partial delivery state. UI policy for each state remains a later integration decision.

The transport layer should distinguish:

- validation failed before publish
- relay target resolution failed before publish
- sender self-wrap publish failed
- sender self-wrap published, recipient delivery failed
- sender self-wrap and recipient delivery both succeeded

UI integrations must not collapse these states into misleading generic success or failure messages.

### Decision 12: Error handling must not leak private payloads

Thrown errors, logs, telemetry, and UI toasts must not include decrypted content, ciphertext, payment proofs, addresses, emails, phone numbers, buyer names, order notes, or raw private payloads.

Errors should identify failure class and recovery path without embedding private order/message material.

### Decision 13: Plaintext caching requires an explicit storage policy

If decrypted order messages are cached locally, the cache must not silently persist plaintext PII/payment data without an explicit storage policy.

Any cache should prefer ephemeral memory first. Durable plaintext caching requires separate maintainer approval.

## Non-goals

- No checkout rewrite in the ADR PR.
- No live query integration in the ADR PR.
- No `src/queries/orders.tsx` rewrite.
- No `src/queries/messages.tsx` rewrite.
- No global NDK relay changes.
- No Applesauce migration.
- No aggregator relay changes.
- No `ndkActions` rewrite.
- No removal of legacy raw reads.
- No removal of legacy raw writes.

## Migration plan

### Next PR: ADR-014 only

Document migration and cutover decisions.

### Follow-up PR: Transport orchestration boundary

Add:

```text
src/lib/orders/nip17OrderTransport.ts
src/lib/__tests__/nip17OrderTransport.test.ts
```

No live app wiring.

### Follow-up PR: Narrow read integration

Add a narrow read helper that can merge unwrapped NIP-17 order messages with legacy raw events.

Avoid broad `src/queries/orders.tsx` rewrites unless #1068 has landed or maintainers approve.

### Follow-up PR: Narrow publish integration for one flow

Wire one low-risk flow first, likely order chat or order creation.

Use NIP-17 only when sender and recipient kind 10050 relay targets are ready.

### Follow-up PR: Expand coverage

Expand to payment requests, payment receipts, status updates, shipping updates, and remaining order chat flows.

### Follow-up PR: Compatibility cleanup

Decide whether legacy raw writes become:

- disabled
- marker-only
- compatibility fallback
- fully removed

Keep legacy raw reads for a migration window.

## Cutover criteria

A flow is not eligible for legacy raw-write removal until:

- NIP-17 publish is wired for that flow.
- NIP-17 reads are wired for that flow.
- Sender self-wrap visibility is proven.
- Recipient delivery is proven.
- Missing kind 10050 behavior has UX handling.
- Failed recipient delivery after sender self-wrap has retry or recovery semantics.
- Malformed/undecryptable relay events do not break reads.
- Existing raw legacy orders still render.
- Private payloads are not logged, toasted, or persisted unexpectedly.
- Maintainers explicitly approve the flow-level cutover.

## Open maintainer questions

- Should checkout publish NIP-17-only, or NIP-17 plus a public marker?
- Should legacy raw writes continue temporarily for compatibility?
- Should users see setup guidance when kind 10050 relay lists are missing?
- Should missing kind 10050 block checkout or create a recoverable send-pending state?
- Should failed recipient delivery after sender self-wrap produce retry state?
- Should unwrapped NIP-17 order messages be cached locally to avoid repeated decrypt work?
- Should read integration live in a new helper before touching `src/queries/orders.tsx`?
- Should public wrapper events include any relay hints, and if so, which hints avoid leaking order metadata?
- Should transport records be converted into `NDKEvent`-shaped objects for existing views, or should order views consume a new normalized order-message record type?
- Should a transport orchestration helper expose partial delivery states directly, or should it return a stricter success/failure result and leave partial state to a lower layer?

## Consequences

Positive:

- Keeps privacy-sensitive order/payment/chat data inside encrypted rumors.
- Preserves sender history through sender self-wraps.
- Makes relay routing explicit and reviewable.
- Keeps integration diffs small.
- Avoids coupling NIP-17 migration to Applesauce read-path work.
- Defines cutover criteria before legacy behavior is removed.
- Preserves clear failure states for checkout and retry UX.

Trade-offs:

- Users without kind 10050 relay lists may not be able to send NIP-17 order messages until UX guidance exists.
- Reads must support both legacy raw events and unwrapped NIP-17 messages during migration.
- Local decrypt/filter work increases.
- Checkout failure handling becomes more complex.
- Transport results need to model partial delivery state instead of simple boolean success/failure.
- Durable plaintext caching, if introduced, requires a separate privacy/storage decision.

## Alternatives considered

### Alternative 1: Wire checkout directly after the read helper

Rejected for reviewability and safety. Checkout wiring combines protocol transport, relay targeting, payment/order lifecycle behavior, user-facing errors, and compatibility policy in one surface. A transport seam should be reviewed first.

### Alternative 2: Broadly rewrite `src/queries/orders.tsx` for NIP-17 reads now

Rejected for overlap risk. #1068 is already changing the orders read path for the NDK-to-Applesauce migration. NIP-17 read integration should use a narrow helper or adapter until that stack settles or maintainers approve the collision.

### Alternative 3: Use app/default relays when kind 10050 is missing

Rejected for this ADR. A fallback may improve UX, but it changes strict NIP-17 delivery semantics and should be explicitly approved as repo-local compatibility behavior before implementation.

### Alternative 4: Remove legacy raw writes globally after first NIP-17 flow lands

Rejected for migration safety. Cutover must be flow-scoped, and legacy behavior should remain until NIP-17 publish/read paths are proven for that flow.

### Alternative 5: Persist decrypted order messages by default

Rejected for privacy. Durable plaintext caching of order messages, addresses, payment proofs, or buyer/seller notes requires a separate storage policy and maintainer approval.
