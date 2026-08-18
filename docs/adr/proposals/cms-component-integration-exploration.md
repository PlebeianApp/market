# Component Integration Exploration: How Migrated Components Feed Into the CMS

> **Status:** Exploration document (not an ADR). Demonstrates the concrete integration pattern between ADR-0007 (Component/UI Migration) and ADR-0006 (CMS). Shows how a fully-spec'd migrated component becomes a CMS block.

---

## The Three-Layer Pattern

Every CMS-eligible component has three layers:

```
src/components/nostr/ProductCard.tsx      ← Layer 1: Base component (ADR-0007)
src/components/cms/product-card.cms.tsx   ← Layer 2: CMS metadata sidecar (ADR-0006)
widget-book/nostr/ProductCard.spec.ts     ← Layer 3: Test coverage (ADR-0007)
```

**Layer 1** is a standard migrated component. It follows all ADR-0007 rules: ref exposure (React 19 ref-as-prop, or `forwardRef` where a dependency still requires it), `cn()`, callbacks instead of hooks, correct directory, token-based styling. It is completely unaware of the CMS.

**Layer 2** is the CMS sidecar. It declares the data contract, Puck field schema, and render binding. It imports the base component and wraps it for Puck. This is the **only** CMS-specific code.

**Layer 3** is the Widget Book test. It renders the component with mock data and verifies behavior.

---

## Concrete Example: ProductCard → CMS Block

### Layer 1: The Migrated Component (`src/components/nostr/ProductCard.tsx`)

This is what the current `ProductCard.tsx` looks like **after** ADR-0007 migration:

```tsx
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PriceDisplay } from '@/components/shared/PriceDisplay'
import { Link } from '@tanstack/react-router'
import { ShoppingCart, Check } from 'lucide-react'
import type { ProductData } from '@/types/product'

// --- Types ---

export interface ProductCardProps extends React.HTMLAttributes<HTMLDivElement> {
	product: ProductData // Structured data, not raw NDKEvent
	onAddToCart?: (product: ProductData) => void // Callback, not internal hook
	isInCart?: boolean
	isAddingToCart?: boolean
	variant?: 'default' | 'compact'
}

// --- Component ---

export const ProductCard = forwardRef<HTMLDivElement, ProductCardProps>(
	({ product, onAddToCart, isInCart, isAddingToCart, variant = 'default', className, ...rest }, ref) => {
		const { title, images, price, stock, visibility, isNSFW } = product
		const isOutOfStock = visibility !== 'pre-order' && (stock === undefined || stock === 0)

		return (
			<div
				ref={ref}
				className={cn(
					'group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground transition-shadow hover:shadow-lg',
					variant === 'compact' && 'gap-2 p-2',
					variant === 'default' && 'gap-3 p-4',
					className,
				)}
				{...rest}
			>
				{/* Image */}
				<div className="relative aspect-square overflow-hidden rounded-md bg-muted">
					{images[0] && <img src={images[0]} alt={title} className={cn('h-full w-full object-cover', isNSFW && 'blur-sm')} />}
				</div>

				{/* Title */}
				<h3 className="font-body text-lg font-semibold text-foreground line-clamp-1">{title}</h3>

				{/* Price */}
				<PriceDisplay price={price} className="text-lg font-semibold text-primary" />

				{/* Actions */}
				<Button
					onClick={() => onAddToCart?.(product)}
					disabled={isOutOfStock || isAddingToCart}
					variant={isInCart ? 'secondary' : 'default'}
					size={variant === 'compact' ? 'sm' : 'default'}
				>
					{isInCart ? <Check className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
					{isInCart ? 'Added' : isOutOfStock ? 'Out of stock' : 'Add to cart'}
				</Button>
			</div>
		)
	},
)
ProductCard.displayName = 'ProductCard'
```

**Key changes from the current `ProductCard.tsx`:**

