# Friday Demo Status

Updated: 2026-10-23 UTC. Branch: `poc/friday-tier1-2026-10-23`, based on
`bb9a7678dbf5dec46b7cca5851d02bb1e3dfe13b`.

The frozen first candidate is commit
`2803b48bbd993cee4c30d10f42ea12a90f1dfab0`. Its evidence is preserved, but
the independent A2 review did **not** accept its aggregate Tier 1 claim. The
working tree contains the post-review corrections, newer custodial evidence,
and the current unverified integrated-payment implementation below.
It is not deployed, pushed, merged or accepted.

## Current R10 release checkpoint (2026-10-23 08:53 UTC)

The exact artifact source is
`72ddbd7f08e2a283a37ea1b54c7cc924f71f0a00`, tree
`1c20022e2533c249549415d498b5f79f6d3c6404`. R10 adds a server-enforced
recovery-only mode and persists the Coco send operation before strict DLEQ
capsule construction. The same operation is resumed after a lost response or
proof refusal; no replacement send is created. New public mutations are
blocked in recovery-only mode while exact operations already present in the
durable stores remain eligible for status, FundingAbort, terminal import/ack
and pre-issued seller-plan recovery.

Exact-current local results: Friday typecheck PASS; recovery/Coco focused
36/36 (138 assertions); browser focused 46/46 (185 assertions); restricted
Friday suite 253/255 (999 assertions), with only two OS-child `EPERM` failures;
the exact affected file passed 6/6 (38 assertions) under the normal runner; Go
all packages PASS; Rust participant 21/21; Rust inspector test/build PASS with
a zero-test target. The Go artifact embeds the exact R10 revision with
`vcs.modified=false`, and the shipped browser bundle is byte-identical to the
committed bundle.

The build receipt is `FRIDAY-CANDIDATE-R10-BUILD-RECEIPT.json`; the proposed
operator sequence is `FRIDAY-R10-NEXT-ACTION.md`; the live manifest is
`FRIDAY-R10-LIVE-ARTIFACT-MANIFEST.json`. `approval_ready` remains false. No
exact-current trusted-HTTPS browser/Coco/FIPS acceptance, fresh VPS/firewall
inventory, V2 certificate, persistent identity generation, deployment or live
fault test has run.

Activation also requires an empty, distinct R10 server/browser state boundary
and a real controlled-mint NUT-12/DLEQ canary. Missing or invalid DLEQ after a
Coco send is retained as one durable unavailable operation; R10 does not
fabricate an immediate refund. The Wednesday deployment remains untouched.

The owner subsequently changed the Friday target to include real payment and
networking integration: bidder-plus-committee Cashu `SIG_ALL`, with the
committee implemented as FROST 3-of-4, and validator P2P over jmcorgan/fips.
The current custodial-reservation implementation is therefore only a
lower-level checkpoint, not the final Friday architecture. See
`FRIDAY-FROST-FIPS-INTEGRATION-INVENTORY.md` for the bounded inventory and
current authorization boundaries.

## Current FIPS R2 checkpoint (2026-10-22 19:24 UTC)

Candidate source is frozen at
`96c81d8e23602fc9126e63cc6e05ce1f87a56ebc`; it is local-only, unpushed,
undeployed, pending independent review and unaccepted. The six application binaries now build from that
commit and are recorded with tools, locks, hashes and sizes in
`FIPS-LOCAL-LAB-R2-BUILD-RECEIPT.json`. The DKG wrapper, authenticated
admission/terminal signer service, integrated driver and isolated Nutshell
bootstrap are no longer missing source artifacts.

Final ordinary gates on the exact candidate source are: TypeScript focused
integration 102/102 across 17 files (383 assertions), Friday typecheck PASS,
Rust participant 17/17 plus participant/inspector builds PASS, Go `./...` PASS,
and the offline/locked six-artifact build PASS. One restrictive-sandbox suite
attempt recorded 100 passes and two child-stdio `EPERM` failures; the affected
file then passed 6/6 and the whole suite passed 102/102 under the approved
outside-sandbox local-process boundary. A first build-script attempt stopped
before compilation because `GOSUMDB=off` also disabled cached toolchain
authentication; the corrected script retains `GOPROXY=off` and Cargo offline
mode, and the subsequent tracked build passed.

The executable outbid flow now persists the exact bidder return authorization
before admission, separately destroys the Nostr actor, NUT-11 MAIN and
emergency REFUND keys before displacement settlement,
persists an unknown mint response, exits, then requires a fresh recovery
process to prove exact NUT-07/NUT-09 state and recipient import. Admission
proof/RPC journals are bound to the independent signer anchor; rollback of
either quarantines. The concrete policy parser rejects duplicate, missing,
extra or alternate NUT-07 proof sets. The encrypted admission store key is
re-derived from the persisted one-run coordinator identity and exact DKG/
network/roster identity, and store reconstruction is exercised before
displacement. Synchronous helpers are now owned process groups, partial-veth
cleanup is identity-tracked, staged binaries must be root-owned/non-writable,
and four-validator readiness requires a four-signature commit before V4's
verified deliberate stop. SIGINT/SIGTERM are blocked across each synchronous
helper's spawn-to-registration window; the directly owned new-session process
group is registered before the signal mask is restored and remains covered by
an outer cleanup `finally`.

Privileged FIPS execution is still **NOT_RUN**. Independent review accepted the
exact controller and pins for action-time approval presentation, and the
execution manifest is now technically `approval_ready=true`; that flag is not
owner authorization. Nothing created a namespace, capability, FIPS key, VPS
service, firewall rule or persistent credential. A fresh, literal action-time
owner approval is still required for the root-owned staging copy and one
namespace run. The current FIPS driver covers only the
outbid-return branch. Winner payout, reserve-unmet return and emergency-race
behavior remain source-level service/contract evidence, not live FIPS/mint
evidence.

## Historical integrated-payment work log (superseded)

The NOT_RUN statements in this historical section describe the source at that
time. They are superseded by the executed checkpoints later in this file and
by the current FIPS R2 checkpoint above.

