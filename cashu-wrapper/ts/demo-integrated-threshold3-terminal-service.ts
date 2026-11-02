/** One explicit entry point for every payment-bearing terminal branch. */
import {
	executeDemoIntegratedThreshold3OutbidReturn,
	queueDemoIntegratedThreshold3OutbidReturn,
	type DemoIntegratedThreshold3OutbidServiceOptions,
	type DemoIntegratedThreshold3OutbidServiceResult,
	type DemoIntegratedThreshold3OutbidQueuedResult,
} from './demo-integrated-threshold3-outbid-service'
import {
	executeDemoIntegratedThreshold3Close,
	queueDemoIntegratedThreshold3Close,
	type DemoIntegratedThreshold3CloseServiceOptions,
	type DemoIntegratedThreshold3CloseServiceResult,
	type DemoIntegratedThreshold3CloseQueuedResult,
} from './demo-integrated-threshold3-close-service'
import type { DemoFridayAuthorizedTerminalQueuePort } from './demo-friday-authorized-terminal-queue'
import {
	queueDemoIntegratedThreshold3RejectedReturn,
	type DemoIntegratedThreshold3RejectedServiceOptions,
	type DemoIntegratedThreshold3RejectedQueuedResult,
} from './demo-integrated-threshold3-rejected-service'
import {
	queueDemoIntegratedThreshold3FundingAbortReturn,
	type DemoIntegratedThreshold3FundingAbortQueuedResult,
	type DemoIntegratedThreshold3FundingAbortServiceOptions,
} from './demo-integrated-threshold3-funding-abort-service'

export type DemoIntegratedThreshold3TerminalRequest =
	| { branch: 'outbid_return'; options: DemoIntegratedThreshold3OutbidServiceOptions }
	| { branch: 'rejected_return'; options: DemoIntegratedThreshold3RejectedServiceOptions }
	| { branch: 'funding_abort_return'; options: DemoIntegratedThreshold3FundingAbortServiceOptions }
	| { branch: 'winner_payout' | 'reserve_unmet_return'; options: DemoIntegratedThreshold3CloseServiceOptions }

export type DemoIntegratedThreshold3TerminalResult =
	| { branch: 'outbid_return'; result: DemoIntegratedThreshold3OutbidServiceResult }
	| { branch: 'winner_payout' | 'reserve_unmet_return'; result: DemoIntegratedThreshold3CloseServiceResult }

export async function executeDemoIntegratedThreshold3Terminal(
	request: DemoIntegratedThreshold3TerminalRequest,
): Promise<DemoIntegratedThreshold3TerminalResult> {
	if (request.branch === 'outbid_return') {
		return { branch: request.branch, result: await executeDemoIntegratedThreshold3OutbidReturn(request.options) }
	}
	if (request.branch === 'rejected_return' || request.branch === 'funding_abort_return') {
		throw new Error('DEMO_INTEGRATED_TERMINAL: rejected/aborted return is persistent-queue only')
	}
	const expectedCause = request.branch === 'winner_payout' ? 'winner' : 'reserve_unmet'
	const result = await executeDemoIntegratedThreshold3Close(request.options, expectedCause)
	return { branch: request.branch, result }
}

export type DemoIntegratedThreshold3QueuedTerminalResult =
	| { branch: 'outbid_return'; result: DemoIntegratedThreshold3OutbidQueuedResult }
	| { branch: 'rejected_return'; result: DemoIntegratedThreshold3RejectedQueuedResult }
	| { branch: 'funding_abort_return'; result: DemoIntegratedThreshold3FundingAbortQueuedResult }
	| { branch: 'winner_payout' | 'reserve_unmet_return'; result: DemoIntegratedThreshold3CloseQueuedResult }

/** Queue a consensus-certified, threshold-authorized branch for the persistent worker. */
export async function queueDemoIntegratedThreshold3Terminal(
	request: DemoIntegratedThreshold3TerminalRequest,
	queue: DemoFridayAuthorizedTerminalQueuePort,
): Promise<DemoIntegratedThreshold3QueuedTerminalResult> {
	if (request.branch === 'outbid_return') {
		return {
			branch: request.branch,
			result: await queueDemoIntegratedThreshold3OutbidReturn({ ...request.options, queue }),
		}
	}
	if (request.branch === 'rejected_return') {
		return { branch: request.branch, result: await queueDemoIntegratedThreshold3RejectedReturn({ ...request.options, queue }) }
	}
	if (request.branch === 'funding_abort_return') {
		return { branch: request.branch, result: await queueDemoIntegratedThreshold3FundingAbortReturn({ ...request.options, queue }) }
	}
	const expectedCause = request.branch === 'winner_payout' ? 'winner' : 'reserve_unmet'
	return {
		branch: request.branch,
		result: await queueDemoIntegratedThreshold3Close({ ...request.options, queue }, expectedCause),
	}
}