| Current (pre-migration)                                       | Migrated (ADR-0007)                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| Imports `NDKEvent` directly                                   | Accepts `ProductData` (structured type)                       |
| Calls `useCart()`, `useAuth()`, `useQueryClient()` internally | Receives `onAddToCart`, `isInCart`, `isAddingToCart` as props |
| Calls `cartActions.addProduct()` directly                     | Calls `onAddToCart?.(product)` callback                       |
| No `forwardRef`                                               | `forwardRef` to root div                                      |
| No `className` merging                                        | `cn()` merges external + internal classes                     |
| No `variant` prop                                             | `variant: 'default' \| 'compact'`                             |
| Hardcoded `font-serif`                                        | Token-based `font-body`                                       |
| Direct `useLocation()` for route logic                        | Removed — route concerns belong in the route                  |

**Why this matters for the CMS:** The component accepts data as props and fires callbacks for actions. The CMS can inject data from Nostr queries and handle actions (or no-op them in preview mode) without the component knowing it's in a CMS context.

---

### Layer 2: The CMS Sidecar (`src/components/cms/product-card.cms.tsx`)

This is the **only** CMS-specific code. It declares:

1. The data contract (what Nostr queries the component needs)
2. The Puck field schema (what props the editor exposes)
3. The render binding (how query results map to component props)

```tsx
import type { Config } from '@puckeditor/core'
import { ProductCard, type ProductCardProps } from '@/components/nostr/ProductCard'
import type { ProductData } from '@/types/product'

// --- 1. Data Contract ---
// Declares what Nostr data this component needs.
// The CMS runtime reads this to configure query editors and validate bindings.

export const ProductCardDataContract = {
	// This component consumes a single kind 30402 event (a product listing)
	kind: 30402,
	// It needs these fields from the event:
	requiredFields: ['title', 'images', 'price', 'stock', 'visibility'],
	// Optional filter tags that can be configured in the editor:
	optionalFilters: ['#t', '#status'],
} as const

// --- 2. Puck Field Schema ---
// Defines what the CMS editor's properties panel shows for this component.
// These map to Puck field types.

export const ProductCardCMSFields = {
	// The product is data-bound (selected from a query), not hand-entered:
	product: {
		type: 'custom',
		label: 'Product',
		render: ({ field, value, onChange }) => <DataSourceField label="Select product" kind={30402} value={value} onChange={onChange} />,
	},
	// Visual configuration:
	variant: {
		type: 'select',
		label: 'Display style',
		options: [
			{ label: 'Full', value: 'default' },
			{ label: 'Compact', value: 'compact' },
		],
	},
	// Cart actions are disabled in CMS preview — the editor is a canvas, not a store:
	// (No field needed — the CMS render wrapper handles this)
} as const

// --- 3. Render Binding ---
// Maps the page definition's block props to the base component's props.
// The CMS runtime calls this with resolved query data.

export function renderProductCardBlock(
	props: {
		product?: ProductData // Resolved from the page definition's queryRef binding
		variant?: 'default' | 'compact'
	},
	// CMS context — available to all CMS render wrappers:
	context: {
		isEditing: boolean // True in the editor, false in published page render
		onAddToCart?: (product: ProductData) => void // Wired up only in live render
	},
): ProductCardProps {
	return {
		product: props.product,
		variant: props.variant ?? 'default',
		// In editing mode, cart actions are no-ops:
		onAddToCart: context.isEditing ? undefined : context.onAddToCart,
		isInCart: false,
		isAddingToCart: false,
	}
}

// --- 4. Puck Component Registration ---
// The entry point Puck calls. This is what goes into the CMS config.

export const ProductCardPuckComponent = {
	fields: ProductCardCMSFields,
	defaultProps: {
		variant: 'default',
	},
	render: (props: any) => {
		// In the editor, props.product may be undefined until the user binds a query.
		// The wrapper handles the "no data yet" state gracefully.
		if (!props.product) {
			return (
				<div className="flex items-center justify-center p-8 border-2 border-dashed border-muted-foreground/20 rounded-lg text-muted-foreground">
					Select a product to display
				</div>
			)
		}
		return <ProductCard {...renderProductCardBlock(props, { isEditing: true })} />
	},
	label: 'Product Card',
} as const
```

