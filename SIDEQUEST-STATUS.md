# Plebeian Auctions side-quest status

## Current recovery candidate — 2026-11-08 UTC

Branch `recovery/r19-e2e-mvp` remains based on the preserved live R19 baseline
commit `5d827b2d2c05c6e50f1438ed3824be3509ed3bdc`. Work below is fake-money
test-mode work. No live funding, bidding, payout, journal cleanup, browser
storage reset, queue processing, or public activation was performed. The exact
reviewed continuation was copied into a new inactive release directory, passed
its read-only preflight, and was used for one authorized fenced authority
diagnostic start. That start failed closed during four-signer health-batch
collection and stopped the authority gracefully. Nginx and the coordinator
remain stopped, as recorded below.

### Single fenced authority diagnostic — 2026-11-08 UTC

Status: **BLOCKED after one start; no retry**. The exact reviewed continuation
release was staged at
`/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-authority-incident-continue-20261108`.
Its controller is 36,840 bytes, SHA-256
`95334508810b796628e68c1144325d0c77ae6810cc979e7b93489edbba839c34`;
its launcher is 3,105 bytes, SHA-256
`69f47350d7f042eb9c90d39f1ec619fe764378ab49b89034dc045ac6be9fcb4a`.
The installed copies retained their reviewed root ownership, mode 0755,
single-link boundary and exact hashes.

The single authorized invocation started the incident authority once, then
failed closed with
`HEALTH_BATCH_COLLECT; cleanup=['graceful_stop_returned', 'stopped_boundary_proven']`.
The authority stopped gracefully in about one second, without `SIGKILL`; it is
inactive/dead with PID 0, no control PID, zero restarts and no listener on
8181. The create-once start marker is present and the start ticket was
consumed. The signed health-batch output is absent. This invocation must not
be repeated.

The post-failure proof returned `POST_DIAGNOSTIC_PAYMENT_STATE=UNCHANGED`:
authority work remains zero, all protected semantic database digests and
coordinator revision 75 remain exact, and the seven preserved
`recipient_pending` records are unchanged. Nginx remains inactive with no
80/443 listener. The coordinator remains stopped at its exact reviewed
process-free boundary. FIPS, mint, observer and site retained their exact
preflight PIDs and zero restart counts. No payment, import, queue transition,
funding operation or bid was executed.

Read-only diagnosis found all four signer services active with zero restarts
and successful TCP connections to their ULA port 39101. Their public successor
enrollments exactly match the four APP-pinned hashes. The failure therefore
occurred inside a probe response, readiness, transcript-validation or timing
check. The precise signer/condition is not recoverable from this run: the batch
collector reduces each probe's stderr to `probe N failed`, and the controller
reduces that further to `HEALTH_BATCH_COLLECT`; neither retained a failed
probe record. A new signed probe would be a second live diagnostic and needs a
new reviewed procedure and live-action decision. The consumed start marker
must not be cleared or bypassed.

### Parallel read-only recovery findings — 2026-11-08 UTC

Status: **BLOCKED, with transport and shutdown narrowed out**. Independent
read-only investigations found the five-node FIPS mesh currently healthy with
fresh traffic, four authenticated peers per node and all signer TCP routes
reachable. All four signer services, enrollments and clocks are current; their
journals have no pending rows or quarantine markers. This does not replace a
signed 4-of-4 health sample, but it rules out a current FIPS outage and current
clock skew as explanations for the spent diagnostic.

Authority shutdown is no longer the principal blocker: the exact candidate
stopped gracefully in the live incident unit and the isolated loopback
SIGTERM test passed. The unknown condition remains inside signed health or its
batch boundary. The local diagnostic now settles all four slots and retains a
bounded, create-once mode-0600 failure batch containing only finite stable
codes and capped byte counts rather than raw failed output or secret-derived
hashes. It uses a fresh standalone namespace, an atomic permanent attempt
marker whose file and parent directory are synced before probes, a shared
finite child-reason allowlist, and hard probe deadlines; it never touches the
spent authority marker or historical batch path. Focused health/incident
verification passed 67 tests;
five unavailable browser-fixture tests skipped, the Friday TypeScript check
passed and `git diff --check` passed. Independent fix-only re-review returned
**APPROVE** for the exact corrected source/test hashes recorded in
`recovery-20261106-actions/RECOVERY-PLAN-20261108.md`. The approval is offline
only. No executable was built, staged, deployed or run against a signer.

