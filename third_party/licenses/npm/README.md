# npm dependency notices

These are the exact license/NOTICE files installed by the committed Bun
lockfile and repository-local archives when the publication candidate was
verified. Paths preserve the installed package relationship, including nested
versions selected by the lockfile.

| Installed package | Version | Declared license | Notice path |
| --- | --- | --- | --- |
| `@cashu/cashu-ts` | 5.0.0-rc.4 | MIT | `@cashu/cashu-ts/LICENSE.md` |
| `@noble/ciphers` | 2.1.1 | MIT | `@noble/ciphers/LICENSE` |
| `@noble/curves` | 2.4.0 | MIT | `@noble/curves/LICENSE` |
| `@noble/hashes` | 2.4.0 | MIT | `@noble/hashes/LICENSE` |
| `@scure/base` | 2.4.0 | MIT | `@scure/base/LICENSE` |
| `@scure/bip32` | 2.4.0 | MIT | `@scure/bip32/LICENSE` |
| `@scure/bip39` | 2.0.1 | MIT | `@scure/bip39/LICENSE` |
| `@noble/hashes` (nested under `@scure/bip39`) | 2.0.1 | MIT | `@scure/bip39/node_modules/@noble/hashes/LICENSE` |
| `@scure/base` (nested under `@scure/bip39`) | 2.0.0 | MIT | `@scure/bip39/node_modules/@scure/base/LICENSE` |
| `@types/bun` | 1.4.2 | MIT | `@types/bun/LICENSE` |
| `@types/node` | 26.6.4 | MIT | `@types/node/LICENSE` |
| `bun-types` | 1.4.2 | MIT | `bun-types/docs/project/license.mdx` |
| `dexie` | 4.4.6 | Apache-2.0 | `dexie/LICENSE`, `dexie/NOTICE` |
| `nostr-tools` | 2.25.5 | Unlicense | `nostr-tools/LICENSE` |
| `@noble/curves` (nested under `nostr-tools`) | 2.0.1 | MIT | `nostr-tools/node_modules/@noble/curves/LICENSE` |
| `@noble/hashes` (nested under `nostr-tools`) | 2.0.1 | MIT | `nostr-tools/node_modules/@noble/hashes/LICENSE` |
| `@scure/base` (nested under `nostr-tools`) | 2.0.0 | MIT | `nostr-tools/node_modules/@scure/base/LICENSE` |
| `@scure/bip32` (nested under `nostr-tools`) | 2.0.1 | MIT | `nostr-tools/node_modules/@scure/bip32/LICENSE` |
| `typescript` | 5.9.3 | Apache-2.0 | `typescript/LICENSE.txt` |
| `undici-types` | 8.9.0 | MIT | `undici-types/LICENSE` |

`SHA256SUMS` binds every retained notice file. The broader component and
license-file evidence remains in `../../DEPENDENCY-LICENSE-INVENTORY.json`.
