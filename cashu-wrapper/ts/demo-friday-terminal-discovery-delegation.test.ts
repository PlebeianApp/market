import { describe, expect, test } from 'bun:test'

import { DemoFridayDiscoveringTerminalSource } from './demo-friday-terminal-discovery'

describe('discovering terminal source delegation', () => {
	test('preserves the durable typed-expiry operation through the discovery wrapper', async () => {
		const calls: string[] = []
		const source = {
			async nextExact() { calls.push('next'); return null },
			async markQueuedExact() { calls.push('queued') },
			async markExpiredExact(reference: string, code: string) { calls.push(`expired:${reference}:${code}`) },
			recoverInterruptedExact() { calls.push('recover'); return 2 },
			pendingCount() { calls.push('pending'); return 3 },
		}
		const discovery = { async discoverExact() { calls.push('discover'); return 0 } }
		const wrapped = new DemoFridayDiscoveringTerminalSource(source as never, discovery as never)
		expect(await wrapped.nextExact()).toBeNull()
		await wrapped.markExpiredExact('terminal-1', 'DEMO_CLOSE_CUTOFF')
		expect(wrapped.recoverInterruptedExact()).toBe(2)
		expect(wrapped.pendingCount()).toBe(3)
		expect(calls).toEqual([
			'discover', 'next', 'expired:terminal-1:DEMO_CLOSE_CUTOFF', 'recover', 'pending',
		])
	})
})
