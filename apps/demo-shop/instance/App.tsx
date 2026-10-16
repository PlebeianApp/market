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
 *
 * THE FOOTER CARRIES THE ASSUMPTION REGISTER. Every assumption the running
 * instance is operating under — the app's own, plus the two registers the SDK
 * modules export as values — is rendered inside the footer region by
 * `AssumptionRegisterPanel`, each entry naming what would falsify it. It is part
 * of this component tree, so it is in the **served HTML**, not a comment and not
 * something hydration adds.
 */

import * as React from 'react'

import type { AssumptionEntry, AssumptionRegister } from './assumptions'
import { CartView } from './CartView'
import { CheckoutEntry } from './CheckoutEntry'
import type { CheckoutSubmission } from './checkoutView'
import { OrderDetail, OrderMissing } from './OrderDetail'
import { OrderList } from './OrderList'
import type { OrderView } from './orderView'
import { ProductDetail, ProductMissing } from './ProductDetail'
import { ProductList } from './ProductList'
import type { ProductDetailView, ProductMissingView } from './productDetailView'
import type { ProductListView } from './productListView'
import { CART_PATH, CHECKOUT_PATH, PRODUCTS_PATH } from './routes'
import type { ShippingReadView } from './shippingSource'
import { useCart, type CartControl } from './useCart'

/** The shell every route shares. */
export interface DemoShopShellProps {
	readonly instanceName: string
	readonly instanceId: string
	readonly sourceKind: 'fixture' | 'relay'
	/** The listing read, which every surface resolves against. */
	readonly view: ProductListView
	/**
	 * The assumptions the running instance is operating under, composed once by the
	 * server (`instance/assumptions.ts`) and carried in the props the browser
	 * hydrates from.
	 *
	 * It travels as data rather than being imported by this component on purpose:
	 * the register is a property of *the running instance* — which edge it took,
	 * which relays it was configured with, which currency it falls back to — and
	 * those facts exist on the server. Importing the SDK registers into the browser
	 * bundle would give the client a register it cannot know is the one the server
	 * rendered.
	 */
	readonly assumptions: AssumptionRegister
	/**
	 * The shipping edge: the kind-30406 records this run read, joined to the refs the
	 * listings publish (`instance/shippingSource.ts`).
	 *
	 * It travels in the props like `view` does, because it is a read the **server**
	 * performed and the browser cannot repeat: the checkout resolves its delivery
	 * requirements against this map, and a browser that guessed at it would be resolving a
	 * chosen shipping ref against the ref's own text.
	 */
	readonly shipping: ShippingReadView
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
	| (DemoShopShellProps & { readonly route: 'cart' })
	| (DemoShopShellProps & {
			readonly route: 'checkout'
			/**
			 * The placement the instance just answered, when it refused one. Server-rendered,
			 * so a refusal's own words are in the served bytes rather than only on screen
			 * after hydration.
			 */
			readonly submission?: CheckoutSubmission | null
	  })
	| (DemoShopShellProps & { readonly route: 'order'; readonly order: OrderView })
	| (DemoShopShellProps & { readonly route: 'order-missing'; readonly orderId: string })
	| (DemoShopShellProps & { readonly route: 'orders'; readonly orders: readonly OrderView[] })

/** The nav's sections. One entry per section, and the nav is drawn from the list. */
type NavSection = 'products' | 'cart' | 'checkout'

/**
 * The nav's items, declared once.
 *
 * Adding a page is adding an entry here, never writing markup — which is what keeps
 * the bar, the routes and `aria-current` from drifting apart. Every `href` below is
 * a path some branch of `server.tsx` answers; a link to a route that does not exist
 * is the defect this list is shaped to avoid.
 */
const NAV_ITEMS: readonly { readonly section: NavSection; readonly href: string; readonly label: string }[] = [
	{ section: 'products', href: PRODUCTS_PATH, label: 'Products' },
	{ section: 'cart', href: CART_PATH, label: 'Cart' },
	{ section: 'checkout', href: CHECKOUT_PATH, label: 'Checkout' },
]

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
					{NAV_ITEMS.map((item) => (
						<a
							key={item.section}
							className="ds-nav-link"
							href={item.href}
							aria-current={current === item.section ? 'page' : undefined}
						>
							{item.label}
						</a>
					))}
				</nav>
				<div className="ds-nav-right">
					<CartStatus cart={cart} />
				</div>
			</header>
		</div>
	)
}

