# Catalogue R67 policy/UI candidate

Status: inactive local review artifact. This is not deployment approval and it
does not authorize a service restart, public route, live payment operation,
release-pin replacement, or seven-day policy activation.

## Outcome

Source commit `37757d433bd98c880dcea4f4ea8daa61382ce9ec` combines the
Catalogue UI work with the exact seven-file functional delta from reviewed R67
recovery commit `321a0429e9fb8902aa7b1ee423162369a746a4ca`.

The UI keeps active auctions first and hides resolved history behind an
accessible disclosure. Closed auctions remain in committed state and are still
shown when the connected actor has an unimported return, a seller payout, or
winner status. The funded-bid control exposes an immediate busy state, blocks
duplicate submission, reports authorization/funding and committed-state
verification separately, and never calls an outcome complete solely because a
check is running.

The server and browser require release-pin schema V2 to authorize a new auction,
bid, or payout. The V2 pins bind the exact validator roster hash, the reviewed
one-hour timing digest, and the reviewed 50,000-fake-sat payment digest. A
legacy V1 or mismatched policy remains available only for exact retained
recovery; new operations fail closed. The existing seven-day source profile is
not enabled by this candidate.

The R67 transport delta raises only `/api/friday/` and the authority parser from
32 KiB to 64 KiB. The public site root stays at 32 KiB. The browser fake-mint
composition disables optional NUT-17 WebSockets and retains bounded HTTP
polling. This does not treat a WebSocket error as proof that bid admission
failed: the independently observed 200-fake-sat bid was committed despite its
WebSocket noise, while the separate 111-fake-sat operation remains unresolved
without a committed bid.

## Exact inactive artifacts

Two independent offline Go 1.23.1 builds were byte-identical. Two browser
bundle builds were also byte-identical. The built site served its embedded
browser bundle with the same SHA-256 as the committed file.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `bin/plebeian-auctions-poc` | 45,332,609 | `49fb410d9f6a6a675f5d7fd79edd0337bab4713e3a7476aa33bad14a52ed6866` |
| `share/friday-browser.js` | 1,760,092 | `06a178bc85041d1a2df9503939612e16d80ce8dc3c05bd69c16be6e1866263fc` |
| `internal/poc/static/app.js` | 75,899 | `f1cdbe6ccead04b4d748aef872d0e1ccbbb2df61b2a35aa807c4f8658520f8af` |

The ephemeral package is
`/tmp/plebeian-catalogue-r67-policy-release.Ixpcnw/inactive-release`. It is a
local review convenience, not an immutable installation or trusted transfer
channel.

## Verification

- all Go packages passed offline;
- all eight Node UI files passed;
- Friday TypeScript type checking passed;
- the browser-wallet suite passed 135 tests with 496 assertions;
- the focused R67 transport suite passed 33 tests with 142 assertions;
- the readiness continuity suite passed 9 tests;
- all 14 deployment-policy checks passed;
- the full Friday aggregate passed 387 tests in the sandbox; its two expected
  child-process `EPERM` cases passed 7/7 in the permitted focused rerun; and
- `git diff --check`, deterministic browser builds, deterministic site builds,
  and the served-bundle comparison passed.

The local browser exercised the exact final `app.js` with synthetic V2 pins. It
showed one live auction, kept a pending return and seller payout visible, hid
one resolved auction until `Show past auctions`, and produced one bid call from
a real double-click gesture. Automated UI regressions cover the loading label,
`aria-busy`, duplicate guard, phase copy, ambiguous outcomes, errors, stable
controls across timer/refresh boundaries, actionable closed records, and empty
history. A final mobile browser pass and an in-flight loading-state screenshot
were not captured in the available session.

## Required acceptance gate

Before a maintainer video or any activation, create and approve a new exact V2
release-pin file containing the canonical validator hash
`d1936c5e5e9d09d0a96107031ae144068dcc2ad3f1d071e7f8fe871a8aaff773`,
the one-hour policy digest
`257fb5bf2b414f206278ada15464030a075d6f4f51b9c2f6b965259136f9a777`,
and payment digest
`4d88017e3d191421aa46702ca9b6670fb324162c4c39d3ce4604bbfcfec3492b`.
Then run a fresh, coordinated fake-sats scenario against that exact candidate:
seller creation, two competing bids, committed-height feedback, outbid return,
anti-sniping, close, winner settlement, seller payout import, response-loss
recovery, readiness interruption, and restart recovery. The video must call it
a simplified fake-sats FIPS/FROST demo, not FIPS 140 validated, production-ready,
real-money settlement, or proof of a full deployment ceremony.
