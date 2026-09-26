/**
 * Multiparty leg → wallet transition, as **data**.
 *
 * What has to leave the construction loop for the wallet to be correct, expressed as values rather than
 * as calls: one lock record per row (its proofs, its change, its encoded token, its context) and the
 * leg's proof delta (what to keep, what to destroy). The wallet binding is deliberately the *last*,
 * smallest part of this file, because the open question is which wallet it binds to.
 *
 * ## Why data first
 *
 * A leg is N locked outputs, each locked to its own child key, and every wallet has to be told the same
 * three things about it: that N separate locks exist, what each one's key is, and which proofs moved.
 * Both candidate wallets phrase that differently — NIP-60 takes a list of pending tokens plus a
 * `{ store, destroy }` delta, while a Coco-style engine owns proofs and instead wants an operation
 * binding per row — so the projection belongs above both, and the adapter below belongs to whichever
 * one wins. `docs/handoffs/auction-multiparty-construction-log-2026-09-24.md` records that decision.
 *
 * ## The checks, and the two that matter
 *
 * A row's `send` set must sum to the row's locked amount (a wallet told otherwise holds a token whose
 * amount is a lie), and **no proof may appear in both the store and the destroy set** — a proof that is
 * simultaneously kept and spent is the wallet-state contradiction that makes a balance wrong in both
 * directions. Consumed inputs must also be disjoint across rows: the same proof destroyed twice is the
 * same contradiction with a different cause.
 *
 * Pure: the token encoding is the library's, the id is injected, and nothing here reads or writes a
 * wallet store.
 */

import { getEncodedToken, type Proof } from '@cashu/cashu-ts'
import type { AuctionMultipartyBidPendingTokenContext, PendingToken } from '../wallet/types'

export interface MultipartyLegTransitionContext {
	readonly auctionEventId: string
	readonly auctionCoordinates?: string
	readonly bidEventId?: string
	readonly sellerPubkey: string
	readonly pathIssuerPubkey: string
	/** The leg's one refund authority (compressed secp256k1 hex). */
	readonly refundPubkey: string
	/** The leg's one locktime. */
	readonly locktime: number
	/** The leg's shared derivation path (D8: one path, per-recipient xpub). */
	readonly derivationPath: string
	readonly grantId?: string
}

export interface MultipartyLegTransitionRowInput {
	readonly manifestIndex: number
	/** The row's verified `send` set — only a `locked` row may be transitioned. */
	readonly send: readonly Proof[]
	/** The change the mint returned for this row. */
	readonly keep: readonly Proof[]
	/** The inputs this row's swap consumed. */
	readonly consumed: readonly Proof[]
	/** This row's lock key, compressed. */
	readonly childPubkeyCompressed: string
	/** Sats this row locked. */
	readonly amountSats: number
}

export interface MultipartyLegWalletRow {
	readonly manifestIndex: number
	readonly childPubkeyCompressed: string
	readonly amountSats: number
	readonly send: readonly Proof[]
	readonly keep: readonly Proof[]
	/** The encoded Cashu token for this row's locked proofs — what a wallet or a reclaim stores. */
	readonly tokenString: string
	readonly context: AuctionMultipartyBidPendingTokenContext
}

export interface MultipartyLegWalletTransition {
	readonly mintUrl: string
	readonly rows: readonly MultipartyLegWalletRow[]
	/** What the wallet must hold afterwards. */
	readonly delta: { readonly store: readonly Proof[]; readonly destroy: readonly Proof[] }
	readonly totalSats: number
}

export type MultipartyLegWalletTransitionResult =
	| { readonly ok: true; readonly transition: MultipartyLegWalletTransition }
	| { readonly ok: false; readonly code: string; readonly detail: string }

const COMPRESSED = /^0[23][0-9a-f]{64}$/

const fail = (code: string, detail: string): MultipartyLegWalletTransitionResult => ({ ok: false, code, detail })

const proofIdentity = (proof: Proof): string => `${proof.secret}`
const sumOf = (proofs: readonly Proof[]): number => proofs.reduce((sum, proof) => sum + proof.amount, 0)

/**
 * Project a leg's locked rows into the wallet's transition: one record per row, plus the delta.
 *
 * Refusals: no rows; a missing mint; a missing piece of the leg's context (the row records are useless
 * without the auction they belong to and the authority that can reclaim them); a row whose send set is
 * empty or does not sum to its locked amount; a locked row with no consumed inputs; the same input
 * consumed by two rows; a proof that is both stored and destroyed; and a row key that is not
 * compressed, since only that form carries the parity a reclaim needs.
 */
