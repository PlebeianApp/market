# Friday FROST + FIPS Integration Inventory

Updated: 2026-10-21 UTC. This is a read-only compatibility inventory and a
bounded implementation plan. It is **not** an acceptance, deployment plan, or
claim that the Friday candidate currently uses FROST or FIPS.

## Current status

The current Friday branch still implements custodial server-held wallets and
application-level reservations. It does not create per-bid NUT-11 locks and it
does not use threshold custody. The live Wednesday validators still use their
source-restricted public CometBFT P2P links; they do not use FIPS. Those facts
must remain visible until an end-to-end replacement is implemented and tested.

The new target is materially different:

- a bidder and committee authorize each Cashu NUT-11 spend as 2-of-2 with
  `SIG_ALL`;
- the one committee signature is a real BIP340-compatible FROST 3-of-4
  aggregate from four separately enrolled participants; and
- validator P2P traffic uses jmcorgan/fips. “FIPS” here means Free
  Internetworking Peering System, not US-government cryptographic validation.

The integration status is **NO-GO** until the authority, key-placement, network
and lifecycle decisions below are approved. The sealed full-payment candidate
cannot be made executable by deleting or bypassing its guards.

## Reusable payment and FROST material

| Component | Exact provenance | What is demonstrated | Integration boundary / limitation |
|---|---|---|---|
| Threshold participant crate | Read-only `task-6/worktrees/a1-payment-frost-r2/cashu-wrapper/frost-participant-3of4`; package `coco-demo-frost-participant-3of4 0.1.0`, Rust 2021, minimum Rust 1.86 | Dealerless four-participant DKG; signing with an exact three-member subset | DKG needs all four participants. DKG, credential placement and real keyset signing were separately gated. The source has not been copied into this POC. |
| FROST implementation | `frost-secp256k1-tr=3.0.0`; `frost-core=3.0.0`; `frost-rerandomized=3.0.0`; `k256=0.13.4` with Schnorr; `chacha20poly1305=0.10.1`; other versions pinned in that tree's `Cargo.lock` | Real threshold commitments, shares, BIP340 aggregate verification and all four 3-member subsets in focused evidence | Reuse requires preserving exact policy, participant identity, session and transcript binding. It is not safe to replace this with simulated signatures. |
| Built participant binary | Read-only binary SHA-256 `5c7f72db189443f97c02d58aaa136f7f1942ccfc9d7fc8307a9e6c38e76dd7b6`; protocol `COCO_DEMO_FROST_PARTICIPANT_3OF4_V1` | Separate-process participant command surface | A historical binary is evidence, not an automatically authorized executable dependency. Its source/build identity must be verified before this POC runs it. |
| TypeScript process boundary | `demo-frost-threshold3-node.ts`, `demo-frost-threshold3-process-boundary.ts`, `demo-frost-threshold3-rust-participant-worker.ts`, `demo-frost-threshold3-rust-aggregate.ts` in the same read-only tree | Four separately enrolled transports; exact 3-of-4; fresh sessions; operation/keyset/policy/bid/proofs/recipient binding; timeout; no secret accepted at the coordinator boundary | Interfaces are reusable reference material. They are not connected to this POC coordinator, its SQLite state, or its Comet close evidence. |
| Focused FROST evidence | `R2-TEST-frost-processes.log` (18 pass, 0 fail) and `R2-TEST-frost-stdio-escalated.log` (2 pass, 0 fail) in the read-only tree | Protocol-shape, subset and child-process behavior | This is component evidence, not a Cashu mint spend, four-host DKG, or auction settlement. |
| Payment integration contract | Read-only `task-6/evidence/A1-R4-PAYMENT-V2-INTEGRATION-CONTRACT.md` | Defines bidder key B plus committee key D, `n_sigs=2`, `SIG_ALL`, refund key C and locktime; committee D is one 3-of-4 FROST aggregate, not Cashu 3-of-4 | Requires exact approval, raw signed bid, certified closure, R16 branch/mint seal and recipient capability. Current POC reservation receipts do not satisfy this contract. |
| Latest sealed R4.4.5 payment candidate | Read-only `task-3/coordination/scratch/p2r3-a1`, seal `task-3/coordination/seals/R4.4.5/R4.4.5-SEAL.md`; full manifest SHA-256 `663b0c28729edc95a71b427da81c1fbc960521f976e993696bec4f936a491160` | R4.4.5 supersedes the stale R4.4.3 reference. It changes one proof-use SQLite implementation file and adds one focused test/config; the coordinator and its authority guards are unchanged. | Explicitly unreviewed/unaccepted; expected-red and declared outcomes are not passes. It still refuses before closure persistence, identity lookup, FROST, mint or recipient effects with `storage-and-admission-authority-required`, keeps `productionReady = false`, and lacks accepted older-row/pre-restore integrity, storage-contract and composed-payment authority. P2R4T-R3B is prepared but unexecuted. It cannot be this POC's runtime without the actual acceptance path. |
| Current POC Cashu rail | Coco core pinned to commit `60b7b070393eaad8746cb74a03c42017186da647`; task-local SQLite adapter bundle SHA-256 `fd460f5b409539a12fa3b8e28b83357c51132c9ac862250daec3906d881fb285`; Nutshell 0.19.2/FakeWallet | Real zero-value mint proofs, persistent wallet reconstruction and exact recipient ownership in isolated tests | Friday reservations are custodial and not NUT-11 locks. Wednesday's NUT-11 path uses one application key, not FROST. Neither can be silently relabelled as the target. |

