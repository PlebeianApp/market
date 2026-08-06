import { describe, expect, test } from 'bun:test'
import { getAuctionDepositFeePadding } from '@/lib/stores/nip60'

describe('getAuctionDepositFeePadding', () => {
	test.each([
		[100, 5],
		[1_000, 5],
		[10_000, 50],
		[20_000, 100],
		[100_000, 100],
	])('%d sat deposit receives %d sats of padding', (depositAmount, expectedPadding) =>
		expect(getAuctionDepositFeePadding(depositAmount)).toBe(expectedPadding),
	)
})
