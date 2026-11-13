# Catalogue UI inactive release and rollback plan

Status: local review artifact only. Nothing in this plan authorizes installation,
deployment, publication, a service restart, a public route, funding, or a policy
change.

## Exact local artifact

The runtime inputs are the clean committed Catalogue candidate at
`579fbf3cd2a76f534fbeb5ad2f84b59f90ca554b`. That commit contains the UI
implementation commit `26ff59362ed3590a8f7c3641590e4b6cff69034e`, based on the
verified recovery candidate `41c7098e13fb8854abf5e304653d91ca18e23d0b`.
The release guard and this plan do not alter runtime inputs.

Two independent, offline Go 1.23.1 builds used separate cold build caches and
this command shape:

```text
CGO_ENABLED=0 go build -mod=readonly -trimpath -buildvcs=false \
  -ldflags=-buildid= -o plebeian-auctions-poc .
```

Both outputs were byte-identical:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `bin/plebeian-auctions-poc` | 45,270,302 | `2b4e71be4c0d9468135c9cda22776153f1e662ad71e7aefc55075a35b86953d7` |
| `share/friday-browser.js` | 1,759,266 | `60a55fea6e625ce32f1517a3a1d04ec44bc5ac7c1e0d2ce66e74024e199ab3c0` |

The executable is a statically linked Linux/amd64 ELF built with Go 1.23.1,
`CGO_ENABLED=0`, `-trimpath`, and no Go build ID. A disposable loopback-only
fake-money run served `/friday-browser.js` byte-for-byte equal to the committed
bundle. The runtime was then stopped; no child process remained. The local
review package is under
`/tmp/plebeian-catalogue-release.UzvTiX/inactive-release`. It is ephemeral and
must not be treated as a host installation or trusted transfer channel.

`TestEmbeddedFridayBrowserBundleMatchesCatalogueRelease` is an additional
fail-closed source guard. It pins the embedded browser digest to the value
above so a bundle change cannot pass the site test silently.

## Review-only staging shape

If maintainers later approve host staging, create a new immutable release
identity and a new exact release root. Do **not** reuse or overwrite the
historical R20 root, any existing release file, a `current` symlink, live
configuration, network state, signer state, payment state, or rollback
anchor. The approved package should contain the executable at
`<approved-new-release-root>/bin/plebeian-auctions-poc` mode `0755` and the
matching bundle at `<approved-new-release-root>/share/friday-browser.js` mode
`0644`, with root-owned, non-writable directories and a separately reviewed
receipt.

Inactive staging must prove all of the following before any activation review:

1. the approved source commit, binary digest, browser digest, deployment
   identity, manifest digest, runtime binding, and all other release pins match;
2. every candidate unit remains disabled and inactive, with no daemon reload,
   enable, or start performed by staging;
3. `POC_FRIDAY_BROWSER_READY=false` remains set through private acceptance;
4. the candidate nginx site is absent from `sites-enabled`, and no public
   reload or route change has occurred;
5. existing recovery stays on the exact one-hour maximum profile; and
6. the seven-day source candidate remains rejected for every deployment
   identity until a separately approved coordinated identity and rollout
   exists.

The complete R20 release contains additional FIPS, FROST, authority,
coordinator, signer, terminal, verifier, unit, environment, and public-input
artifacts. This two-file local package is intentionally **not** a deployable
R20 release and cannot satisfy those gates by itself.

## No-start rollback boundary

Before funding, the rollback for any failed package, pin, configuration,
browser, or acceptance check is: do not start it. Keep all candidate services
disabled/inactive, keep the public site disabled, preserve the exact failure
evidence, and leave existing recovery and live state untouched. Do not repair
an immutable candidate in place; reject it and prepare a new reviewed release
identity.

After any funded activation, rollback is not deletion or a blind binary
switch. Disable new funding on that candidate, preserve its origin, databases,
keys, signer state, and recovery paths, drain or recover every funded
operation, and follow `deploy/friday/STATUS-RUNBOOK.md` under a separate
approval. Never remove or overwrite material that may be required to return a
bidder or pay a seller.

## Joint fake-sats acceptance still required

This local build and loopback bundle check are not joint acceptance. Before a
maintainer video or deployment claim, the acceptance team must use a fresh,
isolated fake-sats environment bound to the exact approved release identity
and receipt, then record at least:

1. independent verification of the executable, served browser, manifest,
   runtime binding, authority, mint, Comet, FROST roster, and release-pin
   digests;
2. explicit confirmation that the advertised policy is the one-hour profile,
   including unchanged anti-sniping and payment-lock deadlines;
3. browser readiness remaining false until all private gates pass, then
   becoming true only for the exact matching pins;
4. seller creation, seller-chosen bounded duration, bidder A bid, bidder B
   outbid, exact committed-height feedback, return/import for the losing bid,
   anti-sniping extension, close, exact winner settlement, exact seller payout
   import, repeated-click idempotency, response-loss recovery, and restart
   recovery;
5. separate evidence for Comet BFT 3-of-4 consensus and monetary FROST 3-of-4
   authorization—neither is evidence of the other;
6. desktop and mobile browser presentation with honest pending, checking,
   imported, failed, empty, and retry states; and
7. zero unresolved funded operations before any public switch or filming of a
   supposedly complete settlement.

Any maintainer video must describe Maxime's fake-sats demonstration as a
simplified, release-pinned demo. It must not call it FIPS 140 validated,
production-ready, real-money settlement, or proof that the full deployment
ceremony has passed.
