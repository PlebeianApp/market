import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { connectToFirstRelay } from '@/lib/nostr/connect'

function createConnection(connect: () => Promise<void> = () => new Promise(() => {})) {
	const pool = Object.assign(new EventEmitter(), {
		connectedRelays: (): unknown[] => [],
	})
	return { pool, connect }
}

describe('connectToFirstRelay', () => {
	test('returns on the first relay without waiting for other connections', async () => {
		const connection = createConnection()
		const pending = connectToFirstRelay(connection, 10_000)
		connection.pool.connectedRelays = () => ['local-relay']
		connection.pool.emit('relay:connect')
		expect(await pending).toBe(true)
		expect(connection.pool.listenerCount('relay:connect')).toBe(0)
	}, 1000)

	test('returns immediately when already connected without restarting connections', async () => {
		let calls = 0
		const connection = createConnection(async () => {
			calls++
		})
		connection.pool.connectedRelays = () => ['local-relay']
		expect(await connectToFirstRelay(connection, 10_000)).toBe(true)
		expect(calls).toBe(0)
	})

	test('reports no connection after timeout and removes its listener', async () => {
		const connection = createConnection()
		expect(await connectToFirstRelay(connection, 5)).toBe(false)
		expect(connection.pool.listenerCount('relay:connect')).toBe(0)
	})

	test('does not treat an empty pool completing connect as connected', async () => {
		const connection = createConnection(async () => {})
		expect(await connectToFirstRelay(connection, 10_000)).toBe(false)
		expect(connection.pool.listenerCount('relay:connect')).toBe(0)
	})

	test('propagates connection errors and removes its listener', async () => {
		const connection = createConnection(async () => {
			throw new Error('connection failed')
		})
		await expect(connectToFirstRelay(connection, 10_000)).rejects.toThrow('connection failed')
		expect(connection.pool.listenerCount('relay:connect')).toBe(0)
	})
})
