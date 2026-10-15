/**
 * instance/App.tsx — the page shell.
 *
 * The shell is the instance's own composition and states three things the
 * screenshot must be able to prove on its own: which instance this is, which
 * edge the data came from, and what the list contains. If the rows were empty
 * the page would say "0 listings" rather than looking like a list that merely
 * failed to load.
 *
 * LAYOUT CONVENTION (this revision): the shell is a set of **named regions**,
 * each carrying an `aria-label` — `region-nav`, `region-instance`,
 * `region-products`, and (in the next increments) `region-product`,
 * `region-cart` and `region-checkout`. A region is the landmark a reader or a
 * test addresses, so a surface's place in the page is a declared name rather
 * than a class name.
 *
 * THE CART CONTROL IS THE SKELETON'S ONE HONEST HOME. Every other region on this
 * page is server-rendered from data the server holds. The cart is the browser's
 * — `sdk/commerce/cart` ships the persistence contract and the host supplies the
 * storage — so the served bytes carry a **skeleton** (`data-skeleton="1"`,
 * `.sk`) where the count goes, and the browser fills it after hydration. Nothing
 * here guesses at the number.
 */

import * as React from 'react'

import { ProductList } from './ProductList'
import type { ProductListView } from './productListView'
import { useCartCount, type CartCount } from './useCart'

export interface DemoShopPageProps {
	readonly instanceName: string
	readonly instanceId: string
	readonly sourceKind: 'fixture' | 'relay'
	readonly view: ProductListView
}

/**
 * The cart's three named states, rendered. A skeleton while the browser is being
 * asked, the count once it has answered, and its own words when it cannot be
 * asked at all.
 */
function CartStatus({ status }: { status: CartCount }) {
	if (status.state === 'reading') {
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

	if (status.state === 'unavailable') {
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

	const label = status.count === 1 ? '1 item in this browser' : `${status.count} items in this browser`
	return (
		<span className="ds-cart-status" data-testid="cart-status" data-cart-state="read" aria-label={`Cart: ${label}`}>
			<span>Cart</span>
			<span className="ds-cart-count" data-testid="cart-count">
				{status.count}
			</span>
		</span>
	)
}

function NavRegion({ instanceName, cart }: { instanceName: string; cart: CartCount }) {
	return (
		<div className="ds-region region region-nav" aria-label="The nav bar">
			<header className="ds-nav">
				<span className="ds-brand" data-testid="instance-name">
					{instanceName}
				</span>
				<nav className="ds-nav-links" aria-label="The pages this app serves">
					<a className="ds-nav-link" href="/" aria-current="page">
						Products
					</a>
				</nav>
				<div className="ds-nav-right">
					<CartStatus status={cart} />
				</div>
			</header>
		</div>
	)
}

export function App({ instanceName, instanceId, sourceKind, view }: DemoShopPageProps) {
	const cart = useCartCount()

	const edgeVerb = sourceKind === 'fixture' ? 'injected fixture source (no network)' : 'relay read via sdk/core/nostr-io'
	const edgeLine = `edge: ${edgeVerb} · instance ${instanceId}`

	return (
		<div className="ds-page">
			<NavRegion instanceName={instanceName} cart={cart} />

			<main className="ds-shell ds-main">
				<div className="ds-region region region-instance" aria-label="This instance, and which edge its data came from">
					<p className="ds-eyebrow" data-testid="edge-line">
						{edgeLine}
					</p>
				</div>

				<ProductList view={view} />
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