## Reusable FIPS material

FIPS below means jmcorgan/fips, not federal FIPS compliance.

| Component | Exact provenance | What is demonstrated | Integration boundary / limitation |
|---|---|---|---|
| FIPS package | Historical read-only inventory: FIPS `0.5.2`, revision `53a3ec4b2fbaceb7009dd4fbe6974b011e452ae5`, target `x86_64-unknown-linux-gnu`; Debian package SHA-256 `9e6c76d6a5612a8d6e0f6302b6e5d55b40cb3186ca3a4390ee72273a45e5059c` | A pinned install identity and parser/bootstrap candidate | This version has not been selected for this Friday POC and has not been inspected on the current live hosts in this phase. |
| Installed executable identities in historical evidence | `/usr/bin/fips` SHA-256 `7b26e81e2607483d46b716a330c88ee18c881e3adaefc0542909e6f2a9a287f2`; `/usr/bin/fipsctl` SHA-256 `15df75d3d9942747c62f690b0f4f5d5a2f9df45c976a96f4799a9574b988fab3`; baseline config SHA-256 `a0a9bf93aaf0fc5330df0dcb5bb62c527302c9a8a5d7297f6b7a2fd884b4fb02` | Exact historical program identity | Does not prove the four current validator hosts run these bytes or a healthy mesh now. |
| Four-validator candidate | Read-only `task-7/worktrees/a1-fips-auth-ui/fix16-reference` | Fixed per-host ULAs, public TCP 8443, exact peer/ACL checks, no clearnet protected-listener fallback, and a fail-stop run plan | README, run-plan and package test consistently select validator artifact SHA-256 `ede7ca2f1c02cd0da8245d0633ff0f0394839a182d1a81c1d8b23554550b208d`. The fix16 package was locally validated only; it was not a remote Friday deployment, and the selected bytes have not been verified on the current hosts. |
| Lifecycle | fix16 `Restart=no`, fail-stop cleanup/recovery ceremony | Fail-stop behavior is explicit rather than a decorative health signal | This conflicts with the current 24/7 validator-service expectation unless the owner selects fail-stop demonstration or separately approves and reviews a persistent lifecycle adaptation. |

Current Wednesday P2P is direct CometBFT over provider-firewall-restricted TCP
26656. Moving it to FIPS requires a deliberate network cutover: FIPS
identities and peer ACLs, public 8443 policy, internal ULA listeners, Comet peer
rewrite, no public/direct fallback, liveness checks and a rollback plan. It is
not an application-only change and is not authorized by permission to edit
local source.

## Compatibility findings

1. **The FROST primitive is compatible with the required committee key.** The
   pinned implementation produces one BIP340 aggregate from three of four
   participants, which is the committee side of Cashu's bidder-plus-committee
   2-of-2. It must sign the exact NUT-11 `SIG_ALL` digest and the bound policy
   package.
