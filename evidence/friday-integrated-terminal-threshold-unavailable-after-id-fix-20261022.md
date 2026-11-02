# Integrated terminal threshold failure after bid-identity correction — 2026-10-22

- Source base: `712f4bec12309eab7b29bb498785dc1605243ee3` plus the uncommitted signer-policy changes, exact-proof projection, and displaced bid/event identity correction.
- Command: bounded `cashu-wrapper/ts/demo-integrated-frost-comet.live.test.ts` through `scripts/friday-integrated-frost-comet.sh`.
- Result: **FAIL** (`0 pass`, `1 fail`, `8 expect()` calls) in 66.13 seconds.
- Refusal: `DEMO_MAINTAINER_THRESHOLD_UNAVAILABLE: fewer than three maintainers independently approved the exact finalized outcome`.
- Scope: the existing federation deliberately collapsed participant-local refusal details, so this run did not prove the remaining cause. No mint settlement was attempted.
- Cleanup: the wrapper stopped and waited for its owned mint, removed `/tmp/plebeian-friday-integrated.jF7o7V`, and exited 1. No outcome was uncertain.
- Next diagnostic: a bounded, non-authoritative local refusal observer records only the participant error strings (capped at 512 characters). It cannot influence admission, signer selection, aggregation, or settlement.

No bearer proofs, private keys, mint seed, or signer shares are included here.
