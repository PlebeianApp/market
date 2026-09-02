import type { NDKCashuWallet } from '@nostr-dev-kit/wallet'
import type { Proof } from '@cashu/cashu-ts'
import type { ProofInfo } from './types'

/**
 * Extract proofs grouped by mint from an NDKCashuWallet's state dump.
 * Handles multiple proof structure variants that the NDK wallet may return.
 *
 * @param wallet The NDKCashuWallet instance
 * @param knownMints Optional list of mints to query via getProofs() as fallback
 * @returns Map of mint URL to array of proofs
 */
export function extractProofsByMint(wallet: NDKCashuWallet, knownMints?: string[]): Map<string, ProofInfo[]> {
	const result = new Map<string, ProofInfo[]>()

	try {
		const dump = wallet.state.dump()
		const dumpProofs = dump.proofs as unknown

		if (Array.isArray(dumpProofs)) {
			for (const entry of dumpProofs) {
				if (entry && typeof entry === 'object') {
					// Handle ProofEntry structure: { mint, proofs: [] }
					if ('mint' in entry && 'proofs' in entry && Array.isArray(entry.proofs)) {
						const mintUrl = entry.mint as string
						const proofs = entry.proofs as ProofInfo[]
						result.set(mintUrl, proofs)
					}
					// Handle flat proof with mint attached: { mint, C, amount, secret, id }
					else if ('mint' in entry && 'C' in entry && 'amount' in entry) {
						const mintUrl = (entry as ProofInfo).mint || 'unknown'
						const existing = result.get(mintUrl) || []
						existing.push(entry as ProofInfo)
						result.set(mintUrl, existing)
					}
				}
			}
		}

		// Fallback: try getProofs for each known mint
		if (result.size === 0 && typeof wallet.state.getProofs === 'function' && knownMints) {
			for (const mint of knownMints) {
				try {
					const proofs = wallet.state.getProofs({ mint })
					if (Array.isArray(proofs) && proofs.length > 0) {
						result.set(mint, proofs as ProofInfo[])
					}
				} catch {
					// Silently ignore - getProofs may have different signature
				}
			}
		}
	} catch (e) {
		console.error('[wallet/proofs] Failed to extract proofs:', e)
	}

	return result
}

/**
 * Get proofs for a specific mint from wallet state.
 *
 * @param wallet The NDKCashuWallet instance
 * @param mintUrl The mint URL to get proofs for
 * @returns Array of proofs or empty array
 */
export function getProofsForMint(wallet: NDKCashuWallet, mintUrl: string): Proof[] {
	// Pass onlyAvailable: true explicitly — dump() would otherwise return
	// deleted proofs too, letting selectProofs pick already-spent inputs.
	return wallet.state.getProofs({ mint: mintUrl, onlyAvailable: true }) ?? []
}

/**
 * Get proofs that are currently spendable from wallet state.
 * This intentionally avoids proofs already marked as spent/deleted so they
 * cannot be reused for a new bid or ecash send.
 */
export function getSpendableProofsForMint(wallet: NDKCashuWallet, mintUrl: string): Proof[] {
	if (typeof wallet.state?.getProofs === 'function') {
		try {
			const proofs = wallet.state.getProofs({
				mint: mintUrl,
				includeDeleted: false,
				onlyAvailable: true,
			})
			if (Array.isArray(proofs)) {
				return proofs as Proof[]
			}
		} catch {
			// Fall back to the dump-based extraction below.
		}
	}

	// Fallback: dump-based extraction with proof.state filtering.
	// This path is hit when wallet.state.getProofs() is unavailable or throws.
	// proof.state may be undefined for proofs that haven't been through NDK's
	// state tracking, so the filter only excludes proofs explicitly marked as
	// 'spent' or 'deleted' — undefined state is treated as spendable.
	console.warn(
		`[wallet/proofs] getSpendableProofsForMint: falling back to dump-based extraction for mint ${mintUrl}` +
			` (wallet.state.getProofs unavailable or returned non-array)`,
	)
	const proofs = getProofsForMint(wallet, mintUrl)
	return proofs.filter((proof) => {
		const state = (proof as unknown as { state?: string }).state
		return state !== 'spent' && state !== 'deleted'
	})
}