**What the sidecar does NOT do:**

- It does not fetch Nostr data directly. The CMS runtime resolves the page definition's `queryRef` to actual events and passes them as `props.product`.
- It does not handle cart state. The `onAddToCart` callback is only wired in live render mode.
- It does not import NDK, Applesauce, or any data layer. It imports the base component and types only.

---

### How the CMS Runtime Wires It Together

The CMS runtime (the page renderer that reads a page-definition event and renders it) works like this:

```
Page Definition Event (Nostr kind <TBD>)
  │
  ├── blocks: [
  │     {
  │       component: "@plebeian/product-card",
  │       queryRef: "featured-product",
  │       props: { variant: "default" }
  │     }
  │   ]
  │
  └── queries: {
        "featured-product": {
          kinds: [30402],
          "#t": ["featured"],
          limit: 1
        }
      }

         │
         ▼

CMS Runtime
  1. Resolves "featured-product" query → fetches via NIP-01 filter → gets NDKEvent[]
  2. Transforms raw event → ProductData (using the same query helpers routes use)
  3. Looks up "@plebeian/product-card" in the component registry
  4. Finds the .cms.tsx sidecar → calls renderProductCardBlock(props, context)
  5. Renders <ProductCard {...resolvedProps} />
```

The key insight: **step 2** (raw event → ProductData) is the same transformation that routes do today via `getProductTitle()`, `getProductImages()`, etc. The CMS doesn't reimplement this — it calls the same query helpers. After the NDK→Applesauce migration (ADR-0002), these helpers change underneath, but the component interface (`ProductData` in, callbacks out) stays the same.

---

### Another Example: ProductGrid (a data-bound collection)

The `ProductGrid` is more interesting because it binds to a **query** (a feed of events), not a single event.

#### Layer 1: Migrated Component (`src/components/nostr/ProductGrid.tsx`)

```tsx
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { ProductCard, type ProductCardProps } from './ProductCard'
import type { ProductData } from '@/types/product'

export interface ProductGridProps extends React.HTMLAttributes<HTMLDivElement> {
	products: ProductData[] // Data comes in as props
	onAddToCart?: (product: ProductData) => void
	columns?: 1 | 2 | 3 | 4 | 5 | 6
	showVendor?: boolean
	emptyMessage?: string
}

export const ProductGrid = forwardRef<HTMLDivElement, ProductGridProps>(
	({ products, onAddToCart, columns = 3, showVendor = true, emptyMessage, className, ...rest }, ref) => {
		if (products.length === 0) {
			return (
				<div ref={ref} className={cn('py-12 text-center text-muted-foreground', className)} {...rest}>
					{emptyMessage ?? 'No products found.'}
				</div>
			)
		}

		return (
			<div
				ref={ref}
				className={cn('grid gap-4 px-6 py-12 max-w-7xl mx-auto', `grid-cols-1 md:grid-cols-2 lg:grid-cols-${columns}`, className)}
				{...rest}
			>
				{products.map((product) => (
					<ProductCard key={product.id} product={product} onAddToCart={onAddToCart} variant={columns >= 4 ? 'compact' : 'default'} />
				))}
			</div>
		)
	},
)
ProductGrid.displayName = 'ProductGrid'
```

#### Layer 2: CMS Sidecar (`src/components/cms/product-grid.cms.tsx`)

