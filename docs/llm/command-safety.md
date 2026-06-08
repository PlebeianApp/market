# Command Safety

Classify commands before running them. When a command can mutate files or external state, state the expected mutation and run `git status --short` afterward.

## Read-Only Inspection

Usually safe:

```sh
pwd
git status --short
git branch --show-current
git rev-parse HEAD
git remote -v
ls
rg
sed
cat
git diff
git ls-files
bun --version
node --version
```

Rules:

- Do not print secret values from env files, workflows, fixtures, local storage dumps, logs, or test output.
- For env files, list variable names only.
- For secret scans, output file paths and pattern names only.

## Dependency Install

Commands:

```sh
bun install
bun install --frozen-lockfile
```

Classification:

- dependency install
- mutating local state
- network dependent unless dependencies are already cached

Rules:

- Do not install unless dependencies are missing or the task explicitly requires it.
- Prefer `bun install --frozen-lockfile` for CI parity.
- Run `git status --short` afterward.

## Formatting

Commands:

```sh
bun run format:check
bun run format
```

Classification:

- `bun run format:check`: formatting check, expected read-only.
- `bun run format`: mutating local state.

Rules:

- Prefer `format:check` first.
- If writing format changes, scope them to files already in the task.

## Unit and Bun Tests

Commands:

```sh
bun run test:unit
bun test
```

Classification:

- unit test
- may be external-service dependent if broad discovery reaches integration-like tests

Notes:

- `bun run test:unit` is the curated CI unit script.
- `bun test` uses broad Bun discovery and may pick up Playwright specs, integration tests, server startup tests, or network-dependent tests.

Rules:

- Prefer `bun run test:unit` for docs-only preflight.
- If `bun test` fails because it discovers E2E or service-dependent tests, stop broad execution and report the failure.
- Do not patch source code only to make a docs-only task pass.

## Integration Tests

Command:

```sh
bun run test:integration
```

Classification:

- integration test
- external-service dependent
- may require local relay, ContextVM server, env vars, ports, and test keys

Rules:

- State required services and env before running.
- Do not start services unless explicitly approved or required by the task.

## Build and Generated Code

Commands:

```sh
bun run generate-routes
bun run watch-routes
bun run build
bun run build:production
```

Classification:

- generated-code update
- build
- mutating local state

Notes:

- `bun run build` runs route generation before building.
- `src/routeTree.gen.ts` is tracked.
- Build output may update `dist/`.

Rules:

- Run only when build or generated output is in scope.
- Run `git status --short` afterward and report generated-file drift.

## E2E Tests

Commands:

```sh
bun run test:e2e
bun run test:e2e:headed
bun run test:e2e:debug
bun run test:e2e:ui
```

Classification:

- E2E test
- mutating local state
- external-service dependent
- requires env/local relay/dev server/browser dependencies

Likely mutations:

- `test-results/`
- `playwright-report/`
- local relay state
- seeded test events

Rules:

- Do not run E2E until local service, browser, env, and report-output expectations are stated.
- Avoid running Playwright specs through broad `bun test`.

## Seed, Startup, and Dev Servers

Commands:

```sh
bun run seed
bun run startup
bun run dev
bun run dev:local-only
bun run dev:seed
bun run start
bun run start:local-only
bun run start:staging
bun run start:production
./scripts/start-test-env.sh
```

Classification:

- mutating local state
- external-service dependent
- may require secrets/env
- may publish Nostr events to configured relays

Rules:

- Do not run against shared, staging, production, or unknown relays unless explicitly intended.
- Confirm ports, env, relay URL, and output directories first.

## Deploy and Release

Commands:

```sh
bun run deploy:staging
git tag
git push
release workflows
deploy scripts
```

Classification:

- deploy/release
- mutating external state
- requires secrets/env

Rules:

- Do not run unless explicitly asked.
- Do not create tags, push branches, or trigger deploy workflows as part of ordinary coding tasks.

## Issue Tracker and GitHub Mutation

Commands:

```sh
bd update
bd close
bd sync
gh issue edit
gh pr create
gh pr merge
GitHub issue or PR mutation tools
```

Classification:

- issue-tracker mutation
- external-state mutation

Rules:

- Do not run unless explicitly asked.
- Read-only issue or PR inspection is allowed when necessary and within the user request.
