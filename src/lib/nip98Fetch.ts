import NDK, { NDKEvent, type NDKSigner } from '@nostr-dev-kit/ndk'
import { buildNip98AuthEventTemplate, formatNip98AuthorizationHeader, NIP98_HTTP_AUTH_KIND } from './nip98'

/**
 * Browser-side helper: wraps `fetch` with a NIP-98 (`Authorization: Nostr ...`)
 * proof signed by the caller's NDK signer. The path-oracle backend's
 * privileged endpoints (`/api/auctions/path-request`,
 * `/api/auctions/settlement-plan`) require this auth — see AUCTIONS.md
 * §7.5.1 / §7.5.3.
 *
 * `path` is a same-origin path or an absolute URL. Passing a same-origin
 * path is the common case; we resolve it against `window.location.origin`
 * so the `u` tag matches what the server sees in `req.url`.
 */
export const signedFetch = async (
	path: string,
	init: {
		method: 'POST' | 'GET' | 'PUT' | 'DELETE' | 'PATCH'
		body?: string
		headers?: Record<string, string>
		signer: NDKSigner
		ndk: NDK
	},
): Promise<Response> => {
	const absoluteUrl = /^https?:\/\//i.test(path) ? path : new URL(path, globalThis.location?.href || 'http://localhost').toString()

	const template = await buildNip98AuthEventTemplate({
		requestUrl: absoluteUrl,
		method: init.method,
		body: init.body,
	})

	const event = new NDKEvent(init.ndk)
	event.kind = NIP98_HTTP_AUTH_KIND
	event.created_at = template.created_at
	event.tags = template.tags
	event.content = template.content
	await event.sign(init.signer)

	const rawEvent = event.rawEvent()
	const authorizationHeader = formatNip98AuthorizationHeader({
		id: rawEvent.id || event.id,
		pubkey: rawEvent.pubkey,
		created_at: rawEvent.created_at,
		kind: rawEvent.kind,
		tags: rawEvent.tags,
		content: rawEvent.content,
		sig: rawEvent.sig || event.sig || '',
	})

	return fetch(absoluteUrl, {
		method: init.method,
		body: init.body,
		headers: {
			...(init.headers || {}),
			Authorization: authorizationHeader,
		},
	})
}
