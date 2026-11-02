# Friday FROST/FIPS Decision Packet

Updated: 2026-10-22 UTC. Status: **local fake-money payment rules selected;
source repair remains unverified; live credentials/network/deployment still
require separate approval**.

This packet records the owner-delegated fake-money payment rules and the
remaining live-mutation boundary. It does not accept R4.4.5, install FIPS,
create a persistent credential, or modify a validator/network. It incorporates the independent A2
review at
`/home/maximoto/Documents/Codex/2026-10-21/task-3/A2-FROST-FIPS-INTEGRATION-PLAN-REVIEW.md`
(SHA-256 `28a6d49be8eea0df3a15024ac96d721ce1d8adea212e1e9eb2fb0c5747c99dae`).

## 1. Payment/admission authority

### Selected bounded choice

Use a new **fake-mint-only `DemoAuthorityV1`** for newly created demo
auctions. Keep it in a separate schema and database namespace from both the
Friday custodial route and the sealed full-payment route. It must always report
`productionReady=false` and allow only the named throwaway chain and loopback
fake mint. Do not call it an adapter to R4.4.5: it has to implement the
authority itself.

`DemoAuthorityV1` must derive, rather than accept as caller booleans:

1. pinned genesis, chain ID and validator roster; canonical bid/closure
   history plus H+1/H+2 successor commits;
2. the exact raw signed bid joined to ApprovalV2 and the matching auction;
3. consensus-serialized global proof-Y admission/reservation across every
   auction, branch and payment operation;
4. allowlisted mint origin, active keyset, denomination/DLEQ evidence and
   authoritative NUT-07 `UNSPENT` state at admission;
5. exact bidder, FROST committee and refund keys; `SIG_ALL` inputs and outputs;
   certified MAIN or REFUND branch; recipient capability and cutoff facts;
6. durable R16-like branch/operation identity, pre-submit intent,
   unknown-outcome fence, same-operation recovery and terminal recipient
   import.

The threshold funding receipt also binds the exact currently committed leader
being replaced and expires no more than 300 seconds after participant-local
admission checks. Each signer reads the current leader from its own consensus
state; a coordinator-supplied leader or timeless attestation is insufficient.

It must never accept a caller-provided “accepted” flag, arbitrary root/seal,
synthetic fixture, coordinator-only funding attestation, or participant-local
proof-use row as consensus authority.

### Difference from sealed R4.4.5

R4.4.5 is the latest candidate, superseding the inventory's original R4.4.3
reference. Its seal manifest is
`663b0c28729edc95a71b427da81c1fbc960521f976e993696bec4f936a491160`.
It changed only the proof-use SQLite implementation and one focused test/config;
the coordinator guards are unchanged. It remains unreviewed/unaccepted,
`productionReady=false`, and composition-blocked on older-row/pre-restore
integrity, storage decisions and payment/storage/FIPS integration. P2R4T-R3B
is prepared but unexecuted. `DemoAuthorityV1` therefore cannot import R4.4.5
rows or remove its guards; it must use a distinct test-only schema and evidence
chain.

The current unexecuted implementation names this boundary
`DemoIntegratedAuthority` and uses
`PlebeianAuctionsPOCIntegratedFundingV2`. V2 is deliberate: the signed receipt
now requires DKG run ID, public-package hash and signer-roster digest, plus the
exact winner/return/SIG_ALL package identities. V1 is not upgraded or accepted
implicitly.

The historical Rust participant derives its disposition authorization root
from a Cashu `SIG_ALL` digest and certified outcome. A task-local fake-only fork
now adds distinct `admission-*` commands and domains plus a concrete durable
adapter. It signs a dedicated admission-domain hash of the funding-receipt
digest only after independently binding the exact receipt bytes/hash,
identities, participant evidence,
DKG/roster/keyset and validity interval. Reusing a disposition signature or
injecting a coordinator Schnorr signature remains prohibited. This source is
NOT_RUN and not accepted as a production protocol change.

