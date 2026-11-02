# Integrated terminal-policy failure — 2026-10-22

- Source base: `712f4bec12309eab7b29bb498785dc1605243ee3` plus the then-uncommitted signer-policy changes.
- Command: the bounded `cashu-wrapper/ts/demo-integrated-frost-comet.live.test.ts` live test, using an isolated throwaway Nutshell 0.19.2/FakeWallet mint and local four-node Comet fixture.
- Result: **FAIL** (`0 pass`, `1 fail`, `8 expect()` calls) after approximately 58 seconds.
- Refusal: `DEMO_FROST_POLICY_SHAPE: committeeLockedProofs[0] contains missing or unexpected fields`.
- Scope: the strict participant policy validator refused the coordinator-built package before a terminal signer nonce or mint disposition was used. The harness had spread the complete Coco proof object, including optional fields, where the versioned policy schema permits only `amount`, `id`, `secret`, and `C`.
- Cleanup: the wrapper stopped and waited for its owned mint, removed the isolated `/tmp/plebeian-friday-integrated.H7L9wD` root, and left no known test service running. No outcome was uncertain.
- Correction: project the four schema fields explicitly. This record is retained as failed evidence; it is not rewritten as a pass.

No bearer proofs, private keys, or mint seed values are included here.