Payment reconciliation established that the seven pending records are four
winner payouts, two outbid returns and one rejected-bid return already issued
for delivery, each attempted once. Five have request digests; two legacy rows
do not. A prior recovery inspection reported that the locally preserved browser
opening records do not match their payment IDs, but no portable sanitized
record was retained, so that mismatch remains unverified. A new non-secret
inventory proves that only one live-origin IndexedDB profile exists under the
local home directory and no browser tab is currently available; its provenance
is preserved in
`recovery-20261106-actions/evidence/browser-profile-inventory-20261108.json`.
Original recipient/device profiles and wallet conservation evidence are
therefore still missing. The interrupted 100-sat request is durably
`rejected_no_effect` with zero signer proof claims, but return to spendable
browser balance remains unproved and must not be retried.

The dependency-ordered plan and exact seven-row correlation checkpoint are in
`recovery-20261106-actions/RECOVERY-PLAN-20261108.md`. All live services,
queues, signatures, imports and payments remain fenced and untouched.

### Staging and read-only preflight checkpoint — 2026-11-08 UTC

Status: **PASS for staging and read-only preflight only**. The exact reviewed
candidate is present at
`/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-authority-incident-20261106`.
All nine transferred files matched their reviewed SHA-256, size, mode and
root ownership before the hidden staging directory was published. Both the
release root and its `bin` directory are root-owned mode 0755. The immutable
release verifier returned `AUTHORITY_INCIDENT_RELEASE=PASS`.

The controller's read-only boundary checks then returned
`AUTHORITY_INCIDENT_READ_ONLY_PREFLIGHT=PASS`. They reproved the exact stopped
authority state and unchanged live-service identities, zero terminal
pending/resolving work, zero funding-abort journal work, every protected
database semantic digest, coordinator revision 75 and its exact rollback
anchor, and the exact seven preserved `recipient_pending` operations.

The post-check proved that the authority remains failed/stopped with PID 0,
`Restart=no`, zero restarts and no listener on 8181. Its installed active unit
is still the predecessor unit with SHA-256
`1854c7448d49ae82ada7d2c69d190768381e7ff809ffe4e370140667490cc1f0`.
The create-once start marker and start ticket are both absent. Nginx,
coordinator, FIPS, mint, observer and site retained their exact preflight PIDs
and zero restart counts. No staged executable or controller action was run.

### Earlier fenced diagnostic stop — 2026-11-08 UTC

Status: **BLOCKED before the authority start**. The first invocation was
rejected by the controller's explicit environment run gate and was proven to
have made no change. The single corrected invocation stopped nginx and issued
the coordinator stop, but then failed closed with
`COORDINATOR_NOT_STOPPED; cleanup=[]` before the operational snapshot, unit
replacement, start-ticket creation or authority start.

The coordinator process did stop. Its reviewed binary exits status 1 when
SIGTERM closes the server, so systemd recorded the completed explicit stop as
`failed/failed`, `Result=exit-code`, `ExecMainStatus=1`, PID 0, zero restarts.
The controller had required `inactive/dead`. Nginx is inactive with no public
80/443 listener. The authority remains on the predecessor unit, failed/stopped
with PID 0 and no 8181 listener. The start marker and ticket remain absent.
FIPS, mint, observer and site retained their exact PIDs and zero restart
counts.

A post-failure read-only proof returned
`POST_FAILURE_PAYMENT_STATE=UNCHANGED`: zero authority work, all protected
database semantic digests, coordinator revision 75 and its rollback-anchor
digest, and the exact seven `recipient_pending` operations still match the
preflight baseline. No payment, import, queue transition or diagnostic start
occurred. The exact coordinator unit, systemd process boundary, absent lease,
absent cgroup and stop journal are preserved in evidence SHA-256
`fbc1a4501f5ab636b28f0d51de45a82e76993763b5b7643b0418f794f75baf27`.