export const buildMultipartyLegWalletTransition = (input: {
	readonly mintUrl: string
	readonly context: MultipartyLegTransitionContext
	readonly rows: readonly MultipartyLegTransitionRowInput[]
}): MultipartyLegWalletTransitionResult => {
	if (!input.mintUrl?.trim()) return fail('transition_mint_missing', 'the transition needs the mint the leg locked at')
	if (input.rows.length === 0) return fail('transition_rows_empty', 'a multiparty leg has at least one row')

	const context = input.context
	if (!context.auctionEventId?.trim()) return fail('transition_auction_missing', 'the row records need the auction they belong to')
	if (!context.sellerPubkey?.trim()) return fail('transition_seller_missing', 'the row records need the seller authority')
	if (!context.derivationPath?.trim()) return fail('transition_path_missing', 'the row records need the shared derivation path')
	if (!COMPRESSED.test(context.refundPubkey)) {
		return fail('transition_refund_pubkey_invalid', 'the leg refund authority must be a compressed secp256k1 pubkey')
	}

	const indexes = input.rows.map((row) => row.manifestIndex)
	if (new Set(indexes).size !== indexes.length)
		return fail('transition_rows_duplicated', `row indexes must be unique; got [${indexes.join(', ')}]`)

	const consumedSeen = new Set<string>()

	for (const row of input.rows) {
		if (!COMPRESSED.test(row.childPubkeyCompressed)) {
			return fail('transition_row_key_not_compressed', `row ${row.manifestIndex} does not carry a compressed child key`)
		}
		if (row.send.length === 0) {
			return fail('transition_row_send_empty', `row ${row.manifestIndex} carries no locked proofs, so it was not locked`)
		}
		const sendTotal = sumOf(row.send)
		if (sendTotal !== row.amountSats) {
			return fail(
				'transition_row_send_sum_mismatch',
				`row ${row.manifestIndex} carries ${sendTotal} sats of locked proofs but records ${row.amountSats}; the wallet would hold a token whose amount is a lie`,
			)
		}
		if (row.consumed.length === 0) {
			return fail(
				'transition_row_consumed_empty',
				`row ${row.manifestIndex} locked proofs without consuming any input; the delta would not account for the row`,
			)
		}
		for (const proof of row.consumed) {
			const identity = proofIdentity(proof)
			if (consumedSeen.has(identity)) {
				return fail(
					'transition_consumed_duplicated',
					`input proof ${identity.slice(0, 24)}… is consumed by two rows; the same proof cannot be destroyed twice`,
				)
			}
			consumedSeen.add(identity)
		}
	}

	const destroy = input.rows.flatMap((row) => [...row.consumed])
	const store = input.rows.flatMap((row) => [...row.keep])
	const keptIdentities = new Set(store.map(proofIdentity))
	for (const proof of destroy) {
		const identity = proofIdentity(proof)
		if (keptIdentities.has(identity)) {
			return fail(
				'transition_proof_in_both_sets',
				`proof ${identity.slice(0, 24)}… is both kept and destroyed; a wallet cannot hold and spend the same proof`,
			)
		}
	}

	const rows: MultipartyLegWalletRow[] = input.rows.map((row) => {
		const rowContext: AuctionMultipartyBidPendingTokenContext = {
			kind: 'auction_bid_multiparty',
			auctionEventId: context.auctionEventId,
			sellerPubkey: context.sellerPubkey,
			pathIssuerPubkey: context.pathIssuerPubkey,
			refundPubkey: context.refundPubkey,
			locktime: context.locktime,
			derivationPath: context.derivationPath,
			rowManifestIndex: row.manifestIndex,
			rowChildPubkeyCompressed: row.childPubkeyCompressed,
			...(context.auctionCoordinates === undefined ? {} : { auctionCoordinates: context.auctionCoordinates }),
			...(context.bidEventId === undefined ? {} : { bidEventId: context.bidEventId }),
			...(context.grantId === undefined ? {} : { grantId: context.grantId }),
		}
		return Object.freeze({
			manifestIndex: row.manifestIndex,
			childPubkeyCompressed: row.childPubkeyCompressed,
			amountSats: row.amountSats,
			send: Object.freeze([...row.send]) as readonly Proof[],
			keep: Object.freeze([...row.keep]) as readonly Proof[],
			tokenString: getEncodedToken({ mint: input.mintUrl, proofs: [...row.send] }),
			context: Object.freeze(rowContext),
		})
	})

	return {
		ok: true,
		transition: Object.freeze({
			mintUrl: input.mintUrl,
			rows: Object.freeze(rows) as readonly MultipartyLegWalletRow[],
			delta: Object.freeze({ store: Object.freeze(store) as readonly Proof[], destroy: Object.freeze(destroy) as readonly Proof[] }),
			totalSats: input.rows.reduce((sum, row) => sum + row.amountSats, 0),
		}),
	}
}

/**
 * The NIP-60 binding: one pending token per row, which is what today's wallet store holds.
 *
 * A Coco-style engine owns its proofs instead, so its analogue would take the same `rows` and emit one
 * send-operation binding per row (`operationId`, mint, amount, `p2pk` target, refund authority) with no
 * delta at all — the record shape above is what both adapters read.
 *
 * Refusals: a duplicate id from the injected factory. Two rows sharing an id would make a reclaim
 * address the wrong row.
 */
export const toNip60PendingTokens = (
	transition: MultipartyLegWalletTransition,
	input: { readonly createdAt: number; readonly idFactory: () => string },
):
	| { readonly ok: true; readonly tokens: readonly PendingToken[] }
	| { readonly ok: false; readonly code: string; readonly detail: string } => {
	const seen = new Set<string>()
	const tokens: PendingToken[] = []

	for (const row of transition.rows) {
		const id = input.idFactory()
		if (!id?.trim())
			return { ok: false, code: 'token_id_missing', detail: `row ${row.manifestIndex} got an empty token id from the id factory` }
		if (seen.has(id))
			return { ok: false, code: 'token_id_collision', detail: `token id ${id} was handed out twice; a reclaim would address the wrong row` }
		seen.add(id)

		tokens.push({
			id,
			token: row.tokenString,
			amount: row.amountSats,
			mintUrl: transition.mintUrl,
			createdAt: input.createdAt,
			status: 'pending',
			context: row.context,
		})
	}

	return { ok: true, tokens: Object.freeze(tokens) as readonly PendingToken[] }
}
