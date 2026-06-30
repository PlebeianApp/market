---
name: plebeian-market
description: This skill should be used when working with the Plebeian Market codebase - a decentralized Nostr-based e-commerce marketplace. Use this skill when implementing new features, fixing bugs, creating UI components, adding routes, or modifying any part of the application to ensure consistency with established patterns for React 19, TanStack Router, TanStack Query/Store, Tailwind CSS v4, and Nostr/NDK integration.
---

# Plebeian Market Development Skill

## Overview

This skill provides comprehensive guidance for developing features in the Plebeian Market application, a decentralized e-commerce marketplace built on the Nostr protocol. It ensures consistency with the established architecture, coding patterns, styling conventions, and Nostr integration approaches used throughout the codebase.

Use this skill when:

- Implementing new marketplace features (products, checkout, orders)
- Creating or modifying UI components
- Adding new routes or pages
- Working with Nostr events and NDK
- Fixing bugs or refactoring existing code
- Styling components with Tailwind CSS
- Managing state with TanStack Store or React Query

## Technology Stack

### Core Technologies

- **Runtime:** Bun (JavaScript runtime and bundler)
- **Frontend:** React 19 with TypeScript
- **Routing:** TanStack Router v1 (file-based routing)
- **State Management:** TanStack Store (client state) + React Query (server/async state)
- **Styling:** Tailwind CSS v4 with shadcn/ui components
- **Nostr Protocol:** NDK (Nostr Dev Kit) v2.15.2
- **Backend:** Bun WebSocket server

Refer to `references/libraries.md` for complete dependency list and versions.

## Core Development Guidelines

### 1. Architecture Understanding

Before implementing features, understand the project structure:

- `/src/routes/` - File-based routing (use `$param` for dynamic segments, `_layout` prefix for layouts)
- `/src/components/` - React components (organized by feature or in `ui/` for base components)
- `/src/lib/stores/` - TanStack Store state management
- `/src/queries/` - React Query hooks and query key factories
- `/src/hooks/` - Custom React hooks for reusable logic

Read `references/architecture.md` for detailed project structure and architectural patterns.

### 2. React Patterns

Follow these established patterns:

- **Functional components only** - No class components
- **Custom hooks for reusable logic** - Extract complex behavior into hooks
- **Query key factory pattern** - Organize React Query keys for cache invalidation
- **Store + action creator pattern** - Separate state from mutations
- **Data transformation utilities** - Use utility functions to extract data from Nostr events

For detailed patterns and code examples, read `references/patterns.md`.

### 3. Routing Implementation

TanStack Router uses file-based routing:

```typescript
// Example: routes/products.$productId.tsx
export const Route = createFileRoute('/products/$productId')({
  component: ProductDetailComponent,
})

function ProductDetailComponent() {
  const { productId } = Route.useParams()
  const productQuery = useSuspenseQuery(productQueryOptions(productId))

  return <div>{/* render product */}</div>
}
```

**Key conventions:**

- Dynamic routes: `products.$productId.tsx`
- Index routes: `products.index.tsx`
- Layout routes: `_dashboard-layout.tsx`
- Always run `bun run generate-routes` after modifying route files

### 4. State Management Strategy

**Use TanStack Store for:**

- Client-side state (auth, cart, UI state)
- State that needs persistence (localStorage/IndexedDB)
- Simple reactive state updates

**Use React Query for:**

- Fetching data from Nostr relays
- Server/async state with caching
- Background synchronization

Example store implementation:

```typescript
// lib/stores/example.ts
export const exampleStore = new Store<ExampleState>({
	data: [],
	isLoading: false,
})

export const exampleActions = {
	updateData: (newData) => {
		exampleStore.setState({ data: newData })
	},
}

// Component usage
const state = useStore(exampleStore)
```

### 5. Styling with Tailwind CSS

Follow utility-first approach with Tailwind CSS v4:

- Use utility classes exclusively (no CSS modules or styled-components)
- Use `cn()` helper for conditional classes
- Leverage shadcn/ui components from `components/ui/`
- Follow established color palette (zinc scale for neutrals)
- Mobile-first responsive design

Example component styling:

```typescript
import { cn } from '@/lib/utils'

<div className={cn(
  "flex flex-col gap-4 p-4",
  "border border-zinc-800 rounded-lg",
  "hover:shadow-lg transition-shadow"
)}>
  {children}
</div>
```

Read `references/styling.md` for comprehensive styling patterns, color schemes, and component examples.

### 6. Nostr Integration

All data flows through NDK (Nostr Dev Kit):

**Fetching data:**

```typescript
export const fetchProducts = async (limit: number = 500) => {
	const ndk = ndkActions.getNDK()

	const events = await ndk.fetchEvents({
		kinds: [30402], // Product listing kind
		limit,
	})

	return Array.from(events).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
}
```

