# Friday R18 live attempt handoff

Recorded at `2026-10-23T18:09:26Z` against source/packet commit
`970026c5a5670594fcc5e43713821ccb72413cd7`.

The owner approved one execution of `FRIDAY-R18-DKG-CEREMONY-ACTION.md`
(SHA-256 `d48e1592ed9e8753e05d4edf66be0309f9cd26cd3ebd3c7784bf4214a0a7a29a`).
The attempt stopped during artifact staging, before the courier was initialized
and before any host DKG stage ran.

## Completed checks

- The expected SSH identity and pinned Ed25519 host keys authenticated all four
  fixed IPv4 targets.
- All four signed enrollment and host-pin file hashes matched the packet.
- Enrollment private paths were checked by metadata only; no secret content or
  secret hash was read.
- All four Wednesday validators were active with zero restarts and their
  recorded PIDs unchanged.
- No Friday process, listener, `fips0`, transport secret, R18 journal, R18 lock,
  manifest, digest pin, or DKG output existed before staging.
- Each host had more than 2 GiB available memory and 20 GiB free disk.
- The local host/courier/relay/participant/inspector/manifest/pin hashes matched
  the reviewed packet.

## Mutations completed

On each of the four validators, the root-owned mode-`0700` directory
`/var/lib/plebeian-auctions-friday-operator/dkg-ceremony-r18` was created and
fsynced. The approved host binary, participant binary, manifest and digest pin
were copied into it; V1/V3/V4 also contain the inspector binary, while V2
retains its already installed exact inspector. These are staging copies only.

No final executable or manifest destination was created. No attempt record,
transport key, pairwise secret, FROST share, journal, lock, public package or
operator courier root was created. No service, listener, FIPS mesh, Comet,
mint, browser or payment component was started.

## Exact blocker and outcome

Validator 1's first create-exclusive promotion call failed with:

```text
FileNotFoundError: /opt/plebeian-auctions-friday/bin/plebeian-friday-dkg-host
```

The destination parent `/opt/plebeian-auctions-friday/bin` does not exist.
The packet and its fresh preflight checked destination-file absence but omitted
creation/verification of this parent. The failure occurred before the first
destination file was opened, so the outcome is known: staged files only, no
ceremony or key effect. Per the approved stop-on-failure/no-retry rule, no
promotion was retried and no later phase was attempted.

Read-only post-failure verification confirmed on every host:

- the staged file set above remains under the protected action root;
- final host/participant destinations and host manifest remain absent;
- transport secrets, host journals, host locks and `fips0` remain absent;
- Wednesday remains active, zero-restart and on the same PID.

## Required next decision

Do not reuse the consumed execution approval. A corrected packet must specify
create-once root-owned `0755` creation and parent-chain verification for
`/opt/plebeian-auctions-friday/bin`, define whether the already staged exact
bytes are retained or replaced, and receive independent review plus fresh
owner approval. Existing staging must be inspected and bound by hash; it must
not be deleted or overwritten as an implicit cleanup or retry.

## Prepared correction — not authorized

A complete read-only follow-up audit found no other missing destination parent
or runtime dependency. V1/V3/V4 lack only the root-owned `0755` stable `bin/`
directory; V2 already has that exact directory and its accepted inspector.
All staged hashes still match, all final/transport/journal/lock/attempt paths
remain absent, the ELF loader plus libc/libgcc resolve, and `/opt` plus the
action root are on the same writable ext4 filesystem. `readelf` is absent but
is not required and must not be installed.

The correction is prepared but has not been reviewed, approved or executed:

- `FRIDAY-R18-DKG-CEREMONY-STAGING-AMENDMENT-R1.md` SHA-256
  `d407ecc69a5113fe0644d49d6d957bd3d7c46039c9f7be659c06eee0c63988a9`
- `FRIDAY-R18-DKG-CEREMONY-STAGING-AMENDMENT-R1-ACTION.json` SHA-256
  `b8e0a29ddfa795ba111b7e4d4ae500a864e4d6a05a6a017021346eaad4910780`