```tsx
import type { Config } from '@puckeditor/core'
import { ProductGrid, type ProductGridProps } from '@/components/nostr/ProductGrid'
import { DataSourceField } from '@/components/ui-wrappers/DataSourceField'
import type { ProductData } from '@/types/product'

// --- 1. Data Contract ---

export const ProductGridDataContract = {
	// This component consumes a FEED of kind 30402 events
	kind: 30402,
	feed: true, // Multiple events, not a single one
	requiredFields: ['title', 'images', 'price'],
	optionalFilters: ['#t', '#status', '#p'], // tag, status, author
	defaultLimit: 12,
} as const

// --- 2. Puck Field Schema ---

export const ProductGridCMSFields = {
	title: {
		type: 'text',
		label: 'Section title (optional)',
	},
	dataSource: {
		type: 'custom',
		label: 'Product source',
		render: ({ field, value, onChange }) => (
			<DataSourceField label="Choose products to display" kind={30402} feed value={value} onChange={onChange} />
		),
	},
	columns: {
		type: 'number',
		label: 'Columns (desktop)',
		min: 1,
		max: 6,
	},
	showVendor: {
		type: 'checkbox',
		label: 'Show vendor name',
	},
	emptyMessage: {
		type: 'text',
		label: 'Empty state message',
	},
} as const

// --- 3. Render Binding ---

export function renderProductGridBlock(
	props: {
		title?: string
		products?: ProductData[] // Resolved from queryRef binding → $.events
		columns?: number
		showVendor?: boolean
		emptyMessage?: string
	},
	context: {
		isEditing: boolean
		onAddToCart?: (product: ProductData) => void
	},
): ProductGridProps {
	return {
		products: props.products ?? [],
		columns: (props.columns ?? 3) as 1 | 2 | 3 | 4 | 5 | 6,
		showVendor: props.showVendor ?? true,
		emptyMessage: props.emptyMessage,
		onAddToCart: context.isEditing ? undefined : context.onAddToCart,
	}
}

// --- 4. Puck Component Registration ---

export const ProductGridPuckComponent = {
	fields: ProductGridCMSFields,
	defaultProps: {
		title: '',
		columns: 3,
		showVendor: true,
		emptyMessage: 'No products found matching your criteria.',
	},
	render: (props: any) => {
		if (!props.products || props.products.length === 0) {
			return (
				<div className="py-12 px-6 max-w-7xl mx-auto">
					{props.title && <h2 className="text-2xl font-body text-foreground mb-8">{props.title}</h2>}
					<div className="flex items-center justify-center p-8 border-2 border-dashed border-muted-foreground/20 rounded-lg text-muted-foreground">
						{props.emptyMessage ?? 'Configure a product source to display products.'}
					</div>
				</div>
			)
		}
		return <ProductGrid {...renderProductGridBlock(props, { isEditing: true })} />
	},
	label: 'Product Grid',
} as const
```

---

### A Static Component: Hero Banner (no data binding)

Not all CMS components need data. The Hero Banner is purely static — it has no Nostr query, just user-configured props.

#### Layer 1: Migrated Component (`src/components/layout/Hero.tsx`)

```tsx
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export interface HeroProps extends React.HTMLAttributes<HTMLDivElement> {
	title: string
	subtitle?: string
	backgroundImage?: string
	ctaText?: string
	ctaLink?: string
	alignment?: 'left' | 'center' | 'right'
	height?: string
	overlayOpacity?: number
}

export const Hero = forwardRef<HTMLDivElement, HeroProps>(
	(
		{
			title,
			subtitle,
			backgroundImage,
			ctaText,
			ctaLink,
			alignment = 'center',
			height = '500px',
			overlayOpacity = 0.4,
			className,
			...rest
		},
		ref,
	) => {
		return (
			<div
				ref={ref}
				className={cn('relative w-full overflow-hidden', className)}
				style={{
					backgroundImage: backgroundImage ? `url(${backgroundImage})` : undefined,
					backgroundSize: 'cover',
					backgroundPosition: 'center',
					height,
				}}
				{...rest}
			>
				{backgroundImage && <div className="absolute inset-0 bg-black" style={{ opacity: overlayOpacity }} />}
				<div
					className={cn(
						'absolute inset-0 flex items-center max-w-7xl mx-auto px-6',
						alignment === 'left' && 'justify-start text-left',
						alignment === 'center' && 'justify-center text-center',
						alignment === 'right' && 'justify-end text-right',
					)}
				>
					<div className="flex flex-col gap-4">
						<h1 className="text-4xl md:text-5xl font-header text-foreground">{title}</h1>
						{subtitle && <p className="text-xl text-muted-foreground max-w-2xl">{subtitle}</p>}
						{ctaText && (
							<Button asChild size="lg">
								<a href={ctaLink ?? '#'}>{ctaText}</a>
							</Button>
						)}
					</div>
				</div>
			</div>
		)
	},
)
Hero.displayName = 'Hero'
```

