/**
 * server.tsx — the instance host.
 *
 * `Bun.serve` composes four things and owns nothing else:
 *
 * 1. It boots the instance (`instance/boot.ts`): config → an injected product edge → the
 *    SDK's read model → a view, plus the kind-30406 shipping read that resolves a chosen
 *    shipping ref.
 * 2. It picks the route and renders **that** route's props to HTML with `react-dom/server`,
 *    so the **HTTP response itself carries the product titles and prices** rather than an
 *    empty shell that only looks right once a browser runs. A listing's page carries its
 *    own title in the document too. The same response carries the instance's **assumption
 *    register** in its footer — every assumption the running instance is operating under,
 *    each with what would falsify it (`instance/assumptions.ts`) — so the register is
 *    readable from the served bytes alone.
 * 3. It **places an order** when the checkout submits one. `POST /checkout` carries this
 *    browser's cart record (the browser is the only place a cart exists), and the instance
 *    hands it to `instance/checkoutView.ts` → `placeBuyerOrdersFromCartIntent`. A placed
 *    order is remembered in the instance's own memory (`instance/placedOrders.ts`) and
 *    answered with a redirect to `/orders/<id>`, which is a **server-rendered** document:
 *    the order's own status is in the served bytes, not applied after hydration. A refusal
 *    is answered with the checkout page carrying the module's own words about the gap.
 * 4. It serves the browser bundle, which hydrates the same markup with the same props
 *    (`window.__DEMO_SHOP__`) — including which route it is, so the client renders the tree
 *    the server rendered and no surface is painted by another route's script.
 *
 * Route matching is **exact-or-parse, never prefix-alone**: `/` is compared exactly, and a
 * product address or an order address is one whose remainder parses to coordinates or to
 * an order id (`instance/routes.ts`). A prefix check would answer every listing's page with
 * the list — the parent-route-swallows-its-child defect — and `/products/` or `/orders/`
 * with no remainder resolves to nothing at all.
 *
 * The bundle is built in memory at boot with `Bun.build`, which resolves `tsconfig.json`'s
 * `@sdk/*`, `@ui/*` and `@/*` paths. No dependency is added to the root `package.json` and
 * nothing is written to disk.
 *
 * Run it:
 *   TMPDIR=/home/admin_maxime/work/.tmp bun run apps/demo-shop/server.tsx
 */

import { join } from 'node:path'
import { renderToString } from 'react-dom/server'

import { parseCartPersistenceContent } from '@sdk/commerce/cart'

import { App, type DemoShopPageProps, type DemoShopShellProps } from './instance/App'
import { buildAssumptionRegister, type AssumptionRegister } from './instance/assumptions'
import { bootInstance, type BootInstanceOptions, type InstanceRuntime } from './instance/boot'
import { cartFromPersistedContent } from './instance/cartState'
import {
	CART_FIELD_NAME,
	SHIPPING_CHOICE_FIELD_PREFIX,
	isChosenShippingRef,
	placeCheckout,
	type CheckoutSubmission,
} from './instance/checkoutView'
import { buildOrderView } from './instance/orderView'
import { forgetPlacedOrders, instancePlacedOrders, type PlacedOrderStore } from './instance/placedOrders'
import { findProductDetail } from './instance/productDetailView'
import {
	CART_PATH,
	CHECKOUT_PATH,
	ORDERS_INDEX_PATH,
	apiCoordinatesFromProductPath,
	coordinatesFromProductPath,
	isPagePath,
	orderIdFromOrderPath,
	orderPath,
} from './instance/routes'

const HERE = import.meta.dir

const DEFAULT_PORT = 3400

/** Bundle the browser entry. Throws with the build's own log rather than serving a blank page. */
async function bundleClient(): Promise<string> {
	const result = await Bun.build({ entrypoints: [join(HERE, 'client.tsx')], target: 'browser' })
	if (!result.success || !result.outputs[0]) {
		const reasons = result.logs.map((log) => String(log.message)).join('\n')
		throw new Error(`demo-shop: the browser bundle failed to build\n${reasons}`)
	}
	return await result.outputs[0].text()
}

/** Serialise props for the browser. `<` is escaped so a value can never close the script tag. */
function serialiseProps(props: DemoShopPageProps): string {
	return JSON.stringify(props).replace(/</g, '\\u003c')
}

