import {
	auctionP2pkPubkeysMatch,
	deriveAuctionChildP2pkPubkeyFromXpub,
	getAuctionP2pkLockPubkeyFromSecret,
	toCompressedAuctionP2pkPubkey,
} from '@/lib/auctionP2pk'
import { getDecodedToken, type MintKeyset } from '@cashu/cashu-ts'

export interface AuctionSettlementP2pkPreflightInput {
	auctionP2pkXpub: string
	derivationPath?: string
	settlementPlanChildPubkey?: string
	token: string
	/**
	 * Optional mint keysets used to expand NUT-2 v2 short keyset IDs
	 * embedded in the token. cashu-ts ≥2.x rejects decode of a token
	 * with short IDs unless it can map them to full IDs from the mint;
	 * the caller is expected to fetch these once per unique mint
	 * (e.g. via `nip60Actions.loadAuctionMintKeysets`) and pass them
	 * in. Omitting them works for older tokens whose `proof.id` is
	 * already a long-form hex keyset id — including the unit-test
	 * fixtures — so existing tests don't need to change.
	 */
	mintKeysets?: MintKeyset[]
}

export interface AuctionSettlementP2pkPreflightResult {
	derivationPath: string
	derivedChildPubkey: string
	settlementPlanChildPubkey: string
	tokenLockPubkey: string
}

const X_ONLY_HEX_RE = /^[0-9a-f]{64}$/i

const extractP2pkLockPubkeyFromSecret = (secret: string): string => {
	try {
		return getAuctionP2pkLockPubkeyFromSecret(secret)
	} catch (error) {
		if (error instanceof Error && error.message === 'Cashu P2PK proof secret is missing a lock pubkey') {
			throw new Error('Winner token proof secret is missing a P2PK lock pubkey')
		}
		throw new Error('Winner token proof secret is not a valid P2PK secret')
	}
}

const requireCompressedTokenLockPubkey = (pubkey: string): string => {
	try {
		return toCompressedAuctionP2pkPubkey(pubkey)
	} catch {
		if (X_ONLY_HEX_RE.test(pubkey.trim())) {
			throw new Error('Winner token P2PK lock pubkey is not compressed; cannot settle this bid safely')
		}
		throw new Error('Winner token P2PK lock pubkey is malformed; cannot settle this bid safely')
	}
}

export const preflightAuctionSettlementP2pk = (input: AuctionSettlementP2pkPreflightInput): AuctionSettlementP2pkPreflightResult => {
	const derivationPath = input.derivationPath?.trim()
	if (!derivationPath) {
		throw new Error('Winner token derivation path is required')
	}

	const settlementPlanChildPubkey = input.settlementPlanChildPubkey?.trim()
	if (!settlementPlanChildPubkey) {
		throw new Error('Winner token child pubkey is required')
	}

	const derivedChildPubkey = deriveAuctionChildP2pkPubkeyFromXpub(input.auctionP2pkXpub, derivationPath)

	let settlementPlanChildMatches = false
	try {
		settlementPlanChildMatches = auctionP2pkPubkeysMatch(derivedChildPubkey, settlementPlanChildPubkey)
	} catch {
		throw new Error('Settlement plan child pubkey is malformed')
	}
	if (!settlementPlanChildMatches) {
		throw new Error('Settlement plan child pubkey does not match auction p2pk_xpub + derivation path')
	}

	let decodedToken: ReturnType<typeof getDecodedToken>
	try {
		decodedToken = getDecodedToken(input.token, input.mintKeysets)
	} catch (cause) {
		// Surface diagnostic info — when this fires in production the
		// raw cashu-ts error is the only signal that tells us whether
		// the token round-tripped empty (storage / wire issue), arrived
		// with the wrong prefix (cashu-ts version drift), or just lost
		// bytes somewhere. Without this the user (and we) only see
		// "Winner token could not be decoded" with zero context.
		const token = input.token ?? ''
		const head = typeof token === 'string' ? token.slice(0, 32) : `[${typeof token}]`
		const reason = cause instanceof Error ? cause.message : String(cause)
		throw new Error(`Winner token could not be decoded (length=${token.length ?? 0}, head="${head}", cashu-ts: ${reason})`)
	}

	if (!decodedToken.proofs.length) {
		throw new Error('Winner token contains no proofs')
	}

	let tokenLockPubkey = ''
	for (const proof of decodedToken.proofs) {
		const proofLockPubkey = requireCompressedTokenLockPubkey(extractP2pkLockPubkeyFromSecret(proof.secret))
		if (proofLockPubkey !== derivedChildPubkey) {
			throw new Error('Winner token P2PK lock pubkey does not match auction p2pk_xpub + derivation path')
		}
		tokenLockPubkey = proofLockPubkey
	}

	return {
		derivationPath,
		derivedChildPubkey,
		settlementPlanChildPubkey,
		tokenLockPubkey,
	}
}
