# Agent Instructions

Plebeian Market is a decentralized Nostr marketplace and circular economy tool. Marketplace data should live on Nostr relays; the app server is a validation, app-signing, bootstrap/admin, NIP-05, vanity, zap-purchase, and web-delivery boundary.

## Standing Rules

- Inspect current files before making claims or patches. Prior audits are leads, not current truth.
- Do not print secret values. This includes private keys, nsec values, NWC strings, Cashu tokens or proofs, mnemonics, API keys, bearer tokens, preimages, seeds, and credentials.
- If secret-like material is found, report only path, variable or pattern name, and risk.
- Do not commit, push, create branches, rewrite history, deploy, release, or mutate GitHub or `bd` issues unless explicitly asked.
- Do not run `bd update`, `bd close`, `bd sync`, PR creation commands, deploy/release scripts, seed/startup scripts, dev servers, or destructive commands unless explicitly approved.
- Keep PRs small. Do not mix protocol/security changes with formatting churn, UI cleanup, or unrelated refactors.
- Treat relay data, wallet responses, user content, media URLs, and browser storage as untrusted.
- Never use display names, labels, array position, or optimistic UI state as canonical identity.
- Never treat payment state as a boolean. Preserve invoice lifecycle, expiry, settlement ambiguity, preimage/receipt evidence, refund/failure paths, and custody assumptions.

## Repo Map

- `src/server/`: app relay bridge, app-key signing, bootstrap/admin/editor validation, NIP-05, vanity, zap purchase flows.
- `src/lib/`: Nostr helpers, schemas, wallet/payment helpers, browser stores, checkout and order helpers.
- `src/queries/`: read-side Nostr query factories and parsing.
- `src/publish/`: write-side event construction and publication.
- `src/routes/`: TanStack Router route modules.
- `e2e/`: Playwright flows and local relay/browser test scaffolding.
- `scripts/`: local relay, seed, startup, wallet, deploy, and maintenance scripts.

## Command Safety

Use `docs/llm/command-safety.md` before running anything beyond read-only inspection.

Usually read-only: `pwd`, `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git remote -v`, `ls`, `rg`, `sed`, `cat`, `git diff`, `git ls-files`, `bun --version`, `node --version`.

Mutating or environment-dependent unless proven otherwise: `bun install`, `bun run format`, `bun run build`, `bun run generate-routes`, `bun run watch-routes`, `bun run seed`, `bun run startup`, `bun dev`, E2E, deploy/release, and issue-tracker commands.

## Verification and Done

- State the change classification before patching.
- Identify source of truth and trust boundaries before touching protocol, payment, wallet, signer, admin, or storage code.
- Show files likely to change before editing.
- Run the smallest relevant checks and report commands not run.
- After mutating-capable commands, run `git status --short`.
- A task is done only when the diff summary, checks, remaining risks, rollback notes, and PR framing are reported.
- Committing and pushing are not part of done unless explicitly requested.

## Review guidelines

These guidelines apply to AI-assisted reviewers and human reviewers. Reviews should be high-signal, maintainer-safe, and focused on risks that could block a safe merge. Prioritize confirmed P0/P1 correctness, security, protocol, payment, privacy, and data-loss issues over style comments.

### Review output

Lead with findings ordered by severity. For each finding, include:

- File/function or code path.
- Whether the issue is confirmed from the diff or inferred and needs verification.
- The broken invariant or trust boundary.
- What can go wrong for users, sellers, buyers, relays, wallets, payments, or maintainers.
- Why it matters for Nostr, Bitcoin, Lightning, Cashu, auctions, privacy, or user sovereignty.
- The smallest safe fix.
- The test or manual verification that proves the fix.

If there are no blocking findings, say so directly and list residual risks, missing checks, or test gaps.

### Scope and diff hygiene

Flag PRs that:

- Mix behavior changes with broad refactors, formatting churn, generated-file drift, dependency updates, or unrelated cleanup.
- Change protocol, payment, wallet, signer, relay, storage, or server behavior without naming the source of truth and trust boundary.
- Add dependencies in security-sensitive paths without a clear reason.
- Weaken tests, validators, auth checks, type checks, schema checks, or protocol checks to make CI pass.
- Rely on prior audit notes without re-checking current files.

Prefer the smallest reviewable fix. Ask for follow-up PRs when a change combines unrelated concerns.

### Nostr review priorities

Treat relay data as untrusted unless the code validates it.