The owner delegated the fake-money payment rules on 2026-10-22. The selected
normal outbid path pre-signs an exact full-pool bidder return at admission,
waits for the displacement commit plus two canonical successors, then obtains
3-of-4 committee authorization. The emergency locktime is the original end
plus the maximum 1,800-second extension plus a 900-second recovery budget;
the committee stops new MAIN authorization 300 seconds before locktime. A
previously authorized MAIN can still race the unilateral emergency REFUND;
the first valid mint spend wins and the losing branch is never freshly paid.
This is disclosed fake-money behavior, not refund priority.

Current source-only changes add:

- a certified-displacement authority and exact full-pool/keyset/zero-fee
  checks, with one global SQLite proof-Y uniqueness domain;
- a fresh dealerless 3-of-4 DKG orchestrator around the pinned Rust
  participant and a public-package inspector using the same FROST 3.0.0
  deserializer;
- a durable mutually authenticated `SignerRPCV1` codec that accepts only FIPS
  ULA endpoints and quarantines the whole signer when any request is left
  pending across a crash/restart, rather than opening a fresh nonce session;
- a consensus funding receipt whose active proof pool equals the exact current
  bid; own raises retain every old proof and add separately admitted top-up
  proofs, avoiding an unimplemented excess/remainder split; the receipt now
  binds the exact committed leader it replaces and a 300-second maximum
  admission expiry, and a signer policy reads the leader from participant-local
  consensus rather than trusting a coordinator field;
- a bounded real-DKG/three-signer live test and focused replay/conflict tests.

The authority/template regression last passed 36 tests / 0 failures before
these later additions. The newer receipt/admission, Comet-history, DKG,
signer-RPC and SQLite additions are **not yet compiled or executed** because
this task explicitly released the shared heavy test slot to the separate
Claude payment-hardening campaign. The live Wednesday demo and sealed R4.4.5
candidate remain untouched.

## Verified post-review results

| Check | Result | Evidence |
|---|---|---|
| Go consensus suite | PASS | Committed-time CheckTx, proposal/finalization, deadline/cap, invalid bids and offline-route refusal |
| Focused Friday TypeScript | PASS | `evidence/friday-typecheck-20261021T212936Z-8/manifest.json`, SHA-256 `4d298bf8a7306419997cb844a0ef6007097850f705b711d5804fdaa5b0bd08ae` |
| Friday unit suite | PASS: 27 tests, 0 failures, 83 assertions | Includes a two-child-process V2 quarantine migration/restart |
| Coco funding suite | PASS: 7 tests, 0 failures, 64 assertions | Includes exact uint64 denomination handling |
| Funding recovery suite | PASS: 6 tests, 0 failures, 17 assertions | Includes V2 faucet restore without double counting |
| Live Coco recovery | PASS: 2 tests, 0 failures, 61 assertions | `evidence/friday-fault-matrix-20261021T213633Z-1112503.json`, SHA-256 `95cbe8181b869e0a9b6ae8d8821b3b96f65bef457ae2916654467964d9e4a231` |
| Full local site flow | PASS | `evidence/friday-site-local-20261021T214020Z-1114194.json`, SHA-256 `0f8f526ce36ccb7ee1026723e152c728901d3bfd3bc20882706f98498b1d2292` |
| Public-path concurrency | PASS | `evidence/friday-concurrency-local-20261021T214548Z-1115988.json`, SHA-256 `cc93c34529cc8c96377746949cf7e12a78638466a5a73db467a042315bd76d20` |

The site flow used Nutshell 0.19.2/FakeWallet and Coco, not database-only
balances. It covered five grants to the 50k identity cap, sixth refusal,
B1000/C1500/B2000/D2500, committed-time extension, reserve-no-sale, exact
seller 2500 delivery, usable losing balances, winner debit, four commit
signers, active zero-fee inspection and exact final conservation. The
concurrency flow covered a 7k anchor followed by simultaneous 2k bids into two
auctions (exactly one success), competing own raises, and raise-versus-outbid
through the public coordinator/consensus path.

## Subprocess recovery correction and evidence

The original real subprocess crash matrix failure remains preserved. It passed
faucet kill/recovery, `payment_after_intent` SIGKILL/restart and
`payment_after_send_prepare` SIGKILL/restart, then failed the intermediate
exclusive-conservation assertion:

`payment-after-send-prepare: conservation is not exact and zero-fee`

The failed process manifest is
`evidence/friday-process-manifest-20261021T215538Z-1122933.jsonl`, SHA-256
`73086df294fc5a67f7817a9cebb3e94ca0590f8a0a5160f1142f04eb79aef9c3`.
The exact ephemeral snapshot was removed by the harness trap, so the bucket
values are unavailable and are not reconstructed here. All exact owned PIDs
from that run were absent after cleanup. Earlier failed manifests remain
preserved and unedited. The five historical `/tmp/plebeian-friday-mint.*`
roots named in the handoff were not deleted.

The failure was an observation-model error, not proof loss or duplication.
Coco's canonical balance has distinct `spendable`,
`reserved` and `total` values. A 2,500-sat send may reserve a larger input proof
(the exercised selection was 8,192) before mint I/O because the remainder will return as
change. The coordinator incorrectly treated only Coco `spendable` as total
ownership. The corrected equation uses Coco `total` for owned backing, keeps
the payment amount in `inFlight`/`unknown`, and keeps the non-payment remainder
in an exclusive, unavailable `operationLocked` bucket. It does not turn that
change spendable or weaken ambiguous observations into a pass.

Focused result after correction: Friday unit suite PASS, 27 tests / 0 failures
/ 83 assertions; `tsc -p tsconfig.friday.json` PASS. Regressions cover
whole-proof operation locking, durable grant/payment explanation and a
separate fail-closed quarantine that cannot be counted as issuance. The V2
case now crosses two child-process boundaries and proves migrated quarantine
survives with grant zero. This is the pure migration seam, not a full encrypted
coordinator restart.

Two bounded throwaway-mint starts inside the restricted command sandbox failed
before any auction/payment action: Nutshell reached `Waiting for
application startup` but not `Mint started` within first 40 seconds and then a
240-second extended window. All owned PIDs were killed/reaped and roots
removed. Manifests:

- `evidence/friday-process-manifest-20261021T221015Z-8.jsonl`, SHA-256
  `265f9f367224420deaea0c67504aaad3cdcc7ffd5d6ee93f13e22a066c26bf52`;
- `evidence/friday-process-manifest-20261021T221657Z-8.jsonl`, SHA-256
  `259b6e0ab7596723d86fae14302291a3c29c6c89b02f0280f949b263e7dd4f71`.