### Impact

This is the largest implementation item. A thin shim is unsafe and expressly
not recommended. If the owner instead chooses the sealed route, Friday
integration pauses until the real storage/admission/R16 acceptance path
completes.

## 2. FROST DKG and signer state

### Exact proposed tool identity

- Source: read-only
  `task-6/worktrees/a1-payment-frost-r2/cashu-wrapper/frost-participant-3of4`.
- Package/protocol: `coco-demo-frost-participant-3of4 0.1.0`,
  `COCO_DEMO_FROST_PARTICIPANT_3OF4_V1`, Rust 2021, minimum Rust 1.86.
- Cryptography pin: `frost-secp256k1-tr=3.0.0`, with the exact checked-in
  `Cargo.lock`; `k256=0.13.4` Schnorr and `chacha20poly1305=0.10.1`.
- Historical binary evidence only: SHA-256
  `5c7f72db189443f97c02d58aaa136f7f1942ccfc9d7fc8307a9e6c38e76dd7b6`.

The current local integration authorization permits throwaway fake-only DKG
fixtures and bounded execution after a fresh resource/process gate. It does
not authorize persisting those identities, copying them to a VPS or activating
the historical binary as a service. A live execution request must include a
clean source-manifest check, reproducible build/hash and exact placement.

### Proposed roster and placement

| Host | Committee participant | Private placement after approval |
|---|---:|---|
| V1 `172.105.64.142` | 1 | participant 1 share, nonce journal, operation/proof-use database, signer transport identity |
| V2 `172.105.95.57` | 2 | participant 2 equivalents only |
| V3 `172.104.240.217` | 3 | participant 3 equivalents only |
| V4 `172.104.253.247` | 4 | participant 4 equivalents only |

Proposed root per host:
`/var/lib/plebeian-auctions-poc/frost/keyset-v1/`, owned by a dedicated
non-login signer service account, directory mode 0700 and private files 0600.
The coordinator receives only the group public key, roster, verifying shares,
keyset/version and public policy metadata. It receives no FROST share or nonce.
No SSH, Comet validator, Nostr, FIPS node or Cashu refund key may be reused as a
signer transport identity.

The DKG is fresh and dealerless, requires all four participants, and creates a
new fake-only group key. Existing single-key liabilities remain on their old
route; they cannot be migrated. DKG packages, private shares and nonce state
must never enter chat, logs, client bundles, Git or evidence.

### Persistence and recovery rule

- Ordinary restart on the same durable state is allowed only after state,
  operation claims, proof-use rows, keyset epoch and restart epoch agree.
- A restart between FROST rounds abandons that attempt and reserves a new
  session; it never reconstructs old nonces from coordinator bytes.
- Stale backup restore is forbidden. Lost, rolled-back or corrupt state
  quarantines that signer. Recovery requires key rotation/re-DKG, not restoring
  an older share/nonce snapshot.
- A quarantined signer may leave its validator online. `validator_online`,
  `signer_safe_to_sign` and `payment_ready` are separate health states.

## 3. Signer transport

The existing stdio worker is a useful same-host process boundary. It does not
authenticate a remote host, executable, configuration or state directory.
FIPS membership encrypts/routes packets but does not authenticate payment RPC.

Recommended remote design, if four-host signing is required:

- a separately versioned `SignerRPCV1` over the FIPS ULA route;
- mutual application authentication with four roster-pinned signer identities
  and a coordinator client identity, all distinct from other key classes;
- request binding over operation root, keyset/version, session, transcript,
  branch, exact Cashu `SIG_ALL` digest and restart epoch;
- response binding to the same values and participant identifier;
- durable anti-replay/session claim before round-one publication;
- process identity/config/state-root verification in the service launcher;
- no public listener and no trust derived merely from source IP or FIPS peer
  membership.

Local-only four-process stdio is the smaller rehearsal option, but it proves
threshold mechanics rather than four-host signer transport. The owner must
choose which claim Friday needs.

