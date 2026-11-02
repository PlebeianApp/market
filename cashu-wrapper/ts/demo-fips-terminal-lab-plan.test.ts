import { describe, expect, test } from 'bun:test'

import {
	DEMO_FIPS_FULL_LAB_WALL_SECONDS,
	demoFipsTerminalLabPlan,
	requireDemoFipsTerminalScenariosWithinBound,
} from './demo-fips-terminal-lab-plan'

describe('FIPS terminal lab schedule', () => {
	test('conservatively accounts for the extension cap and emergency deadline', () => {
		const plan = demoFipsTerminalLabPlan()
		expect(plan.latestNormalTerminalSeconds).toBe(2_100)
		expect(plan.emergencyEarliestSeconds).toBe(3_000)
		expect(plan.fullLabWallSeconds).toBe(DEMO_FIPS_FULL_LAB_WALL_SECONDS)
		expect(plan.withinCurrentBound).toEqual({
			winner_payout: false,
			reserve_unmet_return: false,
			emergency_refund: false,
		})
		expect(() => requireDemoFipsTerminalScenariosWithinBound(plan, [
			'winner_payout', 'reserve_unmet_return',
		])).toThrow(/cannot run inside the reviewed wall bound/)
		expect(() => requireDemoFipsTerminalScenariosWithinBound(plan, ['emergency_refund']))
			.toThrow(/cannot run inside the reviewed wall bound/)
	})

	test('requires an explicit longer action window for emergency settlement', () => {
		const tooShortForNormal = demoFipsTerminalLabPlan(300, 3_599)
		expect(tooShortForNormal.withinCurrentBound.winner_payout).toBe(false)
		expect(tooShortForNormal.withinCurrentBound.reserve_unmet_return).toBe(false)
		const plan = demoFipsTerminalLabPlan(300, 3_600)
		expect(plan.withinCurrentBound.winner_payout).toBe(true)
		expect(plan.withinCurrentBound.reserve_unmet_return).toBe(true)
		expect(plan.withinCurrentBound.emergency_refund).toBe(false)
		expect(() => requireDemoFipsTerminalScenariosWithinBound(plan, ['emergency_refund']))
			.toThrow(/cannot run inside the reviewed wall bound/)
		const tooShortForEmergency = demoFipsTerminalLabPlan(300, 4_199)
		expect(tooShortForEmergency.withinCurrentBound.emergency_refund).toBe(false)
		const emergencyPlan = demoFipsTerminalLabPlan(300, 4_200)
		expect(emergencyPlan.withinCurrentBound.emergency_refund).toBe(true)
		expect(() => requireDemoFipsTerminalScenariosWithinBound(emergencyPlan, ['emergency_refund'])).not.toThrow()
	})

	test('rejects a caller-forged fit flag', () => {
		const forged = demoFipsTerminalLabPlan()
		forged.withinCurrentBound.winner_payout = true
		expect(() => requireDemoFipsTerminalScenariosWithinBound(forged, ['winner_payout']))
			.toThrow(/not the canonical reviewed schedule/)
	})
})