- `scripts/friday-r18-staged-promote.py` SHA-256
  `2563ebc98016f5382f367ea48fac04c3925dfbc4db3fac419a9453a0a4fab919`
- helper regression: 5/5 tests pass; Python compile and diff checks pass.

## Approved continuation stopped at enrollment assembly

At `2026-10-23T18:25:29Z`, the owner approved the exact amendment and one
continuation of the unchanged ceremony. Fresh checks passed on all four hosts.
The helper streamed from committed source `33ae89870416b5fa5882ad08ef7a81edb4e821b0`
and produced four exact promotion-completion records. All final executable,
manifest and pin hashes/modes were reopened successfully; V2's existing
inspector was retained rather than overwritten.

The pinned local courier initialized. Stage `enroll` then completed once on
all four hosts. The courier durably holds four create-exclusive invocation
claims, four DKG-identity-signed `PLEBEIAN_FRIDAY_DKG_HOST_STAGE_RECEIPT_V2`
receipts and four public enrollment artifacts with their hash receipts.

The first local `assemble enrollment` call failed before relay input with:

```text
EPERM: operation not permitted, send
Friday R18 DKG courier command rejected
```

This is the documented restricted-executor child-pipe denial: the courier
could spawn the pinned relay but the sandbox denied writing the JSON request
to its stdin. The exact outcome is known. No
`outputs/enrollments.bundle.json` exists; the relay did not process a request;
no bundle was uploaded and no host entered `confirm-transport`.

The ceremony stopped immediately. No pairwise secret, transport file,
round-one state, FROST share, service, listener, Comet, mint, browser or payment
component was created or started. Do not rerun the assembler outside the
sandbox or advance a host without a fresh explicit decision. Existing host
journals, public enrollment outputs, signed receipts and courier evidence must
remain preserved.

## Escalated assembly succeeded; upload did not start

The owner subsequently approved exactly one outside-sandbox execution of the
pinned local public assembly command. Fresh hashes and absence checks passed.
The command completed and durably created:

- `outputs/enrollments.bundle.json`, SHA-256
  `f440356c583cf8a771b6b86ed09e6335455d6ecac823c759471aa19dc28dae90`,
  2040 bytes, mode `0600`, with four entries and the pinned manifest digest;
- its courier file receipt, SHA-256
  `2e00e9d61f6dc2b07ce7c7facf1e2a034d46165cb94a65047ce85a8914d2cd71`.

The first attempted upload helper then failed locally before opening SSH. It
looked for `outputs__enrollments.bundle.json.json.json`, adding one `.json` too
many to the actual receipt path
`outputs__enrollments.bundle.json.json`. The outcome is known: no remote
command ran and read-only checks confirm `enrollments.bundle.json`, transport
secrets and confirmation outputs remain absent on all four validators.

No correction or upload retry was attempted. The verified public bundle and
all earlier evidence remain preserved. A corrected, reviewed exact upload
command plus a fresh decision are required before any host can enter
`confirm-transport`.

## Approved continuation reached an indeterminate slot-1 round one

The owner approved the one-line receipt-path correction and continuation from
the upload barrier. The upload helper now derives the controller receipt as
`outputs__NAME.json` (where `NAME` itself ends in `.json`), SHA-256
`625bf090609fdcb7eaad03713e1b13f8102ced28d15d98f99e58afd060049a4a`.
A no-network path-contract test, SHA-256
`a70410e5d98cdfa32f87206afa0266656bfac646d1138aadfab5a4a083c75810`,
passed 4/4 and checked every remaining global/recipient upload name plus the
controller's local-only outputs.

Fresh read-only checks proved all four hosts still had their completed
enrollment and journal, and lacked the enrollment bundle, confirmation output
and transport secret. The exact enrollment bundle was then installed
create-once on all four hosts with SHA-256
`f440356c583cf8a771b6b86ed09e6335455d6ecac823c759471aa19dc28dae90`.

`confirm-transport` completed once on slots 1..4. The captured public artifact
SHA-256 values were:

- slot 1: `e6af77db3d2a370a250d5d2a5f58bf4fafc6e6e4237ccebe45a579fe20a3e442`
- slot 2: `963d2f01298bedb3d78f7ff5a95a09f7b67e063fbb8577ffd9468a9f8ab712d1`
- slot 3: `03f31c285d693be26fa83b29073721b357f40b7b1bc49927c05d8c9590a1c439`
- slot 4: `c5d440130389b9b32ec5aafa68b9e3c2a0aab991bf631a8d448d121d6f55fe88`

The normal-sandbox confirmation assembly was denied by the same child-pipe
`EPERM` before outputs. Exact absence was verified, and the exact pinned
public-data-only assembly received normal escalation approval and succeeded.
Recipient-specific bundle SHA-256 values were:

- slot 1: `fad5e3081232fbf10c94d6bf43cef0d6a09afad64ffae01443606ea9ed6ba093`
- slot 2: `84b3b655ef33a6a8feeb367dd819bb71de00de9b376e6481a0e15c494b0ba288`
- slot 3: `166fa1337ca28c686c13aa983bc2f5f2ef273c03a22b1043b9aa0df7702e4fa8`
- slot 4: `5389a290e2f4c51fc7f30800fba85481f89f2efcb94986549ee119156c675d7a`

Each recipient bundle was installed only on its named slot. The
`persist-transport` stage then completed once on all four hosts. Pairwise
secrets therefore exist only on their legitimate endpoint hosts; no secret was
read, copied, hashed or returned to the operator. The local authenticated
barrier `persist-transport.complete.json` has SHA-256
`3ac0601ffb19370d141de4c0b34cf454fd8b4341fb70daa4e5edcc28829d0aef`.

The next stage, `round1`, was invoked on slot 1 only. It returned non-success
after the durable stage claim. The host journal records `round1: started`
followed by `round1: indeterminate`; its service-owned mode-0600 journal and
mode-0700 lock remain. `participant-1.round1.json` is absent and a fresh
executable-identity scan found no DKG host or participant process. Slots 2..4
were not invoked for round one.

Per the approved fail-closed recovery contract, do not rerun round one, remove
the slot-1 lock, or advance another host. The exact action outcome is
indeterminate even though no public artifact exists. It requires a separate
read-only inspection and explicit recovery decision; absence is not evidence
that private round-one state was never created. No service/listener, Comet,
mint, browser or payment component was started.

## Read-only slot-1 round-one diagnosis

A later, explicitly authorized read-only inspection made no host changes and
read no private key, pairwise secret, nonce, share or state contents. It found:

- the last durable records are `round1: started` followed by
  `round1: indeterminate` at approximately `2026-10-23T18:38:42Z`;
- the exact host-stage lock remains, owned by the now-dead host wrapper PID
  `123609`, boot ID `15a02667-f822-4d53-88bf-6cc7a518dda5`, start ticks
  `74886913`, participant 1 and the pinned manifest digest;
- no host-wrapper or participant executable is running;
- `participant-1.round1.json` is absent;
- the service-owned private state directory is still empty by directory-entry
  metadata: neither `participant.lock` nor `dkg-round1.state` exists, and its
  directory mtime predates the round-one attempt;
- the pinned host binary is unchanged at
  `f7b3923f4829acc7a837dc5fa54fe6f332003797dd560e9920bb58ab501baa4c`;
- the pinned participant binary is unchanged at
  `ed2014392707a00387570a56708e32dc7f7a50e3ab3acb11fb58672d75c7e578`;
- the public participant configuration exactly names the approved run,
  keyset, participant 1, roster `[1,2,3,4]`, and threshold 3-of-4;
- no public coredump record exists for the participant executable in the
  relevant window.

The exact intended child argv, reconstructed from the pinned host binary and
plan, is:

