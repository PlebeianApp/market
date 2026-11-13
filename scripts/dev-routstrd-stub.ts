/**
 * Stand-in for the routstrd daemon on 127.0.0.1:8008, for local development and e2e tests only. It answers
 * `POST /v1/chat/completions` like an OpenAI-compatible model, using the same canned listings as the mock
 * describer, and never contacts Routstr, a mint, or the image host. Every other path is 404, mirroring the rule
 * that the extension calls nothing else.
 *
 *   bun scripts/dev-routstrd-stub.ts            # normal replies
 *   ROUTSTRD_STUB_MODE=402 bun scripts/...      # simulate an empty wallet
 */
import { mockListingDraft } from '@sdk/extensions/product-image-describer/mockListing'

const PORT = Number(process.env.ROUTSTRD_STUB_PORT ?? 8008)
const MODE = process.env.ROUTSTRD_STUB_MODE ?? 'ok'
const DELAY_MS = Number(process.env.ROUTSTRD_STUB_DELAY_MS ?? 1200)

function imageUrlFrom(body: unknown): string | undefined {
	const messages = (body as { messages?: { content?: unknown }[] })?.messages ?? []
	for (const message of messages) {
		if (!Array.isArray(message.content)) continue
		for (const part of message.content as { type?: string; image_url?: { url?: unknown } }[]) {
			if (part.type === 'image_url' && typeof part.image_url?.url === 'string') return part.image_url.url
		}
	}
	return undefined
}

const server = Bun.serve({
	hostname: '127.0.0.1',
	port: PORT,
	async fetch(request) {
		const url = new URL(request.url)
		if (request.method === 'GET' && url.pathname === '/health') return Response.json({ status: 'ok', stub: true })
		if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') return new Response('Not found', { status: 404 })
		if (MODE === '402') {
			return Response.json({ error: { message: 'Insufficient balance', type: 'insufficient_balance', code: 402 } }, { status: 402 })
		}
		let body: unknown
		try {
			body = await request.json()
		} catch {
			return Response.json({ error: { message: 'Invalid JSON' } }, { status: 400 })
		}
		const imageUrl = imageUrlFrom(body)
		if (!imageUrl) return Response.json({ error: { message: 'No image_url part' } }, { status: 400 })
		await Bun.sleep(DELAY_MS)
		const { model: _mockModel, ...listing } = mockListingDraft({ imageUrl })
		const model = (body as { model?: unknown }).model
		console.log(`[routstrd-stub] ${String(model)} → ${listing.title}`)
		return Response.json({
			id: `chatcmpl-stub-${Date.now()}`,
			object: 'chat.completion',
			model,
			choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(listing) } }],
			usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
		})
	},
})

console.log(`routstrd stub listening on http://${server.hostname}:${server.port} (mode: ${MODE}). Ctrl+C to stop.`)