The source repair now carries the DKG run/public-package/roster binding through
the consensus receipt and every authenticated RPC request/response. It also
pins journal generation, state-directory identity and a coordinator-side
maximum restart epoch. These bytes are uncompiled and do not remove the
simultaneous signer+anchor snapshot rollback limit.

## 4. FIPS validator mesh

### Exact proposed artifact selection

- jmcorgan/fips `0.5.2`, revision
  `53a3ec4b2fbaceb7009dd4fbe6974b011e452ae5`, x86_64 Debian package SHA-256
  `9e6c76d6a5612a8d6e0f6302b6e5d55b40cb3186ca3a4390ee72273a45e5059c`.
- `/usr/bin/fips` SHA-256
  `7b26e81e2607483d46b716a330c88ee18c881e3adaefc0542909e6f2a9a287f2`.
- `/usr/bin/fipsctl` SHA-256
  `15df75d3d9942747c62f690b0f4f5d5a2f9df45c976a96f4799a9574b988fab3`.
- fix16 validator artifact SHA-256
  `ede7ca2f1c02cd0da8245d0633ff0f0394839a182d1a81c1d8b23554550b208d`.
- fix16 authenticated evidence tool SHA-256
  `99ef8c7716f53f6dedefcbef7586a1674268cf8d69579168d35fc11afa865466`.

### Per-host network mapping

| Host | Public IPv4 | FIPS ULA |
|---|---|---|
| V1 | `172.105.64.142` | `fdc4:dc3c:6792:3f67:5b5d:453d:8712:b236` |
| V2 | `172.105.95.57` | `fd76:1a7b:b02d:6bd8:54e8:653f:110f:87be` |
| V3 | `172.104.240.217` | `fd52:1a36:50a9:0faa:3501:ce66:f3b8:7838` |
| V4 | `172.104.253.247` | `fd40:fda8:93de:8d8c:2bd1:b243:e607:7b7f` |

### Exact mutation class requiring later approval

On each VPS: verify/install only the selected bytes; generate/place one fresh
FIPS identity/config; open public TCP 8443 only to the other three validator
IPv4 `/32`s; build the exact three-peer ACL; bind Comet P2P to the host's FIPS
ULA; rewrite persistent peers to the other three ULAs; keep RPC loopback-only;
verify four-peer consensus and one-validator-offline commits; then remove the
direct public 26656 route so no clearnet fallback remains. V1 HTTPS 443 remains
separate and unchanged. A rollback must stop the affected validator, restore a
fully reviewed coherent config/firewall set, and never run direct and FIPS
meshes as ambiguous parallel authority paths.

These are live listener, firewall, credential and service mutations and are
not authorized by local-source work.

The previous local network-lab approval request is withdrawn. A source-level
`FipsMeshEvidenceV1` contract now requires actual owned socket/process/netns
attribution, advancing counters on both interfaces, refused direct-underlay
application connections, encrypted FIPS UDP observations and zero plaintext
marker matches. No harness has produced such evidence. A replacement approval
request will identify one frozen reviewed harness/hash and literal privileged
argv/environment; until then there is no executable FIPS approval package.

## 5. 24/7 versus fail-stop decision

The fix16 candidate uses `Restart=no` and `automaticRestartLimit: 0`. A crash,
reboot or resource ceiling requires a new reviewed ceremony. That is honest
fail-stop behavior, but it does not satisfy “validators online 24/7.”

Recommended safe options:

1. **Friday fail-stop demonstration:** retain fix16 unchanged, make no 24/7
   claim, and require operator recovery. Smallest reviewed surface.
2. **Keep validators online, quarantine signing:** separately review a
   validator/FIPS restart supervisor, but never automatically mark FROST safe.
   A restarted validator can rejoin consensus while its signer stays
   quarantined until state/epoch/policy checks pass. This best separates uptime
   from money safety but is more work.
3. **Automatic validator and signer recovery:** deferred. It needs an
   anti-rollback consistency domain and is not credible for the current Friday
   timebox.

