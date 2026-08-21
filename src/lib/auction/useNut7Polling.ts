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

			const allowedMints = new Set(trustedMintsRef.current.map((m) => normalizeMintUrl(m)))
			if (allowedMints.size === 0) return

			// Group proofYs by mint URL, allowlisted mints only.
			const byMint = new Map<string, { bidId: string; proofYs: string[] }[]>()
			for (const bid of currentBids) {
				if (!bid.proofYs.length) continue
				if (!allowedMints.has(normalizeMintUrl(bid.mint))) continue
				const existing = byMint.get(bid.mint) ?? []
				existing.push({ bidId: bid.id, proofYs: bid.proofYs })
				byMint.set(bid.mint, existing)
			}

			const newStates = new Map<string, Nut7ProofState>()

			await Promise.all(
				Array.from(byMint.entries()).map(async ([mintUrl, bidEntries]) => {
					try {
						const allYs = bidEntries.flatMap((e) => e.proofYs)
						const proofStates = await checkRef.current(mintUrl, allYs)

						for (const { bidId, proofYs } of bidEntries) {
							const aggregate = aggregateBidNut7State(proofStates, proofYs)
							if (aggregate) newStates.set(bidId, aggregate)
						}
					} catch {
						// Mint unreachable/erroring this cycle: previously observed
						// states for these bids are STALE, not current. Downgrade to
						// 'unknown' rather than keeping a pre-outage 'unspent' as
						// fake-current evidence (freshness is part of the payment-state
						// boundary — NUT-7 can flip spent before a path release).
						for (const { bidId } of bidEntries) {
							newStates.set(bidId, 'unknown')
						}
					}
				}),
			)

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
