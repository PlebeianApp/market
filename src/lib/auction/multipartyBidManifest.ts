/**
 * Multiparty bid manifest construction — the piece that makes a multiparty bid lockable.
 *
 * A single-party bid locks one output to the seller's child key. A multiparty bid locks **one
 * output per payout row**, and states those rows on the bid itself, so the release provably
 * splits what was locked and cannot be redirected afterwards. The rows are derived from the
 * auction root's schedule and each payee's announced capability — never invented here.
 *
 * What this module does not do: touch a wallet. Building the rows and locking the outputs are
 * separate concerns (this is the first; the wallet-side multi-output lock is the next slice), and
 * keeping them apart is what lets the rows be tested without a mint.
 *
 * See `docs/protocol/auction-multiparty-manifest-v1.md` §3 (the bid's manifest) and
 * `docs/adr/proposals/auction-v4v-participation.md` D1 (seller is the default recipient),
 * D4 (exact capability snapshot), D8 (one shared path, per-recipient xpub), D10 (the bidder pays
 * the extra outputs).
 */

import { compileManifest, type AuctionMultipartyCanonicalManifest } from './multipartyManifestWire'
import type { AuctionMultipartyCanonicalSchedule } from './multipartySchedule'
import { allocateMultipartySats } from './multipartyAllocator'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '../auctionP2pk'
import { verifyPayoutXpubProofOfPossession } from './multipartyAuthorizationCrypto'
import type { ParsedMultipartyPayoutCapability } from './multipartyAuthorization'

export interface MultipartyBidManifestInput {
	/** The auction's seller: manifest row 0, and the remainder recipient. */
	readonly sellerPubkey: string
	/** The seller's `p2pk_xpub` from the auction root — row 0's derivation root. */
	readonly sellerPayoutXpub: string
	/** The schedule as read from the root, with its commitment. */
	readonly schedule: AuctionMultipartyCanonicalSchedule
	/** The shared derivation path every row's child key is derived at (D8). */
	readonly sharedPath: string
	/** The amount this bid locks, in sats. */
	readonly totalSats: number
	/**
	 * The payees' capabilities, as announced. The schedule names the exact capability event it
	 * bound to (D4), so this must contain that snapshot — not simply the latest one.
	 */
	readonly capabilities: readonly ParsedMultipartyPayoutCapability[]
	/** Current time, for the capability window checks. */
	readonly nowUnixSeconds: number
	/** When set, every payee must accept at least one of these mints. */
	readonly acceptedMints?: readonly string[]
}

export interface MultipartyBidManifestTags {
	readonly payout_schedule_commitment: string
	readonly payout_manifest: string
	readonly payout_manifest_commitment: string
}

export type MultipartyBidManifestResult =
	| {
			readonly ok: true
			readonly manifest: AuctionMultipartyCanonicalManifest
			/** Ready to append to the kind-1023 bid. */
			readonly tags: MultipartyBidManifestTags
			/** What the wallet must lock, one output per entry, in this order. */
			readonly locks: readonly { readonly childPubkey: string; readonly amountSats: number }[]
	  }
	| { readonly ok: false; readonly code: string; readonly detail: string }

const fail = (code: string, detail: string): MultipartyBidManifestResult => ({ ok: false, code, detail })

/**
 * The manifest records x-only (32-byte) child keys; the NUT-11 lock uses the compressed
 * (33-byte) form. Both describe the same key, and the manifest wire requires `isCanonicalHex64`,
 * so the 2-character parity prefix is dropped here — loudly, rather than by blind slicing.
 *
 * A verifier comparing the two forms (manifest §6 rule 2: "the leg's locked proofs are
 * P2PK-locked to `row.child_pubkey`") has to do the same normalisation, which is why it is
 * written down rather than implied.
 */
