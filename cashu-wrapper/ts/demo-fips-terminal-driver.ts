/**
 * Bounded terminal-case dispatcher for the full isolated FIPS lab.
 *
 * The caller must supply the concrete Comet readers, participant-local policy
 * workers, Rust threshold processes, durable stores, fake mint and recipient
 * import ports through the existing terminal-service request. This module
 * adds no mock path and does not turn stdio into networking.
 */
import { proofPoint } from './nut-client'
import {
	executeDemoIntegratedThreshold3Terminal,
	type DemoIntegratedThreshold3TerminalRequest,
	type DemoIntegratedThreshold3TerminalResult,
} from './demo-integrated-threshold3-terminal-service'
import type { DemoIntegratedThreshold3CloseServiceOptions } from './demo-integrated-threshold3-close-service'
import {
	demoFipsTerminalLabPlan,
	requireDemoFipsTerminalScenariosWithinBound,
	type DemoFipsTerminalLabPlan,
} from './demo-fips-terminal-lab-plan'
import { bytesToHex } from '@noble/hashes/utils.js'

type NormalTerminalRequest = {
	branch: 'winner_payout' | 'reserve_unmet_return'
	options: DemoIntegratedThreshold3CloseServiceOptions
}

export interface DemoFipsNormalTerminalCases {
	winner: NormalTerminalRequest & { branch: 'winner_payout' }
	reserveUnmet: NormalTerminalRequest & { branch: 'reserve_unmet_return' }
}

export interface DemoFipsTerminalCaseRunner {
	execute(request: DemoIntegratedThreshold3TerminalRequest): Promise<DemoIntegratedThreshold3TerminalResult>
}

function inputRefs(request: NormalTerminalRequest): string[] {
	return request.options.template.inputs
		.map((proof) => bytesToHex(proofPoint(proof).toBytes(true)))
		.sort()
}

/** Public pre-effect validation shared by the CLI and focused fixtures. */
export function validateDemoFipsNormalTerminalCases(
	cases: DemoFipsNormalTerminalCases,
	plan: DemoFipsTerminalLabPlan = demoFipsTerminalLabPlan(),
): void {
	requireDemoFipsTerminalScenariosWithinBound(plan, ['winner_payout', 'reserve_unmet_return'])
	if (cases.winner.branch !== 'winner_payout' || cases.reserveUnmet.branch !== 'reserve_unmet_return') {
		throw new Error('DEMO_FIPS_TERMINAL_DRIVER_BRANCH: terminal branch labels differ before execution')
	}
	const winner = cases.winner.options
	const reserve = cases.reserveUnmet.options
	if (winner.closeRequest.auctionId === reserve.closeRequest.auctionId
		|| winner.template.operationId === reserve.template.operationId
		|| winner.offlineIdentity.scope === reserve.offlineIdentity.scope
		|| winner.template.templateDigest === reserve.template.templateDigest) {
		throw new Error('DEMO_FIPS_TERMINAL_DRIVER_IDENTITY: terminal cases must use distinct auctions, operations, scopes and roots')
	}
	const winnerRefs = new Set(inputRefs(cases.winner))
	if (inputRefs(cases.reserveUnmet).some((value) => winnerRefs.has(value))) {
		throw new Error('DEMO_FIPS_TERMINAL_DRIVER_PROOF: terminal cases reuse a bearer proof')
	}
	if (winner.nowSeconds >= winner.template.locktime || reserve.nowSeconds >= reserve.template.locktime) {
		throw new Error('DEMO_FIPS_TERMINAL_DRIVER_CLOCK: normal terminal cases must execute before the emergency deadline')
	}
}

/**
 * Run the two normal terminal branches serially. Serial execution is chosen
 * for the small-memory lab even though the identities and proof pools are
 * disjoint; signer sessions still retain their own durable nonce identities.
 */
export async function runDemoFipsNormalTerminalCases(options: {
	cases: DemoFipsNormalTerminalCases
	plan?: DemoFipsTerminalLabPlan
	runner?: DemoFipsTerminalCaseRunner
}): Promise<{
	winner: DemoIntegratedThreshold3TerminalResult
	reserveUnmet: DemoIntegratedThreshold3TerminalResult
}> {
	validateDemoFipsNormalTerminalCases(options.cases, options.plan)
	const execute = options.runner?.execute
		?? ((request: DemoIntegratedThreshold3TerminalRequest) => executeDemoIntegratedThreshold3Terminal(request))
	// The service request deliberately contains executable port objects. The
	// concrete service clones its value records at the trust boundary; cloning
	// the whole request here would reject functions before any honest run.
	const winner = await execute(options.cases.winner)
	if (winner.branch !== 'winner_payout' || winner.result.payment.lifecycle.status !== 'recipient_imported') {
		throw new Error('DEMO_FIPS_TERMINAL_DRIVER_WINNER: exact seller import did not finish')
	}
	const reserveUnmet = await execute(options.cases.reserveUnmet)
	if (reserveUnmet.branch !== 'reserve_unmet_return'
		|| reserveUnmet.result.payment.lifecycle.status !== 'recipient_imported') {
		throw new Error('DEMO_FIPS_TERMINAL_DRIVER_RESERVE: exact bidder return did not finish')
	}
	return { winner, reserveUnmet }
}

/**
 * Emergency execution is intentionally a separate, currently unavailable
 * action. It cannot be added to the current 1,800-second lab because the exact
 * locktime is at least 3,000 seconds from a five-minute auction start, before
 * setup and settlement budgets. No deadline is shortened.
 */
export async function runDemoFipsEmergencyRefundCase(options: {
	request: NormalTerminalRequest & { branch: 'reserve_unmet_return' }
	plan: DemoFipsTerminalLabPlan
	runner?: DemoFipsTerminalCaseRunner
}): Promise<DemoIntegratedThreshold3TerminalResult> {
	requireDemoFipsTerminalScenariosWithinBound(options.plan, ['emergency_refund'])
	if (options.request.branch !== 'reserve_unmet_return') {
		throw new Error('DEMO_FIPS_TERMINAL_DRIVER_BRANCH: emergency request changed branch before execution')
	}
	if (options.request.options.nowSeconds < options.request.options.template.locktime) {
		throw new Error('DEMO_FIPS_TERMINAL_DRIVER_EMERGENCY: exact refund locktime has not elapsed')
	}
	// The normal close authority stops new MAIN authorizations at mainCutoff
	// and cannot represent a unilateral escape after locktime. Until a distinct
	// admitted-pool emergency authority is durably bound to global proof use,
	// invoking the supplied runner would either fail or mislabel the authority.
	throw new Error('DEMO_FIPS_TERMINAL_DRIVER_EMERGENCY_AUTHORITY: admitted-pool unilateral authority is not composed')
}