Read-only browser inspection recovered the exact incident operation at
`envelope_prepared` revision 3 and seven recipient-private opening records.
All seven are unimported, and their capability operation IDs do not match the
seven server-side pending payment IDs. They therefore cannot authorize or
prove recipient recovery of those deliveries.

A local continuation delta now accepts only the exact process-free systemd
stop boundary (or a clean inactive stop), rejects PID/restart/unit/status
drift, and has a separate `PLEBEIAN_AUTHORITY_INCIDENT_CONTINUE_20261108_V1`
run gate. Its continuation path only proves the existing nginx/coordinator
fence; it never issues another stop. It also pins the coordinator unit,
control PID, kill mode, job, invocation, absent process lease and absent unit
cgroup. A fixed launcher authenticates the exact controller before setting the
continuation gate. The controller is 36,840 bytes, SHA-256
`95334508810b796628e68c1144325d0c77ae6810cc979e7b93489edbba839c34`;
the launcher is 3,105 bytes, SHA-256
`69f47350d7f042eb9c90d39f1ec619fe764378ab49b89034dc045ac6be9fcb4a`.
Two isolated packages are byte-identical. Fifteen focused controller, release,
launcher and start-ticket tests, Python compilation and `git diff --check`
pass. Independent re-review returned **APPROVE** for this exact fenced
diagnostic continuation only. At that checkpoint it was not yet staged or
authorized; the later single-start result above supersedes that historical
state.

### Authority incident recovery preparation

The live authority remains at the preserved stopped boundary: inactive/dead,
no process, no listener on 8181, `Restart=no`, with the incident unit installed
and its create-once start marker present. The four signers remain active on
their adopted successor epochs. The rejected incident request, seven
recipient-pending operations, browser storage, wallets, journals, enrollments,
and database state were not changed. The failed bid and its funding operation
must never be retried.

The local recovery delta now retains the complete coordinator-signed health
request and signer-signed health reply for every signer. An offline verifier
requires one bounded batch containing slots 1 through 4, the exact signed
successor enrollment hash, identity and epoch for each slot, four valid ready replies, four distinct
process instances, and request start times within one second. It rejects a
tampered reply, a missing signer, a repeated process instance, wrong pins,
wrong epochs, a predecessor enrollment, or an alternate valid self-signed
enrollment. The incident probe also refuses a symlinked, multiply linked,
wrong-owner or non-0600 coordinator identity file and zeroes its raw read
buffer.

Authority shutdown now uses one process-lifecycle abort signal for the
loopback listener, readiness collection, and consensus-health read. The
listener closes active connections immediately when the signal fires. Focused
tests passed 42/42, the Friday TypeScript check passed, and a real Bun child
with a real loopback listener exited cleanly after an OS `SIGTERM` in well
under the two-second test limit. Two same-path authority builds were
byte-identical; the signed-health probe and offline verifier also reproduced
byte-for-byte when built twice at fixed paths. The complete Friday suite passed
412 tests with no failures; five actual-browser-record tests skipped because
that record is not available. The exact compiled candidate was staged and
executed once by the fenced diagnostic above; it is stopped and must not be
executed again under that spent continuation.

A forward-only controller, immutable incident unit and release guard are now
prepared locally. The controller has one start call, fences nginx before it
stops and snapshots the coordinator, requires zero terminal/funding-abort
work, installs only a recovery-only/browser-unready `Restart=no` unit, and
uses a persistent create-once start marker. It never starts nginx or the
coordinator. Failure injection at every controller boundary plus the start
ticket, public-listener fence, unit and artifact-guard tests passed 9/9. The
exact artifacts were staged and their read-only release/state preflight
passed. The same independent Reviewer completed the fix-only check and
approved this deliberately quiescent authority-diagnostic procedure. That
approval was consumed by the single diagnostic above.

The reviewed one-start procedure used for that diagnostic was:

1. Reprove the current stopped boundary and exact successor enrollments before
   any mutation. Any difference stops the procedure.
2. Establish a separate public-write fence before taking the operational
   baseline. The proposed
   fence is to stop nginx and prove that no public 80/443 listener remains,
   while also proving that 8180, 8181, 3438, 27656, 27657, and 39101 are not
   publicly reachable. This outage and the later release are separate Lead
   actions.
