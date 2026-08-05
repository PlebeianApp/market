# Auction Multiparty Payout Wire Profile V1 — Schedule Packet

## 1. Status and provenance

**Status:** Proposed — focused protocol review
**Profile:** `cashu_p2pk_bidder_path_multiparty_v1`
**Scope:** Canonical payout-schedule compilation, parsing, and commitment only

The proposal at `docs/adr/proposals/auction-multiparty-wire-profile.md`
contains the repository-visible inherited architecture record and draft
schedule decisions. This packet does not authorize production implementation.

## 2. Conformance language

The words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, and **MAY** are draft
normative language. They become protocol requirements only after focused
approval.

An implementation that does not recognize
`cashu_p2pk_bidder_path_multiparty_v1` MUST reject the profile and MUST NOT
reinterpret it as `cashu_p2pk_bidder_path_v1`.

## 3. Architecture versus wire

| Topic                         | Architecture status                            | This packet                                       |
| ----------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| Distinct multiparty profile   | Fixed                                          | Exact literal and fail-closed dispatch            |
| Gross-bid economics           | Fixed                                          | Integer basis-point fields                        |
| Seller remainder              | Fixed                                          | Seller omitted; cumulative remainder derived      |
| Exact 10,000 auxiliary bps    | Inherited consequence                          | Valid; seller remainder is zero                   |
| Single-mint bidder chain      | Fixed                                          | Deferred from schedule codec                      |
| Capability snapshots          | Fixed                                          | Exact event-ID fields                             |
| Contracted validators         | Fixed                                          | Exact validator-offer fields                      |
| Zero-fee validators           | Fixed                                          | Root member and logical zero leg; no Cashu proofs |
| Shared path per increment     | Fixed                                          | Derivation encoding deferred                      |
| Per-recipient locks           | Fixed                                          | Manifest encoding deferred                        |
| Public release-token delivery | Delivery obligation fixed; encoding unresolved | Kind-1025 packet                                  |
| Recipient confirmation        | Required policy boundary                       | Evidence event deferred                           |
| Completion formula            | Fixed                                          | Not computed by schedule codec                    |
| Cross-role identity reuse     | Fixed                                          | Recipient pubkeys are globally unique             |
| Maximum entry count           | Fixed                                          | 16 auxiliary entries                              |
| Maximum raw schedule bytes    | Fixed                                          | 4,096 parser input and compiler output bytes      |

## 4. Terminology

A **source entry** is a semantic auxiliary participant record before schedule
compilation.

A **canonical entry** is a validated source entry with its derived
`schedule_index`.

A **logical manifest leg** is the deterministic per-entry allocation record for
an additive increment, including a zero-valued record when cumulative allocation
produces zero. The later manifest packet defines its exact encoding.

```text
seller_remainder_bps = 10000 - sum(auxiliary allocation_bps)
```

Exactly 10,000 auxiliary basis points is valid as an inherited architecture
consequence. Actual sat allocation uses the approved cumulative-flooring
algorithm, not independent per-increment rounding.

## 5. Primitive encodings and validation layers

### 5.1 Profile

Exactly `cashu_p2pk_bidder_path_multiparty_v1`, compared byte-for-byte and
case-sensitively.

### 5.2 Object type and version

The header object type is exactly `payout_schedule`. The schedule format
version is exactly `1`.

### 5.3 Role

Exactly `validator` or `v4v`, ordered `validator < v4v`.

### 5.4 Recipient pubkey: codec layer

The schedule codec accepts exactly 64 lowercase hexadecimal characters
representing 32 bytes. Prefixes, uppercase, whitespace, nonhex characters, and
alternate encodings are invalid.

This is lexical canonicalization only. It does not establish authorization or
relay/event validity.

### 5.5 Recipient pubkey: root/profile layer

The later auction-root/profile validator additionally MUST verify:

1. the value satisfies the selected Nostr/secp256k1 x-only public-key validity
   rule;
2. the referenced payout-capability event has a valid signature; and
3. the capability event author equals `recipient_pubkey`.

### 5.6 Event ID

Exactly 64 lowercase hexadecimal characters representing the exact signed
event ID. Coordinates and “latest” replacement references are invalid
substitutes.

### 5.7 Canonical unsigned decimal integer

```abnf
canonical-zero = "0"
canonical-positive = %x31-39 *DIGIT
canonical-uint = canonical-zero / canonical-positive
canonical-positive-uint = canonical-positive
```

Signs, leading zeroes, fractions, exponent notation, whitespace, and empty
strings are invalid.

### 5.8 Basis points

At the semantic layer, `allocation_bps` is an integer:

```text
validator: 0..10000
v4v:       1..10000
```

The total auxiliary allocation MUST be at most 10,000.