```text
/opt/plebeian-auctions-friday/bin/coco-demo-frost-participant \
  dkg-round1 \
  /var/lib/plebeian-auctions-friday/frost/keyset-v1/participant.config.json \
  /var/lib/plebeian-auctions-friday/frost/keyset-v1/state \
  /var/lib/plebeian-auctions-friday/frost/keyset-v1/transport-secrets.json \
  /var/lib/plebeian-auctions-friday/frost/keyset-v1/exchange/friday-demo-20261023-r14-dkg1/participant-1.round1.json
```

A no-argument startup-only probe under the identical UID/GID, cleared groups,
no-new-privileges and empty capability boundary returned the expected usage
error (exit 1, no stdout). This rules out a general executable-start/SIGILL
failure, but it does not prove that the original input-bearing child was
spawned.

The wrapper retained neither the child's numeric exit/signal nor its bounded
stderr. Therefore the exact original exit and sanitized error are not
recoverable from durable evidence. The empty state directory proves the Rust
participant did not durably acquire its `StateLock` or persist a round-one
secret. It does not distinguish host-side pre-spawn validation from Rust
config/transport read or validation before `StateLock::acquire`, nor can it
exclude ephemeral random material having existed only in a dead process.

The existing `recover-lock` path cannot recover this state: it authenticates
an already-durable public output and never re-invokes the participant, while
the required public round-one output is absent. Safe options require new
authority:

1. preserve this run permanently, repair diagnostics/preflight offline, and
   authorize a new reviewed DKG run (including freshly run-bound transport
   material); or
2. implement and independently review an explicit abort/reconciliation path
   that proves this exact empty-state condition, permanently terminates this
   run, and then starts a separately approved new run.

Deleting the lock, replaying round one in the same run, or advancing slots
2..4 is not a valid recovery option under the current packet.

A final metadata-only check verified slots 2..4 remain exactly before round
one: each retains its service-owned mode-0600 transport file, each private
state directory is empty, each host-stage lock and public round-one output is
absent, no matching process runs, and the local courier has no round-one claim
for those slots.

## Local diagnostic repair and disposable exact-binary reproduction

No live host, lock, journal, transport secret or ceremony state was changed
during this work. The R18 lock remains retained and slots 2..4 remain
unadvanced.

The host wrapper now writes a create-once mode-0600 sanitized failure record
before its indeterminate journal record. It retains only fixed classification
fields: pre-spawn/child/post-spawn/unknown phase, exit or signal, timeout,
bounded stdout/stderr byte counts and a closed diagnostic class. Raw stdout,
stderr, config, transport material, nonces and shares are never written to the
record. A fixture whose child printed a secret sentinel to stderr and exited
23 proved that only `nonzero_exit`, `23`, the byte count and
`redacted_nonempty` survived.

The exact pinned Rust participant binary
`ed2014392707a00387570a56708e32dc7f7a50e3ab3acb11fb58672d75c7e578`
was then run once against freshly generated, disposable deterministic fixture
identities and transport data below `/tmp`. The invocation used
`no-new-privileges`; the sandbox already had empty effective, bounding and
ambient capability sets. The sandbox would not permit clearing its injected
supplementary `nogroup`, so that is the one boundary difference from the live
service. The fixture created no listener or network connection and was removed
after the test.

That reproduction exposed a separate cross-language bug: Rust k256's
`Signer` hashes the framed message with SHA-256 before BIP-340 signing, while
the TypeScript host/relay/bootstrap code verified the unhashed frame. The Rust
child had completed successfully, but the TypeScript post-spawn verifier
rejected its valid round-one signature. The verifier and fixture signatures
are now aligned to `SHA-256(frame)` for round one and transcript agreement.
After the repair, the exact Rust round-one fixture completed, persisted its
private round-one state, emitted its authenticated public envelope, passed the
TypeScript verifier and left no failure record.

Observed local gates on the repaired source:

- exact pinned Rust disposable round one: PASS;
- host durability suite under the freshly compiled baseline Bun runtime:
  15/15 tests, 75 assertions, including the exact Rust child spawn/pipes,
  child exit classification, raw-stderr non-retention and the cross-language
  hash-contract rejection matrix;
