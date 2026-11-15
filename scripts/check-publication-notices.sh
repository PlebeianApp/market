#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

test -f LICENSE
test -f COPYRIGHT
test -f THIRD_PARTY_NOTICES.md
test -f third_party/DEPENDENCY-LICENSE-INVENTORY.json
test -f third_party/licenses/npm/SHA256SUMS
test -f third_party/sources/coco/README.md
test -f third_party/sources/coco/sqlite-bun/README.md
test -f docs/contributors/PUBLICATION-LICENSE-NOTICE-CANDIDATE-20261115.md

printf '%s\n' \
  '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986  LICENSE' \
  'd07c98406941fb6b16da98d3252e7de5c00538098ae223f733c46c492e96c9f9  third_party/licenses/coco-MIT.txt' \
  '40ac304a0dc996136e0e2518db8ffcfb31b56bf6abea0f48a7bdc5fa2ad9f0a8  third_party/licenses/iris-contrib-schema-BSD-3-Clause.txt' \
  '55cd8ea54166527066e476fe6a7f07163b24e776a8de147780efe4f917fdf32f  third_party/DEPENDENCY-LICENSE-INVENTORY.json' \
  'fd95818b4c9870985b45dcff807b50d537f68ab08ab7b46a05b75864fd3c1192  third_party/sources/coco/archives/coco-60b7b070393eaad8746cb74a03c42017186da647-source.tar.gz' \
  '486e716a26e454fcefb822fbae90556434dbaba8a25dba507895db6fa2b7675e  third_party/sources/coco/patches/coco-60b7b070-mint-request-fetch-r1.patch' \
  '674f2e4bdc73cd0e427703cc60e0c3ea7e9e7f664a10c738d99e09ccd7e00f5c  third_party/sources/coco/sqlite-bun/index.d.ts' \
  'c41c4b95f90e360cee66b06e6abe354419567f38c798abfcf6202a610200b090  cashu-wrapper/vendor/coco-60b7b070393eaad8746cb74a03c42017186da647/cashu-coco-core-2.0.0.tgz' \
  'b3c70d4d9d655e055f216afcf7882cfd1825bc1a7754fd801616f27ced9daabf  cashu-wrapper/vendor/coco-60b7b070393eaad8746cb74a03c42017186da647/cashu-coco-indexeddb-2.0.0.tgz' \
  '351b94a57a505551b179c8cbf73be1aa0eb9d77d8393aa9c32a7f9ad32c7dcdf  cashu-wrapper/vendor/cashu-coco-sqlite-bun-2.0.0-plebeian-r1.tgz' \
  '468bcc2f57792f8de7890d280286fe8cf0ab6d20dcbbc37a4a75e6bba07b5c81  cashu-wrapper/vendor/coco-60b7b070393eaad8746cb74a03c42017186da647-mint-request-fetch-r1/cashu-coco-core-2.0.0.tgz' |
  sha256sum -c -

grep -Fqx 'license = "GPL-3.0-only"' cashu-wrapper/frost-participant-3of4/Cargo.toml
grep -Fqx 'license = "GPL-3.0-only"' cashu-wrapper/frost-public-inspect/Cargo.toml
grep -Fq '"license": "GPL-3.0-only"' cashu-wrapper/ts/package.json
grep -Fq 'Copyright © 2026 the Plebeian Auctions contributors.' COPYRIGHT
grep -Fq 'license that contribution under GPL-3.0-only.' CONTRIBUTING.md
grep -Fq 'Publication remains held' THIRD_PARTY_NOTICES.md
grep -Fq 'coco-sqlite-bun-declaration-conformance.test.ts' third_party/sources/coco/sqlite-bun/README.md
jq -e '.counts.cargoUnresolved == 0 and .publicationScope.localFilesystemPathsRemoved == true' third_party/DEPENDENCY-LICENSE-INVENTORY.json >/dev/null
if grep -Eq '/home/|maximoto|/tmp/' third_party/DEPENDENCY-LICENSE-INVENTORY.json; then
  printf '%s\n' 'publication notices: local path leaked into dependency inventory' >&2
  exit 1
fi
sha256sum -c third_party/licenses/npm/SHA256SUMS

printf '%s\n' 'publication notices: bounded integrity checks passed'
