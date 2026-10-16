import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BidStatusBanner, BidStatusPill, getBidStatusCopy, type BidStatusDisplayInput } from './BidStatusViews'

const base: BidStatusDisplayInput = {
	status: 'outbid',
	reclaimableCount: 0,
	waitingForReclaim: false,
	hasTrackedTokens: true,
	latestLocktime: 0,
	reclaimCountdownLabel: 'Reclaim opens in 5m',
}

describe('bid status copy', () => {
	test('shows the countdown while reclaim has not opened', () => {
		expect(getBidStatusCopy({ ...base, waitingForReclaim: true }).helper).toBe('Reclaim opens in 5m')
		expect(getBidStatusCopy(base).helper).toBe('Your bid stays timelocked until reclaim opens after locktime.')
	})

	test('flags a missing local reclaim token instead of implying funds are tracked', () => {
		expect(getBidStatusCopy({ ...base, status: 'cancelled', hasTrackedTokens: false }).helper).toContain('no tracked reclaim token')
		expect(getBidStatusCopy({ ...base, status: 'recorded', hasTrackedTokens: false }).helper).toContain('missing the local reclaim token')
	})

	test('keeps refund, reclaim, and winning labels distinct', () => {
		const labels = (['winning', 'refund_received', 'reclaimed', 'reclaim_available'] as const).map(
			(status) => getBidStatusCopy({ ...base, status, reclaimableCount: 2 }).label,
		)
		expect(new Set(labels).size).toBe(4)
		expect(getBidStatusCopy({ ...base, status: 'reclaim_available', reclaimableCount: 2 }).helper).toContain('2 locked bid parts are')
	})

	test('pill and banner render the label and tone', () => {
		const copy = getBidStatusCopy({ ...base, status: 'locked', waitingForReclaim: true })
		expect(renderToStaticMarkup(<BidStatusPill copy={copy} />)).toContain('border-blue-200')
		expect(renderToStaticMarkup(<BidStatusBanner copy={copy} />)).toContain('Reclaim opens in 5m')
	})
})
