import { useEffect, useRef, useState } from 'react'
import type { MintKeys } from '@cashu/cashu-ts'
import { fetchDleqKeysetsForBids, getMintKeyset, type DleqKeysetFetcher } from '../cashu/dleq'
import type { ParsedBidEvent } from './events'

const POLL_INTERVAL_MS = 300_000

/**
 * React hook that gathers the mint keysets needed to DLEQ-verify a set of
 * bids (ADR-0011 Blocker 1).
 *
 * `computeValidatedBids` treats unavailable DLEQ evidence as PENDING (not
 * valid), so the ingestion path MUST actually supply the keysets — otherwise
 * every DLEQ-required bid would sit pending forever. This hook runs the
 * bounded/allowlisted acquisition (`fetchDleqKeysetsForBids`) and returns the
 * `${mint}:${keysetId}` → `MintKeys` map the validator expects.
 *
 * Only mints in `trustedMints` (the auction's allowlist) are contacted. A bid
 * referencing a non-trusted mint is skipped — this prevents a malicious
 * kind-1023 event from turning every auction viewer into a polling beacon for
 * an attacker-controlled mint URL (ADR-0004 §5.6).
 *
 * The keyset changes only on mint keyset rotation, so a long poll interval is
 * sufficient; the acquisition is bounded by the number of distinct
 * (mint, keysetId) pairs actually referenced by allowlisted bids.
 *
 * @param bids - Parsed bids from the auction.
 * @param trustedMints - The auction's trusted mint URL allowlist.
 * @param fetcher - Optional injectable keyset fetcher (tests).
 */
export function useDleqKeysetPolling(
	bids: ParsedBidEvent[],
	trustedMints: string[],
	fetcher: DleqKeysetFetcher = getMintKeyset,
): Map<string, MintKeys> {
	const [dleqKeysets, setDleqKeysets] = useState<Map<string, MintKeys>>(new Map())
	const bidsRef = useRef(bids)
	bidsRef.current = bids
	const trustedMintsRef = useRef(trustedMints)
	trustedMintsRef.current = trustedMints
	const fetcherRef = useRef(fetcher)
	fetcherRef.current = fetcher

	useEffect(() => {
		let cancelled = false

		const poll = async () => {
			const currentBids = bidsRef.current
			if (!currentBids.length) {
				setDleqKeysets(new Map())
				return
			}
			const map = await fetchDleqKeysetsForBids(currentBids, trustedMintsRef.current, fetcherRef.current)
			if (!cancelled) setDleqKeysets(map)
		}

		void poll()
		const interval = setInterval(poll, POLL_INTERVAL_MS)

		return () => {
			cancelled = true
			clearInterval(interval)
		}
	}, [bids, trustedMints])

	return dleqKeysets
}
