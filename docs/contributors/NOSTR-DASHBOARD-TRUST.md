# Nostr dashboard trust boundary

Reviewed 2026-11-12 for the local Auctions dashboard candidate.

## Profile presentation

The browser asks only the already allowlisted `wss://relay.powr.build/` relay for
kind-0 metadata authored by the connected account. It does not add another CSP
origin or relay permission. Before the UI uses an event, the pinned
`nostr-tools` implementation verifies its id/signature, kind and exact account
pubkey. Strings are bounded and rendered with `textContent`; the avatar accepts
credential-free HTTPS only, uses `referrerpolicy="no-referrer"`, and keeps a
local fallback on absence or failure.

A valid signature proves which Nostr key published the event. It does **not**
verify the truth of a display name, image, biography or self-declared NIP-05
string. The UI says so. Profile failure never gates signing, wallet recovery or
payment actions, and identity-generation plus `AbortSignal` fences prevent a
late result from crossing disconnect or account replacement.

## Plebeian badge

No trusted Plebeian badge issuer pubkey, NIP-58 badge definition coordinate or
acceptance policy exists in this repository's `internal/poc`, browser wallet,
deployment configuration or contributor documentation. The default
PlebeianApp/market source at commit
`d4757b409b58e0ecf7c43e53629dd464c32dfb4e` contains a distinct NIP-05
validation check, not evidence of a Plebeian NIP-58 award. A NIP-05 checkmark
must not be relabeled as a Plebeian badge.

The current authoritative NIP-58 contract uses:

- kind `30009` for the issuer's badge definition;
- kind `8` for the issuer's immutable award referencing that definition;
- kind `10008` for the user's accepted/displayed profile badges; and
- kind `30008` for badge sets. The older `30008` `profile_badges` form is
  deprecated but may be treated equivalently during migration.

Until maintainers provide and review the exact issuer pubkey, definition `d`
identifier/coordinate, relay discovery policy and acceptance semantics, the
candidate renders **Plebeian badge · verification unavailable**. Connected
status, self-claimed kind-0 fields and arbitrary awards cannot upgrade it.

References:

- <https://github.com/nostr-protocol/nips/blob/master/58.md>
- <https://github.com/PlebeianApp/market/blob/d4757b409b58e0ecf7c43e53629dd464c32dfb4e/src/components/Nip05Badge.tsx>
- <https://github.com/PlebeianApp/market/blob/d4757b409b58e0ecf7c43e53629dd464c32dfb4e/src/queries/profiles.tsx>
