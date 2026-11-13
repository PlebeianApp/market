# Auctions 111-sat HTTP 413: isolated reproduction handoff

This handoff is read-only evidence and disposable-fixture guidance. Do not run
the reproduction against the live origin or reuse any historical operation.

## Exact live provenance observed 2026-11-11 UTC

- Public origin: `https://139.162.161.233`
- Site release: `sidequest-mvp-r4-identity-ui-r66-20261111`
- Site release pin commit: `7d773d6c697a3807b0b1162bd775a6e3a191202b`
- Site source change immediately below the pin: `8e51a98`
- Site binary: 46,637,416 bytes,
  SHA-256 `ca7c71ce73aff5c227aeaad1ab36c153b180923a4d06f8b22a8625f18c688b87`
- Authority release: `sidequest-mvp-r63b-current-winner-20261111`
- Authority binary: 99,675,760 bytes,
  SHA-256 `7b6b72d014b7251f45b3ccb4b830b575a01c56a0c0c361c937531898ce053fc3`
- Active nginx fragment:
  `/etc/nginx/plebeian-friday-public-demo-active-r1.conf`, 3,150 bytes,
  SHA-256 `f0ce698971fc99fd96ac205a0452a147badfca677c5219876665c3f21874ccfa`
- Active `/api/friday/` request limit: `32k`
- Active site-root request limit: `32k`
- Active mint `/v1/` and `/v1/ws` request limits: `64k`
- Public deployment ID: `friday-demo-20261030-separated-v1`
- Public auth network and chain ID: `plebeian-auctions-mvp-20261102`
- Public browser release schema: `PLEBEIAN_FRIDAY_R20_BROWSER_RELEASE_PINS_V1`
- Public genesis SHA-256:
  `c2bb4df3a19b543e270017322ea2bae37b54ae640c7964fc89ef79c77a17cc76`
- Public signer-roster digest:
  `c1aca1467fa1485dadfb7260024adf31f23e2d0912c99569292ee920d6d1eea1`

## Replay-safe incident evidence

- The affected operation is
  `2ca379e28fcfb2f2f12770e3f8257395633bd99b73a4c7d5fb2d64dcfa0fa1e2`.
  Preserve it; never use it in a reproduction.
- Nginx returned HTTP 413 for `/api/friday/funding` at 22:47:52 and
  22:48:27 UTC. Both request bodies were exactly 35,677 bytes.
- The edge rejected both requests before proxying to the authority.
- The server retains only the exact 111-sat seller-plan challenge for actor
  `558ea655…63f37b`; its seller-plan envelope remains null.
- No funding lifecycle, integrated funding, or committed bid exists for the
  affected operation.
- The separate 200-sat control operation
  `b655daad67b3c9083fee825ce4aa795de4ac8e025e84005914bd767ab4a80593`
  is canonically active. Do not reuse it either.

## Disposable reproduction

1. Use a disposable origin, browser profile, fake mint, authority database, and
   two fresh actors. Never copy browser storage or records from the live tab.
2. Check out `7d773d6c697a3807b0b1162bd775a6e3a191202b`. Keep the pre-patch nginx
   `/api/friday/` limit at `32k` and the authority body limit at 32 KiB.
3. First prove the edge boundary without payment state: run a disposable nginx
   instance in front of a request-counting inert upstream and POST an inert JSON
   body of exactly 35,677 bytes to `/api/friday/funding`. Expect HTTP 413 and an
   upstream request count of zero.
4. For the browser reproduction, create a new fake-sats auction and a fresh
   bidder, then make one 111-sat attempt. Stop after its first terminal result.
   Record only the new operation ID, redacted local phase/counts, HTTP status,
   request byte count, and whether the authority received it. Never retry an
   uncertain operation.
5. Apply candidate commit
   `321a0429e9fb8902aa7b1ee423162369a746a4ca`: `/api/friday/` and the
   authority become independently bounded at 64 KiB while the root remains
   32 KiB. Optional NUT-17 WebSockets are disabled only in the browser fake-mint
   composition; bounded HTTP polling remains.
6. Repeat with another fresh origin/database/actors and one new operation. The
   35,677-byte request must reach the authority rather than receive an edge 413.
   A successful test must then produce either one canonical committed outcome or
   one explicit bounded refusal—never a blind retry.

## Focused verification commands

From `cashu-wrapper/ts` in the isolated candidate checkout:

```text
bun install --frozen-lockfile
bun test demo-friday-authority-service.test.ts demo-friday-browser-coco-wallet.test.ts demo-friday-mint-read-transport.test.ts plebeian-friday-exact-operation-readonly-console.test.ts
bun run typecheck:friday
```

The authority regression sends a valid funding envelope larger than 32 KiB and
expects it to reach `prepareExact`; a 65,537-byte streamed body remains refused.
The nginx source regression pins `/api/friday/` at `64k` and `/` at `32k`.

## Required evidence for any post-patch claim

- Exact source commit, build receipt, binary hashes, and activated nginx hash.
- Nginx syntax/preflight and one isolated 35,677-byte boundary result.
- One fresh operation with request count one, a canonical terminal state, and
  fake-sat conservation.
- Redacted browser phase/operation-link counts only; no proofs, keys, tokens,
  signatures, or raw wallet records.
