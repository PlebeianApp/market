# Pinned Coco Round 14 packages

These unchanged package archives were built from the exact clean Coco commit
`34f968f7032b8b2120ccd8eccdf60542a61a1aad`. They are repository-contained so
the Market candidate does not depend on a developer checkout, symlink, mutable
branch, or `NODE_PATH` override.

Source repository: `https://github.com/cashubtc/coco`

Build and package commands, from the clean checkout at the exact commit:

```sh
bun run --filter='@cashu/coco-core' build
bun run --filter='@cashu/coco-indexeddb' build
npm pack ./packages/core --pack-destination <output>
npm pack ./packages/indexeddb --pack-destination <output>
```

The archives retain Coco's native exact dependency on
`@cashu/cashu-ts@5.0.0-rc.4`. Market resolves that same package at its root, so
there is one physical Cashu implementation and no packaging rewrite.

SHA-256:

```text
1cbb354810f47072190a1da725c6ba4da92e724da703c8a86eab31e57922d2b9  cashu-coco-core-2.0.0.tgz
79239d876820f3f3f5eaccaa0765e0f7a84ac8be5ca78baa9fcfa0a11e2a6953  cashu-coco-indexeddb-2.0.0.tgz
```

Installed-content SHA-256:

```text
sha256:70602fc9ce09751502977e64434ca3e2a475d700a46d0f2a4e95ed50f157f796  @cashu/coco-core
sha256:7507ff64326da39f1758fde233b318e454984142bb5e7e6ae5cac72a85e790fd  @cashu/coco-indexeddb
```

The archives contain no source maps, cocod, or NPC artifacts. This integrated
candidate remains fake-funds-only until the strict AuctionsDev smoke contract
passes all checks.
