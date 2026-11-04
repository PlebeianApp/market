import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { describeCatalogEntry, fetchExtensionCatalog, type ExtensionActionFetch } from '@sdk/core/extensions'
import { productImageDescriber } from '@sdk/extensions/product-image-describer'
import { createExtensionCatalogHandler } from './actionRoute'
import { HttpAuthReplayCache } from './nip98'

const ORIGIN = 'https://market.example'
const NOW_MS = 1_700_000_000_000
const adminKey = generateSecretKey()
const visitorKey = generateSecretKey()
const signerFor = (key: Uint8Array) => ({ sign: async (template: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(template, key) })

function setup() {
	const handler = createExtensionCatalogHandler({
		getCatalog: () => ({
			entries: [describeCatalogEntry(productImageDescriber, { state: 'available', envPrefix: 'EXTENSION_PRODUCT_IMAGE_DESCRIBER_' })],
		}),
		isAdmin: (pubkey) => pubkey === getPublicKey(adminKey),
		replayCache: new HttpAuthReplayCache(),
		acceptedOrigins: () => [ORIGIN],
		nowMs: () => NOW_MS,
	})
	const fetch: ExtensionActionFetch = async (url, init) => {
		const response = await handler(new Request(url, { method: init.method, headers: init.headers }))
		return { status: response.status, text: () => response.text() }
	}
	return { handler, fetch }
}

describe('extension store catalog route', () => {
	test('admins get the catalog through the SDK client with a signed GET', async () => {
		const { fetch } = setup()
		const result = await fetchExtensionCatalog(signerFor(adminKey), { baseUrl: ORIGIN, fetch, now: () => NOW_MS })
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value).toHaveLength(1)
		expect(result.value[0]).toMatchObject({
			id: 'product-image-describer',
			icon: '/images/extension-product-image-describer.svg',
			state: 'available',
			hostPorts: [],
			envPrefix: 'EXTENSION_PRODUCT_IMAGE_DESCRIBER_',
		})
	})

	test('non-admins get 404 and unauthenticated callers get 401', async () => {
		const { fetch, handler } = setup()
		expect(await fetchExtensionCatalog(signerFor(visitorKey), { baseUrl: ORIGIN, fetch, now: () => NOW_MS })).toMatchObject({
			ok: false,
			error: { reason: 'not_found' },
		})
		expect((await handler(new Request(`${ORIGIN}/api/extensions/catalog`))).status).toBe(401)
	})
})
