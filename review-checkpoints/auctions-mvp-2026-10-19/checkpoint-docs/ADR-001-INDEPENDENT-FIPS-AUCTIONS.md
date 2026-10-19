# ADR-001: Independent FIPS-meshed auctions with bounded Cashu settlement

Status: **Accepted by owner — implementation, release, and deployment evidence pending**  
Date: 2026-10-16 UTC

## Authority and scope

`FROZEN_DECISION`: Sentinel_f073d0a0c4e081919cad55a93c072bd7 at 2026-10-16T16:00:34Z: “The status is accepted. I just wanted to have the ADR written so there is not drift from the system design and architecture”. This accepts the core architecture below. It does not select incomplete parameters, prove implementation, close compatibility gates, or authorize release, activation, or deployment.

## Accepted architecture

Four independently operated, continuously available (24/7 target) VPS nodes form an equally weighted CometBFT validator set over FIPS (Free Internetworking Peering System), with at most one Byzantine maintainer. This does not protect against three- or four-maintainer collusion and is not a claim of trustlessness, anonymity, or atomic consensus/mint finality. The mint remains trusted for issuance and first-spend enforcement.

Nostr is discovery/bootstrap only. Relay data, adverts, endpoints, and traversal metadata are untrusted; discovery grants no FIPS admission, Comet transport, voting power, auction authority, payment membership, or administration. A signed monotonic roster and default-deny policy map distinct FIPS node, Comet node, validator, auction actor, bidder Cashu/refund, FROST group/share, recipient, and admin identities. The reviewed candidate pin is FIPS v0.5.2 commit `53a3ec4b2fbaceb7009dd4fbe6974b011e452ae5`; deployment must freeze its actual pin and topology.

CometBFT orders bounded deterministic admission, bid/rebid, close, winner/loser disposition, authorization, ambiguity, and terminal evidence. Consensus code performs no relay, HTTP, mint, wallet, DKG, FROST-round, or wall-clock I/O. Close uses committed consensus height/time and canonical sorted processing. Prior PBTS/version assumptions and experimental 300-second/1,800-second soft-close values are provenance, not accepted policy.

Admission requires bidder-signed auction/bid identity, exact branch templates, mandatory DLEQ, and authenticated evidence that every proof is `UNSPENT`. Validators deterministically verify bounded evidence and atomically reserve the whole canonical proof-Y set globally; overlap admits at most one owner with no partial reservation. Reserved collateral must never be released or reused while an old valid authorization could still consume it. Release requires exact branch terminal evidence. Admission expiry horizon, locktime comparison, and target-mint clock assumptions are implementation parameters.

## Cashu authorization and evidence boundary

MAIN is NUT-11 `SIG_ALL` bidder-plus-committee 2-of-2: one bidder BIP340 signature and one committee aggregate BIP340 signature produced by FROST threshold 3-of-4. One unavailable member may be excluded; two block MAIN. The bidder can go offline after authorizing the exact signed surface and recovery capabilities.

At pinned `cashubtc/nuts@8bde3c0c3684430d852ab543ac8ca72913770dc0`, swap `SIG_ALL` signs, in transaction order, each input's `secret || C` and each output's `amount || B_`. It does **not** sign the output keyset id, auction/chain/operation identity, role, or recipient mapping. Those fields belong to a versioned application envelope. The envelope must authenticate the role-to-output mapping while preserving the recipient-private opening; validators and FROST participants refuse drift before signing. The committee cannot alter signed amounts or blinded outputs without invalidating the bidder signature, and bidder preauthorization does not bind the auction outcome at the mint.

However, a completed-witness holder can change an unsigned output keyset id after aggregation and submit directly to the mint. An application envelope, local proxy, or process fence cannot cryptographically prevent that direct submission. Release therefore requires a documented target-mint-enforced constraint or an explicitly accepted economic-equivalence rule, with compatibility tests. This remains a gate, not a silently selected mint trust model.

