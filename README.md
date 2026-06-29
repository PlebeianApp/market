# Plebeian Market

A decentralized, peer-to-peer marketplace built on the [Nostr](https://github.com/nostr-protocol/nostr) protocol. All marketplace data — product listings, orders, profiles, messages — lives on Nostr relays. There is no central database. Payments are settled over the Bitcoin Lightning Network.

For protocol and data-model details see [SPEC.md](./SPEC.md) and [gamma_spec.md](./gamma_spec.md).

## Key Features

- **Product listings** — create, edit, and browse physical/digital goods stored as Nostr events
- **Shopping cart** — multi-item cart persisted client-side
- **Lightning payments** — pay via NWC (Nostr Wallet Connect), WebLN, or QR/BOLT11 invoice
- **Order management** — order lifecycle from pending → paid → shipped → completed
- **Buyer–seller messaging** — direct Nostr encrypted DMs per order
- **Vanity URLs** — human-readable handles (`/@alice`) backed by NIP-05
- **V4V payment splits** — value-for-value splits to creators/affiliates on each sale
- **NIP-05 identity** — verified handles and identity lookup
- **Web of Trust** — reputation and trust scoring via [NDK WoT](https://github.com/nostr-dev-kit/ndk)
- **ContextVM** — on-demand currency conversion server for fiat↔BTC pricing

## Tech Stack

| Layer    | Technology                                                                |
| -------- | ------------------------------------------------------------------------- |
| Runtime  | [Bun](https://bun.sh)                                                     |
| Frontend | React 19, TypeScript, TanStack Router, TanStack Query & Store             |
| Styling  | Tailwind CSS v4, [shadcn/ui](https://ui.shadcn.com) (Radix)               |
| Nostr    | [NDK v3](https://github.com/nostr-dev-kit/ndk)                            |
| Backend  | Bun WebSocket server (ContextVM currency server)                          |
| Testing  | `bun:test` (unit/integration), [Playwright](https://playwright.dev) (E2E) |

## Prerequisites

- **Bun v1.2+** — [install instructions](https://bun.sh/docs/installation)
- **Go** (optional) — only needed to install the `nak` local relay for development
- A **Nostr client or browser extension** (e.g. [Alby](https://getalby.com), [nos2x](https://github.com/fiatjaf/nos2x)) for testing authentication flows

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Configure environment (local dev with a local relay)
cp .env.local.example .env.local
#   Edit .env.local and fill in your keys (see Environment Variables below)

# 3. Initialize default app settings (settings, roles, ban list, relay list)
bun run startup

# 4. Start the dev server
bun dev
```

The app is served at `http://localhost:3000` by default. On first run, if no settings are found on the configured relay you will be redirected to `/setup`; the first user to complete setup becomes the administrator (skip this if you ran `bun run startup`, which seeds defaults).

> **Tip:** `bun dev:seed` is a one-command shortcut that runs `startup` + `seed` + the dev server for a fully-populated local environment.

## Environment Variables

The repo ships **three** example files. Copy the one that matches your workflow:

| File                 | When to use                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `.env.example`       | **Production / staging** template. Uses a public relay and a remote currency server.              |
| `.env.local.example` | **Local development** against a local relay, with ContextVM currency features enabled.            |
| `.env.dev.example`   | **Minimal local dev** against a local relay, with no ContextVM keys (currency features disabled). |

### Variable reference

| Variable                       | Description                                                                                                                  | Required?               | Example                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------- |
| `NODE_ENV`                     | Runtime mode (`development` or `production`).                                                                                | Yes                     | `development`                      |
| `APP_RELAY_URL`                | Nostr relay URL the app reads from and writes to.                                                                            | Yes                     | `ws://localhost:10547`             |
| `APP_PRIVATE_KEY`              | App's Nostr private key (hex), used for initialization and signing.                                                          | Yes                     | _generate with `nak key generate`_ |
| `CVM_SERVER_KEY`               | ContextVM currency server **private** key (hex).                                                                             | For currency features   | _generate with `nak key generate`_ |
| `CVM_SERVER_PUBKEY`            | ContextVM currency server **public** key (hex), derived from `CVM_SERVER_KEY`.                                               | Local relay w/ currency | _derive with `nak key public`_     |
| `LOCAL_RELAY_ONLY`             | Restrict the app to the local relay only (skip public relays).                                                               | No (local dev)          | `true`                             |
| `NEXT_PUBLIC_MARKET_AGG_RELAY` | Market aggregator relay for faster reads via cached events. When unset, reads fall back to the main relay + public defaults. | No                      | `wss://your-agg-relay.example.com` |

## Available Scripts

Every script below is defined in [`package.json`](./package.json). `bun run <name>` is the explicit form; for scripts whose name contains no colon, the `bun <name>` shorthand also works (e.g. `bun dev`, `bun seed`).

### Development

| Command                   | Description                                                           |
| ------------------------- | --------------------------------------------------------------------- |
| `bun dev`                 | Dev server with hot reload (public relays).                           |
| `bun dev:local-only`      | Dev server restricted to the local relay (`LOCAL_RELAY_ONLY=true`).   |
| `bun dev:seed`            | Dev server after running `startup` + `seed` (fully seeded local env). |
| `bun run watch-routes`    | Watch route files and regenerate the route tree on change.            |
| `bun run generate-routes` | Generate the route tree once (`tsr generate`).                        |

### Build & Run

| Command                    | Description                                         |
| -------------------------- | --------------------------------------------------- |
| `bun start`                | Production server (generates routes first).         |
| `bun run start:local-only` | Production server, local relay only.                |
| `bun run start:production` | Production server with `NODE_ENV=production`.       |
| `bun run start:staging`    | Staging server with `NODE_ENV=production`.          |
| `bun run build`            | Build the application (generates routes + bundles). |
| `bun run build:production` | Production build (minified, no source maps).        |
| `bun run deploy:staging`   | Deploy to staging via `scripts/deploy-staging.sh`.  |

### App Initialization & Data

| Command                        | Description                                                         |
| ------------------------------ | ------------------------------------------------------------------- |
| `bun run startup`              | Initialize the app with default settings (roles, ban list, relays). |
| `bun seed`                     | Seed the configured relay with test data.                           |
| `bun run build-icons`          | Rebuild icon components from SVG sources.                           |
| `bun run dev:contextvm-server` | Start the ContextVM currency conversion server.                     |

### Formatting

| Command                | Description                               |
| ---------------------- | ----------------------------------------- |
| `bun run format`       | Format all files with Prettier.           |
| `bun run format:check` | Check formatting without modifying files. |

### Testing

| Command                    | Description                                     |
| -------------------------- | ----------------------------------------------- |
| `bun run test:unit`        | Run unit tests (`bun:test`).                    |
| `bun run test:unit:watch`  | Run unit tests in watch mode.                   |
| `bun run test:integration` | Run integration tests.                          |
| `bun run test:e2e`         | Run E2E tests with Playwright (headless).       |
| `bun run test:e2e:headed`  | Run E2E tests with a visible browser.           |
| `bun run test:e2e:ui`      | Run E2E tests in the interactive Playwright UI. |
| `bun run test:e2e:debug`   | Run E2E tests in step-through debug mode.       |

## Local Relay Setup

Local development needs a Nostr relay to read/write events. The recommended option is [nak](https://github.com/fiatjaf/nak):

```bash
# Install nak (requires Go)
go install github.com/fiatjaf/nak@latest

# Start a local relay on ws://localhost:10547
nak serve
```

Point `APP_RELAY_URL` at this relay in your `.env.local`. To populate it with test data, either run `bun seed` manually or use `bun dev:seed`, which seeds automatically as part of startup.

## Development Workflow

A typical local dev session uses two terminals:

```bash
# Terminal 1 — route watcher (regenerates src/routeTree.gen.ts on file changes)
bun run watch-routes

# Terminal 2 — dev server (seeded)
bun dev:seed
```

- **Routing** is file-based via TanStack Router. Without `watch-routes` running, new/changed routes in `src/routes/` won't be picked up until you regenerate the route tree.
- **Formatting** — Prettier config: tabs, no semicolons, single quotes, 140 char width. Run `bun run format` before committing, or rely on the `format:check` gate.
- **Testing** — write unit/integration tests with `bun:test`; cover user flows with Playwright E2E tests under `e2e/`. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow.

## Releasing

Staging deploys automatically after the `E2E Tests` workflow succeeds on `master`. Production deploys require the `production` environment approval and can be triggered either by pushing a `*-release` tag or by running the `Promote to Production` workflow, which creates the next release tag for you.

### One-liner

```bash
git tag v0.2.9-release && git push origin v0.2.9-release
```

### Steps

1. Ensure all changes are merged to `master`
2. Wait for staging deployment to finish successfully
3. Either:
   Create and push a new tag with incremented version:
   ```bash
   git tag vX.Y.Z-release && git push origin vX.Y.Z-release
   ```
4. Or run `Promote to Production` in GitHub Actions and choose `patch`, `minor`, or `major`
5. The `Deploy to Production` workflow will build and deploy the selected tag after approval

## Project Structure

```
.
├── src/
│   ├── routes/        # File-based routes (TanStack Router → routeTree.gen.ts)
│   ├── components/    # React components; ui/ holds Radix/shadcn primitives
│   ├── queries/       # React Query hooks + query-key factory
│   ├── lib/stores/    # Global state stores (auth, cart, ndk, wallet, ui…)
│   ├── lib/schemas/   # Zod validation schemas
│   └── server/        # Backend event handling (NDK, validation, signing)
├── contextvm/         # ContextVM currency conversion server
├── e2e/               # Playwright tests + page objects (e2e/po/)
├── scripts/           # Seed, startup, icon build, deploy, and data-gen scripts
├── docs/              # Feature and architecture documentation
├── public/            # Static assets
└── styles/            # Global stylesheets
```

See [CLAUDE.md](./CLAUDE.md) for the architecture overview and development patterns (query-key factory, store pattern, route loaders, Zod validation).

## Documentation

- [CONTRIBUTING.md](./CONTRIBUTING.md) — How to contribute (git workflow, code style, testing)
- [CLAUDE.md](./CLAUDE.md) — Architecture overview and dev patterns for AI assistants and contributors
- [docs/](./docs) — Feature documentation, ADRs, and workflow notes
- [SPEC.md](./SPEC.md) — Marketplace protocol specification
- [gamma_spec.md](./gamma_spec.md) — Extended protocol / data-model spec
- [RELAY_PLAN.md](./RELAY_PLAN.md) — Relay strategy and configuration
