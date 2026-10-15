/**
 * server.tsx — the instance host.
 *
 * `Bun.serve` composes three things and owns nothing else:
 *
 * 1. It boots the instance (`instance/boot.ts`): config → an injected product
 *    edge → the SDK's read model → a view.
 * 2. It picks the route and renders **that** route's props to HTML with
 *    `react-dom/server`, so the **HTTP response itself carries the product titles
 *    and prices** rather than an empty shell that only looks right once a browser
 *    runs. A listing's page carries its own title in the document too.
 * 3. It serves the browser bundle, which hydrates the same markup with the same
 *    props (`window.__DEMO_SHOP__`) — including which route it is, so the client
 *    renders the tree the server rendered and no surface is painted by another
 *    route's script.
 *
 * Route matching is **exact-or-parse, never prefix-alone**: `/` is compared
 * exactly, and a product address is one whose remainder parses to coordinates
 * (`instance/routes.ts`). A prefix check would answer every listing's page with
 * the list — the parent-route-swallows-its-child defect — and `/products/` with no
 * coordinates resolves to nothing at all.
 *
 * The bundle is built in memory at boot with `Bun.build`, which resolves
 * `tsconfig.json`'s `@sdk/*`, `@ui/*` and `@/*` paths. No dependency is added to
 * the root `package.json` and nothing is written to disk.
 *
 * Run it:
 *   TMPDIR=/home/admin_maxime/work/.tmp bun run apps/demo-shop/server.tsx
 */

import { join } from 'node:path'
import { renderToString } from 'react-dom/server'

import { App, type DemoShopPageProps, type DemoShopShellProps } from './instance/App'
import { bootInstance, type BootInstanceOptions, type InstanceRuntime } from './instance/boot'
import { findProductDetail } from './instance/productDetailView'
import {
	CART_PATH,
	CHECKOUT_PATH,
	apiCoordinatesFromProductPath,
	coordinatesFromProductPath,
	isPagePath,
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

/** The document's own title, so the served bytes name the listing they carry. */
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

function shell(runtime: InstanceRuntime): DemoShopShellProps {
	return {
		instanceName: runtime.config.displayName,
		instanceId: runtime.config.instanceId,
		sourceKind: runtime.sourceKind,
		view: runtime.view,
	}
}

/** The props for a page request, and the status its resolution earns. */
function pageProps(runtime: InstanceRuntime, pathname: string): { props: DemoShopPageProps; status: number } {
	const coordinates = coordinatesFromProductPath(pathname)

	if (coordinates !== null) {
		const lookup = findProductDetail(runtime.events, coordinates)
		if (lookup.found) return { props: { ...shell(runtime), route: 'product', detail: lookup.detail }, status: 200 }
		return {
			props: { ...shell(runtime), route: 'product-missing', missing: { coordinates, reason: lookup.reason } },
			status: 404,
		}
	}

	// The cart and the checkout entry carry no server-side state at all: the cart is
	// the browser's, so both routes render the skeleton and the browser fills it.
	if (pathname === CART_PATH) return { props: { ...shell(runtime), route: 'cart' }, status: 200 }
	if (pathname === CHECKOUT_PATH) return { props: { ...shell(runtime), route: 'checkout' }, status: 200 }

	return { props: { ...shell(runtime), route: 'products' }, status: 200 }
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
}

export async function startDemoShop(options: BootInstanceOptions = {}): Promise<StartedDemoShop> {
	const runtime = await bootInstance(options)
	const clientJs = await bundleClient()
	const stylesheet = Bun.file(join(HERE, 'styles.css'))

	const server = Bun.serve({
		port: Number(process.env.DEMO_SHOP_PORT ?? DEFAULT_PORT),
		hostname: process.env.DEMO_SHOP_HOST ?? '127.0.0.1',
		fetch(request) {
			const url = new URL(request.url)

			// The page routes. `/` is exact; a product address is one that parses.
			if (isPagePath(url.pathname)) {
				const { props, status } = pageProps(runtime, url.pathname)
				return new Response(pageHtml(renderToString(<App {...props} />), props), {
					status,
					headers: { 'content-type': 'text/html; charset=utf-8' },
				})
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

	return { server, runtime }
}

if (import.meta.main) {
	const { server, runtime } = await startDemoShop()
	console.log(`demo-shop: ${runtime.config.displayName} listening on ${server.url}`)
	console.log(`demo-shop: edge = ${runtime.sourceKind} · ${runtime.view.summaryLine}`)
}
