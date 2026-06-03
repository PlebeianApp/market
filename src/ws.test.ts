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
				content: 'test event',
				created_at: Math.floor(Date.now() / 1000),
				tags: [],
			},
			generateSecretKey(),
		)

		ws.send(JSON.stringify(['EVENT', event]))

		const response = await waitForMessage()

		expect(response[0]).toBe('OK')
		expect(response[1]).toBe(event.id)
		expect(response[2]).toBe(false)
		expect(response[3]).toContain('Not authorized')
	})

	test('should accept EVENT from admin user', async () => {
		const event = finalizeEvent(
			{
				kind: 1,
				content: 'admin test event',
				created_at: Math.floor(Date.now() / 1000),
				tags: [],
			},
			APP_PRIVATE_KEY!,
		)

		ws.send(JSON.stringify(['EVENT', event]))

		const response = await waitForMessage()

		expect(response[0]).toBe('OK')
		expect(response[1]).toBe(event.id)
		expect(response[2]).toBe(true)
	})

	test('should handle REQ subscription', async () => {
		const event = finalizeEvent(
			{
				kind: 1,
				content: 'subscription test',
				created_at: Math.floor(Date.now() / 1000),
				tags: [],
			},
			APP_PRIVATE_KEY!,
		)

		ws.send(JSON.stringify(['EVENT', event]))
		await waitForMessage()

		ws.send(JSON.stringify(['REQ', 'sub1', { kinds: [1], limit: 10 }]))

		const response = await waitForMessage()

		expect(response[0]).toBe('EVENT')
		expect(response[1]).toBe('sub1')
		expect(response[2].content).toBe('subscription test')
	})

	test('should handle CLOSE subscription', async () => {
		ws.send(JSON.stringify(['REQ', 'sub2', { kinds: [1], limit: 10 }]))
		await waitForMessage()

		ws.send(JSON.stringify(['CLOSE', 'sub2']))

		const response = await waitForMessage()

		expect(response[0]).toBe('CLOSED')
		expect(response[1]).toBe('sub2')
	})

	test('should reject events with invalid signatures', async () => {
		const event = finalizeEvent(
			{
				kind: 1,
				content: 'tampered event',
				created_at: Math.floor(Date.now() / 1000),
				tags: [],
			},
			generateSecretKey(),
		)

		event.content = 'tampered!'

		ws.send(JSON.stringify(['EVENT', event]))

		const response = await waitForMessage()

		expect(response[0]).toBe('OK')
		expect(response[1]).toBe(event.id)
		expect(response[2]).toBe(false)
		expect(response[3]).toContain('invalid')
	})
})
