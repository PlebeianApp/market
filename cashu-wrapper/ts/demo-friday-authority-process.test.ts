import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'

import { runDemoFridayAuthorityProcess } from './demo-friday-authority-process'
import { DemoFridayTrustedTerminalSqlite } from './demo-friday-authority-runtime'

describe('Friday authority process lifecycle', () => {
	test('refuses a second listener owner before releasing any interrupted lease', async () => {
		let recovered = 0
		const signal = new AbortController().signal
		await expect(runDemoFridayAuthorityProcess({
			publicOrigin: 'https://172.105.64.142', authNetworkId: 'friday-network', chainId: 'friday-chain',
			mintUrl: 'http://127.0.0.1:3438/', nowSeconds: () => 1_000,
			terminalSource: {
				recoverInterruptedExact() { recovered += 1; return 0 }, pendingCount() { return 1 },
				async nextExact() { return null }, async markQueuedExact() {},
			},
			terminalRuntime: { async queueTerminal() { throw new Error('must not run') } },
			health: { async readExact() { return { deploymentId: 'friday-blue', quarantined: false, queuePending: 1, lastCommittedHeight: 42 } } },
			signal,
			listenerFactory() { throw new Error('address already in use') },
		})).rejects.toThrow(/address already in use/)
		expect(recovered).toBe(0)
	})

	test('recovers the durable lease, binds loopback only, drains serially and stops its listener', async () => {
		const database = new Database(':memory:')
		const controller = new AbortController()
		let listenerOptions: { hostname: string; port: number } | undefined
		let stopped = 0, queued = 0
		try {
			const terminalSource = new DemoFridayTrustedTerminalSqlite(database, {
				async resolveExact() { return { branch: 'outbid_return', options: {} } as never },
			})
			terminalSource.enqueueAuthenticatedExact({
				schema: 'PLEBEIAN_FRIDAY_TERMINAL_REFERENCE_V1', reference: 'terminal-1', identityDigest: 'a'.repeat(64),
			})
			await terminalSource.nextExact()
			await runDemoFridayAuthorityProcess({
				publicOrigin: 'https://172.105.64.142', authNetworkId: 'friday-network', chainId: 'friday-chain',
				mintUrl: 'http://127.0.0.1:3438/', nowSeconds: () => 1_000,
				terminalSource,
				terminalRuntime: {
					async queueTerminal() {
						queued += 1; controller.abort()
						return { branch: 'outbid_return', result: { queued: true } } as never
					},
				},
				health: { async readExact() { return { deploymentId: 'friday-blue', quarantined: false, queuePending: 1, lastCommittedHeight: 42 } } },
				signal: controller.signal,
				listenerFactory(value) {
					listenerOptions = value
					return { stop() { stopped += 1 } }
				},
			})
			expect(listenerOptions).toMatchObject({ hostname: '127.0.0.1', port: 8181 })
			expect(typeof (listenerOptions as unknown as { fetch: unknown }).fetch).toBe('function')
			expect({ queued, stopped, pending: terminalSource.pendingCount() }).toEqual({ queued: 1, stopped: 1, pending: 0 })
		} finally { database.close(false) }
	})
})
