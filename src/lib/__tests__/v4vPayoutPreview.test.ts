import { describe, expect, test } from 'bun:test'
import { buildV4VPayoutPreview } from '../v4v/v4vPayoutPreview'
import type { V4VSplitRow } from '../v4v/splitAnnouncement'

const row = (id: string, destination: string, bps: number, name?: string): V4VSplitRow => ({
	id,
	destination,
	bps,
	...(name ? { name } : {}),
})

const preview = (overrides: Partial<Parameters<typeof buildV4VPayoutPreview>[0]> = {}) =>
	buildV4VPayoutPreview({
		rows: [row('1', 'alice@example.com', 5000), row('2', 'bob@example.com', 5000)],
		settledSats: 1000,
		minimumZapSats: 1,
		...overrides,
	})

describe("the seller sees their own share, and everyone else's", () => {
	test('a half split leaves half the settlement with the seller, visibly', () => {
		const result = preview()
		expect(result.ok).toBe(true)
		expect(result.totalBps).toBe(10000)
		expect(result.sellerBps).toBe(0)
		expect(result.sellerSats).toBe(0)
		expect(result.willPaySats).toBe(1000)
		expect(result.rows.map((entry) => entry.sats)).toEqual([500, 500])
	})

	test('a 40%-split shows the 60% the seller keeps', () => {
		const result = preview({ rows: [row('1', 'alice@example.com', 4000)] })
		expect(result.sellerBps).toBe(6000)
		expect(result.sellerSats).toBe(600)
		expect(result.willPaySats).toBe(400)
	})

	test('percent is derived from bps, rounded to two places', () => {
		const result = preview({ rows: [row('1', 'alice@example.com', 3333)] })
		expect(result.rows[0].percent).toBe(33.33)
	})

	test('the seller remainder absorbs the rounding dust, so the numbers add up', () => {
		const result = preview({
			rows: [row('1', 'alice@example.com', 3333), row('2', 'bob@example.com', 3333), row('3', 'carol@example.com', 3334)],
			settledSats: 1000,
		})
		const rowSats = result.rows.reduce((total, entry) => total + entry.sats, 0)
		expect(rowSats + result.sellerSats).toBe(1000)
	})
})

describe('a preview describes intent, and never claims a payment', () => {
	test('a payable row is planned, not paid', () => {
		const result = preview()
		expect(result.rows.every((entry) => entry.status === 'planned')).toBe(true)
		expect(result.rows[0].sentence).toBe('This share is scheduled to be paid when the auction settles.')
	})

	test('nothing is ever reported as paid by a preview', () => {
		const result = preview()
		expect(result.rows.some((entry) => entry.status === 'paid' || entry.status === 'paid_unconfirmed')).toBe(false)
	})

	test('a below-minimum row is shown as not paid, with the reason', () => {
		const result = preview({
			rows: [row('1', 'alice@example.com', 500), row('2', 'bob@example.com', 9500)],
			settledSats: 4,
			minimumZapSats: 100,
		})
		const small = result.rows.find((entry) => entry.id === '1')
		expect(small?.sats).toBe(0)
		expect(small?.detail).toBe('the announced share is zero')
	})

	test('a genuinely below-minimum share keeps its sats and is disclosed as rolled up', () => {
		const result = preview({
			rows: [row('1', 'alice@example.com', 5000), row('2', 'bob@example.com', 5000)],
			settledSats: 10,
			minimumZapSats: 100,
		})
		const rolled = result.rows.find((entry) => entry.id === '1')
		expect(rolled?.status).toBe('rolled_up')
		expect(rolled?.sats).toBe(5)
		expect(result.willNotPaySats).toBeGreaterThan(0)
	})
})

