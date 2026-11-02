# Integrated terminal DLEQ omission failure — 2026-10-22

- Source base: `712f4bec12309eab7b29bb498785dc1605243ee3` plus signer-local policy and stable consensus evidence changes.
- Command: bounded `cashu-wrapper/ts/demo-integrated-frost-comet.live.test.ts` through `scripts/friday-integrated-frost-comet.sh`.
- Result: **FAIL** (`0 pass`, `1 fail`, `8 expect()` calls) in 66.12 seconds.
- Exact local refusals: participants 1, 2, and 3 each returned `DEMO_TERMINAL_WORKER_MINT: input DLEQ/keyset binding failed` through the fail-closed proof-use port.
- Diagnosis: the coordinator's strict policy projection omitted each proof's public NUT-12 DLEQ tuple, so a signer could not independently verify the mint signature even though the complete Coco proof had passed that check before projection.
- Safety boundary: all signers refused before threshold authorization or mint settlement.
- Cleanup: the wrapper stopped and waited for its owned mint, removed `/tmp/plebeian-friday-integrated.5KyqZu`, and exited 1. No outcome was uncertain.
- Correction: the authenticated signer-only policy can carry an exact optional `{e,s,r?}` DLEQ tuple; the concrete Friday signer still requires it and validates it against the pinned active keyset. No witness or private key is added.

No bearer proofs, private keys, mint seed, or signer shares are included here.
