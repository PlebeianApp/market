# Contributor and agent contract

Read README.md and docs/contributors/MAINTAINER-GUIDE.md first. Check git status
before editing; use an isolated branch. Do not modify another worker's checkout.

## Payment invariants

- Preserve exact operation identity and reconcile uncertain effects before retry.
- Never create a second payment to recover an uncertain first payment.
- Preserve actor, deployment, auction and wallet isolation.
- Keep authorization, consensus commitment, certified import and acknowledgement
  distinct. A winning bid is not evidence of seller receipt.
- Do not remove signing checks to reduce prompt count or latency.
- Parallelize independent reads only; serialize monetary effects and checkpoints.

## Change protocol

Make small modules with explicit inputs, no ambient wallet state and focused tests.
Use the existing test groups. Report checks as passed, failed, blocked or not run.
Simulation, same-browser isolation and actual multi-device/live tests are distinct.
Never call a local test a live end-to-end pass.

No deployment, payment action, merge, force push or publication follows implicitly
from a source-edit task. Do not commit private keys, bearer proofs, browser storage,
wallet databases, environment secrets, signer shares or raw operational logs.
Historical receipts are immutable evidence; add new dated records instead.