#### Layer 2: CMS Sidecar (`src/components/cms/hero.cms.tsx`)

```tsx
import { Hero, type HeroProps } from '@/components/layout/Hero'

// No data contract — this is a static component
export const HeroDataContract = null

export const HeroCMSFields = {
	title: { type: 'text', label: 'Title' },
	subtitle: { type: 'textarea', label: 'Subtitle (optional)' },
	backgroundImage: { type: 'text', label: 'Background image URL' },
	ctaText: { type: 'text', label: 'CTA button text' },
	ctaLink: { type: 'text', label: 'CTA link URL' },
	alignment: {
		type: 'select',
		label: 'Text alignment',
		options: [
			{ label: 'Left', value: 'left' },
			{ label: 'Center', value: 'center' },
			{ label: 'Right', value: 'right' },
		],
	},
	height: { type: 'text', label: 'Height (e.g., 400px, 50vh)' },
	overlayOpacity: {
		type: 'number',
		label: 'Overlay opacity (0–1)',
		min: 0,
		max: 1,
		step: 0.1,
	},
} as const

export function renderHeroBlock(props: Record<string, any>): HeroProps {
	return {
		title: props.title ?? 'Welcome',
		subtitle: props.subtitle,
		backgroundImage: props.backgroundImage,
		ctaText: props.ctaText,
		ctaLink: props.ctaLink,
		alignment: props.alignment ?? 'center',
		height: props.height ?? '500px',
		overlayOpacity: props.overlayOpacity ?? 0.4,
	}
}

export const HeroPuckComponent = {
	fields: HeroCMSFields,
	defaultProps: {
		title: 'Welcome to Our Store',
		subtitle: 'Discover amazing products from talented creators',
		alignment: 'center',
		ctaText: 'Shop Now',
		ctaLink: '#',
		height: '500px',
		overlayOpacity: 0.4,
	},
	render: (props: any) => <Hero {...renderHeroBlock(props)} />,
	label: 'Hero Banner',
} as const
```

---

## The CMS Config: Wiring It All Together

The Puck config (`src/config/cms.tsx`) registers all CMS sidecars. This is the **only** place that imports sidecars — it's the registry:

```tsx
import type { Config } from '@puckeditor/core'
import { HeroPuckComponent } from '@/components/cms/hero.cms'
import { ProductCardPuckComponent } from '@/components/cms/product-card.cms'
import { ProductGridPuckComponent } from '@/components/cms/product-grid.cms'
import { AuthorBioPuckComponent } from '@/components/cms/author-bio.cms'
import { FeatureBannerPuckComponent } from '@/components/cms/feature-banner.cms'
import { DividerPuckComponent } from '@/components/cms/divider.cms'

export const getCMSConfig = (): Config => ({
	root: {
		fields: {
			theme: {
				type: 'custom',
				label: 'Page theme',
				render: ({ value, onChange }) => <ThemeSelector initialTheme={value || 'default'} onThemeChange={(themeId) => onChange(themeId)} />,
			},
		},
		defaultProps: { theme: 'default' },
		render: ({ children, theme }) => (
			<div ref={themeRoot} data-cms-theme={theme || 'default'}>
				{children}
			</div>
		),
	},
	components: {
		Hero: HeroPuckComponent,
		ProductGrid: ProductGridPuckComponent,
		ProductCard: ProductCardPuckComponent,
		AuthorBio: AuthorBioPuckComponent,
		FeatureBanner: FeatureBannerPuckComponent,
		Divider: DividerPuckComponent,
	},
})
```

---

## Data Flow Summary

