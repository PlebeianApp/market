# Proposal: Auction Multiparty Payout Schedule Wire Profile

## Status

**Proposed — focused protocol review**

**Date:** 2026-08-05
**Target lineage:** `PlebeianApp/market` → `auctions`
**Review base:** `upstream/auctions@93da8c53910f2ba1621ccc3762a9c5525a721cbd`
**Settlement profile:** `cashu_p2pk_bidder_path_multiparty_v1`

## Repository-visible provenance

This proposal records the inherited Auction Multiparty V4V architecture baseline
and the first focused wire decisions in one reviewable repository artifact.
Reviewers must verify that the inherited list below accurately transcribes the
maintainer-approved architecture before treating it as normative.

The earlier July 29 multiparty-payout RFC is retained **outside this branch** as
non-normative pre-decision provenance with SHA-256:

```text
a517f0a17d61d8c7c2ad18f713c6e493104e6c4c101dac2ebfd5adf564d8751e
```

That historical RFC is not required to interpret this proposal and is not
presented as repository protocol truth.

## Scope

This first packet covers only:

1. semantic source-schedule validation;
2. canonical primitive validation;
3. deterministic ordering and derived indexes;
4. canonical UTF-8 serialization;
5. hostile-byte parsing, deterministic failure precedence, and complete-byte
   consumption;
6. the domain-separated schedule commitment; and
7. initial positive and negative conformance vectors.

It does not assign event kinds or define auction-root, bid, release, settlement,
receipt, validator-opinion, wallet, query, publication, or UI schemas.

## Inherited architecture decisions

This proposal does not reopen:

- the distinct profile `cashu_p2pk_bidder_path_multiparty_v1`;
- gross bid economics with auxiliary allocations inside the gross amount;
- deterministic cumulative integer allocation and seller remainder;
- integer basis points;
- total auxiliary allocation at no more than 10,000 basis points;
- one mint for every positive payout leg in a bidder chain;
- separation of Nostr identity and Cashu spending authority;
- exact payout-capability and validator-offer snapshots;
- exact-root validator acceptance before activation;
- valid zero-fee validator participation;
- mandatory correct funding and release for every positive root-listed
  auxiliary obligation;
- recipient-controlled redemption;
- seller settlement independent from auxiliary redemption; and
- distinct release, redemption, mint-evidence, seller-attestation, refund, and
  fulfillment states.

## Draft wire decisions

### D1 — Seller is implicit

The canonical schedule contains auxiliary `validator` and `v4v` entries only.
The seller is not serialized as a percentage entry and receives the cumulative
integer remainder.

### D2 — Schedule membership fixes role obligations

No generic `required` field is serialized. Membership binds the obligation
appropriate to the role.

A zero-fee validator:

- remains in the immutable schedule;
- remains bound through its exact capability snapshot, exact offer snapshot,
  and exact-root acceptance;
- remains a zero-amount logical manifest leg for each additive increment;
- emits no Cashu proofs for that zero-valued leg; and
- is excluded from positive-payout redemption-completion requirements.

The exact later-manifest representation remains deferred.

### D3 — Zero allocations and zero deltas

- validator entries may use `allocation_bps = 0`;
- V4V entries require `allocation_bps > 0`;
- a cumulative zero-delta increment remains logically attributable to its
  schedule entry; and
- zero-value Cashu outputs or proofs MUST NOT be fabricated for zero-valued
  logical legs.

### D4 — Exact snapshots

Every entry contains the exact payout-capability event ID. Validator entries
also contain the exact validator-offer event ID. Coordinates and “latest”
replacement events are not schedule fields.

### D5 — Derived indexes

Source entries do not supply `schedule_index`. Compilation validates and sorts
entries, then derives zero-based indexes. The indexes are serialized and later
structures must resolve them against the exact committed root schedule.

### D6 — Deterministic ordering

Entries sort by:

1. role order: `validator` before `v4v`;
2. recipient pubkey decoded to 32 bytes, ascending lexicographically.

### D7 — Recipient pubkeys are globally unique

A `recipient_pubkey` MUST appear in at most one schedule entry, regardless of
role. After same-role duplicate detection, compilation and parsing reject a
pubkey reused across `validator` and `v4v` roles as
`schedule_recipient_reused_across_roles`.

This is a wire-semantics and implementation-safety boundary. It does not prove
that different pubkeys represent different people or prevent one operator from
controlling multiple keys.

### D8 — Canonical text framing

Canonical bytes use the ASCII subset of UTF-8, TAB separators, LF endings, no
BOM, no CR, no blank lines, exact row counts, and complete-byte consumption.

### D9 — Commitment

```text
SHA256(
  UTF8("cashu_p2pk_bidder_path_multiparty_v1:payout_schedule_commitment:v1") ||
  0x00 ||
  canonical_schedule_bytes
)
```

The published form is 64 lowercase hexadecimal characters.

### D10 — Nonempty multiparty schedule

The `cashu_p2pk_bidder_path_multiparty_v1` wire profile requires at least one
auxiliary schedule entry. An auction with no auxiliary participants must use
`cashu_p2pk_bidder_path_v1`.

