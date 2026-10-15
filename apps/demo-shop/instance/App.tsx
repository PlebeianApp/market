/**
 * instance/App.tsx — the page shell and the route it renders.
 *
 * The shell is the instance's own composition and states three things the
 * screenshot must be able to prove on its own: which instance this is, which
 * edge the data came from, and what the surface contains. If a list were empty
 * the page would say "0 listings" rather than looking like a surface that merely
 * failed to load.
 *
 * LAYOUT CONVENTION (the house-style revision): the shell is a set of **named
 * regions**, each carrying an `aria-label` — `region-nav`, `region-instance`,
 * `region-products`, `region-product`, `region-foot`. A region is the landmark a
 * reader or a test addresses, so a surface's place in the page is a declared name
 * rather than a class name.
 *
 * ROUTES ARE SERVER-RENDERED DOCUMENTS. `props.route` is chosen by the server and
 * travels with the props the browser hydrates from, so the client renders the same
 * tree the server did and no surface is ever painted by another route's script.
 * Navigation is a full page load: there is no client router to disagree with the
 * server about what is on screen.
 *
 * THE CART CONTROL IS THE SKELETON'S ONE HONEST HOME. Every other region on this
 * page is server-rendered from data the server holds. The cart is the browser's
 * — `sdk/commerce/cart` ships the persistence contract and the host supplies the
 * storage — so the served bytes carry a **skeleton** (`data-skeleton="1"`,
 * `.sk`) where the count goes, and the browser fills it after hydration. Nothing
 * here guesses at the number.
 */

import * as React from 'react'

import { ProductDetail, ProductMissing } from './ProductDetail'
import { ProductList } from './ProductList'
import type { ProductDetailView, ProductMissingView } from './productDetailView'
import type { ProductListView } from './productListView'
import { useCart, type CartControl } from './useCart'

/** The shell every route shares. */
export interface DemoShopShellProps {
	readonly instanceName: string
	readonly instanceId: string
	readonly sourceKind: 'fixture' | 'relay'
	/** The listing read, which every surface resolves against. */
	readonly view: ProductListView
}

/**
 * One member per route the app serves. The server picks the member and the
 * browser hydrates that same one, because it travels in the props.
 *
 * `product-missing` is a route of its own rather than a flag on `product`:
 * a product address that resolves to no listing is a surface with its own words,
 * not an empty product page.
 */
export type DemoShopPageProps =
	| (DemoShopShellProps & { readonly route: 'products' })
	| (DemoShopShellProps & { readonly route: 'product'; readonly detail: ProductDetailView })
	| (DemoShopShellProps & { readonly route: 'product-missing'; readonly missing: ProductMissingView })

/** The nav's sections. Every route this app serves today is in the one section. */
type NavSection = 'products'

/**
 * The cart's three named states, rendered. A skeleton while the browser is being
 * asked, the count once it has answered, and its own words when it cannot be
 * asked at all.
 */
function CartStatus({ cart }: { cart: CartControl }) {
	if (cart.status === 'reading') {
		return (
			<span
				className="ds-cart-status"
				data-testid="cart-status"
				data-cart-state="reading"
				aria-label="Cart: reading this browser's cart"
			>
				<span>Cart</span>
				<span className="sk ds-cart-count-sk" data-skeleton="1" aria-hidden="true" />
			</span>
		)
	}

	if (cart.status === 'unavailable') {
		return (
			<span
				className="ds-cart-status"
				data-testid="cart-status"
				data-cart-state="unavailable"
				aria-label="Cart: this browser has no reachable cart storage"
			>
				<span>Cart</span>
				<span className="ds-cart-count" data-testid="cart-count">
					n/a
				</span>
			</span>
		)
	}

	const count = cart.count ?? 0
	const label = count === 1 ? '1 item in this browser' : `${count} items in this browser`
	return (
		<span className="ds-cart-status" data-testid="cart-status" data-cart-state="read" aria-label={`Cart: ${label}`}>
			<span>Cart</span>
			<span className="ds-cart-count" data-testid="cart-count">
				{count}
			</span>
		</span>
	)
}

function NavRegion({
	instanceName,
	cart,
	current,
}: {
	instanceName: string
	cart: CartControl
	current: NavSection
}) {
	return (
		<div className="ds-region region region-nav" aria-label="The nav bar">
			<header className="ds-nav">
				<span className="ds-brand" data-testid="instance-name">
					{instanceName}
				</span>
				<nav className="ds-nav-links" aria-label="The pages this app serves">
					<a className="ds-nav-link" href="/" aria-current={current === 'products' ? 'page' : undefined}>
						Products
					</a>
				</nav>
				<div className="ds-nav-right">
					<CartStatus cart={cart} />
				</div>
			</header>
		</div>
	)
}

export function App(props: DemoShopPageProps) {
	const { instanceName, instanceId, sourceKind, view } = props
	const cart = useCart()

	const edgeVerb = sourceKind === 'fixture' ? 'injected fixture source (no network)' : 'relay read via sdk/core/nostr-io'
	const edgeLine = `edge: ${edgeVerb} · instance ${instanceId}`

	// Each route brings its own surface; the shell around it is shared, so two
	// routes cannot grow two navs.
	const body =
		props.route === 'product' ? (
			<ProductDetail detail={props.detail} cart={cart} />
		) : props.route === 'product-missing' ? (
			<ProductMissing missing={props.missing} />
		) : (
			<ProductList view={view} />
		)

	return (
		<div className="ds-page">
			<NavRegion instanceName={instanceName} cart={cart} current="products" />

			<main className="ds-shell ds-main">
				<div className="ds-region region region-instance" aria-label="This instance, and which edge its data came from">
					<p className="ds-eyebrow" data-testid="edge-line">
						{edgeLine}
					</p>
				</div>

				{body}
			</main>

			<footer className="ds-shell ds-region region region-foot ds-foot" aria-label="What this page composes">
				<p>
					app: <span data-testid="composition-path">apps/demo-shop</span> · composes{' '}
					<span>@sdk/commerce/&#123;products,discovery,cart&#125;</span> and <span>@ui</span>
				</p>
			</footer>
		</div>
	)
}