The cause was the sandbox's delayed `asyncio` cross-thread wakeup: synchronous
SQLite and a worker-thread SQLite operation completed, while `aiosqlite`'s
worker result did not wake the event loop until a timer fired. A normally
approved outside-sandbox disposable diagnostic completed immediately. This was
not a bypass of a denied action; the request was approved and the original test
scope already authorized isolated local services. Details are in
`FRIDAY-SANDBOX-STARTUP-DIAGNOSIS.md`.

The final bounded outside-sandbox run now **PASSES** all six real process
boundaries: faucet result loss, payment intent, prepared send, completed mint
with lost response, durable send result and durable receive result. It proves
one 10,000 issuance, one 2,500 payment, seller 2,500, bidder 7,500, exact
conservation and zero active input fee. Its prepared audit proves the exact
selected 8,192 proof remained NUT-07 `UNSPENT` before mint I/O; the terminal
audit proves it became `SPENT`, recipient outputs total 2,500 and remain
NUT-07 `UNSPENT`, and neither operation identity was duplicated. That original
audit did not compare sender bearer-token proofs to the receiver's stored input
tuple. The later stalled-mint audit closes that gap with an exact, bearer-safe
canonical proof-Y/immutable-tuple lineage digest. Stored reconstruction data
supports the recovery outcome; it is not a captured NUT-09 wire trace.

Primary final hashes:

- crash acceptance `cc59ab15021e46dc982b69d828de054d99745323fde039a836f6832ef2a0aee2`;
- terminal operation audit `91e7aa55f86257bcdc6f5fc9a94659aae83985f1feb0139733b6373d3843737c`;
- prepared-operation audit `29cfd757571723e923738149dd751920fc1e7c07a9278ac848d13a75f25432bf`;
- owned-process manifest `7444c60ee82d86a2e374bd9a931d1778f4ebba6d0abe7b9014318e02320610fa`;
- exclusive conservation snapshots `faad845ba1c946089413e1f49447b3121fcda0fb54c06e3b879744a99ebb656b`.

## Mint-down and phone completion

Both close-time mint faults now pass against the corrected custodial candidate
with validator four offline. With the mint stopped, three validators closed,
the seller remained unpaid/unspendable, and restarting the same Nutshell
database/seed recovered one exact 2,500 payout. Evidence:
`evidence/friday-mint-stopped-close-20261021T230112Z-1152660.json`, SHA-256
`9065a6a3f8baa66c81e4e14b583d78a313671db248b82384feee1df0edbeec3e`.
This stopped-mint evidence predates the final harness fields and later
proof-lineage audit. It supports the behavior recorded in that artifact; it
does not prove the later harness source or join the later lineage assertion.

With the mint accepting the swap and withholding its response, the bounded
status call completed in 1,288ms, conservation observed exactly 2,500 unknown
and 10,000 issued/accounted, then the same operation recovered once. Evidence:
`evidence/friday-mint-stalled-close-20261021T231651Z-1160793.json`, SHA-256
`d9bc094ce7ec60a69fe76533e2a1d81e99e285b012fd063f10e8feb4364e2720`.
Its audit proves exact send-token/receive-input lineage:
`evidence/friday-mint-stalled-close-20261021T231651Z-1160793-operation-audit.json`,
SHA-256 `3ff6aee22f79255029e0622ef49c06e59f8dbc56b74cd3354a9de8beea976a86`.
Two earlier stalled-mint harness attempts failed because the independently
queried state advanced from sending/unknown to terminal between observations;
the first emitted no numeric conservation snapshot, while the second observed
exact 10,000 issued/accounted conservation. Both reported root cleanup. Those
narrow facts are preserved in
`evidence/friday-mint-stalled-failures-20261021.json`, SHA-256
`ba412bcd0ae7c5df97531684bebd93038d54122ccacfd3c0cf2fcf6d161cf79e`,
rather than relabelled.

An actual browser rendered the full page at 390x844 with no horizontal
overflow or console warnings/errors. Panels were single-column, buttons were
at least 44px high, all controls remained visible, and the permanent
fake-money/custodial/not-FROST/not-FIPS disclosures rendered. No login, faucet,
auction, bid or fault control was invoked. The local-only offline control was
visible by design; remote refusal/hiding remains separately Go-tested. Metrics
are in `evidence/friday-phone-ui-20261021T232245Z.json`, SHA-256
`7d4579172696d88b74e7a0d39e9fcc74283a3bdd0ad1ca09ed963f89578b52f2`;
the screenshot was visually inspected but is not stored in the repository.

The final host-visible slot check found no matching Bun/TypeScript/mint/Go/Rust
or Python campaign process, verified all five current campaign roots absent and
all five historical roots still present. This is a point-in-time exact-name and
exact-root scan, not a universal descendant/replacement-process proof. Its scope is recorded
in `evidence/friday-slot-release-20261021T232433Z.json`, SHA-256
`0a82cdc1f19da8f8718dbea2f58cbd218ee0a52c42c484840b4af58b8dba6473`.

## Dependency provenance

No dependency was added in the correction phase. The repository-local
`@cashu/coco-sqlite-bun@2.0.0-plebeian-r1` remains pinned via `package.json`
and `bun.lock`; it was built from clean Coco source commit
`60b7b070393eaad8746cb74a03c42017186da647`. Tarball SHA-256:
`351b94a57a505551b179c8cbf73be1aa0eb9d77d8393aa9c32a7f9ad32c7dcdf`.
Bundle SHA-256:
`fd460f5b409539a12fa3b8e28b83357c51132c9ac862250daec3906d881fb285`.
The public-registry `@cashu/coco-sqlite-bun@2.0.0` was evaluated and removed
because its authority/findMint contracts were incompatible. There is no
`node_modules` patch.

## Current blockers

- The R2 privileged local FIPS run remains blocked pending independent review
  of the exact candidate packet, a final immutable root-staging recipe/true
  manifest hash, and a fresh action-time owner approval. No FIPS credential or
  namespace has been generated. Any four-VPS rollout remains a later,
  separately specified security/service change.
- The executable R2 lab covers cooperative outbid return only. Winner payout,
  reserve-unmet return and the emergency MAIN-versus-REFUND race still lack
  the same live Comet/FIPS/threshold/mint execution evidence.
