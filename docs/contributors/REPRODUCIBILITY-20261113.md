# R86 checkpoint reproducibility — 2026-11-13

Effect: isolated offline verification only. The reviewed checkpoint was not
modified during these tests, and no live service, payment endpoint, deployment
or Git remote was contacted.

## Toolchains

- Node `v24.11.0`
- Bun `1.3.11`
- TypeScript `5.9.3` from the pinned dependency set
- Go `1.22.2` installed; the module requires `1.23.1`
- Rust/Cargo `1.86.0` present; the offline cache lacks `fs2 0.4.3`

Bun dependencies were installed from the existing local cache and the four
repository-local archives with the registry pinned to unreachable loopback.
No dependency was downloaded.

## Results

| Check | Result |
| --- | --- |
| `node --test internal/poc/*.test.js` | 8 passed, 0 failed |
| `bun run typecheck:friday` | passed |
| `bun run test:friday:browser` | 158 passed, 0 failed |
| `bun run test:friday` | 2 pretests and 410 suite tests passed, 0 failed |
| `bun run test:friday:r20` | 58 passed, 1 root-only skip, 0 failed |
| `bun run test:friday:dkg-diagnostic` | 73 passed, 0 failed |
| `bun run test:friday:coco-threshold` | 19 passed, 0 failed |
| `bun run test:friday:v4-service` | 94 passed, 0 failed |
| `bun run test:friday:integration` | 197 passed, 0 failed |

Restricted-sandbox child-process IPC produced `EPERM` in two first attempts.
Exact non-network reruns outside that sandbox passed; this was an execution
policy limitation rather than a source failure.

## Browser bundle

The tracked browser bundle was rebuilt from the pinned cached dependency set:

```sh
bun build poc-friday-browser-entry.ts --target=browser --minify \
  --outfile=/tmp/plebeian-r86-friday-browser-rebuild.js
```

The rebuilt and tracked files are byte-identical:

- bytes: `1,933,620`
- SHA-256: `6fbcb16bc2c660ed5710a19aea8d52f820966013ed8d8fdde19500a1aac5f214`

## Still blocked

- Go tests and binary build require the selected Go `1.23.1` toolchain.
- The native Rust gate requires the exact offline `fs2 0.4.3` crate or an
  explicitly approved dependency retrieval.
- Live browser/payment acceptance was intentionally not run and remains a
  separate gate.
