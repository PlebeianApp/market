# Maintainer guide

## Current modules and responsibility boundaries

| Area | Source | Responsibility |
| --- | --- | --- |
| Consensus and application | `internal/poc/`, `main.go` | Deterministic admission, auction state and close |
| Browser catalogue | `internal/poc/static/`, `cashu-wrapper/ts/poc-friday-browser-entry.ts` | Presentation and user actions |
| Browser payments | `cashu-wrapper/ts/demo-friday-browser-*.ts` | Browser-local wallet, exact funding, certified imports |
| Authority | `cashu-wrapper/ts/demo-friday-authority-*.ts` | Monetary authorization service and lifecycle |
| Coordinator | `cashu-wrapper/ts/demo-friday-coordinator-*.ts` | Ordered orchestration and recovery |
| Terminal resolution | `cashu-wrapper/ts/demo-friday-fixed-terminal-resolver.ts` | Read committed history, resolve terminal evidence |
| Threshold signing | `cashu-wrapper/frost-participant-3of4/`, `cashu-wrapper/ts/demo-frost-*.ts` | Threshold participant and policy integration |
| Transport | `cashu-wrapper/ts/demo-fips-*.ts` | fips transport and ceremony adapters |
| Deployment | `deploy/`, `scripts/` | Operator tooling; not safe to run indiscriminately |

These are existing boundaries, not a claim that all large files have been split.
Do not rename all historical files in one change. Extract pure parsing and
presentation helpers first, then lifecycle state transitions, retaining import
compatibility and regression tests. Keep monetary effects behind existing
idempotent interfaces. Rebuild browser bundles after browser source changes and
record both source commit and artifact hash.

## Review checklist

1. State the affected module and invariants before implementation.
2. Add a regression for the failure, including interrupted/repeated operations.
3. Run focused tests, TypeScript check and relevant Go/UI checks.
4. Compare source changes and generated bundle provenance.
5. Obtain independent review for payment and recovery changes.
6. Record live deployment and acceptance separately from code review.

## Test groups

`package.json` is the authoritative command inventory. `test:friday:browser`
covers browser contracts; `test:friday` covers authority/coordinator/payment
regressions; `test:friday:coco-threshold` covers threshold wallet integration;
`test:friday:rust` covers participant code. Commands ending in `live` and the
integrated deployment scripts need their own isolated environment and permission.

## Publication

Use a reviewed source-only branch. Audit the complete outgoing commit range and
tracked binary archives, not just the latest diff. Ignore rules are not a secret
scan. Exclude runtime journals, state databases, private keys, wallet proofs,
service credentials and raw browser/session exports. Do not publish until target
ownership, branch, permissions, remote refs and the sanitized diff are verified.
Keep the original history locally; any sanitized export needs explicit provenance.
