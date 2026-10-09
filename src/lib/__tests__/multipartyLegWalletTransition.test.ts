/**
 * Multiparty leg → wallet transition.
 *
 * The two tests that carry the weight are the ones about the **delta**: a proof that is simultaneously
 * kept and destroyed makes a balance wrong in both directions, and an input destroyed twice is the same
 * contradiction from a different cause. Everything else here is shape and refusal.
 */
import { describe, expect, test } from 'bun:test'
import { getDecodedToken, type Proof } from '@cashu/cashu-ts'
import { HDKey } from '@scure/bip32'
import { sha256 } from '@noble/hashes/sha2.js'
import {
	buildMultipartyLegWalletTransition,
	toNip60PendingTokens,
	type MultipartyLegTransitionRowInput,
} from '../auction/multipartyLegWalletTransition'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '../auctionP2pk'

const LOCKTIME = 1_790_000_600
const REFUND = `02${'c'.repeat(64)}`
const MINT = 'https://mint.example.com'
const AMOUNTS = [8_800, 200, 1_000]
const CREATED_AT = 1_790_000_000_000

const childKeysFor = (seeds: string[], path: string) =>
	seeds.map((seed) => {
		const master = HDKey.fromMasterSeed(sha256(new TextEncoder().encode(seed)))
		return deriveAuctionChildP2pkPubkeyFromXpub(master.publicExtendedKey as string, path)
	})

const CHILDREN = childKeysFor(['transition-a', 'transition-b', 'transition-c'], 'm/0/71')

const proof = (amount: number, tag: string): Proof =>
	({ amount, id: `00${'a'.repeat(14)}`, secret: `secret-${tag}`, C: 'b'.repeat(64) }) as unknown as Proof

const context = {
	auctionEventId: '1'.repeat(64),
	auctionCoordinates: `30408:${'a'.repeat(64)}:lot-1`,
	sellerPubkey: 'a'.repeat(64),
	pathIssuerPubkey: 'e'.repeat(64),
	refundPubkey: REFUND,
	locktime: LOCKTIME,
	derivationPath: 'm/0/71',
}

const rows = (indexes: number[] = [0, 1, 2]): MultipartyLegTransitionRowInput[] =>
	indexes.map((index) => ({
		manifestIndex: index,
		send: [proof(AMOUNTS[index], `send-${index}`)],
		keep: [proof(1, `keep-${index}`)],
		consumed: [proof(AMOUNTS[index], `in-${index}`)],
		childPubkeyCompressed: CHILDREN[index],
		amountSats: AMOUNTS[index],
	}))

const build = (overrides: Record<string, unknown> = {}) =>
	buildMultipartyLegWalletTransition({ mintUrl: MINT, context, rows: rows(), ...overrides })

const mustBuild = (overrides: Record<string, unknown> = {}) => {
	const result = build(overrides)
	if (!result.ok) throw new Error(`expected a transition, got ${result.code}: ${result.detail}`)
	return result.transition
}

let idCounter = 0
const idFactory = () => `token-${(idCounter += 1)}`

