# Passwordless public-link risk assessment R1

Decision: **NO-GO for a naked public link.** Keep the five-account HTTPS gate
for today's demo. This assessment changes no live state.

## Exposed surface

The proposed HTTPS virtual host is not a read-only site. It places the browser
application, auction API, authority API and fake Cashu mint under one origin.

| Route | Exposure without an access gate |
| --- | --- |
| `/`, static assets | Public UI includes a disposable signer, so any visitor can create unlimited actors. |
| `/api/config`, `/api/browser-release-pins` | Public deployment, chain, committee and keyset metadata. These are intended public pins, not secrets. |
| `/api/state` | Returns the full public consensus state and a base64 canonical copy, including actors, auctions, bids, public proof references and funding records. It does not intentionally contain Cashu bearer secrets, but it exposes the complete demo history. |
| `/api/validators` | Exposes validator node IDs, addresses, heights, block/app hashes, peer/signature observations and availability. |
| `POST /api/event` | Any visitor can generate a demo signer and submit signed auction events. There is no account, actor-count, auction-count or total-operation quota. Accepted events permanently grow consensus state. |
| `POST /api/close` | No caller authentication. The application enforces auction timing, but an external caller can trigger an eligible close. The loopback close worker does not need this route through nginx. |
| `POST /api/admin/offline` | Remote control is disabled in the deployed remote profile and returns `403`; this is good, but the route should still be blocked at nginx. |
| `/api/interim/faucet`, `/api/cashu/` | Legacy paths fail closed in the R20 profile; block them at nginx to reduce surface. |
| `/api/friday/*` | Body size is capped at 32 KiB and cryptographic bindings protect actual funding authority. The `Origin` check is not authentication: a non-browser client can set it. Several preparation/read routes can still consume storage and CPU when supplied attacker-owned valid keys and events. |
| `/v1/*` | Proxies the complete fake-mint HTTP API. The FakeWallet automatically settles fake invoices. A direct client can bypass the browser and create/mint repeatedly. |

## Controls that exist

- The site and authority listen only on APP loopback before proxy activation.
- The validator stop callback is absent in the remote profile.
- Auction mutations require valid Nostr signatures; FROST admissions require
  the reviewed package and committee authorization.
- The authority rejects bodies over 32 KiB; the Go server caps transaction
  bytes and has bounded HTTP/RPC timeouts.
- Browser wallet funding limits one request to 10,000 fake sats and a browser
  wallet to 50,000 fake sats.

The last limit is explicitly published as `browser_wallet_advisory_only`. It is
not a mint-wide, actor-wide, IP-wide or access-account quota.

## Missing controls and concrete risk

1. No authentication exists for a naked public origin.
2. No request-rate or concurrent-connection limit exists in the application.
3. No server-enforced total fake issuance or per-user funding quota exists.
4. No total cap exists for actors, auctions, bids, authority preparations or
   consensus operations.
5. A visitor can use the built-in disposable signer to evade actor-local
   limits and pollute state with fresh identities.
6. `/v1/` permits direct clients to skip the UI's advisory funding limit.
7. Public state and validator endpoints reveal complete demo and operational
   metadata. No private key/share or Cashu bearer secret is intentionally
   returned, but the exposure is unnecessary outside the five testers.

Likely failure modes are mint/authority CPU and database pressure, FROST signer
load, unbounded fake issuance, consensus-state growth, demo interference and
loss of a clean five-person result. Fake sats have no monetary value, but that
does not make resource exhaustion or state corruption acceptable.

## Minimum safe setup for today's demo

1. Use the valid certificate and the five independent Basic Auth accounts
   already prepared. Protect the entire server context, including `/v1/` and
   `/api/friday/`; protecting only the HTML is ineffective.
2. At nginx, return `404` for external `/api/admin/offline`, `/api/close`,
   `/api/interim/faucet` and `/api/cashu/`. The loopback close trigger remains
   unaffected.
3. Permit only the methods required by each remaining location. Reject all
   other methods before proxying.
4. Keep body limits at 32 KiB for `/api/friday/`, 64 KiB for `/v1/` and no more
   than 1 MiB for the site route.
5. Add per-authenticated-user connection and request limits. A practical short
   demo envelope is 8 concurrent connections, 10 general API requests/second
   with a small burst, 1 mutation/second with a bounded burst, and one mint
   quote creation/minute. Validate these limits against one complete browser
   rehearsal before public activation.
6. Use an nginx log format that omits `$remote_user`, `$request`, query strings,
   `Authorization`, cookies and bodies. Retain only method, path without query,
   status, byte count, source IP and user agent for the bounded demo window.
7. Open 443 only for the meeting window. After settlement, separately approve
   removal of the access file/include and close public exposure.

The trusted five people remain part of this control: nginx rate limits reduce
accidents and brute-force pressure but do not replace the absent server-side
fake-issuance quota.

## If “only a link” is non-negotiable

A safe link-only design needs five high-entropy, independently revocable
capability links that exchange once for `HttpOnly; Secure; SameSite=Strict`
session cookies, plus a gateway that enforces one 10,000-sat funding operation
per capability and a bounded number of auction operations. The token must be
redacted from access logs and browser history, and every application, authority
and mint route must require the cookie.

Such a link is itself a bearer credential. The current nginx/application stack
does not implement the exchange, revocation or server-side quota. Adding it is
a new security-sensitive service and cannot be truthfully treated as a config
toggle for today's meeting.

## Verification evidence

- Focused Go tests confirm that remote validator-offline control is
  unreachable, the fake-funding policy is published as runtime data, and
  readiness blocks direct mutations before RPC.
- Eleven browser-Coco wallet tests pass, including the advisory balance cap,
  exact journal recovery and refusal of changed mint/keyset/operation state.
- Source inspection found no application or nginx total-operation, auction,
  actor, issuance or request-rate cap on the proposed public path.