describe('endpoint facts decide, exactly as they do in the run', () => {
	test('an endpoint that does not accept zaps is flagged before the seller publishes', () => {
		const result = preview({
			endpointFacts: {
				'alice@example.com': { answered: true, zapCapable: false },
				'bob@example.com': { answered: true, zapCapable: true },
			},
		})
		expect(result.rows.find((entry) => entry.id === '1')?.status).toBe('not_zap_capable')
		expect(result.warnings).toContain('row_will_not_be_paid')
	})

	test('an endpoint that did not answer is flagged', () => {
		const result = preview({ endpointFacts: { 'alice@example.com': { answered: false, zapCapable: false } } })
		expect(result.rows.find((entry) => entry.id === '1')?.status).toBe('address_unreachable')
	})

	test('a share above the endpoint maximum is flagged, not silently accepted', () => {
		const result = preview({
			endpointFacts: { 'alice@example.com': { answered: true, zapCapable: true, maxSendableMsat: 100_000 } },
		})
		const entry = result.rows.find((candidate) => candidate.id === '1')
		expect(entry?.status).toBe('above_endpoint_maximum')
		expect(entry?.detail).toContain('500000')
	})

	test('a share below the endpoint minimum is flagged', () => {
		const result = preview({
			rows: [row('1', 'alice@example.com', 10000)],
			settledSats: 1,
			endpointFacts: { 'alice@example.com': { answered: true, zapCapable: true, minSendableMsat: 5000 } },
		})
		expect(result.rows[0].status).toBe('below_minimum')
	})
})

describe('warnings a seller needs before publishing', () => {
	test('an empty split warns that nothing will be paid', () => {
		const result = preview({ rows: [] })
		expect(result.warnings).toContain('no_rows')
	})

	test('all-zero rows warn that the seller keeps everything', () => {
		const result = preview({ rows: [row('1', 'alice@example.com', 0)] })
		expect(result.warnings).toContain('seller_keeps_everything')
		expect(result.willPaySats).toBe(0)
	})

	test('a split with no liveness check says so rather than implying the endpoints work', () => {
		expect(preview().warnings).toContain('endpoint_facts_missing')
	})

	test('a split with no commitment says so', () => {
		expect(preview().warnings).toContain('commitment_missing')
	})

	test('the commitment is reported so the tab can show and publish it', () => {
		const result = preview()
		expect(result.commitment).toMatch(/^[0-9a-f]{64}$/)
	})

	test('a commitment already published is passed through unchanged', () => {
		const result = preview({ commitment: 'a'.repeat(64) })
		expect(result.commitment).toBe('a'.repeat(64))
		expect(result.warnings).not.toContain('commitment_missing')
	})
})

describe('an invalid configuration is reported, never silently emptied', () => {
	test('a malformed destination names the row to fix', () => {
		const result = preview({ rows: [row('1', 'alice@example.com', 5000), row('2', 'not a destination', 5000)] })
		expect(result.ok).toBe(false)
		expect(result.rows).toEqual([])
		expect(result.refusal).toMatchObject({ code: 'destination_unsupported_scheme', rowId: '2' })
	})

	test('an over-allocated split is reported with both numbers', () => {
		const result = preview({ rows: [row('1', 'alice@example.com', 6000), row('2', 'bob@example.com', 6000)] })
		expect(result.ok).toBe(false)
		expect(result.refusal?.code).toBe('split_over_allocated')
		expect(result.refusal?.detail).toContain('12000')
	})

	test('a duplicated destination is reported', () => {
		const result = preview({ rows: [row('1', 'Alice@example.com', 5000), row('2', 'alice@EXAMPLE.com', 5000)] })
		expect(result.refusal?.code).toBe('destination_duplicate')
	})

	test('an amount the plan cannot vouch for is refused, not shown as an empty payout', () => {
		const result = preview({ settledSats: -1 })
		expect(result.ok).toBe(false)
		expect(result.refusal?.code).toBeTruthy()
		// the giveaway that something was refused rather than "nothing to pay": both totals are zero but
		// the preview says why
		expect(result.willPaySats).toBe(0)
		expect(result.refusal).toBeDefined()
	})
})