const toXOnlyPubkey = (compressed: string): string => {
	if (!/^0[23][0-9a-f]{64}$/.test(compressed)) {
		throw new Error(`expected a compressed secp256k1 pubkey (02/03 + 64 hex); got ${compressed.length} characters`)
	}
	return compressed.slice(2)
}

/**
 * Build the manifest rows for one multiparty bid.
 *
 * Refuses rather than guesses at every point where guessing would produce an unverifiable bid:
 * a capability the schedule did not bind to, a payee that cannot be paid at the accepted mint, an
 * expired capability, or a schedule shape the manifest cannot express.
 */
export const buildMultipartyBidManifest = (input: MultipartyBidManifestInput): MultipartyBidManifestResult => {
	if (!Number.isSafeInteger(input.totalSats) || input.totalSats <= 0) {
		return fail('manifest_total_invalid', `the amount to lock must be a positive integer number of sats; got ${input.totalSats}`)
	}
	if (input.sellerPayoutXpub.trim().length === 0) {
		return fail('manifest_seller_xpub_missing', 'the auction root carries no p2pk_xpub, so the seller row cannot be derived')
	}
	if (input.sharedPath.trim().length === 0) {
		return fail('manifest_shared_path_missing', 'a shared derivation path is required; every row is derived at it (D8)')
	}
	if (input.schedule.entries.length === 0) {
		return fail('manifest_schedule_empty', 'the root schedule has no entries, so there is nothing to split')
	}

	// A zero-bps validator is permitted by the schedule (wire profile D3) and has a logical leg,
	// but the manifest requires POSITIVE row amounts. The two rules cannot both hold with the
	// positional index mapping (`manifest_index = schedule_index + 1`): a zero-bps entry would
	// need a row of zero, which the manifest forbids. Refusing is the honest option until the
	// conflict is ruled on — inventing a row, or silently skipping the entry and shifting every
	// later index, would both produce a manifest that does not mean what it says.
	const zeroEntry = input.schedule.entries.find((entry) => entry.allocation_bps === 0)
	if (zeroEntry) {
		return fail(
			'manifest_zero_allocation_unsupported',
			`schedule index ${zeroEntry.schedule_index} (${zeroEntry.role} ${zeroEntry.recipient_pubkey.slice(0, 12)}…) has a zero allocation. ` +
				'A zero-bps entry is logically attributable but has no proofs, while a manifest row must carry a positive amount, and the ' +
				'manifest index is positional. Open question in auction-multiparty-settlement-v1.',
		)
	}

	const capabilitiesById = new Map(input.capabilities.map((capability) => [capability.id, capability]))
	const locks: { childPubkey: string; amountSats: number }[] = []

	// Row 0 is the seller: the remainder recipient, never a schedule entry (D1).
	let sellerChildPubkey: string
	try {
		sellerChildPubkey = toXOnlyPubkey(deriveAuctionChildP2pkPubkeyFromXpub(input.sellerPayoutXpub, input.sharedPath))
	} catch (err) {
		return fail('manifest_derivation_failed', `could not derive the seller child key: ${err instanceof Error ? err.message : String(err)}`)
	}

	const rows: { role: 'seller' | 'validator' | 'v4v'; recipient_pubkey: string; child_pubkey: string; amount_sats: number }[] = [
		{ role: 'seller', recipient_pubkey: input.sellerPubkey, child_pubkey: sellerChildPubkey, amount_sats: 0 },
	]

	const entryChildPubkeys: { schedule_index: number; child_pubkey: string }[] = []
	for (const entry of input.schedule.entries) {
		const capability = capabilitiesById.get(entry.payout_capability_event_id)
		if (!capability) {
			return fail(
				'manifest_capability_missing',
				`the schedule binds schedule index ${entry.schedule_index} to capability ${entry.payout_capability_event_id}, which was not supplied (D4: the bid names the exact snapshot)`,
			)
		}
		if (capability.recipient_pubkey !== entry.recipient_pubkey) {
			return fail(
				'manifest_capability_recipient_mismatch',
				`capability ${capability.id} belongs to ${capability.recipient_pubkey}, but the schedule names ${entry.recipient_pubkey}`,
			)
		}
		if (capability.valid_from > input.nowUnixSeconds) {
			return fail('manifest_capability_not_yet_valid', `capability ${capability.id} is not valid until ${capability.valid_from}`)
		}
		if (capability.expires_at <= input.nowUnixSeconds) {
			return fail('manifest_capability_expired', `capability ${capability.id} expired at ${capability.expires_at}`)
		}
		if (input.acceptedMints && input.acceptedMints.length > 0) {
			const shared = capability.mints.filter((mint) => input.acceptedMints?.includes(mint))
			if (shared.length === 0) {
				return fail(
					'manifest_capability_mint_mismatch',
					`capability ${capability.id} accepts ${capability.mints.join(', ') || 'no mints'}, none of which this bid can use`,
				)
			}
		}

		// Proof of possession is verified against the xpub's own key: it proves the payee holds
		// the key material the bid is about to lock funds to.
		try {
			verifyPayoutXpubProofOfPossession(capability)
		} catch (err) {
			return fail(
				'manifest_capability_pop_invalid',
				`capability ${capability.id} failed proof of possession: ${err instanceof Error ? err.message : String(err)}`,
			)
		}

		let childPubkey: string
		try {
			childPubkey = toXOnlyPubkey(deriveAuctionChildP2pkPubkeyFromXpub(capability.payout_xpub, input.sharedPath))
		} catch (err) {
			return fail(
				'manifest_derivation_failed',
				`could not derive the child key for capability ${capability.id}: ${err instanceof Error ? err.message : String(err)}`,
			)
		}

		entryChildPubkeys.push({ schedule_index: entry.schedule_index, child_pubkey: childPubkey })
	}

	// The amounts come from the existing allocator, not from local arithmetic: it holds the
	// deterministic tie-rank rule, and it conserves the gross amount by construction.
	let allocation
	try {
		allocation = allocateMultipartySats(BigInt(input.totalSats), {
			entries: input.schedule.entries,
			seller_remainder_bps: input.schedule.seller_remainder_bps,
		})
	} catch (err) {
		return fail('manifest_allocation_failed', err instanceof Error ? err.message : String(err))
	}

	const satsByScheduleIndex = new Map(allocation.auxiliary.map((entry) => [entry.schedule_index, entry.sats]))
	rows[0] = { ...rows[0], amount_sats: Number(allocation.seller_sats) }

	for (const entry of input.schedule.entries) {
		const child = entryChildPubkeys.find((candidate) => candidate.schedule_index === entry.schedule_index)
		if (!child) return fail('manifest_derivation_failed', `no child key was derived for schedule index ${entry.schedule_index}`)
		rows.push({
			role: entry.role,
			recipient_pubkey: entry.recipient_pubkey,
			child_pubkey: child.child_pubkey,
			amount_sats: Number(satsByScheduleIndex.get(entry.schedule_index) ?? 0n),
		})
	}

	// `compileManifest` is the authority on the wire rules (positive amounts, unique recipients and
	// child keys, row limits, canonical order) and produces the commitment, so the rows above are
	// validated rather than trusted.
	let manifest: AuctionMultipartyCanonicalManifest
	try {
		manifest = compileManifest(rows)
	} catch (err) {
		const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : 'manifest_compile_failed'
		return fail(code, err instanceof Error ? err.message : String(err))
	}

	for (const row of manifest.rows) {
		locks.push({ childPubkey: row.child_pubkey, amountSats: row.amount_sats })
	}

	return {
		ok: true,
		manifest,
		tags: {
			payout_schedule_commitment: input.schedule.schedule_commitment,
			payout_manifest: manifest.tagValue,
			payout_manifest_commitment: manifest.manifest_commitment,
		},
		locks,
	}
}
