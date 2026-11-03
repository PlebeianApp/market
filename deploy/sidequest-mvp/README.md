# Side-quest deployable integration handoff

This directory binds the accepted public 3-of-4 DKG result, separated runtime,
payment projection and accepted signed authority outputs directly into the
production Go initialization path. It is not a server action, a request to
rerender or resign, or permission to repeat DKG.

Run the side-effect-free public check first:

```sh
python3 deploy/sidequest-mvp/verify-public-inputs.py
python3 deploy/sidequest-mvp/verify-artifacts.py
python3 -I -S -B deploy/sidequest-mvp/test_successor_release.py -v
python3 -I -S -B deploy/sidequest-mvp/test_runtime_adoption.py -v
python3 -I -S -B deploy/sidequest-mvp/test_genesis_assembly_preparation.py -v
```

It checks every referenced file byte count and SHA-256, requires the runtime to
embed the exact accepted DKG result, and verifies the committee/package/roster
pins. It reads no owner key, validator share, proof or authentication database.
The second verifier pins the locally built browser, site, authority,
coordinator, terminal, signer and recovery-operator artifacts plus the
corrected transport sources.

The third command performs a real composed APP installation against a fresh
`/tmp` filesystem fixture. It uses the actual site, authority, coordinator and
terminal binaries, exact accepted predecessor release, successor unit and
pre-start guards, fake systemd command boundaries, atomic create-once
publication, retained predecessor unit bytes, a journal and a final receipt.
It proves the checked-in blocked template and a repeated install fail closed.

The fourth command composes the APP release plus four distinct validator signer
releases from the actual built binaries. It verifies every binary/unit hash,
runs each installed role guard, validates the accepted signed anchor,
FundingAbort bootstrap and authority receipt, renders the current incomplete
inputs as inert configuration, then renders a fully bound synthetic fixture and
passes the accepted five-host `verify_values` contract for APP
site/authority/coordinator and V1-V4 signers. It performs no service or network
action.

The fifth command validates the genuine accepted signed anchor and corrected
public reconciliation, the exact accepted descriptor handoff and all four
signed public descriptors. It pins the actual Go assembler binary, renders its
sole invocation, reproduces the genuine public assembly in a temporary root,
and rejects any descriptor substitution against the accepted handoff.
No validator key or private descriptor state is created or read; test bundles
are public-only and confined to temporary roots.

## Immutable APP release boundary

The currently installed inactive APP site is the earlier immutable release
`separated-site-browser-r2`. Its accepted installed unit (SHA-256
`475a8532c4a504c08cd8e5ae48495adaf53a2d4f6ee7cf8dc12d2b82a460f6f4`)
correctly executes
`/opt/plebeian-auctions-friday/releases/separated-site-browser-r2/bin/plebeian-auctions-mvp`;
it does not use the older `separated-deploy-v1` path found in the repository's
base example unit.

The side-quest artifacts in this directory are newer and must not overwrite or
be copied into that accepted release. A separately reviewed create-once
successor release and a unit bound to that exact successor path are required
before activation. The existing installed unit and binary are therefore not
evidence that this side-quest build is installed.

`successor-install-manifest.json` and `install-successor-release.py` implement
the create-once inactive APP release shape, containing the site, authority,
coordinator and terminal artifacts together so the immutable root never needs
an in-place addition. The checked-in manifest is
`DRAFT_NOT_AUTHORIZED`, with install approval false, and the controller refuses
to use it against production paths. It can run only against an explicit child
of `/tmp`. A future exact owner action must pin the controller, manifest,
artifacts, predecessor tree and unit, then change only the authorization fields
under independent owner scope. The installer never starts, enables, restarts or
stops a service and performs no runtime-configuration write.

`runtime-bindings.template.json` is likewise fail-closed. The installed unit
will not pass `verify-successor-runtime.py` until the template is rendered as a
new exact file with status `READY_FOR_SCOPED_ACTIVATION`, every public input
filled, exact `friday.env` and `application.json` hashes, and separately scoped
configuration-install and activation approvals.

## Input reconciliation

The following are already accepted and must be reused, not requested again:

- deployment, application-run and DKG-run IDs;
- APP/V1-V4 host IDs, IPv4 addresses, FIPS ULAs/npubs and signer identities;
- owner approval public key;
- accepted DKG result, committee key, manifest/package/roster digests and the
  exact separated runtime binding;