describe('multiparty leg wallet transition', () => {
	test('emits one record per row, each carrying its own row index and compressed key', () => {
		const transition = mustBuild()

		expect(transition.rows.map((row) => row.manifestIndex)).toEqual([0, 1, 2])
		expect(transition.rows.map((row) => row.childPubkeyCompressed)).toEqual(CHILDREN)
		expect(transition.rows.map((row) => row.amountSats)).toEqual(AMOUNTS)
		expect(transition.totalSats).toBe(10_000)
		expect(transition.mintUrl).toBe(MINT)
	})

	test('the row token round-trips: same mint, same proof amounts', () => {
		const transition = mustBuild()
		const decoded = getDecodedToken(transition.rows[0].tokenString)

		expect(decoded.mint).toBe(MINT)
		expect(decoded.proofs.map((entry) => entry.amount)).toEqual([AMOUNTS[0]])
	})

	test('every record carries the multiparty context, the leg facts and the row’s own key', () => {
		const transition = mustBuild()
		const rowContext = transition.rows[1].context

		expect(rowContext.kind).toBe('auction_bid_multiparty')
		expect(rowContext.auctionEventId).toBe(context.auctionEventId)
		expect(rowContext.sellerPubkey).toBe(context.sellerPubkey)
		expect(rowContext.refundPubkey).toBe(REFUND)
		expect(rowContext.locktime).toBe(LOCKTIME)
		expect(rowContext.derivationPath).toBe('m/0/71')
		expect(rowContext.rowManifestIndex).toBe(1)
		expect(rowContext.rowChildPubkeyCompressed).toBe(CHILDREN[1])
	})

	test('the delta stores every row’s change and destroys every consumed input', () => {
		const transition = mustBuild()

		expect(transition.delta.store.map((entry) => entry.secret)).toEqual(['secret-keep-0', 'secret-keep-1', 'secret-keep-2'])
		expect(transition.delta.destroy.map((entry) => entry.secret)).toEqual(['secret-in-0', 'secret-in-1', 'secret-in-2'])
	})

	test('a partial leg transitions only the rows that were actually sent', () => {
		const transition = mustBuild({ rows: rows([1]) })

		expect(transition.rows.map((row) => row.manifestIndex)).toEqual([1])
		expect(transition.totalSats).toBe(AMOUNTS[1])
		// The delta covers the sent row and nothing else: an untouched row's inputs must not be destroyed.
		expect(transition.delta.destroy.map((entry) => entry.secret)).toEqual(['secret-in-1'])
		expect(transition.delta.store.map((entry) => entry.secret)).toEqual(['secret-keep-1'])
	})

	test('refuses a proof that is both kept and destroyed', () => {
		const shared = proof(5, 'shared')
		const result = build({
			rows: [
				{ ...rows([0])[0], keep: [shared] },
				{ ...rows([1])[0], consumed: [shared] },
			],
		})

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('transition_proof_in_both_sets')
	})

	test('refuses the same input consumed by two rows', () => {
		const shared = proof(50, 'shared-input')
		const result = build({
			rows: [
				{ ...rows([0])[0], consumed: [shared] },
				{ ...rows([1])[0], consumed: [shared] },
			],
		})

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('transition_consumed_duplicated')
	})

	test('refuses a row whose locked proofs do not sum to its recorded amount', () => {
		const result = build({ rows: [{ ...rows([0])[0], amountSats: 9_000 }] })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('transition_row_send_sum_mismatch')
	})

	test('refuses a row with no locked proofs, or one that consumed nothing', () => {
		const noSend = build({ rows: [{ ...rows([0])[0], send: [] }] })
		const noConsumed = build({ rows: [{ ...rows([0])[0], consumed: [] }] })

		expect(noSend.ok).toBe(false)
		expect(noConsumed.ok).toBe(false)
		if (noSend.ok || noConsumed.ok) return
		expect(noSend.code).toBe('transition_row_send_empty')
		expect(noConsumed.code).toBe('transition_row_consumed_empty')
	})

	test('refuses a row key that is only x-only', () => {
		const result = build({ rows: [{ ...rows([0])[0], childPubkeyCompressed: CHILDREN[0].slice(2) }] })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('transition_row_key_not_compressed')
	})

	test('refuses a missing mint, no rows, or a duplicated row index', () => {
		const noMint = build({ mintUrl: '   ' })
		const noRows = build({ rows: [] })
		const duplicated = build({ rows: [rows([0])[0], rows([0])[0]] })

		expect(noMint.ok).toBe(false)
		expect(noRows.ok).toBe(false)
		expect(duplicated.ok).toBe(false)
		if (noMint.ok || noRows.ok || duplicated.ok) return
		expect(noMint.code).toBe('transition_mint_missing')
		expect(noRows.code).toBe('transition_rows_empty')
		expect(duplicated.code).toBe('transition_rows_duplicated')
	})

	test('refuses an incomplete leg context', () => {
		const noAuction = build({ context: { ...context, auctionEventId: '' } })
		const noSeller = build({ context: { ...context, sellerPubkey: '  ' } })
		const noPath = build({ context: { ...context, derivationPath: '' } })
		const badRefund = build({ context: { ...context, refundPubkey: REFUND.slice(2) } })

		for (const result of [noAuction, noSeller, noPath, badRefund]) {
			expect(result.ok).toBe(false)
		}
		if (noAuction.ok || noSeller.ok || noPath.ok || badRefund.ok) return
		expect(noAuction.code).toBe('transition_auction_missing')
		expect(noSeller.code).toBe('transition_seller_missing')
		expect(noPath.code).toBe('transition_path_missing')
		expect(badRefund.code).toBe('transition_refund_pubkey_invalid')
	})

	test('binds one pending token per row, pending, with the mint and the creation time', () => {
		idCounter = 0
		const transition = mustBuild()
		const bound = toNip60PendingTokens(transition, { createdAt: CREATED_AT, idFactory })

		expect(bound.ok).toBe(true)
		if (!bound.ok) return
		expect(bound.tokens).toHaveLength(3)
		expect(bound.tokens.every((token) => token.status === 'pending')).toBe(true)
		expect(bound.tokens.every((token) => token.mintUrl === MINT && token.createdAt === CREATED_AT)).toBe(true)
		expect(bound.tokens.map((token) => token.amount)).toEqual(AMOUNTS)
		expect(bound.tokens.map((token) => token.context?.kind)).toEqual([
			'auction_bid_multiparty',
			'auction_bid_multiparty',
			'auction_bid_multiparty',
		])
		expect(new Set(bound.tokens.map((token) => token.id)).size).toBe(3)
	})

	test('refuses a token id collision, which would make a reclaim address the wrong row', () => {
		const transition = mustBuild()
		const bound = toNip60PendingTokens(transition, { createdAt: CREATED_AT, idFactory: () => 'same-id' })

		expect(bound.ok).toBe(false)
		if (bound.ok) return
		expect(bound.code).toBe('token_id_collision')
	})

	test('refuses an empty token id', () => {
		const transition = mustBuild()
		const bound = toNip60PendingTokens(transition, { createdAt: CREATED_AT, idFactory: () => '  ' })

		expect(bound.ok).toBe(false)
		if (bound.ok) return
		expect(bound.code).toBe('token_id_missing')
	})
})
