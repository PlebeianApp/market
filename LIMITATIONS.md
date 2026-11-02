# Friday Demo Limitations

## Current R10 activation boundary

- R10 is built and regression-tested, not deployed or exact-current
  end-to-end accepted. It has no retained run combining a normally trusted
  distinct Friday HTTPS origin, browser/NIP-07, Coco v2, a real fake mint,
  3-of-4 Comet over jmcorgan/fips, 3-of-4 FROST, FundingAbort and recipient
  import using the exact R10 artifacts.
- Recovery-only is enforced by the site and authority, but has not been
  canaried on a live origin. A UI flag alone is never a rollback control.
- If the controlled mint advertises NUT-12 but emits invalid or missing DLEQ,
  the same durable Coco operation remains unavailable. No valid refund capsule
  can be manufactured from invalid evidence, so instant compensation is not
  claimed.
- The distinct Friday environment must prove empty server databases,
  independent anchors and browser-origin stores before create-once
  initialization. Pre-R10 records are preserved and block activation rather
  than being cleared or migrated in place.
- A signer unavailable before abort policy selection can be excluded from the
  deterministic 3-of-4 subset. A selected signer lost after durable root claim
  fails closed and must return; participant four is not substituted mid-
  transcript.
- Emergency unilateral timeout refund, own raises, and quote-before-operation-
  ID recovery remain unimplemented. Fake money, one operator, coordinator-
  trusted proof verification and jmcorgan/fips transport are still explicit
  boundaries; this is not FIPS 140 or real-value readiness.

- Fake sats have no value and no production redemption path.
- Wallets are custodial and server-held. An npub is an account key, not proof of
  decentralized custody.
- Reservations are application-level ledger reservations backed by custodial
  proofs; they are not mint-enforced locks.
- The deployed Wednesday system still has validators trusting one coordinator
  attestation and a shared committee key that is not FROST. The undeployed
  Friday candidate implements local 3-of-4 FROST admission and one real
  threshold-authorized outbid-return path. It is not FIPS, not four-host
  SignerRPC, and not production threshold custody. All four machines remain
  under one operator.
- Nutshell FakeWallet replaces Lightning. No production Lightning or relay is
  contacted.
- The coordinator, mint and validator RPC are loopback-only. The candidate
  rejects a non-loopback mint/site origin rather than falling back to a public
  or production service.
- The deployed Wednesday coordinator still uses its older wallet/state path.
  The undeployed Friday candidate instead uses a restricted SQLite repository
  per npub. An isolated real-mint test reconstructed Coco from that database
  and recovered the exact lost-response send token by operation ID. The final
  real subprocess crash matrix passes the approved faucet/send/receive
  boundaries, terminal mint proof-state audit and exclusive conservation. It
  remains isolated fake-money evidence, not production chaos, HA, backup or
  disaster-recovery qualification.
- The Friday state loader labels pre-existing auctions `legacy`; it does not
  turn old NUT-11 locks or interim notes into custodial reservations. New
  auctions reject those legacy funding paths. Legacy settlement/refund code is
  retained only for already existing liabilities.
- The observed Nutshell 0.19.2 feature set includes NUT-04/07/09 but not
  NUT-13/19.
- The remote validator-offline HTTP route remains disabled in `serve` mode.
  The Friday candidate also hides the button when no local fault callback is
  configured; the live Wednesday page remains unchanged until deployment is
  separately approved.
- No 24/7, production security, federal FIPS, jmcorgan/fips networking,
  independent-operator, HA, backup, or disaster-recovery claim is made.
- The frozen Friday evidence was not accepted as subprocess-crash,
  full-public-path concurrency, hanging-mint or continuous global-conservation
  proof. New public-path concurrency and crash-conservation evidence now pass
  their custodial-checkpoint scope, including an accepted mint swap whose
  response was withheld and recovered. Corrected stopped- and stalled-mint
  close cases now pass locally with one validator offline; this is bounded
  fake-money evidence, not mint HA or a live-VPS fault campaign. Every failed
  diagnostic remains preserved rather than relabelled.
- The latest full-payment R4.4.5 candidate remains sealed, unaccepted and guarded on
  storage/admission/R16 authority. The POC does not bypass those guards and
  does not claim its payment semantics.
