# ADR-XXX: Relay Data Validation Enforcement

## Status

Proposed

## Date

2026-07-23

## Related

- AGENTS.md: "Treat relay data as untrusted until validated. Prefer pubkeys,
  event IDs, coordinates, and tags over display text."
- ADR-0002: NDK → Applesauce I/O migration (applesauce provides validated
  event parsing primitives)
- `src/lib/schemas/` — existing Zod schema files for Nostr event kinds

---

## Problem

Nostr relays accept events from anyone. Any pubkey can publish any kind of
event with any content. AGENTS.md mandates treating relay data as untrusted,
but this constraint has no enforcement mechanism — no lint rule, no shared
validation helper, no test requirement. As a result, most query layers and
several components parse relay event content directly with `JSON.parse()`
and no schema validation.

Malformed or adversarial relay events can crash queries, poison component
state, or cause render-time exceptions that kill the SPA.

## Decision

### Rule: All `event.content` parsing MUST go through a Zod `safeParse` gate

before the parsed value enters query results, component state, or any
downstream computation.

```typescript
// FORBIDDEN — crashes on malformed input, no type safety:
const data = JSON.parse(event.content)

// REQUIRED — degrades gracefully, type-safe:
const result = AuctionListingSchema.safeParse(JSON.parse(event.content))
if (!result.success) {
    // log, skip, or return fallback — never throw
    return null
}
const data = result.data  // typed, validated
```

### Why `safeParse` not `parse`:

`parse()` throws on invalid input — this crashes the query or render. 
`safeParse()` returns `{ success, data, error }` — the caller handles
failure gracefully. The 59 existing `.parse()` calls in the codebase should
migrate to `safeParse` as they're touched.

### Enforcement

1. **ESLint custom rule** (or `no-restricted-syntax`): flag any
   `JSON.parse(*.content)` call not wrapped in a `safeParse` gate.
2. **Code review checklist**: reviewers verify new queries validate relay data.
3. **Schema coverage**: each consumed Nostr kind must have a Zod schema in
   `src/lib/schemas/`.

### Migration path

Schema files are added per Nostr kind, prioritized by criticality:

1. **Payment-critical kinds first**: 1023 (bid), 1024 (settlement),
   1025 (path release), 30408 (auction listing)
2. **User-facing kinds**: 0 (metadata), 3 (contacts), 10050 (DM relays)
3. **Remaining kinds**: 30023 (article), 10000+ (app-specific)

Existing schemas in `src/lib/schemas/auction/` already cover some auction
kinds. Expand coverage outward from there.

### Connection to ADR-0002

As the applesauce migration progresses, applesauce's event parsing and
validation primitives can replace raw `JSON.parse` at the I/O layer (Wave B+).
This ADR establishes the validation requirement now, so the migration has
a clear target.

---

## Current Violations (Transient — remove as fixed)

These are the known violations as of 2026-07-23. Entries are removed as
PRs fix each one. When this section is empty, the migration is complete.

### Query layer (raw `JSON.parse` without schema)

| File | Line | Kind | Notes |
|------|------|------|-------|
| `src/queries/authors.tsx` | 17-20 | 0 (metadata) | Parses kind-0 metadata 4× with no try/catch. Malformed content crashes the query. |
| `src/queries/v4v.tsx` | 79, 93 | app-specific | v4v config parsed without schema |
| `src/queries/relay-preferences.tsx` | 52 | 10000+ | Relay preferences parsed without schema |
| `src/queries/zaps.tsx` | 49 | 9735 (zap) | Profile content parsed without schema |
| `src/queries/payment.tsx` | 144, 812 | payment | Payment data parsed without schema |

### Component layer (raw `JSON.parse` in render path — crashes SPA)

| File | Line | Kind | Notes |
|------|------|------|-------|
| `src/components/auth/NostrConnectQR.tsx` | 241 | NIP-46 | JSON.parse in render — any error kills the component |
| `src/components/migration/MigrationForm.tsx` | 886 | app-specific | JSON.parse in render |
| `src/components/v4v/ProfileSearch.tsx` | 254 | 0 (metadata) | JSON.parse in render |

### Schema coverage gaps

- 9 schema files exist in `src/lib/schemas/` for ~25+ Nostr kinds consumed
- 4 `safeParse()` calls vs 59 raw `.parse()` calls (`.parse` throws on invalid)
- Payment kinds (1023, 1024, 1025) have partial schema coverage via
  `src/lib/schemas/auction/` but are not used consistently in query layers

---

## Consequences

### Positive

- Adversarial or malformed relay events can no longer crash queries or
  components
- Type safety: validated data is typed, reducing `as any` assertions
- Clear enforcement mechanism (ESLint rule + code review)
- Connects naturally to the applesauce migration (ADR-0002)
- The "current violations" section serves as a migration tracker

### Costs

- Every new query touching relay events must define or import a Zod schema
- Existing 59 `.parse()` calls need migration to `safeParse` (incremental)
- ESLint custom rule requires initial setup effort
- Some edge cases may need relaxed schemas initially (validate what matters,
  allow extra fields)

## Notes

This ADR follows the "persistent rule + transient violations" pattern:
- The Problem and Decision sections above are permanent — they define the rule
  that all future code must follow
- The "Current Violations" section is transient — entries are removed as PRs
  fix each violation. When all are fixed, the section is deleted and the ADR
  remains as a clean statement of the validation standard
