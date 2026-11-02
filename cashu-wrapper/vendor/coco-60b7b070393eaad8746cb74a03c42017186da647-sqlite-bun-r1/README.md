# Coco Bun SQLite adapter — POC pin R1

This is the bundled `packages/sqlite-bun` adapter from Coco commit
`60b7b070393eaad8746cb74a03c42017186da647`, the exact source commit from
which the POC's vendored `@cashu/coco-core` 2.0.0 archive was packed.

Source inspected read-only at
`/home/maximoto/dev/coco-market-mint-request-fetch-r1-2026-10-14`.
`packages/sqlite-bun` and `packages/sql-storage` were clean relative to that
commit. The JavaScript bundle was produced with Bun while keeping
`@cashu/coco-core`, its adapter entry point, and `@cashu/cashu-ts` external.

The public npm `@cashu/coco-sqlite-bun@2.0.0` was tested first and rejected:
although its peer versions matched, it lacked the pinned core's repository
authority methods and `findMintByUrl` storage contract. No registry package or
patched `node_modules` file is retained by this pin.

Recorded artifacts:

- `dist/index.js` SHA-256:
  `fd460f5b409539a12fa3b8e28b83357c51132c9ac862250daec3906d881fb285`
- `cashu-coco-sqlite-bun-2.0.0-plebeian-r1.tgz` SHA-256:
  `351b94a57a505551b179c8cbf73be1aa0eb9d77d8393aa9c32a7f9ad32c7dcdf`

`package.json` and `bun.lock` install the latter as a repository-local file
dependency. There is no runtime registry lookup and no unexplained edit under
`node_modules`.
