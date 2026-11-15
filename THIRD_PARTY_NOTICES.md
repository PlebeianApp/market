# Third-party notices

This file records third-party material redistributed directly by this
repository. It does not relicense Plebeian Auctions code, and the Plebeian
Auctions GPL-3.0-only license does not relicense the components below.

Status: this notice set covers the directly redistributed Coco archives and
the exact `iris-contrib/schema` terms identified by the locked dependency
review. Publication remains held until the complete generated-bundle and
binary-distribution notice inventory is independently reviewed.

## Coco-derived components

This repository contains modified and generated portions of Coco:

- `@cashu/coco-core@2.0.0`, including one additional mint-request/fetch
  transport variant;
- `@cashu/coco-indexeddb@2.0.0`; and
- `@cashu/coco-sqlite-bun@2.0.0-plebeian-r1`, containing Coco SQL-storage
  source.

Public upstream: <https://github.com/cashubtc/coco>
Public upstream base: `c96494d8c7aa1869b68bcbad3ebd681f398de52f`
Local fork pin: `60b7b070393eaad8746cb74a03c42017186da647`
Post-pin transport patch SHA-256:
`486e716a26e454fcefb822fbae90556434dbaba8a25dba507895db6fa2b7675e`

The fork range records 19 commits authored as `Maximoto`, one as `Felix`, and
one as `Egge`. Those records are provenance, not a Plebeian copyright claim.

Redistributed archive hashes:

```text
c41c4b95f90e360cee66b06e6abe354419567f38c798abfcf6202a610200b090  cashu-coco-core-2.0.0.tgz (fork pin, retained but not lockfile-selected)
b3c70d4d9d655e055f216afcf7882cfd1825bc1a7754fd801616f27ced9daabf  cashu-coco-indexeddb-2.0.0.tgz
351b94a57a505551b179c8cbf73be1aa0eb9d77d8393aa9c32a7f9ad32c7dcdf  cashu-coco-sqlite-bun-2.0.0-plebeian-r1.tgz
468bcc2f57792f8de7890d280286fe8cf0ab6d20dcbbc37a4a75e6bba07b5c81  cashu-coco-core-2.0.0.tgz (fork pin plus transport patch)
```

Coco's exact MIT text is shipped at
`third_party/licenses/coco-MIT.txt`, SHA-256
`d07c98406941fb6b16da98d3252e7de5c00538098ae223f733c46c492e96c9f9`,
and includes `Copyright (c) 2025 Cashu`.

The modified-source recovery record, deterministic source snapshot and
post-pin patch are distributed under `third_party/sources/coco/`. Their exact
hashes and reconstruction instructions are recorded in that directory's
`README.md`. The custom SQLite-Bun declaration is separately retained and
documented as reviewed, hand-maintained API metadata under
`third_party/sources/coco/sqlite-bun/`.

## iris-contrib/schema v0.0.6

The committed Go graph selects `github.com/iris-contrib/schema@v0.0.6` through
`github.com/getsentry/sentry-go@v0.27.0`. The exact tag is commit
`4fafd0845ed1b8cc46cfc3a2a9ba64f2000ff405`. Its authoritative license is
embedded in `README.md:10-39`, not a separate license file.

The exact terms and disclaimer are reproduced at
`third_party/licenses/iris-contrib-schema-BSD-3-Clause.txt`, SHA-256
`40ac304a0dc996136e0e2518db8ffcfb31b56bf6abea0f48a7bdc5fa2ad9f0a8`.

## Dependency inventory

The locked review recorded exact Cargo, Go and npm declarations/license files
for the selected dependency graph. It found 173 unique components and exact
license evidence for 171; the two remaining declaration gaps are the local
Plebeian Rust crates, now declared `GPL-3.0-only` in their manifests.

The sanitized evidence inventory is distributed at
`third_party/DEPENDENCY-LICENSE-INVENTORY.json`, SHA-256
`55cd8ea54166527066e476fe6a7f07163b24e776a8de147780efe4f917fdf32f`.
It records the exact 93 Cargo, 58 Go, 18 npm and four vendored-archive
components without workstation paths. Go modules remain `NOASSERTION` in the
manifest-declaration field because `go.mod` has no license field; exact
top-level license-file hashes and conservative classifications are recorded
separately for all 58 modules.

Compatibility review is not performed by that inventory. Before a binary or
generated bundle is released, independently review the exact linked
dependencies and bind the final inventory to the release checksum manifest.
The exact license/NOTICE files from the locked npm tree used to build the
tracked browser bundle are retained under `third_party/licenses/npm/`, with
their hashes in that directory's `SHA256SUMS`.
