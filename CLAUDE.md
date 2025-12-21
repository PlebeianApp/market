# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
bun install              # Install dependencies
bun dev                  # Start dev server with hot reload
bun dev:seed             # Dev server with startup script and seed data
bun run watch-routes     # Watch route changes (run in separate terminal during dev)
bun start                # Production server
bun run build            # Build application
bun run build:production # Production build with minification
bun format               # Format code with Prettier
bun format:check         # Check formatting without modifying
bun seed                 # Seed relay with test data
bun run startup          # Initialize app with default settings
```

## Testing

E2E tests use Playwright. Tests are in `e2e/` directory.

```bash
bun test:e2e             # Run all E2E tests (headless)
bun test:e2e:headed      # Run with visible browser
bun test:e2e:ui          # Interactive Playwright UI
bun test:e2e:debug       # Debug mode (step-through)
```

For manual test environment control:

```bash
./scripts/start-test-env.sh    # Start relay + app
bun run test:e2e:manual        # Run tests (assumes services running)
```

## Architecture

**Decentralized marketplace** - All data stored on Nostr relays, no central database.

**Tech Stack:**

- React 19 + TypeScript
- TanStack Router (file-based routing in `src/routes/`)
- TanStack Query (server state in `src/queries/`)
- TanStack Store (client state in `src/lib/stores/`)
- Radix UI + Tailwind CSS 4
- Bun runtime and bundler
- NDK (Nostr Development Kit) for protocol integration

**Key Directories:**

- `src/routes/` - File-based routing (TanStack Router auto-generates `routeTree.gen.ts`)
- `src/components/` - React components; `ui/` contains Radix primitives
- `src/lib/stores/` - Global state stores (auth, cart, ndk, product, wallet, ui)
- `src/lib/schemas/` - Zod validation schemas
- `src/queries/` - React Query hooks and query key factory
- `src/server/` - Backend event handling (NDK, validation, signing)
- `e2e/` - Playwright tests with page objects in `e2e/po/`

## Development Patterns

**Query Key Factory** (`src/queries/queryKeyFactory.ts`):

```typescript
export const productKeys = {
	all: ['products'] as const,
	detail: (id: string) => [...productKeys.all, id] as const,
}
```

**Store Pattern** (`src/lib/stores/`):

- Separate stores per domain (auth, cart, ndk, etc.)
- Export both store and actions

**Route Loaders** - Use `queryClient.ensureQueryData()` for prefetching

**Zod Validation** - Runtime schemas in `src/lib/schemas/`, use `z.infer` for types

## Environment Setup

Copy `.env.example` to `.env`:

```
NODE_ENV=development
APP_RELAY_URL=ws://localhost:10547
APP_PRIVATE_KEY=<hex_private_key>
```

Local relay with [nak](https://github.com/fiatjaf/nak):

```bash
go install github.com/fiatjaf/nak@latest
nak serve  # Runs on ws://localhost:10547
```

## Code Style

- Prettier: tabs, no semicolons, single quotes, 140 char width
- TypeScript strict mode with `@/*` path alias
- Guard clauses and early returns for error handling
- Functional components with TypeScript interfaces
