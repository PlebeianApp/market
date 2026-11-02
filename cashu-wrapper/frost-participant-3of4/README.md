# Fake-money 3-of-4 signer fork

This unpublished task-local crate starts from the exact generated source of
`coco-demo-frost-participant-3of4 0.1.0` recorded in
`SOURCE-PROVENANCE.md`. It retains the disposition commands and adds a separate
`COCO_DEMO_FROST_ADMISSION_3OF4_V1` protocol with these commands:

- `admission-commit CONFIG STATE_DIR AUTHORIZATION PUBLIC_OUT`
- `admission-share CONFIG STATE_DIR AUTHORIZATION COMMITMENT_BUNDLE PUBLIC_OUT`
- `admission-aggregate AUTHORIZATION PUBLIC_KEY SHARE_BUNDLE SIGNATURE_OUT`

Admission and disposition use distinct authorization, operation-root,
transcript, signature-message, durable-operation and nonce-journal domains. The admission
authorization binds exact unsigned funding-receipt bytes and hash, auction and
bid intent, funding operation, mint, complete proof-reference set, zero-fee
keyset, exact winner/return packages, four participant evidence records,
DKG/public package/roster, and validity interval. The final threshold signature
is over `SHA256("COCO_DEMO_FROST_ADMISSION_SIGNATURE_V1" || receipt_digest)`,
which the V2 funding-receipt verifier derives independently; a disposition
signature is not accepted as an admission signature.

This is fake-money POC source, not sealed R4.4.5, production custody, FIPS
validation, or a deployment artifact. It has not been built or tested in the
current source-only checkpoint.