2. **The current Friday wallet model is not compatible with that payment
   contract.** An application reservation of server-held proofs does not give
   the mint a bidder-plus-committee spending condition. New FROST-backed
   auctions need freshly constructed NUT-11 proofs. Existing custodial or
   Wednesday liabilities must stay on their original routes until drained.
3. **The latest R4.4.5 sealed payment candidate supplies reference contracts, not an
   executable shortcut.** Its admission/storage/R16 guards are material safety
   boundaries. Removing them would be bypassing a stop, not completing the
   implementation.
4. **FIPS can carry the validator mesh, but it does not supply payment,
   committee or validator authority.** Consensus identities remain distinct;
   FROST shares remain a separate application authority.
5. **Both integrations introduce persistent secrets.** Four FROST participant
   shares/transports and four FIPS identities/configurations need exact
   placement, permissions, backup/retirement and incident handling. No such
   credentials have been generated by this Friday branch.

## Minimum honest end-to-end slice

1. Freeze the current custodial checkpoint as lower-level evidence and add a
   new, isolated funding mode for FROST-backed NUT-11 auctions. Do not convert
   existing rows or proofs.
2. Define one test-only authority contract that binds auction, bid, proof Ys,
   bidder key, committee keyset/version, refund key/locktime, closure, branch,
   exact outputs, recipient capability, mint, unit and `SIG_ALL` digest. Either
   accept the full storage/admission contract through its real review path or
   build a plainly separate POC contract that implements the complete authority
   properties; never import the sealed runtime with
   guards disabled.
3. Run a fresh four-participant dealerless DKG, verify the group key and four
   verifying shares, and place one share/transport identity on each separate
   participant process. The coordinator holds no share.
4. Have the bidder create a real NUT-11 lock for the full bid with its own
   signature plus the FROST group key. Verify the mint actually accepts the
   final bidder+committee aggregate for one settlement and one refund branch.
5. Admit only fully bound lock evidence into consensus. Close from committed
   time, create exactly one certified branch, obtain three fresh FROST shares,
   aggregate one signature and settle through Nutshell/Coco. Reject two shares,
   duplicate sessions, stale keysets, wrong branches, altered outputs and
   replayed proofs.
6. In a separate local four-node environment, place every Comet P2P connection
   over FIPS, demonstrate all four validators, demonstrate one validator
   offline with three signatures, and prove the protected listeners have no
   direct-clearnet fallback.
7. Combine the two only after each slice has independent real-mechanics
   evidence. Final acceptance needs proof ownership/conservation, mint
   spend-state checks, exact FROST transcript/session evidence, FIPS peer and
   listener evidence, crash recovery and complete owned-process cleanup.

## Required decisions and approvals

These are blockers, not optional polish:

1. **Authority route:** choose either (a) a new explicitly test-only POC
   authority/storage contract or (b) completion and acceptance of the sealed
   full-payment storage/admission/R16 work. Current approval does not make the
   sealed candidate accepted.
2. **FROST execution:** authorize the exact pinned source/binary after source
   identity verification, fresh four-party DKG, persistent test-only share and
   transport-credential generation, and the exact V1–V4 placement/permissions.
   Existing single-key liabilities cannot be migrated to the new group key.
3. **FIPS execution:** approve the pinned FIPS package/revision and fix16
   validator artifact (or name a replacement), verify those bytes before use,
   and authorize the listener/firewall/Comet bind and peer changes. No
   clearnet fallback should remain.
4. **Lifecycle:** choose fail-stop operator ceremony (the reviewed fix16
   posture) or approve a separately reviewed restart/recovery adaptation for
   the 24/7 expectation.
5. **Deployment boundary:** approve a later isolated local rehearsal before
   any live key placement or network cutover. Live VPS, firewall and service
   changes remain outside the current local-source authorization.

Given these blockers and the still-failing Friday crash-conservation case, no
Friday success promise is justified yet. A smaller honest demo may be possible
only after the authority and key/network decisions are made; simulated
threshold signatures, decorative FIPS status or private-network substitution
would not satisfy the target.
