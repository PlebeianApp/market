# Modified Coco source recovery

The tracked Coco-derived package archives are built from modified MIT-licensed
Coco source. Archive metadata alone is insufficient because the exact fork pin
was not publicly retrievable from its recorded origin during the 2026-11-13
review.

## Lineage

- Public upstream: <https://github.com/cashubtc/coco>
- Public base: `c96494d8c7aa1869b68bcbad3ebd681f398de52f`
- Fork pin: `60b7b070393eaad8746cb74a03c42017186da647`
- Public-base-to-fork tree patch SHA-256:
  `4923594a2542142faecce0ac8a9193248d7c8033e2d8867b87d70d21d358ef15`
- Post-pin mint-request/fetch patch SHA-256:
  `486e716a26e454fcefb822fbae90556434dbaba8a25dba507895db6fa2b7675e`
- Deterministic fork source snapshot SHA-256:
  `fd95818b4c9870985b45dcff807b50d537f68ab08ab7b46a05b75864fd3c1192`
- Fork tree: `b82bd005d076776ddb529120739632d1708f2bc8`
- Final seven-path patched tree:
  `c54a44e4b62889e90668f10ce52c05200ff8ac80`

Applying the full-index public-base-to-fork patch to the public base produced
the exact fork tree. Applying the post-pin patch next produced the exact
seven-path patched tree.

## Distributed source form

This repository distributes the deterministic fork source snapshot and the
post-pin patch alongside the vendored package archives:

```text
fd95818b4c9870985b45dcff807b50d537f68ab08ab7b46a05b75864fd3c1192  archives/coco-60b7b070393eaad8746cb74a03c42017186da647-source.tar.gz
486e716a26e454fcefb822fbae90556434dbaba8a25dba507895db6fa2b7675e  patches/coco-60b7b070-mint-request-fetch-r1.patch
```

The archive contains 840 regular/directory members under one top-level source
directory and no absolute path, parent traversal, symlink or hardlink member.
Extract it, then apply the patch from the extracted repository root using
`git apply --binary ../patches/coco-60b7b070-mint-request-fetch-r1.patch` (with
the relative path adjusted to the extraction location). Verify the resulting
seven-path patched tree against `c54a44e4b62889e90668f10ce52c05200ff8ac80`.

The MIT text at `third_party/licenses/coco-MIT.txt` must ship with every form.
Do not silently repack the existing `.tgz` archives: changing their bytes would
require new identities, lockfiles, SBOMs, builds and payment acceptance.

## SQLite-Bun declaration limitation

The custom SQLite-Bun `dist/index.js` and npm archive are byte-for-byte
reproducible from the pinned source and recorded toolchain. The retained
`dist/index.d.ts` is not produced by the normal locked build and has no
recovered generator. It is therefore distributed explicitly as reviewed,
hand-maintained API metadata under `sqlite-bun/`, with a compile-time/runtime
conformance test. A future generated declaration must use a new package
revision and repeat downstream acceptance.
