# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Plebeian Market is a decentralized marketplace built on the Nostr protocol. All data is stored on Nostr relays - there is no traditional database. Browser storage (localStorage, sessionStorage, IndexedDB) is only used for user preferences, auth keys, and temporary state like shopping carts.

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
- 30403: Orders
- 30405: Collections
- 30406: Shipping options
- 1063: Comments (NIP-22)
- 31990/30078: App settings

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
