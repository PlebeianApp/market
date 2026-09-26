/**
 * Multiparty leg swap plan — the mint calls a multiparty leg needs, one per manifest row.
 *
 * A leg locks **one output per manifest row**, each to that row's own child key. cashu-ts takes
 * **one** lock configuration per swap (`SwapOptions.p2pk.pubkey` — and its array form is the
 * n-of-m multisig case, not a per-output key map), so there is no single mint call that locks
 * every row to its own key. The construction is therefore **one swap per row, all at one mint**,
 * in manifest index order. That is D16 in `docs/adr/proposals/auction-v4v-participation.md`.
 *
 * ## What this module decides, and why here
 *
 * The first swap is irreversible. Everything that can be decided before it is decided here:
 *
 * - every row is funded from a **disjoint** subset of the leg's input proofs, so no proof is
 *   consumed twice and no row depends on a swap that already spent its inputs;
 * - a row that cannot be funded is a **refusal**, not a partial lock;
 * - the lock configuration of each row is fixed: that row's compressed child key, the leg's one
 *   `locktime`, the leg's one refund authority.
 *
 * What it deliberately does NOT promise: atomicity across rows. N swaps are N irreversible calls,
 * so a mint failure between them leaves a partially locked leg. That state is inherent to the
 * construction, and it is what the leg's pre-lock recovery record (every row, one refund
 * authority) and the per-row outcome verification exist for — not something a planner can prevent.
 *
 * ## The partition, and the claim it does not make
 *
 * Feasibility of a partition is a bin-packing question, and the allocation here is a deterministic
 * greedy one: rows are walked in manifest index order over one shared pool, and each row is covered
 * by the smallest single remaining proof that covers it — one input, the least over-cover, the
 * fewest change outputs — falling back to ascending accumulation when no single proof is large
 * enough (the shape the wallet's own `selectProofs` uses). A refusal therefore means "this walk could
 * not cover row N from what was left" — **not** a proof that no partition exists, since a different
 * pairing can succeed where this one fails. The refusal names the row and the shortfall, so a caller
 * can offer a smaller leg or a different mint instead of guessing; an allocation is not made smarter
 * by hiding the failure.
 *
 * Pure: no mint, no wallet, no storage. The swap calls themselves are the caller's.
 */

import type { Proof } from '@cashu/cashu-ts'
import type { MultipartyLegLock, MultipartyLegLockPlanResult } from './multipartyLegLockPlan'

const COMPRESSED = /^0[23][0-9a-f]{64}$/

/**
 * The successful branch of the lock plan, which is what this planner consumes: the rows plus the
 * leg's one mint, one locktime and one refund authority. Taking the plan rather than loose
 * parameters is deliberate — the leg's locktime and refund key are properties of the *leg*, not of
 * a row, and passing them separately invites a caller to hand in a pair that never came from the
 * plan.
 */
export type MultipartyLegLockPlan = Extract<MultipartyLegLockPlanResult, { readonly ok: true }>

export interface MultipartyLegSwapRequest {
	readonly manifestIndex: number
	readonly mintUrl: string
	readonly amountSats: number
	/** Handed to `cashuWallet.swap` verbatim as `SwapOptions.p2pk`. */
	readonly p2pk: {
		/** This row's compressed child key — the key its output is locked to. */
		readonly pubkey: string
		readonly locktime: number
		readonly refundKeys: readonly string[]
	}
	/** Inputs this row's swap consumes. Disjoint from every other row's `inputs`. */
	readonly inputs: readonly Proof[]
	readonly inputTotalSats: number
	/** `inputTotalSats - amountSats`: what the mint returns as change for this row. */
	readonly expectedChangeSats: number
}

export interface MultipartyLegSwapPlanInput {
	/** The leg's lock plan — rows, one mint, one locktime, one refund authority. */
	readonly plan: MultipartyLegLockPlan
	/** The leg's spendable proofs at that mint, as the wallet holds them. */
	readonly availableProofs: readonly Proof[]
}

export type MultipartyLegSwapPlanResult =
	| {
			readonly ok: true
			readonly requests: readonly MultipartyLegSwapRequest[]
			readonly totalSats: number
			readonly totalInputSats: number
			readonly mintUrl: string
			readonly locktime: number
			readonly refundPubkey: string
	  }
	| { readonly ok: false; readonly code: string; readonly detail: string }

const fail = (code: string, detail: string): MultipartyLegSwapPlanResult => ({ ok: false, code, detail })

/** A proof's identity for double-spend detection: the secret is what the mint burns. */
const proofIdentity = (proof: Proof): string => `${proof.secret}`

const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/**
 * Plan one swap per row, with a disjoint input partition.
 *
 * Refusals, each one a state that would otherwise consume a proof for nothing or lock a leg the
 * release cannot settle:
 *
 * - no rows; a leg with no mint, an uncompressed refund key, or a non-positive locktime;
 * - a row whose mint disagrees with the leg's (a hand-built plan; the lock planner never produces
 *   one, because a leg is single-mint until multi-mint construction is decided);
 * - no input proofs, a non-positive proof amount, or the same proof offered twice;
 * - a row this greedy allocation cannot cover from the remaining pool (names the row and the
 *   shortfall — see the module comment for what that does and does not prove).
 */
