/** Exact, side-effect-free schedule for the remaining full-lab payment branches. */
import {
	DEMO_EMERGENCY_RECOVERY_SECONDS,
	DEMO_MAX_EXTENSION_SECONDS,
} from './demo-integrated-authority'

export const DEMO_FIPS_FULL_LAB_WALL_SECONDS = 1_800
export const DEMO_FIPS_MIN_AUCTION_SECONDS = 300
export const DEMO_FIPS_TERMINAL_SETTLEMENT_BUDGET_SECONDS = 600
export const DEMO_FIPS_SETUP_BUDGET_SECONDS = 300
export const DEMO_FIPS_NORMAL_REVIEWED_WALL_SECONDS = 3_600
export const DEMO_FIPS_EMERGENCY_REVIEWED_WALL_SECONDS = 4_200

export type DemoFipsTerminalScenario =
	| 'winner_payout'
	| 'reserve_unmet_return'
	| 'emergency_refund'

export interface DemoFipsTerminalLabPlan {
	schema: 'PLEBEIAN_FRIDAY_FIPS_TERMINAL_LAB_PLAN_V1'
	auctionDurationSeconds: number
	latestNormalTerminalSeconds: number
	emergencyEarliestSeconds: number
	fullLabWallSeconds: number
	setupBudgetSeconds: number
	withinCurrentBound: {
		winner_payout: boolean
		reserve_unmet_return: boolean
		emergency_refund: boolean
	}
	parallelSafeSets: Array<Array<DemoFipsTerminalScenario>>
}

/**
 * This function deliberately refuses to shorten the approved refund clock.
 * `emergencyEarliestSeconds` is measured from lab start and assumes no late
 * bids. A late bid cannot move the locktime later because the locktime is
 * already bound to original end + the full extension cap + recovery budget.
 */
export function demoFipsTerminalLabPlan(
	auctionDurationSeconds = DEMO_FIPS_MIN_AUCTION_SECONDS,
	fullLabWallSeconds = DEMO_FIPS_FULL_LAB_WALL_SECONDS,
): DemoFipsTerminalLabPlan {
	if (!Number.isSafeInteger(auctionDurationSeconds) || auctionDurationSeconds < DEMO_FIPS_MIN_AUCTION_SECONDS
		|| !Number.isSafeInteger(fullLabWallSeconds) || fullLabWallSeconds < 1) {
		throw new Error('DEMO_FIPS_TERMINAL_PLAN: duration or wall bound is invalid')
	}
	const latestNormalTerminalSeconds = auctionDurationSeconds + DEMO_MAX_EXTENSION_SECONDS
	const emergencyEarliestSeconds = auctionDurationSeconds
		+ DEMO_MAX_EXTENSION_SECONDS + DEMO_EMERGENCY_RECOVERY_SECONDS
	const normalFits = fullLabWallSeconds >= DEMO_FIPS_NORMAL_REVIEWED_WALL_SECONDS
		&& DEMO_FIPS_SETUP_BUDGET_SECONDS + latestNormalTerminalSeconds
			+ DEMO_FIPS_TERMINAL_SETTLEMENT_BUDGET_SECONDS <= fullLabWallSeconds
	return {
		schema: 'PLEBEIAN_FRIDAY_FIPS_TERMINAL_LAB_PLAN_V1',
		auctionDurationSeconds,
		latestNormalTerminalSeconds,
		emergencyEarliestSeconds,
		fullLabWallSeconds,
		setupBudgetSeconds: DEMO_FIPS_SETUP_BUDGET_SECONDS,
		withinCurrentBound: {
			winner_payout: normalFits,
			reserve_unmet_return: normalFits,
			emergency_refund: fullLabWallSeconds >= DEMO_FIPS_EMERGENCY_REVIEWED_WALL_SECONDS
				&& DEMO_FIPS_SETUP_BUDGET_SECONDS + emergencyEarliestSeconds
					+ DEMO_FIPS_TERMINAL_SETTLEMENT_BUDGET_SECONDS <= fullLabWallSeconds,
		},
		// Winner and reserve-unmet use distinct auctions, proof pools, operation
		// roots and recipient journals. They may share the four signer services,
		// but their signing sessions remain separately nonce-bound.
		parallelSafeSets: [['winner_payout', 'reserve_unmet_return'], ['emergency_refund']],
	}
}

export function requireDemoFipsTerminalScenariosWithinBound(
	plan: DemoFipsTerminalLabPlan,
	scenarios: readonly DemoFipsTerminalScenario[],
): void {
	const exact = demoFipsTerminalLabPlan(plan.auctionDurationSeconds, plan.fullLabWallSeconds)
	if (JSON.stringify(plan) !== JSON.stringify(exact)) {
		throw new Error('DEMO_FIPS_TERMINAL_PLAN: supplied plan is not the canonical reviewed schedule')
	}
	for (const scenario of scenarios) {
		if (!exact.withinCurrentBound[scenario]) {
			throw new Error(`DEMO_FIPS_TERMINAL_PLAN_BOUND: ${scenario} cannot run inside the reviewed wall bound`)
		}
	}
}