Both consensus and FROST tolerate one member unavailable. Two correlated
failures stop progress. Four hosts under one operator demonstrate fault
separation, not independent administration.

## 6. Selected outbid return versus emergency refund rule

The design has two different exits and does not call either one an “instant
refund.” The owner delegated settling these rules for the fake-money Friday
route. They do not change the sealed R4.4.5 candidate.

1. **Cooperative outbid return:** a valid replacement bid must first commit and
   become the certified authority for displacement. That fact may authorize one
   exact pre-locktime `SIG_ALL` spend of the displaced auction-scoped inputs
   back to the bidder. It still needs the bidder side and the 3-of-4 committee
   side of the 2-of-2 condition. This is the normal prompt path.
2. **Emergency unilateral refund:** only after the Cashu locktime may the
   separate refund key use the timelocked branch. This is the liveness backstop
   if cooperative processing cannot complete; it is not the normal outbid
   path and it does not make an outbid return immediate.

The minimum cooperative lifecycle is:

1. The replacement bid commits, and `DemoAuthorityV1` verifies its canonical
   history and the displaced bid version.
2. One atomic authority transition changes the exact globally reserved proof
   Ys from `active` to `outbid_return_pending`. Those inputs cannot back another
   auction, raise, settlement or refund operation.
3. The executor loads one exact package bound to the chain, auction, displaced
   bid/version, displacement commit evidence, pool epoch, branch, operation ID,
   mint/unit/keyset, exact input proof Ys, fees, recipient and blinded outputs.
   The bidder has either signed that exact package at admission or signs it
   now. The FROST committee signs only after the authority transition.
4. Before contacting the mint, the executor durably records the operation and
   all recovery material. It submits or reconciles only that operation ID.
5. The UI remains `return_pending` or `outcome_unknown` until the mint result
   is reconciled and the recipient has imported usable proofs. Only then is the
   value spendable and the operation terminal. A mint outage or lost response
   cannot release the inputs or start a fresh payment.
6. After terminal return, rebidding requires newly verified backing. An own
   raise carries every proof in the exact active pool plus separately admitted
   top-up proofs into the replacement package while the bidder still owns the
   active high bid.

Bid admission **must** capture the bidder signature over the exact full-pool
return transaction, including inputs, outputs, active keyset and zero-fee
facts. Admission fails if this exact package cannot be prepared. This lets the
committee execute the normal return even when the displaced bidder is offline.
Fee or keyset drift never causes package rewriting: it fails closed and leaves
the pool unavailable until a still-valid package is reconciled or the
emergency branch becomes eligible.

### Auction-scoped pool implications

The selected rule is that each active auction pool equals the exact current
bid amount. A displacement returns that entire pool in one exact transaction;
there is no retained excess or split/remainder custody. An own raise forms a
new exact pool from every still-active prior proof plus separately admitted
top-up proofs. Proof Ys remain exclusive to one pool and one active auction.

Every own raise or top-up changes the pool/bid version and therefore requires
a new exact package before the new bid may commit. The prior version stays the
only authorized version until that atomic supersession. Old bidder signatures
are not revocable at the mint; committee policy and durable operation claims
must refuse them after supersession and must never issue two committee
signatures for competing packages.

The selected emergency locktime is:

`original end + 1,800 second maximum extension + 900 second recovery budget`.

The committee stops creating new MAIN authorizations 300 seconds before that
locktime. The 900 seconds provide 300 seconds for the MAIN cutoff plus 600
seconds for durable recovery/reconciliation. They are a bounded demo policy,
not a production SLA. The emergency refund key becomes eligible only at the
locktime.

A MAIN signature created before cutoff is not cryptographically revoked at
locktime. If that exact MAIN spend and the emergency REFUND both reach the
mint, the first valid mint spend wins. This residual first-spend race is
unavoidable with the selected NUT-11 contract and is explicitly accepted only
for this worthless-test-token route. The system does not promise refund
priority: it records the winning mint outcome, marks the losing branch spent,
and never retries it as a fresh payment.

