# Integrated terminal threshold failure — 2026-10-22

- Source base: `712f4bec12309eab7b29bb498785dc1605243ee3` plus the then-uncommitted signer-policy changes and exact-proof projection.
- Command: bounded `cashu-wrapper/ts/demo-integrated-frost-comet.live.test.ts` through `scripts/friday-integrated-frost-comet.sh`.
- Fresh gate: `MemAvailableMiB=3823`; no competing test campaign was observed before launch.
- Result: **FAIL** (`0 pass`, `1 fail`, `8 expect()` calls) in 67.59 seconds.
- Refusal: `DEMO_MAINTAINER_THRESHOLD_UNAVAILABLE: fewer than three maintainers independently approved the exact finalized outcome`.
- Scope: the failure occurred before mint settlement. At this point the missing participant diagnostics made the cause unknown; a funding-operation versus event-id mismatch was a provisional hypothesis only. Later instrumented evidence showed the remaining failure was the moving current-state digest, and confirmed the V1 policy intentionally uses the stable funding operation in its legacy bid slots while binding the actual event inside the evidence digest.
- Cleanup: the wrapper stopped and waited for its owned mint, removed `/tmp/plebeian-friday-integrated.9WD4Z4`, and exited 1. No outcome was uncertain.
- Follow-up: add bounded participant-refusal diagnostics before changing identity semantics.

No bearer proofs, private keys, mint seed, or signer shares are included here.
