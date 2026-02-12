/**
 * Responsive Image Variant Types and Parsing
 *
 * Handles NIP-94 kind 1063 file metadata events with responsive image variants.
 * Ported from Smesh's responsive-image-event.ts
 */

/** Variant name labels matching NIP-XX spec */
export type ImageVariant = 'thumb' | 'mobile-sm' | 'mobile-lg' | 'desktop-sm' | 'desktop-md' | 'desktop-lg' | 'original'

/** Kind 1063 = File Metadata (NIP-94) */
export const FILE_METADATA_KIND = 1063

/**
 * Parsed variant information from a kind 1063 event
 */
export type UploadedVariant = {
	variant: ImageVariant
	url: string
	sha256: string
	width: number
	height: number
	mimeType: string
	size?: number
	blurhash?: string
}

/**
 * Extract sha256 hash from a Blossom URL.
 * Blossom URLs are typically: https://domain/sha256.ext or https://domain/sha256
 */
export function extractSha256FromUrl(url: string): string | null {
	try {
		const urlObj = new URL(url)
		const segments = urlObj.pathname.split('/').filter(Boolean)
		if (segments.length === 0) return null

		const lastSegment = segments[segments.length - 1]
		const hashPart = lastSegment.replace(/\.[^.]+$/, '')

		if (/^[a-fA-F0-9]{64}$/.test(hashPart)) {
			return hashPart.toLowerCase()
		}
		return null
	} catch {
		return null
	}
}

/**
 * Parse a kind 1063 event's tags to extract variant information.
 * Reads imeta tags per NIP-92/94 format.
 */
export function parseResponsiveImageEvent(tags: string[][]): UploadedVariant[] {
	const variants: UploadedVariant[] = []

	for (const tag of tags) {
		if (tag[0] !== 'imeta') continue

		const fields = new Map<string, string>()
		for (let i = 1; i < tag.length; i++) {
			const spaceIndex = tag[i].indexOf(' ')
			if (spaceIndex > 0) {
				fields.set(tag[i].substring(0, spaceIndex), tag[i].substring(spaceIndex + 1))
			}
		}

		const url = fields.get('url')
		const sha256 = fields.get('x')
		const mimeType = fields.get('m')
		const dim = fields.get('dim')
		const variant = fields.get('variant') as ImageVariant | undefined

		if (!url || !sha256 || !mimeType || !dim) continue

		const dimMatch = dim.match(/^(\d+)x(\d+)$/)
		if (!dimMatch) continue

		const parsed: UploadedVariant = {
			variant: variant ?? 'original',
			url,
			sha256,
			width: parseInt(dimMatch[1], 10),
			height: parseInt(dimMatch[2], 10),
			mimeType,
		}

		const size = fields.get('size')
		if (size) parsed.size = parseInt(size, 10)

		const blurhash = fields.get('blurhash')
		if (blurhash) parsed.blurhash = blurhash

		variants.push(parsed)
	}

	return variants
}

/**
 * Select the best variant for a given display width.
 * Picks the smallest variant that covers the target width (accounting for pixel ratio).
 * Falls back to largest available if none is big enough.
 */
export function selectVariant(variants: UploadedVariant[], targetWidth: number, pixelRatio: number = 1): UploadedVariant | null {
	if (variants.length === 0) return null

	const effectiveWidth = targetWidth * pixelRatio
	const sorted = [...variants].sort((a, b) => a.width - b.width)

	for (const variant of sorted) {
		if (variant.width >= effectiveWidth) {
			return variant
		}
	}

	return sorted[sorted.length - 1]
}
