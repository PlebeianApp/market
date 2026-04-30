import { serve, type Server } from 'bun'
import { auctionRoutes } from './http/auctions'
import { configRoutes } from './http/config'
import { nip05Routes } from './http/nip05'
import { staticRoutes } from './http/static'
import { zapPurchaseRoutes } from './http/zapPurchase'
import { PORT } from './runtime'
import { websocketHandler } from './websocket'
import type { BunRoutes } from './http/types'

/**
 * Compose the Bun HTTP/WebSocket server. Routes are merged from each
 * domain's plain `BunRoutes` record. The SPA index.html fallback
 * (`'/*'`) is provided by the entrypoint that owns the build artefact —
 * we accept it as an argument so this module stays free of asset imports.
 */
export interface BuildServerOptions {
	/**
	 * SPA shell — typically `import index from './index.html'` from the
	 * entrypoint. Bun's `HTMLBundle` is a valid `RouteValue` for the
	 * catch-all `'/*'`, but its type lives in `bun.d.ts` and isn't useful
	 * to import here, so we accept anything Bun's route record will take.
	 */
	indexHtml: unknown
}

export function buildServer({ indexHtml }: BuildServerOptions): Server<undefined> {
	const routes: BunRoutes = {
		...configRoutes,
		...zapPurchaseRoutes,
		...auctionRoutes,
		...nip05Routes,
		...staticRoutes,
		// Catch-all for the SPA — must be registered last so explicit
		// routes above take precedence.
		'/*': indexHtml as BunRoutes[string],
	}

	console.log(`App port: ${PORT}`)

	// Bun's `serve` route record carries per-path generic typing
	// (`Routes<WebSocketData, R>` parameterised by literal path strings).
	// Our merged record erases those literals — perfectly fine at runtime
	// but unhelpful to typecheck — so we cast at the call site.
	//
	// We also pin `WebSocketData = undefined` explicitly so `server.upgrade`
	// has the no-options arity it had before the refactor.
	return serve<undefined, never>({
		port: PORT,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		routes: routes as any,
		development: process.env.NODE_ENV !== 'production',
		fetch(req, server) {
			if (server.upgrade(req)) {
				return new Response()
			}
			return new Response('Upgrade failed', { status: 500 })
		},
		// @ts-ignore — Bun WebSocket handler typing is currently loose.
		websocket: websocketHandler,
	})
}