### 5.9 Schedule index

A zero-based canonical unsigned integer derived after sorting. For `N` rows,
serialized indexes are exactly `0..N-1` in order.

### 5.10 Fixed V1 resource limits

The V1 schedule contains between 1 and 16 auxiliary entries.

For hostile parsing, `bytes.length` MUST be at most 4,096. This check occurs
before UTF-8 decoding, byte scans, line splitting, header parsing, or allocation
based on declared fields.

For compilation, `source_entries.length` MUST be at most 16 before per-entry
validation. The exact serialized canonical schedule MUST be at most 4,096 bytes
before commitment computation.

Under all V1 invariants, the largest valid 16-entry all-validator schedule is
3,449 bytes. Nine allocation fields may contain four digits and seven may
contain three digits while total auxiliary allocation remains at or below
10,000 basis points. Together with the fixed row fields, indexes, header, and
line endings, this leaves 647 bytes below the raw-input ceiling.

Implementations MUST NOT raise either V1 limit while continuing to identify the
data as the same V1 wire format. Expansion requires a new schedule version or
profile.

## 6. Semantic source-entry schema

Source entries are semantic objects, not six-column wire rows.

### 6.1 Source validator entry

Required fields:

```text
role = "validator"
recipient_pubkey
payout_capability_event_id
allocation_bps
validator_offer_event_id
```

`validator_offer_event_id` MUST be an exact lowercase 64-hex event ID.

### 6.2 Source V4V entry

Required fields:

```text
role = "v4v"
recipient_pubkey
payout_capability_event_id
allocation_bps
```

`validator_offer_event_id` MUST be absent. A source value of `"-"` is invalid;
the dash is canonical wire framing only.

### 6.3 Source field handling

A compiler MUST reject missing required fields and MUST reject role-specific
fields forbidden by this schema. Unknown-field handling is deferred to the
later root-event schema, which defines the concrete source container.

## 7. Multiparty profile dispatch

The multiparty schedule MUST contain at least one auxiliary entry. A seller-only
auction uses `cashu_p2pk_bidder_path_v1` instead.

This requirement belongs to profile dispatch, not to generic allocation
arithmetic.

## 8. `compile_source_schedule(source_entries)`

Compilation MUST execute in this order:

1. apply multiparty profile dispatch and reject an empty schedule;
2. reject more than 16 source entries as
   `schedule_entry_count_exceeds_limit`;
3. validate the section 6 semantic source-entry schema;
4. reject unknown roles and non-canonical primitives;
5. require an exact validator-offer ID for every validator;
6. require `validator_offer_event_id` to be absent for every V4V source entry;
7. require positive V4V bps and permit zero-fee validators;
8. reject duplicate `(role, recipient_pubkey)` entries;
9. reject any `recipient_pubkey` reused across roles as
   `schedule_recipient_reused_across_roles`;
10. reject total auxiliary bps above 10,000;
11. sort by `(role_order, recipient_pubkey_bytes)`;
12. derive sequential indexes;
13. serialize section 11 exactly;
14. reject canonical output longer than 4,096 bytes as
    `schedule_bytes_exceeds_limit`; and
15. compute section 12's commitment.

No Unicode, case, integer, pubkey, event-ID, or URL normalization is performed.
Inputs must already be canonical.

## 9. `parse_canonical_schedule(bytes)`

A parser consumes hostile bytes and MUST independently re-enforce all schedule
rules.

### 9.1 Deterministic error precedence

A parser MUST evaluate failures in this order and return the first applicable
failure:

1. reject raw input longer than 4,096 bytes as
   `schedule_bytes_exceeds_limit`;
2. reject an initial UTF-8 BOM as `schedule_bom_forbidden`;
3. reject any CR byte as `schedule_cr_forbidden`;
4. reject any byte above `0x7f` as `schedule_non_ascii`;
5. reject a missing final LF as `schedule_final_lf_missing`;
6. parse the first LF-terminated line as the header;
7. require exactly four TAB-separated header columns, otherwise
   `schedule_header_column_count_invalid`;
8. validate the profile, object type, and version in that order;
9. validate `entry_count` as a canonical positive unsigned decimal integer,
   distinguishing noncanonical form from zero;
10. compare the canonical decimal string against 16 and reject a larger value
    as `schedule_entry_count_exceeds_limit` before numeric conversion or row
    allocation;
11. locate exactly `entry_count` subsequent LF-terminated row slices;
12. if fewer declared row slices exist, return
    `schedule_entry_count_mismatch`;
13. if any declared row slice is empty, return
    `schedule_blank_line_forbidden`;
14. if any byte remains after the declared rows, return
    `schedule_trailing_bytes` without inspecting the remainder;