This is a profile-dispatch rule. A later pure allocation utility may still
accept an empty auxiliary list and return a 100% seller allocation.

### D11 — Derived exact-10,000 consequence

The inherited architecture permits total auxiliary allocation up to and
including 10,000 basis points. Therefore exactly 10,000 basis points is valid
and yields a zero seller remainder.

This packet records that inherited consequence and provides its conformance
vector. A future requirement for positive seller proceeds would require an
architecture or minimum-payout-policy amendment.

### D12 — V1 resource limits are fixed

The V1 schedule contains between 1 and 16 auxiliary entries.

`parse_canonical_schedule(bytes)` rejects any raw input longer than 4,096 bytes
before decoding, scanning, line splitting, header parsing, or allocation based
on attacker-controlled fields. `compile_source_schedule(source_entries)` rejects
more than 16 source entries before per-entry validation and rejects canonical
serialized output longer than 4,096 bytes before commitment computation.

Under all V1 invariants, the largest valid 16-entry all-validator schedule is
3,449 bytes: aggregate allocation remains at or below 10,000 basis points while
maximizing decimal field widths. The raw-input limit therefore leaves 647 bytes
of defensive margin.

An implementation MUST NOT raise either V1 limit while continuing to identify
the data as the same V1 wire format. Expansion requires a new schedule version
or profile.

## Semantic source-entry boundary

The source model distinguishes semantic data from wire framing:

- a source `validator` entry MUST contain `validator_offer_event_id` as an exact
  lowercase 64-hex event ID;
- a source `v4v` entry MUST omit `validator_offer_event_id` entirely;
- the semantic string `"-"` is invalid source data; and
- only the canonical serialized V4V row uses the single ASCII `-` placeholder.

## Pubkey-validation layers

The schedule codec validates only the context-free lexical form: exactly 64
lowercase hexadecimal characters encoding 32 bytes.

The later auction-root/profile validator additionally MUST verify the selected
Nostr/secp256k1 x-only public-key validity rule, the referenced capability's
signature, and equality between the capability author and
`recipient_pubkey`.

## Required codec operations

### `compile_source_schedule(source_entries)`

1. require D10 for the multiparty profile;
2. reject more than 16 source entries;
3. validate the semantic source-entry schema;
4. validate every primitive and role-specific field;
5. validate same-role recipient uniqueness;
6. reject recipient pubkeys reused across roles;
7. validate total allocation;
8. sort by D6;
9. derive sequential indexes;
10. serialize exact canonical bytes;
11. reject serialized output longer than 4,096 bytes; and
12. compute the D9 commitment.

### `parse_canonical_schedule(bytes)`

1. reject raw input longer than 4,096 bytes;
2. reject BOM, CR, non-ASCII bytes, and a missing final LF in that order;
3. parse the first LF-terminated header and validate its four fields in the
   protocol's declared order;
4. validate `entry_count` canonically and reject values above 16 before numeric
   conversion or row allocation;
5. locate exactly `entry_count` subsequent LF-terminated row slices;
6. reject too few declared rows as `schedule_entry_count_mismatch`;
7. reject an empty slice among those declared rows as
   `schedule_blank_line_forbidden`;
8. reject any remaining byte after the declared rows as
   `schedule_trailing_bytes` without inspecting the remainder;
9. validate every declared row's column count, primitive, and role-specific
   field;
10. revalidate indexes, same-role duplicates, cross-role recipient reuse, total
    allocation, and canonical row order;
11. reserialize successfully parsed data as an implementation assertion; and
12. compute the D9 commitment.

A parser must not trust sequential indexes as evidence that row order is
canonical. The raw byte limit precedes every other parser failure. Surplus data
takes precedence over declared-row column, primitive, role-specific, and
semantic failures because complete-byte consumption is checked before those
validations. An empty declared row slice remains an earlier structural failure.
A successful parse whose reserialization differs indicates an implementation
defect, not a separate wire failure.

## Fixture-stage model

Every negative fixture identifies exactly one operation:

```text
compile_source_schedule
parse_canonical_schedule
validate_schedule_commitment
```

Coverage claims are stage-aware. A compiler-only or commitment-only vector is
not counted as hostile-parser coverage. Compound-fault vectors lock the
important adjacent parser-precedence boundaries without attempting a
combinatorial fault matrix.

## Deferred production gate

D7 and the schedule codec's V1 resource limits are resolved in this packet and
covered by conformance vectors. This does not authorize a production parser,
root activation path, wallet mutation, or relay publication. Those remain
blocked until focused approval and completion of the remaining wire sections
and their own proof, token, event, query, and lifecycle resource limits.

## Acceptance gate

Repository inclusion for review does not make the profile normative. Focused
approval must:

- accept or revise D1–D12;
- reproduce every fixture byte-for-byte, including the fixed limit and D7
  precedence vectors;
- verify the 3,449-byte maximum-valid-schedule calculation; and
- preserve the production prohibition until the remaining wire sections and
  their resource limits are approved.
