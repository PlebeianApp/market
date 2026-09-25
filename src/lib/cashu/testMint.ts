import { Mint as CashuMint, Wallet as CashuWallet, type MintKeys, type MintKeyset, type MintQuoteBolt11Response } from '@cashu/cashu-ts'

export const CASHU_PUBLIC_TESTNET_MINTS = Object.freeze([
	Object.freeze({
		name: 'Cashu Testnut',
		url: 'https://testnut.cashu.space',
		fakeFunds: true,
	}),
])

export const normalizeCashuTestMintUrl = (mintUrl: string): string => mintUrl.trim().replace(/\/$/, '')

const isKeysetVerificationError = (error: unknown): error is Error =>
	error instanceof Error && error.message.includes("Couldn't verify keyset ID")

const getTestMintKeyset = async (cashuMint: CashuMint, targetMint: string): Promise<{ keysets: MintKeyset[]; mintKeys: MintKeys }> => {
	const keysetResponse = await cashuMint.getKeySets()
	const satKeysets = keysetResponse.keysets.filter((keyset) => keyset.unit === 'sat')
	const activeSatKeyset = satKeysets.find((keyset) => keyset.active) ?? satKeysets[0]
	if (!activeSatKeyset) throw new Error(`Mint ${new URL(targetMint).hostname} has no sat keysets`)

	const keysResponse = await cashuMint.getKeys(activeSatKeyset.id)
	const mintKeys = keysResponse.keysets.find((keyset) => keyset.id === activeSatKeyset.id) ?? keysResponse.keysets[0]
	if (!mintKeys) throw new Error(`Mint ${new URL(targetMint).hostname} returned no keys for keyset ${activeSatKeyset.id}`)

	return { keysets: satKeysets, mintKeys }
}

/**
 * Shared fake-Lightning test-mint bootstrap. Testnut can temporarily expose a
 * newer keyset identifier than the pinned cashu-ts release accepts; the
 * fallback loads the same mint-published keyset and keys explicitly.
 */
export async function createCashuTestMintWallet(
	mintUrl: string,
	options: { allowKeysetFallback: boolean },
): Promise<{ cashuWallet: CashuWallet; keysetId?: string }> {
	const targetMint = normalizeCashuTestMintUrl(mintUrl)
	const cashuMint = new CashuMint(targetMint)
	const cashuWallet = new CashuWallet(cashuMint)
	try {
		await cashuWallet.loadMint()
		return { cashuWallet }
	} catch (error) {
		if (!options.allowKeysetFallback || !isKeysetVerificationError(error)) throw error
		const { keysets, mintKeys } = await getTestMintKeyset(cashuMint, targetMint)
		return {
			cashuWallet: new CashuWallet(cashuMint, { keysets, keys: mintKeys }),
			keysetId: mintKeys.id,
		}
	}
}

export async function waitForCashuTestMintQuotePaid(
	wallet: CashuWallet,
	quote: MintQuoteBolt11Response,
	options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<MintQuoteBolt11Response> {
	const timeoutMs = options.timeoutMs ?? 10_000
	const pollMs = options.pollMs ?? 250
	const deadline = Date.now() + timeoutMs
	let current = quote
	while (current.state !== 'PAID' && current.state !== 'ISSUED') {
		if (Date.now() >= deadline) throw new Error('Test mint did not mark the fake-Lightning quote paid in time')
		await new Promise((resolve) => setTimeout(resolve, pollMs))
		current = await wallet.checkMintQuoteBolt11(current)
	}
	return current
}
