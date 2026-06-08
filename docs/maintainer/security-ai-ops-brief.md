# Security and AI Operations Brief

Classification: maintainer-facing security and AI operations guidance. Keep this document safe for a public repository: no secret values, exploit payloads, or step-by-step abuse instructions.

## Snapshot Warning

Audit notes are snapshots, not gospel. Re-check the current branch, commit, worktree, docs, scripts, env examples, workflows, and relevant source files before relying on any finding.

Current local audit context captured on 2026-06-08:

- Branch: `docs/maintainer-audit-llm-guidance`
- Commit: `c4b9b15995f128d5e61f9175c3fbd59a6356fa27`
- Package manager signal: Bun with `bun.lock`; `package-lock.json` is also tracked.
- Generated-file signal: `src/routeTree.gen.ts` is tracked; route generation and build can mutate it.
- Secret-hygiene signal: tracked `.env.dev` contains an `APP_PRIVATE_KEY` variable. Values must never be printed.

## Architecture Map

```text
Browser UI
  -> TanStack Router routes in src/routes
  -> TanStack Query read models in src/queries
  -> TanStack Store/localStorage/IndexedDB wallet, auth, cart, and app state in src/lib/stores
  -> NDK/nostr-tools signer and relay clients
  -> Nostr relays for listings, orders, app data, metadata, lists, zaps, wallets, and comments

Bun app server
  -> src/index.tsx HTTP, WebSocket, static serving, zap purchase endpoint, NIP-05
  -> src/server EventHandler, EventValidator, EventSigner, BootstrapManager
  -> app relay publishes app-signed accepted events
  -> zap purchase managers consume zap receipts and publish paid-feature registry events
```

Primary principle: marketplace data lives on Nostr relays. The app server must remain a narrow signer/validator/coordinator, not an opaque canonical database.

## Protocol Surface

Confirmed protocol areas include:

- NIP-99 product/classified listings, especially kind `30402`.
- Gamma and legacy marketplace-style product, collection, shipping, and order events.
- Private order details using NIP-59 gift wrap/seal/rumor flows and order-related kind `16` messages.
- NIP-57 zap requests and receipts for paid features.
- NIP-46 remote signing and NIP-07 extension signing.
- NIP-05 names and paid/vanity names.
- NIP-47/NWC wallet connection strings and wallet interactions.
- NIP-51-style admin, editor, blacklist, relay, and app lists.
- Replaceable/addressable events, deletion events, and tombstone-sensitive read models.
- NIP-60/Cashu-style ecash wallet state and bearer-token handling.

Reference docs:

- Nostr NIPs: <https://nips.nostr.com/>
- Bitcoin developer guide: <https://developer.bitcoin.org/devguide/index.html>
- Core Lightning docs: <https://docs.corelightning.org/docs/home>
- Cashu docs: <https://docs.cashu.space/>

## Current Security Posture

Confirmed in the 2026-06-08 local audit:

- `.env.dev` is tracked and contains an `APP_PRIVATE_KEY` variable. Treat this as a rotation and secret-hygiene risk until PR 1 resolves tracking and ignore policy.
- First-run setup enters bootstrap behavior when no admin state is found. Setup signer and configured owner need stricter binding before setup is safe for unattended shared relays.
- Zap purchase receipt handling parses and correlates receipts, but additional NIP-57 verification is needed before paid benefits should be treated as settled.
- Browser storage contains signer, NWC, Cashu/NIP-60, cart, and pending-token state. Any XSS can become a wallet and identity risk.
- Some order lifecycle read paths correlate events by order tags and participants. Authorization and authorship checks need tightening for status, payment, shipping, and receipt events.
- Untrusted marketplace and location content reaches media, dynamic style, and map popup boundaries. These sinks need explicit sanitization and URL policy.
- Product/payment deletion has local deletion tracking and kind `5` publication, but read-side remote tombstone and addressable-event replacement policy needs a focused audit.
- Build and route generation can mutate tracked generated files. Treat build output changes as reviewable artifacts.