- canonical mint origin `https://139.162.161.233` and the selected 10,000 sats
  per-request / 50,000 advisory balance limits;
- accepted GET-only bootstrap evidence, receipt hash and active-keyset digest;
- owner-selected chain ID `plebeian-auctions-mvp-20261102` and the policy to
  capture current UTC exactly once when the final signing inputs are frozen;
- the owner-supplied payment projection and mint-only reconciliation, including
  active SAT keyset ID `001a10236c313f83`, its independently recomputed public
  ID digest, and the owner-verified receipt digest claim;
- signed deployment anchor SHA-256
  `777e3df52fc4abcff952d27dc7399af99554cba2c4082211f909f5d8c9ecf1eb`,
  FundingAbort bootstrap SHA-256
  `ee4e7fbf23f9e66731b1d908979875aac3fbeec9c1fa54f0a9ae5fa507e2f2cf`
  and authority receipt SHA-256
  `ca250b51b7dc17f51cca678e11be8180bd047a28d2675e012af70ee70506f0c2`.

No genesis content choice remains. The single canonical UTC timestamp was
captured at the final input freeze as `2026-11-02T18:35:21Z`; every lane and
host must reuse it unchanged. The frozen input record SHA-256 is
`e8639dae8da64d5d2c35721c43c7097af2a4844eaedd0076ad62ad38d4f9c9c2`.
Its unsigned 2,077-byte signing message has SHA-256
`757b4855ed30d05d474636f60ecfa4e8388ef841ba27b39fb83c127e4f0c4d6b`.
Independent freeze review is accepted at SHA-256
`4d002c529f058e9beac785cbc689212531447f8a0a92cf055b7e0a0fb1d5352d`;
that frozen record is intentionally still an unsigned-input record. A later
owner render produced the accepted public signed outputs above. Their
independent public review is SHA-256
`da8348fc1d0ae237ad2e9db1437eb68836c9c9e0310d3b506528845a0e04cbf1`
at
`/home/maximoto/Documents/Codex/2026-10-30/task/genesis-owner-render-actual-public-review-20261102/INDEPENDENT-REVIEW.md`.
The signed anchor binds the exact frozen preimage, accepted DKG result,
`f671...` payment-projection bytes, canonical Cashu identity and four-member
roster.

The historical controller's final state remains `STOP_NO_RETRY` because its
post-render verifier encountered a recursive JSON property-order defect. The
accepted independent review records the renderer exit as settled and the
signature as valid for the exact frozen preimage. Preserve that historical
STOP: rerendering and resigning are not authorized or needed for this handoff.
The corrected public-verifier successor and genuine-output reconciliation are
independently accepted at SHA-256
`1ce5295130e9b358826b9d2f69a737c6895e97ecde284745348093dc1e6c9718`.
The reconciled result itself is SHA-256
`f454abb91fce96e381d4c61db20b72770ecfcd5527c4ddbb0680a15edae04aaf`.
It closes the property-order defect without modifying the original STOP or
creating another signature.

The production authority renderer requires an owner-reviewed receipt file and
the SHA-256 of those exact bytes. It checks that the file exists, is 2 bytes to
1 MiB and matches the supplied digest; it does not require the private raw
receipt, proofs or a separate genesis-payment approval. The accepted sanitized
projection satisfies that existing contract at path
`/home/maximoto/Documents/Codex/2026-10-26/task-3/prototype/wednesday-shell-r20-core/mint-payment-public-receipt-projection-r1/OWNER-SUPPLIED-PUBLIC-PROJECTION-R1.json`
with SHA-256
`f671be3673fed9f074cd142640e38bc7c2fb98002881164895477e1f4d9523da`.
The underlying raw-receipt digest `b5bac575...` remains owner-verified
provenance and is not substituted for the projection file's digest. No private
proof transfer is required.

Three mint URL roles are bound without conflation:

- `http://[fdb2:77a9:c591:3ac6:3513:5bf8:cc3b:5a04]:3438` is the private FIPS
  Cashu server transport used by the conformance client;
- `https://139.162.161.233` is the canonical public Cashu mint identity already
  fixed by the separated bootstrap;