- Latest full-payment candidate R4.4.5 remains sealed, unaccepted and outside
  this worktree. Claude's R3B campaign completed and released the shared test
  slot, but that does not accept R4.4.5 or authorize composition around its
  guards.
- The task-local SQLite adapter lacks a signed reproducible-build attestation
  and exhaustive prior-schema migration evidence. The known V2 quarantine
  transition now has a focused two-process regression, not an exhaustive
  encrypted-checkpoint migration campaign.

The Wednesday deployment, live VPS services, DNS, firewall, TLS, keys and the
separate full-payment candidate were not modified by this Friday work.

## Historical integrated fake-money source checkpoint (superseded)

While the shared heavy-test slot is explicitly released, source-only work now
defines a separate `threshold_sigall_v1` consensus funding mode. It records a
FROST-group-signed, non-bearer V2 funding manifest: globally unique Cashu proof-Y
references, full pool/bid amounts, exact zero-fee keyset, maximum-end-plus-900s
locktime, exact winner/return package digests and the bidder's pre-signature of
the full-pool return. Deterministic state retains each replacement bid and
changes a displaced funding record to `outbid_return_entitled`; an own raise
must carry forward its entire active proof pool and a close creates exactly one
payout/release entitlement. The deployed custodial route remains unchanged.

The matching TypeScript canonical encoder/verifier is
`cashu-wrapper/ts/demo-integrated-funding-receipt.ts`. A participant-local
Comet adapter now derives displacement from its own loopback RPC, the raw bid
transaction, deterministic displacement state and pinned-roster H/H+1/H+2
quorum observations; a coordinator-supplied certificate is only a value to
compare against that derivation. New Go/TypeScript tests are written
for own-raise supersession, cross-auction proof reuse, certified displacement
and close entitlement, but **none of this checkpoint has been compiled or
executed yet**. The DKG, public-package inspector, authenticated signer RPC and
participant-local authority tests also remain unrun. No positive integrated
payment or FIPS claim is made from source alone.

### Static-review repair checkpoint (unverified, 2026-10-22 UTC)

Independent review found the prior source checkpoint unfit for execution. In
response, the worktree now carries the complete admitted funding receipt into
the displacement certificate: funding operation, exact winner/return/SIG_ALL
digests, bidder/refund/committee keys, keyset version, DKG run, public-package
hash, signer-roster digest and threshold signatures. Authority compares the
actual return template to those admitted bytes, so another independently valid
template for the same proof pool is refused.

The Comet adapter now treats the ABCI query as untrusted until it re-hashes the
exact Go `json.Marshal(State)` bytes carried separately in the StateView,
obtains the advertised app hash, and matches that hash to the canonical S+1
header for query height S. Comet block/app/validator hashes and addresses are
strict uppercase fixed-size HexBytes; only transaction and ABCI value bodies
remain base64. H/H+1/H+2
still certify displacement finality; the authenticated state observation is
separate. The old fixture that placed post-displacement state at height 39
beside commits 40–42 has been corrected in source.

A non-test outbid-return composition now keeps the return-template/mint-recovery
root distinct from the Rust FROST authorization root and durably maps the two
before any signer nonce or mint call. The mapping also binds the auction,
displacement, proof pool, outputs, admission receipt, keyset, DKG/public-package
and both signer rosters. It journals conservative execution-unknown,
mint-unknown, retry-ready, recipient-pending and imported states. The actual
SIG_ALL recovery database remains the authority for whether mint I/O was
prepared, attempted, ambiguously observed, fenced safe for exact retry or
succeeded. A mint-unknown lifecycle paired with a missing or pre-mint recovery
row now quarantines instead of re-executing.
Signer RPC now takes epoch and
journal generation from durable signer metadata rather than a caller option,
binds DKG/public-package/roster identity in signed requests and responses, and
uses a separate coordinator monotonic anchor. Simultaneous rollback of both
databases remains a disclosed quarantine/key-rotation case.

Both the consensus map and the authority database normalize compressed proof-Y
references to x-only uniqueness keys, so changing only point parity cannot
claim the same proof in another auction/operation. A strict
`FipsMeshEvidenceV1` codec requires owned process/netns/socket attribution,
advancing underlay and FIPS counters, encrypted UDP observations, zero
plaintext markers and refused direct-underlay application connections. It is
an evidence contract only; no harness or traversal has run.

`test:friday`, `test:friday:integration` and `typecheck:friday` now enumerate
the new admission, composition, Comet, authority, signer, FIPS-evidence,
SIG_ALL and maintainer files. No
new test, compiler, build, mint, validator or FIPS command has run: the shared
heavy-test slot is still explicitly released to Claude. The historical 36/36
result remains historical and does not cover this repair.

The next source-only checkpoint adds a participant-local close-history verifier
and one generic terminal disposition lifecycle for exact winner payout and
reserve-unmet full-pool return. It binds the close transaction, H/H+1/H+2,
separately authenticated current state S/S+1, admitted receipt, selected branch, proof pool, recipient outputs,
DKG/public package and both rosters before threshold signing or mint I/O. The
same SQLite operation/proof uniqueness domain refuses winner-versus-return and
cross-auction proof reuse. Durable recovery/import uses the same conservative
unknown/retry/quarantine states on both close branches. A single terminal
service now selects only outbid return, winner payout or reserve-unmet return;
fixture source covers all three.

This extension is still **NOT_RUN**: no compiler, test, build, mint, validator,
Rust signer or network process has executed while the shared heavy-test slot is
released. Source now includes a task-local fork of the exact Rust 3-of-4 signer
with a separate admission-receipt domain and concrete durable TypeScript
adapter; it does not change or accept sealed R4.4.5 and does not relabel the
disposition signature. It also supplies a concrete Nostr sign/broadcast plus
Comet H/H+1/H+2 and observed S/S+1 confirmation adapter. These changes remain
uncompiled and untested. Real authenticated four-host RPC over jmcorgan/fips,
live mint execution and independent adversarial review remain blockers to any
readiness or deployment claim.

The latest source correction no longer labels the current ABCI response as the
state at event height H. H/H+1/H+2 authenticate the exact bid, displacement or
close transaction and its two successor commits; a separately observed current
state S (S >= H+2) is hashed from the application's exact canonical Go bytes and
authenticated by header S+1. Terminal branch/cause mismatch is checked before
the durable authority claim, signer nonce, mint call or recipient import. A
concrete Nostr sign/broadcast adapter now verifies the exact transaction at H,
three canonical commits and the exact active funding record in authenticated
S/S+1 state instead of treating the pre-admission leader reader as a broadcast
implementation.

