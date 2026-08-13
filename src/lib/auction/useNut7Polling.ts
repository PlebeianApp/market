import { useEffect, useRef, useState } from 'react'
import { checkProofStateBatch } from '../cashu/nut7'
import type { Nut7ProofState } from './constants'
import type { ParsedBidEvent } from './events'

const POLL_INTERVAL_MS = 60_000

/**
 * Aggregate per-proof NUT-7 states into a single worst-case state per bid.
 * any spent → spent, all unspent → unspent, otherwise pending.
 */
function aggregateBidNut7State(proofStates: Map<string, Nut7ProofState>, proofYs: string[]): Nut7ProofState | undefined {
	if (!proofYs.length) return undefined
	let allUnspent = true
	for (const y of proofYs) {
		const state = proofStates.get(y.toLowerCase())
		if (state === 'spent') return 'spent'
		if (state !== 'unspent') allUnspent = false
	}
	return allUnspent ? 'unspent' : 'pending'
}

/**
 * React hook that polls NUT-7 proof states for all bids every ~60 seconds.
 * Returns a Map<bidId, Nut7ProofState> with worst-case aggregate per bid.
 *
 * Used by the route to pass nut7States to computeValidatedBids, enabling
 * real-time fraud detection (bidder-spends-behind-the-lock) per ADR-0004.
 */
export function useNut7Polling(bids: ParsedBidEvent[]): Map<string, Nut7ProofState> {
	const [nut7States, setNut7States] = useState<Map<string, Nut7ProofState>>(new Map())
	const bidsRef = useRef(bids)
	bidsRef.current = bids

	useEffect(() => {
		let cancelled = false

		const poll = async () => {
			const currentBids = bidsRef.current
			if (!currentBids.length) return

			// Group proofYs by mint URL
			const byMint = new Map<string, { bidId: string; proofYs: string[] }[]>()
			for (const bid of currentBids) {
				if (!bid.proofYs.length) continue
				const existing = byMint.get(bid.mint) ?? []
				existing.push({ bidId: bid.id, proofYs: bid.proofYs })
				byMint.set(bid.mint, existing)
			}

			const newStates = new Map<string, Nut7ProofState>()

			await Promise.all(
				Array.from(byMint.entries()).map(async ([mintUrl, bidEntries]) => {
					try {
						// Collect all proofYs for this mint across all bids
						const allYs = bidEntries.flatMap((e) => e.proofYs)
						const proofStates = await checkProofStateBatch(mintUrl, allYs)

						// Map back to per-bid aggregate
						for (const { bidId, proofYs } of bidEntries) {
							const aggregate = aggregateBidNut7State(proofStates, proofYs)
							if (aggregate) newStates.set(bidId, aggregate)
						}
					} catch {
						// Network error — leave these bids without NUT-7 state
						// (computeValidatedBids will treat them as pending_review)
					}
				}),
			)

			if (!cancelled && newStates.size > 0) {
				setNut7States(newStates)
			}
		}

		// Poll immediately on mount/bid change, then on interval
		poll()
		const interval = setInterval(poll, POLL_INTERVAL_MS)

		return () => {
			cancelled = true
			clearInterval(interval)
		}
	}, [bids])

	return nut7States
}
