# Coco Core mint request-fetch R1 provenance

This archive is an offline build of `@cashu/coco-core` for the bounded
`DEMO_AUTH_V1` test-only integration. It is not the clean upstream archive in
the adjacent `coco-60b7b070393eaad8746cb74a03c42017186da647` directory.

## Source identity

- Source worktree: `/home/maximoto/dev/coco-market-mint-request-fetch-r1-2026-10-14`
- Clean base commit: `60b7b070393eaad8746cb74a03c42017186da647`
- Clean base tree: `b82bd005d076776ddb529120739632d1708f2bc8`
- Dependency patch SHA-256: `486e716a26e454fcefb822fbae90556434dbaba8a25dba507895db6fa2b7675e`

The dependency patch hash is the SHA-256 of `git diff --cached --binary HEAD`
from a temporary index containing only the seven R4 Coco allowlist paths. The
real source index was not changed.

## Offline verification and build

All inputs came from the pre-existing local dependency cache. No network or
registry fetch was used.

```text
bun test packages/core/test/unit/RequestRateLimiter.test.ts packages/core/test/unit/Manager.test.ts
bun run --filter='@cashu/coco-core' typecheck
bun run --filter='@cashu/coco-core' build
npm pack ./packages/core --pack-destination /home/maximoto/dev/market-retrofit-auction-demo-auth-v1-coco-testnut-r4-transport-2026-10-14/cashu-wrapper/vendor/coco-60b7b070393eaad8746cb74a03c42017186da647-mint-request-fetch-r1 --offline
```

## Packed identity

- Archive: `cashu-coco-core-2.0.0.tgz`
- Archive SHA-256: `468bcc2f57792f8de7890d280286fe8cf0ab6d20dcbbc37a4a75e6bba07b5c81`
- npm shasum: `7195968ad775ba822cec2d22f96d41e9aa139ca7`
- npm integrity: `sha512-KWoqaXPIEnCfeakdZn+6LGq7nswIH58ezhJqyZOuXByL4LgtMBg3G9KqCXRrhe+YzgbKEwX7cljVxdUifnvTtQ==`
- `dist/index.js` SHA-256: `acecf2cea57886c8530d2bb22313ee3ae8b5056cf29f25b151ba5a5f1331a8b9`
- `dist/index.d.ts` SHA-256: `bce903161ec08e90bff4e36c74eb6c16f10438823c521b9b295b140e0a8b960f`
- Installed-content SHA-256: `70901426a3a0c1afec05728fe2384c67c50a9a3b2230de8b541609b01ab79f2d`

The installed-content value hashes the output of this deterministic command
from the extracted package root:

```text
(find . -type f -print0 | sort -z | xargs -0 sha256sum) | sha256sum
```

The packed and extracted `dist/index.js` and `dist/index.d.ts` hashes match the
emitted build files above. The unchanged IndexedDB package remains pinned to
the original adjacent vendor directory.
