import { describe, expect, test, mock, beforeEach } from 'bun:test'
import { validateMintUrl } from '../validateMintUrl'

const mockGetInfo = mock(() => Promise.resolve({ pubkey: 'test-pubkey' }))

mock.module('@cashu/cashu-ts', () => ({
	CashuMint: class {
		_mintUrl: string
		constructor(url: string) {
			this._mintUrl = url
		}
		getInfo = mockGetInfo
	},
}))

describe('validateMintUrl', () => {
	beforeEach(() => {
		mockGetInfo.mockClear()
	})

	test('returns valid for a reachable mint', async () => {
		mockGetInfo.mockResolvedValueOnce({ pubkey: 'test-pubkey' })
		const result = await validateMintUrl('https://mint.example.com')
		expect(result).toEqual({ valid: true })
	})

	test('rejects empty string', async () => {
		const result = await validateMintUrl('')
		expect(result.valid).toBe(false)
		if (!result.valid) expect(result.error).toContain('required')
	})

	test('rejects whitespace-only string', async () => {
		const result = await validateMintUrl('   ')
		expect(result.valid).toBe(false)
		if (!result.valid) expect(result.error).toContain('required')
	})

	test('rejects non-https URL', async () => {
		const result = await validateMintUrl('http://mint.example.com')
		expect(result.valid).toBe(false)
		if (!result.valid) expect(result.error).toContain('https://')
	})

	test('returns error when getInfo throws', async () => {
		mockGetInfo.mockRejectedValueOnce(new Error('network failure'))
		const result = await validateMintUrl('https://down.mint.example.com')
		expect(result.valid).toBe(false)
		if (!result.valid) expect(result.error).toContain('network failure')
	})

	test('returns timeout error when mint does not respond', async () => {
		mockGetInfo.mockImplementationOnce(
			() =>
				new Promise((_, reject) => {
					const err = new DOMException('The operation was aborted', 'AbortError')
					reject(err)
				}),
		)
		const result = await validateMintUrl('https://slow.mint.example.com')
		expect(result.valid).toBe(false)
		if (!result.valid) expect(result.error).toContain('did not respond')
	})

	test('normalizes URL with trailing slash before validating', async () => {
		mockGetInfo.mockResolvedValueOnce({ pubkey: 'test-pubkey' })
		const result = await validateMintUrl('https://mint.example.com/')
		expect(result).toEqual({ valid: true })
	})
})