Flag changes that:

- Use display names, product titles, labels, array order, route text, or optimistic UI state as canonical identity.
- Confuse event IDs, coordinates, pubkeys, tags, authors, signers, or profile metadata.
- Mix query/read flows with publish/signing/write flows.
- Silently change event kind, tag, author, signature, deletion, replacement, or addressable-event semantics.
- Assume one relay has complete, fresh, unique, honest, or canonical data.
- Fail to handle missing, stale, duplicated, malformed, deleted, replaced, or conflicting events.
- Move protocol parsing or validation into UI components when it belongs in query, schema, helper, or publish modules.
- Claim NIP compatibility without matching repo code and the relevant NIP behavior.

For Nostr findings, identify the event kind, tags, author/pubkey assumptions, relay behavior, and compatibility impact.

### Bitcoin, Lightning, Cashu, NWC, and payment review priorities

Treat payment state as a lifecycle, not a boolean.

Flag changes that:

- Blur invoice creation, payment attempt, wallet acknowledgement, settlement, confirmation, expiry, refund, failure, delivery, or receipt evidence.
- Treat zap receipts, preimages, wallet responses, relay events, or UI state as equivalent without validation.
- Mishandle sats/msats, fiat conversion, rounding, fees, minimums, maximums, or stale exchange rates.
- Leak sensitive payment metadata, wallet connection data, bearer tokens, Cashu proofs, NWC strings, preimages, private keys, seeds, mnemonics, or credentials.
- Add implicit custodial assumptions or weaken self-custody boundaries.
- Grant paid benefits before settlement or receipt verification is sufficient for that feature.

For payment findings, identify the lifecycle state being changed and the evidence required to advance state safely.

### Auction and marketplace review priorities

Flag changes that:

- Use product titles, seller names, bidder display names, or rendered order as identity.
- Confuse seller, buyer, bidder, winner, auctioneer, oracle, relay, app signer, or settlement authority.
- Change bid, reserve, start time, effective end time, definite end time, refund time, settlement, participant, or shipping semantics without explicit scope.
- Present stale or conflicting bid/settlement data as final.
- Hide refund, lockup, custody, expiry, or failure conditions from the user.
- Change product, shipping, order, review, collection, auction, bid, settlement, or comment behavior without preserving backward compatibility.

For auction findings, identify the canonical event/state owner and the UI/query/publish boundary involved.

### Browser storage, rendering, and privacy review priorities

Flag changes that:

- Store signer, wallet, NWC, Cashu, token, order, or private user data in browser storage without documenting the threat model.
- Render relay/user-controlled content into HTML, markdown, media, map popups, CSS URLs, links, or image fields without sanitization or URL policy.
- Introduce XSS, open redirect, tracking, metadata leakage, or unsafe clipboard/download behavior.
- Log secrets, tokens, payment details, private order content, or sensitive relay/user data.

### Server, app-signer, admin, and bootstrap review priorities

Flag changes that:

- Expand app-key signing authority without allowlists, schema validation, timestamp checks, role checks, and replay protection.
- Make bootstrap/admin/editor state depend on ambiguous relay state without fail-closed behavior.
- Treat the app server as the canonical marketplace database instead of a narrow validation, app-signing, bootstrap, NIP-05, vanity, zap-purchase, and web-delivery boundary.
- Change NIP-05, vanity, zap purchase, admin, editor, blacklist, relay-list, or app-settings behavior without an explicit authorization model.

### Test expectations

Prefer behavior-focused tests over implementation-detail tests.

Ask for tests when a PR changes:

- Canonical identity resolution.
- Event parsing, validation, replacement, deletion, or dedupe.
- Query/cache invalidation.
- Publish/signing behavior.
- Payment lifecycle transitions.
- Auction bid, settlement, or refund behavior.
- Wallet, storage, or signer flows.
- Secret handling, rendering sinks, or authorization checks.

For docs-only PRs, formatting checks are usually enough. Do not request app tests unless the docs claim behavior that should be verified against source.

## Deeper Docs

- Maintainer security and AI operations brief: `docs/maintainer/security-ai-ops-brief.md`
- LLM launch pad: `docs/llm/launch-pad.md`
- Command safety matrix: `docs/llm/command-safety.md`
- PR 1 env/secret hygiene playbook: `docs/llm/pr-playbooks/pr-01-env-secret-hygiene.md`
- Threat model: `docs/security/threat-model.md`