- The local unified run now proves real Comet, independent participant policy
  workers, real 3-of-4 FROST, one fake-mint outbid return and recipient import.
  It does not prove winner payout, reserve-unmet return or emergency refund as
  live unified branches. No persistent DKG/FROST share, FIPS identity, listener
  or live network cutover has been created. The older throwaway-lab request is
  withdrawn; no FIPS execution is authorized. A replacement request needs one
  exact reviewed harness/hash and literal privilege/argv/environment scope.
- The task-local SQLite adapter has a documented source pin and byte hashes,
  but no signed reproducible-build attestation and no migration evidence from
  every prior/rejected adapter schema. The known V2 funding-quarantine path is
  covered only at the pure migration seam across two child processes, not by a
  full encrypted coordinator restart.
- The final crash manifest proves absence only for recorded PIDs. Validator
  `wait-127` records mean the harness did not reap those already-exited child
  processes itself; the manifest does not scan host-wide replacement
  descendants. Harness output reports temporary-root deletion, but there is no
  separate persisted post-removal filesystem artifact. Approved
  outside-sandbox execution and gate history remain narrative/tool records,
  not a raw approval-receipt file in this repository.
- Stored Coco swap reconstruction and terminal proof ownership support the
  recovery outcome, but are not a packet-level trace proving a particular
  NUT-09 request/response exchange.
- Phone QA used an actual 390x844 browser and retained metrics, but its visual
  screenshot was inspected in-session rather than stored in this repository.
  It covered layout and permanent labels only: no login, identity, faucet,
  auction, bid, payment or validator control interaction occurred.
- The stopped-mint artifact was produced before the final harness gained
  operation-ID fields and the canonical proof-lineage audit. It proves only
  its recorded stopped-mint behavior, not byte-for-byte final harness parity or
  the later lineage assertion.
- The final release record is a point-in-time scan of exact process names and
  exact temporary roots. It is not a universal proof that no renamed,
  replacement or otherwise unmatched descendant could exist.
- The former local FIPS approval manifest is withdrawn after static review. A
  replacement R2 packet now has a committed candidate harness, binary/source
  pins, literal fixed topology, privilege-drop checks and packet/interface
  evidence requirements. Independent static review accepted it for action-time
  approval presentation; `approval_ready=true` is a technical gate, not owner
  authority. A fresh exact owner approval is still required. No namespace, FIPS key,
  capability or live host change has run. Its executable branch is only the
  cooperative outbid return; winner, reserve-unmet and emergency-refund paths
  remain outside the privileged lab.
- R2 re-derives the encrypted admission-store key from the persisted one-run
  coordinator secret and exact DKG/network/roster identity, then closes and
  reopens the store before displacement. That is store-manager reconstruction,
  not an executed separate process crash immediately after admission. The
  later response-unknown mint recovery is the actual fresh-process boundary.
- R2's compiled ELF outputs dynamically use the host's root-managed loader and
  system libraries. Executables and imported Python files are hash-pinned and
  the staged tree must be root-owned/non-writable, but this packet does not
  provide a hermetic root filesystem or a signed reproducible-build
  attestation for every system shared library.
- The tested signer journal now derives a state-directory identity,
  persists a random journal generation and increments its restart epoch; a
  separate coordinator database pins generation, DKG/public-package/roster
  identity and highest epoch. It also pins the actual Rust DKG/operation/nonce
  journal digest and revision plus the proof-use database's independent random
  generation, monotonic revision and content digest. Partial stale restore of
  either safety store is tested and quarantined. Restoring every signer store
  and the independent coordinator anchor to one mutually consistent old
  snapshot can still evade these local anchors; that condition requires
  quarantine and key rotation, not automatic recovery.
- First enrollment is not inferred from an absent anchor. Provisioning must
  create one exact binding-specific permit outside the signer and proof stores;
  the signer consumes and directory-syncs it before creating the first anchor
  row. Later anchor loss is quarantined because the signer epoch is already
  established, including when another permit file is presented. An operator
  can still deliberately destroy and reprovision every trust store, recreate
  the deterministic permit and re-enroll existing signer state. Operations
  must treat that as a new DKG/key lifecycle and rotate the key; the code
  cannot enforce that rule after both independent control stores are destroyed.
