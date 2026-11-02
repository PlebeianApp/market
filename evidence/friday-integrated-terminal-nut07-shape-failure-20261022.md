# Integrated terminal NUT-07 shape failure — 2026-10-22

- Source base: `712f4bec12309eab7b29bb498785dc1605243ee3` plus signer-local policy, stable consensus evidence, and DLEQ transport changes.
- Command: bounded `cashu-wrapper/ts/demo-integrated-frost-comet.live.test.ts` through `scripts/friday-integrated-frost-comet.sh`.
- Result: **FAIL** (`0 pass`, `1 fail`, `8 expect()` calls) in 60.32 seconds.
- Exact local refusals: participants 1, 2, and 3 each returned `DEMO_NUT07_RESPONSE: states[0] has a non-exact shape`.
- Diagnosis: the strict parser expected only `Y` and `state`, while Nutshell 0.19.2 and the installed Cashu client type return the NUT-07 proof-state shape `{Y,state,witness}`, with `witness: null` for unspent/pending proofs.
- Safety boundary: all signers refused before threshold authorization or mint settlement.
- Cleanup: the wrapper stopped and waited for its owned mint, removed `/tmp/plebeian-friday-integrated.EPsmZO`, and exited 1. No outcome was uncertain.
- Correction: require the exact three-field response; accept only null/string witness and require null unless the state is `SPENT`. Witness contents are neither persisted nor copied into evidence.

No bearer proofs, private keys, mint seed, or signer shares are included here.