3. With ingress fenced, stop the coordinator and prove it remains stopped.
   Only then snapshot its seven records, the protected database semantics,
   zero signer-RPC pending rows, zero terminal pending/resolving rows, zero
   funding-abort journal rows, and all out-of-scope service identities. This
   removes the recipient-ack race between baseline and authority start.
4. Stage a create-once candidate and incident activation unit pointing only to
   that candidate. Keep `Restart=no`; never restore a predecessor enrollment
   or the earlier authority binary/unit. The incident unit must not `Wants=`,
   `Requires=`, or otherwise start the coordinator, and it must force
   recovery-only/browser-unready operation.
5. With ingress fenced, the coordinator stopped, and the terminal source still
   empty, start the
   authority exactly once. Bind the observed systemd PID, process start time,
   executable identity, and loopback listener; do not infer identity from a
   command line or hard-coded process ID.
6. Collect the four raw signed health transcripts concurrently, preserve the
   exact records, and run the offline verifier. Require one 4-of-4 batch and
   exact equality between its process IDs, the authority anchor rows, and the
   four successor bindings. Ordinary 3-of-4 readiness is not recovery
   acceptance.
7. Require two increasing consensus samples and unchanged protected database,
   coordinator, terminal, funding-abort, and queue semantics. A failed check
   triggers one graceful stop, with no second start and no payment retry. A
   graceful stop must finish before `TimeoutStopSec`, leave no process or
   listener, and must not require `SIGKILL`.
8. Even after authority acceptance, keep the coordinator stopped and public
   writes fenced until every one
   of the seven recipient-pending records is bound to recipient-private import
   state and exact fake-sat conservation. Public release is a later reviewed
   action, not part of authority recovery.

The diagnostic completed the fence, stop, snapshot, staging and single start,
then failed at step 6 before a batch could be persisted. Steps 7 and 8 were not
entered. This historical sequence is evidence of what ran, not authorization
to repeat it.

The graceful-stop claim is limited to this deliberately quiescent activation:
nginx and the coordinator are stopped, browser writes are disabled, terminal
pending/resolving and funding-abort work are both zero before the start, and
the controller never stops the process while its own status request is active.
The code still does not promise cancellation of arbitrary payment work already
inside `drainOne`; a non-quiescent start remains prohibited.

The earlier APP continuation controllers are retired. Their hard-coded
process IDs, 3-of-4 public-readiness window, and cleanup assumptions are not a
safe basis for another start. The new local fenced-continuation mode is derived
from the reviewed forward-only controller and has passed independent review
and exact artifact verification. It was staged and used for the single fenced
diagnostic described above. It is now spent: its create-once start marker is
present, its ticket was consumed, and it must not be rerun or reconstructed
manually.

Preparation blockers:

- The original browser incident record is now located in the preserved browser
  profile and matches the exact operation/phase/revision. Its bearer-bearing
  contents have not been exported or independently replayed; only sanitized
  identities were inspected.
- Seven recipient-private opening records are present in that browser profile,
  but all are unimported and their capability operation IDs do not match the
  seven server-side pending payment IDs. Correct recipient-private evidence is
  still missing; APP state alone cannot prove fake-sat conservation or no
  second mint.
- The shutdown fix has isolated process and cancellation tests and the exact
  candidate did stop gracefully under the test host's incident unit, but the
  health-batch failure prevented recovery acceptance.
- The reviewed continuation completed one authority start and then failed
  closed during health-batch collection. Its batch collector did not retain
  bounded per-slot failure evidence, so the exact failed readiness or
  transcript condition remains unknown. The authority was stopped gracefully
  and payment state remained unchanged.
- Any new diagnostic, coordinator/public restart, payment recovery, and any
  later public release remain separate live actions and were deliberately not
  performed after the failed health batch.

Done:

- Replaced the single cross-identity pending-faucet marker with a validated V2
  per-actor/per-deployment collection. Legacy V1 state migrates without
  deleting another actor's unresolved operation.
- Made auction creation reread authenticated state through the committed height
  before registering its bounded offline payout authorization.