Prepared refusal fixtures cover cross-domain admission replay, mutated receipt,
wrong signer roster, expired admission and zero-effect terminal branch mismatch.
Admission aggregation signs the dedicated
`SHA256("COCO_DEMO_FROST_ADMISSION_SIGNATURE_V1" || receipt_digest)` message;
the V2 receipt verifier derives the same message, so a disposition signature
over a raw 32-byte digest is not relabelled as admission authorization.
The Comet bid fixture exercises the concrete broadcast/confirmation adapter in
source. They remain **NOT_RUN**. A positive fixture that traverses the complete
terminal router, real threshold participant processes, durable mint recovery and
recipient import is still missing; the existing positive terminal fixtures stop
at verifier/SQLite authority behavior. Therefore this checkpoint does not yet
close the reviewer's runnable-composition evidence gap and must not be described
as an integrated payment execution.

### Post-0a8013 source preparation (NOT_RUN)

The next unverified source diff fixes an interoperability error in admission:
Go now verifies the exact same
`SHA256("COCO_DEMO_FROST_ADMISSION_SIGNATURE_V1" || receipt_digest)` message
that TypeScript and Rust sign. A single checked-in golden vector is consumed by
Go and Rust and referenced by the TypeScript receipt fixture. The full
Rust-produced aggregate-signature-to-Go-admission test still requires the
unexecuted Rust/live gate; a digest vector is not a substitute for that test.

Bid confirmation now treats the transaction at H as immutably committed even
if authenticated state S already shows it displaced, superseded by an own
raise, or terminal. The result carries a discriminated disposition and exact
successor/branch hint instead of reporting an admission failure merely because
H+1 changed the leader. A source fixture covers the H-to-H+1 displacement race,
but has not run.

Admission policy is now called through four ordered participant-service ports.
The threshold adapter re-runs all four participant-local derivations before a
nonce command and compares the exact evidence transcript. A persistent child
stdio boundary derives the worker PID from the OS and overrides coordinator
time with the participant clock. This is the correct local process boundary,
but the separate four-host authenticated FIPS RPC and co-location with each
remote signer key remain unimplemented and untested; coordinator-visible local
key paths are not a deployment design.

Source also adds an AES-256-GCM SQLite offline-template store and a SQLite CAS
mint-operation journal for the throwaway harness. Bearer templates are encrypted
before SQLite; the 32-byte throwaway key and mode-0600 database path remain
caller-owned. These stores have not compiled or run. A complete positive live
fixture is still blocked on wiring the real participant-local NUT-07/DLEQ
adapter, exact NUT-09 terminal recovery, recipient-private import journal and
the three actual Comet terminal histories. No in-memory or simulated substitute
was added to claim that gap closed.

When the shared heavy slot returns, the bounded non-privileged gates are, in
order: `go test -mod=readonly ./...`; from `cashu-wrapper/ts`,
`bun run typecheck:friday`, `bun run test:friday:integration`, and
`bun run test:friday:rust`. The live positive fixture command is intentionally
not listed yet because its source composition is not complete. No result from
this section is a PASS until those commands and the separate real-mint/Comet
process harness run with retained evidence and owned-process cleanup.

### Executed interoperability checkpoint (2026-10-22 UTC)

This section supersedes the earlier `NOT_RUN` statements for the ordinary
local gates, but not the remaining FIPS or full-composition gaps.

- `go test -mod=readonly ./...` passes on the repaired source (the opt-in
  external-vector test skips unless its throwaway vector is supplied).
- `bun run typecheck:friday` passes.
- `bun run test:friday:integration` passes 82 tests, 0 failures, 307
  assertions across 14 focused files. Two child-process cases initially hit
  the restricted command sandbox's signal denial; the complete suite passed
  under the normally approved local process execution boundary.
- The superset `bun run test:friday` passes 109 tests, 0 failures, 390
  assertions across 20 files.
- `cargo test --locked` for the task-local Rust 3-of-4 participant passes 17
  tests, 0 failures. The public-package inspector also builds from its new
  locked dependency graph.
- `bun run test:friday:integration:live` passes 2 tests, 0 failures, 8
  assertions. It performs a fresh four-party dealerless DKG, uses three
  distinct Rust signer invocations while withholding participant four's
  signature share, and feeds the resulting admission signature into the full
  Go funding-receipt verifier. All four harness policy services still answered;
  this run therefore proves threshold signing with one omitted share, not
  admission availability when one participant policy service is offline. Go
  also rejects a one-nibble signature mutation.
- The live bridge exposed a real bug: Rust used `Verifier::verify`, which
  SHA-256-hashed the already-derived 32-byte actor/return digests again. The
  admission-only path now uses `verify_prehash`, matching noble-secp256k1 and
  Go BIP-340 semantics. A stale live DKG fixture also dropped signed envelope
  identity fields; it now preserves the exact Rust wire envelope.
- A fresh throwaway Nutshell 0.19.2/FakeWallet+Coco SQLite run passes 2 tests,
  0 failures, 61 assertions. It proves a real 10,000 fake-sat issuance, one
  exact 2,500 transfer, manager reconstruction, exact response-loss recovery,
  recipient ownership and no duplicate send. Evidence:
  `evidence/friday-fault-matrix-20261022T144716Z-1288439.json`, SHA-256
  `6450717045f514ad2acc631fc129797b7ef27ad7be3b36b219a7fd568d6d7d20`.

These are three deliberately distinguished observations: actual Rust FROST
admission interoperability, focused Comet/authority/service fixtures, and an
actual fake-mint/Coco payment-recovery run. They are not yet one executable
admission-to-real-Comet-to-real-mint terminal flow. In particular, the Comet
HTTP tests use exact HTTP-shaped fixtures rather than live Comet nodes; the
real-mint run exercises the custodial Coco recovery rail rather than the new
SIG_ALL terminal router; participant-local evidence in the live admission
bridge is supplied by the test harness rather than four independent
mint/Comet policy workers. Actual jmcorgan/fips packet traversal remains
unexecuted and unauthorized.

