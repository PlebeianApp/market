# Contributing to Plebeian Market

Thanks for your interest in contributing! This guide covers the git workflow, code style, and testing conventions for the Plebeian Market codebase.

For the architecture overview and development patterns (query-key factory, store pattern, route loaders, Zod validation), see [CLAUDE.md](./CLAUDE.md). For getting a local environment running, see the [README](./README.md).

## Git Workflow

- **Never commit or push directly to `master`.** Always create a feature/fix branch and open a pull request.
- **Never force-push to `master`.**
- **Branch naming:** `feat/short-description`, `fix/short-description`, `chore/short-description`, `docs/short-description`.
- **Commits:** use [Conventional Commits](https://www.conventionalcommits.org/) messages (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`, `style:`). Keep commits atomic — one logical change per commit.
- Before opening a PR, rebase on the latest `master` and ensure the test and formatting gates pass.

## Code Style

Formatting is enforced with Prettier. The config lives in `.prettierrc`:

- Tabs for indentation
- No semicolons
- Single quotes
- 140 character print width
- Bracket spacing on

Run `bun run format` to format, or `bun run format:check` to verify without modifying. Beyond formatting:

- TypeScript strict mode, with the `@/*` path alias for `src/`
- Guard clauses and early returns for error handling
- Functional React components with explicit TypeScript interfaces

## Testing

| Layer       | Tool       | Command                    | Location                                                     |
| ----------- | ---------- | -------------------------- | ------------------------------------------------------------ |
| Unit        | `bun:test` | `bun run test:unit`        | `contextvm/`, `src/queries/__tests__/`, `src/lib/__tests__/` |
| Integration | `bun:test` | `bun run test:integration` | `src/lib/__tests__/` (`*.integration.test.ts`)               |
| E2E         | Playwright | `bun run test:e2e`         | `e2e/` (page objects in `e2e/po/`)                           |

Guidelines:

- Add or update tests alongside the code they cover — in the same PR, not a follow-up.
- Prefer end-to-end coverage for user-facing flows; use unit tests for isolated logic (parsers, formatters, reducers).
- For manual E2E runs against a local relay, use `./scripts/start-test-env.sh` to bring up the relay + app, then `bun run test:e2e -- --headed`.

## Development Workflow

A typical session runs the route watcher and dev server in separate terminals:

```bash
bun run watch-routes   # regenerate src/routeTree.gen.ts on route changes
bun dev:seed           # dev server with startup + seeded test data
```

Without `watch-routes`, new or changed routes in `src/routes/` are not picked up until the route tree is regenerated.

## Reporting Issues

If you find a bug or have a feature request, please [open an issue](../../issues) with:

1. A clear title and description
2. Steps to reproduce (for bugs) or the motivation/use-case (for features)
3. Expected vs. actual behavior
4. Relevant environment details (browser, OS, relay)
