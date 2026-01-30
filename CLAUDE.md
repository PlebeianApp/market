# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Note**: This file is shared in the repo. Do not add developer-specific paths or local configuration here.

## Git Workflow

- **NEVER commit or push directly to `master`.** Always create a feature/fix branch and open a PR.
- **NEVER force-push to `master`.**
- **NEVER SSH into the plebeian.market production VPS.** Deployments are handled exclusively via GitHub Actions (release tags for production, master push for staging).
- Branch naming: `fix/short-description`, `feat/short-description`, `chore/short-description`.

## Project Overview

Plebeian Market is a decentralized marketplace built on the Nostr protocol. All data is stored on Nostr relays - there is no traditional database. Browser storage (localStorage, sessionStorage, IndexedDB) is only used for user preferences, auth keys, and temporary state like shopping carts.

Plebeian Market originally ran on NIP-15, but the current version uses NIP-99 with a migration path for existing users (see `src/routes/_dashboard-layout/dashboard/products/migration-tool.tsx`).

## Commands

```bash
bun install              # Install dependencies
bun dev                  # Start dev server (requires relay running)
bun dev:seed             # Start with seeded test data
bun run watch-routes     # Watch for route changes (run in separate terminal during development)
bun seed                 # Seed relay with test data
bun run format           # Format code with Prettier
bun run format:check     # Check formatting
bun test:e2e             # Run Playwright e2e tests (headless)
bun test:e2e:headed      # Run e2e tests with visible browser
bun test:e2e:chrome      # Run e2e tests in Chrome only
```

For local development, run a Nostr relay (e.g., `nak serve` at ws://localhost:10547) and configure `.env` from `.env.example`.

## Local Development Tools

**nak** (Nostr Army Knife) - Install from [github.com/fiatjaf/nak](https://github.com/fiatjaf/nak). Key commands:

```bash
nak serve          # Start local relay at ws://localhost:10547
nak key generate   # Generate new Nostr keypair
nak decode <nip19> # Decode nip19/nip05 entities
nak fetch <nip19>  # Fetch events by identifier
nak mcp            # Start MCP server for AI integration
```

**Environment files**:

- `.env.example` - Template for production environment variables
- `.env.dev.example` - Template for local development (uses `nak serve` at ws://localhost:10547)
- Copy the appropriate template to `.env` and configure

**Important**: Always run `bun run format` before committing or pushing changes.

**After pushing**: Check GitHub Actions/workflows to confirm there are no failures.

**Creating issues**: Check `.github/ISSUE_TEMPLATE/` for bug report and feature request templates before creating issues.

## Architecture

### Data Flow

1. **Server** (`src/index.tsx`): Bun server that serves the SPA and provides `/api/config` endpoint. Handles WebSocket connections for admin event signing.

2. **Client initialization** (`src/frontend.tsx`): Fetches config from server, initializes NDK (Nostr Development Kit), creates TanStack Query client and router.

3. **State management**: TanStack Store for local state (`src/lib/stores/`), TanStack React Query for server state from Nostr relays.

### Key Directories

- `src/routes/` - File-based routing (TanStack Router). Route files export `Route` with optional `loader` for data prefetching.
- `src/lib/stores/` - TanStack Store state: `ndk.ts` (relay connections), `auth.ts` (user auth), `cart.ts` (shopping cart), `wallet.ts` (NWC wallets)
- `src/lib/schemas/` - Zod schemas for validating Nostr events
- `src/queries/queryKeyFactory.ts` - Query key factories for TanStack Query cache management
- `src/publish/` - Functions for publishing Nostr events
- `src/components/` - React components organized by feature

### Nostr Event Kinds

- 30402: Products
- 30403: Orders (legacy)
- 30405: Collections
- 30406: Shipping options
- 1063: Comments (NIP-22)
- 31990: App settings (NIP-89 Handler Information, d-tag: `plebeian-market-handler`)
- 31555: Product reviews
- 14, 16, 17: Order communication (NIP-17 encrypted DMs)

## Gamma Markets Specification

This project implements the [Gamma Markets e-commerce spec](https://github.com/GammaMarkets/market-spec), an extension of NIP-99 developed collaboratively by Nostr marketplace developers (Shopstr, Cypher, Plebeian, Conduit).

### Order Flow

1. Buyer creates order (Kind 16, type 1) with items and shipping
2. Merchant sends payment request (Kind 16, type 2) or buyer pays automatically
3. Buyer submits payment receipt (Kind 17) with proof
4. Merchant confirms and updates status (Kind 16, type 3)
5. Merchant provides shipping updates (Kind 16, type 4)

### Payment Methods

- Lightning Network via `lud16` addresses
- eCash tokens (locked to merchant pubkey)
- Manual processing (merchant-initiated requests)
- Generic payment proof for fiat gateways

### Key Design Decisions

- No cascading inheritance: products explicitly reference collection attributes
- All sensitive order communication uses NIP-17 encrypted DMs
- Merchants recommend preferred apps via NIP-89

### Authentication

Supports NIP-07 (browser extension), NIP-46 (bunker/remote signing), and local private key storage. Auth state managed in `src/lib/stores/auth.ts`.

## Tech Stack

- Runtime: Bun
- Framework: React 19
- Routing: TanStack Router (file-based)
- State: TanStack Store + TanStack React Query v5
- Styling: Tailwind CSS v4
- UI: Radix UI primitives
- Forms: TanStack Form + Zod
- Nostr: NDK (Nostr Development Kit)
- Testing: Playwright

## UI Components

Always use [Radix UI primitives](https://www.radix-ui.com/primitives/docs/overview/introduction) for UI components. Radix provides accessible, unstyled components that handle focus management, keyboard navigation, and ARIA attributes. See `src/components/` for existing patterns using Radix with Tailwind styling.

## Design

Figma designs: https://www.figma.com/design/re69Ae2WVk5yKdaGxCbnb5/Plebeian
