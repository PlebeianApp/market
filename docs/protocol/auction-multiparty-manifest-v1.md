# Auction Multiparty Payout Manifest and Release — Wire Packet (D2)

## 1. Status and provenance

**Status:** Proposed — implementation slice 1, maintainer-authorised 2026-09-22
**Profile:** `cashu_p2pk_bidder_path_multiparty_v1`
**Companion:** `docs/protocol/auction-multiparty-v1.md` (the schedule packet)
**Scope:** the root schedule tags, the per-entry payout manifest carried by a bid
(kind 1023), and the release binding (kind 1025)

The schedule packet fixes the payout schedule and its commitment. This packet fixes
what the profile's deferred rows call "manifest encoding" and "per-recipient locks":
how a bid states which child key each payout leg was locked to, and how a release
proves those child keys derive from the announced xpubs.

## 2. Root tags (kind 30408)

A multiparty root is a single-party root with three differences:

```
['settlement_policy', 'cashu_p2pk_bidder_path_multiparty_v1']
['payout_schedule', '<base64url-nopad canonical schedule bytes>']
['payout_schedule_commitment', '<64 lowercase hex>']
```

`p2pk_xpub`, `mint`, `auditors`, `auditor_quorum` and `schema` keep their existing
meaning; `p2pk_xpub` remains the **seller's** xpub. An auction with no auxiliary
entries MUST NOT use this profile — it uses `cashu_p2pk_bidder_path_v1`.

`v4v_recipient` tags are not part of this profile and MUST NOT be emitted
(maintainer direction 2026-09-22).

## 3. Payout manifest (kind 1023)

A multiparty bid MUST carry:

```
['payout_schedule_commitment', '<64 lowercase hex>']   # the root schedule it binds to
['payout_manifest', '<base64url-nopad canonical manifest bytes>']
['payout_manifest_commitment', '<64 lowercase hex>']
```

`path_commitment` MAY also be carried (section 5).

### 3.1 Index space

The schedule contains auxiliary entries only; the seller is implicit. The manifest
makes every payout leg explicit:

- **manifest index 0 is the seller**, whose xpub is the root's `p2pk_xpub`;
- **manifest index `i + 1` is schedule entry `i`**, in canonical schedule order.

The mapping is derived, never serialised twice, and a manifest that violates it
fails parsing.

### 3.2 Grammar

Header:

```
cashu_p2pk_bidder_path_multiparty_v1<TAB>payout_manifest<TAB>1<TAB><row_count><LF>
```

Row:

```
<manifest_index><TAB><role><TAB><recipient_pubkey><TAB><child_pubkey><TAB><amount_sats><LF>
```

- `role` is `seller`, `validator` or `v4v`. Only index 0 may be `seller`, and its
  `recipient_pubkey` MUST equal the root seller.
- `recipient_pubkey` is the exact 64-lowercase-hex pubkey from the schedule (or the
  seller at index 0).
- `child_pubkey` is the P2PK lock pubkey for that leg: `derive(payout_xpub, shared_path)`.
- `amount_sats` is a canonical positive unsigned decimal integer.

Framing is identical to the schedule packet: ASCII subset only, TAB and LF, no BOM,
no CR, no blank line, exact row count, complete-byte consumption, final LF required.

### 3.3 Limits

- row count is **1 to 17** (seller plus at most 16 auxiliary entries);
- raw and canonical manifest bytes are each capped at **4,096**.

The largest valid manifest is 17 rows: header plus 17 rows of the widest fields is
2,674 bytes, leaving 1,422 bytes of margin below the cap.

### 3.4 Validity rules

- exactly one `seller` row, at index 0;
- indexes are exactly `0..row_count-1` in order;
- `child_pubkey` values are pairwise distinct — a leg must not share a lock key with
  another leg;
- `recipient_pubkey` values are pairwise distinct, mirroring the schedule's
  cross-role uniqueness;
- every `amount_sats` is a positive canonical integer;
- the manifest's auxiliary rows are in canonical schedule order, so a verifier can
  check row `i + 1` against schedule entry `i` without re-sorting.

### 3.5 Commitment

```
preimage =
  UTF8("cashu_p2pk_bidder_path_multiparty_v1:payout_manifest_commitment:v1")
  || 0x00
  || canonical_manifest_bytes

payout_manifest_commitment = lowercase_hex(SHA256(preimage))
```

## 4. Release binding (kind 1025)

The existing release tag `derivation_path` already carries the shared path. A
multiparty release MUST additionally carry:

```
['payout_schedule_commitment', '<64 lowercase hex>']
['payout_manifest_commitment', '<64 lowercase hex>']
```

so a release cannot be replayed against a different schedule, a different manifest,
or a different bid. `path_commitment` MUST be carried when the bid carried it
(section 5).

### 4.1 How a leg's rows travel (added 2026-09-25)

A leg is **one bid that locked N outputs**, so one release event carries the whole
leg, and the manifest is already an indexed list. The row tags are therefore
repeated **in manifest index order**:

```
['child_pubkey', '<row 0 x-only>']
['child_pubkey', '<row 1 x-only>']
…
['cashu_token', '<row 0 token>']     # optional as a group; see below
['cashu_token', '<row 1 token>']
…
```

A reader matches them positionally against the manifest's rows. Two rules make the
counts checkable rather than assumed:

- if any `child_pubkey` tag is present there MUST be **exactly one per manifest row**,
  and a release whose row count disagrees with the manifest is refused — not partially
  accepted, because a leg that settles from three rows of four paid three of its four
  recipients;
- `cashu_token` MAY be absent entirely (a synthetic or non-redeemable release, as
  §4 already allows for the single-party case) or present **exactly once per row**;
  emitting it for some rows and not others is refused, since the release either
  redeems every row or none.

Splitting a release across N events is deliberately not the shape: every event would
repeat the same commitments, a missing one would be indistinguishable from "not
released yet", and "all rows released or none" would stop being checkable on one event.

## 5. Path commitment (optional, recommended)

```
path_commitment = lowercase_hex(SHA256(
  UTF8("cashu_p2pk_bidder_path_multiparty_v1:payout_path_commitment:v1") || 0x00 || UTF8(derivation_path)
))
```

A bid that carries `path_commitment` commits to its path **before** the release, so
the path cannot be chosen adaptively after the bids are visible. It does not replace
the derivation check in section 6 — it only fixes the path earlier.

## 6. Verification

At release, for every manifest row:

1. `derive(row.payout_xpub, derivation_path) == row.child_pubkey`, where
   `payout_xpub` is the seller's `p2pk_xpub` for index 0 and the scheduled entry's
   announced `payout_xpub` otherwise;
2. the leg's locked proofs are P2PK-locked to `row.child_pubkey` (separate proof
   verification, ADR-0011);
3. `amount_sats` per row sums to the released leg total.

A row whose derivation does not reproduce its `child_pubkey` is **grief** (see
`docs/adr/proposals/auction-v4v-participation.md` D7). Verification is required for
**every** row, not only for rows the verifier has an interest in.

## 7. Failure codes

| Code                                                                      | Meaning                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `manifest_empty`                                                          | No rows                                                      |
| `manifest_bytes_exceeds_limit`                                            | Raw or canonical bytes above 4,096                           |
| `manifest_row_count_exceeds_limit`                                        | More than 17 rows                                            |
| `manifest_header_column_count_invalid`                                    | Header is not four fields                                    |
| `manifest_header_profile_mismatch`                                        | Profile literal differs                                      |
| `manifest_header_object_mismatch`                                         | Object literal differs                                       |
| `manifest_header_version_unsupported`                                     | Version differs                                              |
| `manifest_row_count_noncanonical`                                         | Count violates canonical integer grammar                     |
| `manifest_row_count_mismatch`                                             | Fewer complete rows than declared                            |
| `manifest_bom_forbidden` / `manifest_cr_forbidden` / `manifest_non_ascii` | Byte-level framing                                           |
| `manifest_final_lf_missing`                                               | No trailing LF                                               |
| `manifest_blank_line_forbidden`                                           | An empty row slice                                           |
| `manifest_trailing_bytes`                                                 | Bytes remain after the declared rows                         |
| `manifest_column_count_invalid`                                           | A row is not five fields                                     |
| `manifest_index_noncanonical` / `manifest_index_not_sequential`           | Index grammar / sequence                                     |
| `manifest_role_unknown` / `manifest_role_seller_not_first`                | Role rules                                                   |
| `manifest_recipient_pubkey_noncanonical`                                  | Recipient encoding invalid                                   |
| `manifest_child_pubkey_noncanonical`                                      | Child key encoding invalid                                   |
| `manifest_amount_not_positive_integer`                                    | Amount is not a positive canonical integer                   |
| `manifest_child_pubkey_reused`                                            | Two rows share a child key                                   |
| `manifest_recipient_reused`                                               | Two rows share a recipient                                   |
| `manifest_row_order_noncanonical`                                         | Auxiliary rows out of schedule order                         |
| `manifest_commitment_mismatch`                                            | Claimed commitment differs                                   |
| `release_schedule_commitment_mismatch`                                    | Release binds a different schedule                           |
| `release_manifest_commitment_mismatch`                                    | Release binds a different manifest                           |
| `release_path_commitment_mismatch`                                        | Path does not match the committed path                       |
| `release_derivation_mismatch`                                             | A row's child key does not derive from its xpub and the path |

## 8. Explicitly deferred

- how a recipient learns its path (delivery is the release plus discovery);
- proof-level verification of the lock (ADR-0011, NUT-12);
- multi-mint payout construction and its journal (gates E/F);
- settlement, redemption isolation and fallback behaviour (gates H/I/J);
- the draft-time liveness probe (D13) and presence (issue #1328).