```
                          ┌─────────────────────┐
                          │  Page Definition    │
                          │  (Nostr event)      │
                          │  blocks + queries   │
                          └─────────┬───────────┘
                                    │
                          ┌─────────▼───────────┐
                          │  CMS Runtime        │
                          │  (page renderer)    │
                          │                     │
                          │  1. Parse blocks    │
                          │  2. Execute queries │
                          │     (NIP-01 filters)│
                          │  3. Resolve events  │
                          │     → typed data    │
                          │  4. For each block: │
                          │     look up sidecar │
                          │     call render fn  │
                          └─────────┬───────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
          ┌─────────▼──────┐ ┌─────▼──────┐ ┌──────▼───────┐
          │ hero.cms.tsx   │ │product-card│ │product-grid  │
          │                │ │  .cms.tsx  │ │  .cms.tsx    │
          │ No query       │ │ Single event│ │ Feed of events│
          │ Static props   │ │ Data bound  │ │ Data bound   │
          │ renderHero()   │ │ renderPC()  │ │ renderPG()   │
          └─────────┬──────┘ └─────┬──────┘ └──────┬───────┘
                    │               │               │
          ┌─────────▼──────┐ ┌─────▼──────┐ ┌──────▼───────┐
          │ layout/Hero    │ │nostr/      │ │nostr/        │
          │ .tsx           │ │ProductCard │ │ProductGrid   │
          │ (migrated)     │ │.tsx        │ │.tsx          │
          │ ADR-0007       │ │(migrated)  │ │(migrated)    │
          └────────────────┘ └────────────┘ └──────────────┘
```

**The critical boundary:** The arrow from `.cms.tsx` to the base component is a **plain function call with typed props**. No Nostr, no NDK, no Applesauce, no stores, no hooks. The base component renders pure presentational UI from structured data. This is what makes the component reusable by both routes and the CMS, and what makes the NDK→Applesauce migration (ADR-0002) a one-layer change that doesn't touch the CMS.

---

## Migration Path from the Current Puck Branch

The current `feat/plebeian-cms-puck` branch has standalone CMS components (`CMSProductCard`, `CMSProductGrid`, `CMSSimpleHero`, etc.) that re-implement logic from the base components. The migration path is:

| Current (Puck branch)                                                                  | After ADR-0007 migration                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/cms/CMSProductCard.tsx` (re-implements ProductCard logic)              | **Deleted.** Replaced by `nostr/ProductCard.tsx` (migrated) + `cms/product-card.cms.tsx` (sidecar)                                                                                                                 |
| `src/components/cms/CMSProductGrid.tsx` (fetches data internally via `useProductData`) | **Deleted.** Replaced by `nostr/ProductGrid.tsx` (accepts data as props) + `cms/product-grid.cms.tsx` (sidecar)                                                                                                    |
| `src/components/cms/CMSSimpleHero.tsx` (standalone)                                    | **Deleted.** Replaced by `layout/Hero.tsx` (migrated) + `cms/hero.cms.tsx` (sidecar)                                                                                                                               |
| `src/components/editor/DataSourceField.tsx`                                            | **Migrated** to `ui-wrappers/DataSourceField.tsx` (it's a UI component, not CMS-specific)                                                                                                                          |
| `src/components/editor/CheckboxField.tsx`                                              | **Migrated** to `ui-wrappers/CheckboxField.tsx`                                                                                                                                                                    |
| `src/config/cms.tsx` (imports CMS components directly)                                 | **Refactored** to import `.cms.tsx` sidecars only                                                                                                                                                                  |
| `src/lib/utils/theme.ts` (theme override system)                                       | **Kept** (may be simplified) — the `applyLocalTheme` pattern is the correct mechanism: override standard token names on a wrapper element. Already uses `oklch` and same token names as the app. See ADR-0007 §3c. |
| `src/hooks/useProductData.ts` (NDK fetching)                                           | **Replaced** by the CMS runtime's query resolver (which uses the same query helpers as routes)                                                                                                                     |

The valuable work from the Puck branch that **survives** the migration:

- The Puck integration patterns (editor route, preview route, draft storage)
- The theme system concept (per-page token overrides on a wrapper element — the `applyLocalTheme` mechanism is the right approach, components are agnostic to where token values come from)
- The component designs (what props Hero, Product Grid, Feature Banner should have)
- The editor field widgets (re-homed to `ui-wrappers/`)