### Independent interoperability review (2026-10-22 UTC)

The frozen source/evidence checkpoint is **NOT READY** for the integrated
Friday claim. The read-only adversarial review found no P0 issue and retained
the executed counts above, but identified three P1 blockers:

1. admission awaits policy responses from all four participants before using a
   threshold-three signature subset, so the live fixture is not one-participant
   availability evidence;
2. the consensus-visible admission receipt/signature does not yet bind the
   chain/network identity or the authenticated participant-policy transcript,
   leaving a cross-network replay boundary when the same committee key and
   application identifiers are reused; and
3. the direct admission signer journal lacks the independent stale-restore and
   epoch anchor required to quarantine a rolled-back/replaced signer database.

The original JSON evidence remains unedited. Its `withheld_participant: 4`
field means only that participant four's signature share was omitted. Also,
the fault-matrix `conservation.pending: 0` is the application-ledger pending
bucket at that observation point; it is not a global drainage claim because
the recoverable Coco send-operation row is still recorded as `pending`.
See
`evidence/friday-frost-admission-interoperability-20261022-CORRECTION.md`.

### Unified local threshold-payment checkpoint (2026-10-22 UTC)

The three P1 issues above were repaired and the smallest honest unified local
vertical slice now passes. This supersedes the prior statement that Comet,
policy, FROST and mint evidence existed only as separate runs; it does **not**
supersede the FIPS and terminal-branch limits below.

- A fresh Nutshell 0.19.2/FakeWallet mint created two zero-fee, mint-signed
  NUT-11 pools. Four independent participant policy processes ran; participant
  four was started and then made genuinely unavailable. The remaining three
  each re-derived local Comet/mint/pool policy before participating in a real
  Rust FROST 3-of-4 admission signature.
- Four real local CometBFT nodes committed the first bid. Validator four was
  then stopped; three validators committed the replacement bid and immutable
  displacement with three canonical signatures.
- Three separate Rust FROST participants produced the bidder-plus-committee
  `SIG_ALL` authorization for the displaced pool. Nutshell accepted exactly
  one 1,000-fake-sat swap. The response was deliberately lost; NUT-07 reported
  all six exact inputs `SPENT`, NUT-09 restored six exact outputs, and the
  bidder's recipient-private journal imported six DLEQ-verified proofs totaling
  exactly 1,000. The durable lifecycle ended `recipient_imported` and the swap
  call count was one.
- Evidence:
  `evidence/friday-integrated-frost-comet-20261022T174059Z-1380457.json`,
  SHA-256
  `89bd4a096388b758137f2652dc6e0792c7493de5a1e898bd9e31603c34b3846d`.
  It contains no bearer proofs, witnesses, openings, seeds or private keys.
- Final affected gates: Friday TypeScript 120 tests / 0 failures / 418
  assertions; focused integration 101 / 0 / 382; focused participant/NUT-07
  13 / 0 / 56; finality regression 5 / 0 / 19; live DKG/Rust-to-Go
  interoperability 2 / 0 / 10; unified live run 1 / 0 / 18; Rust
  participant 17 / 0; Go `./...` PASS; Friday scoped TypeScript typecheck PASS.

Two failures after the prior checkpoint were preserved rather than hidden:
the first exposed a too-short/concurrent canonical-commit polling strategy;
the second proved the swap committed but rejected Nutshell's allowed
`C_: null` NUT-09 response shape before import. Both were corrected without
accepting a seen/non-canonical commit, resubmitting a swap or weakening exact
output validation. Earlier failed integration artifacts are also retained.

The final hardening made all three terminal policy workers independently verify
the Comet displacement/current-state view, signed bid, active zero-fee keyset,
DLEQ, exact input proof-Y states, proof-use exclusion and their rollback anchor
before entering the Rust nonce protocol. Exact recipient proof Ys were then
verified `UNSPENT`. The durable finality digest binds immutable H/H+1/H+2
history and is stable across later authenticated S/S+1 observations.

An independent review then found that the first rollback anchor did not cover
partial restoration of the actual Rust nonce/operation journal or the separate
proof-use database. Tested source commit
`86addfda8108c50d5f8862b83919b954d5fc6e10` now hashes the real Rust safety
tree around every nonce transition and gives the proof-use store its own random
generation and monotonic revision, all pinned by the outside coordinator
anchor. First enrollment consumes a binding-specific one-use provisioning
permit; a missing established anchor can never enter that path. Focused tests
restore each store independently, delete the established anchor, and require
quarantine even if another permit file is presented.
The final evidence records that exact source commit and the POC, Rust
participant and public-inspector executable hashes.

Preserved fail-closed runs exposed and then corrected strict proof shape,
moving S-state digest, a provisional bid-slot mismatch, omitted DLEQ and exact
NUT-07 response shape. Each stopped before threshold/mint effects and cleaned
its throwaway root; none was relabelled as a pass.

This run is explicitly **not FIPS**: policy uses local stdio and consensus uses
loopback Comet processes. Winner payout, reserve-unmet return and emergency
post-locktime refund have focused service/contract coverage but were not the
terminal branch exercised in this unified real-mint run. No VPS, live demo,
sealed R4.4.5 state, firewall, credential or production endpoint changed.

### Post-R5 persistent-service preparation (2026-10-22 UTC)

This work is intentionally newer than, and outside, the frozen R5 lab packet.
It adds a fail-closed blue/green application schema, lets the authenticated
signer use only the reviewed live roots/ports, and adds a non-networked durable
coordinator queue. The queue globally excludes operation/bundle reuse, binds
its database and every row to one deployment/chain/authority identity, and
keeps a lost mint response unavailable until exact recovery and recipient
import complete. A crash during possible effects now enters `mint_unknown`
and can become `retry_ready` only when the exact recovery child proves no mint
effect; it is never treated as permission to pay again. It stores no bearer
proofs or output openings.

Focused new tests pass 7/7 (30 assertions), scoped TypeScript typecheck passes,
and the signer/coordinator standalone binaries compile. The full Friday suite
reported 137/139 in the restricted sandbox; the two process-transport cases
failed with sandbox `EPERM`. The exact affected test file then passed 6/6 (38
assertions) under the approved ordinary non-sandboxed test runner. This is not
a deployed or service-started result.

