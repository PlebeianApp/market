import { describe, expect, test } from 'bun:test'

import {
	runDemoFipsEmergencyRefundCase,
	runDemoFipsNormalTerminalCases,
	type DemoFipsNormalTerminalCases,
} from './demo-fips-terminal-driver'
import { demoFipsTerminalLabPlan } from './demo-fips-terminal-lab-plan'

const baseRequest = (
	branch: 'winner_payout' | 'reserve_unmet_return',
	suffix: string,
): DemoFipsNormalTerminalCases['winner'] | DemoFipsNormalTerminalCases['reserveUnmet'] => ({
	branch,
	options: {
		closeRequest: { auctionId: `auction-${suffix}` },
		template: {
			operationId: `operation-${suffix}`, templateDigest: suffix.repeat(64).slice(0, 64),
			locktime: 4_000, inputs: [{ amount: 1, id: 'keyset', secret: `proof-${suffix}`, C: `02${suffix.repeat(64).slice(0, 64)}` }],
		},
		offlineIdentity: { scope: `scope-${suffix}` },
		nowSeconds: 3_000,
	},
}) as unknown as DemoFipsNormalTerminalCases['winner'] | DemoFipsNormalTerminalCases['reserveUnmet']

describe('FIPS terminal driver pre-effect boundary', () => {
	test('serializes disjoint winner and reserve-unmet cases through the real dispatcher port', async () => {
		const calls: string[] = []
		const cases = {
			winner: baseRequest('winner_payout', '1'),
			reserveUnmet: baseRequest('reserve_unmet_return', '2'),
		} as DemoFipsNormalTerminalCases
		const result = await runDemoFipsNormalTerminalCases({ cases, plan: demoFipsTerminalLabPlan(300, 3_600), runner: {
			async execute(request) {
				calls.push(request.branch)
				return {
					branch: request.branch,
					result: { payment: { lifecycle: { status: 'recipient_imported' } } },
				} as never
			},
		} })
		expect(calls).toEqual(['winner_payout', 'reserve_unmet_return'])
		expect(result.winner.branch).toBe('winner_payout')
		expect(result.reserveUnmet.branch).toBe('reserve_unmet_return')
	})

	test('rejects proof reuse before invoking any effect', async () => {
		let calls = 0
		const winner = baseRequest('winner_payout', '1')
		const reserveUnmet = baseRequest('reserve_unmet_return', '2')
		reserveUnmet.options.template.inputs = winner.options.template.inputs
		await expect(runDemoFipsNormalTerminalCases({
			cases: { winner, reserveUnmet } as never,
			plan: demoFipsTerminalLabPlan(300, 3_600),
			runner: { async execute() { calls++; throw new Error('must not run') } },
		})).rejects.toThrow(/reuse a bearer proof/)
		expect(calls).toBe(0)
	})

	test('refuses emergency execution inside the old 30-minute window before effects', async () => {
		let calls = 0
		await expect(runDemoFipsEmergencyRefundCase({
			request: baseRequest('reserve_unmet_return', '3') as DemoFipsNormalTerminalCases['reserveUnmet'],
			plan: demoFipsTerminalLabPlan(),
			runner: { async execute() { calls++; throw new Error('must not run') } },
		})).rejects.toThrow(/cannot run inside the reviewed wall bound/)
		expect(calls).toBe(0)
	})

	test('rejects a swapped branch before invoking any effect', async () => {
		let calls = 0
		const cases = {
			winner: baseRequest('reserve_unmet_return', '1'),
			reserveUnmet: baseRequest('winner_payout', '2'),
		} as unknown as DemoFipsNormalTerminalCases
		await expect(runDemoFipsNormalTerminalCases({
			cases, plan: demoFipsTerminalLabPlan(300, 3_600),
			runner: { async execute() { calls++; throw new Error('must not run') } },
		})).rejects.toThrow(/branch labels differ before execution/)
		expect(calls).toBe(0)
	})

	test('keeps post-locktime emergency fail-closed until distinct authority is composed', async () => {
		let calls = 0
		const request = baseRequest('reserve_unmet_return', '3') as DemoFipsNormalTerminalCases['reserveUnmet']
		request.options.nowSeconds = request.options.template.locktime
		await expect(runDemoFipsEmergencyRefundCase({
			request, plan: demoFipsTerminalLabPlan(300, 4_200),
			runner: { async execute() { calls++; throw new Error('must not run') } },
		})).rejects.toThrow(/unilateral authority is not composed/)
		expect(calls).toBe(0)
	})
})
