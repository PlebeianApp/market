/**
 * server.tsx — the instance host.
 *
 * `Bun.serve` composes three things and owns nothing else:
 *
 * 1. It boots the instance (`instance/boot.ts`): config → an injected product
 *    edge → the SDK's read model → a view.
 * 2. It renders that view to HTML with `react-dom/server`, so the **HTTP
 *    response itself carries the product titles and prices** rather than an
 *    empty shell that only looks right once a browser runs.
 * 3. It serves the browser bundle, which hydrates the same markup with the same
 *    props (`window.__DEMO_SHOP__`), so step 1's read happens once, on the
 *    server, and steps 2–5 have somewhere to attach.
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

import { App, type DemoShopPageProps } from './instance/App'
import { bootInstance, type BootInstanceOptions, type InstanceRuntime } from './instance/boot'

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

function pageHtml(body: string, props: DemoShopPageProps): string {
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>${props.instanceName}</title>
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

export interface StartedDemoShop {
	server: Bun.Server<undefined>
	runtime: InstanceRuntime
}

export async function startDemoShop(options: BootInstanceOptions = {}): Promise<StartedDemoShop> {
	const runtime = await bootInstance(options)
	const clientJs = await bundleClient()
	const stylesheet = Bun.file(join(HERE, 'styles.css'))

	const props: DemoShopPageProps = {
		instanceName: runtime.config.displayName,
		instanceId: runtime.config.instanceId,
		sourceKind: runtime.sourceKind,
		view: runtime.view,
	}

	const server = Bun.serve({
		port: Number(process.env.DEMO_SHOP_PORT ?? DEFAULT_PORT),
		hostname: process.env.DEMO_SHOP_HOST ?? '127.0.0.1',
		fetch(request) {
			const url = new URL(request.url)

			switch (url.pathname) {
				case '/':
					return new Response(pageHtml(renderToString(<App {...props} />), props), {
						headers: { 'content-type': 'text/html; charset=utf-8' },
					})

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