**Publishing events:**

```typescript
export const publishProduct = async (productData) => {
	const ndk = ndkActions.getNDK()

	const event = new NDKEvent(ndk)
	event.kind = 30402
	event.tags = [
		['d', productData.id],
		['title', productData.title],
		['price', productData.price.toString(), 'sats'],
	]

	await event.publish()
	return event
}
```

**Data transformation:**
Use utility functions to extract data from Nostr events:

```typescript
const title = getProductTitle(product)
const price = getProductPrice(product)
const images = getProductImages(product)
```

Read `references/nostr-integration.md` for complete Nostr patterns, event kinds, authentication, and NDK usage.

## Development Workflow

### Adding a New Feature

1. **Plan the implementation:**
   - Identify if the feature needs new routes, components, stores, or queries
   - Review existing similar features for consistency
   - Check if shadcn/ui components can be reused

2. **Implement routes (if needed):**
   - Create route files in `/src/routes/` following naming conventions
   - Use appropriate route types (index, dynamic, layout)
   - Run `bun run generate-routes` to update route tree

3. **Create components:**
   - Use functional components with TypeScript
   - Follow established styling patterns with Tailwind
   - Reuse shadcn/ui components where possible
   - Extract reusable logic into custom hooks

4. **Implement state management:**
   - Use TanStack Store for client state
   - Use React Query for Nostr data fetching
   - Follow query key factory pattern
   - Implement action creators for mutations

5. **Integrate with Nostr:**
   - Use NDK for all Nostr operations
   - Follow established event kinds and patterns
   - Implement proper error handling
   - Use data transformation utilities

6. **Test the implementation:**
   - Test in development mode (`bun run dev`)
   - Verify responsive design on mobile/desktop
   - Check dark mode compatibility
   - Test with Nostr relays

### Modifying Existing Features

1. **Locate relevant files:**
   - Routes in `/src/routes/`
   - Components in `/src/components/`
   - Stores in `/src/lib/stores/`
   - Queries in `/src/queries/`

2. **Understand existing patterns:**
   - Read through related code to understand current implementation
   - Check how similar features are implemented
   - Maintain consistency with existing patterns

3. **Make changes:**
   - Preserve existing patterns and conventions
   - Use established utilities and helpers
   - Update TypeScript types as needed
   - Keep changes focused and minimal

4. **Verify integration:**
   - Ensure changes don't break existing functionality
   - Test with real Nostr relays
   - Verify UI consistency

## Common Tasks

### Creating a New Route

1. Create file in `/src/routes/` (e.g., `newpage.tsx`)
2. Define route with `createFileRoute`
3. Implement component
4. Run `bun run generate-routes`

### Adding a New UI Component

1. Check if shadcn/ui has a suitable base component
2. Create component in appropriate directory
3. Use Tailwind utility classes for styling
4. Follow established naming conventions (PascalCase)
5. Export from component file

### Fetching Data from Nostr

1. Create query function in `/src/queries/`
2. Use query key factory pattern
3. Create query options with `queryOptions()`
4. Use `useSuspenseQuery()` or `useQuery()` in components
5. Handle loading and error states

### Managing Client State

1. Create store in `/src/lib/stores/`
2. Define state interface
3. Create action creators
4. Use `useStore()` hook in components
5. Consider persistence (localStorage/IndexedDB)

## Reference Documentation

For detailed information, read the reference files:

- **`references/architecture.md`** - Project structure, architectural patterns, data flow
- **`references/libraries.md`** - Complete list of libraries, versions, and usage notes
- **`references/patterns.md`** - React patterns, hooks, routing, state management, and Nostr integration patterns
- **`references/styling.md`** - Tailwind CSS usage, component styling, responsive design, theming
- **`references/nostr-integration.md`** - NDK usage, event kinds, data fetching/publishing, authentication

## Best Practices

1. **Consistency first** - Follow established patterns throughout the codebase
2. **Use existing utilities** - Leverage helper functions and custom hooks
3. **Type safety** - Use TypeScript types and Zod schemas for validation
4. **Mobile-first** - Design for mobile, enhance for desktop
5. **Error handling** - Handle Nostr relay failures gracefully
6. **Performance** - Use React Query caching, code splitting via routes
7. **Accessibility** - Use semantic HTML and Radix UI accessible primitives
8. **Dark mode** - Always consider dark mode variants in styling

## Commands

Run these commands during development:

```bash
bun run dev                  # Start development server
bun run generate-routes      # Generate route tree
bun run build                # Build for production
bun run format               # Format code with Prettier
```

## Getting Help

When implementing features:

1. Read relevant reference documentation for detailed patterns
2. Search codebase for similar implementations
3. Check existing components for reusable patterns
4. Refer to library documentation for TanStack Router, React Query, NDK
