import { describe, expect, test } from 'bun:test'
import { reconcileCocoAuctionTrustedMints, resolveAuctionFormAvailableMints } from './auctionMintProfile'

describe('auction mint profile', () => {
	test('uses only the Coco environment fake-mint allowlist in Coco mode', () => {
		expect(
			resolveAuctionFormAvailableMints(
				['https://market-test.playday.it/fake-mint/'],
				['https://mint.minibits.cash/Bitcoin', 'http://localhost:3338', 'https://nofees.testnut.cashu.space'],
			),
		).toEqual(['https://market-test.playday.it/fake-mint'])
	})

	test('keeps the existing mint catalogue outside Coco mode', () => {
		expect(resolveAuctionFormAvailableMints(null, ['https://mint.example/', 'https://mint.example', 'https://other.example'])).toEqual([
			'https://mint.example',
			'https://other.example',
		])
	})

	test('removes stale localhost and unavailable mints from a Coco draft', () => {
		expect(
			reconcileCocoAuctionTrustedMints(
				['http://localhost:3338', 'http://127.0.0.1:3338', 'https://nofees.testnut.cashu.space'],
				['https://market-test.playday.it/fake-mint'],
			),
		).toEqual(['https://market-test.playday.it/fake-mint'])
	})

	test('preserves an explicit selection when it remains allowlisted', () => {
		expect(
			reconcileCocoAuctionTrustedMints(
				['https://testnut.cashu.space', 'http://localhost:3338'],
				['https://market-test.playday.it/fake-mint', 'https://testnut.cashu.space'],
			),
		).toEqual(['https://testnut.cashu.space'])
	})
})