- `http://127.0.0.1:8180/test-mint` is the selected separate loopback
  legacy-note namespace required by `assemble-friday-comet`. Port 8180 is the
  site/API process; a composed handler test confirms the path returns 404, not
  a mint API. The FROST application has no corresponding legacy private key,
  and all real fake-Cashu funding uses the distinct public Cashu identity.
  This later assembly mapping does not alter the accepted anchor/preimage.

The deployment anchor, FundingAbort bootstrap and public authority receipt now
exist as accepted public outputs. Network facts/genesis bundle,
browser/health pins and observer receipt/node ID remain downstream products,
not missing content selections. Install, configuration and activation grants
remain separate action scopes.

The owner credential path is deliberately not recorded in this public file. It
may be supplied only inside the separately approved one-shot anchor-rendering
action.

The corrected GET-only Coco bootstrap is now accepted as a limited milestone:
acceptance report SHA-256
`734ebc54830e867a3c77441f56d0c3019f08efee5b64a69959ea888110d342ad`,
owner-verified receipt SHA-256
`a9452ede2dc7704036a9d1f9e5b18b53a6f4b0523d5438e50087f3e160599d9d`,
seven GETs and 17,479 accepted bytes, no funding or persisted wallet, with the
mint stopped and settled. This is explicitly not payment conformance and does
not fill the payment receipt fields above.

The later owner projection reports the six expected mint-only operation kinds,
two 10,000-fake-sat faucets, 120/180 locks, complete refund/settlement
conservation, zero fees, Nutshell 0.19.2 and 46 bounded exact-FIPS requests.
Its reconciliation report SHA-256 is
`9139b1ec862535fbbaad59c19351f81a5987d00aa78618340f63d11700df94da`.
It explicitly used one shared application key rather than FROST custody,
disposable memory-only wallets with no recovery or retry, and does not prove
browser login, auction selection, automatic settlement, HTTPS or deployment.

## Required action scopes

The remaining changes must stay separate and exact:

1. APP inactive successor install: create the immutable site release, retain
   the current unit, reload systemd, and leave the site inactive. No config or
   service action.
2. Runtime configuration/genesis: derive and validate the network facts/genesis
   bundle from the already accepted signed authority outputs, then install the
   selected chain, exact frozen genesis timestamp, accepted
   payment/keyset/mint inputs, deployment anchor, observer, network, browser
   and health pins under a separately scoped configuration grant. No DKG
   repeat and no rerender/resign.
3. Runtime artifact adoption: install the exact APP successor release and
   authority/coordinator units, then the exact signer release/unit on each of
   V1-V4. Preserve `separated-deploy-v1`, validator node binaries, participant
   binaries, DKG shares and per-slot confinement drop-ins.
4. Activation: start the already installed exact graph in dependency order
   only after the pre-start verifier passes. This needs its own approval.
5. HTTPS/firewall and the five-profile browser rehearsal are separate scopes.
   Validator-4 stop and start/rejoin each require their own approvals.

## Accepted authority output consumption

Do not run the owner-key renderer as a probe or successor step. The canonical
public output root is
`/home/maximoto/Documents/Codex/2026-10-28/task-2/genesis-owner-authority-render-r1/output`.
Validator initialization, genesis assembly and service activation remain
separate owner actions and must consume the exact accepted files from that
root. `owner-decisions.template.json` and `runtime-adoption-plan.json` pin all
three files and the independent review, and `render-runtime-config.py` refuses
source drift or a substituted anchor.

## Sole genesis assembler preparation

`genesis-assembly-plan.json` binds the genuine anchor, authenticated DKG,
FundingAbort bootstrap, separated runtime, corrected public reconciliation,
chain/time, both mint URL roles and the 10,000/50,000 fake-funding limits. The
only assembler remains the production Go
`internal/poc/friday_comet_init.go:AssembleFridayCometGenesis` implementation,
invoked through `plebeian-auctions-mvp assemble-friday-comet`; no second
assembler or approval controller was added.

The non-executing preparation check is:

```sh
python3 -I -S -B deploy/sidequest-mvp/prepare-genesis-assembly.py \
  --plan deploy/sidequest-mvp/genesis-assembly-plan.json \
  --bundle-root /tmp/plebeian-sidequest-genuine-assembly-uncreated
```

