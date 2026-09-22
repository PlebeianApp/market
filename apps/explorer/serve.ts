/**
 * Dev server for the explorer.
 *
 * Run from the repository root so Bun picks up the root `tsconfig.json` (which is where the
 * `@plebeian/*` aliases live):
 *
 *   bun run apps/explorer/serve.ts
 *
 * Bun bundles the TSX and resolves the aliases; the app imports nothing from `src/`.
 */
import index from './index.html'

const port = Number(process.env.EXPLORER_PORT ?? 3333)

const server = Bun.serve({
	port,
	development: true,
	routes: {
		'/': index,
		'/health': new Response(
			JSON.stringify({ ok: true, packages: ['product-event', 'product-query', 'browse-filter', 'nostr-access', 'browse-ui'] }),
			{
				headers: { 'content-type': 'application/json' },
			},
		),
	},
})

console.log(`explorer listening on http://localhost:${server.port}`)
