# Friday FROST Admission Evidence Correction

This note narrows two labels in frozen evidence without rewriting the original
artifacts.

- Source checkpoint: `77bcaccc4cf09b21a9be0ddb2029d0363e48aba1`
- Evidence-record commit: `1061c92`
- Admission evidence:
  `friday-frost-admission-interoperability-20261022.json`
- Admission evidence SHA-256:
  `f53c5ce7417aff33c94bb30878ccdaf1642d32e7c3b15e261d1287c86c51d257`
- Fault-matrix evidence:
  `friday-fault-matrix-20261022T144716Z-1288439.json`
- Fault-matrix SHA-256:
  `6450717045f514ad2acc631fc129797b7ef27ad7be3b36b219a7fd568d6d7d20`

## Participant-four wording

`dealerless_dkg.withheld_participant: 4` means participant four's signature
share was omitted from the threshold-three aggregate. The test harness still
obtained policy evidence from all four participant policy services before
signing. The run proves a real 3-of-4 Rust FROST signature and Go verification,
but it does **not** prove admission continues when a participant policy service
is unavailable.

## Pending wording

`conservation.pending: 0` in the fault matrix is the application-ledger pending
bucket at the recorded observation point. It is not a global zero-pending
claim. The same artifact records the recoverable Coco send-operation row as
`pending`; recipient ownership and the total-value assertion passed while that
durable recovery state remained.

## Readiness decision

Independent read-only adversarial review keeps this integrated candidate
**NOT READY**. Three P1 blockers remain:

1. admission waits for all four policy services even though only three
   signature shares are required;
2. the consensus-visible admission receipt/signature lacks an authenticated
   chain/network and participant-policy-transcript binding; and
3. the direct admission signer journal lacks an independent stale-restore and
   epoch anchor.

The original JSON files, their hashes, and their positive interoperability and
fake-mint observations remain preserved. This correction makes no FIPS,
live-Comet, four-host policy, unified terminal-payment, deployment, or
production-readiness claim.
