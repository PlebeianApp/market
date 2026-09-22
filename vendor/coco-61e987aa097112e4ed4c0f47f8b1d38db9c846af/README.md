# Pinned Coco candidate packages

These package archives were built from the exact Coco commit
`61e987aa097112e4ed4c0f47f8b1d38db9c846af` and are repository-contained so
the Market candidate never depends on a developer checkout, symlink, mutable
branch, or `NODE_PATH` override.

Source repository: `https://github.com/cashubtc/coco`

Build commands, from a clean checkout at the exact commit:

```sh
bun run --filter='@cashu/coco-core' build
bun run --filter='@cashu/coco-indexeddb' build
npm pack --pack-destination <output> packages/core
npm pack --pack-destination <output> packages/indexeddb
```

Market still has legacy consumers of Cashu v2. Bun resolves package imports
from bundled dependencies at the application root, so the Core archive applies
one deterministic packaging-only rewrite: every literal
`@cashu/cashu-ts` import in the generated Core package becomes
`@plebeian-market/coco-cashu-ts`. That dependency is an npm alias pinned to
`@cashu/cashu-ts@5.0.0-rc.4`, the exact dependency declared by Coco. No Coco
logic is changed. The generated IndexedDB package applies the same rewrite to
its single Cashu v5 runtime import. No IndexedDB logic is changed.

SHA-256:

```text
5042328f7427d6f052f4254199590cefdea2b834ec5058a91f0b2e65d5d7deae  cashu-coco-core-2.0.0-pm1.tgz
e1cab46f8cec95532bb570187e54a0e311ba2cbd92cd682bcbc3de9a54c0a150  cashu-coco-indexeddb-2.0.0-pm1.tgz
```

The candidate is not release-authorized. These archives are for the
fake-funds Auction integration candidate only and must be replaced by reviewed
release packages before real-funds enablement.