- Canonicalized payout comparison coverage for reordered JSON object keys.
- Throttled passive wallet maintenance, retained one immediate recovery pass on
  a healthy-to-degraded transition, and kept manual import explicit.
- Exempted exact payout reads from the small nginx mutation quota while unknown
  POSTs and mutations remain limited.
- Added bounded restart service candidates for site, authority, and coordinator;
  signer services remain fail-stop. The exact release verifier accepted every
  candidate service role against the built artifacts.
- Bound the recovery verifier to the already-deployed immutable
  `sidequest-mvp-r4` terminal-executor environment path while the coordinator
  unit invokes the exact recovery executor directly; changed successor paths
  fail closed.
- Added the exact recovery terminal-executor path to both coordinator
  allowlists. The regression derives that argument from the recovery unit,
  accepts it, and rejects near-path substitutions.
- Added a five-second SQLite busy timeout to the independent coordinator anchor
  shared by authority and coordinator. A real two-process regression holds an
  authority write transaction and proves the coordinator waits and advances
  instead of crashing with `SQLITE_BUSY`.
- Strengthened the one-seller/two-bidder local journey to register and re-read
  the auction-scoped offline payout authorization before bidding, reject the
  retired per-bid seller-plan path, require both outbid refunds, and conserve
  all 20,000 fake sats. A committed-bid response loss reconstructs a fresh
  controller over the durable operation, then recovers without a second mint
  or lock.
- Friday browser suite: 131 passed, 0 failed, 486 assertions. Full Friday suite:
  387 passed, 0 failed, 1,634 assertions. R20 suite: 58 passed, 1 root-only test skipped, 0 failed.
  Friday TypeScript check passed. All seven Node UI/deployment test files passed.
  Go `./internal/poc` passed. `git diff --check` passed.
- Reproducible candidate artifacts:
  - browser bundle: 1,757,078 bytes,
    `5a1b1a15ea6a43ac9417c9ed0c48ae7a3a25ad0d3db711b352dfb548cb2bd726`;
  - site: 46,633,336 bytes,
    `8239bc91b29a04a24f089a2479bd0d1757cb4f2825deafa9c3634f2553314935`;
  - authority: 99,654,070 bytes,
    `61a14645aac2eef4d6305c027b1d314e60c143a1c0a328ac5586120f4e0b720c`;
  - coordinator: 98,658,609 bytes,
    `3a6955b83d6a76487c9faa1f47a298fb157ee74a8362eacfe555d7e4aadf2843`;
  - terminal executor: 99,117,242 bytes,
    `4b6a1dfdc40420b2db59301be9b2d7aefa5bfa21f368723ec1de69640b18c958`.

Next:

- Prepare and independently review a new forward-only diagnostic design that
  retains bounded per-slot failure evidence and respects the consumed
  create-once marker. Do not clear the marker, replay this continuation or
  send another signed probe under the completed approval.
- Keep nginx, the coordinator and the authority stopped while the seven
  recipient-private deliveries are reconciled. Public release remains a later
  decision.
- After a separately confirmed signing run, execute the fresh live one-seller/
  two-bidder journey and report the exact balances and operation states.

Blockers (Lead action):

- The public MVP is not accepted: its single fenced authority diagnostic
  failed, public ingress remains fenced, and live fake-sat settlement has not
  completed.
- Catalogue visual integration remains separate and must not be mixed into this
  payment-recovery release before payment acceptance.
- The height-gated integer-overflow consensus upgrade remains separately
  blocked; do not retry or route around the prior security restriction.

Estimate: one working day to reviewed deployment plus live acceptance if the
review finds no changes and the test server remains healthy; confidence medium.

## Historical status recorded 2026-11-02 UTC

Status recorded 2026-11-02 UTC. This is implementation and local-test evidence,
not a claim that the public MVP is live.

## Ready locally

- Isolated branch: `sidequest/mvp-20261102`, based on the accepted separated R4
  implementation.
- Five-member browser acceptance runner: one seller, four bidders, five exact
  fake-sat fundings, four increasing bids, three outbid returns, consensus-time
  anti-sniping, one-validator outage, automatic close, seller settlement and
  exact five-wallet conservation.