## Critical and High Work Queue

1. Env/secret hygiene: untrack local env material without deleting developer files, ignore local env variants, add a tracked-file secret guard, and document key rotation risk.
2. First-run bootstrap hardening: bind setup authority to maintainer-controlled identity or deployment state and fail closed for ambiguous bootstrap conditions.
3. NIP-57 zap receipt verification: verify receipt authorship, request identity, invoice correlation, amount, recipient, timestamp, and replay behavior before granting paid benefits.
4. Order event authorization: require participant/authorship and event-shape checks for order lifecycle events.
5. XSS/media sink hardening: sanitize or escape untrusted relay/user content before HTML, style URL, image/media, map popup, or rich rendering boundaries.
6. NIP-09 deletion and addressable-event dedupe: respect tombstones and reduce replaceable/addressable events by canonical coordinate and latest valid timestamp.
7. Wallet/Cashu/NWC secret-at-rest baseline: reduce plaintext persistence where possible and document remaining browser threat model.
8. CI/build hygiene: clarify package manager policy, runtime pinning, generated-file policy, and focused CI scripts.

## Bottlenecks

- Payment evidence is multi-state. Wallet ACK, invoice creation, zap receipt, preimage, mempool observation, and confirmation are not equivalent.
- Relay data is eventually consistent, adversarial, and replayable. Query code must validate identity, tags, timestamps, deletion state, and replacement semantics.
- Browser storage is convenient but high impact for wallets and signers. XSS hardening and storage minimization are prerequisites for safer payment UX.
- App-key signing is powerful. Re-signing paths need narrow allowlists, schema validation, timestamp checks, and role checks.

## AI and Automation Opportunities

- Tracked-file secret scanning with explicit allowlists for examples and intentional test fixtures.
- Static checks for unsafe rendering sinks, dynamic CSS URLs, HTML insertion, and untrusted media fields.
- Protocol fixture tests for NIP-99, NIP-57, NIP-59, NIP-09, NIP-47, and NIP-60 boundaries.
- Payment-state regression tests that distinguish pending, acknowledged, settled, expired, failed, refunded, zero-conf, and confirmed states.
- LLM-assisted issue drafting and PR review summaries, limited to redacted outputs and current-file evidence.

## LLM Workflow Policy

- Use prior audits as leads only. Verify current files first.
- Separate confirmed behavior, inferred risk, recommended fix, and open questions.
- Do not mutate issues, branches, commits, pushes, deploys, env files, or generated code unless explicitly asked.
- Keep patches small enough for human review and rollback.
- Prefer tests over assertions. For security work, include a regression test that fails before the fix when practical.

## Maintainer Decision Log

Open decisions:

- Whether `.env.dev` contained only disposable test material or requires rotation of a real app key.
- Whether `package-lock.json` remains intentionally tracked or should be removed in a separate tooling PR.
- Whether `src/routeTree.gen.ts` should remain tracked and what build-generated drift policy reviewers should enforce.
- What exact setup authority model should replace first-run bootstrap.
- What payment evidence is sufficient for each paid feature and marketplace order state.
- Which wallet materials may remain in browser storage and under what warnings or encryption gates.

## Immediate PR 1 Boundary

PR 1 should be only env/secret hygiene:

- Untrack `.env.dev` without deleting local developer files.
- Ignore local env files.
- Preserve `.env.example`, `.env.dev.example`, and `.env.local.example`.
- Add a lightweight tracked-file secret guard in CI.
- Optionally support staged-file scanning for local pre-commit usage.
- Document key rotation risk.

PR 1 non-goals:

- Do not clean git history.
- Do not rotate keys automatically.
- Do not patch bootstrap, NIP-57, wallet/Cashu/NWC storage, order lifecycle, XSS/media, package manager policy, route generation, or app behavior.
- Do not mutate issue trackers.
