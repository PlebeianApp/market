# Coco v2 integration map

## Pinned implementation

- `@cashu/coco-core` and `@cashu/coco-indexeddb`: package version 2.0.0,
  built from Coco commit `60b7b070393eaad8746cb74a03c42017186da647`.
- Bun SQLite adapter: built from the same clean source and installed as
  `cashu-coco-sqlite-bun-2.0.0-plebeian-r1.tgz` (SHA-256
  `351b94a57a505551b179c8cbf73be1aa0eb9d77d8393aa9c32a7f9ad32c7dcdf`).
- Nutshell test mint: 0.19.2 with `FakeWallet`, active zero-fee keyset in the
  prior acceptance runs.

No NIP-60 wallet is used.

## Proven Wednesday / custodial path

`cashu-wrapper/ts/poc-coordinator.ts:newWallet()` opens one Coco manager per
authenticated npub with `initializeCoco`, `FridaySqliteRepositories`, and
`createCocoRail`. Faucet issuance, plain sends, lock sends, receives, balance
projection and restart recovery use Coco's durable quote/proof/operation
repositories. The retained Wednesday evidence is real Coco/Nutshell evidence.

## Friday threshold path

The threshold work originally prepared proof pools directly with
`CashuMintClient` and imported recipient proofs into a bespoke JSON fixture
wallet. That fixture is valid lab evidence but is **not** Coco v2 wallet
integration.

The current source adds two Coco adapters:

1. `CocoRailPort.sendThresholdSigAll` prepares and executes an exact NUT-11
   2-of-2 bidder-plus-committee `SIG_ALL` send under Coco's caller-owned durable
   operation identity, then strictly re-reads the mint token.
2. `openDemoFridayBrowserCocoWallet` opens the pinned Coco IndexedDB domain,
   holds the seed in the existing browser seed store, prepares threshold
   funding through the rail, and imports terminal tokens through Coco receive.

The cross-language receipt, encrypted prepared-package store, threshold signer,
authenticated Comet confirmer, and fixed terminal resolver are separate from
the wallet. Rust participant naming is not evidence of Coco wallet use.

## Remaining activation blocker

The reviewed FIPS application pins the fake mint at an internal FIPS ULA such
as `http://[fd…]:3338`; a public browser cannot reach that origin. The browser
Coco adapter therefore remains unwired to the public page, and the public
funding endpoint remains HTTP 503. Activating it requires one reviewed logical
mint-origin transport design:

- make the public HTTPS mint origin the receipt/token identity and map it to
  the same internal fake mint over the FIPS path, proving the mapping to every
  signer; or
- retain a server-custodial Coco wallet and explicitly withdraw the
  browser-held-proof claim.

Until that is resolved and exercised in one exact-artifact run, the JSON lab
wallet is not a fallback and the Friday browser must not advertise Coco
funding as ready.