- bootstrap suites: 14/14 tests, 71 assertions;
- relay cross-language rejection gate: 1/1 test, 8 assertions;
- relay pure tests: 7/7 passed; its eighth child-pipe CLI test remains blocked
  by the known restricted-executor `EPERM`, not counted as a pass;
- Friday TypeScript typecheck: PASS;
- compiled baseline host artifact: PASS build; its no-argument contract
  returned fixed stderr, zero stdout and exit 1 as expected.

This does **not** recover the original live failure. If the live Rust child had
completed and only hit the newly found post-spawn signature mismatch, its
create-new `participant-1.round1.json` and private `participant.lock` would
remain; both are absent. The exact original wrapper did not preserve
exit/signal/classification, so the live failure remains bounded to pre-spawn or
Rust config/transport validation before `StateLock::acquire`.

Accordingly, a same-run replay is still unsafe and no abort/new run is yet
authorized or justified as an execution step. The smallest next runtime probe
would be a separately reviewed, read-only Rust input validator that parses and
fully validates the live public config plus protected transport metadata but
does not acquire state, draw randomness or emit keys. Only after that result
should an explicit create-once abort marker permanently bind the old run's
manifest, all four persist-transport receipts, dead owner identity, empty-state
metadata and absence of public round-one output. A fresh run must use a new
run ID, manifest, keyset root, exchange/journals, courier claims and newly
run-bound endpoint-only transport material; no R18 private content may be
copied.

## R19 read-only input validator prepared — not remotely approved or run

A standalone 762544-byte Rust validator was built offline. It reuses the exact
round-one config/transport parsing and semantic validation functions, but its
entrypoint accepts no state or output path and has no reachable entropy,
key-generation, listener or network operation. Its SHA-256 is
`243910674f59a3cbb4c22a9ef3e351bd35fd75d6bd8fc49101ffdba1bddb9098`.

The validator uses descriptor-bound `O_NOFOLLOW|O_NOATIME` reads, pre/post
`fstat`, canonical paths and a 1 MiB bound. It does read V1's private transport
credentials into zeroizing memory on V1; it emits only a fixed pass/failure
category and no field, digest or raw error. Disposable compiled-CLI tests prove
input device/inode/mode/owner/group/size/SHA-256/mtime/ctime and directory
entries remain unchanged.

The proposed V1-only staging/invocation and the later abort/fresh-run design are
fully pinned in `FRIDAY-R19-READONLY-DKG-INPUT-VALIDATOR.md` and its receipt.
They remain **NOT_RUN** and require independent review plus exact action-time
approval. R18 remains locked and unchanged.

The exact successor packet hashes after correcting the draft's artifact-size
metadata and the final release traversal/preflight review findings are:

- proposal: `95c1ac2a70d95274fd2f21353da333903c280b8a0f2ab02ac77e36a3a28333fa`;
- action JSON: `9db175516e22870e25012884c37b4b4b706f209217f92cc0119b3582843aa21b`;
- receipt: `287d9c9423f640fac91f16e46bdf522241f2008af3f7f05ca9213f692a89211c`.

The helper keeps upload staging root-only `0700`, seals the promoted release
root-owned `0755`, and performs a real service-identity traversal/executable
check before reading either validator input. Its first literal action is now a
read-only R18 preservation check pinned to dead wrapper PID `123609`, boot ID
`15a02667-f822-4d53-88bf-6cc7a518dda5`, start ticks `74886913`, the exact
round-one `started`/`indeterminate` journal tail, an empty private state
directory and an absent round-one public output. Any mismatch stops the action.

The single proposed R19 action explicitly includes create-once staging of the
new validator binary on V1. It does not stage or run any DKG participant.

`FRIDAY-R20-FRESH-DKG-RECOVERY-PROPOSAL.md` records the downstream dependency
sequence and is SHA-256
`1cd378571fe1d0e3d09dd721fab58f46a1772e032415877351212e002be813d7`.
It is deliberately not an executable packet: authoritative R18 abort-marker
enforcement, existing-identity re-attestation for a new run, and an R20-bound
courier/manifest do not exist yet. R18 is preserved and stopped, not
authoritatively aborted or permanently quarantined.

