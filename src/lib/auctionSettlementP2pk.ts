import { auctionP2pkPubkeysMatch, deriveAuctionChildP2pkPubkeyFromXpub, toCompressedAuctionP2pkPubkey } from '@/lib/auctionP2pk'
import { getDecodedToken } from '@cashu/cashu-ts'

export interface AuctionSettlementP2pkPreflightInput {
	auctionP2pkXpub: string
	derivationPath?: string
	settlementPlanChildPubkey?: string
	token: string
}

export interface AuctionSettlementP2pkPreflightResult {
	derivationPath: string
	derivedChildPubkey: string
	settlementPlanChildPubkey: string
	tokenLockPubkey: string
}

type CashuP2pkSecretPayload = {
	data?: unknown
}

const X_ONLY_HEX_RE = /^[0-9a-f]{64}$/i

const extractP2pkLockPubkeyFromSecret = (secret: string): string => {
	let parsed: unknown
	try {
		parsed = JSON.parse(secret)
	} catch {
		throw new Error('Winner token proof secret is not a valid P2PK secret')
	}

	if (!Array.isArray(parsed) || parsed[0] !== 'P2PK' || typeof parsed[1] !== 'object' || parsed[1] === null) {
		throw new Error('Winner token proof secret is not a valid P2PK secret')
	}

	const payload = parsed[1] as CashuP2pkSecretPayload
	if (typeof payload.data !== 'string' || !payload.data.trim()) {
		throw new Error('Winner token proof secret is missing a P2PK lock pubkey')
	}

	return payload.data
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
		decodedToken = getDecodedToken(input.token)
	} catch {
		throw new Error('Winner token could not be decoded')
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
