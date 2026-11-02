# Side-quest deployable integration handoff

This directory binds the accepted public 3-of-4 DKG result and separated
runtime directly into the production Go initialization path. It is not a
server action, signature request or permission to repeat DKG.

Run the side-effect-free public check first:

```sh
python3 deploy/sidequest-mvp/verify-public-inputs.py
python3 deploy/sidequest-mvp/verify-artifacts.py
python3 -I -S -B deploy/sidequest-mvp/test_successor_release.py -v
python3 -I -S -B deploy/sidequest-mvp/test_runtime_adoption.py -v
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
runs each installed role guard, renders the current incomplete inputs as inert
configuration, then renders a fully bound synthetic fixture and passes the
accepted five-host `verify_values` contract for APP site/authority/coordinator
and V1-V4 signers. It performs no service or network action.

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
  capture current UTC exactly once when the final signing inputs are frozen.
- the owner-supplied payment projection and mint-only reconciliation, including
  active SAT keyset ID `001a10236c313f83`, its independently recomputed public
  ID digest, and the owner-verified receipt digest claim.

No genesis content choice remains. The single canonical UTC timestamp was
captured at the final input freeze as `2026-11-02T18:35:21Z`; every lane and
host must reuse it unchanged. The frozen input record SHA-256 is
`e8639dae8da64d5d2c35721c43c7097af2a4844eaedd0076ad62ad38d4f9c9c2`.
Its unsigned 2,077-byte signing message has SHA-256
`757b4855ed30d05d474636f60ecfa4e8388ef841ba27b39fb83c127e4f0c4d6b`.
Independent freeze review is accepted at SHA-256
`4d002c529f058e9beac785cbc689212531447f8a0a92cf055b7e0a0fb1d5352d`;
no signature or execution authority was created.

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

The deployment anchor/FundingAbort bootstrap, network facts/genesis bundle,
browser/health pins and observer receipt/node ID are downstream products after
those inputs, not missing selections. Fresh output-root selection and signing,
install, configuration and activation grants are separate action scopes.

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
2. Runtime configuration/genesis: after a separate signing grant, render and
   install the selected chain, exact frozen
   genesis timestamp, accepted payment/keyset/mint inputs,
   deployment anchor, observer, network, browser and health pins. No DKG
   repeat.
3. Runtime artifact adoption: install the exact APP successor release and
   authority/coordinator units, then the exact signer release/unit on each of
   V1-V4. Preserve `separated-deploy-v1`, validator node binaries, participant
   binaries, DKG shares and per-slot confinement drop-ins.
4. Activation: start the already installed exact graph in dependency order
   only after the pre-start verifier passes. This needs its own approval.
5. HTTPS/firewall and the five-profile browser rehearsal are separate scopes.
   Validator-4 stop and start/rejoin each require their own approvals.

## Production command shape after those values are accepted

The deployment owner should substitute the accepted values into this existing
production command; do not run it as a probe because it reads the owner key:

```sh
./dist/sidequest/plebeian-auctions-mvp render-friday-comet-authority \
  --output-root "$FRESH_AUTHORITY_OUTPUT_ROOT" \
  --frost-final-public /home/maximoto/Documents/Codex/2026-10-28/task-2/dkg-attest-controls-r1/evidence/authenticated-dkg-result.json \
  --expected-manifest-digest 8dee718183fe708b61c11e809731916af78a01ed09572995e6e8e5b62d616818 \
  --owner-approval-private-key "$OWNER_PRIVATE_KEY_PATH" \
  --chain-id "$CHAIN_ID" \
  --genesis-time "$GENESIS_TIME_UTC" \
  --active-keyset-id "$ACTIVE_SAT_KEYSET_ID" \
  --separated-bootstrap /home/maximoto/Documents/Codex/2026-10-28/task-2/owner-pre-dkg-bootstrap-signing-r1/outputs/pre-dkg-bootstrap.signed.json \
  --separated-runtime-binding /home/maximoto/Documents/Codex/2026-10-28/task-2/post-dkg-genesis-prerequisites-r1/separated-runtime-binding.json \
  --predecessor-manifest /home/maximoto/Documents/Codex/2026-10-28/task-2/committee-initialization-adapter-r3-normal-pins/ACTION-APPROVED.json \
  --expected-separated-bootstrap-digest 9fb672320d8188a7e63752c0a435a3d96f2122f6f378b555a729ea4c2a625ca9 \
  --expected-separated-runtime-digest ae4fc0a988cfacac5beca7d28fbbed12ada64c851a751fb4dfa71de21529dc72 \
  --mint-conformance-receipt "$MINT_CONFORMANCE_RECEIPT" \
  --mint-conformance-receipt-sha256 "$MINT_CONFORMANCE_SHA256"
```

Successful rendering produces the FundingAbort bootstrap, signed deployment
anchor and public authority receipt in the fresh output root. Validator
initialization, genesis assembly and service activation remain separate owner
actions and must consume those exact outputs.

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
