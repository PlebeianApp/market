import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { devUser1 } from './lib/fixtures'

const skipWsTests = !process.env.APP_RELAY_URL || !process.env.APP_PRIVATE_KEY

describe.skipIf(skipWsTests)('WebSocket Server', () => {
	const WS_URL = 'ws://localhost:3000'
	const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY

	let ws: any
	let getEventHandler: typeof import('./server').getEventHandler
	let serverPromise: Promise<any>

	const waitForMessage = () => {
		return new Promise<any>((resolve) => {
			ws.once('message', (data: any) => {
				resolve(JSON.parse(data.toString()))
			})
		})
	}

	beforeEach(async () => {
		const serverMod = await import('./index.tsx')
		const eventMod = await import('./server')
		getEventHandler = eventMod.getEventHandler
		serverPromise = serverMod.serverPromise
		const server = await serverPromise
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

		const testEvent: [string, any] = ['EVENT', event]

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

		const testEvent: [string, any] = ['EVENT', event]

		ws.send(JSON.stringify(testEvent))
		const okResponse = await waitForMessage()

		expect(okResponse[0]).toBe('OK')
		expect(okResponse[2]).toBe(true)
		expect(okResponse[2]).toBeEmpty()
	})
})
