import { afterEach, describe, expect, test } from 'bun:test'
import { Nip46Mock } from '../../../e2e/utils/nip46-mock'

describe('Nip46Mock', () => {
	const originalConsoleError = console.error

	afterEach(() => {
		console.error = originalConsoleError
	})

	test('does not log teardown errors when an in-flight handler rejects after close', async () => {
		const mock = new Nip46Mock('11'.repeat(32))
		const errors: unknown[][] = []
		console.error = ((...args: unknown[]) => {
			errors.push(args)
		}) as typeof console.error
		;(mock as any).subId = 'sub'
		;(mock as any).eventHandler = async () => {
			await Promise.resolve()
			throw new Error('boom')
		}
		;(mock as any).handleMessage(Buffer.from(JSON.stringify(['EVENT', 'sub', {}])))
		mock.close()
		await Promise.resolve()
		await Promise.resolve()

		expect(errors).toHaveLength(0)
	})
})
