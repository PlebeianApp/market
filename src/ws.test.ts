import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { devUser1 } from './lib/fixtures'
import { getEventHandler } from './server'

// This is an integration test that requires a running dev server on port 3000
// AND APP_PRIVATE_KEY to be set. The import of './index.tsx' triggers
// initializeAppSettings() at module load time, which crashes without a valid key.
// Skip the entire suite when running bare `bun test` outside the integration env.
const RUN_WS_TESTS = process.env.CI && process.env.APP_PRIVATE_KEY && process.env.APP_PRIVATE_KEY !== '<your_private_key_in_hex>'
const describeOrSkip = RUN_WS_TESTS ? describe : describe.skip

// Lazy-load server module — only when we're actually running the tests
let server: any = null
let NostrMessage: any = null
if (RUN_WS_TESTS) {
	try {
		const mod = require('./index.tsx')
		server = mod.server
		NostrMessage = mod.NostrMessage
	} catch (e) {
		// Module load failed (e.g. dev server not running) — tests will skip
	}
}

describeOrSkip('WebSocket Server', () => {
	const WS_URL = 'ws://localhost:3000'
	const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY

	let ws: any

	const waitForMessage = () => {
		return new Promise<any>((resolve) => {
			ws.once('message', (data: any) => {
				resolve(JSON.parse(data.toString()))
			})
		})
	}

	beforeEach(async () => {
		ws = new globalThis.WebSocket(WS_URL)
		await new Promise((resolve) => ws.once('open', resolve))
		await new Promise((resolve) => setTimeout(resolve, 1000))
		server.ref
		getEventHandler().addAdmin(devUser1.pk)
	})

	afterEach(() => {
		ws.close()
	})

	test('should receive OK "Not authorized" response for non-admin EVENT message', async () => {
		const event = finalizeEvent(
			{
				kind: 1,
				created_at: Math.floor(Date.now() / 1000),
				tags: [],
				content: 'hello from non-admin',
			},
			generateSecretKey(),
		)

		const testEvent: any = ['EVENT', event]

		const messagePromise = waitForMessage()
		ws.send(JSON.stringify(testEvent))

		const response = await messagePromise
		expect(response).toEqual(['OK', event.id, false, 'Not authorized'])
	})

	test('should receive error response for invalid JSON', async () => {
		const messagePromise = waitForMessage()
		ws.send('invalid json')

		const response = await messagePromise
		expect(response).toEqual(['NOTICE', 'error: Invalid JSON'])
	})

	test('should resign event when sent by admin', async () => {
		if (!APP_PRIVATE_KEY) throw Error('App private key is undefined')
		const adminPrivateBytes = new Uint8Array(Buffer.from(devUser1.sk, 'hex'))

		const event = finalizeEvent(
			{
				kind: 1,
				created_at: Math.floor(Date.now() / 1000),
				tags: [],
				content: 'hello from admin',
			},
			adminPrivateBytes,
		)

		const testEvent: any = ['EVENT', event]

		ws.send(JSON.stringify(testEvent))
		const okResponse = await waitForMessage()

		expect(okResponse[0]).toBe('OK')
		expect(okResponse[2]).toBe(true)
		expect(okResponse[2]).toBeEmpty()
	})
})