15. require six TAB-separated columns for every declared row;
16. validate, in order, index grammar, role, recipient pubkey, capability
    event ID, basis-point grammar/range, and role-specific offer field;
17. validate sequential indexes;
18. reject duplicate `(role, recipient_pubkey)` entries;
19. reject any `recipient_pubkey` reused across roles as
    `schedule_recipient_reused_across_roles`;
20. reject total auxiliary allocation above 10,000;
21. verify canonical role/pubkey ordering; and
22. compute section 12's commitment.

The parser MUST bound `entry_count` without first converting an unbounded
decimal string to a JavaScript `number` or equivalent fixed-width numeric type.
After canonical grammar and zero checks, one decimal digit is within range; two
digits are within range only when lexically at most `16`; any longer string
exceeds the limit. Numeric conversion may occur only after that proof.

A blank slice inside the declared row set is
`schedule_blank_line_forbidden`. A blank line, complete row, or malformed byte
sequence after the declared rows is `schedule_trailing_bytes`.

The raw byte limit precedes every other parser failure. Surplus data is rejected
before declared-row semantic validation. Therefore, when surplus bytes coexist
with an invalid declared row, `schedule_trailing_bytes` takes precedence.

The parser MUST NOT parse surplus attacker-controlled bytes merely to select a
more specific failure. After a successful parse, implementations SHOULD
reserialize as an internal assertion. Any mismatch is an implementation defect,
not a distinct wire-protocol failure.

### 9.2 Independent semantic validation

Parser-side validation MUST NOT assume that compiler-side validation occurred.
It independently enforces unknown-role rejection, lexical pubkey and event-ID
rules, validator/V4V offer rules, role allocation ranges, same-role duplicate
rejection, cross-role recipient uniqueness, total allocation, indexes, and
ordering.

Sequential indexes alone do not prove canonical row order. The fixed schedule
limits close this packet's codec resource-limit decision, but production parsing
and profile activation remain prohibited pending focused approval and the
remaining wire packets and their resource limits.

## 10. Zero-fee and zero-delta boundary

A zero-fee validator:

- remains in the immutable root schedule with zero bps;
- remains bound through its exact capability snapshot, exact offer snapshot,
  and exact-root acceptance;
- has a zero-amount logical manifest leg for each additive increment;
- emits no Cashu proofs for that zero-valued leg; and
- is excluded from positive-payout redemption-completion requirements.

Any other schedule entry may also receive a zero delta for a particular
increment because allocation is cumulative. Its logical leg remains, but later
manifests MUST NOT fabricate zero-value Cashu outputs or proofs.

The exact logical-manifest encoding is deferred.

## 11. Canonical schedule grammar

### 11.1 Header

```text
cashu_p2pk_bidder_path_multiparty_v1<TAB>payout_schedule<TAB>1<TAB><entry_count><LF>
```

`entry_count` is a canonical positive unsigned decimal integer in the range
1 through 16 and equals the number of following rows exactly.

### 11.2 Entry row

```text
<schedule_index><TAB><role><TAB><recipient_pubkey><TAB><payout_capability_event_id><TAB><allocation_bps><TAB><validator_offer_event_id-or-dash><LF>
```

For `validator`, the final field is the exact offer event ID. For `v4v`, it is
the single ASCII byte `-`.

The dash is not a semantic source value.

### 11.3 Exact framing

Canonical bytes:

- use only the ASCII subset of UTF-8;
- use TAB byte `0x09` and LF byte `0x0a`;
- contain one header and exactly the declared row count;
- contain no BOM, CR, blank line, or extra column;
- end with the required LF of the final declared row;
- contain no byte after that LF; and
- contain at most 4,096 bytes in total.

## 12. Schedule commitment

Let `S` be the exact canonical schedule bytes.

```text
preimage =
  UTF8("cashu_p2pk_bidder_path_multiparty_v1:payout_schedule_commitment:v1")
  || 0x00
  || S

schedule_commitment = lowercase_hex(SHA256(preimage))
```

Any mismatch fails with `schedule_commitment_mismatch`.

Fixture metadata represents the separator without an escaped pseudo-NUL:

```json
{
	"hash": "sha256",
	"domain_separator_utf8": "cashu_p2pk_bidder_path_multiparty_v1:payout_schedule_commitment:v1",
	"separator_hex": "00",
	"preimage_prefix_hex": "<UTF-8 domain bytes followed by 00>"
}
```

Consumers MUST hash the bytes represented by the structured fields or use the
supplied exact preimage hexadecimal value. They MUST NOT append the literal
characters `\\u0000`.

## 13. Later index references

A later structure may carry `schedule_index`, but it MUST resolve the index to
the exact canonical root entry. An index is not standalone identity or
authority.

## 14. Failure stages and draft codes

Every negative vector MUST identify one of these operations:

```text
compile_source_schedule
parse_canonical_schedule
validate_schedule_commitment
```

A vector is coverage for its declared operation only.

| Code                                               | Meaning                                    |
| -------------------------------------------------- | ------------------------------------------ |
| `schedule_empty`                                   | Multiparty profile has no auxiliary entry  |
| `schedule_bytes_exceeds_limit`                     | Raw/canonical schedule exceeds 4,096 bytes |
| `schedule_header_column_count_invalid`             | Header does not contain four fields        |
| `schedule_header_profile_mismatch`                 | Header profile literal differs             |
| `schedule_header_object_mismatch`                  | Header object literal differs              |
| `schedule_header_version_unsupported`              | Header version differs                     |
| `schedule_entry_count_noncanonical`                | Count violates positive decimal grammar    |
| `schedule_entry_count_zero`                        | Multiparty count is zero                   |
| `schedule_entry_count_exceeds_limit`               | Count is greater than 16                   |
| `schedule_entry_count_mismatch`                    | Fewer complete rows exist than declared    |
| `schedule_bom_forbidden`                           | Input starts with a UTF-8 BOM              |
| `schedule_cr_forbidden`                            | Input contains CR                          |
| `schedule_non_ascii`                               | Input contains a byte above `0x7f`         |
| `schedule_final_lf_missing`                        | Input does not end with the required LF    |
| `schedule_blank_line_forbidden`                    | A declared row slice is empty              |
| `schedule_column_count_invalid`                    | A declared row does not contain six fields |
| `schedule_role_unknown`                            | Role is unknown                            |
| `schedule_recipient_pubkey_noncanonical`           | Recipient lexical encoding is invalid      |
| `schedule_capability_event_id_noncanonical`        | Capability ID encoding is invalid          |
| `schedule_validator_offer_missing_or_noncanonical` | Validator offer is absent or invalid       |
| `schedule_v4v_offer_forbidden`                     | V4V source/row contains an offer value     |
| `schedule_allocation_bps_not_integer`              | Semantic bps is not an integer             |
| `schedule_allocation_bps_out_of_range`             | Bps lies outside the role range            |
| `schedule_v4v_zero_allocation`                     | V4V entry has zero bps                     |
| `schedule_duplicate_role_recipient`                | Same role and recipient appears twice      |
| `schedule_recipient_reused_across_roles`           | Recipient pubkey appears under both roles  |
| `schedule_auxiliary_allocation_exceeds_10000`      | Seller remainder would be negative         |
| `schedule_integer_noncanonical`                    | Serialized bps violates integer grammar    |
| `schedule_index_noncanonical`                      | Serialized index violates integer grammar  |
| `schedule_index_not_sequential`                    | Index sequence differs from `0..N-1`       |
| `schedule_row_order_noncanonical`                  | Role/pubkey row order is not canonical     |
| `schedule_trailing_bytes`                          | Any byte remains after the declared rows   |
| `schedule_commitment_mismatch`                     | Claimed commitment differs                 |

## 15. Conformance vectors

The companion fixtures include:

- source-order invariance;
- same-role pubkey-byte ordering;
- zero-fee validator membership and logical zero legs without Cashu proofs;
- valid exact 10,000 auxiliary bps and zero seller remainder;
- exact canonical UTF-8, hexadecimal bytes, preimages, and commitments;
- source V4V dash rejection;
- hostile-byte size, header, count, framing, primitive, semantic, duplicate,
  cross-role, aggregate-allocation, ordering, and commitment failures;
- exact 16-entry all-validator and mixed-role count-boundary vectors;
- the 3,449-byte maximum-valid-schedule vector and 4,096/4,097-byte hostile
  parser boundary vectors;
- fixture coverage for every failure code defined by this packet across its
  applicable compilation, canonical-parsing, or commitment-validation stage;
- a parser-precedence suite covering important adjacent compound-fault
  boundaries; and
- separate declared-row and surplus-blank-line behavior.

Fixture consumers compare exact bytes, not parsed object equivalence. Aggregate
failure-code coverage MUST NOT be described as parser-only coverage.

## 16. Explicitly deferred decisions

This packet does not decide:

- mint identifier grammar;
- payout-capability event kind;
- validator-offer or acceptance kinds;
- xpub encoding and derivation paths;
- bid-manifest structure;
- token/proof transport;
- settlement and recipient-confirmation events;
- NUT-06/NUT-7 evidence rules; or
- expiry, replay, conflict, and compromise semantics.

## 17. Implementation prohibition

No production parser, wallet mutation, relay publication, UI integration, or
auction workflow change is authorized by this proposal. Production work remains
gated on focused approval, completion of the remaining wire sections, and their
proof, token, event, query, and lifecycle resource limits.
