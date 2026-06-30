# React Patterns and Conventions

## Component Patterns

### 1. Functional Components Only

Use functional components with hooks exclusively (no class components):

```typescript
// Good
export function ProductCard({ product }: { product: NDKEvent }) {
  const [isLoading, setIsLoading] = useState(false)

  return <div>...</div>
}

// Avoid class components
```

### 2. Custom Hooks for Reusable Logic

Extract complex logic into custom hooks:

```typescript
// hooks/useScrollRestoration.ts
export function useScrollRestoration({ key, ttl = 30 * 60 * 1000 }) {
	const location = useLocation()

	useEffect(() => {
		// Save scroll position to sessionStorage
		const handleScroll = () => {
			sessionStorage.setItem(key, window.scrollY.toString())
		}
		window.addEventListener('scroll', handleScroll)
		return () => window.removeEventListener('scroll', handleScroll)
	}, [key])
}
```

### 3. Query Key Factory Pattern

Use factory functions for React Query keys to enable cache invalidation:

```typescript
// queries/queryKeyFactory.ts
export const productKeys = {
	all: ['products'] as const,
	details: (id: string) => [...productKeys.all, id] as const,
	byPubkey: (pubkey: string) => [...productKeys.all, 'byPubkey', pubkey] as const,
}

// Usage in queries
export const productQueryOptions = (id: string) =>
	queryOptions({
		queryKey: productKeys.details(id),
		queryFn: () => fetchProduct(id),
		staleTime: 5 * 60 * 1000,
	})
```

### 4. Store + Action Creator Pattern

Separate state from mutations using action creators:

```typescript
// lib/stores/cart.ts
export const cartStore = new Store<CartState>({
	products: [],
	totalInSats: 0,
})

export const cartActions = {
	addProduct: async (userPubkey: string, product: NDKEvent) => {
		cartStore.setState((state) => ({
			...state,
			products: [...state.products, product],
		}))
	},

	clear: () => {
		cartStore.setState({ products: [], totalInSats: 0 })
	},
}

// Usage in components
const cart = useStore(cartStore)
await cartActions.addProduct(userPubkey, product)
```

## Data Fetching Patterns

### 1. React Query with Suspense

Use `useSuspenseQuery` for streaming UI with React 19:

```typescript
function ProductsRoute() {
  const { tag } = Route.useSearch()
  const productsQuery = useSuspenseQuery(productsQueryOptions(500, tag))

  return <div>{productsQuery.data.map(...)}</div>
}
```

### 2. Query Options Factory

Create reusable query option functions:

```typescript
// queries/products.tsx
export const productsQueryOptions = (limit: number = 500, tag?: string) =>
	queryOptions({
		queryKey: productKeys.list(limit, tag),
		queryFn: () => fetchProducts(limit, tag),
		staleTime: 5 * 60 * 1000, // 5 minutes
	})
```

### 3. Background Sync Hooks

Use custom hooks for background data synchronization:

```typescript
// hooks/useOrdersBackgroundSync.ts
export function useOrdersBackgroundSync() {
	useEffect(() => {
		const interval = setInterval(async () => {
			await queryClient.invalidateQueries({ queryKey: orderKeys.all })
		}, 30000) // Every 30 seconds

		return () => clearInterval(interval)
	}, [])
}
```

## Routing Patterns

### 1. File-Based Routes

Create routes as files in `/src/routes/`:

```typescript
// routes/products.$productId.tsx
export const Route = createFileRoute('/products/$productId')({
  component: ProductDetailComponent,
})

function ProductDetailComponent() {
  const { productId } = Route.useParams()
  return <div>Product {productId}</div>
}
```

### 2. Layout Routes

Use underscore prefix for layout routes:

```typescript
// routes/_dashboard-layout.tsx
export const Route = createFileRoute('/_dashboard-layout')({
  component: DashboardLayout,
})

function DashboardLayout() {
  return (
    <div className="dashboard-container">
      <Sidebar />
      <Outlet /> {/* Child routes render here */}
    </div>
  )
}
```

### 3. Search Parameter Validation

Validate search params with Zod:

```typescript
const productsSearchSchema = z.object({
	tag: z.string().optional(),
	limit: z.number().default(500),
})

export const Route = createFileRoute('/products/')({
	validateSearch: productsSearchSchema,
})
```

### 4. Navigation

Use router hooks for navigation:

```typescript
const navigate = useNavigate()

// Navigate programmatically
await navigate({
	to: '/products/$productId',
	params: { productId: '123' },
})
```

