# Side-quest deployable integration handoff

This directory binds the accepted public 3-of-4 DKG result and separated
runtime directly into the production Go initialization path. It is not a
server action, signature request or permission to repeat DKG.

Run the side-effect-free public check first:

```sh
python3 deploy/sidequest-mvp/verify-public-inputs.py
python3 deploy/sidequest-mvp/verify-artifacts.py
```

It checks every referenced file byte count and SHA-256, requires the runtime to
embed the exact accepted DKG result, and verifies the committee/package/roster
pins. It reads no owner key, validator share, proof or authentication database.
The second verifier pins the locally built browser, site, authority, terminal,
signer and recovery-operator artifacts plus the corrected transport sources.

## Missing values

Only these values remain unset in `deployment-inputs.json`:

- owner-selected new chain ID;
- canonical UTC genesis time;
- accepted mint-conformance receipt path and SHA-256;
- accepted active zero-fee SAT keyset ID;
- reviewed `/test-mint` transport URL;
- fresh authority output root and exact deployment-anchor signing approval.

The owner credential path is deliberately not recorded in this public file. It
may be supplied only inside the separately approved one-shot anchor-rendering
action.

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
