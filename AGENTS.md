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

## Review Guidance

Lead reviews with findings ordered by severity. For each finding include file/function, confirmed or inferred status, what can go wrong, why it matters for Nostr/Bitcoin/Lightning/Cashu/user sovereignty, smallest safe fix, and the test that proves it.

## Deeper Docs

- Maintainer security and AI operations brief: `docs/maintainer/security-ai-ops-brief.md`
- LLM launch pad: `docs/llm/launch-pad.md`
- Command safety matrix: `docs/llm/command-safety.md`
- PR 1 env/secret hygiene playbook: `docs/llm/pr-playbooks/pr-01-env-secret-hygiene.md`
- Threat model: `docs/security/threat-model.md`
