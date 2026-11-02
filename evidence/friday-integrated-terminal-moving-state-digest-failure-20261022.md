# Integrated terminal moving-state digest failure — 2026-10-22

- Source base: `712f4bec12309eab7b29bb498785dc1605243ee3` plus the uncommitted signer-local policy changes and bounded refusal observer.
- Command: bounded `cashu-wrapper/ts/demo-integrated-frost-comet.live.test.ts` through `scripts/friday-integrated-frost-comet.sh`.
- Result: **FAIL** (`0 pass`, `1 fail`, `8 expect()` calls) in 68.42 seconds.
- Exact local refusals: participants 1, 2, and 3 each returned `DEMO_FROST_POLICY_CLOSURE: closure evidence digest mismatch`.
- Diagnosis: the coordinator's policy digest included its current authenticated state observation S. Each independent signer queried a later valid S, so otherwise equivalent displacement certificates had different digests. The same instability existed in the admitted-bid evidence digest.
- Safety boundary: all three signers refused before producing a usable threshold authorization or contacting the mint for settlement.
- Cleanup: the wrapper stopped and waited for its owned mint, removed `/tmp/plebeian-friday-integrated.dQMpem`, and exited 1. No outcome was uncertain.
- Correction: retain participant-local S/S+1 authentication but bind the signed policy to immutable admitted bid facts and H/H+1/H+2 displacement finality. A focused regression proves later authenticated S observations retain the same finality digest while an altered finality commit changes it.

No bearer proofs, private keys, mint seed, or signer shares are included here.
