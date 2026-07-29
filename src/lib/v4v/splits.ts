/**
 * Pure, dependency-free share math for the V4V split editor.
 *
 * Everything here is framework-agnostic (no React, no Nostr, no store actions)
 * so it can be unit-tested and reused by any V4V *adapter* — sales (kind 30078)
 * today, auctions (kind 30408) tomorrow — without the UI knowing which.
 *
 * Percentages are stored as **fractions of the recipient pool** (0..1) and are
 * kept invariant: the array always sums to 1. The sales adapter additionally
 * scales the whole pool by a separate "total V4V %" knob at the persistence
 * boundary (`scaleSharesByTotal`); an auction adapter would instead keep the
 * pool at a fixed total (e.g. 10000 bps) with the owner as the remainder.
 */
import type { V4VDTO } from '@/lib/stores/cart'

const SUM_EPSILON = 0.0001
const MIN_SHARE = 0.01

function sum(shares: V4VDTO[]): number {
	return shares.reduce((acc, s) => acc + s.percentage, 0)
}

/** Divide every share by the total so the array sums to exactly 1. */
export function normalizeShares(shares: V4VDTO[]): V4VDTO[] {
	const total = sum(shares)
	if (total === 0) return shares.map((s) => ({ ...s }))
	return shares.map((s) => ({ ...s, percentage: s.percentage / total }))
}

/**
 * Add a recipient. `newSharePct` is a 0..100 percentage of the pool the new
 * recipient should take; existing recipients are scaled down proportionally so
 * the result still sums to 1. When the pool is empty the recipient gets 100%
 * (fraction = 1). Returns the updated array; does not mutate the input.
 */
export function addRecipientToShares(shares: V4VDTO[], hexPubkey: string, newSharePct: number): V4VDTO[] {
	if (shares.length === 0) {
		return [
			{
				id: `new-${Date.now()}`,
				name: '', // resolved lazily by UserCard
				pubkey: hexPubkey,
				percentage: 1,
			},
		]
	}

	const newShareFraction = newSharePct / 100
	const totalExisting = sum(shares)
	const remaining = 1 - newShareFraction
	const ratio = remaining / totalExisting

	const scaled = shares.map((s) => ({ ...s, percentage: s.percentage * ratio }))
	scaled.push({
		id: `new-${Date.now()}`,
		name: '',
		pubkey: hexPubkey,
		percentage: newShareFraction,
	})
	return scaled
}

/** Remove a recipient and re-normalize the rest so they sum to 1. */
export function removeRecipientFromShares(shares: V4VDTO[], id: string): V4VDTO[] {
	const remaining = shares.filter((s) => s.id !== id)
	if (remaining.length === 0) return []

	const totalRemaining = sum(remaining)
	if (totalRemaining === 0) return remaining
	const ratio = 1 / totalRemaining
	return remaining.map((s) => ({ ...s, percentage: s.percentage * ratio }))
}

/**
 * Set one recipient's share to `newPercentage` (fraction 0..1) and absorb the
 * delta into the others proportionally, keeping the array summed to 1. Enforces
 * a minimum share for each recipient so one can never starve the rest to zero.
 */
export function updateSharePercentage(shares: V4VDTO[], id: string, newPercentage: number): V4VDTO[] {
	const shareToUpdate = shares.find((s) => s.id === id)
	if (!shareToUpdate) return shares

	if (shares.length === 1) {
		return [{ ...shareToUpdate, percentage: 1 }]
	}

	const oldPercentage = shareToUpdate.percentage
	const diff = newPercentage - oldPercentage
	const others = shares.filter((s) => s.id !== id)
	const totalOther = sum(others)

	// Would starve the others below the minimum -> clamp.
	if (totalOther - diff <= MIN_SHARE && diff > 0) {
		const totalMinForOthers = MIN_SHARE * others.length
		const maxForUpdated = 1 - totalMinForOthers
		return shares.map((s) => ({
			...s,
			percentage: s.id === id ? maxForUpdated : MIN_SHARE,
		}))
	}

	const adjustmentFactor = (totalOther - diff) / totalOther
	const updated = shares.map((s) =>
		s.id === id ? { ...s, percentage: newPercentage } : { ...s, percentage: s.percentage * adjustmentFactor },
	)

	// Guard against floating-point drift.
	const total = sum(updated)
	if (Math.abs(total - 1) > SUM_EPSILON) {
		return updated.map((s) => ({ ...s, percentage: s.percentage / total }))
	}
	return updated
}

/** Distribute the pool equally across all recipients. */
export function equalizeAllShares(shares: V4VDTO[]): V4VDTO[] {
	if (shares.length === 0) return []
	const equal = 1 / shares.length
	return shares.map((s) => ({ ...s, percentage: equal }))
}

/**
 * Scale every recipient by `totalPercentage/100`. Used by the sales adapter at
 * the persistence boundary to turn the normalized pool into fractions-of-total-sales
 * before publishing to kind 30078. (Auction adapter does not need this — its
 * pool is already expressed in the publish unit.)
 */
export function scaleSharesByTotal(shares: V4VDTO[], totalPercentage: number): V4VDTO[] {
	const factor = totalPercentage / 100
	return shares.map((s) => ({ ...s, percentage: s.percentage * factor }))
}

/**
 * Convert stored sales V4V shares (fractions of total sales) back into the
 * `{ initialShares, initialTotalPercentage }` shape the editor boots from.
 *
 * `initialShares` are re-normalized to sum to 1 (the *between-recipients* split)
 * and `initialTotalPercentage` is the *seller-vs-V4V* total. This deduplicates the
 * logic that both `circular-economy.tsx` and `V4VSetupDialog.tsx` previously
 * inlined.
 */
export function deriveInitialSharesFromStored(storedShares: V4VDTO[] | undefined | null): {
	initialShares: V4VDTO[]
	initialTotalPercentage: number
} {
	if (!storedShares || storedShares.length === 0) {
		return { initialShares: [], initialTotalPercentage: 10 }
	}

	const totalSharePercentage = storedShares.reduce((acc, s) => acc + s.percentage, 0)
	const totalPercentage = totalSharePercentage * 100

	// Guard against all-zero stored shares (would produce NaN from division by zero).
	if (totalSharePercentage === 0) {
		return { initialShares: [], initialTotalPercentage: 0 }
	}

	const normalizedShares = storedShares.map((s) => ({
		...s,
		percentage: s.percentage / totalSharePercentage,
	}))

	return {
		initialShares: normalizedShares,
		initialTotalPercentage: totalPercentage,
	}
}
