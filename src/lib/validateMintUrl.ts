import { CashuMint } from '@cashu/cashu-ts'

export type MintValidationResult = { valid: true } | { valid: false; error: string }

const VALIDATION_TIMEOUT_MS = 5000

function normalizeMintUrl(url: string): string {
	return url.trim().replace(/\/$/, '')
}

export async function validateMintUrl(rawUrl: string): Promise<MintValidationResult> {
	const url = normalizeMintUrl(rawUrl)

	if (!url) {
		return { valid: false, error: 'Mint URL is required' }
	}

	if (!url.startsWith('https://')) {
		return { valid: false, error: 'Mint URL must start with https://' }
	}

	try {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS)

		const cashuMint = new CashuMint(url)
		await cashuMint.getInfo()

		clearTimeout(timeout)
		return { valid: true }
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') {
			return { valid: false, error: 'Mint did not respond in time' }
		}
		const message = err instanceof Error ? err.message : 'Unknown error'
		return { valid: false, error: `Could not verify mint: ${message}` }
	}
}