The signer enrollment file is now create-once/restart-validated, including
owner/mode/signature checks. The coordinator's unauthenticated `enqueue` CLI
was removed; its executor envelope and argv bind deployment, chain, authority,
outcome height, operation, bundle and branch, and subprocess output is bounded.
Focused post-review repair tests pass 10/10 (41 assertions), scoped TypeScript
typecheck passes, and both standalone binaries compile in a new candidate-only
directory.

That missing terminal-service seam has now been implemented in a revision
newer than R5. The trusted in-process bridge re-reads the committed authority
claim, the exact authority-to-FROST execution binding and the encrypted prior
threshold authorization before inserting one globally exclusive queue row.
Its private prepared reader and independent rollback anchor are fixed at
construction rather than supplied by an enqueue caller, and the queue/child
identity carries the distinct Rust FROST operation root end to end.
The one-shot terminal executor then re-reads those same stores and uses the
existing exact Nutshell swap/recovery/recipient-import path; it cannot sign a
new branch or accept a caller-authored success result. The worker keeps an
unknown mint effect unavailable and resumes only the same durable operation.

The coordinator database is schema V3 with a random store generation and a
monotonic global revision. A separate SQLite anchor detects replacement,
revision regression and same-revision state drift. First enrollment is an
explicit one-shot `init-anchor` command and serving refuses an absent anchor.
This closes an accidental single-database restore. It does **not** detect a
coherent rollback of both files on the same host; that still requires an
external monotonic authority or operator quarantine.

Current offline verification on the post-R5 trust-boundary repair source:

- Friday TypeScript typecheck: PASS.
- Focused rollback/queue/coordinator/executor and deterministic exact-template
  tests: 28/28, 105 assertions. The positive case traverses prepared FROST
  authorization, durable authority binding, trusted queue, one mint-port swap
  and one recipient import.
  The mint port is deterministic test code; this is not fresh Nutshell/FIPS/
  Comet process evidence.
- Full Friday gate in the restricted sandbox: 151/153; the only failures were
  the known child-process `EPERM send` restriction. The exact affected process
  file then passed outside the restrictive sandbox: 6/6, 38 assertions.
- Go `./...`: PASS. Coordinator and terminal-executor standalone Bun binaries
  compile with the local Bun target; their temporary hashes are recorded in
  the handoff and are not deployment pins. A requested baseline-target build
  could not fetch its runtime in the restricted environment and is not counted.

The browser and server are now protocol-honest for a V4 manifest: seller auction creation
may use `threshold_sigall_v1`, but threshold bidding, wallet/faucet, and old
seller-settle actions fail closed. The Go server rejects direct V4
`/api/cashu/*` requests, so this does not rely on disabled browser controls and
cannot query or mutate the Wednesday Coco wallet as a fallback. The
still-missing browser path is substantive: a
two-phase, same-origin client-held bidder/refund signer must construct and
approve the exact pool/package, while NIP-07 can sign Nostr events but does
not provide arbitrary Schnorr-message signing. No insecure server-held
replacement was introduced to make the button appear ready.

R5 did not test this newer code, no browser threshold API is runnable, and a
future live candidate needs a fresh integrated Nutshell/Comet/FIPS test and
independent review. No key, listener, service, VPS, network or Wednesday
fallback was changed.

### Post-R5 fixed authority and browser protocol (2026-10-23 UTC)

Source now defines a loopback-only fixed authority service and authenticated
same-origin HTTP handler. Its terminal drain pulls operations from one captured
trusted source and invokes the captured queue runtime; browsers cannot submit a
terminal branch, reader, signer, mint port or rollback anchor. Status calls use
the captured health/anchor port and return 503 on quarantine.

The browser protocol now has a distinct non-exportable payment signer and a
canonical kind-28647 Nostr authorization binding the exact network, chain,
auction, amount, mint, payment/refund keys, operation, bundle digest and expiry.
NIP-07 remains only the Nostr event signer. Both the payment and refund keys
prove possession over the exact funding intent, and the browser payment signer
constructs the Nutshell SIG_ALL digest from exact input secrets/output blinded
points instead of accepting an arbitrary digest. Focused TypeScript typecheck
passes; the new protocol/API/browser-signer tests pass 9/9 (30 assertions).
The served demo signer asset was rebuilt locally (SHA-256
`ac828c850f2ed729b2a19a687d55baa3d4660080d64c5ab633a3d6b5e9b4927d`).
No listener was started and no persistent key was generated; test keys are
synthetic or disposable browser-memory fixtures.

Funding deliberately still returns HTTP 503 after valid authorization. The
V3 consensus/Rust receipt still requires its original raw actor Schnorr
signature. A separate V4 receipt now embeds the complete kind-28647 Nostr
event, the exact prepared-bundle digest, payment/refund key proofs and return
package. TypeScript, Go and Rust verify one frozen public-only V4 vector. Valid
V3 receipts remain supported, while Go and Rust now both reject unsigned V4
fields on a V3 receipt.

The disabled internal preparation composition recomputes the complete exact
package, claims event/operation/bundle/scope in a process-safe SQLite journal,
persists the bearer package in the encrypted private store, and advances only
through `claimed -> stored -> admitted`. An independently stored monotonic
anchor detects replay-database replacement or regression; an admission record
binds the committed receipt digest, transaction hash and height. Crashes can
strand one claimed request, but cannot make an unstored package admitted. The
public HTTP handler deliberately does **not** call this composition yet and
continues to return 503 while the browser custody decision and real integrated
test remain pending.

The authority runtime now has a durable terminal-reference adapter with a
SQLite-CAS `resolving` lease under its intended single-process service model,
restart recovery, anchored health adapter,
serial fail-stop drain loop, and one loopback process lifecycle that closes its
listener on exit. The fixed terminal resolver is still supplied by the process
composition; there is no final reviewed CLI that constructs every
Comet/DKG/signer/mint port from the live application file. These checks are
synthetic/offline and do not activate the public funding route. This newer
source is not covered by R5, is not deployed and has not run with
Comet/FROST/FIPS/Nutshell together.

Verification of this source: the focused authority/package/V4 group passes
29/29 tests (111 assertions), Friday TypeScript typecheck passes, `go test
./...` passes, and Rust admission tests pass 7/7. The broader Friday suite in
the restricted runner passes 171/173; its only failures are the two known OS
child-process cases blocked by sandbox `EPERM`. The exact affected process file
passes 6/6 (38 assertions) in the approved ordinary runner. These overlapping
counts are reported separately and are not summed into one invented total.