/** The document's own title, so the served bytes name the listing or the order they carry. */
function pageTitle(props: DemoShopPageProps): string {
	switch (props.route) {
		case 'product':
			return `${props.detail.item.title} · ${props.instanceName}`
		case 'product-missing':
			return `No listing · ${props.instanceName}`
		case 'cart':
			return `Cart · ${props.instanceName}`
		case 'checkout':
			return `Checkout · ${props.instanceName}`
		case 'order':
			return `Order ${props.order.orderId} · ${props.instanceName}`
		case 'order-missing':
			return `No order · ${props.instanceName}`
		case 'orders':
			return `Orders · ${props.instanceName}`
		default:
			return props.instanceName
	}
}

function pageHtml(body: string, props: DemoShopPageProps): string {
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>${pageTitle(props)}</title>
		<link rel="stylesheet" href="/styles.css" />
	</head>
	<body>
		<div id="root">${body}</div>
		<script>window.__DEMO_SHOP__=${serialiseProps(props)}</script>
		<script type="module" src="/client.js"></script>
	</body>
</html>
`
}

/**
 * The assumptions the running instance is operating under.
 *
 * Built from the runtime's own facts — the edge it took, the relays it was configured with,
 * the currency it falls back to — so the register cannot claim an edge this run did not
 * take. `instance/assumptions.ts` composes it from the registers the SDK modules export and
 * from the app's own.
 */
function assumptionRegister(runtime: InstanceRuntime): AssumptionRegister {
	return buildAssumptionRegister({
		sourceKind: runtime.sourceKind,
		relayUrls: runtime.config.relayUrls,
		displayCurrency: runtime.config.displayCurrency,
	})
}

function shell(runtime: InstanceRuntime): DemoShopShellProps {
	return {
		instanceName: runtime.config.displayName,
		instanceId: runtime.config.instanceId,
		sourceKind: runtime.sourceKind,
		view: runtime.view,
		assumptions: assumptionRegister(runtime),
		shipping: runtime.shipping,
	}
}

/** Render a page the props describe. One place, so every route answers the same shape. */
function renderPage(props: DemoShopPageProps, status = 200): Response {
	return new Response(pageHtml(renderToString(<App {...props} />), props), {
		status,
		headers: { 'content-type': 'text/html; charset=utf-8' },
	})
}

/** The props for a page request, and the status its resolution earns. */
function pageProps(
	runtime: InstanceRuntime,
	store: PlacedOrderStore,
	pathname: string,
): { props: DemoShopPageProps; status: number } {
	const coordinates = coordinatesFromProductPath(pathname)

	if (coordinates !== null) {
		const lookup = findProductDetail(runtime.events, coordinates)
		if (lookup.found) return { props: { ...shell(runtime), route: 'product', detail: lookup.detail }, status: 200 }
		return {
			props: { ...shell(runtime), route: 'product-missing', missing: { coordinates, reason: lookup.reason } },
			status: 404,
		}
	}

	// An order's page is the **instance's** record, so it is server-rendered: the id and
	// the status the SDK derived are in the served bytes. An address this instance holds
	// nothing under is its own page, not an empty one.
	const orderId = orderIdFromOrderPath(pathname)
	if (orderId !== null) {
		const placed = store.find(orderId)
		if (placed === null) return { props: { ...shell(runtime), route: 'order-missing', orderId }, status: 404 }
		const order = buildOrderView(placed, {
			items: runtime.view.items,
			servicesByShippingRef: runtime.shipping.servicesByShippingRef,
		})
		return { props: { ...shell(runtime), route: 'order', order }, status: 200 }
	}

	// The order index is the list of every order this instance holds.
	if (pathname === ORDERS_INDEX_PATH) {
		const orders = store
			.ids()
			.map((id) => {
				const placed = store.find(id)
				if (placed === null) return null
				return buildOrderView(placed, {
					items: runtime.view.items,
					servicesByShippingRef: runtime.shipping.servicesByShippingRef,
				})
			})
			.filter((order): order is NonNullable<typeof order> => order !== null)
		return { props: { ...shell(runtime), route: 'orders', orders }, status: 200 }
	}

	// The cart and the checkout entry carry no server-side state at all: the cart is the
	// browser's, so both routes render the skeleton and the browser fills it.
	if (pathname === CART_PATH) return { props: { ...shell(runtime), route: 'cart' }, status: 200 }
	if (pathname === CHECKOUT_PATH) return { props: { ...shell(runtime), route: 'checkout' }, status: 200 }

	return { props: { ...shell(runtime), route: 'products' }, status: 200 }
}

/**
 * **Place the order the checkout submitted.**
 *
 * The body carries two things: this browser's cart record (`parseCartPersistenceContent`,
 * the SDK's own parser — a record it refuses is not repaired and not guessed at) and one
 * shipping choice per seller. The choice is accepted only when the seller actually
 * publishes that ref: a ref this instance's shipping read did not resolve for that seller is
 * **not applied**, so the module then refuses with its own unresolved-delivery vocabulary
 * and the page names the gap. Nothing is defaulted in either direction.
 *
 * On a placement the orders go into the instance's memory and the browser is redirected to
 * the first one's page (this catalog has one seller, so one order). On a refusal the
 * checkout page is re-rendered **with the module's own words about the gap** — a
 * server-rendered refusal, not a client-side banner.
 */
async function handlePlacement(
	request: Request,
	runtime: InstanceRuntime,
	store: PlacedOrderStore,
): Promise<Response> {
	const form = await request.formData()
	const postedCart = form.get(CART_FIELD_NAME)
	const intent = typeof postedCart === 'string' ? parseCartPersistenceContent(postedCart) : null

	if (intent === null) {
		return renderPage({ ...shell(runtime), route: 'checkout', submission: { kind: 'unreadable-cart' } })
	}

	const cart = cartFromPersistedContent(intent)

	const shippingBySeller: Record<string, string> = {}
	for (const [field, value] of form) {
		if (!field.startsWith(SHIPPING_CHOICE_FIELD_PREFIX) || typeof value !== 'string') continue
		const seller = field.slice(SHIPPING_CHOICE_FIELD_PREFIX.length)
		if (!isChosenShippingRef(value)) continue
		const published = runtime.shipping.optionsBySeller[seller] ?? []
		if (!published.some((option) => option.ref === value)) continue
		shippingBySeller[seller] = value
	}

	const attempt = placeCheckout(cart, {
		items: runtime.view.items,
		shippingBySeller,
		servicesByShippingRef: runtime.shipping.servicesByShippingRef,
		createdAtMs: Date.now(),
	})

	if (attempt.outcome.status === 'placed') {
		store.remember(attempt.outcome.orders)
		const first = attempt.outcome.orders[0]
		if (first) return Response.redirect(new URL(orderPath(first.orderId), request.url).toString(), 303)
	}

	const submission: CheckoutSubmission = { kind: 'placement', outcome: attempt.outcome, terms: attempt.terms }
	return renderPage({ ...shell(runtime), route: 'checkout', submission })
}

/** The JSON twin of a page, so a probe can read the same read the page rendered. */
function listingJson(runtime: InstanceRuntime, coordinates: string): Response {
	const lookup = findProductDetail(runtime.events, coordinates)
	if (!lookup.found) {
		return Response.json(
			{ instanceId: runtime.config.instanceId, coordinates, found: false, reason: lookup.reason },
			{ status: 404 },
		)
	}

	return Response.json({
		instanceId: runtime.config.instanceId,
		coordinates,
		found: true,
		item: lookup.detail.item,
		description: lookup.detail.description,
		imageUrl: lookup.detail.imageUrl,
		specs: lookup.detail.specs,
		shipping: lookup.detail.shipping,
	})
}

export interface StartedDemoShop {
	server: Bun.Server<undefined>
	runtime: InstanceRuntime
	/** The orders this instance has placed, for a probe or a test to read. */
	placedOrders: PlacedOrderStore
}

/**
 * What the host may be told about the socket, as well as about the instance itself.
 *
 * These exist so a caller — a test, in practice — can bind an **ephemeral port on loopback**
 * (`port: 0`) for one run without writing `process.env` first: mutating the environment to
 * configure one server would leak into every other server and every other module in the
 * process. The environment is still the operator's way in
 * (`DEMO_SHOP_PORT` / `DEMO_SHOP_HOST`); this is the caller's.
 */
export interface StartDemoShopOptions extends BootInstanceOptions {
	/** The port to bind. `0` binds an ephemeral one. Defaults to `DEMO_SHOP_PORT`, then 3400. */
	readonly port?: number
	/** The address to bind. Defaults to `DEMO_SHOP_HOST`, then `127.0.0.1` — loopback, never a wildcard. */
	readonly hostname?: string
}

export async function startDemoShop(options: StartDemoShopOptions = {}): Promise<StartedDemoShop> {
	forgetPlacedOrders()
	const runtime = await bootInstance(options)
	const clientJs = await bundleClient()
	const stylesheet = Bun.file(join(HERE, 'styles.css'))
	const placedOrders = instancePlacedOrders()

	const server = Bun.serve({
		port: options.port ?? Number(process.env.DEMO_SHOP_PORT ?? DEFAULT_PORT),
		hostname: options.hostname ?? process.env.DEMO_SHOP_HOST ?? '127.0.0.1',

		async fetch(request) {
			const url = new URL(request.url)

			// The placement. A cart exists only in a browser, so the browser submits it; the
			// instance does the placement and answers with where the order now lives.
			if (request.method === 'POST' && url.pathname === CHECKOUT_PATH) {
				return handlePlacement(request, runtime, placedOrders)
			}

			// Every other address is a **read**. A POST to one is not "not found" — the
			// address exists and the *method* does not — and answering it with the page
			// would be the instance pretending it placed something it did not.
			if (request.method !== 'GET' && request.method !== 'HEAD') {
				return new Response(
					`this instance reads (\`GET\`) everything here; the one address that also places an order is a \`POST\` to ${CHECKOUT_PATH}\n`,
					{
						status: 405,
						headers: {
							allow: url.pathname === CHECKOUT_PATH ? 'GET, HEAD, POST' : 'GET, HEAD',
							'content-type': 'text/plain; charset=utf-8',
						},
					},
				)
			}

			// The page routes. `/` is exact; a product address and an order address are ones
			// that parse.
			if (isPagePath(url.pathname)) {
				const { props, status } = pageProps(runtime, placedOrders, url.pathname)
				return renderPage(props, status)
			}

			const apiCoordinates = apiCoordinatesFromProductPath(url.pathname)
			if (apiCoordinates !== null) return listingJson(runtime, apiCoordinates)

			switch (url.pathname) {
				case '/api/products':
					return Response.json({
						instanceId: runtime.config.instanceId,
						sourceKind: runtime.sourceKind,
						summaryLine: runtime.view.summaryLine,
						hiddenCount: runtime.view.hiddenCount,
						items: runtime.view.items,
					})

				/** Public per-instance configuration, in the shape ADR-0021 describes. No secrets. */
				case '/api/config':
					return Response.json({
						instanceId: runtime.config.instanceId,
						displayName: runtime.config.displayName,
						displayCurrency: runtime.config.displayCurrency,
						relayUrls: runtime.config.relayUrls,
					})

				/**
				 * The JSON twin of the register the page's footer renders, so a probe can read the
				 * same register the page carries without parsing HTML.
				 */
				case '/api/assumptions':
					return Response.json(assumptionRegister(runtime))

				/** The shipping edge as a value: what a chosen ref resolves to, and what did not resolve. */
				case '/api/shipping':
					return Response.json(runtime.shipping)

				/** Every order id this instance holds. The orders themselves are at their own pages. */
				case '/api/orders':
					return Response.json({ instanceId: runtime.config.instanceId, orderIds: placedOrders.ids() })

				case '/health':
					return Response.json({ ok: true, sourceKind: runtime.sourceKind, loadedAtMs: runtime.loadedAtMs })

				case '/client.js':
					return new Response(clientJs, { headers: { 'content-type': 'text/javascript; charset=utf-8' } })

				case '/styles.css':
					return new Response(stylesheet, { headers: { 'content-type': 'text/css; charset=utf-8' } })

				default:
					return new Response('not found', { status: 404 })
			}
		},
	})

	return { server, runtime, placedOrders }
}

if (import.meta.main) {
	const { server, runtime } = await startDemoShop()
	console.log(`demo-shop: ${runtime.config.displayName} listening on ${server.url}`)
	console.log(`demo-shop: edge = ${runtime.sourceKind} · ${runtime.view.summaryLine}`)
	console.log(`demo-shop: ${runtime.shipping.summaryLine}`)
}
