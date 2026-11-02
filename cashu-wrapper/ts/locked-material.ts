/**
 * locked-material.ts — read the sealed lock material back out of a Cashu token.
 *
 * `CocoRailPort.lockedToken` returns the token Coco holds for a send. A publication route needs the lock's own
 * terms to build a bid's wire: the child pubkey the funds are locked to, the locktime, the refund key, the NUT-10
 * P2PK secrets and the proof Ys. Decoding a Cashu token is Coco's business, so it lives **here**, in the domain —
 * the one place that reaches Coco ("the runtime is the only door to Coco"). A composing app calls this helper
 * rather than importing Coco itself.
 *
 * It reads each secret with the **strict** auction-lock reader (`auction-lock.ts`, mirroring the market's
 * `parseAuctionLockSecret`), so a token that is not a conforming §5.3 auction lock is refused by name rather than
 * half-read: an unverifiable lock is not a lock this tree will publish a bid against. It returns `null` for
 * anything it cannot read at all — a token with no proof — and it stores nothing and moves no money.
 */
import { getDecodedToken } from '@cashu/coco-core'

import { parseP2PKSecret, proofPoint } from './nut-client'
import { AuctionLockRefusedError, parseAuctionLockSecret } from './auction-lock'

/** The sealed material a bid's wire is built from: the lock's three terms, its secrets and the proof Ys. */
export interface LockedMaterial {
	/** The lock's `data`: the seller child pubkey `derive(auction.p2pk_xpub, path)` (AUCTIONS.md §4.2). */
	readonly childPubkey: string
	/** The locktime inside the lock secret: `max_end_at + settlement_grace` (ADR-0003 L2.6). */
	readonly locktime: number
	/** The bidder's refund key inside the lock secret (ADR-0003 L2.7) — never the lock key. */
	readonly refundPubkey: string
	/** Every NUT-10 P2PK secret in the token, in proof order. */
	readonly lockSecrets: readonly string[]
	/** `Y = hash_to_curve(secret)` per proof, parallel to `lockSecrets`. */
	readonly proofYs: readonly string[]
}

/**
 * Decode a token into its locked material. Returns `null` when the token carries no proofs; **throws by name**
 * (`AuctionLockRefusedError`) when a proof's secret is not a conforming §5.3 auction lock, because that is a lock
 * this tree must not build a bid against — a silent `null` would hide a wrong lock as a missing one.
 */
export function lockedMaterialFromToken(token: string): LockedMaterial | null {
	let decoded: { proofs?: readonly { secret: string }[] }
	try {
		decoded = getDecodedToken(token, []) as { proofs?: readonly { secret: string }[] }
	} catch {
		// Not a decodable token at all: the honest answer is `null`, not a throw about a secret that never existed.
		return null
	}
	const proofs = decoded.proofs ?? []
	if (proofs.length === 0) return null
	const locks = proofs.map((proof) => {
		if (parseP2PKSecret(proof.secret) === null) {
			throw new AuctionLockRefusedError('secret_not_p2pk', 'a proof in this token carries no NUT-10 P2PK condition')
		}
		const parsed = parseAuctionLockSecret(proof.secret)
		if (!parsed.ok) throw new AuctionLockRefusedError(parsed.reason, parsed.detail)
		return parsed.value
	})
	return {
		childPubkey: locks[0]!.childPubkey,
		locktime: locks[0]!.locktime,
		refundPubkey: locks[0]!.refundPubkey,
		lockSecrets: proofs.map((proof) => proof.secret),
		proofYs: proofs.map((proof) => proofPoint(proof).toHex()),
	}
}
