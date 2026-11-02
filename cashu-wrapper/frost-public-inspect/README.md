# FROST public package inspector

This tiny task-local helper reads the public package emitted by the pinned
`coco-demo-frost-participant-3of4` DKG executable. It deserializes that package
with the same `frost-secp256k1-tr` 3.0.0 library, normalizes the BIP-340 public
material to even Y, and emits only the aggregate public key and four public
verifying shares. It never reads a participant state directory or private DKG
envelope.

The helper is intentionally separate from the sealed payment candidate. Its
dependency versions match the pinned participant crate at
`/home/maximoto/Documents/Codex/2026-10-18/task-6/worktrees/a1-payment-frost-r2/cashu-wrapper/frost-participant-3of4`.
