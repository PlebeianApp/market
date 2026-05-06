import { describe, expect, test } from 'bun:test'
import { validateMintUrl } from '../validateMintUrl'

const KNOWN_MINT = 'https://testnut.cashu.space'

describe('validateMintUrl integration', () => {
	test('validates a known good mint over real HTTP', async () => {
		const result = await validateMintUrl(KNOWN_MINT)
		expect(result.valid).toBe(true)
	})

	test('rejects a non-existent mint URL over real HTTP', async () => {
		const result = await validateMintUrl('https://this-mint-does-not-exist.example.com')
		expect(result.valid).toBe(false)
		if (!result.valid) {
			expect(result.error.length).toBeGreaterThan(0)
		}
	})
})