“Prompt” therefore means processing begins after the displacement commit. Its
latency includes consensus/certification, durable authority transition, FROST
rounds, mint processing, reconciliation and recipient import. No seconds-level
guarantee is supported by current evidence.

### Historical timing facts

- The deployed Wednesday NUT-11 POC used an emergency refund locktime of
  auction end plus 60 seconds. That was a single-committee-key route and is not
  an approved Friday/FROST outbid deadline.
- The former SIG_ALL draft used a 60-second safety interval. The integrated
  local branch replaces it with the selected 300-second MAIN cutoff; old
  evidence remains historical and is not rewritten.
- Test values such as `100` and `2_000_000_000` are fixtures, not policy.
- The approved 180-second anti-sniping extension and 1,800-second extension cap
  govern auction closing, not refund eligibility.

## 7. Local integration allowed by the selected rules

The following local fake-only work may proceed without persistent credentials
or changing the sealed contract:

- implement TypeScript schemas and refusal-first logic for `DemoAuthorityV1`,
  while requiring real verifiers for each authoritative fact;
- freeze `SignerRPCV1` request/response and health-state schemas without
  opening a socket or choosing credentials;
- define rejection fixtures for stale keysets, duplicate proof Ys, bad H+1/H+2
  history, wrong branch/recipient, replayed sessions and rolled-back epochs;
- define `FipsMeshEvidenceV1` from real listener/peer/commit facts, never UI
  booleans;
- keep the current custodial rail and failing crash evidence isolated and fix
  its accounting independently.

No code may turn a missing verifier into an accepted flag
or report FROST/FIPS readiness from historical component evidence.

## 8. Remaining authorization boundary

| Choice | Current behavior | Recommended option and consequence | Authorized now / still gated |
|---|---|---|---|
| Outbid return and MAIN versus emergency REFUND | Selected locally: exact full-pool return is pre-signed at admission; H/H+1/H+2 displacement starts the cooperative return; locktime is maximum possible end +900s; committee MAIN cutoff is locktime -300s. A prior MAIN can still race the emergency refund. | Persist one branch operation before mint contact, reconcile unknown outcomes, and record whichever exact branch the mint accepts first. Never fresh-pay the loser. | Local fake-only implementation/tests are authorized. Persistent DKG identities, live signer/network mutation and deployment remain gated. |
| Four-host signer RPC | Existing FROST evidence is local stdio; FIPS membership is transport, not signer authentication. | Friday's real-integration claim requires four remote `SignerRPCV1` services with roster-pinned mutual application identities, transcript/session/restart binding and no public listener. Local stdio remains a testing stage only. | Canonical codecs, pure validators and replay/rollback refusal fixtures may proceed now. Generating identities, opening listeners, placing shares and starting services remain separately gated. |
| Validator restart and signer fail-stop | fix16 uses `Restart=no`; a failed validator and its signer remain down. | Allow a reviewed validator/FIPS supervisor to restore consensus availability while the signer stays quarantined until durable epoch/state checks pass. This supports validator uptime without pretending payment readiness. | Local unit/service-interface design may proceed now. Editing live units, installing FIPS, changing firewalls/listeners or allowing automatic signer recovery remains separately gated. |

The selected exact-bid NUT-11 proof pool, stable proof-Y reservation, separate
top-ups, and client-held bidder/refund keys are
not an instruction to bypass `DemoAuthorityV1`. Positive payment effects
remain refused until consensus history, global reservation, mint evidence,
exact branch binding and durable recovery are all present for the fake route.

The remaining choices are operational, not payment-rule ambiguity: whether
Friday's proof must extend from local four-process/FIPS rehearsal to persistent
four-host signers; the exact persistent signer identities/placement; the live
FIPS listener/firewall/service changes; and the reviewed validator-only restart
policy. Those mutations require one precise owner approval before execution.