It now returns `READY_FOR_SOLE_ASSEMBLER_VALIDATION_NOT_EXECUTED` with the four
accepted slot-bound public descriptors. Their independent acceptance is
SHA-256 `8cfa01ca5a75fab9b4c267620cf50db4ab4e2db256caa87d56d2202e350c5b48`,
and the exact public handoff is SHA-256
`8475fb80c799aeaabe04dac3628dc7947a928f4332f546ed86686d11d5f9d693`.
The existing source of each descriptor is
`InitFridayCometValidator`, exposed as `init-friday-comet-validator` with a
fresh absolute per-host home, the accepted anchor, pinned owner public key and
that host's slot. Its sole export is `validator-public.json` mode 0644.
`node_key.json`, `priv_validator_key.json` and
`priv_validator_state.json` remain beneath the private per-slot home and must
never be exported.
The preparation check never initializes validators or reads private state. It
renders but does not itself execute the assembler; the Go assembler remains
responsible for descriptor signatures, distinct roster membership and all
genesis semantics.

The real public assembly completed locally at
`dist/sidequest/genesis-assembly-r1`. Its exact inventory and verification are
recorded in `genesis-assembly-actual-r1.json`. Bundle digest is
`830b87e49bf4ef0ee66664b9b757344a8c9ae8a582473fe28351e8571a7180cf`,
genesis file SHA-256 is
`8574fadb77fafea9c56fff7cff32af0205be7b2e05d12f1ab1fcf4a1a8f3a4ea`,
and validators hash is
`d1936c5e5e9d09d0a96107031ae144068dcc2ad3f1d071e7f8fe871a8aaff773`.
This is a local public artifact, not installation, finalization, launch-seal,
observer, service or live-consensus acceptance.

The actual public bundle is independently accepted by review SHA-256
`3060b528aed4a3b105a8d86cc70ca624d39b8d825284347ce4bd554164a54b03`.
The review matches all four descriptors, the owner anchor/chain/frozen time,
authenticated DKG result, separated runtime binding, mint projection and
assembled semantic identities. Its nonblocking provenance qualification is
preserved: binary metadata alone does not prove a clean build from commit
`6562b35`; the relevant assembler source is unchanged and the public result
independently verifies.

## Resume checkpoint: validator finalization and APP observer

`validator-finalization-stage-plan.json` is the command-ready, non-executing
checkpoint for the next owner session. It pins all 51,325 bytes of the nine-file
public bundle, the four accepted host identities/descriptors and the already
installed R4 finalizer at
`/opt/plebeian-auctions-friday/releases/separated-deploy-v1/bin/plebeian-auctions-poc`
(SHA-256 `8f501da6c7b054d3b33f98f4be52c0299655fc52756af70cd59cbc5740afd7c4`).
No new validator release is required for this step.

The next grant can be limited to a read-only state check, creation of one
digest-named public staging directory on
V1-V4, and exactly one `finalize-friday-comet-validator` invocation per slot.
That command validates the existing local keys and fresh height-zero signing
state, installs only exact public files, and creates one public signed
`validator-final-ack.json`. It does not replace/export keys, change ownership,
touch DKG/FROST shares, or operate services. Byte-identical files from an
interrupted finalization are preserved; conflicting files or an existing ack
stop the action. There is no automatic retry or cleanup.

APP observer initialization is deliberately outside that grant. It requires a
fresh absent APP network root and creates a new non-voting P2P transport key in
addition to the public bundle and observer receipt. Its exact `init-observer`
argv and effects are pinned in the same plan, but need a separate owner grant
after APP root/binary reconciliation. Launch-seal installation, UID999
ownership handoff and service activation remain later, separate actions.

## Validator-4 rejoin control

The source now provides `validator-4-online` in
`demo-friday-acceptance-operator-cli.ts`. A live invocation requires a fresh
separate `START_VALIDATOR_4_ONCE` approval and these exact pins:

```text
validator-4-online --approval ABS --approval-sha256 HEX --unit-sha256 HEX \
  --probe-sha256 HEX --chain-id ID --validators-hash HEX \
  --validator-addresses A1,A2,A3,A4
```

It consumes a recovery approval under a separate create-once root, verifies the
unit, requires inactive state, starts only V4, and withholds completion until
the pinned canonical Comet commit contains all four roster signatures. This is
implemented and locally tested, but is not installed or authorized remotely.
