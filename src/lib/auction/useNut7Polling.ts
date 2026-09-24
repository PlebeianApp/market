import { useEffect, useRef, useState } from 'react'
import { aggregateBidNut7State, checkProofStateBatch } from '../cashu/nut7'
import { normalizeMintUrl } from '../wallet'
import type { Nut7ProofState } from './constants'
import type { ParsedBidEvent } from './events'

const POLL_INTERVAL_MS = 60_000

/**
 * Type of the proof-state checker function. Injectable for testing.
 */
export type CheckProofStateFn = (mintUrl: string, proofYs: string[]) => Promise<Map<string, Nut7ProofState>>

export async function fetchBidNut7States(
	bids: ParsedBidEvent[],
	trustedMints: string[],
	checkFn: CheckProofStateFn = checkProofStateBatch,
): Promise<Map<string, Nut7ProofState>> {
	const allowedMints = new Set(trustedMints.map((mint) => normalizeMintUrl(mint)))
	const byMint = new Map<string, { bidId: string; proofYs: string[] }[]>()

	for (const bid of bids) {
		// Some Coco UI projections deliberately omit the legacy proofYs array.
		// Runtime-check the boundary instead of trusting the legacy ParsedBidEvent
		// shape. Auction validation remains strict; this only prevents an optional
		// observer from dereferencing an absent projection field.
		if (!Array.isArray(bid.proofYs) || bid.proofYs.length === 0 || !bid.proofYs.every((proofY) => typeof proofY === 'string')) {
			continue
		}
		if (!allowedMints.has(normalizeMintUrl(bid.mint))) continue
		const existing = byMint.get(bid.mint) ?? []
		existing.push({ bidId: bid.id, proofYs: bid.proofYs })
		byMint.set(bid.mint, existing)
	}

	const states = new Map<string, Nut7ProofState>()
	await Promise.all(
		Array.from(byMint.entries()).map(async ([mintUrl, bidEntries]) => {
			try {
				const proofStates = await checkFn(
					mintUrl,
					bidEntries.flatMap((entry) => entry.proofYs),
				)
				for (const { bidId, proofYs } of bidEntries) {
					const aggregate = aggregateBidNut7State(proofStates, proofYs)
					if (aggregate) states.set(bidId, aggregate)
				}
			} catch {
				for (const { bidId } of bidEntries) states.set(bidId, 'unknown')
			}
		}),
	)

	return states
}

/**
 * React hook that polls NUT-7 proof states for all bids every ~60 seconds.
 * Returns a Map<bidId, Nut7ProofState> with worst-case aggregate per bid.
 *
 * Only mints in `trustedMints` (the auction's allowlist) are polled. A bid
 * referencing a non-trusted mint is skipped — this prevents a malicious
 * kind-1023/1025 event from turning every auction viewer into a 60-second
 * polling beacon for an attacker-controlled mint URL (ADR-0004 §5.6).
 *
 * Used by the route to pass nut7States to computeValidatedBids, enabling
 * real-time fraud detection (bidder-spends-behind-the-lock) per ADR-0004.
 *
 * @param trustedMints - The auction's trusted mint URL allowlist.
 * @param checkFn - Optional injectable proof-state checker. Defaults to
 *                  `checkProofStateBatch` from nut7.ts. In tests, pass a
 *                  mock that returns canned states without network calls.
 */
export function useNut7Polling(
	bids: ParsedBidEvent[],
	trustedMints: string[],
	checkFn: CheckProofStateFn = checkProofStateBatch,
): Map<string, Nut7ProofState> {
	const [nut7States, setNut7States] = useState<Map<string, Nut7ProofState>>(new Map())
	const bidsRef = useRef(bids)
	bidsRef.current = bids
	const trustedMintsRef = useRef(trustedMints)
	trustedMintsRef.current = trustedMints
	const checkRef = useRef(checkFn)
	checkRef.current = checkFn

	useEffect(() => {
		let cancelled = false

		const poll = async () => {
			const currentBids = bidsRef.current
			if (!currentBids.length) return
			const newStates = await fetchBidNut7States(currentBids, trustedMintsRef.current, checkRef.current)

			// Always replace the map: bids whose mints failed are 'unknown'
			// (not silently retained), and bids that vanished from the input
			// drop out. The freshness bound is one poll interval.
			if (!cancelled) {
				setNut7States(newStates)
			}
		}

		// Delay first poll slightly to avoid blocking initial render
		const initialTimer = setTimeout(poll, 1_000)
		const interval = setInterval(poll, POLL_INTERVAL_MS)

		return () => {
			cancelled = true
			clearTimeout(initialTimer)
			clearInterval(interval)
		}
	}, [bids, trustedMints])

	return nut7States
}
