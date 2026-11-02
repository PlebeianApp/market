/**
 * One process lifecycle for the disabled Friday authority candidate.
 *
 * This joins startup recovery, the loopback HTTP boundary and the serial
 * terminal drain. It still requires a reviewed fixed configuration to build
 * the trusted resolver/Comet/DKG/signer/mint ports; callers cannot supply any
 * of those capabilities through HTTP.
 */
import {
	DEMO_FRIDAY_AUTHORITY_LOOPBACK_PORT,
	createDemoFridayFixedAuthorityService,
} from './demo-friday-authority-service'
import {
	type DemoFridayTerminalSourceRuntimePort,
	runDemoFridayAuthorityDrainLoop,
} from './demo-friday-authority-runtime'

type ServiceOptions = Parameters<typeof createDemoFridayFixedAuthorityService>[0]

export interface DemoFridayAuthorityListener {
	stop(closeActiveConnections?: boolean): void | Promise<void>
}

export interface DemoFridayAuthorityListenerFactory {
	(options: {
		hostname: '127.0.0.1'
		port: typeof DEMO_FRIDAY_AUTHORITY_LOOPBACK_PORT
		fetch: (request: Request) => Promise<Response>
	}): DemoFridayAuthorityListener
}

export async function runDemoFridayAuthorityProcess(options: ServiceOptions & {
	terminalSource: DemoFridayTerminalSourceRuntimePort
	signal: AbortSignal
	listenerFactory?: DemoFridayAuthorityListenerFactory
}): Promise<void> {
	if (options.signal.aborted) throw new Error('DEMO_FRIDAY_AUTHORITY_PROCESS: stopped before startup')
	const service = createDemoFridayFixedAuthorityService(options)
	const factory = options.listenerFactory ?? ((value) => Bun.serve({
		...value, maxRequestBodySize: 32 * 1024,
	}))
	const listener = factory({
		hostname: '127.0.0.1', port: DEMO_FRIDAY_AUTHORITY_LOOPBACK_PORT,
		fetch: (request) => service.handle(request),
	})
	try {
		// The fixed loopback listener is the cross-process singleton lease. It must
		// be owned before any restart-only recovery releases durable work.
		options.terminalSource.recoverInterruptedExact()
		await runDemoFridayAuthorityDrainLoop({ service, signal: options.signal })
	} catch (error) {
		if (!options.signal.aborted) throw error
	} finally {
		await listener.stop(true)
	}
}
