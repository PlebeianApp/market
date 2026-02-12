/**
 * Responsive Image Queries
 *
 * Fetches kind 1063 (NIP-94) file metadata events to find responsive image
 * variants for Blossom-hosted images, then selects the best variant for the
 * display size.
 */

import {
	extractSha256FromUrl,
	parseResponsiveImageEvent,
	selectVariant,
	FILE_METADATA_KIND,
	type UploadedVariant,
} from '@/lib/responsive-image'
import { ndkActions } from '@/lib/stores/ndk'
import { responsiveImageKeys } from './queryKeyFactory'
import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'

/**
 * Fetch responsive variants for a given sha256 hash from relays.
 */
async function fetchVariantsForHash(sha256: string): Promise<UploadedVariant[] | null> {
	console.log(`[variants:fetch] Querying kind ${FILE_METADATA_KIND} for hash ${sha256.slice(0, 12)}...`)

	const events = await ndkActions.fetchEventsWithTimeout(
		{
			kinds: [FILE_METADATA_KIND as number],
			'#x': [sha256],
			limit: 5,
		},
		{ timeoutMs: 6000 },
	)

	if (!events || events.size === 0) {
		console.log(`[variants:fetch] No binding events found for ${sha256.slice(0, 12)}`)
		return null
	}

	// Use the most recent event
	const eventsArray = Array.from(events)
	const latest = eventsArray.reduce((a, b) => ((a.created_at || 0) > (b.created_at || 0) ? a : b))

	const variants = parseResponsiveImageEvent(latest.tags)
	if (variants.length > 0) {
		console.log(
			`[variants:fetch] Found ${variants.length} variants for ${sha256.slice(0, 12)}: ${variants.map((v) => `${v.variant}(${v.width}px)`).join(', ')}`,
		)
	}
	return variants.length > 0 ? variants : null
}

/**
 * Hook: resolve the best responsive image URL for a given source URL.
 *
 * Returns the original URL immediately so there's no blank state, then
 * asynchronously looks up kind 1063 binding events. If a better-fitting
 * variant is found the returned URL updates to it.
 *
 * @param src - Original image URL (typically a Blossom URL)
 * @param containerRef - Ref to the container element (used to measure width)
 */
export function useResponsiveImageUrl(src: string, containerRef: React.RefObject<HTMLElement | null>): string {
	const sha256 = extractSha256FromUrl(src)
	const [measuredWidth, setMeasuredWidth] = useState(0)
	const measured = useRef(false)
	const logged = useRef(false)

	// Measure container width once it's available
	useEffect(() => {
		if (measured.current) return
		if (!containerRef.current) return

		const w = containerRef.current.clientWidth
		if (w > 0) {
			setMeasuredWidth(w)
			measured.current = true
		}
	})

	// Query for variants only when we have a sha256
	const { data: variants } = useQuery({
		queryKey: responsiveImageKeys.byHash(sha256 ?? ''),
		queryFn: () => fetchVariantsForHash(sha256!),
		enabled: !!sha256,
		staleTime: 5 * 60 * 1000, // 5 minutes
		gcTime: 30 * 60 * 1000, // 30 minutes
	})

	// If no variants found or no sha256, return original src
	if (!variants || !sha256) return src

	// If we haven't measured the container yet, use a reasonable default
	const width = measuredWidth > 0 ? measuredWidth : 400
	const pixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio : 1

	const best = selectVariant(variants, width, pixelRatio)

	if (best && !logged.current) {
		logged.current = true
		console.log(
			`[variants:select] ${sha256.slice(0, 12)}: container=${width}px dpr=${pixelRatio} → ${best.variant}(${best.width}px) ${best.url.slice(0, 60)}...`,
		)
	}

	return best ? best.url : src
}
