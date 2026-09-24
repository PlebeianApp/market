# Pinned Coco Round 9 packages

These unchanged package archives were built from the exact Coco commit
`35941014a61af7dc112b31de8053db610b70085c`. They are repository-contained so
the Market candidate does not depend on a developer checkout, symlink, mutable
branch, or `NODE_PATH` override.

Source repository: `https://github.com/cashubtc/coco`

Build and package commands, from a clean checkout at the exact commit:

```sh
bun run --filter='@cashu/coco-core' build
bun run --filter='@cashu/coco-indexeddb' build
(cd packages/core && npm pack --pack-destination <output>)
(cd packages/indexeddb && npm pack --pack-destination <output>)
```

The archives retain Coco's native exact dependency on
`@cashu/cashu-ts@5.0.0-rc.4`. Market resolves that same package at its root, so
there is one physical Cashu implementation and no packaging rewrite.

SHA-256:

```text
b306750ace7ec98b0d024264a585587064a0b92724978522d8c6be0e9152818c  cashu-coco-core-2.0.0.tgz
2955d332da8e789360460611bac29272fd8654673463d5f3199b290a3207c4a9  cashu-coco-indexeddb-2.0.0.tgz
```

The archives contain no source maps, cocod, or NPC artifacts. This integrated
candidate remains fake-funds-only.