- The tested Comet adapter re-hashes the deterministic returned state and
  authenticates its StateView height S/app hash with the canonical S+1 header.
  This adds a fourth observation beyond the
  H/H+1/H+2 displacement-finality commits. Participant-local signers each
  authenticate that observation; its moving S fields are deliberately excluded
  from the durable immutable-finality digest.
- A new non-test composition pins the consensus-authorized return template to
  the exact threshold-signed admission receipt. The template digest remains the
  authority/mint-recovery root; the different Rust FROST authorization root is
  durably mapped to it with the complete operation, proof-pool, keyset, DKG and
  roster identity before signing. Its SQLite lifecycle distinguishes
  execution-unknown, mint-unknown, retry-ready, recipient-pending and imported.
  It is not a claim of cross-database atomicity: restart safety
  depends on reconciling the exact durable mint row before any re-entry. A
  regressed/missing recovery row after mint-unknown now quarantines, but a
  simultaneous rollback of authority, recovery and coordinator anchors remains
  outside this POC's trust boundary.
- Source now composes outbid return, winner payout and reserve-unmet return
  through participant-local Comet history, an operation/proof-exclusive SQLite
  terminal claim, concrete threshold-three disposition signing and durable
  mint recovery/import. The outbid-return branch has run end to end; winner and
  no-sale remain focused service/contract evidence only. A task-local Rust fork
  adds a separate admission
  authorization domain and a durable adapter; no coordinator-local or
  relabelled disposition signature substitutes for it. It compiles and ran in
  the local outbid slice, but its stdio process adapter is not evidence of
  authenticated four-host FIPS transport.
- The terminal service now rejects a caller-selected branch that differs from
  the committed close cause before a durable claim or payment effect. Its
  prepared negative fixture counts durable/signing/mint/import calls. One
  positive outbid path traverses real threshold participant processes, mint
  response-loss recovery and recipient import; the other terminal branches do
  not.
- `FipsMeshEvidenceV1` is only a strict source-level evidence schema. It cannot
  prove a packet traversed jmcorgan/fips until a separately approved, frozen
  harness produces owned socket/process/counter/capture evidence. No such run
  has occurred.
- The 2026-10-22 execution checkpoint closes compiler coverage and proves a
  real Rust 3-of-4 admission signature is accepted by Go. It does not make the
  focused Comet HTTP fixtures into live consensus, make harness-supplied
  participant evidence independent, or connect that admission to the separate
  real Nutshell/Coco recovery run. A truthful positive integrated claim still
  requires one bounded composition with actual Comet commits, four
  participant-local mint/history decisions, the real SIG_ALL terminal swap,
  recipient import and exact recovery under the same operation identity.
- No FIPS transport executed. The former privileged lab request remains
  withdrawn; passing `FipsMeshEvidenceV1` codec tests is not networking
  evidence.
- The independent review of the executed admission checkpoint keeps the
  integrated candidate **NOT READY**. Threshold-three signing was real, but
  all four harness policy services answered before participant four's share
  was omitted. Admission therefore still blocks on any unavailable policy
  service. The signed consensus receipt also lacks an authenticated
  chain/network plus participant-policy-transcript binding, and the direct
  admission journal lacks an independent stale-restore/epoch anchor.
- In the fault-matrix artifact, `conservation.pending: 0` describes the
  application ledger only. The same artifact deliberately retains a Coco send
  operation in `pending` after response-loss recovery; the evidence does not
  claim every persistence layer has zero pending work.
- The unified local evidence closes the former separation between one live
  outbid displacement, independent participant policy processes, real Rust
  FROST, real Comet and one real Nutshell response-loss recovery/import. It
  does not exercise winner payout, reserve-unmet return or the emergency
  timelocked refund as live terminal branches. Their current evidence remains
  focused service/contract coverage.
