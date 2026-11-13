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

	test('SIGTERM-equivalent abort closes the listener immediately before a held drain unwinds', async () => {
		const controller = new AbortController()
		let release!: () => void, stoppedWith: boolean | undefined
		const held = new Promise<void>((resolve) => { release = resolve })
		const running = runDemoFridayAuthorityProcess({
			publicOrigin: 'https://172.105.64.142', authNetworkId: 'friday-network', chainId: 'friday-chain',
			mintUrl: 'http://127.0.0.1:3438/', nowSeconds: () => 1_000,
			terminalSource: { recoverInterruptedExact() { return 0 }, pendingCount() { return 0 },
				async nextExact() { return null }, async markQueuedExact() {} },
			terminalRuntime: { async queueTerminal() { throw new Error('must not run') } },
			health: { async readExact() { await held; return { deploymentId: 'friday-blue', quarantined: false,
				queuePending: 0, lastCommittedHeight: 42 } } },
			signal: controller.signal,
			listenerFactory() { return { stop(closeActive) { stoppedWith = closeActive } } },
		})
		await Promise.resolve()
		controller.abort()
		await Promise.resolve()
		expect(stoppedWith).toBe(true)
		release()
		await running
		expect(stoppedWith).toBe(true)
	})

	test('keeps recovery HTTP alive but fails new operations closed after a terminal drain fault', async () => {
		const controller = new AbortController()
		let fetchExact: ((request: Request) => Promise<Response>) | undefined
		let stopped = 0, recovered = 0
		let faultReached!: () => void
		const fault = new Promise<void>((resolve) => { faultReached = resolve })
		const running = runDemoFridayAuthorityProcess({
			publicOrigin: 'https://172.105.64.142', authNetworkId: 'friday-network', chainId: 'friday-chain',
			mintUrl: 'http://127.0.0.1:3438/', nowSeconds: () => 1_000,
			terminalSource: {
				recoverInterruptedExact() { recovered += 1; return 0 }, pendingCount() { return 1 },
				async nextExact() { faultReached(); throw new Error('synthetic terminal fault') },
				async markQueuedExact() {},
			},
			terminalRuntime: { async queueTerminal() { throw new Error('must not run') } },
			health: { async readExact() { return { deploymentId: 'friday-blue', quarantined: false,
				queuePending: 1, lastCommittedHeight: 42, consensusAvailable: true } } },
			readiness: { async readExact() { return { ready: true, reason: 'healthy', height: 42 } } },
			signal: controller.signal,
			listenerFactory(value) {
				fetchExact = value.fetch
				return { stop() { stopped += 1 } }
			},
		})
		await fault
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(recovered).toBe(1)
		expect(fetchExact).toBeDefined()
		const status = await fetchExact!(new Request('http://127.0.0.1:8181/api/friday/status'))
		expect(status.status).toBe(503)
		expect(await status.json()).toMatchObject({
			quarantined: true, newOperationsReady: false, readinessReason: 'terminal_drain_quarantined',
		})
		const funding = await fetchExact!(new Request('http://127.0.0.1:8181/api/friday/funding', {
			method: 'POST', headers: { origin: 'https://172.105.64.142', 'content-type': 'application/json' },
			body: '{}',
		}))
		expect(funding.status).toBe(503)
		expect(await funding.json()).toEqual({ error: 'new_operations_unready' })
		controller.abort()
		await running
		expect(stopped).toBe(1)
	})
})