## State Management Patterns

### 1. Local UI State

Use `useState` for component-local UI state:

```typescript
const [isOpen, setIsOpen] = useState(false)
const [selectedTab, setSelectedTab] = useState('details')
```

### 2. Global Client State

Use TanStack Store for global client state:

```typescript
// lib/stores/auth.ts
export const authStore = new Store<AuthState>({
	user: null,
	isAuthenticated: false,
})

// Components
const authState = useStore(authStore)
```

### 3. Server State

Use React Query for server/async state:

```typescript
const { data, isLoading, error } = useQuery({
	queryKey: productKeys.details(id),
	queryFn: () => fetchProduct(id),
})
```

### 4. Persistence

Persist critical state to storage:

```typescript
// localStorage for auth/cart
localStorage.setItem('cart', JSON.stringify(cartState))

// IndexedDB for orders
await persistOrdersToIndexedDB(orders)
```

## Nostr Integration Patterns

### 1. Fetching Nostr Events

```typescript
export const fetchProducts = async (limit: number = 500, tag?: string) => {
	const ndk = ndkActions.getNDK()
	const filter: NDKFilter = {
		kinds: [30402], // Product listing kind
		limit,
	}

	if (tag) {
		filter['#t'] = [tag]
	}

	const events = await ndk.fetchEvents(filter)
	return Array.from(events).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
}
```

### 2. Publishing Nostr Events

```typescript
export const publishProduct = async (productData: ProductData) => {
	const ndk = ndkActions.getNDK()

	const event = new NDKEvent(ndk)
	event.kind = 30402
	event.tags = [
		['d', productData.id],
		['title', productData.title],
		['price', productData.price.toString()],
		['t', ...productData.tags],
	]

	await event.publish()
	return event
}
```

### 3. Data Transformation Utilities

Use utility functions to extract data from Nostr events:

```typescript
// lib/utils/nostr.ts
export const getProductTitle = (product: NDKEvent): string => product.tags.find((t) => t[0] === 'title')?.[1] || ''

export const getProductPrice = (product: NDKEvent): number => parseInt(product.tags.find((t) => t[0] === 'price')?.[1] || '0')

export const getProductImages = (product: NDKEvent): string[] => product.tags.filter((t) => t[0] === 'image').map((t) => t[1])
```

## Form Patterns

### 1. TanStack Form with Zod

```typescript
import { useForm } from '@tanstack/react-form'
import { zodValidator } from '@hookform/resolvers/zod'

const formSchema = z.object({
  title: z.string().min(1),
  price: z.number().positive(),
})

function ProductForm() {
  const form = useForm({
    defaultValues: {
      title: '',
      price: 0,
    },
    onSubmit: async ({ value }) => {
      await createProduct(value)
    },
    validators: {
      onChange: zodValidator(formSchema),
    },
  })

  return (
    <form onSubmit={form.handleSubmit}>
      {/* form fields */}
    </form>
  )
}
```

## Error Handling

### 1. Query Error Handling

```typescript
const { data, error, isError } = useQuery(productQueryOptions(id))

if (isError) {
  return <ErrorDisplay error={error} />
}
```

### 2. Nostr Error Suppression

Some NDK initialization errors are expected and suppressed:

```typescript
// frontend.tsx
// Suppress specific NDK temporal dead zone errors
if (error.message.includes('temporal dead zone')) {
	return // Expected during initialization
}
```

## Performance Patterns

### 1. Route Preloading

```typescript
// Router configured with intent-based preloading
const router = createRouter({
	defaultPreload: 'intent', // Preload on hover/focus
})
```

### 2. Query Caching

```typescript
// Configure stale time for caching
queryOptions({
	staleTime: 5 * 60 * 1000, // 5 minutes
	gcTime: 30 * 60 * 1000, // 30 minutes garbage collection
})
```

### 3. Code Splitting

TanStack Router automatically code-splits routes for optimal loading.

## Naming Conventions

- **Components:** PascalCase (e.g., `ProductCard`)
- **Hooks:** camelCase with `use` prefix (e.g., `useScrollRestoration`)
- **Stores:** camelCase with `Store` suffix (e.g., `cartStore`)
- **Actions:** camelCase with `Actions` suffix (e.g., `cartActions`)
- **Query keys:** camelCase with `Keys` suffix (e.g., `productKeys`)
- **Files:** Match component name (e.g., `ProductCard.tsx`)
- **Route files:** Lowercase with dots (e.g., `products.$productId.tsx`)
