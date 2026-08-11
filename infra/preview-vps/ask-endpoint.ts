/**
 * On-demand TLS permission endpoint for Caddy.
 *
 * Caddy calls GET /ask?domain=<hostname> before issuing a certificate.
 * We approve only *.nsite.orangesync.tech subdomains.
 *
 * Run: deno run --allow-net ask-endpoint.ts
 */

const ALLOWED_SUFFIXES = ['.nsite.orangesync.tech', '.test-market.orangesync.tech']
const PORT = 6799

function handler(req: Request): Response {
	const url = new URL(req.url)

	if (url.pathname !== '/ask') {
		return new Response('Not Found', { status: 404 })
	}

	const domain = url.searchParams.get('domain')
	if (!domain) {
		return new Response('Missing domain parameter', { status: 400 })
	}

	if (ALLOWED_SUFFIXES.some((suffix) => domain.endsWith(suffix))) {
		console.log(`[approve] ${domain}`)
		return new Response('OK', { status: 200 })
	}

	console.log(`[deny]  ${domain}`)
	return new Response('Forbidden', { status: 403 })
}

console.log(`ask-endpoint listening on :${PORT}`)
Deno.serve({ port: PORT }, handler)