export const planMultipartyLegSwaps = (input: MultipartyLegSwapPlanInput): MultipartyLegSwapPlanResult => {
	const { plan } = input
	if (plan.locks.length === 0) {
		return fail('swaps_no_rows', 'the leg has no lock rows, so there is no swap to plan')
	}
	if (!COMPRESSED.test(plan.refundPubkey)) {
		return fail(
			'swaps_refund_pubkey_invalid',
			'the leg refund key must be a compressed secp256k1 pubkey (02/03 + 64 hex), as NUT-11 `refund` expects',
		)
	}
	if (!isPositiveInteger(plan.locktime)) {
		return fail('swaps_locktime_invalid', `the leg locktime must be a positive integer unix timestamp; got ${plan.locktime}`)
	}
	if (!plan.mintUrl.trim()) {
		return fail('swaps_mint_missing', 'the leg has no mint, so there is nowhere to swap')
	}
	if (input.availableProofs.length === 0) {
		return fail('swaps_inputs_missing', `no spendable proofs were supplied for ${plan.mintUrl}`)
	}

	const seenProofs = new Set<string>()
	for (const proof of input.availableProofs) {
		if (!isPositiveInteger(proof.amount)) {
			return fail('swaps_input_amount_invalid', `an input proof carries a non-positive amount (${proof.amount})`)
		}
		const identity = proofIdentity(proof)
		if (seenProofs.has(identity)) {
			// The same proof twice would be handed to two swaps; the mint burns it in the first.
			return fail(
				'swaps_input_duplicated',
				`input proof ${identity.slice(0, 24)}… was supplied twice; one row would swap a proof another row already spent`,
			)
		}
		seenProofs.add(identity)
	}

	for (const lock of plan.locks) {
		if (lock.mintUrl !== plan.mintUrl) {
			// The lock planner derives every row's mint from the leg, so this can only be a hand-built
			// plan — refused anyway, because a leg that swaps at two mints is deferred by the spec.
			return fail(
				'swaps_mint_mismatch',
				`row ${lock.manifestIndex} locks at ${lock.mintUrl} but the leg plans its swaps at ${plan.mintUrl}; a leg is single-mint`,
			)
		}
	}

	const totalSats = plan.locks.reduce((sum, lock) => sum + lock.amountSats, 0)

	// Rows are walked in manifest index order over one shared pool, so a proof is never offered to two
	// rows. Each row is covered by the SMALLEST SINGLE remaining proof that covers it (one input, the
	// least over-cover, the fewest change outputs) and, when no single proof is large enough, by
	// accumulating ascending until it is covered — the shape `selectProofs` already uses.
	const remaining = [...input.availableProofs].sort((left, right) => left.amount - right.amount)
	const decided = new Map<number, { inputs: Proof[]; total: number }>()

	for (const lock of plan.locks) {
		const singleIndex = remaining.findIndex((proof) => proof.amount >= lock.amountSats)
		const inputs: Proof[] = []
		let total = 0
		if (singleIndex >= 0) {
			const chosen = remaining.splice(singleIndex, 1)[0]
			inputs.push(chosen)
			total = chosen.amount
		} else {
			while (total < lock.amountSats && remaining.length > 0) {
				const proof = remaining.shift() as Proof
				inputs.push(proof)
				total += proof.amount
			}
		}
		if (total < lock.amountSats) {
			return fail(
				'swaps_row_unfundable',
				`row ${lock.manifestIndex} needs ${lock.amountSats} sats and this allocation could cover ${total}; ` +
					"the leg's proofs do not cover its rows in index order, so it is refused rather than half-locked",
			)
		}
		decided.set(lock.manifestIndex, { inputs, total })
	}

	const requests: MultipartyLegSwapRequest[] = plan.locks.map((lock) => {
		const allocation = decided.get(lock.manifestIndex) as { inputs: Proof[]; total: number }
		return Object.freeze({
			manifestIndex: lock.manifestIndex,
			mintUrl: plan.mintUrl,
			amountSats: lock.amountSats,
			p2pk: Object.freeze({
				pubkey: lock.childPubkeyCompressed,
				locktime: plan.locktime,
				refundKeys: Object.freeze([plan.refundPubkey]) as readonly string[],
			}),
			inputs: Object.freeze(allocation.inputs) as readonly Proof[],
			inputTotalSats: allocation.total,
			expectedChangeSats: allocation.total - lock.amountSats,
		})
	})

	return {
		ok: true,
		requests: Object.freeze(requests) as readonly MultipartyLegSwapRequest[],
		totalSats,
		totalInputSats: input.availableProofs.reduce((sum, proof) => sum + proof.amount, 0),
		mintUrl: plan.mintUrl,
		locktime: plan.locktime,
		refundPubkey: plan.refundPubkey,
	}
}
