# Friday Demo Recovery Model

This contract covers the custodial-reservation checkpoint. It does not cover
FROST participant/share recovery or jmcorgan/fips identity/mesh recovery. The
expanded Friday target needs a separately reviewed recovery contract after the
authority, DKG, transport and lifecycle decisions in
`FRIDAY-FROST-FIPS-INTEGRATION-INVENTORY.md` are resolved.

## Durable identities

Every money-affecting intent has a deterministic ID derived from its signed
request and purpose. The encrypted coordinator checkpoint records the intent,
wallet, amount, mint, quote/operation identity, recovery material reference,
and last observed state before contacting the mint. Checkpoint replacement
fsyncs both the new file and its containing directory before a mutation is
allowed to proceed.

## Funding

1. Persist `prepared` faucet intent.
2. Reuse one exact matching pending NUT-04 quote when present; refuse ambiguity.
3. Persist the quote ID, then the Coco mint-operation ID.
4. Resume that operation until finalized or explicitly failed.
5. Credit the wallet only after Coco reports finalized proofs and exact balance.

If quote creation loses its response, recovery queries matching pending quotes;
it does not request another quote blindly. A quote ID and mint-operation ID may
belong to only one faucet event globally. Pending or unknown 10,000-sat intents
consume the identity's 50,000-sat allowance until that exact intent becomes
final, so a retry cannot use uncertainty to exceed the cap.

If the wallet already reflects the 10,000-sat increase while the journal is
still unresolved, that increase is subtracted from available backing. A second
faucet mutation is refused until the exact first operation reconciles. Any
balance movement other than zero or the exact grant amount makes the wallet
conservation view fail closed and disables new reservations.

## Custodial reservation

Reservation itself contacts no mint. A per-wallet critical section computes
`mintBackedBalance - active/proposed/inFlight` and persists the proposal before
signing its receipt. Consensus makes the receipt authoritative. Reconciliation
activates a committed proposal, releases an expired uncommitted proposal, and
turns outbid/no-sale/winner states into exactly one entitlement.

For an own raise, the proposal references the currently active reservation and
holds only the positive delta. The prior amount remains unavailable until the
replacement is committed or abandoned.

## Seller delivery

1. Persist the exact payout entitlement and deterministic send/receive IDs.
2. Ask Coco to durably prepare the exact caller-owned send. This reserves its
   proofs before mint I/O. Repeating the same ID and intent joins; changing the
   mint, unit or amount fails closed.
3. Execute or recover Coco's same persisted request. An `executing` swap is
   reconciled through NUT-07 input state and Coco's persisted reconstruction
   data/recovery path; it is never replaced with a new send. The result is
   compatible with the mint's advertised NUT-09 support but is not a direct
   wire-level NUT-09 trace.
4. Persist the returned bearer token inside the encrypted checkpoint before
   recipient import.
5. Import with the seller's deterministic receive ID.
6. Mark paid only after seller Coco ownership and exact balance delta are
   observed.

Until step 5 is durably checkpointed, value that has appeared in the seller
wallet is reported as incoming-pending and is not spendable. Other mint
mutations touching either participant are refused or queued behind the
unresolved payment, so they cannot disguise the recovery balance delta.

A lost send response becomes `unknown`. Recovery first reads Coco's operation
by the same ID and restores the exact token/result; `prepare` is only repeated
with the same immutable intent and therefore cannot allocate a second send.
Each npub uses a restricted SQLite Coco repository. The fault-matrix test let
Nutshell complete a swap and then deliberately dropped its HTTP response,
destroyed the manager, restored the exact outputs through Coco, lost the app
result again, and finally proved one 2,500-sat recipient ownership change. If a
future operation cannot be restored by that path, the payout remains
unavailable and the case is FAIL—not guessed from balances.

A wallet repository can open and report its local zero/spendable/pending state
while the mint is down. Trusting or contacting the mint is still mandatory at
the actual send/receive boundary. This separation lets the seller see an
`unknown` payout with zero spendable value during an outage without pretending
the payment happened.