### Fixed Comet/resolver CLI and Coco v2 boundary (2026-10-23 UTC)

The missing fixed adapters now exist in source. `demo-friday-v4-comet-admission`
accepts no RPC assertion as authority: it re-reads the pinned genesis, exact
transaction at H, canonical H/H+1/H+2 commits, authenticated S/S+1 state, the
V4 receipt and encrypted package before advancing `stored -> admitted`.
Terminal discovery scans only bounded committed history for already admitted
operations. The fixed terminal descriptor journal binds branch, height,
operation and network identity across restart, and the authority CLI constructs
its Comet, DKG, signer, mint-recovery and queue ports only from fixed paths and
hash-pinned configuration.

Coco v2 is now the defined wallet boundary for threshold funding as well as
the Wednesday route. `sendThresholdSigAll` creates the 2-of-2 NUT-11 send under
Coco's durable operation identity and re-reads every mint proof's bidder,
committee, refund, locktime, `n_sigs=2` and `SIG_ALL` terms. The browser adapter
opens the pinned Coco IndexedDB repository, prepares that lock through Coco and
imports terminal tokens through Coco receive. It is not NIP-60 and it does not
treat a Rust signer as a wallet.

Current verification: Friday TypeScript typecheck PASS; the new Comet,
resolver, CLI and Coco focused group passes 12/12 (33 assertions); the Coco
threshold/browser gate alone passes 4/4 (12 assertions); Go `./...` PASS.
Standalone source bundles compile: the fail-closed authority binary SHA-256 is
`9771e62de784ae2f051450644ae2701594354c19cca918488d43bd0170337519` and
the browser Coco bundle SHA-256 is
`f46cd2161d197a49ce9c21b6288bfc81474ee8d80058bdc08f12a1d5679e8c1c`.
These temporary `/tmp` builds are evidence, not deployment pins.

Activation remains blocked and honest. The browser can reach only public
HTTPS, while the reviewed FIPS application pins the fake mint to an internal
FIPS ULA. No reviewed logical-origin transport maps those identities yet. The
final authority therefore refuses browser recipient delivery, the public
funding endpoint remains 503, and the lab JSON wallet is not used as a live
fallback. This source has not run one full browser-Coco/Comet/FROST/FIPS/mint
path and is not deployment-ready evidence.

### Central browser/Coco contract checkpoint (2026-10-23T02:58Z)

Central source is now `69184e18` (with the threshold-resume implementation in
`6bcaa591`).  The browser boundary uses the pinned Coco v2 rail, not a custom
wallet: the rail now reopens the exact caller-owned threshold send, verifies
its immutable mint/amount/unit/NUT-11 target, joins Coco recovery for an
executing operation, and returns bearer material only after the durable
operation is still `pending` and the complete token revalidates.  Focused Coco
threshold/browser tests pass 10/10 (35 assertions); the curated browser group
passes 23/23 (89 assertions); Friday TypeScript typecheck and Go `./...` pass.

The retained full restricted Friday run completed with 190/192 tests passing
(669 assertions).  Its only two failures are the OS-child FROST process cases
rejected by the restricted runner with `EPERM`; the same process file had
already passed 6/6 (38 assertions) in the ordinary runner.  These are separate
observations and are not summed into an invented acceptance count.

Two contract defects were closed without activating anything: terminal ack
ports now require the recipient-key signature that the server verifies, and a
seller winner-output plan is authorized before (and then bound by) the bidder
funding event instead of circularly requiring that future event id.  Consensus
now rejects a threshold auction at creation unless it carries a distinct valid
seller Coco payment key; this prevents an auction that can never settle from
being committed.

Activation is still **BLOCKED**.  The shipped page has no concrete construction
of `DemoFridayBrowserExactEnvelopeBuilderPort` or
`createDemoFridayBrowserCocoClient`, and threshold bidding deliberately throws
before mutation.  There is likewise no registered seller-plan service/store in
the live page flow.  Therefore this checkpoint is coherent fail-closed source,
not an end-to-end Nostr/Coco/FROST/FIPS demo and not a deployment candidate.

### Exact-current R6.1 candidate and live non-FIPS proof (2026-10-23T04:43Z)

The central fixes are now frozen through `0eb5118`. Seller payout-key binding,
exact lost-response recovery, and deterministic rejected-bid return are durable.
Rejected admission stores both distinct Nostr identities: the kind-28647 funding
authorization and the kind-28641 bid committed by Comet. Terminal discovery
uses the latter. Independent re-review of `7c110c7` found no remaining P0/P1
in that path. The browser bundle has been rebuilt, and the V4 site has an
explicit default-off activation gate; enabling it never restores the Wednesday
shared-custody routes.

Exact-current regression evidence: Friday typecheck PASS; focused rejected
admission/discovery/terminal tests 17/17 (47 assertions); Coco/browser tests
42/42 (168 assertions); Go `./...` PASS; Rust participant 19/19 and inspector
build PASS. The restricted full Friday runner records 199 passes and two
sandbox-IPC failures (733 assertions); that exact six-case OS-child file passes
6/6 (38 assertions) in the ordinary runner. These overlapping observations
are not added into a fabricated total.

One bounded throwaway integration run then passed in 66.52 seconds with 18
assertions: four real local Comet nodes, one validator unavailable, three
independent admission-policy workers, real Rust 3-of-4 FROST, Nutshell 0.19.2
FakeWallet with zero fees, one actual mint spend, exact NUT-07 input states,
NUT-09 output recovery and 1,000 unspent fake sats imported by the recipient.
Evidence is `evidence/friday-integrated-frost-comet-20261023T043936Z-1605037.json`
(SHA-256 `c134a5c1b38f9d342c15f16f6020ee3c735dc6e012bc3d3460688d803e7b9a12`),
with the dirty-test provenance correction recorded separately at SHA-256
`f2c5efa5da7e7c04f65771188b05cac6d595b2776715f758065c210745f88bb6`.

This successful live proof is explicitly **not FIPS transport and not the full
browser journey**. R6/R6.1 artifacts are built and hash-pinned, but no
exact-current privileged FIPS traversal or VPS deployment has run. Keep
`POC_FRIDAY_BROWSER_READY=false` until that run and its review complete.
