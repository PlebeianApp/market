# Pinned provisional Coco packages

These unchanged package archives were built from the exact clean Coco commit
`60b7b070393eaad8746cb74a03c42017186da647`. They are repository-contained so
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
c41c4b95f90e360cee66b06e6abe354419567f38c798abfcf6202a610200b090  cashu-coco-core-2.0.0.tgz
b3c70d4d9d655e055f216afcf7882cfd1825bc1a7754fd801616f27ced9daabf  cashu-coco-indexeddb-2.0.0.tgz
```

Installed-content SHA-256:

```text
sha256:0819c057889e55f8093dc9803b5646be628cfca6bb054f69d2037620d5dcc105  @cashu/coco-core
sha256:7507ff64326da39f1758fde233b318e454984142bb5e7e6ae5cac72a85e790fd  @cashu/coco-indexeddb
```

The archives contain no source maps, cocod, or NPC artifacts. Core's emitted
`dist/index.js` is
`99d744a9d0de28011cd00d73a539163889607250dec45e4c989822db78e03ae2`;
`dist/index.d.ts` is
`c99f661421f5069682b34d2e350e5c5e5f5b458ec1fa21b4659892b11222c33b`.
This integrated candidate is provisional pending both Red-Team verdicts and
remains fake-funds-only until the strict AuctionsDev smoke contract passes
every check.
