# Pinned Coco candidate packages

These unchanged package archives were built from the exact Coco commit
`37b9454caf4d1019764899d7ce194bb8b2f5b0bf`. They are repository-contained so
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
d4afab3b6cf2715b576d48515dc849b81dfaeb29bfd6b2678b0948315fd19106  cashu-coco-core-2.0.0.tgz
8376cf6ca67643da2cbdd27d2f4dcb9453da978fab634469782eb07e3d21412f  cashu-coco-indexeddb-2.0.0.tgz
```

This development candidate is fake-funds-only. Replace this directory with
artifacts built at the approved Round 9 SHA and refresh the checksums and lockfile
before the auctionsdev handoff.