## Conservation and drainage

The per-wallet status endpoint reports Coco's canonical `total`, `spendable`
and `reserved` observations alongside auction reservations,
`operationLocked`, in-flight/unknown, incoming-pending and unresolved-funding
figures. Coco can reserve an input proof whose denomination is larger than the
payment while a send is prepared. The payment amount and the future change are
therefore split into mutually exclusive buckets:

```
issued = spendable + operationLocked + auctionReserved
       + inFlight + unknown + incomingPending + fundingPending
```

`operationLocked` is owned proof value that Coco has made unavailable inside a
durable operation after the payment amount has been assigned to `inFlight` or
`unknown`; it is not spendable and is not counted again as payment value. A
10,000-sat selected input for a 2,500-sat payment is consequently observed as
2,500 in-flight plus 7,500 operation-locked until the exact change becomes
ready. An ambiguous balance movement sets `observationsExact=false`; it does
not make the equation pass by declaring value spendable.

The focused correction passes the Friday unit suite, including this
denomination/change case. Real subprocess confirmation now passes. At the
prepared boundary, one exact 8,192 input plus 1,808 other ready value equals
the 10,000 issuance; the exact input is NUT-07 `UNSPENT`, linked to one durable
operation and no bearer output exists. At completion, that input is `SPENT`,
the sender owns 5,692 change, and five recipient outputs totaling 2,500 are
locally ready and NUT-07 `UNSPENT`.

The same run exposed and corrected a separate accounting collision: the old
funding journal represented an unexplained wallet by writing the 50,000 faucet
cap into the grants map. Restarting after seller receipt therefore displayed
60,000 issued even though only 10,000 proofs existed. V3 persists quarantined
actors separately from proven grants. Ambiguous V2 excess grants migrate to
quarantine and become unavailable; they are never presented as issuance. A
focused two-child-process regression serializes that migration output and
reconstructs the journal in a second process, proving grant zero and
quarantine survive. It does not exercise the full encrypted coordinator
envelope.

`zero_pending` means every outbox and faucet item is terminal after
reconciliation; it does not mean workers are idle. Active bids remain
reservations and are not pending payments.

## Crash points

The frozen evidence reconstructed managers inside one Bun process; it did not
inject application-process crashes. The correction candidate has opt-in,
loopback-only durable failpoints after faucet mint, payout intent, Coco prepare,
Coco send result and recipient import. `scripts/friday-process-crash.sh` is
prepared to wait for each marker, verify its PID, SIGKILL that exact coordinator
process, restart from the same encrypted checkpoint/SQLite files, and record
start/kill/wait/post-scan facts. A controlled proxy separately completes a mint
swap while withholding the response. An earlier run reached the send-prepare
boundary and exposed the conservation-model defect; that failing evidence is
preserved. Two in-sandbox reruns then stopped before any auction/payment action
because the sandbox delayed asyncio's cross-thread wakeup used by `aiosqlite`;
the normally approved outside-sandbox diagnostic isolated that environment
behavior. The final run crossed every listed failpoint, recovered the same
identities exactly once, and passed prepared and terminal proof audits. Its
manifest proves every recorded PID was absent at the final scan; harness output
reports throwaway-root cleanup. It does not prove host-wide replacement-child
absence or persist a separate post-removal filesystem assertion.

The corrected stopped-mint close now passes with validator four offline: three
validators close, payout stays unknown/unspendable, and restarting the same
mint database/seed recovers one terminal result. The accepting-but-stalled
variant also passes: the proxy completes the upstream swap and withholds its
response, 2,500 remains in one exclusive unknown bucket, then the exact
operation recovers once. Its terminal audit compares the canonical immutable
proof tuple/Y set from the sender's stored token with the receiver's stored
input proofs and publishes only a SHA-256 lineage digest. A restart must either
resume that same identity to one result or remain visibly blocked; it must
never mint, send or receive twice.