/**
 * The footer's assumption register, rendered.
 *
 * This is the maintainer's requirement made visible: every assumption the running
 * instance is operating under, each with what would falsify it, **in the document
 * the server sends** — the panel is part of `App`, so it is in the HTTP response
 * itself and a bare `curl` shows it. It is not a comment, and it does not wait for
 * hydration.
 *
 * The panel deliberately does **not** claim a new `region-*` name. The region
 * landmarks are the seven the page already declares, and `theme.test.ts` pins that
 * set; the register is content *inside* the footer region, titled by its own
 * heading, which is what a reader addresses it by.
 */
function AssumptionRegisterPanel({ register }: { register: AssumptionRegister }) {
	return (
		<section className="ds-assumptions" aria-labelledby="ds-assumptions-heading" data-testid="assumption-register">
			<h2 className="ds-assumptions-heading" id="ds-assumptions-heading">
				Assumptions this instance is running under
			</h2>
			<p className="ds-assumptions-summary" data-testid="assumption-summary">
				{register.summaryLine}
			</p>
			<ol className="ds-assumption-list">
				{register.entries.map((entry: AssumptionEntry) => (
					<li
						className="ds-assumption"
						key={entry.id}
						data-testid="assumption-entry"
						data-assumption-id={entry.id}
						data-assumption-source={entry.source}
					>
						<p className="ds-assumption-statement" data-testid="assumption-statement">
							{entry.statement}
						</p>
						<p className="ds-assumption-falsifier" data-testid="assumption-falsifier">
							<span className="ds-assumption-label">falsified by</span>
							<span className="ds-assumption-value">{entry.falsifiedBy}</span>
						</p>
						<p className="ds-assumption-origin">
							<span className="ds-assumption-label">assumed by</span>
							<code className="ds-assumption-value">{entry.source}</code>
						</p>
					</li>
				))}
			</ol>
		</section>
	)
}

export function App(props: DemoShopPageProps) {
	const { instanceName, instanceId, sourceKind, view, assumptions, shipping } = props
	const cart = useCart()

	const edgeVerb = sourceKind === 'fixture' ? 'injected fixture source (no network)' : 'relay read via sdk/core/nostr-io'
	const edgeLine = `edge: ${edgeVerb} · instance ${instanceId}`

	// The section the nav marks. A listing's page and its missing state are part of
	// the products section, so they mark Products current rather than nothing; an order's
	// page and its missing state belong to the checkout arc, because that is where an
	// order is placed from.
	const current: NavSection =
		props.route === 'cart'
			? 'cart'
			: props.route === 'checkout' || props.route === 'order' || props.route === 'order-missing' || props.route === 'orders'
				? 'checkout'
				: 'products'

	// Each route brings its own surface; the shell around it is shared, so two
	// routes cannot grow two navs.
	const body =
		props.route === 'product' ? (
			<ProductDetail detail={props.detail} cart={cart} />
		) : props.route === 'product-missing' ? (
			<ProductMissing missing={props.missing} />
		) : props.route === 'cart' ? (
			<CartView cart={cart} view={view} />
		) : props.route === 'checkout' ? (
			<CheckoutEntry cart={cart} view={view} shipping={shipping} submission={props.submission} />
		) : props.route === 'order' ? (
			<OrderDetail order={props.order} />
		) : props.route === 'order-missing' ? (
			<OrderMissing orderId={props.orderId} />
		) : props.route === 'orders' ? (
			<OrderList orders={props.orders} />
		) : (
			<ProductList view={view} />
		)

	return (
		<div className="ds-page">
			<NavRegion instanceName={instanceName} cart={cart} current={current} />

			<main className="ds-shell ds-main">
				<div className="ds-region region region-instance" aria-label="This instance, and which edge its data came from">
					<p className="ds-eyebrow" data-testid="edge-line">
						{edgeLine}
					</p>
				</div>

				{body}
			</main>

			<footer className="ds-shell ds-region region region-foot ds-foot" aria-label="What this page composes, and the assumptions it runs under">
				<p>
					app: <span data-testid="composition-path">apps/demo-shop</span> · composes{' '}
					<span>@sdk/commerce/&#123;products,discovery,cart&#125;</span> and <span>@ui</span>
				</p>
				<AssumptionRegisterPanel register={assumptions} />
			</footer>
		</div>
	)
}