- The unified run uses loopback Comet and local stdio policy/signing processes.
  Its own evidence says `fips:false`; it is not proof of jmcorgan/fips traffic,
  authenticated four-host SignerRPC, independent operators or live VPS
  readiness. A newer prepared namespace harness now has compiled, hash-pinned
  application binaries, but remains inert and unexecuted pending independent
  review, immutable root-owned staging and fresh exact action-time approval;
  the withdrawn broad approval must not be used to run it.
- The final unified hardening adds exact input and recipient NUT-07 proof-Y
  comparison, participant-local DLEQ/keyset verification and independent
  signer rollback anchors. Generic test fixtures may omit DLEQ for legacy
  schema coverage, but the concrete Friday terminal signer refuses it. The
  stable durable finality digest binds immutable H/H+1/H+2 history while each
  signer separately authenticates its later S/S+1 lookup. This remains one
  local outbid-return execution, not proof of every terminal branch or FIPS.
- The final evidence now records the exact tested source commit, three
  executable hashes, H/H+1/H+2 and S/S+1 observations, and explicit DLEQ and
  proof-set results. It still does not serialize every participant's private
  local-policy trace or secret-free anchor metadata; the focused tests and
  source are needed to audit those assertions.
- Nutshell 0.19.2 and cashu-ts 5.0.0-rc.4 derive different raw `SIG_ALL`
  messages. The working fake-mint route uses Nutshell's input-secret plus
  output-`B_` message. Input `C`, amount, keyset, proof-Y, recipient and branch
  identities are bound by the separately signed admission/template/operation
  roots; this POC does not claim cross-mint SIG_ALL portability.
- The post-R5 signer/coordinator service preparation is not covered by the
  frozen R5 packet. The coordinator has no public admin listener and its former
  unauthenticated enqueue CLI has been removed. Its database is deployment
  bound, child requests/results bind the complete durable authority identity,
  and signer enrollment survives restart only by validating the existing
  exact file. A concrete terminal executor and trusted authority-to-queue
  runtime now exist; the private prepared reader and rollback anchor are fixed
  construction dependencies and the Rust FROST root is carried in every queue
  and child identity. They pass focused offline tests, but have not run together
  against fresh Nutshell, Comet and real FIPS processes. They are not covered
  by R5 and are not deployment-ready evidence.
- The separate coordinator rollback anchor detects a replacement or rollback
  of the coordinator database while the anchor remains current. Because both
  are still files on one host, a coherent rollback of coordinator plus anchor
  can evade this check. Safe recovery must quarantine on suspected whole-host
  rollback unless a genuinely external monotonic authority is added.
- A V4 browser and server no longer fall back to the Wednesday Coco wallet,
  faucet or settlement endpoints; direct `/api/cashu/*` calls are rejected at
  the Go handler. Threshold bidding is deliberately disabled because
  the two-phase same-origin API and client-held bidder/refund key signer are
  still absent. NIP-07 signs Nostr events; it is not an arbitrary Schnorr-
  message signing API. Supporting NIP-07 honestly requires a protocol-bound
  browser payment key plus Nostr authorization, not exporting an nsec or
  moving the payment key back to the server.
- Emergency unilateral refund still lacks a client-held export/import path.
  The exact refund template and signature exist in the private server bundle,
  but that is not equivalent to an offline bidder holding the bearer inputs and
  recipient openings. Enabling it requires an explicit choice to accept the
  unavoidable post-locktime Cashu first-valid-spend race between any already
  signed MAIN request and the bidder REFUND request; no code may claim refund
  priority or revocation of the MAIN signature.
- The post-R5 browser-funding protocol is source/test preparation only. It
  correctly separates Nostr event authorization from a client-held Cashu
  payment key and rejects cross-origin/substituted requests, but the public
  funding endpoint remains disabled. A new V4 Nostr-event receipt has matching
  TypeScript, Go and Rust validation and a frozen public-only vector; this does
  not replace or silently reinterpret V3, and it has not yet been exercised by
  the real integrated mint/FROST/FIPS path.
- Exact browser construction of Nutshell's SIG_ALL digest necessarily handles
  the input proof secrets. That is a material change from the earlier
  server-held custodial wallet and has not been activated or owner-approved as
  the live custody boundary. The alternative—signing an opaque server-supplied
  digest—was deliberately removed. This unresolved choice is another reason
  the funding endpoint returns 503.
