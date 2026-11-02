# Integrated terminal V1 bid-slot failure — 2026-10-22

- Source base: `712f4bec12309eab7b29bb498785dc1605243ee3` plus signer-local policy changes and stable finality/signed-bid evidence.
- Command: bounded `cashu-wrapper/ts/demo-integrated-frost-comet.live.test.ts` through `scripts/friday-integrated-frost-comet.sh`.
- Result: **FAIL** (`0 pass`, `1 fail`, `8 expect()` calls) in 60.74 seconds.
- Exact local refusals: participants 1, 2, and 3 each returned `DEMO_FROST_POLICY_CLOSURE: certified closure bidId mismatch`.
- Diagnosis: a provisional adapter change returned the actual displaced event id, but the admitted V1 pre-signed template and policy deliberately use the stable funding operation id in both legacy bid slots. The actual Nostr bid event remains independently authenticated and bound in the immutable displacement/signed-bid evidence digest.
- Safety boundary: all three signers refused before a threshold authorization or mint settlement.
- Cleanup: the wrapper stopped and waited for its owned mint, removed `/tmp/plebeian-friday-integrated.xLLok8`, and exited 1. No outcome was uncertain.
- Correction: restore the V1 funding-operation mapping and document the distinction rather than silently conflating operation and event identities.

No bearer proofs, private keys, mint seed, or signer shares are included here.
