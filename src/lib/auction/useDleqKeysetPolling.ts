import { useEffect, useRef, useState } from 'react'
import type { MintKeys } from '@cashu/cashu-ts'
import { fetchDleqKeysetsForBidsDetailed, getMintKeyset, type DleqKeysetFetcher } from '../cashu/dleq'
import type { ParsedBidEvent } from './events'

const POLL_INTERVAL_MS = 300_000

/** Keyset evidence for a set of bids, split by acquisition outcome. */
export interface DleqKeysetAcquisitionState {
	/** `${mint}:${keysetId}` → keyset, for every pair fetched successfully. */
	keysets: Map<string, MintKeys>
	/** Pairs whose fetch failed terminally (mint answered, keyset absent). */
	unknownKeysets: Set<string>
}

const EMPTY_ACQUISITION: DleqKeysetAcquisitionState = { keysets: new Map(), unknownKeysets: new Set() }

/**
 * React hook that gathers the mint keysets needed to DLEQ-verify a set of
 * bids (ADR-0011 Blocker 1, review R1/R3).
 *
 * `computeValidatedBids` treats unavailable DLEQ evidence as PENDING (not
 * valid), so the ingestion path MUST actually supply the keysets — otherwise
 * every DLEQ-required bid would sit pending forever. This hook runs the
 * bounded/allowlisted acquisition (`fetchDleqKeysetsForBidsDetailed`) and
 * returns both the `${mint}:${keysetId}` → `MintKeys` map AND the set of
 * terminally-missing keyset ids, so callers can pass `dleqKeysets` +
 * `dleqUnknownKeysets` through to the validator (a terminal miss is
 * `dleq_invalid`, a transient one is `pending`).
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
): DleqKeysetAcquisitionState {
	const [acquisition, setAcquisition] = useState<DleqKeysetAcquisitionState>(EMPTY_ACQUISITION)
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
				setAcquisition(EMPTY_ACQUISITION)
				return
			}
			const next = await fetchDleqKeysetsForBidsDetailed(currentBids, trustedMintsRef.current, fetcherRef.current)
			if (!cancelled) setAcquisition(next)
		}

		void poll()
		const interval = setInterval(poll, POLL_INTERVAL_MS)

		return () => {
			cancelled = true
			clearInterval(interval)
		}
	}, [bids, trustedMints])

	return acquisition
}
