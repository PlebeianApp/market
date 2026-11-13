/**
 * One process lifecycle for the disabled Friday authority candidate.
 *
 * This joins startup recovery, the loopback HTTP boundary and the serial
 * terminal drain. It still requires a reviewed fixed configuration to build
 * the trusted resolver/Comet/DKG/signer/mint ports; callers cannot supply any
 * of those capabilities through HTTP.
 */
import {
	DEMO_FRIDAY_AUTHORITY_MAX_BODY_BYTES,
	DEMO_FRIDAY_AUTHORITY_LOOPBACK_PORT,
	createDemoFridayFixedAuthorityService,
} from './demo-friday-authority-service'
import {
	type DemoFridayTerminalSourceRuntimePort,
	runDemoFridayAuthorityDrainLoop,
} from './demo-friday-authority-runtime'

type ServiceOptions = Parameters<typeof createDemoFridayFixedAuthorityService>[0]

async function waitForStop(signal: AbortSignal): Promise<void> {
	if (signal.aborted) return
	await new Promise<void>((resolve) => {
		const stopped = (): void => resolve()
		signal.addEventListener('abort', stopped, { once: true })
	})
}

export interface DemoFridayAuthorityListener {
	stop(closeActiveConnections?: boolean): void | Promise<void>
}

export interface DemoFridayAuthorityListenerFactory {
	(options: {
		hostname: '127.0.0.1'
		port: typeof DEMO_FRIDAY_AUTHORITY_LOOPBACK_PORT
		maxRequestBodySize: typeof DEMO_FRIDAY_AUTHORITY_MAX_BODY_BYTES
		fetch: (request: Request) => Promise<Response>
	}): DemoFridayAuthorityListener
}

export async function runDemoFridayAuthorityProcess(options: ServiceOptions & {
	terminalSource: DemoFridayTerminalSourceRuntimePort
	signal: AbortSignal
	listenerFactory?: DemoFridayAuthorityListenerFactory
}): Promise<void> {
	if (options.signal.aborted) throw new Error('DEMO_FRIDAY_AUTHORITY_PROCESS: stopped before startup')
	const { terminalSource, signal, listenerFactory, ...serviceOptions } = options
	let drainQuarantined = false
	const baseHealth = serviceOptions.health
	const baseReadiness = serviceOptions.readiness
	const service = createDemoFridayFixedAuthorityService({
		...serviceOptions,
		terminalSource,
		health: {
			async readExact() {
				const status = await baseHealth.readExact()
				return drainQuarantined ? { ...status, quarantined: true } : status
			},
		},
		...(baseReadiness === undefined ? {} : {
			readiness: {
				async readExact() {
					const status = await baseReadiness.readExact()
					return drainQuarantined
						? { ...status, ready: false, reason: 'terminal_drain_quarantined' }
						: status
				},
			},
		}),
	})
	const factory = listenerFactory ?? ((value) => Bun.serve(value))
	const listener = factory({
		hostname: '127.0.0.1', port: DEMO_FRIDAY_AUTHORITY_LOOPBACK_PORT,
		maxRequestBodySize: DEMO_FRIDAY_AUTHORITY_MAX_BODY_BYTES,
		fetch: (request) => service.handle(request),
	})
	let stopping: Promise<void> | undefined
	const stopListener = (): void => {
		stopping ??= Promise.resolve(listener.stop(true))
	}
	signal.addEventListener('abort', stopListener, { once: true })
	if (signal.aborted) stopListener()
	try {
		// The fixed loopback listener is the cross-process singleton lease. It must
		// be owned before any restart-only recovery releases durable work.
		terminalSource.recoverInterruptedExact()
		try {
			await runDemoFridayAuthorityDrainLoop({ service, signal })
		} catch (error) {
			if (signal.aborted) return
			// An exact terminal effect may have happened before local acknowledgement.
			// Keep recovery HTTP available, fail new operations closed, and wait for
			// the reviewed restart boundary instead of releasing the reference.
			drainQuarantined = true
			void error
			await waitForStop(signal)
		}
	} catch (error) {
		if (!signal.aborted) throw error
	} finally {
		signal.removeEventListener('abort', stopListener)
		stopListener()
		await stopping
	}
}