- The fixed authority service captures its trusted source, queue runtime and
  rollback-aware health port and provides no public terminal mutation route.
  Its source-level process lifecycle now takes a durable resolving lease under
  the intended single-process service model,
  recovers only interrupted leases on startup, drains serially and binds its
  listener to loopback. The resolver that turns an authenticated durable
  reference into concrete Comet/DKG/signer/mint capabilities is still injected;
  no final reviewed live CLI builds those ports from `application.json`.
- Funding replay ownership and encrypted package persistence now have an exact
  crash protocol and a separately stored monotonic anchor. A coherent rollback
  of replay, private store and the separate anchor still requires an external
  monotonic witness to detect; suspected whole-host rollback must quarantine.
  The public handler does not invoke the prepared-package composition while
  funding is disabled.
- The preparation/replay restart fixtures use reopened or in-memory SQLite
  stores; they do not SIGKILL a real authority process at every boundary.
  `recoverInterruptedExact()` assumes the service manager starts only one
  authority instance. An overlapping second instance could reset the first
  instance's resolving row, so production activation also needs a real
  singleton process lock or equivalent service-manager guarantee.
  A durable reference source, anchored health adapter and serial drain loop now
  exist, but the reference resolver in focused tests is synthetic. A final
  deployment entrypoint must still construct every port from the fixed
  application/DKG/Comet/store configuration. The exact final artifacts need a
  fresh integrated test and independent review. No same-host anchor can prove
  absence of a coherent whole-host rollback; operational recovery remains
  quarantine or a clean, separately approved demo reset.

- The final browser Coco adapter is real Coco v2, but it is not connected to
  the live page. The signed receipt currently names an internal FIPS ULA mint
  origin; a teammate's public browser cannot reach that origin. A reviewed
  same-origin HTTPS mint proxy/logical-origin mapping must preserve the exact
  signed mint identity for browser Coco while proving that signer/mint traffic
  traverses the internal FIPS route. Until that exists, public funding remains
  503 and terminal delivery fails closed rather than importing into the old
  custom JSON fixture wallet.
- The full Friday suite started in the restricted runner after this repair,
  but its final exit record was not retained by the command session. Its
  partial passing output is not counted. Only the completed focused counts,
  typecheck and Go results above are acceptance evidence for this snapshot.

- Update at central `69184e18`: the restricted full-suite exit is now retained:
  190/192 pass, 669 assertions; only the two OS-child `EPERM` cases fail.  Coco
  threshold reload recovery no longer synthesizes `pending`; it rejoins and
  validates Coco's durable send operation.  The browser remains unavailable,
  however, because no concrete exact-envelope builder or page composition is
  wired, and no live seller-plan registration path supplies the now-mandatory
  seller Coco payment key.  These are activation blockers, not documentation
  gaps.  No privileged FIPS run, exact-current integrated mint run, VPS change,
  persistent-key generation, deployment, or public funding activation occurred.

- Update at R6.1: source now includes the concrete browser/Coco composition,
  fixed authority/terminal CLIs, seller-plan trust service and explicit
  default-off site activation gate. A real local Comet/FROST/Nutshell outbid
  return passed with one validator unavailable and actual recipient proof
  import. That proof used loopback/stdin transport, not FIPS, and did not run
  the browser page itself. It therefore does not authorize turning on
  `POC_FRIDAY_BROWSER_READY`, installing the binaries, or claiming the public
  Nostr-user journey complete.
- The R6/R6.1 build receipts pin exact Go, Bun, Rust and browser artifacts, but
  there is no exact-current reviewed privileged namespace packet and no live
  four-VPS FIPS evidence. Historical R5 is not substitute evidence.
- Own raises remain disabled until one stable auction-level payment/refund
  authority can cover the retained full pool across top-ups. Emergency
  unilateral refund remains disabled pending an explicit choice about the
  unavoidable first-valid-mint-spend race with an already signed MAIN branch.
- Experimental admitted replay rows made before `7c110c7` lack the now-required
  committed bid event identity. They fail closed and require an authenticated
  migration or a separately approved clean-state reset; they must not be
  silently upgraded.
