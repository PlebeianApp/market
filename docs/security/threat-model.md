# Threat Model

This document is a maintainer-safe threat model. It avoids exploit payloads and secret values. Re-check current code before treating any item as current behavior.

## Assets

- User signing authority and delegated signing sessions.
- App-server private key and app-signed event authority.
- Admin, editor, blacklist, relay, and setup state.
- Listings, collections, shipping options, orders, private order details, comments, and payment requests.
- NWC strings, wallet permissions, Cashu/NIP-60 seeds, proofs, tokens, and pending wallet state.
- NIP-05, vanity, auction, zap-purchased, and paid-feature state.
- Browser storage, local relay state, CI secrets, deployment secrets, and logs.

## Trust Boundaries

```text
Browser UI
  -> untrusted relay content
  -> localStorage/sessionStorage/IndexedDB
  -> NIP-07 extension or NIP-46 signer
  -> NWC wallet and Cashu mint

App server
  -> WebSocket event ingestion
  -> app-key validation and signing
  -> relay publication
  -> zap receipt subscription
  -> NIP-05 and vanity endpoints

External systems
  -> Nostr relays
  -> Lightning services and LNURL endpoints
  -> NWC wallets
  -> Cashu mints
  -> mempool and exchange-rate APIs
  -> CI/deploy infrastructure
```

Default stance: relays, wallet responses, zap receipts, user content, media URLs, and external APIs are untrusted until validated for the specific workflow.

## Threat Actors

- Malicious buyer.
- Malicious seller.
- Malicious relay.
- Malicious or compromised admin/editor.
- Compromised browser extension.
- Compromised NIP-46 signer.
- Malicious NWC wallet.
- Malicious Cashu mint.
- Malicious zapper.
- Replay attacker.
- Spammer, crawler, or scraper.
- Supply-chain attacker.
- Compromised app-server key.
- Confused first-run bootstrap user.

## Nostr Protocol Risks

- Invalid event shape accepted or re-signed by the app key.
- Wrong author or participant accepted for order/payment/status events.
- Replaceable or addressable events read without canonical coordinate and latest-valid timestamp policy.
- Kind `5` deletion/tombstone events ignored by read models.
- Relay inconsistency causing stale, duplicated, or replayed state.
- Paid-feature events granted from insufficiently verified zap receipts.
- NIP-05 or vanity names bound to the wrong identity.
- Gamma marketplace compatibility requires validating product, collection, shipping, order, payment receipt, and review event shapes against expected kind/tag semantics before accepting, rendering, or acting on relay data.

Mitigations:

- Schema-validate all accepted event kinds and tags.
- Treat event id, pubkey, signature, kind, `d` tag, `a` tag, timestamp, and role list membership as explicit inputs.
- Fail closed when participant, relay, timestamp, deletion, replacement, or payment evidence is ambiguous.
- Add regression fixtures for accepted and rejected events.

## Bitcoin, Lightning, NWC, and Cashu Risks

- Treating wallet ACK, invoice creation, zap receipt, preimage, mempool observation, and confirmation as the same state.
- Granting paid benefits before settlement evidence is sufficient for that feature.
- Storing bearer Cashu tokens/proofs or NWC strings in plaintext browser storage.
- Leaking wallet permissions, payment metadata, preimages, or token material through logs.
- Trusting a malicious wallet or mint response without workflow-specific validation.

Mitigations:

- Model payment states explicitly.
- Keep custody and trust assumptions visible in UI and docs.
- Minimize persisted wallet material and redact logs.
- Verify amount, invoice binding, recipient, expiry, and settlement evidence before irreversible benefits.
- Treat Cashu tokens/proofs as bearer assets.

## Browser and Rendering Risks

- XSS through untrusted listing text, profile metadata, map popups, markdown-like content, media URLs, or dynamic CSS.
- Wallet/signing compromise through browser storage exposure after XSS.
- Privacy leaks through third-party media, avatars, maps, and payment endpoints.

Mitigations:

- Escape or sanitize untrusted content at every rendering sink.
- Forbid unsafe URL schemes for media and styles.
- Prefer text APIs over HTML APIs for untrusted fields.
- Add tests around known rendering sinks.
- Keep wallet material out of persistent storage where practical.

## Admin and Bootstrap Risks

- First user on an empty relay becomes admin unintentionally.
- Setup events accepted from the wrong signer.
- App-key re-signing grants authority beyond intended event kinds.
- Admin/editor lists are replayed or replaced unexpectedly.

Mitigations:

- Bind bootstrap authority to maintainer-controlled deployment state.
- Validate setup signer, owner identity, event kind, tags, and timestamp.
- Restrict app-key signing to narrow allowlists.
- Log decisions without logging secrets.

## CI and Supply-Chain Risks

- Unpinned runtimes and mixed package-manager artifacts causing drift.
- CI secrets exposed through logs.
- Test fixtures containing real-looking credentials.
- Build and route generation mutating tracked output unexpectedly.

Mitigations:

- Pin or document runtime policy.
- Use Bun consistently unless maintainers choose otherwise.
- Add tracked-file secret scanning.
- Redact CI logs.
- Treat generated-file changes as reviewable output.

## Open Decisions

- Exact rotation policy for any previously committed app key material.
- Final package-manager and runtime pinning policy.
- Whether generated route files remain tracked.
- Bootstrap authority design.
- Paid-feature settlement evidence per feature.
- Browser wallet storage baseline.
