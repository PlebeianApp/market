# Plebeian Market Architecture

## Overview

Plebeian Market is a full-stack decentralized e-commerce marketplace built on the Nostr protocol. It enables peer-to-peer commerce using Bitcoin Lightning payments.

**Runtime:** Bun (JavaScript runtime)
**Frontend:** React 19 with TypeScript
**Backend:** Bun WebSocket server with Nostr relay integration

## Project Structure

```
/src
├── index.tsx                      # Bun server entry point
├── frontend.tsx                   # React app with Router & Query setup
├── routes/                        # File-based routing (TanStack Router)
│   ├── __root.tsx                # Root layout wrapper
│   ├── index.tsx                 # Home page
│   ├── products.index.tsx        # Products listing
│   ├── products.$productId.tsx   # Product detail (dynamic route)
│   ├── _dashboard-layout.tsx     # Layout route (underscore prefix)
│   └── ...other routes
├── components/                    # React components
│   ├── ui/                       # shadcn/ui base components
│   ├── layout/                   # Header, Footer, etc.
│   └── ...feature components
├── lib/
│   ├── stores/                   # TanStack Store state management
│   │   ├── auth.ts              # Authentication state
│   │   ├── cart.ts              # Shopping cart (complex, 40KB)
│   │   ├── ndk.ts               # Nostr Dev Kit store
│   │   └── ...other stores
│   ├── utils/                    # Utility functions
│   ├── schemas/                  # Zod validation schemas
│   ├── queryClient.ts            # React Query configuration
│   └── relays.ts                 # Nostr relay configuration
├── queries/                      # React Query hooks & factories
│   ├── queryKeyFactory.ts       # Query key factory pattern
│   ├── products.tsx             # Product queries
│   └── ...other query files
├── hooks/                        # Custom React hooks
├── publish/                      # Nostr event publishing
├── server/                       # Backend server code
└── assets/                       # Fonts, images

/styles
├── globals.css                  # Tailwind + custom fonts
└── icons.css                    # Icon styles
```

## Key Architectural Patterns

### 1. File-Based Routing (TanStack Router)

Routes are automatically generated from files in `/src/routes/`:

- **Dynamic segments:** Use `$paramName` syntax (e.g., `products.$productId.tsx`)
- **Layout routes:** Use underscore prefix (e.g., `_dashboard-layout.tsx`)
- **Index routes:** Use `.index.tsx` suffix

Route generation command: `bun run generate-routes` (creates `routeTree.gen.ts`)

### 2. State Management Strategy

**TanStack Store** for client state:

- Simple, reactive state management
- Store + action creator pattern
- Persisted to localStorage/IndexedDB

**React Query** for server/async state:

- Data fetching from Nostr relays
- Caching and background synchronization
- Query key factory pattern for cache management

### 3. Nostr Integration

All data flows through NDK (Nostr Dev Kit):

```typescript
const ndk = ndkActions.getNDK()
const events = await ndk.fetchEvents(filter) // Fetch from relays
await ndk.publish(event) // Publish to relays
```

### 4. Component Patterns

- Functional components only (React 19)
- Custom hooks for reusable logic
- shadcn/ui components (Radix UI + Tailwind)
- Composition over inheritance

### 5. Data Transformation Utilities

Extract data from Nostr events using utility functions:

```typescript
getProductTitle(product: NDKEvent)
getProductPrice(product: NDKEvent)
getProductImages(product: NDKEvent)
```

## Route Configuration

```typescript
// frontend.tsx
const router = createRouter({
	routeTree,
	context: { queryClient },
	defaultPreload: 'intent', // Preload on user intent
	defaultPreloadStaleTime: 0, // Fresh data on preload
})
```

## Server Architecture

The Bun server handles:

- Static file serving for public assets
- Configuration endpoint (`/api/config`)
- WebSocket handler for Nostr protocol messages
- Event verification and re-signing
- Relay publication for verified events

## Data Flow

1. **User Action** → Component
2. **Component** → Store action or Query mutation
3. **Store/Query** → NDK (Nostr Dev Kit)
4. **NDK** → Nostr relays (fetch/publish events)
5. **Relays** → NDK → Query cache → Component update
