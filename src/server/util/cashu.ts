import { CashuMint, type MintKeyset } from '@cashu/cashu-ts'

const mintKeysetCache = new Map<string, MintKeyset[]>()

export const normalizeMintUrl = (mintUrl: string): string => mintUrl.trim().replace(/\/$/, '')

/** Fetch (and cache) the SAT-unit keysets for a mint. */
export async function getMintKeysets(mintUrl: string): Promise<MintKeyset[]> {
	const normalizedMintUrl = normalizeMintUrl(mintUrl)
	const cached = mintKeysetCache.get(normalizedMintUrl)
	if (cached) return cached

	const cashuMint = new CashuMint(normalizedMintUrl)
	const keysetResponse = await cashuMint.getKeySets()
	const satKeysets = keysetResponse.keysets.filter((keyset) => keyset.unit === 'sat')
	const keysets = satKeysets.length > 0 ? satKeysets : keysetResponse.keysets
	if (keysets.length === 0) {
		throw new Error(`Mint ${normalizedMintUrl} returned no keysets`)
	}

	mintKeysetCache.set(normalizedMintUrl, keysets)
	return keysets
}
