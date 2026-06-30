# Plebeian Market - Architecture Documentation

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Application Architecture](#application-architecture)
5. [Data Flow](#data-flow)
6. [Nostr Integration](#nostr-integration)
7. [State Management](#state-management)
8. [Routing](#routing)
9. [Component Patterns](#component-patterns)
10. [Performance Optimization](#performance-optimization)

---

## Overview

Plebeian Market is a decentralized, Nostr-based e-commerce marketplace built with modern web technologies. The application leverages the Nostr protocol for data storage and synchronization, eliminating the need for traditional centralized databases.

### Key Characteristics

- **Decentralized**: All data stored as Nostr events on relays
- **End-to-end encrypted**: Sensitive data encrypted using Nostr encryption standards
- **Client-side first**: Most business logic runs in the browser
- **Real-time**: WebSocket-based Nostr subscriptions for live updates
- **Progressive Web App**: Can be installed and used offline (with caching)

---

## Technology Stack

### Frontend

| Technology          | Version | Purpose                  |
| ------------------- | ------- | ------------------------ |
| **React**           | 19.1.0  | UI framework             |
| **TypeScript**      | Latest  | Type safety              |
| **Bun**             | 1.2.4+  | Runtime & build tool     |
| **TanStack Router** | 1.124.0 | File-based routing       |
| **TanStack Query**  | 5.81.5  | Server state management  |
| **TanStack Store**  | 0.7.1   | Client state management  |
| **TanStack Form**   | 1.12.4  | Form handling            |
| **Tailwind CSS**    | 4.1.11  | Styling framework        |
| **Radix UI**        | Various | Accessible UI components |

### Nostr & Bitcoin

| Technology                    | Purpose |                         |
| ----------------------------- | ------- | ----------------------- |
| **@nostr-dev-kit/ndk**        | 2.18.1  | Nostr client library    |
| **nostr-tools**               | 2.15.0  | Nostr utilities         |
| **@nostr-dev-kit/ndk-wallet** | 0.6.2   | Wallet integrations     |
| **bitcoinjs-lib**             | 6.1.7   | Bitcoin utilities       |
| **@getalby/lightning-tools**  | 6.0.0   | Lightning Network tools |

### Development Tools

| Tool           | Purpose              |
| -------------- | -------------------- |
| **Playwright** | E2E testing          |
| **Prettier**   | Code formatting      |
| **Faker.js**   | Test data generation |

---

## Project Structure

```
market/
├── .claude/                    # Claude Code configuration & docs
│   ├── skills/                # Project-specific skills
│   └── settings.local.json    # Local settings
├── dist/                      # Build output
├── e2e/                       # E2E tests (Playwright)
├── public/                    # Static assets
│   └── images/               # Public images
├── scripts/                   # Utility scripts
│   ├── seed.ts               # Data seeding
│   ├── startup.ts            # App initialization
│   ├── gen_*.ts              # Data generators
│   └── deploy-staging.sh     # Deployment script
├── src/
│   ├── assets/               # Application assets
│   │   ├── fonts/           # Font files
│   │   └── icons/           # SVG icons
│   ├── components/           # React components
│   │   ├── ui/              # Generic UI components
│   │   ├── auth/            # Authentication components
│   │   ├── wallet/          # Wallet components
│   │   ├── orders/          # Order components
│   │   ├── checkout/        # Checkout flow
│   │   ├── messages/        # Messaging components
│   │   ├── v4v/             # Value4Value components
│   │   └── ...              # Other feature components
│   ├── config/               # Configuration files
│   ├── hooks/                # Custom React hooks
│   ├── lib/                  # Utilities & helpers
│   │   ├── schemas/         # Zod schemas & types
│   │   ├── stores/          # TanStack Store definitions
│   │   ├── utils/           # Utility functions
│   │   ├── constants.ts     # App constants
│   │   ├── nostr.ts         # Nostr helpers (if exists)
│   │   └── queryClient.ts   # React Query setup
│   ├── publish/              # Nostr event publishing logic
│   ├── queries/              # TanStack Query definitions
│   ├── routes/               # TanStack Router routes
│   │   └── _dashboard-layout/ # Dashboard layout routes
│   ├── frontend.tsx          # Frontend entry point
│   ├── index.tsx             # Server entry point
│   └── routeTree.gen.ts      # Generated route tree
├── styles/
│   └── index.css             # Global styles
├── build.ts                  # Build configuration
├── package.json              # Dependencies & scripts
├── tsconfig.json             # TypeScript config
└── README.md                 # Project documentation
```

### Key Directories Explained

#### `/src/components`

React components organized by feature/domain:

- **ui/**: Reusable, generic UI components (buttons, dialogs, inputs)
- **auth/**: Login, signup, key management
- **wallet/**: Payment method configuration, NWC setup
- **orders/**: Order display, status tracking
- **checkout/**: Multi-step checkout flow
- **messages/**: Buyer-seller messaging

#### `/src/queries`

TanStack Query definitions following the factory pattern:

```typescript
// Query key factory
export const productKeys = {
	all: ['products'] as const,
	lists: () => [...productKeys.all, 'list'] as const,
	details: (id: string) => [...productKeys.all, id] as const,
}

// Query options
export const productQueryOptions = (id: string) =>
	queryOptions({
		queryKey: productKeys.details(id),
		queryFn: () => fetchProduct(id),
	})
```

#### `/src/publish`

Functions for creating and publishing Nostr events:

- `products.tsx`: Product creation/update
- `profiles.tsx`: User profile management
- `payment.tsx`: Payment detail publishing
- `shipping.tsx`: Shipping option publishing
- `wallet.tsx`: Wallet configuration

#### `/src/lib/stores`

TanStack Store definitions for client-side state:

- `auth.ts`: Authentication state
- `cart.ts`: Shopping cart
- `config.ts`: App configuration
- `ndk.ts`: NDK instance & relay management
- `product.ts`: Product creation state
- `ui.ts`: UI state (modals, sheets, etc.)

#### `/src/routes`

File-based routing structure:

```
routes/
├── __root.tsx                 # Root layout
├── index.tsx                  # Homepage
├── setup.tsx                  # Initial app setup
├── _dashboard-layout.tsx      # Dashboard wrapper
└── _dashboard-layout/
    └── dashboard/
        ├── index.tsx          # Dashboard home
        ├── account/           # Account settings
        ├── sales/             # Sales management
        ├── products/          # Product management
        └── orders/            # Order management
```

---

## Application Architecture

### Client-Server Model

Plebeian Market uses a **hybrid architecture**:

```
┌─────────────────────────────────────────┐
│           Browser (Client)              │
│  ┌────────────────────────────────────┐ │
│  │  React App (frontend.tsx)          │ │
│  │  - TanStack Router                 │ │
│  │  - TanStack Query                  │ │
│  │  - NDK Client (WebSocket)          │ │
│  └────────────┬───────────────────────┘ │
└───────────────┼─────────────────────────┘
                │ HTTP/WS
                │
┌───────────────▼─────────────────────────┐
│      Bun Server (index.tsx)             │
│  ┌────────────────────────────────────┐ │
│  │  - Static file serving             │ │
│  │  - WebSocket (event handling)      │ │
│  │  - /api/config endpoint            │ │
│  │  - App settings initialization     │ │
│  └────────────┬───────────────────────┘ │
└───────────────┼─────────────────────────┘
                │ WebSocket
                │
┌───────────────▼─────────────────────────┐
│          Nostr Relays                   │
│  - Event storage                        │
│  - Subscription management              │
│  - Event broadcasting                   │
└─────────────────────────────────────────┘
```

### Server Responsibilities (index.tsx)

1. **Configuration API** (`/api/config`):
   - Fetches app settings from relay
   - Provides relay URLs to client
   - Indicates if setup is needed

2. **WebSocket Event Handler**:
   - Receives admin-signed events
   - Verifies and re-signs with app key
   - Publishes to configured relay

3. **Static File Serving**:
   - Serves public assets (images, fonts)
   - Serves built frontend bundle

4. **App Initialization**:
   - Loads app settings on startup
   - Initializes event handler with admin keys

### Client Responsibilities (frontend.tsx)

1. **Initialization**:
   - Fetches config from server (`/api/config`)
   - Creates NDK instance with relay connections
   - Sets up React Query client
   - Creates TanStack Router

2. **User Interface**:
   - Renders all UI components
   - Handles user interactions
   - Manages routing

3. **Data Management**:
   - Fetches data from Nostr relays via NDK
   - Caches data with TanStack Query
   - Manages optimistic updates

4. **Event Publishing**:
   - Signs events with user's key
   - Publishes to Nostr relays

---

## Data Flow

### Read Flow (Data Fetching)

```
User Action (e.g., navigate to product page)
           ↓
TanStack Router triggers loader
           ↓
Query Client checks cache
           ↓
    ┌─────┴─────┐
    │           │
  Cache Hit   Cache Miss
    │           │
    │           ↓
    │     Query Function executes
    │           ↓
    │     NDK subscription created
    │           ↓
    │     WebSocket → Nostr Relays
    │           ↓
    │     Events received
    │           ↓
    │     Events parsed & validated
    │           ↓
    │     Cache updated
    │           │
    └─────┬─────┘
          ↓
    Component renders with data
```

### Write Flow (Data Publishing)

```
User Action (e.g., create product)
           ↓
Form submission
           ↓
Validation (Zod schema)
           ↓
Create Nostr event
           ↓
Sign event with user key
           ↓
Optimistic update (UI)
           ↓
Publish to Nostr relays (NDK)
           ↓
    ┌─────┴─────┐
    │           │
  Success     Failure
    │           │
    │           ↓
    │     Rollback optimistic update
    │           ↓
    │     Show error message
    │           │
    └─────┬─────┘
          ↓
    Invalidate related queries
          ↓
    Refetch from relays
          ↓
    UI updates with server state
```

### Authentication Flow

```
User opens app
      ↓
Check auth state (TanStack Store)
      ↓
   ┌──┴──┐
   │     │
 Auth  No Auth
   │     │
   │     ↓
   │  Show login dialog
   │     │
   │  ┌──┴───────────┬─────────────┐
   │  │              │             │
   │ NIP-07      Private Key   Nostr Connect
   │  │              │             │
   │  │              │             ↓
   │  │              │      NIP-46 handshake
   │  │              │             │
   │  └──────┬───────┴─────────────┘
   │         │
   │    Get pubkey
   │         │
   └────┬────┘
        │
   Store in auth state
        │
   Initialize NDK with signer
        │
   Fetch user profile
        │
   App ready
```

---

## Nostr Integration

### NDK (Nostr Development Kit)

NDK is initialized in [src/lib/queryClient.ts](src/lib/queryClient.ts#L859):

```typescript
const ndk = new NDK({
	explicitRelayUrls: relayUrls,
	enableOutboxModel: true,
	cacheAdapter: new NDKCacheAdapterDexie({ dbName: 'plebeian-market-ndk' }),
})

await ndk.connect()
```

**Features used:**

- **Dexie cache adapter**: IndexedDB caching for offline support
- **Outbox model**: NIP-65 relay hints for better discoverability
- **Subscription management**: Automatic event fetching
- **Signer abstraction**: Supports multiple auth methods

### Event Kinds Used

| Kind  | NIP    | Purpose                       | Defined In                                                                |
| ----- | ------ | ----------------------------- | ------------------------------------------------------------------------- |
| 0     | NIP-01 | User profiles                 | Standard                                                                  |
| 14    | -      | Order general communication   | [src/lib/schemas/order.ts](src/lib/schemas/order.ts#L6)                   |
| 16    | -      | Order process & status        | [src/lib/schemas/order.ts](src/lib/schemas/order.ts#L7)                   |
| 17    | -      | Payment receipts              | [src/lib/schemas/order.ts](src/lib/schemas/order.ts#L8)                   |
| 10000 | NIP-51 | Mute/ban list                 | [SPEC.md](SPEC.md#L80)                                                    |
| 10002 | NIP-65 | Relay list                    | Standard                                                                  |
| 30000 | NIP-51 | User roles (admins/editors)   | [SPEC.md](SPEC.md#L84)                                                    |
| 30003 | NIP-51 | Featured collections          | [SPEC.md](SPEC.md#L98)                                                    |
| 30078 | NIP-78 | App-specific data (encrypted) | [SPEC.md](SPEC.md#L61)                                                    |
| 30402 | -      | Products                      | Standard marketplace                                                      |
| 30405 | -      | Product collections           | [SPEC.md](SPEC.md#L92)                                                    |
| 30406 | -      | Shipping options              | [src/lib/schemas/shippingOption.ts](src/lib/schemas/shippingOption.ts#L6) |
| 31990 | NIP-89 | App handler                   | [SPEC.md](SPEC.md#L3)                                                     |

### Encrypted Data (NIP-78)

Sensitive data is encrypted using NIP-04 (deprecated) or NIP-44:

- **Payment details**: Lightning addresses, xpubs
- **NWC strings**: Nostr Wallet Connect connection strings
- **V4V shares**: Value-for-value split configuration
- **Shipping addresses**: Customer addresses

Encryption targets:

- User → App pubkey (e.g., payment methods)
- App → User pubkey (e.g., wallet state)

### Relay Strategy

**Configured relays:**

- Primary: `APP_RELAY_URL` from `.env`
- NIP-46: `NIP46_RELAY_URL` or `wss://relay.nsec.app`
- Default relays: See [src/lib/constants.ts](src/lib/constants.ts#L3-L10)

**Relay usage:**

1. **App relay**: Stores app settings, roles, featured items
2. **User relays**: NIP-65 outbox model for user data
3. **Zap relays**: Dedicated relays for Lightning payment tracking

---

## State Management

### TanStack Store (Client State)

**Auth State** ([src/lib/stores/auth.ts](src/lib/stores/auth.ts)):

```typescript
type AuthState = {
	pubkey: string | null
	npub: string | null
	isAuthenticated: boolean
	loginMethod: 'nip07' | 'privateKey' | 'nostrConnect' | null
}
```

**Cart State** ([src/lib/stores/cart.ts](src/lib/stores/cart.ts)):

```typescript
type CartState = {
	items: CartItem[]
	sellers: Record<string, SellerCart>
	total: number
	// ... cart operations
}
```

**UI State** ([src/lib/stores/ui.ts](src/lib/stores/ui.ts)):

```typescript
type UIState = {
	isSidebarOpen: boolean
	activeSheet: string | null
	activeDialog: string | null
	theme: 'light' | 'dark' | 'system'
}
```

### TanStack Query (Server State)

**Cache structure:**

```typescript
// Query keys are hierarchical
;['products'][('products', 'list', filters)][('products', productId)][('profiles', pubkey)][('orders', orderId)] // All products // Filtered product list // Single product // User profile // Order details
```

**Caching strategy:**

- **staleTime**: 0 (always refetch on intent)
- **cacheTime**: 5 minutes (default)
- **refetchOnWindowFocus**: true (for real-time feel)
- **retry**: 3 attempts with exponential backoff

**Optimistic updates example:**

```typescript
// When publishing a product
mutation.mutate(productData, {
	onMutate: async (newProduct) => {
		// Cancel outgoing refetches
		await queryClient.cancelQueries({ queryKey: productKeys.all })

		// Snapshot previous value
		const previous = queryClient.getQueryData(productKeys.all)

		// Optimistically update
		queryClient.setQueryData(productKeys.all, (old) => [...old, newProduct])

		return { previous }
	},
	onError: (err, newProduct, context) => {
		// Rollback on error
		queryClient.setQueryData(productKeys.all, context.previous)
	},
	onSettled: () => {
		// Refetch to sync with relay
		queryClient.invalidateQueries({ queryKey: productKeys.all })
	},
})
```

---

## Routing

### File-based Routing

TanStack Router uses file structure for route definition:

```
routes/
├── __root.tsx              → /
├── index.tsx               → /
├── setup.tsx               → /setup
└── _dashboard-layout/
    └── dashboard/
        ├── index.tsx       → /dashboard
        ├── account/
        │   └── profile.tsx → /dashboard/account/profile
        └── products/
            └── new.tsx     → /dashboard/products/new
```

### Route Configuration

**Route file example:**

```typescript
// src/routes/products/$productId.tsx
export const Route = createFileRoute('/products/$productId')({
	// Type-safe params
	parseParams: (params) => ({
		productId: params.productId,
	}),

	// Data loading before render
	loader: async ({ params, context }) => {
		const product = await context.queryClient.ensureQueryData(productQueryOptions(params.productId))
		return { product }
	},

	// Component to render
	component: ProductDetailPage,
})
```

### Prefetching Strategy

Routes prefetch data on **intent** (hover):

```typescript
const router = createRouter({
	routeTree,
	defaultPreload: 'intent', // Prefetch on hover
	defaultPreloadStaleTime: 0, // Always fetch fresh
})
```

**Benefits:**

- Instant navigation (data already loaded)
- Fresh data (staleTime: 0)
- Better UX (no loading spinners on navigation)

---

## Component Patterns

### Query Component Pattern

```typescript
export function ProductList() {
  const { data: products, isLoading, error } = useQuery(productsQueryOptions)

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage error={error} />
  if (!products?.length) return <EmptyState />

  return (
    <div className="grid gap-4">
      {products.map(product => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  )
}
```

### Form Pattern (TanStack Form)

```typescript
export function ProductForm() {
  const form = useForm({
    defaultValues: {
      name: '',
      price: 0,
      currency: 'SATS',
    },
    onSubmit: async ({ value }) => {
      await publishProduct(value)
    },
  })

  return (
    <form onSubmit={(e) => {
      e.preventDefault()
      form.handleSubmit()
    }}>
      <form.Field name="name">
        {(field) => <Input {...field} />}
      </form.Field>
      {/* ... more fields */}
    </form>
  )
}
```

### Store Pattern

```typescript
// Define store
export const cartStore = new Store<CartState>({
  items: [],
  total: 0,
})

// Define actions
export const cartActions = {
  addItem: (item: CartItem) => {
    cartStore.setState(state => ({
      items: [...state.items, item],
      total: state.total + item.price,
    }))
  },
}

// Use in component
export function Cart() {
  const items = useStore(cartStore, state => state.items)

  return (
    <div>
      {items.map(item => <CartItem key={item.id} item={item} />)}
    </div>
  )
}
```

### Component Organization

```typescript
// components/ProductCard.tsx
import { type Product } from '@/lib/schemas/product'

type ProductCardProps = {
  product: Product
  variant?: 'default' | 'compact'
  onAddToCart?: (product: Product) => void
}

export function ProductCard({
  product,
  variant = 'default',
  onAddToCart
}: ProductCardProps) {
  // Component logic

  return (
    <div className={cn('product-card', variant)}>
      {/* Component UI */}
    </div>
  )
}
```

---

## Performance Optimization

### Code Splitting

- **Route-based splitting**: Each route is a separate chunk
- **Component lazy loading**: Heavy components loaded on demand
- **Dynamic imports**: Used for modals, sheets, dialogs

### Caching Strategies

1. **NDK Dexie Cache**:
   - IndexedDB storage for Nostr events
   - Persistent across sessions
   - Reduces relay queries

2. **React Query Cache**:
   - In-memory cache with TTL
   - Optimistic updates
   - Background refetching

3. **Service Worker** (future):
   - Offline-first capability
   - Asset caching
   - Background sync

### Bundle Optimization

```typescript
// build.ts
await Bun.build({
	entrypoints: ['./src/index.tsx'],
	outdir: './dist',
	minify: NODE_ENV === 'production',
	sourcemap: NODE_ENV !== 'production' ? 'inline' : 'none',
	splitting: true, // Code splitting
	target: 'browser',
})
```

### Image Optimization

- **Lazy loading**: Images loaded as they enter viewport
- **Blossom/NIP-96**: Decentralized image hosting with CDN benefits
- **Responsive images**: Multiple sizes for different viewports

### Relay Connection Pooling

NDK manages WebSocket connections efficiently:

- Single connection per relay
- Connection reuse across subscriptions
- Automatic reconnection on disconnect
- Batched event requests

---

## Development Workflow

### Hot Module Replacement (HMR)

Bun provides instant HMR:

```typescript
// index.tsx
import.meta.hot.accept()

// frontend.tsx
if (import.meta.hot) {
  const root = (import.meta.hot.data.root ??= createRoot(elem))
  root.render(<App />)
}
```

### Route Generation

Routes are auto-generated during development:

```bash
bun run watch-routes  # Terminal 1
bun run dev           # Terminal 2
```

This watches route files and regenerates `routeTree.gen.ts`.

### Type Safety

- **End-to-end types**: From Nostr events → Zod schemas → TypeScript types → React components
- **Route params**: Type-safe via TanStack Router
- **Form validation**: Zod schemas ensure runtime + compile-time safety

---

## Security Considerations

### Key Management

- Private keys never leave the browser
- Support for browser extensions (NIP-07)
- Support for remote signers (NIP-46)
- Encrypted storage for entered keys

### Data Encryption

- Payment details encrypted with app pubkey
- User data encrypted with recipient pubkey
- NIP-04 → NIP-44 migration planned

### Content Security

- XSS prevention via React's automatic escaping
- User-generated content sanitization
- Image URL validation
- Event signature verification

### Rate Limiting

- Client-side: Debounced queries
- Server-side: Not yet implemented (future enhancement)

---

## Future Architecture Improvements

1. **Service Worker**: Offline-first PWA capabilities
2. **NIP-44 Encryption**: Modern encryption standard
3. **Relay Hints (NIP-65)**: Better event discovery
4. **Outbox Model**: Improved relay strategy
5. **Database Sharding**: Multiple IndexedDB databases for better performance
6. **WebRTC**: Peer-to-peer messaging for buyer-seller communication

---

## References

- [TanStack Router Docs](https://tanstack.com/router)
- [TanStack Query Docs](https://tanstack.com/query)
- [NDK Documentation](https://github.com/nostr-dev-kit/ndk)
- [Nostr NIPs](https://github.com/nostr-protocol/nips)
- [Bun Documentation](https://bun.sh/docs)

---

**Last Updated**: 2025-11-20
**Maintained By**: Plebeian Market Team
