import {
	auctionP2pkPubkeysMatch,
	deriveAuctionChildP2pkPubkeyFromXpub,
	getAuctionP2pkLockPubkeyFromSecret,
	toCompressedAuctionP2pkPubkey,
} from '@/lib/auctionP2pk'
import { getDecodedToken, type MintKeyset } from '@cashu/cashu-ts'
import { AUCTION_MIN_BID_LEG_SATS } from './auction/constants'

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
	tokenMintUrl: string
	tokenAmount: number
	proofCount: number
}

export interface AuctionSettlementP2pkChainLegPreflightInput {
	bidEventId?: string
	mintUrl?: string
	token: string
	derivationPath?: string
	bidChildPubkey?: string
	releaseChildPubkey?: string
	expectedAmount: number
	mintKeysets?: MintKeyset[]
}

export interface AuctionSettlementP2pkChainPreflightInput {
	auctionP2pkXpub: string
	legs: AuctionSettlementP2pkChainLegPreflightInput[]
}

export interface AuctionSettlementP2pkChainPreflightResult {
	legs: Array<AuctionSettlementP2pkPreflightResult & { bidEventId?: string; mintUrl: string; expectedAmount: number }>
	totalAmount: number
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

const getChainLegLabel = (leg: AuctionSettlementP2pkChainLegPreflightInput, index: number): string =>
	leg.bidEventId ? `Chain leg ${leg.bidEventId.slice(0, 8)}…` : `Chain leg ${index + 1}`

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

	const tokenMintUrl = decodedToken.mint?.trim()
	if (!tokenMintUrl) {
		throw new Error('Winner token mint URL is missing')
	}

	let tokenLockPubkey = ''
	let tokenAmount = 0
	for (const proof of decodedToken.proofs) {
		if (!Number.isSafeInteger(proof.amount) || proof.amount <= 0) {
			throw new Error('Winner token proof amount is malformed')
		}
		tokenAmount += proof.amount
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
		tokenMintUrl,
		tokenAmount,
		proofCount: decodedToken.proofs.length,
	}
}

export const preflightAuctionSettlementP2pkChain = (
	input: AuctionSettlementP2pkChainPreflightInput,
): AuctionSettlementP2pkChainPreflightResult => {
	if (!input.legs.length) {
		throw new Error('Settlement chain contains no legs')
	}

	const preflightedLegs: AuctionSettlementP2pkChainPreflightResult['legs'] = []
	let totalAmount = 0

	for (let index = 0; index < input.legs.length; index++) {
		const leg = input.legs[index]
		const label = getChainLegLabel(leg, index)
		const mintUrl = leg.mintUrl?.trim()
		if (!mintUrl) {
			throw new Error(`${label} is missing its mint URL`)
		}
		if (!Number.isSafeInteger(leg.expectedAmount) || leg.expectedAmount < AUCTION_MIN_BID_LEG_SATS) {
			throw new Error(`${label} expected leg amount must be at least ${AUCTION_MIN_BID_LEG_SATS} sats`)
		}

		try {
			if (!leg.bidChildPubkey?.trim()) {
				throw new Error('bid child pubkey is required')
			}
			if (!leg.releaseChildPubkey?.trim()) {
				throw new Error('release child pubkey is required')
			}
			if (!auctionP2pkPubkeysMatch(leg.bidChildPubkey, leg.releaseChildPubkey)) {
				throw new Error('release child pubkey does not match bid child pubkey')
			}

			const preflight = preflightAuctionSettlementP2pk({
				auctionP2pkXpub: input.auctionP2pkXpub,
				derivationPath: leg.derivationPath,
				settlementPlanChildPubkey: leg.releaseChildPubkey,
				token: leg.token,
				mintKeysets: leg.mintKeysets,
			})

			if (preflight.tokenMintUrl !== mintUrl) {
				throw new Error(`token mint URL ${preflight.tokenMintUrl} does not match expected mint URL ${mintUrl}`)
			}

			if (preflight.tokenAmount !== leg.expectedAmount) {
				throw new Error(`token proof sum ${preflight.tokenAmount} sats does not equal expected leg amount ${leg.expectedAmount} sats`)
			}

			preflightedLegs.push({
				...preflight,
				bidEventId: leg.bidEventId,
				mintUrl,
				expectedAmount: leg.expectedAmount,
			})
			totalAmount += leg.expectedAmount
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			throw new Error(`${label}: ${message}`)
		}
	}

	return {
		legs: preflightedLegs,
		totalAmount,
	}
}