Pre-locktime early return is a distinct, unimplemented committee-authorized path with its own state and template. Expiry recovery is a separate bidder refund-key path without FROST. Under pinned NUT-11, after mint-local locktime expiry the main and refund pathways can both remain valid; delayed MAIN and REFUND therefore retain a conditional first-spend race. A refund win does not rewrite the canonical winner and is never `seller_paid`.

State distinguishes authorization, `not_submitted`, `submitted_unknown`, and branch-specific completion. FROST authorization is not submission; `SPENT` does not identify a branch; consensus inclusion is not external truth. Completion requires the exact mint response and authenticated recipient-import evidence from a versioned evidence authority.

## Recovery and implementation/release gates

Validator/FROST recovery requires canonical state, durable monotonic signing/nonce transitions, ambiguity burn, and fresh sessions/nonces on retry. A local lifetime lock cannot fence a cloned key on another VPS. Automatic cross-host restore or failover is forbidden until the old signing authority is demonstrably disabled; rollback or uncertainty fails closed. Admin/RPC remains private, authenticated, authorized, audited, and never a source of auction/payment truth.

The accepted core remains gated on:

1. Signed-roster trust root, rotation/revocation, validator transitions, and both strict FIPS link admission **and** routed source/port enforcement.
2. Versioned external-evidence authority, schemas, freshness, equivocation handling, and exact terminal retention.
3. Exact BIP340 FROST/DKG profile, durable nonce design, and all-3-of-4-subset interoperability.
4. Target versions/time semantics, collateral horizon, mint/keyset compatibility, early-return behavior, topology, restart/failover policy, and bounded live tests.

None of these mechanisms is claimed to exist merely because the architecture is accepted.

## Evidence and activation boundary

`SUPPLIED_CLAIM`: frozen inputs report reviewed local payment components, 107 tests/517 assertions, fix16 with `Restart=no`, and local artifact pins. The interrupted independent-validator draft lacks a final manifest and completed review. `VERIFIED_LOCAL`: this task verified document bytes only. Unproved: integrated CometBFT/global reservation, four-node replay, provisioned FIPS nodes, dealerless DKG/real signing, keyset-mutation handling, live mint race/reconciliation, recipient receipts, safe cross-host recovery, deployment, and 24/7 behavior.

## Evidence appendix

- R1 canonical ADR: `e44e07f9a57a6efee0d578aceb3a442800c17f2e2d0542bc0f9a5f5bc552ab9c` (preserved unchanged).
- Integrated Proposed ADR / Red Team / A0: `868b9225495bf53cb3e4681ad30fc1b3ebf2a103419a6b4849e10e5db11d4f59`, `c4efcca6b40ca026bd30ba03153f2440d55e3d7f46b815bf40f03c0e76dcd107`, `d48b8f8e24f86981e5be51fd219e8d3bafd95b7fd9167fd502fc58d85cd25caf`.
- Independent bundle manifest and three files: `257f8cd4ad30a77f44d9e568f2bf542666eeec80e5792be241e58e730eae6d2c`, `243127b193ee17ecb5476dd73badad5c9935f69334c71ac7ffbdc8b4dba5eda0`, `587da4e9aa8567a2c7171a52b04761b2691e485d8fd1bb1f0b7238d2a16bb2c1`, `e0a0cbe80079c12bec0f300adc43dba529f501e203f31fcef8a1970ccfcd26f9`.
- `VERIFIED_SPEC`: [NUT-11 at pinned commit](https://github.com/cashubtc/nuts/blob/8bde3c0c3684430d852ab543ac8ca72913770dc0/11.md), retrieved 2026-10-16.
- `SUPPLIED_CLAIM`: A0 reports frozen A2 `01a14571-2b0d-70d5-be96-0f219e151000` and A3 `01a14571-5c65-7768-9e09-a3d72f21e028` both block readiness, not the accepted core.

These inputs and reviews do not transfer approval to new implementation or release bytes.
