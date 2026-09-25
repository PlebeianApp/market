import { describe, expect, test } from 'bun:test'
import { assertCocoTestFundingAllowed, COCO_DEFAULT_FAKE_FUNDING_AMOUNT, COCO_MAX_FAKE_FUNDING_AMOUNT } from '@/lib/coco/runtime'

const fakeProfile = (environmentId: string, fakeMintAllowlist: readonly string[] = ['http://localhost:3338']) => ({
	environmentId,
	monetaryMode: 'fake',
	fakeMintAllowlist,
})

describe('Coco test-mint funding', () => {
	test('starts with a useful default and enforces a bounded top-up', () => {
		expect(COCO_DEFAULT_FAKE_FUNDING_AMOUNT).toBe(500)
		expect(COCO_MAX_FAKE_FUNDING_AMOUNT).toBe(100_000)
	})

	test('allows only the explicit test profiles and returns their allowlisted mint', () => {
		expect(assertCocoTestFundingAllowed(fakeProfile('test'), 500)).toBe('http://localhost:3338')
		expect(assertCocoTestFundingAllowed(fakeProfile('auctionsdev', ['https://fake-mint.example']), 1_000)).toBe('https://fake-mint.example')
		expect(
			assertCocoTestFundingAllowed(
				fakeProfile('test', ['http://localhost:3338', 'https://testnut.cashu.space']),
				500,
				'https://testnut.cashu.space',
			),
		).toBe('https://testnut.cashu.space')
	})

	test('rejects a selected mint that is not explicitly allowlisted', () => {
		expect(() => assertCocoTestFundingAllowed(fakeProfile('test'), 500, 'https://testnut.cashu.space')).toThrow(
			'not in the Coco fake-mint allowlist',
		)
	})

	test('rejects non-test environments before contacting a mint', () => {
		expect(() => assertCocoTestFundingAllowed(fakeProfile('production'), 500)).toThrow('restricted to auctionsdev/test')
	})

	test('rejects real funds and missing fake-mint allowlists', () => {
		expect(() =>
			assertCocoTestFundingAllowed(
				{
					environmentId: 'test',
					monetaryMode: 'real',
					fakeMintAllowlist: ['https://mint.example'],
				},
				500,
			),
		).toThrow('restricted to fake funds')
		expect(() => assertCocoTestFundingAllowed(fakeProfile('test', []), 500)).toThrow('requires an allowlisted fake mint')
	})

	test('rejects invalid, fractional, and oversized amounts before contacting a mint', () => {
		for (const amount of [0, -1, 1.5, Number.NaN, COCO_MAX_FAKE_FUNDING_AMOUNT + 1]) {
			expect(() => assertCocoTestFundingAllowed(fakeProfile('test'), amount)).toThrow('must be a whole number')
		}
	})
})