## R19 final preservation review found an unavailable historical pin

The earlier diagnosis did not retain the SHA-256, byte size and exact link
count of the complete slot-1 host journal. The prior R19 draft checked only its
last two records, which is insufficient to prove the earlier completed
enroll/confirm/persist transitions are unchanged. No value was inferred or
invented.

The helper now validates the exact eight-transition journal structure and an
externally reviewed complete-file SHA-256/size/link-count pin. It also requires
the config and transport inputs to remain canonical single-link service-owned
0600 regular files and performs a non-logging `/proc/*/exe` scan for both
pinned DKG executables. Local fixtures pass 2/2, including whole-journal
mutation and executable-process detection.

Production preflight intentionally fails closed until a separately approved
bounded read-only `collect-r18-evidence` call returns only sanitized metadata:
the journal digest/size/uid/gid/mode/link count, input-file metadata, and a
boolean process-absence result. It never returns journal records, config or
transport contents, a transport digest, command lines, or environments. That
collection has not been run. Therefore R19 remains blocked rather than ready
for action-time approval.

Superseding blocked R19 local pins after adding the exact bounded evidence
collection contract and current-boot observation:

- evidence-collection action:
  `593ad6d94e36c61f1148e20b6cc4e0791d897bd0a406481fddef0b51926ab1f1`;
- validator action JSON:
  `c7656d37012cf3cc26eab90e0d3abbed953c8087b81498d84fd4fbec81384a7d`;
- receipt: `83977b19507ddc7ec5e7b43eb68ef8f9153ec1d40bc2d36bc8052dc194643fca`;
- proposal: `cfe8cd0758229703da16968cfaa040585e97087be2083bce59c9ab00f6f7bd94`;
- helper: `fbbbc91e7de26d29cf2e1c2b009bc367f6dafcbfceb58c0a9fbcd4723ccad722`;
- helper test: `7730557debc856d2aedff39c97f25966800023be748cf0c561310a4c2b329818`.

## R19 composite successor frozen for review

A4 accepted combining current-state collection and the one diagnostic into a
single explicit approval. The frozen successor seals the create-once artifact,
persists a root-owned 0600 baseline labeled
`CURRENT_STATE_NOT_HISTORICAL_PROOF`, immediately recollects every field, and
invokes the validator once only if the two complete JSON objects are equal.
Mismatch creates a sanitized failure outcome and forbids retry.

The helper now reads bounded files through EOF and requires the byte count to
equal the opened descriptor size. `/proc/*/exe` permission denial fails closed,
and executable matching uses both exact path and device/inode to detect
hard-link aliases. Four focused action tests pass, including equality,
mismatch-without-invocation, and a hard-link process fixture. Friday TypeScript
typecheck, JSON parsing and `git diff --check` pass.

Frozen R19 review pins (do not edit during review):

- helper: `e4276bd77eb5815523aee726d008266ae49df5c05f20484db5fd74673bd6e1b3`;
- helper test: `3cf8e914540cf8b1e34733bae56fbf0fd59f48abbb326e19047cfba2736cd960`;
- action: `e7f6d5965bb2962473d4146461f99b95588f7c17210b1c4c6e34fede24767ffb`;
- receipt: `fe1ee416e1a5fe910fe0bf74596dde465d4b9cd40df49f1261b274cbd74205e4`;
- proposal: `d7e308a60b00f9110d511e7e009727ca6e3f81da97c0288964a06478e98bd456`;
- superseded separate-collection record:
  `4d639b9bb2be2166ac79a20f9bd7820835e6020507f599685afba8120d0acda2`.

No remote command ran. The earlier SSH-agent listing remains denied by the
sandbox and was not retried through another route. It requires a separate
exact `require_escalated` read-only execution or an owner-terminal listing
before any approved composite action can authenticate.
