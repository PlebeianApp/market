/** Terminal RPC mutation wrapper: exact cached refusals are read-only replays. */
import { DemoSignerTerminalIncidentCachedRejection20261109 } from './demo-signer-terminal-incident-20261109'
import { DemoSignerTerminalIncidentCachedRejection20261110 } from './demo-signer-terminal-incident-20261110'
import { DemoSignerTerminalIncidentCachedRejection20261111 } from './demo-signer-terminal-incident-20261111'
import { DemoSignerTerminalIncidentCachedRejection20261111R59d } from './demo-signer-terminal-incident-20261111-r59d'
import { DemoSignerTerminalIncidentCachedRejection20261111R62 } from './demo-signer-terminal-incident-20261111-r62'

export async function runDemoSignerTerminalMutation<Result>(
	poison: () => void,
	operation: () => Promise<Result>,
): Promise<Result> {
	try { return await operation() }
	catch (error) {
		if (!(error instanceof DemoSignerTerminalIncidentCachedRejection20261109)
			&& !(error instanceof DemoSignerTerminalIncidentCachedRejection20261110)
			&& !(error instanceof DemoSignerTerminalIncidentCachedRejection20261111)
			&& !(error instanceof DemoSignerTerminalIncidentCachedRejection20261111R59d)
			&& !(error instanceof DemoSignerTerminalIncidentCachedRejection20261111R62)) poison()
		throw error
	}
}