- Browser export: `plebeianFridayRunFiveMemberAcceptance`.
- Browser bundle: 1,717,244 bytes, SHA-256
  `dbfc4bd748685854e036098df93aa9604df8bd2e3d79d735934eb54055465a4f`.
- Linux executable: 46,588,440 bytes, SHA-256
  `ab92ff6d0552f8de88208636cdad77dff3863ee8ef325eb04352e635e93e20c5`.
  It reports version `2026.10.23-friday-tier1` and value profile
  `FAKE_MONEY_ONLY`.
- Authority executable: 99,171,906 bytes, SHA-256
  `af51ff40ddafa496169cb15731c1ab8cf2b3b569f707dfd7f69719c9d294755d`.
- Coordinator executable: 98,655,955 bytes, SHA-256
  `2671bb59de2b8a63ffd34721f28c97b59098935503f322ac833b0339d6e6a777`.
- Terminal executor: 98,846,552 bytes, SHA-256
  `630f63ed3549812d43f585aa019b20aa90ffa863119f5b505406eaa47a518460`.
- Signer executable: 98,923,995 bytes, SHA-256
  `00c448e172c13b1a9862cd97bf79608e879739c0cc44aba74019bc3df66739d9`.
- Acceptance operator executable: 98,477,330 bytes, SHA-256
  `99db455714398434a9e3719236c3f05c0356d5e945b926aa31e3951e31d1b25d`.
- Same-path browser rebuild and independent-output Go rebuild were byte-for-byte
  identical to those artifacts.
- The real Coco runtime now forces identity encoding, rejects and boundedly
  cancels non-identity responses, and the browser-facing nginx mint routes
  clear upstream `Accept-Encoding`.
- The authority, terminal executor and signer were rebuilt from that corrected
  shared transport; consecutive baseline-target builds were byte-identical.
- The coordinator was also rebuilt as part of the coherent runtime set;
  consecutive same-path baseline-target builds were byte-identical. It does
  not itself perform mint HTTP reads.
- A draft create-once APP successor installer now binds the exact old release,
  new site binary, pre-start verifier and systemd unit. It retains the old unit,
  journals publication, leaves the site inactive, and refuses production use
  while its owner-install authority is false.
- The runtime-binding template fails closed until payment, genesis, anchor,
  observer, network, browser and health inputs plus exact configuration hashes
  and scoped approvals are present.
- One unauthorized five-role adoption plan now maps site/authority/coordinator/
  terminal to APP and the signer only to V1-V4, with exact predecessor and
  successor unit pins. Existing validator binaries, participant binaries,
  shares and per-slot confinement drop-ins remain predecessor-owned.
- The public configuration renderer consumes the accepted bootstrap, runtime
  binding, prerequisites, bootstrap acceptance, approved genesis-content
  decision, authoritative payment projection and mint-only reconciliation
  directly. Chain ID `plebeian-auctions-mvp-20261102` and timestamp
  `2026-11-02T18:35:21Z` are frozen once for all lanes. With current inputs it
  emits inert configurations; it can emit ready configuration only after
  derived runtime pins and all scoped authorities are present. Independent
  freeze review is accepted at
  SHA-256 `4d002c529f058e9beac785cbc689212531447f8a0a92cf055b7e0a0fb1d5352d`.
  The owner-reviewed sanitized payment
  projection and exact file hash satisfy the existing renderer's receipt-file
  contract; no private raw receipt or extra genesis-payment approval is added.
- A separate validator-4 recovery command now requires its own start approval,
  exact inactive-to-active unit transition, and a pinned four-signature Comet
  commit before sealing `active_rejoined`.
- The Go assembly-only legacy note namespace is selected as
  `http://127.0.0.1:8180/test-mint`. Port 8180 is the loopback site/API process;
  a composed handler test proves the path is a 404 non-JSON namespace, not an
  operational mint API. It is not an anchor/preimage field or the private FIPS
  Cashu server URL, and the threshold application disables its legacy note
  authority.

## Verification actually run

