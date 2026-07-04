# AGENTS.md — scripts

This directory follows the repository-level AGENTS.md.

## Context

`scripts/` contains Bun TypeScript utilities and shell scripts for tasks such as
seeding, startup, relay migration, wallet/test data generation, icon building,
and deployment support.

## Constraints

- Do not run startup, seed, generator, deployment, migration, or wallet-related
  scripts without explicit approval.
- Scripts may write files, publish to relays, create test data, or touch
  deployment targets. Inspect the script before recommending or running it.
- Do not print or copy private keys, wallet files, NWC URIs, Cashu seed
  material, tokens, or sensitive environment values.
- Keep Nostr publishing and payment semantics explicit. Script success is not
  proof that relay propagation, payment settlement, or merchant confirmation
  occurred.

## Instructions

- Use Bun-compatible APIs for TypeScript scripts.
- Prefer narrow script changes that preserve existing command names unless a
  maintainer asks for workflow changes.
- When documenting a script, state likely side effects: file writes, relay
  writes, network access, process startup, or deployment.

## Safe Checks

- `git diff --check`
- `bun run format:check`
