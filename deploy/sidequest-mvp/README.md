# Side-quest deployable integration handoff

This directory binds the accepted public 3-of-4 DKG result and separated
runtime directly into the production Go initialization path. It is not a
server action, signature request or permission to repeat DKG.

Run the side-effect-free public check first:

```sh
python3 deploy/sidequest-mvp/verify-public-inputs.py
python3 deploy/sidequest-mvp/verify-artifacts.py
python3 -I -S -B deploy/sidequest-mvp/test_successor_release.py -v
```

It checks every referenced file byte count and SHA-256, requires the runtime to
embed the exact accepted DKG result, and verifies the committee/package/roster
pins. It reads no owner key, validator share, proof or authentication database.
The second verifier pins the locally built browser, site, authority,
coordinator, terminal, signer and recovery-operator artifacts plus the
corrected transport sources.

The third command performs a real composed installation against a fresh `/tmp`
filesystem fixture. It uses the actual 46 MB site artifact, the exact accepted
predecessor release, the successor unit, the pre-start runtime verifier, fake
systemd command boundaries, atomic create-once publication, retained predecessor
unit bytes, a journal and a final receipt. It then executes the installed
runtime verifier with a complete fixture configuration, proves the checked-in
blocked template is rejected, and proves a repeated install stops without
changing the receipt.

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
that create-once inactive APP installation shape. The checked-in manifest is
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

## Missing values

Only these values remain unset in `deployment-inputs.json`:

- owner-selected new chain ID;
- canonical UTC genesis time;
- accepted payment-conformance receipt path and SHA-256;
- accepted active zero-fee SAT keyset ID;
- reviewed `/test-mint` transport URL;
- fresh authority output root and exact deployment-anchor signing approval.

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

## Required action scopes

The remaining changes must stay separate and exact:

1. APP inactive successor install: create the immutable site release, retain
   the current unit, reload systemd, and leave the site inactive. No config or
   service action.
2. Runtime configuration/genesis: render and install the owner-selected chain,
   accepted payment/keyset/mint inputs, deployment anchor, observer, network,
   browser and health pins. No DKG repeat.
3. Runtime artifact adoption: create-only APP releases for the rebuilt
   authority/coordinator/terminal artifacts and V1-V4 releases for the signer
   artifact, each with exact unit/path rebinding. These are not effects of the
   site installer.
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