- Friday TypeScript typecheck: pass.
- Friday browser suite: 122 pass, 0 fail, 441 assertions.
- Four-validator service suite: 83 pass, 0 fail, 366 assertions.
- Go repository suite: pass.
- Separated-topology suite: 19 pass.
- Static UI/readiness/authorization/adversarial suites: 49 pass, 0 fail.
- Mint encoding/adaptor regressions: 14 pass, 0 fail, 94 assertions.
- Authority/terminal/signer CLI regressions: 10 pass, 0 fail, 49 assertions.
- `git diff --check`: pass.
- The composed successor-release fixture installed the actual 46 MB binary,
  retained the predecessor unit, produced a receipt, passed the installed
  pre-start verifier with complete synthetic public inputs, rejected the
  blocked template and rejected a repeated install without receipt mutation.
- The real local `systemd-analyze verify` parser returned success for the exact
  site, authority, coordinator and signer successor units and emitted expected
  warnings for production executables/dependencies absent on this workstation.
- The five-role adoption fixture copied and checked every actual APP/V1-V4
  binary, ran all installed role artifact guards, proved the current render is
  inert, rejected output-root reuse, and passed all role contracts with a
  complete synthetic ready input set.
- The rebuilt executable started a loopback site plus four actual local Comet
  processes; all four reached height 6 with one block/app hash and four commit
  signatures, and the HTTP-served browser bundle matched the embedded asset.
- The focused Go route test accepted only the private loopback `/test-mint`
  namespace, rejected the public Cashu origin as that namespace, observed 404
  non-JSON route behavior, and preserved distinct config identities.

The five-member tests also prove that duplicate actors and conservation drift
fail closed. The runner observes automatic close and never calls the manual
close endpoint.

The local process smoke test was not the separated production profile: it
reported threshold custody and browser threshold readiness false and used no
Nutshell or NIP-07. The stronger integrated local harness could not start its
throwaway mint because this workspace has no `.venv/bin/mint`; it is not a pass.

## Public activation not yet performed

No SSH, service, mint transaction, firewall, credential, genesis-signing or
deployment-cutover action was executed in this lane. Public activation still
depends on the single deployment owner receiving and accepting:

1. a separately scoped owner-signing grant and resulting public authority
   outputs; the frozen preimage is independently accepted and the mint
   projection, active keyset, public Cashu identity and later private
   `/test-mint` assembly namespace are pinned;
2. a fresh verified HTTPS/firewall evidence set and explicit issuance approval;
3. the exact signed deployment anchor derived from the frozen chain ID,
   timestamp and preimage; no new timestamp may be sampled;
4. the scoped APP/V1-V4 activation approval and, for the fault exercise, separate
   validator-4 stop and start approvals.

The inactive APP site currently installed under the immutable
`separated-site-browser-r2` release is the older binary, not this side-quest
build. Its installed unit is internally consistent with that release. This
new build requires a separately reviewed create-once successor release and an
exactly rebound unit; it must not overwrite the accepted release in place.

The four-validator DKG result is already complete and must not be repeated.
Until the gates above are bound and the five persistent browser profiles run
the journey against the live origin, deployment status remains **built and
locally verified, not live**.

The corrected GET-only Coco bootstrap is accepted as a bootstrap-only public
milestone: acceptance report SHA-256
`734ebc54830e867a3c77441f56d0c3019f08efee5b64a69959ea888110d342ad`,
owner-verified receipt SHA-256
`a9452ede2dc7704036a9d1f9e5b18b53a6f4b0523d5438e50087f3e160599d9d`,
seven GETs and 17,479 accepted bytes, no funding or persisted wallet, with the
mint stopped and settled. A later owner-supplied projection is accepted as
actual mint-only payment evidence: reconciliation SHA-256
`9139b1ec862535fbbaad59c19351f81a5987d00aa78618340f63d11700df94da`,
active keyset `001a10236c313f83`, and owner-verified receipt digest
`b5bac575046f13e1b030662818fba7ebe89df442cff12a5f8ec3983ac1332add`.
The raw receipt was not independently rehashed, and this is not genesis,
threshold custody, browser-auction, HTTPS or deployment acceptance.
That limitation is preserved as provenance, but the private raw receipt is not
an input required by the production renderer: it consumes the accepted public
projection file and that file's exact SHA-256.
