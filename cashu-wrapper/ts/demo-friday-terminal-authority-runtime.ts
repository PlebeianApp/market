/**
 * Trusted in-process composition from consensus/FROST terminal authority to
 * the persistent Friday queue.
 *
 * The caller supplies the real consensus/FROST service request, but it cannot
 * supply the private prepared-authorization reader or replace the independent
 * rollback anchor. Both are captured once at construction. This component
 * opens no listener; a future reviewed same-origin API may invoke it only
 * after completing the client-held payment-key protocol.
 */
import {
	createDemoFridayAuthorizedTerminalQueue,
	type DemoFridayAuthorizedTerminalQueuePort,
} from './demo-friday-authorized-terminal-queue'
import type { DemoFridayCoordinatorRollbackAnchorPort, DemoFridayCoordinatorSqlite } from './demo-friday-coordinator-runtime'
import type { DemoIntegratedTerminalAuthorityStore } from './demo-integrated-authority'
import {
	queueDemoIntegratedThreshold3Terminal,
	type DemoIntegratedThreshold3QueuedTerminalResult,
	type DemoIntegratedThreshold3TerminalRequest,
} from './demo-integrated-threshold3-terminal-service'
import type { DemoMaintainerOfflineIdentity, DemoMaintainerPreparedAuthorizationV1 } from './demo-maintainer-offline'

export interface DemoFridayTerminalAuthorityRuntime {
	queueTerminal(request: DemoIntegratedThreshold3TerminalRequest): Promise<DemoIntegratedThreshold3QueuedTerminalResult>
}

export function createDemoFridayTerminalAuthorityRuntime(options: {
	authorityStore: DemoIntegratedTerminalAuthorityStore
	coordinatorStore: DemoFridayCoordinatorSqlite
	rollbackAnchor: DemoFridayCoordinatorRollbackAnchorPort
	preparedReader: {
		readPreparedExact(identity: DemoMaintainerOfflineIdentity): Promise<DemoMaintainerPreparedAuthorizationV1>
	}
}): DemoFridayTerminalAuthorityRuntime {
	const queue: DemoFridayAuthorizedTerminalQueuePort = createDemoFridayAuthorizedTerminalQueue({
		authorityStore: options.authorityStore,
		coordinatorStore: options.coordinatorStore,
		rollbackAnchor: options.rollbackAnchor,
		preparedReader: options.preparedReader,
	})
	return Object.freeze({
		async queueTerminal(request: DemoIntegratedThreshold3TerminalRequest) {
			// The request contains capability ports and cannot be cloned as one
			// object. Each downstream boundary snapshots the public value it owns
			// and captures callable ports before its first await.
			return queueDemoIntegratedThreshold3Terminal(request, queue)
		},
	})
}
